import test from 'node:test';
import assert from 'node:assert/strict';
import { CappedLevelDetector } from './qrs-capped-level.mjs';
import { compareRecords, promotionGate, falsePositiveTiming } from './qrs-experiment.mjs';

test('cap limits learning contribution without modifying peak or candidate', () => {
  const d = new CappedLevelDetector(360, 2);
  d.signalLevel = 1;
  d.noiseLevel = 0.1;
  const c = { maxFeat: 10, peakT: 2 };
  const event = d._emit(c, 0.125, 2.1, false);
  assert.equal(d.signalLevel, 1.125);
  assert.equal(c.maxFeat, 10);
  assert.equal(event.t, 2 - d.groupDelay);
  assert.equal(d.cappedUpdates, 1);
});

test('low-energy learning remains unchanged and invalid caps are rejected', () => {
  const d = new CappedLevelDetector(360);
  d.signalLevel = 1;
  d._emit({ maxFeat: 0.5, peakT: 2 }, 0.125, 2.1, false);
  assert.equal(d.signalLevel, 0.9375);
  assert.equal(d.cappedUpdates, 0);
  for (const cap of [0, -1, NaN, Infinity]) {
    assert.throws(() => new CappedLevelDetector(360, cap), RangeError);
  }
});

test('gap clears backup and resets buffers without a learning update across the gap', () => {
  const d = new CappedLevelDetector(360);
  d.signalLevel = 1;
  d.noiseLevel = 0.1;
  d.backup = { maxFeat: 0.3, peakT: 2 };
  d.lastPeakT = 1;
  assert.equal(d.notifyGap(3), null);
  assert.equal(d.backup, null);
  assert.equal(d.signalLevel, 1);
  assert.equal(d.noiseLevel, 0.1);
  d.process(0.2, 4);
  assert.equal(d.resumePending, false);
  const event = d._emit({ maxFeat: 0.5, peakT: 5 }, 0.125, 5.1, false);
  assert.equal(event.rr, null);
  assert.deepEqual(d.rr, []);
});

test('cap 2 recovers N in 228 but fails the frozen false-positive gate', async () => {
  const r = await compareRecords(['mitdb/228'], { detectorFactory: (fs) => new CappedLevelDetector(fs) });
  const focus = r.focusedRecords[0];
  assert.deepEqual([focus.experiment.tp, focus.experiment.fp, focus.experiment.fn], [2044, 48, 8]);
  assert.deepEqual(focus.experiment.falsePositiveTiming, {
    n: 48, within400msOfPreviousReference: 41, searchBack: 11,
  });
  assert.equal(r.focusPass, false);
  assert.equal(r.complete, false);
  assert.equal(r.pilotPass, false);
});

test('FP timing follows greedy matching, including before and after reference window', () => {
  assert.deepEqual(falsePositiveTiming([1, 2], [
    { t: 0.5 }, { t: 1.05 }, { t: 1.25, searchBack: true }, { t: 2 }, { t: 2.5 },
  ]), { n: 3, within400msOfPreviousReference: 1, searchBack: 1 });
  assert.deepEqual(falsePositiveTiming([], [{ t: 1 }]),
    { n: 1, within400msOfPreviousReference: 0, searchBack: 0 });
});

test('promotion gate rejects incomplete sets and database regressions', () => {
  const rows = [{ id: 'mitdb/228', db: 'mitdb', baseline: { tp: 1700, fp: 9, fn: 352 },
    experiment: { tp: 2000, fp: 10, fn: 52 } }];
  assert.equal(promotionGate(rows, false).pilotPass, false);
  assert.equal(promotionGate(rows, true).pilotPass, true);
  rows.push({ id: 'ludb/1', db: 'ludb', baseline: { tp: 100, fp: 0, fn: 0 },
    experiment: { tp: 100, fp: 1, fn: 0 } });
  assert.equal(promotionGate(rows, true).databasePass, false);
});

test('experiment fails explicitly on unknown record selection', async () => {
  await assert.rejects(compareRecords(['unknown'], {}), /Unknown or unbundled/);
});
