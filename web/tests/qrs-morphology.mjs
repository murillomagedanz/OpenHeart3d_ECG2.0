import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSource } from '../src/io/fileSource.js';
import { SignalPipeline } from '../src/ecg/pipeline.js';
import { LEAD_NAMES } from '../src/ecg/leads.js';
import { BEAT_SYMBOLS } from '../src/io/wfdb.js';
import { matchBeats } from '../src/ecg/scoring.js';
import { root, readLocalRecord, TOLERANCE_S, WARMUP_S } from './validation-report.mjs';
import { CappedLevelDetector } from './qrs-capped-level.mjs';

export function labelEvents(refs, events) {
  let i = 0;
  const labels = [];
  for (const event of [...events].sort((a, b) => a.t - b.t)) {
    while (i < refs.length && refs[i].t < event.t - TOLERANCE_S) i++;
    const matched = i < refs.length && Math.abs(refs[i].t - event.t) <= TOLERANCE_S;
    labels.push({ event, reference: matched ? refs[i++] : null });
  }
  return labels;
}

export function localShape(signal, center, fs) {
  const radius = Math.round(0.08 * fs);
  const lag = Math.max(1, Math.round(0.01 * fs));
  const index = Math.round(center * fs);
  if (index - radius - lag < 0 || index + radius >= signal.length) return null;
  const vector = Array.from(signal.slice(index - radius, index + radius + 1));
  if (!vector.every(Number.isFinite)
    || !Array.from(signal.slice(index - radius - lag, index - radius)).every(Number.isFinite)) return null;
  let peak = index - radius;
  let slope = 0;
  for (let k = index - radius; k <= index + radius; k++) {
    if (Math.abs(signal[k]) > Math.abs(signal[peak])) peak = k;
    slope = Math.max(slope, Math.abs(signal[k] - signal[k - lag]) * fs / lag);
  }
  const amplitude = Math.abs(signal[peak]);
  const half = amplitude * 0.5;
  let left = peak;
  let right = peak;
  while (left > index - radius && Math.abs(signal[left - 1]) > half) left--;
  while (right < index + radius && Math.abs(signal[right + 1]) > half) right++;
  return {
    amplitudeMv: amplitude, slopeMvPerS: slope,
    halfWidthMs: (right - left + 1) * 1000 / fs,
    widthCensored: left === index - radius || right === index + radius,
    vector,
  };
}

export function correlation(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(a);
  const mb = mean(b);
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    dot += x * y; aa += x * x; bb += y * y;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : null;
}

function replay(rec, notchHz, capped) {
  const source = new FileSource(rec);
  const pipeline = new SignalPipeline(source.fs, LEAD_NAMES.length, { notchHz, detectionLead: source.detectionLead });
  if (capped) pipeline.detector = new CappedLevelDetector(source.fs);
  const bp = new Float32Array(rec.nSamples);
  const events = [];
  while (!source.done) {
    const sample = source.next();
    const out = pipeline.step(sample);
    const d = pipeline.detector;
    const valid = !(out.mask && out.mask[source.detectionLead]);
    bp[sample.index] = valid ? d.bpHist[(d.idx - 1) % d.bpHist.length] : NaN;
    if (out.event) events.push(out.event);
  }
  return { bp, events, source, groupDelay: pipeline.detector.groupDelay };
}

function distribution(values) {
  const a = values.filter((v) => v !== null && Number.isFinite(v)).sort((x, y) => x - y);
  const q = (p) => a.length ? a[Math.round((a.length - 1) * p)] : null;
  return { n: a.length, min: q(0), p10: q(0.1), median: q(0.5), p90: q(0.9), max: q(1) };
}

