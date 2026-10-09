// B03 v1 measurements only: production classes own every processing trajectory.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, totalmem, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HighPass1, Notch, LeadFilterBank } from '../src/ecg/filters.js';
import { SignalPipeline, detectAll } from '../src/ecg/pipeline.js';
import { FileSource } from '../src/io/fileSource.js';
import { LEAD_NAMES } from '../src/ecg/leads.js';
import { matchBeats } from '../src/ecg/scoring.js';
import { root, readLocalRecord } from './validation-report.mjs';

export const PROTOCOL = Object.freeze({
  version: 1, fs: [360, 500], hpHz: 0.5, notchHz: [0, 50, 60], q: 30,
  frequencies: [0.1, 0.25, 0.5, 1, 5, 10, 20, 40, 49, 50, 51, 59, 60, 61, 100],
  amplitudeMv: 1, durationS: 120, discardS: 60,
  tolerance: { scalarGain: 0.002, cascadeGain: 0.003, phaseRad: 0.02,
    residualRms: 0.002, scalarImpulse: 1e-6, bankImpulse: 1e-5, primeMv: 1e-6 },
  windows: { 'ludb/8': [1, 9], 'ludb/56': [1, 9], 'ludb/83': [1, 9],
    'mitdb/100': [60, 70], 'mitdb/228': [400, 410] },
});
export const wrapPhase = (x) => Math.atan2(Math.sin(x), Math.cos(x));
const mul = ([a, b], [c, d]) => [a * c - b * d, a * d + b * c];
const div = ([a, b], [c, d]) => [(a * c + b * d) / (c * c + d * d),
  (b * c - a * d) / (c * c + d * d)];
const plus = (...zs) => zs.reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0]);
const scale = (z, k) => z.map((v) => v * k);

// Independently derived coefficients; never read coefficients from production.
export function coefficients(fs, notchHz = 0) {
  const alpha = fs / (fs + 2 * Math.PI * PROTOCOL.hpHz);
  if (!notchHz) return { alpha, notch: null };
  const w = 2 * Math.PI * notchHz / fs;
  const a = Math.sin(w) / (2 * PROTOCOL.q);
  return { alpha, notch: { b: [1, -2 * Math.cos(w), 1].map((v) => v / (1 + a)),
    a: [1, -2 * Math.cos(w) / (1 + a), (1 - a) / (1 + a)] } };
}
export function response(fs, frequency, stage, notchHz = 0) {
  const c = coefficients(fs, notchHz);
  const w = 2 * Math.PI * frequency / fs;
  const z = [Math.cos(w), -Math.sin(w)];
  const hp = div(scale(plus([1, 0], scale(z, -1)), c.alpha),
    plus([1, 0], scale(z, -c.alpha)));
  const n = c.notch;
  const notch = n ? div(plus([n.b[0], 0], scale(z, n.b[1]), scale(mul(z, z), n.b[2])),
    plus([1, 0], scale(z, n.a[1]), scale(mul(z, z), n.a[2]))) : [1, 0];
  const h = stage === 'hp' ? hp : stage === 'notch' ? notch : mul(hp, notch);
  const gain = Math.hypot(...h);
  return { gain, gainDb: gain > 0 ? 20 * Math.log10(gain) : null,
    phaseRad: gain < 0.01 ? null : Math.atan2(h[1], h[0]) };
}

