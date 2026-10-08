import test from 'node:test';
import assert from 'node:assert/strict';
import { QrsDetector } from '../src/ecg/detector.js';
import { TraceDetector, traceRecord } from './qrs-trace.mjs';

test('observation preserves detector events, levels and gap handling', () => {
  const plain = new QrsDetector(360);
  const traced = new TraceDetector(360, 0, 10);
  for (let i = 0; i < 3600; i++) {
    const t = i / 360;
    const phase = t % 0.8;
    const x = Math.exp(-(((phase - 0.2) / 0.015) ** 2)) - 0.4 * Math.exp(-(((phase - 0.23) / 0.02) ** 2));
    if (i === 1800) assert.deepEqual(traced.notifyGap(t), plain.notifyGap(t));
    assert.deepEqual(traced.process(x, t), plain.process(x, t));
    assert.equal(traced.threshold, plain.threshold);
    assert.equal(traced.noiseLevel, plain.noiseLevel);
  }
  assert.ok(traced.closed.length > 0);
  assert.ok(traced.emitted.length > 0);
});

test('228 trace uses MLII and reproduces the unmodified baseline', async () => {
  const trace = await traceRecord('mitdb/228', 383.4, 495.2);
  assert.equal(trace.lead, 'II');
  assert.equal(trace.signalIndex, 0);
  assert.equal(trace.signal, 'MLII');
  assert.deepEqual(trace.score, { tp: 1700, fp: 9, fn: 352 });
  const normal = trace.beats.filter((b) => b.symbol === 'N');
  const missed = normal.filter((b) => !b.detectedNearby);
  assert.equal(normal.length, 89);
  assert.equal(missed.length, 88);
  assert.equal(missed.filter((b) => b.max.feat <= b.max.halfThreshold).length, 86);
  assert.equal(missed.filter((b) => !b.candidates.length).length, 86);
  assert.ok(missed.every((b) => b.max.sinceLast > 0.22));
  assert.ok(trace.beats.filter((b) => b.symbol === 'V').every((b) => b.detectedNearby));
  assert.ok(trace.samples.every((s) => Number.isFinite(s.feat)));
});

test('second 228 episode reproduces subthreshold N and weak candidates', async () => {
  const trace = await traceRecord('mitdb/228', 513.2, 628.2);
  const normal = trace.beats.filter((b) => b.symbol === 'N');
  const missed = normal.filter((b) => !b.detectedNearby);
  assert.equal(normal.length, 108);
  assert.equal(missed.length, 101);
  assert.equal(missed.filter((b) => b.max.feat <= b.max.halfThreshold).length, 76);
  assert.equal(missed.filter((b) => b.candidates.some((c) => !c.strong)).length, 25);
  assert.ok(missed.every((b) => b.max.sinceLast > 0.22));
});

test('trace rejects unknown records and invalid intervals', async () => {
  await assert.rejects(traceRecord('unknown', 1, 2), /Unknown record/);
  await assert.rejects(traceRecord('mitdb/228', 5, 4), RangeError);
});
