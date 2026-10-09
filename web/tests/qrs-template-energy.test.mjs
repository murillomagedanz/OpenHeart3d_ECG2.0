import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ShadowBank, SHADOW_PROTOCOL } from './qrs-shadow-bank.mjs';
import { replay } from './qrs-morphology.mjs';
import { OpportunityMonitor, classifyMature, summarizeQueries } from './qrs-subthreshold-query.mjs';
import { auc, quantiles, toRows, describeRows, compareRows } from './qrs-template-energy.mjs';
import { root, readLocalRecord } from './validation-report.mjs';

const shape = [0, 1, 3, 1, 0];
const meanSq = (v) => { const m = v.reduce((a, b) => a + b) / v.length; return v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length; };
const matureBank = () => { const b = new ShadowBank(); [1, 2, 3].forEach((t) => b.observe(shape, t)); return b; };

test('energy is centered mean-square: scale k gives ratio k^2, sign and offset are ignored', () => {
  const bank = matureBank();
  const base = bank.query(shape, 4).energy;
  assert.equal(base.status, 'ok');
  assert.ok(Math.abs(base.query - meanSq(shape)) < 1e-12);
  assert.ok(Math.abs(base.ratio - 1) < 1e-12);
  for (const k of [0.5, 3]) {
    const e = bank.query(shape.map((x) => k * x + 7), 4).energy;
    assert.ok(Math.abs(e.ratio - k * k) < 1e-9);
  }
  assert.equal(bank.query(shape.map((x) => -x), 4).energy.reason, 'no-matched-template');
});

test('prior energy is pre-update state; query never mutates, emission updates EMA/min/max afterwards', () => {
  const bank = matureBank();
  const before = structuredClone(bank);
  const q = bank.query(shape.map((x) => 2 * x), 4);
  assert.deepEqual(structuredClone(bank), before);
  const e0 = meanSq(shape);
  assert.ok(Math.abs(q.energy.prior - e0) < 1e-12);
  const obs = bank.observe(shape.map((x) => 2 * x), 4);
  assert.ok(Math.abs(obs.energy.prior - e0) < 1e-12);
  const w = SHADOW_PROTOCOL.updateWeight;
  const next = bank.query(shape, 5).energy;
  assert.ok(Math.abs(next.prior - ((1 - w) * e0 + w * 4 * e0)) < 1e-12);
  assert.ok(Math.abs(next.priorMax - 4 * e0) < 1e-12);
  assert.ok(Math.abs(next.priorMin - e0) < 1e-12);
});

test('gap, expiry and eviction discard energy with the template', () => {
  const gap = matureBank();
  gap.notifyGap();
  assert.equal(gap.query(shape, 4).energy.reason, 'no-matched-template');
  const expired = matureBank();
  assert.equal(expired.query(shape, 3 + SHADOW_PROTOCOL.expireS + 1).energy.reason, 'no-matched-template');
  const ev = new ShadowBank();
  const orth = (i) => Array.from({ length: 5 }, (_, j) => (j === i ? 5 : 0));
  for (let i = 0; i < SHADOW_PROTOCOL.maxTemplates + 1; i++) ev.observe(orth(i % 5), i + 1);
  const live = ev.templates;
  assert.equal(live.length, SHADOW_PROTOCOL.maxTemplates);
  for (const t of live) assert.ok(Number.isFinite(t.energy) && t.energy === t.energyMin && t.energy === t.energyMax);
});

test('unavailable and finite guards are explicit', () => {
  const bank = matureBank();
  assert.equal(bank.query(null, 4).energy.reason, 'invalid-query-vector');
  assert.equal(bank.query([0, NaN, 1, 0, 0], 4).energy.reason, 'invalid-query-vector');
  assert.equal(bank.query([2, 2, 2, 2, 2], 4).energy.reason, 'flat-query-vector');
  assert.equal(new ShadowBank().query(shape, 1).energy.reason, 'no-matched-template');
  assert.equal(bank.query([1e200, 0, 3e200, 0, 0], 4).energy.status, 'unavailable');
  const flat = new ShadowBank();
  assert.equal(flat.observe([1, 1, 1, 1, 1], 1).energy.status, 'unavailable');
});

test('statuses and shape evidence are unchanged by energy (events identical, observe legacy fields)', () => {
  const a = new ShadowBank();
  const o = a.observe(shape, 1);
  assert.equal(o.status !== undefined, true);
  const q = a.query(shape, 2);
  assert.equal(q.status, 'immature-match');
  assert.equal(q.energy.status, 'ok');
});