export function estimateTone(values, fs, frequency, start = 0, eligible = true) {
  const g = Array.from({ length: 3 }, () => [0, 0, 0]);
  const rhs = [0, 0, 0];
  for (let i = start; i < values.length; i++) {
    const w = 2 * Math.PI * frequency * i / fs;
    const v = [Math.sin(w), Math.cos(w), 1];
    for (let r = 0; r < 3; r++) {
      rhs[r] += v[r] * values[i];
      for (let c = 0; c < 3; c++) g[r][c] += v[r] * v[c];
    }
  }
  const a = g.map((row, i) => [...row, rhs[i]]);
  for (let k = 0; k < 3; k++) {
    let p = k;
    for (let i = k + 1; i < 3; i++) if (Math.abs(a[i][k]) > Math.abs(a[p][k])) p = i;
    [a[k], a[p]] = [a[p], a[k]];
    if (Math.abs(a[k][k]) < 1e-12) throw new RangeError('Singular sine/cosine/DC fit');
    const pivot = a[k][k];
    for (let c = k; c < 4; c++) a[k][c] /= pivot;
    for (let r = 0; r < 3; r++) if (r !== k) {
      const factor = a[r][k];
      for (let c = k; c < 4; c++) a[r][c] -= factor * a[k][c];
    }
  }
  const [s, c, dc] = a.map((r) => r[3]);
  let residual = 0;
  for (let i = start; i < values.length; i++) {
    const w = 2 * Math.PI * frequency * i / fs;
    residual += (values[i] - s * Math.sin(w) - c * Math.cos(w) - dc) ** 2;
  }
  const gain = Math.hypot(s, c);
  return { gain, gainDb: gain > 0 ? 20 * Math.log10(gain) : null,
    phaseRad: eligible && gain > 0 ? Math.atan2(c, s) : null, dcMv: dc,
    residualRms: Math.sqrt(residual / (values.length - start)) };
}
export const sine = (fs, f, seconds) => Float64Array.from({ length: fs * seconds },
  (_, i) => Math.sin(2 * Math.PI * f * i / fs));

export function trajectory(input, fs, notchHz, stage) {
  const hp = new HighPass1(fs, 0.5);
  const notch = notchHz ? new Notch(fs, notchHz, 30) : null;
  const bank = stage === 'bank' ? new LeadFilterBank(fs, 12, { notchHz }) : null;
  let parityError = 0;
  const values = Float64Array.from(input, (x) => {
    if (bank) {
      const out = bank.process(new Float64Array(12).fill(x));
      for (const y of out) parityError = Math.max(parityError, Math.abs(y - out[0]));
      return out[0];
    }
    if (stage === 'notch') return notch ? notch.process(x) : x;
    const y = hp.process(x);
    return stage === 'hp' || !notch ? y : notch.process(y);
  });
  return { values, parityError };
}
export function referenceImpulse(fs, notchHz, length, stage) {
  const { alpha, notch } = coefficients(fs, notchHz);
  let px = 0, py = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return Float64Array.from({ length }, (_, i) => {
    const x = i === 0 ? 1 : 0;
    const hp = alpha * (py + x - px);
    px = x; py = hp;
    const v = stage === 'notch' ? x : hp;
    if (!notch || stage === 'hp') return v;
    const y = notch.b[0] * v + notch.b[1] * x1 + notch.b[2] * x2
      - notch.a[1] * y1 - notch.a[2] * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    return y;
  });
}
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
export function summarize(values, unit, fs, offset = 0, input = null) {
  let sum = 0, peak = 0, peakIndex = null, finite = 0, difference = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    finite++; sum += v * v;
    if (peakIndex === null || Math.abs(v) > peak) { peak = Math.abs(v); peakIndex = offset + i; }
    if (input && Number.isFinite(input[i])) difference += (input[i] - v) ** 2;
  }
  return { unit, samples: values.length, finite, invalid: values.length - finite,
    rms: finite ? Math.sqrt(sum / finite) : null, peakAbs: finite ? peak : null,
    peakIndex, peakTimeS: peakIndex === null ? null : peakIndex / fs,
    differenceRms: input && finite === values.length && input.every(Number.isFinite)
      ? Math.sqrt(difference / finite) : null,
    differenceConvention: input ? 'input-output, original sample clock, same unit' : 'not compared: no same-unit input' };
}
const passCase = (id, fields, pass) => ({ id, ...fields, status: pass ? 'pass' : 'fail' });
const curve = (values, fs, times) => times.filter((t) => t * fs < values.length)
  .map((t) => ({ index: Math.round(t * fs), tS: Math.round(t * fs) / fs, mv: values[Math.round(t * fs)] }));

