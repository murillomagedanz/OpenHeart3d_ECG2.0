// Research-only context: labels are posthoc; no context enters a detector or bank decision.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './validation-report.mjs';
import { SHADOW_PROTOCOL, ENERGY_PROTOCOL } from './qrs-shadow-bank.mjs';
import { QUERY_PROTOCOL, investigateQueries, aggregateResults } from './qrs-subthreshold-query.mjs';
import { ANALYSIS_PROTOCOL, toRows, quantiles, describeRows, compareRows, buildEnergyReport } from './qrs-template-energy.mjs';

export const CONTEXT_PROTOCOL = Object.freeze({
  version: 1,
  prior: 'latest valid emission strictly before queriedAt; current pipeline-step excluded; gap clears state; warmup included',
  primaryClock: 'queriedAt - previous.emittedAt; positive decision elapsed, not estimated-sample refractory elapsed',
  diagnosticClock: 'candidate.t - previous.event.t; signed; never used to stratify or decide',
  supportBins: [[3, 6], [6, 16], [16, null]],
  decisionBinsS: [[0, 0.22], [0.22, 0.36], [0.36, 1], [1, null]],
  bins: 'left-inclusive right-exclusive; null upper edge = infinity; missing decision = separate bin',
  energyEdgesLog2: ANALYSIS_PROTOCOL.histogramEdgesLog2,
  primaryComparison: 'paired baseline misses vs noReferenceNeighborhood; control is primary bank',
  secondaryComparisons: ['alreadyDetectedNeighborhood', 'duplicateMissNeighborhood', 'unmatched'],
  direction: 'higher energy and higher decision elapsed prespecified; support nonmonotonic fixed-bin proportions only',
  minPerGroup: 3, minNon228Records: 3,
  closure: '>=3 eligible non228 records with >=3 valid energy+elapsed per primary group; energy and elapsed AUC>0.5 in every eligible record; same joint cell eligible in >=3 non228 records and energy AUC>0.5 in all its eligible records; sparse = inconclusive',
  interpretation: 'conditional descriptive association only; no score, predictive fit, incremental performance proof or threshold',
});

const SUPPORT_KEYS = ['3-5', '6-15', '>=16'];
const TIME_KEYS = ['[0,.22)', '[.22,.36)', '[.36,1)', '[1,inf)', 'missing'];
const GROUPS = ['paired', 'noReferenceNeighborhood', 'alreadyDetectedNeighborhood', 'duplicateMissNeighborhood', 'unmatched'];
const energyBin = (value) => {
  if (value === null) return 'missing';
  const index = CONTEXT_PROTOCOL.energyEdgesLog2.findIndex((edge) => value < edge);
  return index < 0 ? CONTEXT_PROTOCOL.energyEdgesLog2.length : index;
};
export const supportBin = (support) => support < 6 ? '3-5' : support < 16 ? '6-15' : '>=16';
export const decisionBin = (elapsed) => elapsed === null ? 'missing'
  : elapsed < 0.22 ? '[0,.22)' : elapsed < 0.36 ? '[.22,.36)' : elapsed < 1 ? '[.36,1)' : '[1,inf)';
const jointBin = (row) => `${supportBin(row.support)}|${decisionBin(row.elapsedDecisionS)}`;
const subset = (rows, group) => rows.filter((row) => group === 'unmatched' ? row.group !== 'paired' : row.group === group);
const counts = (rows, keys, keyOf) => Object.fromEntries(keys.map((key) => [key, rows.filter((r) => keyOf(r) === key).length]));

export function contextRows(record, classified) {
  const energyRows = toRows(record, classified);
  return energyRows.map((row, i) => {
    const source = classified[i].row;
    const context = source.priorEmission;
    if (row.support < SHADOW_PROTOCOL.matureAfter || !source.query.matureBefore) {
      throw new Error('Context population lost prior maturity');
    }
    if (!context || (context.status === 'available'
      && (!(context.elapsedDecisionS > 0) || context.previousEmittedAt >= source.queriedAt))) {
      throw new Error('Context population lost strictly prior emission evidence');
    }
    return { ...row, t: source.t, elapsedDecisionS: context.elapsedDecisionS,
      signedEstimatedS: context.signedEstimatedS };
  });
}

export function describeContext(rows) {
  const elapsed = rows.map((r) => r.elapsedDecisionS);
  const signed = rows.map((r) => r.signedEstimatedS);
  return {
    n: rows.length, available: elapsed.filter((v) => v !== null).length,
    missing: elapsed.filter((v) => v === null).length,
    elapsedDecisionS: quantiles(elapsed), signedEstimatedS: quantiles(signed),
    signedCounts: { negative: signed.filter((v) => v !== null && v < 0).length,
      zero: signed.filter((v) => v === 0).length, positive: signed.filter((v) => v !== null && v > 0).length,
      missing: signed.filter((v) => v === null).length },
    supportBefore: quantiles(rows.map((r) => r.support)), ageS: quantiles(rows.map((r) => r.ageS)),
    supportBins: counts(rows, SUPPORT_KEYS, (r) => supportBin(r.support)),
    decisionBins: counts(rows, TIME_KEYS, (r) => decisionBin(r.elapsedDecisionS)),
  };
}

