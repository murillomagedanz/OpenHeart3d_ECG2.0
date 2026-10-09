// Research-only shift ablation. Shifted vectors are read-only queries against the same bank snapshot at the
// original query instant; annotations enter only in posthoc scoring, never in selection or bank state.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, TOLERANCE_S } from './validation-report.mjs';
import { causalVector } from './qrs-morphology.mjs';
import { SHADOW_PROTOCOL } from './qrs-shadow-bank.mjs';
import { OpportunityMonitor, QUERY_PROTOCOL, classifyMature, summarizeQueries } from './qrs-subthreshold-query.mjs';
import { runContextStudy, verifyPriorProjections, CONTEXT_PROTOCOL } from './qrs-support-emission-context.mjs';

export const ALIGNMENT_PROTOCOL = Object.freeze({
  version: 1,
  shiftsMs: Object.freeze([-20, -10, 0, 10, 20]),
  samples: 'sign(ms)*round(|ms|*fs/1000); positive = later center; no padding, no future, original query instant',
  selection: 'highest signed similarity among available shifts with live templates; tie smaller |ms| then earlier; fallback shift 0',
  primary: 'shape-only: original estimated timestamp and scoring labels fixed',
  secondary: 'shifted-center timestamp t + selectedSamples/fs, separate denominators',
  burdenBaseline: Object.freeze({ unmatched: 14949, paired: 92 }),
  closure: { minNetGain: 10, minNon228Records: 3, minPerRecordNet: 3,
    burden: 'marginal (shiftedUnmatched-baselineUnmatched)/netGain <= baselineUnmatched/baselinePaired; non-positive delta passes' },
  intervalS: 30,
});

const STATUS_RANK = { unavailable: 0, 'cold-start': 1, 'no-match': 2, 'immature-match': 3, 'mature-match': 4 };
const STATUSES = Object.keys(STATUS_RANK);
const STRATA = ['nearMissed', 'nearDetectedOnly', 'noReference'];
const BIN_ORDER = ['<0.5', '[0.5,0.7)', '[0.7,0.8)', '[0.8,0.9)', '>=0.9', 'none'];

export const shiftSamples = (ms, fs) => (ms < 0 ? -1 : ms > 0 ? 1 : 0) * Math.round(Math.abs(ms) * fs / 1000);

export function bankState(bank, time) {
  const live = bank.templates.filter((t) => t.lastSeen < time && time - t.lastSeen <= SHADOW_PROTOCOL.expireS);
  return { live: live.length, matureLive: live.filter((t) => t.count >= SHADOW_PROTOCOL.matureAfter).length };
}
const bankCategory = (s) => (s.live === 0 ? 'noLive' : s.matureLive === 0 ? 'liveNoMature' : 'liveMature');

const order = (a, b) => Math.abs(a.ms) - Math.abs(b.ms) || a.ms - b.ms;
export function selectShift(shifts, baseline) {
  const available = shifts.filter((s) => s.vectorAvailable);
  const live = available.filter((s) => Number.isFinite(s.query.similarity));
  if (live.length) {
    return live.reduce((best, s) => (s.query.similarity > best.query.similarity
      || (s.query.similarity === best.query.similarity && order(s, best) < 0) ? s : best));
  }
  const zero = available.find((s) => s.ms === 0);
  if (zero) return zero;
  if (available.length) return [...available].sort(order)[0];
  return { ms: 0, samples: 0, vectorAvailable: false, query: baseline };
}

export class AlignmentMonitor extends OpportunityMonitor {
  constructor(shiftsMs = ALIGNMENT_PROTOCOL.shiftsMs) {
    super();
    this.shiftsMs = shiftsMs;
  }

  step(args) {
    const before = this.rows.length;
    super.step(args);
    const { bp, bank, detector: d, sample } = args;
    for (let i = before; i < this.rows.length; i++) {
      const row = this.rows[i];
      row.fs = d.fs;
      row.queryIndex = sample.index;
      row.bankState = bankState(bank, row.queriedAt);
      row.shifts = this.shiftsMs.map((ms) => {
        const samples = shiftSamples(ms, d.fs);
        const vector = row.aligned ? causalVector(bp, (row.center + samples) / d.fs, d.fs, sample.index) : null;
        if (ms === 0) return { ms, samples, vectorAvailable: vector !== null, query: row.query };
        return { ms, samples, vectorAvailable: vector !== null,
          query: vector ? bank.query(vector, row.queriedAt) : null };
      });
    }
  }
}