export function linearCases() {
  const rows = [];
  for (const fs of PROTOCOL.fs) for (const frequency of PROTOCOL.frequencies) {
    const input = sine(fs, frequency, 120);
    const configs = [['hp', 0], ['notch', 50], ['notch', 60],
      ...PROTOCOL.notchHz.flatMap((hz) => [['cascade', hz], ['bank', hz]])];
    for (const [stage, notchHz] of configs) {
      const analytic = response(fs, frequency, stage, notchHz);
      const { values, parityError } = trajectory(input, fs, notchHz, stage);
      const measured = estimateTone(values, fs, frequency, fs * 60, analytic.phaseRad !== null);
      const gainError = Math.abs(measured.gain - analytic.gain);
      const phaseErrorRad = analytic.phaseRad === null ? null
        : Math.abs(wrapPhase(measured.phaseRad - analytic.phaseRad));
      const gainTolerance = ['bank', 'cascade'].includes(stage) ? 0.003 : 0.002;
      rows.push(passCase(`tone:${fs}:${frequency}:${stage}:${notchHz}`, {
        fs, frequencyHz: frequency, stage, notchHz, analytic, measured, gainError,
        phaseErrorRad, gainTolerance, parityError,
        startup: summarize(values.subarray(0, fs * 60), 'mV', fs),
      }, gainError <= gainTolerance && (phaseErrorRad === null || phaseErrorRad <= 0.02)
        && measured.residualRms <= 0.002 && parityError === 0));
    }
  }
  return rows;
}

