// Research-only below-opening stratum. Annotations enter only after replay.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BEAT_SYMBOLS } from '../src/io/wfdb.js';
import { matchBeats } from '../src/ecg/scoring.js';
import { root, readLocalRecord, WARMUP_S, TOLERANCE_S } from './validation-report.mjs';
import { replay, causalVector, labelEvents } from './qrs-morphology.mjs';
import { SHADOW_PROTOCOL } from './qrs-shadow-bank.mjs';

export const QUERY_PROTOCOL = Object.freeze({
  version: 1, maximum: 'positive MWI; previous < peak >= next; peak <= pre-step opening half-threshold',
  alignment: 'earliest absolute bandpass maximum in trailing MWI window',
  timing: 'first available sample after confirmation and complete aligned +/-80ms vector; before current emission learning',
  scope: 'all signal-derived below-opening maxima after calibration, including refractory/candidate neighborhoods',
  scoring: 'posthoc +/-150ms; unique baseline misses; mature proposals greedy one-to-one to baseline misses',
  intervalS: 30,
});

export class OpportunityMonitor {
  constructor() {
    this.history = [];
    this.pending = [];
    this.rows = [];
    this.invalidated = 0;
    this.enumerated = 0;
  }

  notifyGap() {
    this.invalidated += this.pending.length;
    this.history = [];
    this.pending = [];
  }

  step({ sample, bp, detector: d, openingThreshold, bank }) {
    const frame = { index: sample.index, t: sample.t, feat: d.mwiSum / d.mwiLen,
      openingThreshold, calibrated: d.n >= d.fs };
    this.history.push(frame);
    if (this.history.length > 3) this.history.shift();
    if (this.history.length === 3) {
      const [a, b, c] = this.history;
      if (b.calibrated && b.feat > 0 && Number.isFinite(b.feat)
        && b.feat <= b.openingThreshold && a.feat < b.feat && b.feat >= c.feat) {
        this.enumerated++;
        const start = b.index - d.mwiLen + 1;
        let center = b.index;
        let aligned = start >= 0;
        if (aligned) {
          center = start;
          for (let i = start; i <= b.index; i++) {
            if (!Number.isFinite(bp[i])) { aligned = false; break; }
            if (Math.abs(bp[i]) > Math.abs(bp[center])) center = i;
          }
        }
        this.pending.push({ t: center / d.fs - d.groupDelay, center,
          peakT: b.t, ratio: b.feat / b.openingThreshold, aligned });
      }
    }
    const radius = Math.round(SHADOW_PROTOCOL.windowRadiusS * d.fs);
    const waiting = [];
    for (const opportunity of this.pending) {
      if (opportunity.aligned && opportunity.center + radius > sample.index) {
        waiting.push(opportunity);
        continue;
      }
      const vector = opportunity.aligned
        ? causalVector(bp, opportunity.center / d.fs, d.fs, sample.index) : null;
      this.rows.push({ ...opportunity, queriedAt: sample.t, query: bank.query(vector, sample.t) });
    }
    this.pending = waiting;
  }
}

const STATUSES = ['cold-start', 'immature-match', 'no-match', 'unavailable', 'mature-match'];
const symbols = (refs) => {
  const counts = {};
  for (const ref of refs) counts[ref.symbol] = (counts[ref.symbol] ?? 0) + 1;
  return counts;
};

export function summarizeQueries(refs, missed, queries) {
  const covered = new Set();
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, new Set()]));
  const nearbySymbols = {};
  let rawNearby = 0;
  let rawMissedNearby = 0;
  let cursor = 0;
  const sorted = [...queries].sort((a, b) => a.t - b.t);
  const missedSet = new Set(missed);
  for (const row of sorted) {
    while (cursor < refs.length && refs[cursor].t < row.t - TOLERANCE_S) cursor++;
    let nearby = false;
    let missedNearby = false;
    for (let j = cursor; j < refs.length && refs[j].t <= row.t + TOLERANCE_S; j++) {
      nearby = true;
      const ref = refs[j];
      nearbySymbols[ref.symbol] = (nearbySymbols[ref.symbol] ?? 0) + 1;
      if (missedSet.has(ref)) {
        missedNearby = true;
        covered.add(ref);
        byStatus[row.query.status].add(ref);
      }
    }
    if (nearby) rawNearby++;
    if (missedNearby) rawMissedNearby++;
  }
  const mature = sorted.filter((q) => q.query.status === 'mature-match');
  const pairing = labelEvents(missed, mature);
  const paired = pairing.filter((p) => p.reference).map((p) => p.reference);
  const unmatched = pairing.filter((p) => !p.reference);
  const near = (rs, t) => rs.some((r) => Math.abs(r.t - t) <= TOLERANCE_S);
  const duplicateMissNeighborhood = unmatched.filter((p) => near(missed, p.event.t)).length;
  const alreadyDetectedNeighborhood = unmatched.filter((p) =>
    !near(missed, p.event.t) && near(refs, p.event.t)).length;
  return {
    queries: queries.length,
    statuses: Object.fromEntries(STATUSES.map((s) => [s, queries.filter((q) => q.query.status === s).length])),
    rawReferenceNearby: rawNearby, rawMissedReferenceNearby: rawMissedNearby,
    rawReferenceSymbolIncidences: nearbySymbols,
    missed: missed.length, missedSymbols: symbols(missed),
    uniqueMissedNearby: covered.size, uniqueMissedNearbySymbols: symbols([...covered]),
    uniqueMissedByStatus: Object.fromEntries(STATUSES.map((s) =>
      [s, { n: byStatus[s].size, symbols: symbols([...byStatus[s]]) }])),
    maturePairedMisses: paired.length, maturePairedMissSymbols: symbols(paired),
    matureUnmatched: unmatched.length,
    matureUnmatchedStrata: { duplicateMissNeighborhood, alreadyDetectedNeighborhood,
      noReferenceNeighborhood: unmatched.length - duplicateMissNeighborhood - alreadyDetectedNeighborhood },
  };
}