const bump = (obj, key, n = 1) => { obj[key] = (obj[key] ?? 0) + n; };
const symbolCounts = (refs) => {
  const counts = {};
  for (const ref of refs) bump(counts, ref.symbol);
  return counts;
};
const simBin = (s) => (!Number.isFinite(s) ? 'none' : s < 0.5 ? '<0.5' : s < 0.7 ? '[0.5,0.7)'
  : s < 0.8 ? '[0.7,0.8)' : s < 0.9 ? '[0.8,0.9)' : '>=0.9');

const lowerBound = (sorted, t) => {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return lo;
};
const nearIn = (sorted, t) => {
  const out = [];
  for (let i = lowerBound(sorted, t - TOLERANCE_S); i < sorted.length && sorted[i].t <= t + TOLERANCE_S; i++) out.push(sorted[i]);
  return out;
};

const pairedSet = (classified) => new Set(classified.filter((p) => p.reference).map((p) => p.reference));

// Per unique miss: overlapping flags, an exclusive hierarchy and the best nearby signed similarity.
export function decompose(missed, rows, paired) {
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  const flags = { noNearbyOpportunity: 0, nearby: 0, onlyNoLiveTemplate: 0, anyLiveTemplate: 0,
    anyMatureBankTemplate: 0, anyNoMatch: 0, anyImmatureMatch: 0, anyMatureMatch: 0 };
  const hierarchy = { noNearbyOpportunity: 0, noLiveTemplate: 0, liveNoMatch: 0, immatureMatch: 0,
    matureUnpaired: 0, maturePaired: 0 };
  const hierarchyBankMature = { liveNoMatch: 0, immatureMatch: 0 };
  const similarityBins = Object.fromEntries(BIN_ORDER.map((k) => [k, 0]));
  const classes = new Map();
  for (const ref of missed) {
    const near = nearIn(sorted, ref.t);
    let cls;
    if (!near.length) {
      flags.noNearbyOpportunity++;
      cls = 'noNearbyOpportunity';
      similarityBins.none++;
    } else {
      flags.nearby++;
      const ranks = near.map((r) => STATUS_RANK[r.query.status]);
      const best = Math.max(...ranks);
      const bankMature = near.some((r) => r.bankState?.matureLive > 0);
      if (best <= 1) { flags.onlyNoLiveTemplate++; cls = 'noLiveTemplate'; } else flags.anyLiveTemplate++;
      if (bankMature) flags.anyMatureBankTemplate++;
      if (ranks.includes(2)) flags.anyNoMatch++;
      if (ranks.includes(3)) flags.anyImmatureMatch++;
      if (ranks.includes(4)) flags.anyMatureMatch++;
      if (best === 4) cls = paired.has(ref) ? 'maturePaired' : 'matureUnpaired';
      else if (best === 3) cls = 'immatureMatch';
      else if (best === 2) cls = 'liveNoMatch';
      if (bankMature && hierarchyBankMature[cls] !== undefined) hierarchyBankMature[cls]++;
      const sims = near.map((r) => r.query.similarity).filter(Number.isFinite);
      similarityBins[simBin(sims.length ? Math.max(...sims) : null)]++;
    }
    hierarchy[cls]++;
    classes.set(ref, cls);
  }
  return { flags, hierarchy, hierarchyBankMature, similarityBins, classes };
}

const rank = (status) => STATUS_RANK[status];
function addTransition(t, before, after) {
  bump(t.matrix, `${before}>${after}`);
  bump(t, rank(after) > rank(before) ? 'improved' : rank(after) < rank(before) ? 'regressed' : 'unchanged');
}
const newTransition = () => ({ matrix: {}, improved: 0, unchanged: 0, regressed: 0 });
const shiftKey = (ms) => (ms > 0 ? `+${ms}` : `${ms}`);