export function transientCases() {
  const rows = [];
  for (const fs of PROTOCOL.fs) for (const notchHz of PROTOCOL.notchHz) {
    for (const stage of ['hp', ...(notchHz ? ['notch'] : []), 'cascade', 'bank']) {
      const input = new Float64Array(fs * 20); input[0] = 1;
      const { values, parityError } = trajectory(input, fs, notchHz, stage);
      const error = maxDiff(values, referenceImpulse(fs, notchHz, input.length, stage));
      rows.push(passCase(`impulse:${fs}:${stage}:${notchHz}`, { fs, stage, notchHz,
        maximumErrorMv: error, parityError, summary: summarize(values, 'mV', fs),
        curve: curve(values, fs, [0, 1 / fs, 2 / fs, 0.1, 0.5, 1, 2, 5, 10, 19]) },
      values.every(Number.isFinite) && error <= (stage === 'bank' ? 1e-5 : 1e-6) && parityError === 0));
    }
    const step = Float64Array.from({ length: fs * 30 }, (_, i) => i < fs * 5 ? 0 : 1);
    const hpStep = trajectory(step, fs, 0, 'hp').values;
    let lastAbove = fs * 5 - 1;
    for (let i = fs * 5; i < hpStep.length; i++) if (Math.abs(hpStep[i]) > 0.01) lastAbove = i;
    const stepRows = {};
    const startupRows = {};
    for (const stage of ['hp', 'cascade', 'bank']) {
      const stepValues = trajectory(step, fs, notchHz, stage).values;
      stepRows[stage] = { ...summarize(stepValues, 'mV', fs, 0, step),
        curve: curve(stepValues, fs, [0, 4, 5, 5 + 1 / fs, 5.1, 5.5, 6, 6.5, 7, 10, 20, 29]) };
      const y = trajectory(new Float64Array(fs * 10).fill(1), fs, notchHz, stage).values;
      startupRows[stage] = { ...summarize(y, 'mV', fs), firstMv: y[0], finalMv: y.at(-1),
        curve: curve(y, fs, [0, 1 / fs, 0.1, 0.5, 1, 1.5, 2, 5, 9]) };
    }
    rows.push(passCase(`step:${fs}:${notchHz}`, { fs, notchHz, stages: stepRows,
      hpSettledAtS: lastAbove + 1 < hpStep.length ? (lastAbove + 1) / fs : null,
      hpSettlingAfterStepS: (lastAbove + 1) / fs - 5 },
    Object.values(stepRows).every((s) => s.invalid === 0)));
    rows.push(passCase(`startup:${fs}:${notchHz}`, { fs, notchHz, stages: startupRows,
      automaticallyPrimed: startupRows.bank.firstMv === 0,
      audit: 'Bank starts at zero state, NOT automatically primed on first sample; B01 table wording is inaccurate.' },
    Object.values(startupRows).every((s) => s.invalid === 0) && startupRows.bank.firstMv > 0));

    const hp = new HighPass1(fs); hp.prime(1);
    const n = notchHz ? new Notch(fs, notchHz) : null; if (n) n.prime(0);
    const primedBank = new LeadFilterBank(fs, 12, { notchHz });
    for (const chain of primedBank.chains) {
      let value = 1;
      for (const f of chain) { f.prime(value); value = f.process(value); }
    }
    let explicitBankPrimeMax = 0;
    let explicitPrimeMax = 0;
    for (let i = 0; i < fs; i++) {
      const y = hp.process(1);
      explicitPrimeMax = Math.max(explicitPrimeMax, Math.abs(n ? n.process(y) : y));
      for (const v of primedBank.process(new Float64Array(12).fill(1))) explicitBankPrimeMax = Math.max(explicitBankPrimeMax, Math.abs(v));
    }
    const p = new SignalPipeline(fs, 12, { notchHz, detectionLead: 1 });
    const sample = (i, value, missing) => ({ t: i / fs, leads: new Float32Array(12).fill(value),
      missing, missingLeads: new Uint8Array(12).fill(missing ? 1 : 0) });
    for (let i = 0; i < fs; i++) p.step(sample(i, 1, false));
    const state = JSON.stringify(p.filters.chains);
    const detectorIndex = p.detector.idx;
    const held = p.filters.lastOut[1];
    let gapStateUnchanged = true, heldOutput = true, masksPreserved = true, gapEvents = 0;
    for (let i = fs; i < fs * 4; i++) {
      const out = p.step(sample(i, 999, true));
      gapStateUnchanged &&= state === JSON.stringify(p.filters.chains) && detectorIndex === p.detector.idx;
      heldOutput &&= out.filtered[1] === held;
      masksPreserved &&= out.mask[1] === 1;
      if (out.event) gapEvents++;
    }
    const resumed = p.step(sample(fs * 4, 2.5, false));
    rows.push(passCase(`prime-gap:${fs}:${notchHz}`, { fs, notchHz, explicitPrimeMaxMv: explicitPrimeMax,
      explicitBankPrimeMaxMv: explicitBankPrimeMax,
      primeMethod: 'Bank has no public prime; explicitly prime/process each existing chain stage in order at 1 mV.',
      resumeMv: resumed.filtered[1], gapDurationS: 3, gapStateUnchanged, heldOutput,
      masksPreserved, gapEvents, resumedMask: resumed.mask, detectorResumeFeature: p.detector.mwiSum / p.detector.mwiLen,
      unit: 'mV; held gap values excluded from all signal statistics' },
    explicitPrimeMax <= 1e-6 && explicitBankPrimeMax <= 1e-6 && Math.abs(resumed.filtered[1]) <= 1e-6 && gapStateUnchanged
      && heldOutput && masksPreserved && resumed.mask === null && p.detector.mwiSum === 0));
    if (notchHz === 0) {
      const bank = new LeadFilterBank(fs, 12, { notchHz: 0 });
      rows.push(passCase(`disabled:${fs}`, { fs, description: bank.description, notchActive: bank.notchActive,
        maximumErrorMv: maxDiff(trajectory(step, fs, 0, 'bank').values, hpStep),
        audit: 'Description says fs <= 0 although false; disabled processing correctly equals HP within Float32 rounding.' },
      !bank.notchActive && maxDiff(trajectory(step, fs, 0, 'bank').values, hpStep) <= 1e-5));
    }
  }
  for (const notchHz of [50, 60]) {
    const bank = new LeadFilterBank(100, 12, { notchHz });
    let error = null;
    try { new Notch(100, notchHz); } catch (e) { error = { name: e.name, message: e.message }; }
    rows.push(passCase(`impossible:100:${notchHz}`, { fs: 100, notchHz, notchActive: bank.notchActive,
      description: bank.description, error, chainLengths: bank.chains.map((c) => c.length) },
    !bank.notchActive && error?.name === 'RangeError' && bank.chains.every((c) => c.length === 1)));
  }
  return rows;
}

// Read primitive detector state AFTER step; no alternate detector, hooks or mutations.
export function detectorSnapshot(d, previousHistory) {
  const slot = (d.idx - 1) % d.bpHist.length;
  const short = d.sumShort / d.winShort, long = d.sumLong / d.winLong;
  const bp = short - long;
  return { short, long, bp, derivative: bp - previousHistory[slot],
    square: d.mwi[(d.idx - 1) % d.mwiLen], mwi: d.mwiSum / d.mwiLen,
    threshold: d.threshold, signalLevel: d.signalLevel, noiseLevel: d.noiseLevel };
}

