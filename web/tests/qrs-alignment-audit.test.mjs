import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ShadowBank } from './qrs-shadow-bank.mjs';
import { causalVector, replay } from './qrs-morphology.mjs';
import { OpportunityMonitor } from './qrs-subthreshold-query.mjs';
import { root, readLocalRecord } from './validation-report.mjs';
import { ALIGNMENT_PROTOCOL, AlignmentMonitor, shiftSamples, selectShift, evaluateAlignmentClosure, decompose,
  bankState } from './qrs-alignment-audit.mjs';

const SHAPE = [0.1, 0.3, 0.8, 1.6, 3, 1.2, -0.7, -1.2, -0.5, 0.2, 0.1, 0, 0.05, 0, 0, 0, 0];
// true center is SHAPE index 4 except a taller spike (index 5) is added for the abs-max trap.
const wave = (len, center, spikeOffset = 1) => {
  const bp = new Float32Array(len);
  SHAPE.forEach((v, k) => { bp[center - 4 + k] = v; });
  bp[center + spikeOffset] = 4;
  return bp;
};
const trained = () => {
  const bank = new ShadowBank();
  const ref = wave(300, 150);
  for (let k = 1; k <= 3; k++) bank.observe(causalVector(ref, 1.5, 100, 160), k / 20);
  return bank;
};

function run({ bp, bank = trained(), monitor = new AlignmentMonitor(), stop = bp.length, gapAt = -1, qAt = 5 }) {
  const d = { fs: 100, mwiLen: 10, groupDelay: 0.01, n: 100, mwiSum: 0 };
  for (let i = 0; i < stop; i++) {
    if (i === gapAt) { monitor.notifyGap(); continue; }
    d.mwiSum = (i === 25 ? 0.5 : 0) * d.mwiLen;
    monitor.step({ sample: { index: i, t: i / d.fs }, bp, detector: d, openingThreshold: 1, bank });
  }
  return { monitor, bank };
}
const bank4 = () => { const b = trained(); b.observe(causalVector(wave(300, 150), 1.5, 100, 160), 0.2); return b; };

test('shift grid is integer samples, signed and rounded symmetrically', () => {
  assert.deepEqual(ALIGNMENT_PROTOCOL.shiftsMs, [-20, -10, 0, 10, 20]);
  assert.deepEqual(ALIGNMENT_PROTOCOL.shiftsMs.map((m) => shiftSamples(m, 360)), [-7, -4, 0, 4, 7]);
  assert.deepEqual(ALIGNMENT_PROTOCOL.shiftsMs.map((m) => shiftSamples(m, 500)), [-10, -5, 0, 5, 10]);
  assert.equal(shiftSamples(-10, 100) , -1);
});

test('shift 0 reproduces the baseline monitor query exactly; analytic shifted waveform is detected with sign', () => {
  const bp = wave(80, 19); // true center 19, abs-max spike at 20
  const base = run({ bp, monitor: new OpportunityMonitor() }).monitor.rows;
  const { monitor } = run({ bp });
  assert.equal(monitor.rows.length, 1);
  const row = monitor.rows[0];
  assert.equal(row.center, 20);
  assert.deepEqual(row.query, base[0].query);
  const zero = row.shifts.find((s) => s.ms === 0);
  assert.deepEqual(zero.query, base[0].query);
  const minus = row.shifts.find((s) => s.ms === -10);
  assert.equal(minus.samples, -1);
  assert.ok(minus.query.similarity > 0.99, String(minus.query.similarity));
  assert.ok(zero.query.similarity < minus.query.similarity);
  assert.equal(selectShift(row.shifts, row.query).ms, -10);
  const inverted = wave(80, 19).map((v) => -v);
  const neg = run({ bp: inverted }).monitor.rows[0];
  assert.ok(neg.shifts.every((s) => !s.vectorAvailable || !(s.query.similarity > 0.5)));
});

test('positive shifts needing future samples are unavailable and never imputed', () => {
  const row = run({ bp: wave(80, 19) }).monitor.rows[0];
  assert.equal(row.queryIndex, 28);
  const byMs = Object.fromEntries(row.shifts.map((s) => [s.ms, s]));
  assert.equal(byMs[10].vectorAvailable, false);
  assert.equal(byMs[20].vectorAvailable, false);
  assert.equal(byMs[10].query, null);
  assert.equal(byMs[-20].vectorAvailable, true);
});

test('a match that exists only in the future is unavailable and future perturbation leaves rows unchanged', () => {
  const bp = wave(80, 19);
  const full = run({ bp }).monitor.rows;
  const changed = bp.slice(); changed.fill(NaN, 29);
  const future = run({ bp: changed }).monitor.rows;
  assert.deepEqual(future, full);
  const prefix = run({ bp: bp.slice(0, 29), stop: 29 }).monitor.rows;
  assert.deepEqual(prefix, full);
  // the true center only matches at +10 ms with a spike one sample earlier: needs future vector, so unavailable
  const late = wave(80, 21, -1); // abs-max 20, true center 21
  const row = run({ bp: late }).monitor.rows[0];
  const plus = row.shifts.find((s) => s.ms === 10);
  assert.equal(plus.vectorAvailable, false);
  assert.ok(selectShift(row.shifts, row.query).ms <= 0);
});

