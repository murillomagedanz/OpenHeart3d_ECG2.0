// Research-only descriptive energy summaries. Labels are used only after replay.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './validation-report.mjs';
import { SHADOW_PROTOCOL, ENERGY_PROTOCOL } from './qrs-shadow-bank.mjs';
import { QUERY_PROTOCOL, investigateQueries } from './qrs-subthreshold-query.mjs';

export const ANALYSIS_PROTOCOL = Object.freeze({
  version: 1,
  scale: 'log2(query energy / prior template energy); never thresholded',
  quantiles: [0.1, 0.25, 0.5, 0.75, 0.9], quantileIndex: 'round((n-1)p)',
  histogramEdgesLog2: [-4, -2, -1, 0, 1, 2, 4],
  minTemplateGroupSupport: 3,
  populations: 'mature-match queries only; paired = one-to-one to baseline misses; unmatched strata as in the query report',
  statistic: 'P(L_paired > L_other) with ties 0.5, descriptive overlap only',
});

const SAVED_REPORT = path.join('docs', 'plans', '2026-10-08-subthreshold-shadow-query-results.json');
const QUANTILE_NAMES = ['p10', 'p25', 'median', 'p75', 'p90'];
const STRATA = ['duplicateMissNeighborhood', 'alreadyDetectedNeighborhood', 'noReferenceNeighborhood'];

export function quantiles(values) {
  const a = values.filter((v) => v !== null && Number.isFinite(v)).sort((x, y) => x - y);
  const at = (p) => (a.length ? a[Math.round((a.length - 1) * p)] : null);
  return { n: a.length, min: at(0),
    ...Object.fromEntries(ANALYSIS_PROTOCOL.quantiles.map((p, i) => [QUANTILE_NAMES[i], at(p)])), max: at(1) };
}

// Probability that a random value of `a` exceeds one of `b`, ties count one half.
export function auc(a, b) {
  if (!a.length || !b.length) return null;
  const sorted = [...b].sort((x, y) => x - y);
  const bound = (value, upper) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < value || (upper && sorted[mid] === value)) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  let wins = 0;
  for (const value of a) wins += bound(value, false) + (bound(value, true) - bound(value, false)) / 2;
  return wins / (a.length * sorted.length);
}

export function toRows(record, classified) {
  return classified.map(({ row, reference, group }) => {
    const e = row.query.energy;
    const ratio = e.status === 'ok' ? e.ratio : null;
    return {
      record, template: `${record}|${row.query.templateId}`, group, symbol: reference?.symbol ?? null,
      log2: ratio !== null && ratio > 0 && Number.isFinite(ratio) ? Math.log2(ratio) : null,
      reason: e.status === 'ok' ? null : e.reason,
      position: e.status !== 'ok' ? 'unavailable'
        : e.query < e.priorMin ? 'below' : e.query > e.priorMax ? 'above' : 'within',
      support: row.query.supportBefore, ageS: row.query.ageS,
    };
  });
}

const histogram = (values) => {
  const edges = ANALYSIS_PROTOCOL.histogramEdgesLog2;
  const counts = new Array(edges.length + 1).fill(0);
  for (const v of values) {
    const bin = edges.findIndex((edge) => v < edge);
    counts[bin < 0 ? edges.length : bin]++;
  }
  return counts;
};

export function describeRows(rows) {
  if (!rows.length) return { n: 0 };
  const logs = rows.map((r) => r.log2).filter((v) => v !== null);
  const unavailable = {};
  for (const r of rows) {
    if (r.log2 !== null) continue;
    const reason = r.reason ?? 'non-positive-ratio';
    unavailable[reason] = (unavailable[reason] ?? 0) + 1;
  }
  const position = { below: 0, within: 0, above: 0, unavailable: 0 };
  for (const r of rows) position[r.position]++;
  return {
    n: rows.length, withRatio: logs.length, unavailable,
    records: new Set(rows.map((r) => r.record)).size, templates: new Set(rows.map((r) => r.template)).size,
    log2: quantiles(logs), histogramEdgesLog2: ANALYSIS_PROTOCOL.histogramEdgesLog2, histogram: histogram(logs),
    supportBefore: quantiles(rows.map((r) => r.support)), ageS: quantiles(rows.map((r) => r.ageS)),
    priorRange: position,
  };
}

const share = (values, low, high) => (values.length && low !== null
  ? values.filter((v) => v >= low && v <= high).length / values.length : null);

