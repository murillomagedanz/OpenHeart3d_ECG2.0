import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ShadowBank } from './qrs-shadow-bank.mjs';
import { causalVector, replay } from './qrs-morphology.mjs';
import { OpportunityMonitor, summarizeQueries, investigateQueries } from './qrs-subthreshold-query.mjs';
import { root, readLocalRecord } from './validation-report.mjs';

test('queries are deeply immutable, signed, pre-observation and age filtered without expiry', () => {
  const bank = new ShadowBank();
  const v = [0, 1, 3, 1, 0];
  bank.observe(v, 1);
  bank.observe(v, 2);
  bank.observe(v, 3);
  const before = structuredClone(bank);
  assert.equal(bank.query(v, 3).status, 'cold-start');
  assert.equal(bank.query(v, 4).status, 'mature-match');
  assert.equal(bank.query(v.map((x) => 4 * x + 2), 4).status, 'mature-match');
  assert.equal(bank.query(v.map((x) => -x), 4).status, 'no-match');
  assert.equal(bank.query(v, 33).status, 'mature-match');
  assert.equal(bank.query(v, 33.001).status, 'cold-start');
  assert.equal(bank.query(v, 1000).status, 'cold-start');
  for (const vector of [null, [0, 0], [0, NaN], [0, Infinity]]) {
    assert.equal(bank.query(vector, 4).status, 'unavailable');
  }
  assert.throws(() => bank.query([0, 1], 4), /dimension/);
  assert.throws(() => bank.query(v, 2), RangeError);
  assert.throws(() => bank.query(v, NaN), RangeError);
  assert.deepEqual(structuredClone(bank), before);
  assert.equal(bank.observe(v, 4).matureBefore, true); // queries did not move lastTime
  const cold = new ShadowBank();
  assert.equal(cold.query(v, 1).status, 'cold-start');
  cold.observe(v, 1);
  assert.equal(cold.query(v, 2).status, 'immature-match');
});

function runFrames({ bp, features, thresholds = features.map(() => 1), gapAt = -1, stop = features.length }) {
  const monitor = new OpportunityMonitor();
  const bank = new ShadowBank();
  const d = { fs: 100, mwiLen: 10, groupDelay: 0.01, n: 100, mwiSum: 0 };
  for (let i = 0; i < stop; i++) {
    if (i === gapAt) { monitor.notifyGap(); bank.notifyGap(); continue; }
    d.mwiSum = features[i] * d.mwiLen;
    monitor.step({ sample: { index: i, t: i / d.fs }, bp, detector: d,
      openingThreshold: thresholds[i], bank });
  }
  return monitor;
}

test('enumeration is sub-opening signal maxima with frozen causal alignment/timing', () => {
  const bp = new Float32Array(80);
  bp[20] = 2;
  bp[22] = 2; // earliest absolute tie, not correlation-maximizing alignment
  const features = new Array(80).fill(0);
  features[25] = 0.5; features[26] = 0.5;
  features[45] = 2; // above opening: not enumerated
  const r = runFrames({ bp, features });
  assert.equal(r.enumerated, 1);
  assert.equal(r.rows[0].center, 20);
  assert.equal(r.rows[0].peakT, 0.25);
  assert.equal(r.rows[0].queriedAt, 0.28);
  assert.equal(r.rows[0].query.status, 'cold-start');
  const thresholds = new Array(80).fill(0.1);
  thresholds[25] = 0.5; // threshold at peak, not later changed threshold
  assert.equal(runFrames({ bp, features, thresholds }).enumerated, 1);
});

test('complete vector and opportunities are causal under prefix/future perturbation', () => {
  const bp = Float32Array.from({ length: 80 }, (_, i) => Math.sin(i / 3));
  const features = new Array(80).fill(0);
  features[25] = 0.5;
  const prefix = runFrames({ bp: bp.slice(0, 40), features, stop: 40 });
  const full = runFrames({ bp, features });
  assert.deepEqual(full.rows.filter((r) => r.queriedAt < 0.4), prefix.rows);
  const changed = bp.slice(); changed.fill(NaN, 40);
  const changedFeatures = [...features]; changedFeatures.fill(0.9, 40);
  assert.deepEqual(runFrames({ bp: changed, features: changedFeatures }).rows
    .filter((r) => r.queriedAt < 0.4), prefix.rows);
  const vector = causalVector(bp, 0.2, 100, 28);
  assert.deepEqual(vector, causalVector(bp.slice(0, 29), 0.2, 100, 28));
  assert.equal(causalVector(bp, 0.2, 100, 27), null);
});

test('gaps invalidate pending maxima, reset local history and reject crossing vectors', () => {
  const bp = new Float32Array(80); bp[25] = 1;
  const features = new Array(80).fill(0); features[25] = 0.5;
  const pending = runFrames({ bp, features, stop: 27 });
  assert.equal(pending.pending.length, 1);
  pending.notifyGap();
  assert.equal(pending.invalidated, 1);
  assert.equal(pending.pending.length, 0);
  assert.equal(pending.history.length, 0);
  assert.equal(runFrames({ bp, features, gapAt: 27 }).rows.length, 0);
  assert.equal(runFrames({ bp, features, gapAt: 24 }).rows.length, 0);
  const crossing = bp.slice(); crossing[32] = NaN;
  assert.equal(runFrames({ bp: crossing, features }).rows[0].query.status, 'unavailable');
  crossing[20] = NaN;
  assert.equal(causalVector(crossing, 0.25, 100, 33), null);
});

