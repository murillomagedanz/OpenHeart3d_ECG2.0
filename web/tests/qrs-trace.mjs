// Test-only observation: production processing and thresholds remain unchanged.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QrsDetector } from '../src/ecg/detector.js';
import { SignalPipeline } from '../src/ecg/pipeline.js';
import { FileSource } from '../src/io/fileSource.js';
import { BEAT_SYMBOLS } from '../src/io/wfdb.js';
import { LEAD_NAMES } from '../src/ecg/leads.js';
import { matchBeats } from '../src/ecg/scoring.js';
import { root, readLocalRecord, WARMUP_S, TOLERANCE_S } from './validation-report.mjs';

export class TraceDetector extends QrsDetector {
  constructor(fs, from, to, { signalDecayTauS = 0, captureDetails = true } = {}) {
    super(fs);
    this.from = from;
    this.to = to;
    this.signalDecayTauS = signalDecayTauS;
    this.captureDetails = captureDetails;
    this.closed = [];
    this.emitted = [];
  }

  _closeCandidate(t) {
    if (this.captureDetails && t >= this.from && t <= this.to) {
      this.closed.push({ ...this.candidate, threshold: this.threshold, noiseLevel: this.noiseLevel, signalLevel: this.signalLevel });
    }
    return super._closeCandidate(t);
  }

  _emit(c, weight, t, searchBack) {
    const event = super._emit(c, weight, t, searchBack);
    if (this.captureDetails && t >= this.from && t <= this.to) this.emitted.push({ ...event, emittedAt: t, maxFeat: c.maxFeat });
    return event;
  }

  process(x, t) {
    if (this.signalDecayTauS && this.n >= this.fs && !this.candidate && !this.resumePending) {
      const alpha = 1 - Math.exp(-1 / (this.signalDecayTauS * this.fs));
      this.signalLevel += alpha * (this.noiseLevel - this.signalLevel);
      this._updateThreshold();
    }
    return super.process(x, t);
  }
}

export function traceSource(source, {
  from, to, notchHz = 60, signalDecayTauS = 0, captureSamples = true, detectorFactory = null,
}) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > source.duration) {
    throw new RangeError('Trace interval must be finite and within the record duration');
  }
  if (!Number.isFinite(signalDecayTauS) || signalDecayTauS < 0) {
    throw new RangeError('Signal decay time constant must be finite and nonnegative');
  }
  const pipeline = new SignalPipeline(source.fs, LEAD_NAMES.length, { notchHz, detectionLead: source.detectionLead });
  if (detectorFactory && signalDecayTauS) throw new Error('Cannot combine detector experiments');
  const detector = detectorFactory
    ? detectorFactory(source.fs)
    : new TraceDetector(source.fs, from, to, { signalDecayTauS, captureDetails: captureSamples });
  pipeline.detector = detector;
  const samples = [];
  const events = [];
  while (!source.done) {
    const sample = source.next();
    const { filtered, mask, event } = pipeline.step(sample);
    if (event) events.push(event);
    if (!captureSamples || sample.t < from || sample.t > to) continue;
    samples.push({
      t: sample.t, raw: sample.leads[source.detectionLead], filtered: filtered[source.detectionLead],
      valid: !(mask && mask[source.detectionLead]),
      feat: detector.mwiSum / detector.mwiLen,
      threshold: detector.threshold, noiseLevel: detector.noiseLevel, signalLevel: detector.signalLevel,
      halfThreshold: detector.noiseLevel + 0.5 * (detector.threshold - detector.noiseLevel),
      sinceLast: sample.t - detector.lastPeakT,
      candidate: Boolean(detector.candidate), backup: Boolean(detector.backup), rrMean: detector.rrMean,
    });
  }
  return { samples, events, closed: detector.closed ?? [], emitted: detector.emitted ?? [] };
}

export async function traceRecord(id, from, to, { signalDecayTauS = 0, captureSamples = true } = {}) {
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const entry = manifest.records.find((r) => r.id === id);
  if (!entry) throw new Error(`Unknown record: ${id}`);
  const { rec } = await readLocalRecord(entry);
  const source = new FileSource(rec);
  const trace = traceSource(source, {
    from, to, notchHz: manifest.databases[entry.db].mainsHz, signalDecayTauS, captureSamples,
  });
  const refs = rec.beats.map((i) => i / source.fs).filter((t) => t >= WARMUP_S);
  const dets = trace.events.map((e) => e.t).filter((t) => t >= WARMUP_S && t <= refs.at(-1) + TOLERANCE_S);
  const score = matchBeats(refs, dets, TOLERANCE_S);
  const beats = captureSamples ? rec.annotations.filter((a) => BEAT_SYMBOLS.has(a.symbol))
    .filter((a) => a.sample / source.fs >= from + 0.15 && a.sample / source.fs <= to - 0.3)
    .map((a) => {
      const t = a.sample / source.fs;
      const window = trace.samples.filter((s) => s.valid && s.t >= t - 0.15 && s.t <= t + 0.3);
      const max = window.reduce((best, s) => !best || s.feat > best.feat ? s : best, null);
      return {
        t, symbol: a.symbol, detectedNearby: dets.some((d) => Math.abs(d - t) <= TOLERANCE_S),
        max: max ? { ...max, ratio: max.feat / max.threshold } : null,
        candidates: trace.closed.filter((c) => c.peakT - (Math.round(0.03 * source.fs) - 1) / 2 / source.fs >= t - 0.15
          && c.peakT - (Math.round(0.03 * source.fs) - 1) / 2 / source.fs <= t + 0.15),
      };
    }) : [];
  return {
    id, from, to, fs: source.fs, lead: LEAD_NAMES[source.detectionLead],
    signalIndex: source.mapping[source.detectionLead],
    signal: rec.header.signals[source.mapping[source.detectionLead]].description,
    score: { tp: score.tp, fp: score.fp, fn: score.fn }, beats, ...trace,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [id, from, to] = process.argv.slice(2);
  console.log(JSON.stringify(await traceRecord(id, Number(from), Number(to)), null, 2));
}