export function compareRows(pairedRows, otherRows, { list = false } = {}) {
  const a = pairedRows.filter((r) => r.log2 !== null);
  const b = otherRows.filter((r) => r.log2 !== null);
  const la = a.map((r) => r.log2);
  const lb = b.map((r) => r.log2);
  const qa = quantiles(la);
  const qb = quantiles(lb);
  const byTemplate = new Map();
  for (const [side, rows] of [['a', a], ['b', b]]) {
    for (const r of rows) {
      if (!byTemplate.has(r.template)) byTemplate.set(r.template, { a: [], b: [] });
      byTemplate.get(r.template)[side].push(r);
    }
  }
  const strata = { templatesPairedOnly: 0, pairedOnlyRows: 0, templatesOtherOnly: 0, otherOnlyRows: 0, templatesBoth: 0 };
  let weight = 0;
  let weighted = 0;
  const tally = { above: 0, below: 0, tie: 0 };
  const qualified = [];
  for (const [template, { a: ta, b: tb }] of [...byTemplate].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
    if (!ta.length) { strata.templatesOtherOnly++; strata.otherOnlyRows += tb.length; continue; }
    if (!tb.length) { strata.templatesPairedOnly++; strata.pairedOnlyRows += ta.length; continue; }
    strata.templatesBoth++;
    const stat = auc(ta.map((r) => r.log2), tb.map((r) => r.log2));
    weight += ta.length * tb.length;
    weighted += stat * ta.length * tb.length;
    tally[stat > 0.5 ? 'above' : stat < 0.5 ? 'below' : 'tie']++;
    const floor = ANALYSIS_PROTOCOL.minTemplateGroupSupport;
    if (list && ta.length >= floor && tb.length >= floor) {
      const med = (rows, key) => quantiles(rows.map((r) => r[key])).median;
      qualified.push({ template, paired: ta.length, other: tb.length, auc: stat,
        pairedMedianLog2: med(ta, 'log2'), otherMedianLog2: med(tb, 'log2'),
        pairedMedianSupport: med(ta, 'support'), otherMedianSupport: med(tb, 'support'),
        pairedMedianAgeS: med(ta, 'ageS'), otherMedianAgeS: med(tb, 'ageS') });
    }
  }
  return {
    paired: a.length, other: b.length,
    pooledAuc: auc(la, lb),
    overlap: { otherInsidePairedP10P90: share(lb, qa.p10, qa.p90), pairedInsideOtherP10P90: share(la, qb.p10, qb.p90) },
    withinTemplate: { ...strata, stratifiedAuc: weight ? weighted / weight : null,
      pairWeight: weight, templateAuc: tally,
      ...(list ? { qualifiedTemplates: qualified } : {}) },
  };
}

export function describeBankRecord(rows, { list = false } = {}) {
  const paired = rows.filter((r) => r.group === 'paired');
  const unmatched = rows.filter((r) => r.group !== 'paired');
  const symbols = [...new Set(paired.map((r) => r.symbol))].sort();
  return {
    matureProposals: rows.length,
    groups: {
      paired: describeRows(paired),
      pairedBySymbol: Object.fromEntries(symbols.map((s) => [s, describeRows(paired.filter((r) => r.symbol === s))])),
      unmatched: describeRows(unmatched),
      ...Object.fromEntries(STRATA.map((g) => [g, describeRows(rows.filter((r) => r.group === g))])),
    },
    comparisons: {
      pairedVsUnmatched: compareRows(paired, unmatched, { list }),
      ...Object.fromEntries(STRATA.map((g) => [`pairedVs${g[0].toUpperCase()}${g.slice(1)}`,
        compareRows(paired, rows.filter((r) => r.group === g))])),
    },
  };
}

function recordLevel(rowsByRecord) {
  const floor = ANALYSIS_PROTOCOL.minTemplateGroupSupport;
  const out = { recordsWithMature: 0, recordsWithPaired: 0, recordsBothGroupsAtLeastFloor: 0,
    pairedAucAboveHalf: 0, pairedAucBelowHalf: 0, pairedAucEqualHalf: 0 };
  for (const rows of rowsByRecord.values()) {
    if (rows.length) out.recordsWithMature++;
    const a = rows.filter((r) => r.group === 'paired' && r.log2 !== null).map((r) => r.log2);
    const b = rows.filter((r) => r.group !== 'paired' && r.log2 !== null).map((r) => r.log2);
    if (rows.some((r) => r.group === 'paired')) out.recordsWithPaired++;
    if (a.length >= floor && b.length >= floor) {
      out.recordsBothGroupsAtLeastFloor++;
      const stat = auc(a, b);
      out[stat > 0.5 ? 'pairedAucAboveHalf' : stat < 0.5 ? 'pairedAucBelowHalf' : 'pairedAucEqualHalf']++;
    }
  }
  return out;
}

