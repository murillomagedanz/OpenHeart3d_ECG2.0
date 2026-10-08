import test from 'node:test';
import assert from 'node:assert/strict';
import { localShape, correlation, labelEvents, investigateMorphology } from './qrs-morphology.mjs';

test('event labels preserve temporal greedy pairing rather than nearest match', () => {
  const refs = [{ t: 1, symbol: 'N' }, { t: 1.2, symbol: 'V' }];
  const labels = labelEvents(refs, [{ t: 1.3 }, { t: 1.1 }, { t: 0.5 }]);
  assert.equal(labels[0].reference, null);
  assert.equal(labels[1].reference, refs[0]);
  assert.equal(labels[2].reference, refs[1]);
});

test('shape measures slope and half width independent of polarity', () => {
  const signal = new Float32Array(1000);
  for (let i = 480; i <= 520; i++) signal[i] = 1 - Math.abs(i - 500) / 20;
  const a = localShape(signal, 0.5, 1000);
  const b = localShape(signal.map((x) => -x), 0.5, 1000);
  assert.equal(a.amplitudeMv, 1);
  assert.equal(a.halfWidthMs, 19);
  assert.equal(a.widthCensored, false);
  assert.equal(a.slopeMvPerS, b.slopeMvPerS);
  assert.equal(a.halfWidthMs, b.halfWidthMs);
  assert.ok(Math.abs(correlation(a.vector, b.vector) + 1) < 1e-10);
  assert.equal(correlation([0, 0], [1, 1]), null);
});

test('missing data and incomplete windows have no fabricated measurements', () => {
  const signal = new Float32Array(1000).fill(1);
  assert.equal(localShape(signal, 0, 1000), null);
  assert.equal(localShape(signal, 0.5, 1000).widthCensored, true);
  signal[500] = NaN;
  assert.equal(localShape(signal, 0.5, 1000), null);
});

test('228 morphology reproduces baseline, cap pilot and observational screen', async () => {
  const r = await investigateMorphology('mitdb/228');
  assert.equal(r.lead, 'II');
  assert.equal(r.signalIndex, 0);
  assert.deepEqual(r.baseline, { tp: 1700, fp: 9, fn: 352 });
  assert.deepEqual(r.pilot, { tp: 2044, fp: 48, fn: 8 });
  assert.equal(r.groups.recoveredN.n, 341);
  assert.equal(r.groups.fp.n, 48);
  assert.equal(r.screen.flaggedFp, 36);
  assert.equal(r.screen.flaggedTp, 0);
  assert.equal(r.screen.flaggedRecoveredN, 0);
});

test('fixed slope screen also flags real beats in 210, so is not a safe classifier', async () => {
  const r = await investigateMorphology('mitdb/210');
  assert.equal(r.screen.flaggedTp, 3);
  assert.equal(r.screen.flaggedFp, 0);
});