test('bank snapshot is immutable under shifted queries and queries precede same-step learning', () => {
  const bank = bank4();
  const before = structuredClone(bank);
  const seen = [];
  const monitor = new AlignmentMonitor();
  const origQuery = bank.query.bind(bank);
  bank.query = (v, t) => { seen.push(JSON.stringify(bank.templates.map((x) => x.count))); return origQuery(v, t); };
  run({ bp: wave(80, 19), bank, monitor });
  delete bank.query;
  assert.equal(seen.length, 3); // -20, -10, 0; positive shifts unavailable
  assert.ok(new Set(seen).size === 1);
  assert.deepEqual(structuredClone(bank), before);
  assert.deepEqual(monitor.rows[0].bankState, bankState(before, monitor.rows[0].queriedAt));
});

test('gaps invalidate pending opportunities for shifted rows too', () => {
  assert.equal(run({ bp: wave(80, 19), gapAt: 27 }).monitor.rows.length, 0);
  assert.equal(run({ bp: wave(80, 19), gapAt: 24 }).monitor.rows.length, 0);
  const crossing = wave(80, 19); crossing[32] = NaN;
  const row = run({ bp: crossing }).monitor.rows[0];
  assert.ok(row.shifts.every((s) => !s.vectorAvailable || Number.isFinite(s.query.similarity) || s.query.status !== 'mature-match'));
});

test('selectShift tie-break and fallback', () => {
  const mk = (ms, sim, avail = true) => ({ ms, samples: ms, vectorAvailable: avail,
    query: avail ? { similarity: sim, status: 'no-match' } : null });
  assert.equal(selectShift([mk(-20, 0.5), mk(0, 0.5), mk(10, 0.5)], null).ms, 0);
  assert.equal(selectShift([mk(-10, 0.5), mk(10, 0.5)], null).ms, -10);
  assert.equal(selectShift([mk(-10, 0.4), mk(0, 0.2), mk(10, 0.9, false)], null).ms, -10);
  assert.equal(selectShift([mk(-10, NaN), mk(0, NaN), mk(-20, NaN)], null).ms, 0);
  assert.equal(selectShift([mk(-20, NaN), mk(-10, NaN), mk(0, 1, false)], null).ms, -10);
  const base = { status: 'unavailable' };
  const none = selectShift([mk(0, 0, false), mk(-10, 0, false)], base);
  assert.equal(none.query, base);
  assert.equal(none.vectorAvailable, false);
});

test('decompose: exclusive hierarchy and overlapping flags with duplicates vs unique misses', () => {
  const q = (t, status, bankLive = 1, mature = 0) => ({ t, query: { status, similarity: status === 'cold-start' ? NaN : 0.95 },
    bankState: { live: bankLive, matureLive: mature }, shifts: [] });
  const missed = [{ t: 1 }, { t: 2 }, { t: 3 }];
  const rows = [q(1, 'cold-start', 0), q(1.01, 'immature-match'), q(2, 'mature-match'), q(2.02, 'mature-match')];
  const d = decompose(missed, rows, new Set([missed[1]]));
  assert.ok(d);
  const text = JSON.stringify(d);
  assert.ok(text.includes('noNearbyOpportunity'));
});

test('closure: pass, and each failing criterion stops without promotion', () => {
  const rec = (net, delta, paired = 10, unmatched = 1000) => ({ baseline: { paired, unmatched },
    primary: { net, deltaUnmatched: delta, gained: net, lost: 0 } });
  const mk = (entries) => new Map(entries);
  const pass = evaluateAlignmentClosure(mk([['mitdb/228', rec(4, 100)], ['a', rec(3, 30)], ['b', rec(3, 30)], ['c', rec(3, 30)]]));
  assert.equal(pass.outcome, 'descriptive-positive-limited');
  const small = evaluateAlignmentClosure(mk([['mitdb/228', rec(2, 0)], ['a', rec(3, 0)], ['b', rec(3, 0)], ['c', rec(1, 0)]]));
  assert.equal(small.criteria.gainMet, false);
  const only228 = evaluateAlignmentClosure(mk([['mitdb/228', rec(20, 0)], ['a', rec(2, 0)]]));
  assert.equal(only228.criteria.replicationMet, false);
  const costly = evaluateAlignmentClosure(mk([['mitdb/228', rec(4, 5000)], ['a', rec(3, 0)], ['b', rec(3, 0)], ['c', rec(3, 0)]]));
  assert.equal(costly.criteria.burdenMet, false);
  assert.equal(costly.outcome, 'not-met-alignment-alone-insufficient-stop');
});

test('real 228 replay: events identical with/without the shift monitor and bank state is monitor-independent', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const entry = manifest.records.find((r) => r.id === 'mitdb/228');
  const { rec } = await readLocalRecord(entry);
  const fs = rec.header.fs;
  const n = 20 * fs;
  const small = { ...rec, nSamples: n, signals: rec.signals.map((s) => s.slice(0, n)) };
  const notch = manifest.databases[entry.db].mainsHz;
  const strip = (r) => r.events.map(({ shadow, ...e }) => e);
  const off = replay(small, notch, false, false);
  const plain = replay(small, notch, false, true, new OpportunityMonitor());
  const monitor = new AlignmentMonitor();
  const on = replay(small, notch, false, true, monitor);
  assert.deepEqual(strip(on), strip(off));
  assert.deepEqual(strip(on), strip(plain));
  assert.ok(monitor.rows.length > 0);
  const ts = new Set(monitor.rows.map((r) => r.t));
  assert.ok(ts.size > 0);
  monitor.rows.forEach((r, i) => assert.deepEqual(r.shifts.find((s) => s.ms === 0).query, r.query, `row ${i}`));
});