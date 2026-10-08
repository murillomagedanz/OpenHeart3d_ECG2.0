// Avaliação do delineador de ondas P/T contra as anotações por derivação do
// LUDB (docs/specs/001). Compartilhada pelo relatório e pelo ajuste de parâmetros.
// Executar sozinho (`node tests/wave-eval.mjs [tuning|held-out]`) imprime um
// resumo na derivação II, útil para ajustar DEFAULT_WAVE_PARAMS SOMENTE com
// registros de ajuste (id par).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FileSource } from '../src/io/fileSource.js';
import { filterAll } from '../src/ecg/pipeline.js';
import { delineateWaves, DEFAULT_WAVE_PARAMS } from '../src/ecg/waves.js';
import { matchWaves, summarizeMs } from '../src/ecg/waveScoring.js';
import { parseDelineation } from '../src/io/delineation.js';
import { LEAD_NAMES } from '../src/ecg/leads.js';
import { readLocalRecord, splitOf, root } from './validation-report.mjs';

const lower = (n) => n.toLowerCase();

// mode 'detected' = R do detector (ponta a ponta); 'reference' = R anotado
// (isola o delineador do detector).
export function evaluateRecord(entry, rec, files, { params = DEFAULT_WAVE_PARAMS, mode = 'detected', mainsHz = 50 } = {}) {
  const src = new FileSource(rec);
  const fs = src.fs;
  const { events, filtered } = filterAll(src, { notchHz: mainsHz, nLeads: LEAD_NAMES.length });
  const detR = events.map((e) => Math.round(e.t * fs));
  const out = [];
  for (let l = 0; l < LEAD_NAMES.length; l++) {
    const name = lower(LEAD_NAMES[l]);
    const buf = files[`${entry.record}.${name}`];
    if (!buf) continue;
    const ref = parseDelineation(buf);
    const all = [...ref.p, ...ref.qrs, ...ref.t].filter((w) => w.on != null && w.off != null);
    if (!all.length) continue;
    const span = [Math.min(...all.map((w) => w.on)), Math.max(...all.map((w) => w.off))];
    const rIdxs = mode === 'reference' ? ref.qrs.map((w) => w.peak) : detR;
    const beats = delineateWaves(filtered[l], fs, rIdxs, params);
    const dets = { p: beats.filter((b) => b.p).map((b) => b.p), t: beats.filter((b) => b.t).map((b) => b.t) };
    out.push({
      lead: LEAD_NAMES[l],
      p: matchWaves(ref.p, dets.p, fs, span),
      t: matchWaves(ref.t, dets.t, fs, span),
    });
  }
  return out;
}

export function foldResults(items) {
  const acc = { tp: 0, fp: 0, fn: 0, on: [], peak: [], off: [] };
  for (const m of items) {
    acc.tp += m.tp; acc.fp += m.fp; acc.fn += m.fn;
    acc.on.push(...m.errors.on); acc.peak.push(...m.errors.peak); acc.off.push(...m.errors.off);
  }
  return acc;
}

export async function loadLudbEntries() {
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  return { manifest, entries: manifest.records.filter((r) => r.db === 'ludb') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const want = process.argv[2] ?? 'tuning';
  const mode = process.argv[3] ?? 'detected';
  const { manifest, entries } = await loadLudbEntries();
  const all = { p: [], t: [] };
  for (const entry of entries.filter((e) => splitOf(e) === want)) {
    const { rec, files } = await readLocalRecord(entry);
    const res = evaluateRecord(entry, rec, files, { mode, mainsHz: manifest.databases.ludb.mainsHz });
    const ii = res.find((r) => r.lead === 'II');
    if (!ii) continue;
    all.p.push(ii.p); all.t.push(ii.t);
    if (process.argv.includes('-v')) console.log(entry.id.padEnd(9), `P tp${ii.p.tp} fp${ii.p.fp} fn${ii.p.fn}  T tp${ii.t.tp} fp${ii.t.fp} fn${ii.t.fn}`);
  }
  for (const k of ['p', 't']) {
    const a = foldResults(all[k]);
    const f = (v) => { const s = summarizeMs(v); return `${s.mean.toFixed(1)}±${s.sd.toFixed(1)}`; };
    console.log(`${k.toUpperCase()} (${want}, ${mode}, II): tp=${a.tp} fp=${a.fp} fn=${a.fn} sens=${(a.tp / (a.tp + a.fn)).toFixed(3)} ppv=${(a.tp / (a.tp + a.fp)).toFixed(3)} on=${f(a.on)} pico=${f(a.peak)} off=${f(a.off)} ms`);
  }
}