const plainEvents = (r) => r.events.map(({ causal, shadow, ...event }) => event);
const score = (refs, events) => {
  const result = matchBeats(refs.map((r) => r.t), events.map((e) => e.t), TOLERANCE_S);
  return { tp: result.tp, fp: result.fp, fn: result.fn };
};

export async function investigateQueries(entry, manifest, expected) {
  const { rec } = await readLocalRecord(entry);
  const refs = rec.annotations.filter((a) => BEAT_SYMBOLS.has(a.symbol))
    .map((a) => ({ t: a.sample / rec.header.fs, symbol: a.symbol })).filter((r) => r.t >= WARMUP_S);
  if (!refs.length) throw new Error(`No beat references: ${entry.id}`);
  const until = refs.at(-1).t + TOLERANCE_S;
  const banks = {};
  for (const [name, capped] of [['control', false], ['cap2', true]]) {
    const monitor = new OpportunityMonitor();
    const on = replay(rec, manifest.databases[entry.db].mainsHz, capped, true, monitor);
    const off = replay(rec, manifest.databases[entry.db].mainsHz, capped, false);
    if (JSON.stringify(plainEvents(on)) !== JSON.stringify(plainEvents(off))) {
      throw new Error(`Query changed emitted events: ${entry.id} ${name}`);
    }
    const events = on.events.filter((e) => e.t >= WARMUP_S && e.t <= until);
    const emitted = score(refs, events);
    if (!capped && ['tp', 'fp', 'fn'].some((k) => emitted[k] !== expected[k])) {
      throw new Error(`Frozen control mismatch: ${entry.id}`);
    }
    const hits = new Set(labelEvents(refs, events).filter((p) => p.reference).map((p) => p.reference));
    if (hits.size !== emitted.tp) throw new Error(`Baseline labels mismatch: ${entry.id} ${name}`);
    const missed = refs.filter((r) => !hits.has(r));
    const queries = monitor.rows.filter((q) => q.t >= WARMUP_S && q.t <= until);
    banks[name] = { emitted, ...summarizeQueries(refs, missed, queries),
      lifecycle: { enumeratedFullRecord: monitor.enumerated, queriedFullRecord: monitor.rows.length,
        invalidatedPending: monitor.invalidated, pendingAtEof: monitor.pending.length },
      emissionBank: on.shadowStats };
    if (['mitdb/108', 'mitdb/207'].includes(entry.id)) {
      banks[name].intervals = [];
      for (let from = 0; from <= until; from += QUERY_PROTOCOL.intervalS) {
        const to = from + QUERY_PROTOCOL.intervalS;
        const subset = queries.filter((q) => q.t >= from && q.t < to);
        const intervalMisses = missed.filter((r) => r.t >= from && r.t < to);
        banks[name].intervals.push({ from, to, ...summarizeQueries(refs, intervalMisses, subset) });
      }
    }
  }
  return { id: entry.id, fs: rec.header.fs, banks };
}

export function aggregateResults(records) {
  const add = (a, b) => {
    for (const [key, value] of Object.entries(b)) {
      if (typeof value === 'number') a[key] = (a[key] ?? 0) + value;
      else if (value && !Array.isArray(value) && typeof value === 'object') add(a[key] ??= {}, value);
    }
    return a;
  };
  return Object.fromEntries(['control', 'cap2'].map((name) => [name, records.reduce((a, r) => {
    const { intervals, ...bank } = r.banks[name];
    return add(a, bank);
  }, {})]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const output = outputIndex >= 0 ? args.splice(outputIndex, 2)[1] : null;
  if (!args.length || (args.includes('--all') && args.length !== 1) || (outputIndex >= 0 && !output)) {
    throw new Error('Usage: node tests\\qrs-subthreshold-query.mjs --all|record-id [...] [--output path]');
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const frozen = JSON.parse(await readFile(path.join(root, 'data', 'reports', 'validation.json'), 'utf8'));
  const selected = args[0] === '--all' ? frozen.records : args.map((id) => {
    const record = frozen.records.find((r) => r.id === id);
    if (!record) throw new Error(`Unknown frozen record: ${id}`);
    return record;
  });
  const records = [];
  for (const expected of selected) {
    const entry = manifest.records.find((r) => r.id === expected.id && r.bundled);
    if (!entry) throw new Error(`Unbundled record: ${expected.id}`);
    records.push(await investigateQueries(entry, manifest, expected));
  }
  const report = { schema: 'openheart3d.ecg.subthreshold-shadow-query', version: 1,
    shadowProtocol: SHADOW_PROTOCOL, queryProtocol: QUERY_PROTOCOL,
    verification: { frozenControls: records.length, eventIdenticalOnOff: { control: records.length, cap2: records.length } },
    totals: aggregateResults(records), records };
  if (output) await writeFile(path.resolve(output), `${JSON.stringify(report)}\n`);
  console.log(JSON.stringify(output ? { output, verification: report.verification, totals: report.totals } : report, null, 2));
}
