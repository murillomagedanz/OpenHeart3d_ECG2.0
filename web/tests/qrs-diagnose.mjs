// Diagnóstico por evento do detector de QRS (docs/specs/002). Lista, por registro,
// os falsos positivos/negativos agrupados em episódios, com o símbolo de batimento
// e a anotação de ritmo vigentes. Só leitura: não altera o detector nem os relatórios.
// Uso: node tests/qrs-diagnose.mjs mitdb/207 [mitdb/108 ...]

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { FileSource } from '../src/io/fileSource.js';
import { detectAll } from '../src/ecg/pipeline.js';
import { matchBeats } from '../src/ecg/scoring.js';
import { BEAT_SYMBOLS } from '../src/io/wfdb.js';
import { LEAD_NAMES } from '../src/ecg/leads.js';
import { readLocalRecord, root, TOLERANCE_S, WARMUP_S } from './validation-report.mjs';

const GAP_S = 2; // erros separados por menos que isso formam um episódio

function pair(refs, dets, tol) {
  const hitR = new Set();
  const hitD = new Set();
  let i = 0;
  let j = 0;
  while (i < refs.length && j < dets.length) {
    const diff = dets[j] - refs[i];
    if (Math.abs(diff) <= tol) { hitR.add(i); hitD.add(j); i++; j++; } else if (diff < 0) j++; else i++;
  }
  return {
    fn: refs.map((t, k) => ({ t, k })).filter((x) => !hitR.has(x.k)),
    fp: dets.map((t, k) => ({ t, k })).filter((x) => !hitD.has(x.k)),
  };
}

function episodes(items) {
  const eps = [];
  for (const it of items.sort((a, b) => a.t - b.t)) {
    const last = eps.at(-1);
    if (last && it.t - last.end <= GAP_S) { last.end = it.t; last.n++; } else eps.push({ start: it.t, end: it.t, n: 1 });
  }
  return eps;
}

export async function diagnose(id) {
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const entry = manifest.records.find((r) => r.id === id);
  if (!entry) throw new Error(`registro ${id} não está no manifesto`);
  const { rec } = await readLocalRecord(entry);
  const src = new FileSource(rec);
  const fs = src.fs;
  const refs = rec.beats.map((i) => i / fs).filter((t) => t >= WARMUP_S);
  const until = refs.at(-1) + TOLERANCE_S;
  const dets = detectAll(src, { notchHz: manifest.databases[entry.db].mainsHz, nLeads: LEAD_NAMES.length })
    .events.map((e) => e.t).filter((t) => t >= WARMUP_S && t <= until);
  const m = matchBeats(refs, dets, TOLERANCE_S);
  const { fn, fp } = pair(refs, dets, TOLERANCE_S);

  const anns = rec.annotations;
  const rhythmAt = (t) => {
    let r = '';
    for (const a of anns) { if (a.sample / fs > t) break; if (a.symbol === '+' && a.aux) r = String(a.aux).replace(/\0/g, ''); }
    return r;
  };
  const nonBeat = (t0, t1) => anns.filter((a) => !BEAT_SYMBOLS.has(a.symbol) && a.sample / fs >= t0 - 1 && a.sample / fs <= t1 + 1).map((a) => a.symbol).join('');
  const symAt = (t) => {
    const near = anns.filter((a) => BEAT_SYMBOLS.has(a.symbol) && Math.abs(a.sample / fs - t) < 0.5);
    return near.map((a) => a.symbol).join('') || '-';
  };
  const describe = (eps, items) => eps.map((e) => ({
    from: +e.start.toFixed(1), to: +e.end.toFixed(1), n: e.n,
    rhythm: rhythmAt(e.start), marks: nonBeat(e.start, e.end),
    beats: [...new Set(items.filter((x) => x.t >= e.start && x.t <= e.end).map((x) => symAt(x.t)))].join(','),
  })).sort((a, b) => b.n - a.n);
  const fnEps = describe(episodes([...fn]), fn);
  const fpEps = describe(episodes([...fp]), fp);
  const share = (eps, total) => (eps.slice(0, 3).reduce((a, e) => a + e.n, 0) / Math.max(1, total));
  return {
    id, fs, ref: refs.length, tp: m.tp, fp: fp.length, fn: fn.length,
    fnTop3Share: +share(fnEps, fn.length).toFixed(2), fpTop3Share: +share(fpEps, fp.length).toFixed(2),
    fnEpisodes: fnEps.slice(0, 6), fpEpisodes: fpEps.slice(0, 6),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith('qrs-diagnose.mjs')) {
  for (const id of process.argv.slice(2)) console.log(JSON.stringify(await diagnose(id), null, 1));
}
