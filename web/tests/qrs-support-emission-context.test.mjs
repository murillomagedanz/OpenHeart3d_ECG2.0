import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root, readLocalRecord } from './validation-report.mjs';
import { ShadowBank, SHADOW_PROTOCOL, ENERGY_PROTOCOL } from './qrs-shadow-bank.mjs';
import { replay } from './qrs-morphology.mjs';
import { OpportunityMonitor, priorEmissionContext, classifyMature, QUERY_PROTOCOL, aggregateResults } from './qrs-subthreshold-query.mjs';
import { toRows, buildEnergyReport, ANALYSIS_PROTOCOL } from './qrs-template-energy.mjs';
import { contextRows, supportBin, decisionBin, describeContext, comparison, summarizeContext,
  evaluateClosure, queryAvailability, verifyPriorProjections } from './qrs-support-emission-context.mjs';

test('prior decision clock is strictly earlier; estimated clock is signed and distinct', () => {
  const prior = { t: 1.15, emittedAt: 1.2 };
  const before = structuredClone(prior);
  const c = priorEmissionContext(1.1, 1.3, prior);
  assert.equal(c.status, 'available');
  assert.ok(Math.abs(c.elapsedDecisionS - 0.1) < 1e-12);
  assert.ok(c.signedEstimatedS < 0);
  assert.equal(c.previousEventT, 1.15);
  assert.equal(c.previousEmittedAt, 1.2);
  assert.deepEqual(prior, before);
  for (const emittedAt of [1.3, 1.4, NaN]) {
    assert.throws(() => priorEmissionContext(1.1, 1.3, { t: 1.15, emittedAt }), RangeError);
  }
  assert.deepEqual(priorEmissionContext(0.2, 0.3), {
    status: 'missing', previousEventT: null, previousEmittedAt: null, elapsedDecisionS: null, signedEstimatedS: null,
  });
});

const shape = [0, 1, 3, 1, 0];
test('same-step emission cannot supply context or increase support; queries are immutable', () => {
  const monitor = new OpportunityMonitor();
  // A pending, already aligned opportunity completing on this step.
  monitor.pending.push({ t: 0.4, center: 40, peakT: 0.4, ratio: 0.5, aligned: true });
  const bp = new Float32Array(60);
  for (let j = 0; j < 17; j++) bp[32 + j] = Math.sin(j / 3);
  const vector = Array.from(bp.slice(32, 49));
  const b = new ShadowBank();
  [0.1, 0.2, 0.3].forEach((t) => b.observe(vector, t));
  const original = structuredClone(b);
  monitor.step({ sample: { index: 48, t: 0.48 }, bp,
    detector: { fs: 100, mwiLen: 10, groupDelay: 0.01, n: 100, mwiSum: 0 }, openingThreshold: 1,
    bank: b, previousEmission: { t: 0.25, emittedAt: 0.3 } });
  assert.deepEqual(structuredClone(b), original);
  const row = monitor.rows[0];
  assert.equal(row.query.status, 'mature-match');
  assert.equal(row.query.supportBefore, 3);
  assert.equal(row.query.energy.ratio, 1);
  assert.equal(row.priorEmission.previousEmittedAt, 0.3);
  b.observe(vector, 0.48);
  assert.equal(b.templates[0].count, 4);
  assert.equal(row.query.supportBefore, 3);
  assert.equal(row.priorEmission.previousEmittedAt, 0.3);
});

function classifiedFixture() {
  const bank = new ShadowBank();
  [1, 2, 3].forEach((t) => bank.observe(shape, t));
  const q = (t, time) => ({ t, queriedAt: time, query: bank.query(shape, time),
    priorEmission: priorEmissionContext(t, time, { t: 3, emittedAt: 3.2 }) });
  const refs = [{ t: 4, symbol: 'N' }, { t: 5, symbol: 'V' }];
  return { bank, classified: classifyMature(refs, [refs[0]], [q(4, 4.2), q(4.01, 4.3), q(5, 5.2), q(6, 6.2)]) };
}