const eligibleRecords = (paired, other) => {
  const ids = [...new Set([...paired, ...other].map((r) => r.record))].sort();
  return ids.filter((id) => paired.filter((r) => r.record === id && r.log2 !== null).length >= CONTEXT_PROTOCOL.minPerGroup
    && other.filter((r) => r.record === id && r.log2 !== null).length >= CONTEXT_PROTOCOL.minPerGroup);
};
const elapsedRows = (rows) => rows.map((r) => ({ ...r, log2: r.elapsedDecisionS }));
function compareElapsed(paired, other) {
  const result = compareRows(elapsedRows(paired), elapsedRows(other), { list: true });
  result.withinTemplate.qualifiedTemplates = result.withinTemplate.qualifiedTemplates.map((template) => {
    const { pairedMedianLog2, otherMedianLog2, ...rest } = template;
    return { ...rest, pairedMedianElapsedDecisionS: pairedMedianLog2, otherMedianElapsedDecisionS: otherMedianLog2 };
  });
  return result;
}
export function comparison(paired, other) {
  const pa = describeContext(paired);
  const ob = describeContext(other);
  return {
    paired: paired.length, other: other.length,
    energy: compareRows(paired, other, { list: true }),
    elapsedDecision: compareElapsed(paired, other),
    supportBinProportionDifference: Object.fromEntries(SUPPORT_KEYS.map((key) => [key,
      paired.length && other.length ? pa.supportBins[key] / paired.length - ob.supportBins[key] / other.length : null])),
    eligibleEnergyRecords: eligibleRecords(paired, other),
    eligibleElapsedRecords: eligibleRecords(elapsedRows(paired), elapsedRows(other)),
  };
}

function conditionalEnergy(paired, other, keys, keyOf) {
  return keys.map((key) => {
    const a = paired.filter((r) => keyOf(r) === key);
    const b = other.filter((r) => keyOf(r) === key);
    return { key, paired: a.length, other: b.length,
      pairedLog2: quantiles(a.map((r) => r.log2)), otherLog2: quantiles(b.map((r) => r.log2)),
      energy: compareRows(a, b, { list: true }), eligibleEnergyRecords: eligibleRecords(a, b) };
  }).filter((cell) => cell.paired || cell.other);
}

export function summarizeContext(rows, { conditional = true } = {}) {
  const paired = subset(rows, 'paired');
  const other = subset(rows, 'noReferenceNeighborhood');
  const primary = comparison(paired, other);
  if (conditional) {
    primary.energyBySupport = conditionalEnergy(paired, other, SUPPORT_KEYS, (r) => supportBin(r.support));
    primary.energyByDecision = conditionalEnergy(paired, other, TIME_KEYS, (r) => decisionBin(r.elapsedDecisionS));
    primary.energyByJoint = conditionalEnergy(paired, other,
      SUPPORT_KEYS.flatMap((support) => TIME_KEYS.map((time) => `${support}|${time}`)), jointBin);
    primary.contextByEnergy = Array.from({ length: CONTEXT_PROTOCOL.energyEdgesLog2.length + 1 }, (_, i) => i)
      .concat('missing').map((key) => {
        const a = paired.filter((r) => energyBin(r.log2) === key);
        const b = other.filter((r) => energyBin(r.log2) === key);
        return { key, paired: describeContext(a), other: describeContext(b),
          elapsedDecision: compareElapsed(a, b),
          eligibleElapsedRecords: eligibleRecords(elapsedRows(a), elapsedRows(b)) };
      }).filter((cell) => cell.paired.n || cell.other.n);
  }
  return { matureProposals: rows.length,
    groups: Object.fromEntries(GROUPS.map((group) => {
      const selected = subset(rows, group);
      return [group, { energy: describeRows(selected), context: describeContext(selected) }];
    })),
    primary,
    secondary: Object.fromEntries(CONTEXT_PROTOCOL.secondaryComparisons.map((group) => [group, comparison(paired, subset(rows, group))])),
  };
}