export function analyzeBank({ refs, missed, queries, classified }) {
  const missedSet = new Set(missed);
  const sorted = [...refs].sort((a, b) => a.t - b.t);
  const selected = queries.map((r) => selectShift(r.shifts, r.query));
  const primaryRows = queries.map((r, i) => ({ ...r, query: selected[i].query }));
  const secondaryRows = queries.map((r, i) => ({ ...r, t: r.t + selected[i].samples / r.fs, query: selected[i].query }));
  const baselinePaired = pairedSet(classified);
  const primaryClassified = classifyMature(refs, missed, primaryRows);
  const secondaryClassified = classifyMature(refs, missed, secondaryRows);
  const strip = (s, cl, paired) => {
    const gained = [...paired].filter((ref) => !baselinePaired.has(ref));
    const lost = [...baselinePaired].filter((ref) => !paired.has(ref));
    return { queries: s.queries, statuses: s.statuses, uniqueMissedNearby: s.uniqueMissedNearby,
      uniqueMissedByStatus: s.uniqueMissedByStatus,
      paired: paired.size, pairedSymbols: symbolCounts([...paired]), unmatched: s.matureUnmatched,
      unmatchedStrata: s.matureUnmatchedStrata, gained: gained.length, gainedSymbols: symbolCounts(gained),
      lost: lost.length, lostSymbols: symbolCounts(lost), net: paired.size - baselinePaired.size,
      deltaUnmatched: s.matureUnmatched - classified.filter((p) => !p.reference).length };
  };
  const primaryPaired = pairedSet(primaryClassified);
  const secondaryPaired = pairedSet(secondaryClassified);
  const primary = strip(summarizeQueries(refs, missed, primaryRows, primaryClassified), primaryClassified, primaryPaired);
  const secondary = strip(summarizeQueries(refs, missed, secondaryRows, secondaryClassified), secondaryClassified, secondaryPaired);

  const transitions = { all: newTransition(), nearMissed: newTransition(), allShiftsAvailable: newTransition() };
  const conversion = Object.fromEntries(STRATA.map((s) => [s, { rows: 0, baselineNonMature: 0, convertedToMature: 0, shiftedMature: 0 }]));
  const availability = { all: {}, nearMissed: {} };
  const lag = { all: {}, shiftedMature: {}, convertedNearMissed: {} };
  const bankMaturity = { all: {}, nearMissed: {}, convertedNearMissed: {} };
  queries.forEach((row, i) => {
    const near = nearIn(sorted, row.t);
    const stratum = near.some((r) => missedSet.has(r)) ? 'nearMissed' : near.length ? 'nearDetectedOnly' : 'noReference';
    const before = row.query.status;
    const sel = selected[i];
    const after = sel.query.status;
    const key = shiftKey(sel.ms);
    addTransition(transitions.all, before, after);
    if (stratum === 'nearMissed') addTransition(transitions.nearMissed, before, after);
    if (row.shifts.every((s) => s.vectorAvailable)) addTransition(transitions.allShiftsAvailable, before, after);
    const c = conversion[stratum];
    c.rows++;
    if (before !== 'mature-match') {
      c.baselineNonMature++;
      if (after === 'mature-match') c.convertedToMature++;
    }
    if (after === 'mature-match') c.shiftedMature++;
    for (const s of row.shifts) {
      bump(availability.all, `${shiftKey(s.ms)}:${s.vectorAvailable ? 'available' : 'unavailable'}`);
      if (stratum === 'nearMissed') bump(availability.nearMissed, `${shiftKey(s.ms)}:${s.vectorAvailable ? 'available' : 'unavailable'}`);
    }
    const cat = bankCategory(row.bankState);
    bump(lag.all, key);
    bump(bankMaturity.all, cat);
    if (stratum === 'nearMissed') bump(bankMaturity.nearMissed, cat);
    if (after === 'mature-match') bump(lag.shiftedMature, key);
    if (stratum === 'nearMissed' && before !== 'mature-match' && after === 'mature-match') {
      bump(lag.convertedNearMissed, key);
      bump(bankMaturity.convertedNearMissed, cat);
    }
  });
  const base = decompose(missed, queries, baselinePaired);
  const shifted = decompose(missed, primaryRows, primaryPaired);
  const cross = {};
  for (const ref of missed) bump(cross, `${base.classes.get(ref)}>${shifted.classes.get(ref)}`);
  const { classes: _b, ...baseline } = base;
  const { classes: _s, ...shiftedDecomposition } = shifted;
  return {
    baseline: { queries: queries.length, paired: baselinePaired.size, pairedSymbols: symbolCounts([...baselinePaired]),
      unmatched: classified.filter((p) => !p.reference).length, misses: missed.length, missSymbols: symbolCounts(missed) },
    primary, secondary, transitions, conversion, availability, lag, bankMaturity,
    decomposition: { baseline, shifted: shiftedDecomposition, cross },
    detail: { selected, primaryClassified, baselinePaired, primaryPaired },
  };
}