test('context preserves exact energy/status/maturity evidence and prior energy report projection', () => {
  const { bank, classified } = classifiedFixture();
  const before = structuredClone(bank);
  const sourceBefore = structuredClone(classified);
  const rows = contextRows('rec', classified);
  const base = toRows('rec', classified);
  assert.deepEqual(rows.map(({ t, elapsedDecisionS, signedEstimatedS, ...r }) => r), base);
  assert.deepEqual(buildEnergyReport({ control: new Map([['rec', rows]]) }),
    buildEnergyReport({ control: new Map([['rec', base]]) }));
  assert.deepEqual(bank, Object.assign(new ShadowBank(), before));
  assert.deepEqual(classified, sourceBefore);
  assert.equal(rows.filter((r) => r.group === 'paired').length, 1);
  assert.deepEqual(rows.map((r) => r.support), [3, 3, 3, 3]);
  const queries = classified.map((c) => c.row);
  const available = queryAvailability(queries);
  assert.deepEqual(available.statuses['mature-match'], { n: 4, missingPriorEmission: 0, signedNegative: 0 });
  const missing = structuredClone(classified);
  missing[0].row.priorEmission = priorEmissionContext(4, 4.2);
  assert.equal(contextRows('rec', missing)[0].elapsedDecisionS, null);
  missing[0].row.query.supportBefore = 2;
  assert.throws(() => contextRows('rec', missing), /maturity/);
});

test('strata have frozen left-inclusive boundaries, missing is not infinity, and signed counts are explicit', () => {
  assert.deepEqual([3, 5, 6, 15, 16].map(supportBin), ['3-5', '3-5', '6-15', '6-15', '>=16']);
  assert.deepEqual([0, 0.2199, 0.22, 0.36, 1, null].map(decisionBin),
    ['[0,.22)', '[0,.22)', '[.22,.36)', '[.36,1)', '[1,inf)', 'missing']);
  const rows = [-1, 0, 1, null].map((signedEstimatedS) => ({
    elapsedDecisionS: signedEstimatedS === null ? null : 0.25, signedEstimatedS, support: 3, ageS: 1,
  }));
  const d = describeContext(rows);
  assert.equal(d.available, 3);
  assert.equal(d.missing, 1);
  assert.deepEqual(d.signedCounts, { negative: 1, zero: 1, positive: 1, missing: 1 });
  assert.equal(d.decisionBins.missing, 1);
});

const row = (record, group, log2, elapsedDecisionS, support = 4) => ({
  record, template: `${record}|1`, group, log2, elapsedDecisionS, support, ageS: 1,
  signedEstimatedS: elapsedDecisionS === null ? null : elapsedDecisionS - 0.1,
  reason: null, position: 'within', symbol: group === 'paired' ? 'N' : null,
});
const pairRows = (record, { elapsedA = 0.8, elapsedB = 0.4, support = 4 } = {}) => [
  ...[1, 2, 3].map((x) => row(record, 'paired', x, elapsedA, support)),
  ...[-3, -2, -1].map((x) => row(record, 'noReferenceNeighborhood', x, elapsedB, support)),
];

