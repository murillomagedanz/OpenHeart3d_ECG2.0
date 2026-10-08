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
import { ShadowBank, SHADOW_PROTOCOL } from './qrs-shadow-bank.mjs';

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

export function causalSlope(signal, center, fs, availableIndex) {
  const radius = Math.round(0.08 * fs);
  const lag = Math.max(1, Math.round(0.01 * fs));
  const index = Math.round(center * fs);
  const start = index - radius;
  const end = Math.min(index + radius, availableIndex, signal.length - 1);
  if (start - lag < 0 || end < start) return null;
  let slope = 0;
  for (let k = start - lag; k <= end; k++) {
    if (!Number.isFinite(signal[k])) return null;
    if (k >= start) slope = Math.max(slope, Math.abs(signal[k] - signal[k - lag]) * fs / lag);
  }
  return { slopeMvPerS: slope, complete: end === index + radius, samples: end - start + 1 };
}

export function causalVector(signal, center, fs, availableIndex) {
  const radius = Math.round(SHADOW_PROTOCOL.windowRadiusS * fs);
  const index = Math.round(center * fs);
  if (index - radius < 0 || index + radius > availableIndex || index + radius >= signal.length) return null;
  const vector = Array.from(signal.slice(index - radius, index + radius + 1));
  return vector.every(Number.isFinite) ? vector : null;
}

export function replay(rec, notchHz, capped, shadowEnabled = true, queryMonitor = null) {
  const source = new FileSource(rec);
  const pipeline = new SignalPipeline(source.fs, LEAD_NAMES.length, { notchHz, detectionLead: source.detectionLead });
  if (capped) pipeline.detector = new CappedLevelDetector(source.fs);
  const bp = new Float32Array(rec.nSamples);
  const events = [];
  let previousEmission = null;
  const bank = shadowEnabled ? new ShadowBank() : null;
  let inGap = false;
  while (!source.done) {
    const sample = source.next();
    const before = pipeline.detector;
    const openingThreshold = before.noiseLevel + 0.5 * (before.threshold - before.noiseLevel);
    const out = pipeline.step(sample);
    const d = pipeline.detector;
    const valid = !(out.mask && out.mask[source.detectionLead]);
    bp[sample.index] = valid ? d.bpHist[(d.idx - 1) % d.bpHist.length] : NaN;
    if (!valid) {
      previousEmission = null;
      if (!inGap) bank?.notifyGap();
      queryMonitor?.notifyGap();
    }
    inGap = !valid;
    if (valid) queryMonitor?.step({ sample, bp, detector: d, openingThreshold, bank });
    if (out.event) {
      const slope = causalSlope(bp, out.event.t + d.groupDelay, source.fs, sample.index);
      const observation = {
        emittedAt: sample.t,
        intervalS: previousEmission ? out.event.t - previousEmission.t : null,
        slope: slope?.slopeMvPerS ?? null,
        complete: slope?.complete ?? false,
        ratio: slope && previousEmission?.slope
          ? slope.slopeMvPerS / previousEmission.slope : null,
      };
      const center = out.event.t + d.groupDelay;
      const vector = valid ? causalVector(bp, center, source.fs, sample.index) : null;
      const shadow = bank?.observe(vector, sample.t) ?? null;
      events.push({ ...out.event, causal: observation, shadow });
      if (valid) previousEmission = { t: out.event.t, slope: observation.slope };
    }
  }
  return { bp, events, source, groupDelay: pipeline.detector.groupDelay,
    shadowStats: bank ? { created: bank.nextId - 1, active: bank.templates.length,
      expired: bank.expired, evicted: bank.evicted, gaps: bank.gaps } : null };
}

function distribution(values) {
  const a = values.filter((v) => v !== null && Number.isFinite(v)).sort((x, y) => x - y);
  const q = (p) => a.length ? a[Math.round((a.length - 1) * p)] : null;
  return { n: a.length, min: q(0), p10: q(0.1), median: q(0.5), p90: q(0.9), max: q(1) };
}