export function intervalSummaries(analysis, queries, classified, missed, until) {
  const out = [];
  const { primaryClassified, baselinePaired, primaryPaired } = analysis.detail;
  const refsIn = (set, from, to) => [...set].filter((r) => r.t >= from && r.t < to).length;
  for (let from = 0; from <= until; from += ALIGNMENT_PROTOCOL.intervalS) {
    const to = from + ALIGNMENT_PROTOCOL.intervalS;
    const inside = (row) => row.t >= from && row.t < to;
    out.push({ from, to, queries: queries.filter(inside).length,
      misses: missed.filter((r) => r.t >= from && r.t < to).length,
      baselinePaired: refsIn(baselinePaired, from, to), shiftedPaired: refsIn(primaryPaired, from, to),
      baselineUnmatched: classified.filter((p) => !p.reference && inside(p.row)).length,
      shiftedUnmatched: primaryClassified.filter((p) => !p.reference && inside(p.row)).length });
  }
  return out;
}

const add = (a, b) => {
  for (const [key, value] of Object.entries(b)) {
    if (typeof value === 'number') a[key] = (a[key] ?? 0) + value;
    else if (value && !Array.isArray(value) && typeof value === 'object') add(a[key] ??= {}, value);
  }
  return a;
};
const compact = ({ detail, ...analysis }) => analysis;

export function evaluateAlignmentClosure(byRecord) {
  const c = ALIGNMENT_PROTOCOL.closure;
  const entries = [...byRecord];
  const sum = (key, filter = () => true) => entries.filter(([id]) => filter(id)).reduce((n, [, r]) => n + r.primary[key], 0);
  const baselinePaired = entries.reduce((n, [, r]) => n + r.baseline.paired, 0);
  const baselineUnmatched = entries.reduce((n, [, r]) => n + r.baseline.unmatched, 0);
  const net = sum('net');
  const deltaUnmatched = sum('deltaUnmatched');
  const reference = baselineUnmatched / baselinePaired;
  const non228 = entries.filter(([id]) => id !== 'mitdb/228');
  const replicating = non228.filter(([, r]) => r.primary.net >= c.minPerRecordNet).map(([id, r]) => ({ id, net: r.primary.net }));
  const gainMet = net >= c.minNetGain;
  const replicationMet = replicating.length >= c.minNon228Records;
  const marginal = net > 0 ? deltaUnmatched / net : null;
  const burdenMet = net > 0 && (deltaUnmatched <= 0 || marginal <= reference);
  const met = gainMet && replicationMet && burdenMet;
  return { baselinePaired, baselineUnmatched, baselineUnmatchedPerPair: reference,
    shiftedPaired: baselinePaired + net, netGain: net, grossGained: sum('gained'), grossLost: sum('lost'),
    netGainNon228: sum('net', (id) => id !== 'mitdb/228'), deltaUnmatched, marginalBurdenPerNetGain: marginal,
    averageShiftedBurdenPerPair: (baselineUnmatched + deltaUnmatched) / (baselinePaired + net),
    replicatingNon228Records: replicating, criteria: { gainMet, replicationMet, burdenMet },
    outcome: met ? 'descriptive-positive-limited' : 'not-met-alignment-alone-insufficient-stop',
    reasons: [...(gainMet ? [] : ['net gain < 10']), ...(replicationMet ? [] : ['fewer than 3 non-228 records with net >= 3']),
      ...(burdenMet ? [] : ['marginal burden per net gain above baseline']) ] };
}