test('conditional summaries retain denominators, primary vs secondary labels, overlap and support association without score', () => {
  const rows = pairRows('r');
  rows.push(row('r', 'alreadyDetectedNeighborhood', 2, 0.1), row('r', 'duplicateMissNeighborhood', 3, null, 20));
  const summary = summarizeContext(rows);
  assert.equal(summary.primary.paired, 3);
  assert.equal(summary.primary.other, 3);
  assert.equal(summary.primary.energy.pooledAuc, 1);
  assert.equal(summary.primary.elapsedDecision.pooledAuc, 1);
  assert.deepEqual(summary.primary.eligibleEnergyRecords, ['r']);
  assert.equal(summary.primary.energy.withinTemplate.qualifiedTemplates.length, 1);
  assert.equal(summary.primary.elapsedDecision.withinTemplate.qualifiedTemplates[0].pairedMedianElapsedDecisionS, 0.8);
  assert.equal('pairedMedianLog2' in summary.primary.elapsedDecision.withinTemplate.qualifiedTemplates[0], false);
  assert.equal(summary.primary.energy.overlap.otherInsidePairedP10P90, 0);
  assert.equal(summary.primary.energyByJoint.length, 1);
  assert.equal(summary.primary.energyByJoint[0].paired, 3);
  assert.equal(summary.primary.energyByJoint[0].other, 3);
  assert.equal(summary.secondary.alreadyDetectedNeighborhood.other, 1);
  assert.equal(summary.secondary.duplicateMissNeighborhood.elapsedDecision.other, 0);
  assert.equal(summary.secondary.unmatched.other, 5);
  assert.equal(summary.groups.duplicateMissNeighborhood.context.missing, 1);
  assert.equal(comparison([], rows).energy.pooledAuc, null);
  assert.equal(summary.primary.supportBinProportionDifference['3-5'], 0);
  assert.equal('combinedScore' in summary.primary, false);
});

test('closure cannot be rescued by 228 or cap2; joint sparsity is inconclusive, not disproven', () => {
  const b = new Map(['a', 'b', 'c'].map((id) => [id, pairRows(id)]));
  assert.equal(evaluateClosure(b).decision, 'consistent-descriptive-association');
  const sparse = new Map([...b].slice(0, 2));
  sparse.set('mitdb/228', pairRows('mitdb/228'));
  assert.equal(evaluateClosure(sparse).eligibleNon228RecordCount, 2);
  assert.equal(evaluateClosure(sparse).decision, 'inconclusive-sparse');
  const discordant = new Map(b);
  discordant.set('c', pairRows('c', { elapsedA: 0.4, elapsedB: 0.8 }));
  assert.equal(evaluateClosure(discordant).decision, 'not-consistent-under-descriptive-criterion');
  const jointSparse = new Map(['a', 'b', 'c'].map((id, i) => [id, pairRows(id, { support: [4, 10, 20][i] })]));
  assert.equal(evaluateClosure(jointSparse).eligibleNon228RecordCount, 3);
  assert.equal(evaluateClosure(jointSparse).qualifiedJointCellCount, 0);
  assert.equal(evaluateClosure(jointSparse).decision, 'inconclusive-sparse');
});

test('projection verification rejects prior report changes rather than overwriting evidence', () => {
  const rows = pairRows('rec');
  const energy = buildEnergyReport({ control: new Map([['rec', rows]]), cap2: new Map([['rec', rows]]) });
  const banks = Object.fromEntries(['control', 'cap2'].map((bank) => [bank, {
    emitted: { tp: 1, fp: 2, fn: 3 }, maturePairedMisses: 3, matureUnmatched: 3,
  }]));
  const queryRecords = [{ id: 'rec', fs: 100, banks }];
  const savedEnergy = { shadowProtocol: SHADOW_PROTOCOL, queryProtocol: QUERY_PROTOCOL,
    energyProtocol: ENERGY_PROTOCOL, analysisProtocol: ANALYSIS_PROTOCOL, totals: energy.totals,
    records: [{ id: 'rec', fs: 100, banks: Object.fromEntries(Object.entries(banks)
      .map(([bank, values]) => [bank, { ...values, energy: energy.perRecord.rec[bank] }])) }] };
  const savedQuery = { shadowProtocol: SHADOW_PROTOCOL, queryProtocol: QUERY_PROTOCOL,
    records: queryRecords, totals: aggregateResults(queryRecords) };
  const study = { queryRecords, energy };
  assert.deepEqual(verifyPriorProjections(study, savedEnergy, savedQuery, true), {
    recordsIdentical: 1, protocolsIdentical: true, totalsIdentical: true,
  });
  const before = structuredClone(savedEnergy);
  const changed = structuredClone(savedEnergy);
  changed.records[0].banks.control.energy.groups.paired.n++;
  assert.throws(() => verifyPriorProjections(study, changed, savedQuery, true), /record projection/);
  const totalsChanged = structuredClone(savedQuery);
  totalsChanged.totals.control.maturePairedMisses++;
  assert.throws(() => verifyPriorProjections(study, savedEnergy, totalsChanged, true), /totals\/protocol/);
  assert.deepEqual(savedEnergy, before);
});

