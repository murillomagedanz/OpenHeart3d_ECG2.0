import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FileSource } from '../src/io/fileSource.js';
import { matchBeats, summarizeErrors } from '../src/ecg/scoring.js';
import { root, readLocalRecord, TOLERANCE_S, WARMUP_S } from './validation-report.mjs';
import { traceSource } from './qrs-trace.mjs';

export function falsePositiveTiming(refs, events) {
  let i = 0;
  let previous = 0;
  const fp = [];
  for (const event of events) {
    while (i < refs.length && refs[i] < event.t - TOLERANCE_S) i++;
    if (i < refs.length && Math.abs(refs[i] - event.t) <= TOLERANCE_S) i++;
    else {
      while (previous + 1 < refs.length && refs[previous + 1] <= event.t) previous++;
      fp.push({ event, after: refs[previous] <= event.t ? event.t - refs[previous] : null });
    }
  }
  return {
    n: fp.length,
    within400msOfPreviousReference: fp.filter((x) => x.after !== null && x.after <= 0.4).length,
    searchBack: fp.filter((x) => x.event.searchBack).length,
  };
}

export function totals(items) {
  const sum = items.reduce((a, r) => ({
    tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn,
  }), { tp: 0, fp: 0, fn: 0 });
  return {
    ...sum,
    sensitivity: sum.tp + sum.fn ? sum.tp / (sum.tp + sum.fn) : 0,
    ppv: sum.tp + sum.fp ? sum.tp / (sum.tp + sum.fp) : 0,
  };
}

export function promotionGate(rows, complete) {
  const focus = rows.find((r) => r.id === 'mitdb/228');
  const byDatabase = Object.fromEntries([...new Set(rows.map((r) => r.db))].sort()
    .map((db) => {
      const group = rows.filter((r) => r.db === db);
      return [db, {
        baseline: totals(group.map((r) => r.baseline)),
        experiment: totals(group.map((r) => r.experiment)),
      }];
    }));
  const focusPass = Boolean(focus && focus.experiment.fn <= 205 && focus.experiment.fp <= 19);
  const databasePass = Object.values(byDatabase).every((g) =>
    g.experiment.sensitivity >= g.baseline.sensitivity - 0.005
    && g.experiment.ppv >= g.baseline.ppv - 0.005);
  return { complete, focusPass, databasePass, pilotPass: complete && focusPass && databasePass, byDatabase };
}

export async function compareRecords(ids, options) {
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const baseline = JSON.parse(await readFile(path.join(root, 'data', 'reports', 'validation.json'), 'utf8'));
  const selected = ids.length ? baseline.records.filter((r) => ids.includes(r.id)) : baseline.records;
  const unknown = ids.filter((id) => !baseline.records.some((r) => r.id === id));
  if (unknown.length) throw new Error(`Unknown or unbundled records: ${unknown.join(', ')}`);
  if (!selected.length) throw new Error('No bundled validation records selected');
  const rows = [];
  for (const expected of selected) {
    const entry = manifest.records.find((r) => r.id === expected.id);
    if (!entry) throw new Error(`Record ${expected.id} is absent from the manifest`);
    const { rec } = await readLocalRecord(entry);
    const refs = rec.beats.map((i) => i / rec.header.fs).filter((t) => t >= WARMUP_S);
    const run = (experimentOptions) => {
      const source = new FileSource(rec);
      const { events } = traceSource(source, {
        from: 0, to: source.duration, notchHz: manifest.databases[entry.db].mainsHz,
        captureSamples: false, ...experimentOptions,
      });
      const scored = events.filter((e) => e.t >= WARMUP_S && e.t <= refs.at(-1) + TOLERANCE_S)
        .sort((a, b) => a.t - b.t);
      const s = matchBeats(refs, scored.map((e) => e.t), TOLERANCE_S);
      const fpTiming = falsePositiveTiming(refs, scored);
      if (fpTiming.n !== s.fp) throw new Error('False-positive timing disagrees with scorer');
      return {
        tp: s.tp, fp: s.fp, fn: s.fn,
        falsePositiveTiming: fpTiming,
        latency: summarizeErrors(scored.map((e) => e.latency)),
      };
    };
    const control = run({});
    if (['tp', 'fp', 'fn'].some((key) => control[key] !== expected[key])) {
      throw new Error(`Frozen baseline mismatch: ${expected.id}`);
    }
    rows.push({ id: expected.id, db: expected.db, baseline: control, experiment: run(options) });
  }
  const gate = promotionGate(rows, rows.length === baseline.records.length);
  return {
    records: rows.length,
    overall: {
      baseline: totals(rows.map((r) => r.baseline)),
      experiment: totals(rows.map((r) => r.experiment)),
    },
    ...gate,
    focusedRecords: rows.filter((r) => ['mitdb/228', 'mitdb/207', 'mitdb/108'].includes(r.id)),
    perRecord: rows,
  };
}