export function evaluateClosure(byRecord) {
  const records = [...byRecord].filter(([id]) => id !== 'mitdb/228');
  const valid = (rows) => rows.filter((r) => r.log2 !== null && r.elapsedDecisionS !== null);
  const evidence = (id, rows) => {
    const a = valid(subset(rows, 'paired'));
    const b = valid(subset(rows, 'noReferenceNeighborhood'));
    return { id, paired: a.length, other: b.length,
      energyAuc: compareRows(a, b).pooledAuc, elapsedAuc: compareRows(elapsedRows(a), elapsedRows(b)).pooledAuc };
  };
  const floor = CONTEXT_PROTOCOL.minPerGroup;
  const eligible = records.map(([id, rows]) => evidence(id, rows)).filter((r) => r.paired >= floor && r.other >= floor);
  const cells = SUPPORT_KEYS.flatMap((s) => TIME_KEYS.slice(0, -1).map((t) => `${s}|${t}`)).map((key) => ({
    key, records: records.map(([id, rows]) => evidence(id, rows.filter((r) => jointBin(r) === key)))
      .filter((r) => r.paired >= floor && r.other >= floor),
  }));
  const qualifiedCells = cells.filter((cell) => cell.records.length >= CONTEXT_PROTOCOL.minNon228Records);
  const sampleSufficient = eligible.length >= CONTEXT_PROTOCOL.minNon228Records && qualifiedCells.length > 0;
  const directionAgrees = eligible.every((r) => r.energyAuc > 0.5 && r.elapsedAuc > 0.5)
    && qualifiedCells.some((cell) => cell.records.every((r) => r.energyAuc > 0.5));
  return { decision: !sampleSufficient ? 'inconclusive-sparse' : directionAgrees ? 'consistent-descriptive-association'
    : 'not-consistent-under-descriptive-criterion',
  eligibleNon228Records: eligible, eligibleNon228RecordCount: eligible.length,
  requiredNon228Records: CONTEXT_PROTOCOL.minNon228Records,
  qualifiedJointCellCount: qualifiedCells.length,
  jointCells: cells, sampleSufficient, directionAgrees,
  limit: 'No predictive fit: neither conditional nor marginal AUC proves incremental multifeature performance' };
}

export function queryAvailability(queries) {
  const statuses = ['cold-start', 'immature-match', 'no-match', 'unavailable', 'mature-match'];
  return { queries: queries.length,
    statuses: Object.fromEntries(statuses.map((status) => {
      const rows = queries.filter((q) => q.query.status === status);
      return [status, { n: rows.length, missingPriorEmission: rows.filter((q) => q.priorEmission.status === 'missing').length,
        signedNegative: rows.filter((q) => q.priorEmission.signedEstimatedS !== null && q.priorEmission.signedEstimatedS < 0).length }];
    })) };
}

export async function runContextStudy(selected, manifest) {
  const rowsByBank = { control: new Map(), cap2: new Map() };
  const availability = { control: new Map(), cap2: new Map() };
  const records = [];
  for (const expected of selected) {
    const entry = manifest.records.find((r) => r.id === expected.id && r.bundled);
    if (!entry) throw new Error(`Unbundled record: ${expected.id}`);
    records.push(await investigateQueries(entry, manifest, expected, {
      onBank: ({ bank, id, classified, queries }) => {
        rowsByBank[bank].set(id, contextRows(id, classified));
        availability[bank].set(id, queryAvailability(queries));
      },
    }));
  }
  const energy = buildEnergyReport(rowsByBank);
  const addAvailability = (values) => values.reduce((a, value) => {
    a.queries += value.queries;
    for (const [status, cell] of Object.entries(value.statuses)) {
      for (const [key, n] of Object.entries(cell)) a.statuses[status][key] += n;
    }
    return a;
  }, queryAvailability([]));
  const bankSummary = (bank, without228) => {
    const selectedRows = [...rowsByBank[bank]].filter(([id]) => !without228 || id !== 'mitdb/228');
    const rows = selectedRows.flatMap(([, value]) => value);
    return { records: selectedRows.length, ...summarizeContext(rows),
      allQueryAvailability: addAvailability([...availability[bank]].filter(([id]) => !without228 || id !== 'mitdb/228').map(([, v]) => v)),
      recordsWithMature: selectedRows.filter(([, r]) => r.length).length,
      recordsWithPairs: selectedRows.filter(([, r]) => subset(r, 'paired').length).length };
  };
  return {
    queryRecords: records, energy,
    totals: Object.fromEntries(['control', 'cap2'].map((bank) => [bank, bankSummary(bank, false)])),
    excluding228Diagnostic: Object.fromEntries(['control', 'cap2'].map((bank) => [bank, bankSummary(bank, true)])),
    closure: Object.fromEntries(['control', 'cap2'].map((bank) => [bank, evaluateClosure(rowsByBank[bank])])),
    records: records.map((r) => ({ id: r.id, fs: r.fs,
      banks: Object.fromEntries(['control', 'cap2'].map((bank) => {
        const rows = rowsByBank[bank].get(r.id);
        return [bank, { emitted: r.banks[bank].emitted,
          baselineMisses: r.banks[bank].missed, maturePairedMisses: r.banks[bank].maturePairedMisses,
          matureUnmatched: r.banks[bank].matureUnmatched, allQueryAvailability: availability[bank].get(r.id),
          context: summarizeContext(rows),
          ...(r.banks[bank].intervals ? { intervals: r.banks[bank].intervals.map((interval) => ({
            from: interval.from, to: interval.to, priorQuerySummary: interval,
            globalPairingContext: summarizeContext(rows.filter((row) => row.t >= interval.from && row.t < interval.to), { conditional: false }),
          })) } : {}) }];
      })) })),
  };
}