test('real replay excludes current-step events, includes warmup, clears state at gaps, and preserves prefix/future/EOF evidence', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const entry = manifest.records.find((r) => r.id === 'mitdb/228');
  const { rec } = await readLocalRecord(entry);
  const fs = rec.header.fs;
  const notch = manifest.databases[entry.db].mainsHz;
  const shorten = (n) => ({ ...rec, nSamples: n, signals: rec.signals.map((s) => s.slice(0, n)) });
  const full = shorten(15 * fs);
  const prefix = shorten(10 * fs);
  const changed = { ...full, signals: full.signals.map((s) => {
    const v = s.slice(); v.fill(NaN, 10 * fs); return v;
  }) };
  const gapped = { ...full, signals: full.signals.map((s) => {
    const v = s.slice(); v.fill(NaN, 5 * fs, 5 * fs + 3); return v;
  }) };
  for (const capped of [false, true]) {
    const run = (record) => {
      const monitor = new OpportunityMonitor();
      const snapshots = [];
      const step = monitor.step.bind(monitor);
      monitor.step = (frame) => {
        snapshots.push({ t: frame.sample.t, previous: frame.previousEmission && { ...frame.previousEmission } });
        const before = structuredClone(frame.bank);
        step(frame);
        assert.deepEqual(structuredClone(frame.bank), before);
      };
      return { monitor, result: replay(record, notch, capped, true, monitor), snapshots };
    };
    const a = run(full);
    const p = run(prefix);
    const f = run(changed);
    assert.ok(p.monitor.rows.length > 0);
    assert.deepEqual(a.monitor.rows.filter((r) => r.queriedAt < 10), p.monitor.rows);
    assert.deepEqual(f.monitor.rows.filter((r) => r.queriedAt < 10), p.monitor.rows);
    assert.equal(p.monitor.enumerated, p.monitor.rows.length + p.monitor.pending.length + p.monitor.invalidated);
    assert.ok(p.monitor.rows.every((r) => r.queriedAt <= (prefix.nSamples - 1) / fs));
    for (const frame of a.snapshots) {
      const expected = a.result.events.filter((e) => e.causal.emittedAt < frame.t).at(-1);
      assert.equal(frame.previous?.emittedAt ?? null, expected?.causal.emittedAt ?? null);
      assert.equal(frame.previous?.t ?? null, expected?.t ?? null);
    }
    assert.equal(a.snapshots[0].previous, null);
    assert.ok(a.result.events.every((e) => e.causal.emittedAt >= 1));
    const g = run(gapped);
    assert.equal(g.result.shadowStats.gaps, 1);
    for (const frame of g.snapshots.filter((s) => s.t > 5)) {
      const expected = g.result.events.filter((e) => e.causal.emittedAt > 5 && e.causal.emittedAt < frame.t).at(-1);
      assert.equal(frame.previous?.emittedAt ?? null, expected?.causal.emittedAt ?? null);
    }
    const off = replay(full, notch, capped, false);
    assert.deepEqual(a.result.events.map(({ shadow, ...e }) => e), off.events.map(({ shadow, ...e }) => e));
    const cold = a.monitor.rows.filter((r) => r.priorEmission.status === 'missing');
    assert.ok(cold.every((r) => r.priorEmission.elapsedDecisionS === null));
    assert.ok(a.monitor.rows.every((r) => r.priorEmission.status === 'missing'
      || r.priorEmission.previousEmittedAt < r.queriedAt));
  }
});