export function buildEnergyReport(rowsByBank) {
  const totals = {};
  const perRecord = {};
  for (const [bank, byRecord] of Object.entries(rowsByBank)) {
    const all = [...byRecord.values()].flat();
    totals[bank] = { ...describeBankRecord(all), recordLevel: recordLevel(byRecord) };
    for (const [record, rows] of byRecord) (perRecord[record] ??= {})[bank] = describeBankRecord(rows, { list: true });
  }
  return { totals, perRecord };
}

export async function runEnergyStudy(selected, manifest) {
  const rowsByBank = { control: new Map(), cap2: new Map() };
  const records = [];
  for (const expected of selected) {
    const entry = manifest.records.find((r) => r.id === expected.id && r.bundled);
    if (!entry) throw new Error(`Unbundled record: ${expected.id}`);
    records.push(await investigateQueries(entry, manifest, expected, {
      onBank: ({ bank, id, classified }) => rowsByBank[bank].set(id, toRows(id, classified)),
    }));
  }
  return { records, ...buildEnergyReport(rowsByBank) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const output = outputIndex >= 0 ? args.splice(outputIndex, 2)[1] : null;
  if (!args.length || (args.includes('--all') && args.length !== 1) || (outputIndex >= 0 && !output)) {
    throw new Error('Usage: node tests\\qrs-template-energy.mjs --all|record-id [...] [--output path]');
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const frozen = JSON.parse(await readFile(path.join(root, 'data', 'reports', 'validation.json'), 'utf8'));
  const selected = args[0] === '--all' ? frozen.records : args.map((id) => {
    const record = frozen.records.find((r) => r.id === id);
    if (!record) throw new Error(`Unknown frozen record: ${id}`);
    return record;
  });
  const savedBytes = await readFile(path.join(root, '..', SAVED_REPORT));
  const saved = JSON.parse(savedBytes.toString('utf8'));
  const study = await runEnergyStudy(selected, manifest);
  const savedById = new Map(saved.records.map((r) => [r.id, r]));
  const identical = study.records.every((r) => JSON.stringify(r) === JSON.stringify(savedById.get(r.id)));
  if (!identical) throw new Error('Energy run changed the prior subthreshold query projection');
  const all = args[0] === '--all';
  if (all && (study.records.length !== saved.records.length
    || JSON.stringify(saved.shadowProtocol) !== JSON.stringify(SHADOW_PROTOCOL)
    || JSON.stringify(saved.queryProtocol) !== JSON.stringify(QUERY_PROTOCOL))) {
    throw new Error('Prior protocol projection mismatch');
  }
  const report = {
    schema: 'openheart3d.ecg.template-energy-shadow', version: 1,
    shadowProtocol: SHADOW_PROTOCOL, queryProtocol: QUERY_PROTOCOL, energyProtocol: ENERGY_PROTOCOL,
    analysisProtocol: ANALYSIS_PROTOCOL,
    verification: {
      frozenControls: study.records.length,
      eventIdenticalOnOff: { control: study.records.length, cap2: study.records.length },
      priorProjection: { file: SAVED_REPORT.replaceAll('\\', '/'),
        sha256: createHash('sha256').update(savedBytes).digest('hex'),
        recordsIdentical: study.records.length, protocolsIdentical: all },
    },
    totals: study.totals,
    records: study.records.map((r) => ({ id: r.id, fs: r.fs,
      banks: Object.fromEntries(['control', 'cap2'].map((bank) => [bank, {
        emitted: r.banks[bank].emitted, maturePairedMisses: r.banks[bank].maturePairedMisses,
        matureUnmatched: r.banks[bank].matureUnmatched, energy: study.perRecord[r.id][bank] }])) })),
  };
  if (output) await writeFile(path.resolve(output), `${JSON.stringify(report)}\n`);
  console.log(JSON.stringify(output ? { output, verification: report.verification, totals: report.totals }
    : report, null, 2));
}