export async function investigateMorphology(id) {
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const entry = manifest.records.find((r) => r.id === id && r.bundled);
  if (!entry) throw new Error(`Unknown or unbundled record: ${id}`);
  const { rec } = await readLocalRecord(entry);
  const refs = rec.annotations.filter((a) => BEAT_SYMBOLS.has(a.symbol))
    .map((a) => ({ t: a.sample / rec.header.fs, symbol: a.symbol })).filter((r) => r.t >= WARMUP_S);
  if (!refs.length) throw new Error(`No beat references: ${id}`);
  const notch = manifest.databases[entry.db].mainsHz;
  const control = replay(rec, notch, false);
  const pilot = replay(rec, notch, true);
  const scored = (events) => events.filter((e) => e.t >= WARMUP_S && e.t <= refs.at(-1).t + TOLERANCE_S);
  const baselineLabels = labelEvents(refs, scored(control.events));
  const baselineHits = new Set(baselineLabels.filter((x) => x.reference).map((x) => x.reference));
  const labels = labelEvents(refs, scored(pilot.events));
  const score = matchBeats(refs.map((r) => r.t), scored(pilot.events).map((e) => e.t));
  if (labels.filter((x) => !x.reference).length !== score.fp) throw new Error('Morphology labels disagree with scorer');
  const frozen = JSON.parse(await readFile(path.join(root, 'data', 'reports', 'validation.json'), 'utf8'));
  const expected = frozen.records.find((r) => r.id === id);
  const baseScore = matchBeats(refs.map((r) => r.t), scored(control.events).map((e) => e.t));
  if (!expected || ['tp', 'fp', 'fn'].some((k) => baseScore[k] !== expected[k])) throw new Error(`Frozen baseline mismatch: ${id}`);
  let previous = null;
  const rows = labels.map(({ event, reference }) => {
    const shape = localShape(pilot.bp, event.t + pilot.groupDelay, rec.header.fs);
    const prevShape = previous ? localShape(pilot.bp, previous.t + pilot.groupDelay, rec.header.fs) : null;
    const group = !reference ? 'fp' : baselineHits.has(reference) ? 'retained' : reference.symbol === 'N' ? 'recoveredN' : 'recoveredOther';
    const row = {
      t: event.t, group, symbol: reference?.symbol ?? null, searchBack: event.searchBack,
      intervalFromPreviousEventS: previous ? event.t - previous.t : null,
      amplitudeMv: shape?.amplitudeMv ?? null, slopeMvPerS: shape?.slopeMvPerS ?? null,
      halfWidthMs: shape?.halfWidthMs ?? null, widthCensored: shape?.widthCensored ?? null,
      slopeRatioToPrevious: shape && prevShape?.slopeMvPerS ? shape.slopeMvPerS / prevShape.slopeMvPerS : null,
      correlationToPrevious: correlation(shape?.vector, prevShape?.vector),
    };
    previous = event;
    return row;
  });
  const fields = ['amplitudeMv', 'slopeMvPerS', 'halfWidthMs', 'slopeRatioToPrevious', 'correlationToPrevious', 'intervalFromPreviousEventS'];
  const groups = Object.fromEntries(['fp', 'recoveredN', 'recoveredOther', 'retained'].map((group) => {
    const selected = rows.filter((r) => r.group === group);
    return [group, { n: selected.length, missingShape: selected.filter((r) => r.halfWidthMs === null).length,
      censoredWidth: selected.filter((r) => r.widthCensored).length,
      ...Object.fromEntries(fields.map((f) => [f, distribution(selected.map((r) => r[f]))])) }];
  }));
  // Observational screen, fixed before measurement; never changes emitted events.
  const flagged = rows.filter((r) => r.intervalFromPreviousEventS <= 0.36
    && r.intervalFromPreviousEventS !== null && r.slopeRatioToPrevious !== null && r.slopeRatioToPrevious < 0.5);
  return {
    id, lead: LEAD_NAMES[pilot.source.detectionLead], signalIndex: pilot.source.mapping[pilot.source.detectionLead],
    baseline: { tp: baseScore.tp, fp: baseScore.fp, fn: baseScore.fn },
    pilot: { tp: score.tp, fp: score.fp, fn: score.fn },
    groups,
    screen: { rule: 'previous event interval <=360ms and slope ratio <0.5',
      flaggedFp: flagged.filter((r) => r.group === 'fp').length,
      flaggedTp: flagged.filter((r) => r.group !== 'fp').length,
      flaggedRecoveredN: flagged.filter((r) => r.group === 'recoveredN').length },
    events: rows,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('Usage: node tests/qrs-morphology.mjs record-id [...] or --all');
  if (ids[0] === '--all') {
    if (ids.length !== 1) throw new Error('--all cannot be combined with record ids');
    const baseline = JSON.parse(await readFile(path.join(root, 'data', 'reports', 'validation.json'), 'utf8'));
    const results = [];
    for (const record of baseline.records) {
      const { events, ...result } = await investigateMorphology(record.id);
      results.push(result);
    }
    console.log(JSON.stringify({
      records: results.length,
      flaggedFp: results.reduce((n, r) => n + r.screen.flaggedFp, 0),
      flaggedTp: results.reduce((n, r) => n + r.screen.flaggedTp, 0),
      flaggedRecoveredN: results.reduce((n, r) => n + r.screen.flaggedRecoveredN, 0),
      perRecord: results,
    }, null, 2));
  } else {
    for (const id of ids) console.log(JSON.stringify(await investigateMorphology(id)));
  }
}
