// Compare the opt-in test-only signal-level decay against the frozen QRS report.
// Usage: node tests/qrs-decay-experiment.mjs [tau-seconds=3] [record-id ...]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FileSource } from '../src/io/fileSource.js';
import { matchBeats } from '../src/ecg/scoring.js';
import { root, readLocalRecord, TOLERANCE_S, WARMUP_S } from './validation-report.mjs';
import { traceSource } from './qrs-trace.mjs';

const [tauArg = '3', ...ids] = process.argv.slice(2);
const tau = Number(tauArg);
if (!Number.isFinite(tau) || tau <= 0) throw new RangeError('tau-seconds must be finite and greater than zero');

const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
const baseline = JSON.parse(await readFile(path.join(root, 'data', 'reports', 'validation.json'), 'utf8'));
const selected = ids.length ? baseline.records.filter((r) => ids.includes(r.id)) : baseline.records;
if (!selected.length || selected.length !== new Set(ids).size && ids.length) {
  const available = new Set(baseline.records.map((r) => r.id));
  const unknown = ids.filter((id) => !available.has(id));
  throw new Error(unknown.length ? `Unknown or unbundled records: ${unknown.join(', ')}` : 'No bundled validation records selected');
}

const rows = [];
for (const expected of selected) {
  const entry = manifest.records.find((r) => r.id === expected.id);
  if (!entry) throw new Error(`Record ${expected.id} is absent from the manifest`);
  const { rec } = await readLocalRecord(entry);
  const source = new FileSource(rec);
  const trace = traceSource(source, {
    from: 0, to: source.duration, notchHz: manifest.databases[entry.db].mainsHz,
    signalDecayTauS: tau, captureSamples: false,
  });
  const refs = rec.beats.map((i) => i / source.fs).filter((t) => t >= WARMUP_S);
  const dets = trace.events.map((e) => e.t).filter((t) => t >= WARMUP_S && t <= refs.at(-1) + TOLERANCE_S);
  const score = matchBeats(refs, dets, TOLERANCE_S);
  rows.push({
    id: expected.id, db: expected.db,
    baseline: { tp: expected.tp, fp: expected.fp, fn: expected.fn },
    experiment: { tp: score.tp, fp: score.fp, fn: score.fn },
  });
}

function totals(items) {
  const sum = items.reduce((a, r) => ({
    tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn,
  }), { tp: 0, fp: 0, fn: 0 });
  return {
    ...sum,
    sensitivity: +(sum.tp / (sum.tp + sum.fn)).toFixed(4),
    ppv: +(sum.tp / (sum.tp + sum.fp)).toFixed(4),
  };
}

const summary = (records) => ({
  baseline: totals(records.map((r) => r.baseline)),
  experiment: totals(records.map((r) => r.experiment)),
});
const byDatabase = Object.fromEntries([...new Set(rows.map((r) => r.db))]
  .sort().map((db) => [db, summary(rows.filter((r) => r.db === db))]));
const regressions = [...rows]
  .map((r) => ({ ...r, deltaFp: r.experiment.fp - r.baseline.fp, deltaFn: r.experiment.fn - r.baseline.fn }))
  .sort((a, b) => b.deltaFp - a.deltaFp || a.id.localeCompare(b.id))
  .slice(0, 10);

console.log(JSON.stringify({
  experiment: 'test-only exponential signalLevel decay toward noiseLevel between candidates',
  signalDecayTauS: tau,
  records: rows.length,
  overall: summary(rows),
  byDatabase,
  focusedRecords: rows.filter((r) => ['mitdb/228', 'mitdb/207', 'mitdb/108'].includes(r.id)),
  largestFalsePositiveIncreases: regressions,
}, null, 2));
