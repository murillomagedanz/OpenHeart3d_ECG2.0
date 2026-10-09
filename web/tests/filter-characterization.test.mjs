import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './validation-report.mjs';
import { QrsDetector } from '../src/ecg/detector.js';
import { SignalPipeline } from '../src/ecg/pipeline.js';
import { PROTOCOL, wrapPhase, coefficients, response, estimateTone, sine, trajectory,
  referenceImpulse, summarize, transientCases, detectorSnapshot, buildCharacterization, serialize } from './filter-characterization.mjs';

test('Exact-frequency sine/cosine/DC estimator recovers known gain, phase and offset', () => {
  for (const fs of PROTOCOL.fs) for (const f of [0.1, 0.25, 49, 50, 60, 100]) {
    for (const phase of [-3.13, -0.7, 0, 1.7, 3.13]) {
      const y = Float64Array.from({ length: fs * 120 },
        (_, i) => 0.73 * Math.sin(2 * Math.PI * f * i / fs + phase) + 0.17);
      const result = estimateTone(y, fs, f, fs * 60);
      assert.ok(Math.abs(result.gain - 0.73) < 1e-10);
      assert.ok(Math.abs(wrapPhase(result.phaseRad - phase)) < 1e-10);
      assert.ok(Math.abs(result.dcMv - 0.17) < 1e-10);
      assert.ok(result.residualRms < 1e-10);
    }
  }
});
test('Circular phase, exact zero and analytical notch null phase policy', () => {
  assert.ok(Math.abs(wrapPhase(-Math.PI + 0.01 - (Math.PI - 0.01)) - 0.02) < 1e-12);
  const zero = estimateTone(new Float64Array(1000), 500, 50, 0, false);
  assert.equal(zero.phaseRad, null);
  assert.equal(zero.gainDb, null);
  assert.equal(zero.residualRms, 0);
  for (const fs of PROTOCOL.fs) for (const hz of [50, 60]) {
    const expected = response(fs, hz, 'notch', hz);
    assert.ok(expected.gain < 0.01);
    assert.equal(expected.phaseRad, null);
    const fitted = estimateTone(trajectory(sine(fs, hz, 120), fs, hz, 'notch').values,
      fs, hz, fs * 60, expected.phaseRad !== null);
    assert.equal(fitted.phaseRad, null);
  }
  assert.throws(() => estimateTone(new Float64Array(10), 500, 0), RangeError);
});
test('Independent recurrence matches impulse and analytical HP limit; no production coefficients reused', () => {
  for (const fs of PROTOCOL.fs) for (const hz of PROTOCOL.notchHz) {
    const input = new Float64Array(fs * 20); input[0] = 1;
    const c = coefficients(fs, hz);
    assert.ok(Math.abs(c.alpha - 1 / (1 + 2 * Math.PI * 0.5 / fs)) < 1e-15);
    assert.equal(response(fs, 0, 'hp').gain, 0);
    for (const stage of ['hp', 'cascade', 'bank', ...(hz ? ['notch'] : [])]) {
      const actual = trajectory(input, fs, hz, stage);
      const expected = referenceImpulse(fs, hz, input.length, stage);
      for (let i = 0; i < input.length; i++) {
        assert.ok(Math.abs(actual.values[i] - expected[i]) <= (stage === 'bank' ? 1e-5 : 1e-6));
      }
      assert.equal(actual.parityError, 0);
    }
  }
});
test('Frozen transients assert descriptive startup, explicit prime, three-second gap and actual limit errors', () => {
  const cases = transientCases();
  assert.equal(cases.length, 44);
  assert.ok(cases.every((c) => c.status === 'pass'));
  for (const c of cases.filter((c) => c.id.startsWith('startup:'))) {
    assert.equal(c.automaticallyPrimed, false);
    assert.ok(c.stages.bank.firstMv > 0);
  }
  for (const c of cases.filter((c) => c.id.startsWith('prime-gap:'))) {
    assert.equal(c.gapStateUnchanged, true);
    assert.equal(c.heldOutput, true);
    assert.equal(c.masksPreserved, true);
    assert.equal(c.gapDurationS, 3);
    assert.equal(c.resumeMv, 0);
    assert.equal(c.explicitBankPrimeMaxMv, 0);
  }
  for (const c of cases.filter((c) => c.id.startsWith('impossible:'))) assert.equal(c.error.name, 'RangeError');
});
test('Detector primitive-state probe matches production square storage and MWI, has no side effects', () => {
  for (const fs of PROTOCOL.fs) {
    const p = new SignalPipeline(fs, 12, { notchHz: 50 });
    let history = Array.from(p.detector.bpHist);
    const beforeGap = new QrsDetector(fs);
    assert.equal(beforeGap.bpHist.length, Math.round(0.01 * fs) + 1);
    for (let i = 0; i < fs * 2; i++) {
      const x = Math.sin(i * 0.3) * 0.4;
      p.step({ t: i / fs, leads: new Float32Array(12).fill(x) });
      const before = JSON.stringify(p.detector);
      const state = detectorSnapshot(p.detector, history);
      assert.equal(state.square, Math.fround(state.derivative ** 2));
      assert.equal(state.mwi, p.detector.mwiSum / p.detector.mwiLen);
      assert.equal(JSON.stringify(p.detector), before);
      history = Array.from(p.detector.bpHist);
    }
  }
});
test('Masked values excluded, original-clock coordinates and same-unit differences are explicit', () => {
  const result = summarize([1, NaN, -2], 'mV', 500, 500, [0, NaN, 0]);
  assert.equal(result.finite, 2);
  assert.equal(result.invalid, 1);
  assert.equal(result.peakIndex, 502);
  assert.equal(result.peakTimeS, 1.004);
  assert.equal(result.differenceRms, null);
  assert.equal(summarize([2, 3], 'mV^2', 500).differenceRms, null);
  assert.deepEqual(sine(360, 0.25, 120), sine(360, 0.25, 120));
});
test('Every frozen case passes unchanged numerical gates, observed events/scores; report repeats byte-identically', async () => {
  const report = await buildCharacterization();
  assert.deepEqual(report.totals, { cases: 319, pass: 319, fail: 0, blocked: 0 });
  assert.equal(report.cases.filter((c) => c.id.startsWith('tone:')).length, 270);
  for (const c of report.cases.filter((c) => c.id.startsWith('tone:'))) {
    assert.ok(c.gainError <= c.gainTolerance, c.id);
    assert.ok(c.phaseErrorRad === null || c.phaseErrorRad <= 0.02, c.id);
    assert.ok(c.measured.residualRms <= 0.002, c.id);
    if (c.analytic.gain < 0.01) assert.equal(c.measured.phaseRad, null, c.id);
  }
  for (const c of report.cases.filter((c) => c.id.startsWith('real:'))) {
    assert.equal(c.eventsEqual, true, c.id);
    assert.deepEqual(c.referenceMismatches, [], c.id);
    assert.equal(c.windowStatus, 'available', c.id);
    assert.ok(Object.values(c.stages).every((s) => s.invalid === 0));
    assert.ok(c.stages.square.unit.startsWith('mV^2'));
    assert.equal(c.stages.derivative.unit, 'mV');
  }
  const regenerated = serialize(await buildCharacterization());
  assert.equal(serialize(report), regenerated);
  const saved = await readFile(path.join(root, '..', 'docs', 'base', '10-resultados-caracterizacao-filtros.json'), 'utf8');
  // Runtime describes the measurement host, not a cross-host acceptance gate.
  const artifact = JSON.parse(saved);
  const current = { ...report, runtime: artifact.runtime };
  assert.equal(serialize(current), saved);
});