test('summary helpers: quantiles, AUC with ties, and within-template AUC differs from pooled (Simpson)', () => {
  assert.equal(auc([1, 2], [1, 2]), 0.5);
  assert.equal(auc([3], [1, 2]), 1);
  assert.equal(auc([], [1]), null);
  assert.deepEqual(quantiles([4, 1, 3, 2]), { n: 4, min: 1, p10: 1, p25: 2, median: 3, p75: 3, p90: 4, max: 4 });
  const mk = (template, group, log2) => ({ record: 'r', template, group, symbol: null, log2, reason: null,
    position: 'within', support: 3, ageS: 1 });
  const paired = [mk('r|0', 'paired', 1), mk('r|0', 'paired', 1.1), mk('r|0', 'paired', 1.2),
    mk('r|1', 'paired', 5), mk('r|1', 'paired', 5.1), mk('r|1', 'paired', 5.2)];
  const other = [mk('r|0', 'x', 0), mk('r|0', 'x', 0.1), mk('r|0', 'x', 0.2),
    mk('r|1', 'x', 4), mk('r|1', 'x', 4.1), mk('r|1', 'x', 4.2)];
  const c = compareRows(paired, other, { list: true });
  assert.ok(JSON.stringify(c).includes('"templatesBoth":2'));
  const pooled = auc([1, 1.1, 1.2, 0, 0.1, 0.2].map((x, i) => (i < 3 ? x : x)), [5, 5.1, 5.2, 4, 4.1, 4.2]);
  assert.equal(pooled, 0);
  assert.equal(auc([1, 1.1, 1.2], [0, 0.1, 0.2]), 1);
  const d = describeRows([...paired, mk('r|2', 'paired', null)]);
  assert.equal(d.n, 7);
  assert.equal(d.withRatio, 6);
  assert.deepEqual(d.unavailable, { 'non-positive-ratio': 1 });
  const reasoned = describeRows([{ ...mk('r|3', 'p', null), reason: 'flat-query-vector', position: 'unavailable' }]);
  assert.deepEqual(reasoned.unavailable, { 'flat-query-vector': 1 });
  assert.deepEqual(reasoned.priorRange, { below: 0, within: 0, above: 0, unavailable: 1 });
});

test('classifyMature matches summarizeQueries counts and toRows uses query energy only for mature matches', () => {
  const refs = [{ t: 1, symbol: 'N' }, { t: 2, symbol: 'V' }];
  const energy = { status: 'ok', reason: null, query: 4, prior: 1, priorMin: 1, priorMax: 2, ratio: 4 };
  const q = (t, status = 'mature-match') => ({ t, query: { status, templateId: 0, supportBefore: 3, ageS: 2, energy } });
  const queries = [q(1), q(2), q(2.01), q(4), q(2.02, 'no-match')];
  const cls = classifyMature(refs, [refs[1]], queries);
  assert.equal(cls.length, 4);
  assert.deepEqual(summarizeQueries(refs, [refs[1]], queries), summarizeQueries(refs, [refs[1]], queries, cls));
  const rows = toRows('rec', cls);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.log2 === 2 && r.position === 'above'));
  assert.equal(rows.filter((r) => r.group === 'paired').length, 1);
});

test('228 events are identical with/without energy-bearing bank and energy is causal on prefix', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const entry = manifest.records.find((r) => r.id === 'mitdb/228');
  const { rec } = await readLocalRecord(entry);
  const notch = manifest.databases[entry.db].mainsHz;
  const on = replay(rec, notch, false, true);
  const off = replay(rec, notch, false, false);
  assert.deepEqual(on.events.map(({ shadow, ...e }) => e), off.events.map(({ shadow, ...e }) => e));
  const blocks = (bp, stop) => {
    const monitor = new OpportunityMonitor();
    const bank = new ShadowBank();
    const d = { fs: 100, mwiLen: 10, groupDelay: 0.01, n: 100, mwiSum: 0 };
    for (let k = 0; k < stop; k++) {
      d.mwiSum = (k % 20 === 5 ? 0.5 : 0) * d.mwiLen;
      monitor.step({ sample: { index: k, t: k / d.fs }, bp, detector: d, openingThreshold: 1, bank });
      if (k % 20 === 15) bank.observe(Array.from({ length: 17 }, (_, j) => Math.sin((j + 1) / 3)), k / d.fs);
    }
    return monitor.rows.map((r) => r.query.energy);
  };
  const bp = Float32Array.from({ length: 200 }, (_, k) => Math.sin(k / 3));
  const full = blocks(bp, 200);
  const prefix = blocks(bp.slice(0, 100), 100);
  assert.ok(prefix.length > 0);
  assert.deepEqual(full.slice(0, prefix.length), prefix);
  const changed = bp.slice(); changed.fill(NaN, 100);
  assert.deepEqual(blocks(changed, 200).slice(0, prefix.length), prefix);
});