test('posthoc counts separate duplicate/retained neighborhoods from unique baseline misses', () => {
  const refs = [{ t: 1, symbol: 'N' }, { t: 2, symbol: 'V' }];
  const q = (t, status = 'mature-match') => ({ t, query: { status } });
  const r = summarizeQueries(refs, [refs[1]], [q(1), q(2), q(2.01), q(4), q(2.02, 'no-match')]);
  assert.equal(r.rawReferenceNearby, 4);
  assert.equal(r.uniqueMissedNearby, 1);
  assert.equal(r.maturePairedMisses, 1);
  assert.deepEqual(r.maturePairedMissSymbols, { V: 1 });
  assert.equal(r.matureUnmatched, 3);
  assert.deepEqual(r.matureUnmatchedStrata, {
    duplicateMissNeighborhood: 1, alreadyDetectedNeighborhood: 1, noReferenceNeighborhood: 1,
  });
});

test('replay hook queries before same-step learning; annotations and query toggle cannot affect events', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const entry = manifest.records.find((r) => r.id === 'mitdb/228');
  const { rec } = await readLocalRecord(entry);
  const notch = manifest.databases[entry.db].mainsHz;
  for (const capped of [false, true]) {
    let bankAtStep;
    let steps = 0;
    const hook = {
      notifyGap() {},
      step({ bank, sample }) {
        steps++;
        assert.ok(bank.lastTime < sample.t);
        if (bankAtStep) assert.equal(bank, bankAtStep);
        bankAtStep = bank;
      },
    };
    const on = replay(rec, notch, capped, true, hook);
    assert.equal(steps, rec.nSamples);
    const off = replay(rec, notch, capped, false);
    assert.deepEqual(on.events.map(({ shadow, ...e }) => e), off.events.map(({ shadow, ...e }) => e));
    const a = new OpportunityMonitor();
    const b = new OpportunityMonitor();
    replay(rec, notch, capped, true, a);
    replay({ ...rec, annotations: [], beats: [] }, notch, capped, true, b);
    assert.deepEqual(a.rows, b.rows);
  }
});

test('228 runner preserves frozen original/cap2 and exposes incremental miss-only query coverage', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const frozen = JSON.parse(await readFile(path.join(root, 'data', 'reports', 'validation.json'), 'utf8'));
  const r = await investigateQueries(manifest.records.find((r) => r.id === 'mitdb/228'), manifest,
    frozen.records.find((r) => r.id === 'mitdb/228'));
  assert.deepEqual(r.banks.control.emitted, { tp: 1700, fp: 9, fn: 352 });
  assert.deepEqual(r.banks.cap2.emitted, { tp: 2044, fp: 48, fn: 8 });
  for (const bank of Object.values(r.banks)) {
    assert.ok(bank.uniqueMissedNearby <= bank.missed);
    assert.ok(bank.maturePairedMisses <= bank.uniqueMissedNearby);
    assert.equal(bank.statuses['mature-match'], bank.maturePairedMisses + bank.matureUnmatched);
    assert.equal(Object.values(bank.statuses).reduce((a, b) => a + b), bank.queries);
  }
});

test('signal replay prefix/future perturbation and masked gaps preserve causal query evidence', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const entry = manifest.records.find((r) => r.id === 'mitdb/228');
  const { rec } = await readLocalRecord(entry);
  const fs = rec.header.fs;
  const notch = manifest.databases[entry.db].mainsHz;
  const prefixEnd = 10 * fs;
  const end = 15 * fs;
  const small = { ...rec, nSamples: end, signals: rec.signals.map((s) => s.slice(0, end)) };
  const prefix = { ...small, nSamples: prefixEnd, signals: small.signals.map((s) => s.slice(0, prefixEnd)) };
  const future = { ...small, signals: small.signals.map((s) => {
    const x = s.slice();
    for (let i = prefixEnd; i < end; i++) x[i] = Math.sin(i * 3) * 10;
    return x;
  }) };
  const gapped = { ...small, signals: small.signals.map((s) => {
    const x = s.slice(); x.fill(NaN, 5 * fs, 5 * fs + 3); return x;
  }) };
  for (const capped of [false, true]) {
    const monitors = [small, prefix, future].map((record) => {
      const monitor = new OpportunityMonitor();
      replay(record, notch, capped, true, monitor);
      return monitor;
    });
    const beforeEnd = (m) => m.rows.filter((r) => r.queriedAt < 10);
    assert.deepEqual(beforeEnd(monitors[0]), monitors[1].rows);
    assert.deepEqual(beforeEnd(monitors[2]), monitors[1].rows);
    const monitor = new OpportunityMonitor();
    const radius = Math.round(0.08 * fs);
    const step = monitor.step.bind(monitor);
    monitor.step = (frame) => {
      step(frame);
      if (frame.sample.t > 5 && frame.sample.t < 5 + 3 / fs + 0.08) {
        assert.ok(frame.bank.templates.every((t) => t.createdAt > 5));
      }
    };
    const on = replay(gapped, notch, capped, true, monitor);
    const off = replay(gapped, notch, capped, false);
    assert.equal(on.shadowStats.gaps, 1);
    assert.deepEqual(on.events.map(({ shadow, ...e }) => e), off.events.map(({ shadow, ...e }) => e));
    for (const row of monitor.rows) {
      const crossesGap = row.center - radius <= 5 * fs + 2 && row.center + radius >= 5 * fs;
      if (crossesGap) assert.equal(row.query.status, 'unavailable');
    }
  }
});