export async function investigateMorphology(id, { shadowEnabled = true } = {}) {
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const entry = manifest.records.find((r) => r.id === id && r.bundled);
  if (!entry) throw new Error(`Unknown or unbundled record: ${id}`);
  const { rec } = await readLocalRecord(entry);
  const refs = rec.annotations.filter((a) => BEAT_SYMBOLS.has(a.symbol))
    .map((a) => ({ t: a.sample / rec.header.fs, symbol: a.symbol })).filter((r) => r.t >= WARMUP_S);
  if (!refs.length) throw new Error(`No beat references: ${id}`);
  const notch = manifest.databases[entry.db].mainsHz;
  const control = replay(rec, notch, false, shadowEnabled);
  const pilot = replay(rec, notch, true, shadowEnabled);
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
      causal: event.causal,
      shadow: event.shadow,
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
  const causalFlagged = rows.filter((r) => r.causal.intervalS !== null && r.causal.intervalS >= 0
    && r.causal.intervalS <= 0.36 && r.causal.ratio !== null && r.causal.ratio < 0.5);
  const summarizeShadow = (items) => {
    const matureFp = items.filter((r) => !r.reference && r.event.shadow?.matureBefore).length;
    return {
      events: items.length,
      unavailable: items.filter((r) => r.event.shadow?.status === 'unavailable').length,
      matureTp: items.filter((r) => r.reference && r.event.shadow?.matureBefore).length,
      matureFp,
      fp: items.filter((r) => !r.reference).length,
      matureV: items.filter((r) => r.reference?.symbol === 'V' && r.event.shadow?.matureBefore).length,
      v: items.filter((r) => r.reference?.symbol === 'V').length,
    };
  };
  return {
    id, lead: LEAD_NAMES[pilot.source.detectionLead], signalIndex: pilot.source.mapping[pilot.source.detectionLead],
    baseline: { tp: baseScore.tp, fp: baseScore.fp, fn: baseScore.fn },
    pilot: { tp: score.tp, fp: score.fp, fn: score.fn },
    groups,
    screen: { rule: 'previous event interval <=360ms and slope ratio <0.5',
      flaggedFp: flagged.filter((r) => r.group === 'fp').length,
      flaggedTp: flagged.filter((r) => r.group !== 'fp').length,
      flaggedRecoveredN: flagged.filter((r) => r.group === 'recoveredN').length },
    causalScreen: {
      rule: 'emission-order previous interval in [0,360ms] and available-sample slope ratio <0.5',
      flaggedFp: causalFlagged.filter((r) => r.group === 'fp').length,
      flaggedTp: causalFlagged.filter((r) => r.group !== 'fp').length,
      flaggedRecoveredN: causalFlagged.filter((r) => r.group === 'recoveredN').length,
      incompleteWindows: rows.filter((r) => !r.causal.complete).length,
      missingSlope: rows.filter((r) => r.causal.slope === null).length,
      counterexamples: causalFlagged.filter((r) => r.group !== 'fp'),
    },
    shadow: shadowEnabled ? {
      protocol: SHADOW_PROTOCOL,
      control: { ...control.shadowStats, ...summarizeShadow(baselineLabels) },
      cap2: { ...pilot.shadowStats, ...summarizeShadow(labels),
        matureRecoveredN: rows.filter((r) => r.group === 'recoveredN' && r.shadow.matureBefore).length,
        recoveredN: rows.filter((r) => r.group === 'recoveredN').length },
      ventricularCounterexamples: causalFlagged.filter((r) => r.group !== 'fp').map((r) => ({
        t: r.t, symbol: r.symbol, shadow: r.shadow,
      })),
    } : null,
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
      causalFlaggedFp: results.reduce((n, r) => n + r.causalScreen.flaggedFp, 0),
      causalFlaggedTp: results.reduce((n, r) => n + r.causalScreen.flaggedTp, 0),
      causalFlaggedRecoveredN: results.reduce((n, r) => n + r.causalScreen.flaggedRecoveredN, 0),
      shadowTotals: Object.fromEntries(['control', 'cap2'].map((mode) => [
        mode, Object.fromEntries(['events', 'unavailable', 'matureTp', 'matureFp', 'fp', 'matureV', 'v',
          'created', 'expired', 'evicted'].map((key) =>
          [key, results.reduce((n, r) => n + r.shadow[mode][key], 0)])),
      ])),
      perRecord: results,
    }, null, 2));
  } else {
    for (const id of ids) console.log(JSON.stringify(await investigateMorphology(id)));
  }
}