export async function runAlignmentStudy(selected, manifest) {
  const perRecord = { control: new Map(), cap2: new Map() };
  const intervals = { control: new Map(), cap2: new Map() };
  const keep = new Set(['mitdb/108', 'mitdb/207']);
  const study = await runContextStudy(selected, manifest, {
    createMonitor: () => new AlignmentMonitor(),
    onBank: ({ bank, id, classified, queries, refs, missed }) => {
      const analysis = analyzeBank({ refs, missed, queries, classified });
      if (keep.has(id)) {
        intervals[bank].set(id, intervalSummaries(analysis, queries, classified, missed, refs.at(-1).t + TOLERANCE_S));
      }
      perRecord[bank].set(id, compact(analysis));
    },
  });
  const totals = {};
  const without228 = {};
  for (const bank of ['control', 'cap2']) {
    totals[bank] = [...perRecord[bank].values()].reduce(add, {});
    without228[bank] = [...perRecord[bank]].filter(([id]) => id !== 'mitdb/228').reduce((a, [, r]) => add(a, r), {});
  }
  const closure = Object.fromEntries(['control', 'cap2'].map((b) => [b, evaluateAlignmentClosure(perRecord[b])]));
  const records = selected.map(({ id }) => ({ id,
    banks: Object.fromEntries(['control', 'cap2'].map((b) => [b, { ...perRecord[b].get(id),
      ...(intervals[b].has(id) ? { intervals: intervals[b].get(id) } : {}) }])) }));
  return { study, totals, without228, closure, records };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const index = args.indexOf('--output');
  const output = index >= 0 ? args.splice(index, 2)[1] : null;
  if (!args.length || (args.includes('--all') && args.length !== 1) || (index >= 0 && !output)) {
    throw new Error('Usage: node tests\\qrs-alignment-audit.mjs --all|record-id [...] [--output path]');
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const frozen = JSON.parse(await readFile(path.join(root, 'data', 'reports', 'validation.json'), 'utf8'));
  const all = args[0] === '--all';
  const selected = all ? frozen.records : args.map((id) => {
    const r = frozen.records.find((record) => record.id === id);
    if (!r) throw new Error(`Unknown frozen record: ${id}`);
    return r;
  });
  const files = ['2026-10-08-template-energy-shadow-results.json', '2026-10-08-subthreshold-shadow-query-results.json',
    '2026-10-08-support-emission-context-results.json'];
  const bytes = await Promise.all(files.map((file) => readFile(path.join(root, '..', 'docs', 'plans', file))));
  const [savedEnergy, savedQuery, savedContext] = bytes.map((b) => JSON.parse(b.toString('utf8')));
  const { study, totals, without228, closure, records } = await runAlignmentStudy(selected, manifest);
  const projection = verifyPriorProjections(study, savedEnergy, savedQuery, all);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const savedById = new Map(savedContext.records.map((r) => [r.id, r]));
  const contextIdentical = study.records.every((r) => same(r, savedById.get(r.id)))
    && same(CONTEXT_PROTOCOL, savedContext.contextProtocol)
    && (!all || (same(study.totals, savedContext.totals) && same(study.closure, savedContext.closure)
      && same(study.excluding228Diagnostic, savedContext.excluding228Diagnostic)));
  if (!contextIdentical) throw new Error('Prior context projection changed');
  const report = {
    schema: 'openheart3d.ecg.coverage-alignment-audit', version: 1,
    shadowProtocol: SHADOW_PROTOCOL, queryProtocol: QUERY_PROTOCOL, alignmentProtocol: ALIGNMENT_PROTOCOL,
    verification: { frozenControls: selected.length, eventIdenticalOnOff: { control: selected.length, cap2: selected.length },
      priorProjections: files.map((file, i) => ({ file: `docs/plans/${file}`,
        sha256: createHash('sha256').update(bytes[i]).digest('hex'), recordsIdentical: selected.length,
        protocolsIdentical: true, totalsIdentical: all })),
      contextProjectionIdentical: true, projection },
    closure, totals, excluding228Diagnostic: without228, records,
  };
  if (output) await writeFile(path.resolve(output), `${JSON.stringify(report)}\n`);
  console.log(JSON.stringify(output ? { output, verification: report.verification, closure } : report, null, 2));
}