export async function realCases() {
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const frozen = JSON.parse(await readFile(path.join(root, 'data', 'reports', 'validation.json'), 'utf8'));
  const rows = [];
  for (const [id, windowS] of Object.entries(PROTOCOL.windows)) {
    try {
      const entry = manifest.records.find((e) => e.id === id);
      if (!entry) throw new Error(`Missing manifest entry ${id}`);
      const { rec, headerText, files } = await readLocalRecord(entry);
      const src = new FileSource(rec), fs = src.fs, lead = src.detectionLead;
      const notchHz = manifest.databases[entry.db].mainsHz;
      const pipeline = new SignalPipeline(fs, 12, { notchHz, detectionLead: lead });
      const d = pipeline.detector;
      const trace = Object.fromEntries(['raw', 'hp', 'notch', 'filtered', 'short', 'long', 'bp',
        'derivative', 'square', 'mwi', 'threshold', 'signalLevel', 'noiseLevel'].map((k) => [k, []]));
      const events = [], masks = [];
      let history = Array.from(d.bpHist);
      while (!src.done) {
        const s = src.next(), beforeIdx = d.idx;
        const result = pipeline.step(s);
        if (result.event) events.push({ ...result.event });
        const advanced = d.idx !== beforeIdx;
        if (s.t >= windowS[0] && s.t < windowS[1]) {
          const valid = !(result.mask && result.mask[lead]);
          masks.push(valid);
          let state = advanced ? detectorSnapshot(d, history) : null;
          // On resume, production primes the old derivative history to zero.
          if (advanced && history.resumePending) state = detectorSnapshot(d, new Float32Array(d.bpHist.length));
          const chain = pipeline.filters.chains[lead];
          const vals = { raw: s.leads[lead], hp: chain[0].prevY,
            notch: chain[1] ? chain[1].y1 : chain[0].prevY, filtered: result.filtered[lead], ...state };
          for (const key of Object.keys(trace)) trace[key].push(valid && Number.isFinite(vals[key]) ? vals[key] : NaN);
        }
        history = Array.from(d.bpHist);
        history.resumePending = d.resumePending;
      }
      const unobserved = detectAll(new FileSource(rec), { notchHz, nLeads: 12 }).events;
      const eventsEqual = JSON.stringify(events) === JSON.stringify(unobserved);
      const refs = rec.beats.map((i) => i / fs).filter((t) => t >= 1);
      const dets = events.map((e) => e.t).filter((t) => t >= 1 && t <= refs.at(-1) + 0.15);
      const score = matchBeats(refs, dets, 0.15);
      const r1 = (x) => Math.round(x * 10) / 10, r4 = (x) => Math.round(x * 10000) / 10000;
      const control = { reference: refs.length, tp: score.tp, fp: score.fp, fn: score.fn,
        sensitivity: r4(score.sensitivity), ppv: r4(score.ppv),
        biasMs: r1(score.meanErrorMs), maeMs: r1(score.maeMs) };
      const baseline = frozen.records.find((r) => r.id === id);
      const mismatches = Object.keys(control).filter((key) => control[key] !== baseline?.[key]);
      const unitsKnown = rec.units.every((u) => u.known);
      const summaries = {};
      const upstream = { hp: 'raw', notch: 'hp', filtered: 'notch', short: 'filtered',
        long: 'filtered', bp: 'short', derivative: 'bp', mwi: 'square' };
      for (const [key, values] of Object.entries(trace)) {
        const squared = ['square', 'mwi', 'threshold', 'signalLevel', 'noiseLevel'].includes(key);
        summaries[key] = summarize(values, squared ? 'mV^2 (unnormalized sample difference squared)' : 'mV',
          fs, windowS[0] * fs, upstream[key] ? trace[upstream[key]] : null);
      }
      const windowAvailable = trace.raw.length === (windowS[1] - windowS[0]) * fs && masks.every(Boolean);
      const hashes = Object.fromEntries(Object.entries(files).map(([name, data]) =>
        [name, createHash('sha256').update(Buffer.from(data)).digest('hex')]));
      hashes[entry.files.find((f) => f.endsWith('.hea'))] = createHash('sha256').update(headerText).digest('hex');
      rows.push(passCase(`real:${id}`, { record: id, fs, nSamples: rec.nSamples, notchHz,
        mappedLead: LEAD_NAMES[lead], originalLabel: rec.header.signals[src.mapping[lead]].description,
        mapping: Array.from(src.mapping), availableLeads: src.available, units: rec.units, checksums: rec.checksums,
        missingBySignal: rec.missing, hashes, windowS, windowSamples: [windowS[0] * fs, windowS[1] * fs],
        windowStatus: windowAvailable ? 'available' : 'unavailable: incomplete or masked',
        displayDifference: summarize(trace.raw.map((v, i) => v - trace.filtered[i]), 'mV', fs, windowS[0] * fs),
        stages: summaries, eventsEqual, eventsTotal: events.length, control, frozenControl: baseline,
        referenceMismatches: mismatches,
        detector: { winShortSamples: d.winShort, winLongSamples: d.winLong,
          nominalDerivativeSamples: d.derivLag, effectiveDerivativeSamples: d.bpHist.length,
          effectiveDerivativeS: d.bpHist.length / fs, derivativeScaling: 'bp[n]-bp[n-L], NOT divided by L/fs',
          squareStorage: 'Float32 ring entry after process', mwiSamples: d.mwiLen },
        morphology: 'No beat width/clinical interpretation or aligned view; fixed-window original-clock metrics only.',
      }, eventsEqual && mismatches.length === 0 && windowAvailable && unitsKnown
        && rec.checksums.every((c) => c === true) && Object.values(summaries).every((s) => s.invalid === 0)));
    } catch (e) {
      rows.push({ id: `real:${id}`, record: id, status: 'blocked', error: { name: e.name, message: e.message } });
    }
  }
  return rows;
}

