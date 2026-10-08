import test from 'node:test';
import assert from 'node:assert/strict';
import { ShadowBank, SHADOW_PROTOCOL } from './qrs-shadow-bank.mjs';
import { investigateMorphology } from './qrs-morphology.mjs';

test('shadow matches signed normalized shape and reports pre-update maturity', () => {
  const bank = new ShadowBank();
  const vector = [0, 1, 3, 1, 0];
  assert.equal(bank.observe(vector, 1).status, 'created');
  assert.equal(bank.observe(vector.map((x) => x * 2 + 10), 2).matureBefore, false);
  assert.equal(bank.observe(vector, 3).matureBefore, false);
  assert.equal(bank.observe(vector, 4).matureBefore, true);
  assert.equal(bank.observe(vector.map((x) => -x), 5).status, 'created');
  assert.equal(bank.templates.length, 2);
});

test('shadow does not learn missing, flat or invalid vectors', () => {
  const bank = new ShadowBank();
  for (const vector of [null, [0, 0], [1, NaN], [Infinity, 0]]) {
    assert.equal(bank.observe(vector, 1).status, 'unavailable');
  }
  assert.equal(bank.templates.length, 0);
  assert.throws(() => bank.observe([0, 1], 0), RangeError);
});

test('memory is bounded, expires and is cleared at gaps', () => {
  const bank = new ShadowBank();
  for (let i = 0; i < 6; i++) {
    const vector = new Array(8).fill(0);
    vector[i] = 1;
    bank.observe(vector, i);
  }
  assert.equal(bank.templates.length, SHADOW_PROTOCOL.maxTemplates);
  assert.equal(bank.evicted, 2);
  bank.observe([1, 0, 0, 0, 0, 0, 0, 0], 40);
  assert.equal(bank.expired, 4);
  bank.notifyGap();
  assert.equal(bank.templates.length, 0);
  assert.equal(bank.gaps, 1);
});

test('228 shadow cannot alter emitted events, scores or causal measurements', async () => {
  const on = await investigateMorphology('mitdb/228');
  const off = await investigateMorphology('mitdb/228', { shadowEnabled: false });
  assert.deepEqual(on.baseline, off.baseline);
  assert.deepEqual(on.pilot, off.pilot);
  assert.deepEqual(on.events.map(({ shadow, ...event }) => event),
    off.events.map(({ shadow, ...event }) => event));
  assert.ok(on.shadow.cap2.active <= 4);
  assert.ok(on.shadow.cap2.unavailable > 0);
  assert.equal(on.shadow.cap2.matureRecoveredN, 240);
  assert.equal(on.shadow.cap2.matureFp, 1);
});

test('recurring FP mature while rare ventricular counterexamples do not', async () => {
  const noise = await investigateMorphology('mitdb/108');
  const ventricular = await investigateMorphology('mitdb/210');
  assert.equal(noise.shadow.cap2.matureFp, 79);
  assert.equal(ventricular.shadow.ventricularCounterexamples.length, 3);
  assert.ok(ventricular.shadow.ventricularCounterexamples.every((e) => !e.shadow.matureBefore));
});