export function verifyPriorProjections(study, savedEnergy, savedQuery, all) {
  const projection = study.queryRecords.map((r) => ({ id: r.id, fs: r.fs,
    banks: Object.fromEntries(['control', 'cap2'].map((bank) => [bank, {
      emitted: r.banks[bank].emitted, maturePairedMisses: r.banks[bank].maturePairedMisses,
      matureUnmatched: r.banks[bank].matureUnmatched, energy: study.energy.perRecord[r.id][bank],
    }])) }));
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const [actual, prior] of [[projection, savedEnergy.records], [study.queryRecords, savedQuery.records]]) {
    const byId = new Map(prior.map((r) => [r.id, r]));
    if (!actual.every((r) => eq(r, byId.get(r.id))) || (all && actual.length !== prior.length)) {
      throw new Error('Prior record projection changed');
    }
  }
  const energyProtocols = { shadowProtocol: SHADOW_PROTOCOL, queryProtocol: QUERY_PROTOCOL,
    energyProtocol: ENERGY_PROTOCOL, analysisProtocol: ANALYSIS_PROTOCOL };
  if (!Object.entries(energyProtocols).every(([key, value]) => eq(value, savedEnergy[key]))
    || !eq(savedQuery.shadowProtocol, SHADOW_PROTOCOL) || !eq(savedQuery.queryProtocol, QUERY_PROTOCOL)
    || (all && (!eq(study.energy.totals, savedEnergy.totals)
      || !eq(aggregateResults(study.queryRecords), savedQuery.totals)))) {
    throw new Error('Prior totals/protocol projection changed');
  }
  return { recordsIdentical: projection.length, protocolsIdentical: true, totalsIdentical: all };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const index = args.indexOf('--output');
  const output = index >= 0 ? args.splice(index, 2)[1] : null;
  if (!args.length || (args.includes('--all') && args.length !== 1) || (index >= 0 && !output)) {
    throw new Error('Usage: node tests\\qrs-support-emission-context.mjs --all|record-id [...] [--output path]');
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const frozen = JSON.parse(await readFile(path.join(root, 'data', 'reports', 'validation.json'), 'utf8'));
  const selected = args[0] === '--all' ? frozen.records : args.map((id) => {
    const r = frozen.records.find((record) => record.id === id);
    if (!r) throw new Error(`Unknown frozen record: ${id}`);
    return r;
  });
  const files = ['2026-10-08-template-energy-shadow-results.json', '2026-10-08-subthreshold-shadow-query-results.json'];
  const bytes = await Promise.all(files.map((file) => readFile(path.join(root, '..', 'docs', 'plans', file))));
  const study = await runContextStudy(selected, manifest);
  const projection = verifyPriorProjections(study, ...bytes.map((b) => JSON.parse(b.toString('utf8'))), args[0] === '--all');
  const report = {
    schema: 'openheart3d.ecg.support-emission-context', version: 1,
    shadowProtocol: SHADOW_PROTOCOL, queryProtocol: QUERY_PROTOCOL, energyProtocol: ENERGY_PROTOCOL,
    analysisProtocol: ANALYSIS_PROTOCOL, contextProtocol: CONTEXT_PROTOCOL,
    verification: { frozenControls: selected.length, eventIdenticalOnOff: { control: selected.length, cap2: selected.length },
      priorProjections: files.map((file, i) => ({ file: `docs/plans/${file}`,
        sha256: createHash('sha256').update(bytes[i]).digest('hex'), ...projection })) },
    totals: study.totals, excluding228Diagnostic: study.excluding228Diagnostic, closure: study.closure, records: study.records,
  };
  if (output) await writeFile(path.resolve(output), `${JSON.stringify(report)}\n`);
  console.log(JSON.stringify(output ? { output, verification: report.verification, closure: report.closure,
    populations: Object.fromEntries(Object.entries(report.totals).map(([bank, value]) => [bank, {
      mature: value.matureProposals, paired: value.primary.paired, noReference: value.primary.other,
      energyAuc: value.primary.energy.pooledAuc, elapsedAuc: value.primary.elapsedDecision.pooledAuc,
    }])) } : report, null, 2));
}