export async function buildCharacterization() {
  const cases = [...linearCases(), ...transientCases(), ...await realCases()];
  const tones = cases.filter((c) => c.id.startsWith('tone:'));
  return { schema: 'openheart3d.ecg.filter-characterization', version: 1,
    protocol: PROTOCOL, codeReference: '0884fd1; production unchanged',
    runtime: { node: process.version, platform: process.platform, arch: process.arch,
      osRelease: release(), cpuModel: cpus()[0]?.model ?? null, logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(), timingOrCost: 'not measured' },
    method: { tone: 'OLS sine/cosine/DC at exact frequency; 120 s, last 60 s; unit input 1 mV',
      phase: 'null when analytical gain <0.01; atan2(sin(delta),cos(delta))',
      transient: 'zero-state independent recurrence; summaries only, no signal dumps',
      observation: 'Read primitive state after SignalPipeline.step; full native replay, no annotations during processing',
      difference: 'same unit, same input clock; transformed content is not automatically noise',
      costs: 'not measured; B04 owns cost/hardware/browser validation' },
    totals: { cases: cases.length, pass: cases.filter((c) => c.status === 'pass').length,
      fail: cases.filter((c) => c.status === 'fail').length, blocked: cases.filter((c) => c.status === 'blocked').length },
    maximumErrors: { gain: Math.max(...tones.map((c) => c.gainError)),
      scalarGain: Math.max(...tones.filter((c) => ['hp', 'notch'].includes(c.stage)).map((c) => c.gainError)),
      cascadeGain: Math.max(...tones.filter((c) => ['bank', 'cascade'].includes(c.stage)).map((c) => c.gainError)),
      phaseRad: Math.max(...tones.map((c) => c.phaseErrorRad ?? 0)),
      residualRms: Math.max(...tones.map((c) => c.measured.residualRms)),
      impulseMv: Math.max(...cases.filter((c) => c.id.startsWith('impulse:')).map((c) => c.maximumErrorMv)) },
    cases };
}
export const serialize = (report) => JSON.stringify(report, null, 2) + '\n';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await buildCharacterization();
  const out = process.argv.indexOf('--output');
  if (out >= 0) {
    if (!process.argv[out + 1]) throw new Error('--output requires a path');
    await writeFile(path.resolve(process.argv[out + 1]), serialize(report));
  } else process.stdout.write(serialize(report));
  if (report.totals.fail || report.totals.blocked) process.exitCode = 1;
}
