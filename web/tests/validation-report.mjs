// Relatório de validação reprodutível do detector de QRS (docs/specs/001).
// Roda o MESMO SignalPipeline da interface sobre os registros anotados incluídos
// no repositório e grava web/data/reports/validation.{json,md}, sem timestamps e
// com ordem fixa, para que um teste possa regenerá-lo e compará-lo byte a byte.
// Executar: `npm run report` (registros opcionais: `npm run report -- --include-optional`).

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRecord } from '../src/io/wfdb.js';
import { FileSource } from '../src/io/fileSource.js';
import { detectAll } from '../src/ecg/pipeline.js';
import { matchBeats, summarizeErrors } from '../src/ecg/scoring.js';
import { LEAD_NAMES } from '../src/ecg/leads.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPORT_DIR = path.join(root, 'data', 'reports');
export const TOLERANCE_S = 0.15;
export const WARMUP_S = 1.0;

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

export async function readLocalRecord(entry) {
  const dir = path.join(root, 'data', 'records', entry.db);
  const hea = entry.files.find((f) => f.endsWith('.hea'));
  const headerText = await readFile(path.join(dir, hea), 'utf8');
  const files = {};
  for (const f of entry.files) {
    if (f === hea) continue;
    const buf = await readFile(path.join(dir, f));
    files[f] = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const rec = loadRecord({ headerText, files, annotations: entry.annotations ? files[entry.annotations] : null });
  return { rec, headerText, files };
}

// LUDB: id par = ajuste (tuning), ímpar = held-out. Demais bancos: sem divisão.
export function splitOf(entry) {
  if (entry.db !== 'ludb') return 'n/a';
  return Number(entry.record) % 2 === 0 ? 'tuning' : 'held-out';
}

export function rhythmOf(entry, headerText) {
  if (entry.db !== 'ludb') return 'n/a';
  const m = headerText.match(/^#Rhythm:\s*(.+?)\.?\s*$/m);
  return m ? m[1].trim() : 'n/d';
}

const r1 = (x) => Math.round(x * 10) / 10;
const r4 = (x) => Math.round(x * 10000) / 10000;

function aggregate(rows) {
  const tp = rows.reduce((a, r) => a + r.tp, 0);
  const fp = rows.reduce((a, r) => a + r.fp, 0);
  const fn = rows.reduce((a, r) => a + r.fn, 0);
  const errs = rows.flatMap((r) => r.errorsS);
  const s = summarizeErrors(errs);
  return {
    records: rows.length, reference: tp + fn, tp, fp, fn,
    sensitivity: r4(tp + fn ? tp / (tp + fn) : 0),
    ppv: r4(tp + fp ? tp / (tp + fp) : 0),
    errorMs: { mean: r1(s.meanMs), sd: r1(s.sdMs), medianAbs: r1(s.medianAbsMs), p95Abs: r1(s.p95AbsMs) },
  };
}

export async function buildReport({ includeOptional = false } = {}) {
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const rows = [];
  for (const entry of manifest.records) {
    if (!entry.annotations) continue;
    if (!entry.bundled && !includeOptional) continue;
    if (!(await exists(path.join(root, 'data', 'records', entry.db, entry.files[0])))) continue;
    const { rec, headerText } = await readLocalRecord(entry);
    const src = new FileSource(rec);
    const refs = rec.beats.map((i) => i / src.fs).filter((t) => t >= WARMUP_S);
    const scoredUntil = refs.at(-1) + TOLERANCE_S;
    const dets = detectAll(src, { notchHz: manifest.databases[entry.db].mainsHz, nLeads: LEAD_NAMES.length })
      .events.map((e) => e.t).filter((t) => t >= WARMUP_S && t <= scoredUntil);
    const m = matchBeats(refs, dets, TOLERANCE_S);
    rows.push({
      id: entry.id, db: entry.db, split: splitOf(entry), rhythm: rhythmOf(entry, headerText), fs: src.fs,
      lead: LEAD_NAMES[src.detectionLead], reference: refs.length,
      tp: m.tp, fp: m.fp, fn: m.fn, sensitivity: r4(m.sensitivity), ppv: r4(m.ppv),
      biasMs: r1(m.meanErrorMs), maeMs: r1(m.maeMs), errorsS: m.errorsS,
    });
  }
  const group = (keyFn) => {
    const keys = [...new Set(rows.map(keyFn))].sort();
    return keys.map((k) => ({ key: k, ...aggregate(rows.filter((r) => keyFn(r) === k)) }));
  };
  return {
    schema: 'openheart3d.ecg.validation-report',
    version: 1,
    protocol: {
      toleranceMs: TOLERANCE_S * 1000, warmupS: WARMUP_S,
      split: 'LUDB: id par = ajuste (tuning), id ímpar = held-out',
      scoredWindow: 'detecções entre 1 s e o último batimento anotado + tolerância',
      includeOptional,
    },
    overall: aggregate(rows),
    byDatabase: group((r) => r.db),
    byRhythm: group((r) => `${r.db}: ${r.rhythm}`).filter((g) => !g.key.endsWith('n/a')),
    bySplit: group((r) => `${r.db}: ${r.split}`).filter((g) => !g.key.endsWith('n/a')),
    records: rows.map(({ errorsS, ...r }) => r),
  };
}

export function renderMarkdown(rep) {
  const f = (x, d = 4) => x.toFixed(d).replace('.', ',');
  const agg = (g) => `| ${g.key ?? 'Total'} | ${g.records} | ${g.reference} | ${g.fp} | ${g.fn} | ${f(g.sensitivity)} | ${f(g.ppv)} | ${f(g.errorMs.mean, 1)} ± ${f(g.errorMs.sd, 1)} | ${f(g.errorMs.medianAbs, 1)} | ${f(g.errorMs.p95Abs, 1)} |`;
  const head = '| Grupo | Reg. | Batimentos | FP | FN | Sens. | VPP | Erro médio ± DP (ms) | Mediana \\|erro\\| (ms) | P95 \\|erro\\| (ms) |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|';
  const out = [
    '# Relatório de validação do detector de QRS',
    '',
    'Gerado por `npm run report` (determinístico; um teste regenera e compara). Protocolo e decisão: [`docs/DECISOES.md`](../../../docs/DECISOES.md) D15 e [SDD 001](../../../docs/specs/001-validacao-detector-e-ondas-pt.md).',
    '',
    `Janela de ±${rep.protocol.toleranceMs} ms; primeiro 1 s ignorado (aquecimento); ${rep.protocol.scoredWindow}. ${rep.protocol.split}. Erro = detecção − anotação (positivo = detecção tardia). Resultado de pesquisa em bancos públicos, não validação clínica.`,
    '',
    '## Agregados', '', head, agg({ ...rep.overall, key: 'Total' }),
    ...rep.byDatabase.map((g) => agg({ ...g, key: g.key })),
    '', '## Por divisão (LUDB)', '', head, ...rep.bySplit.map(agg),
    '', '## Por ritmo (LUDB)', '', head, ...rep.byRhythm.map(agg),
    '', '## Por registro', '',
    '| Registro | Divisão | Ritmo | fs | Deriv. | Ref. | FP | FN | Sens. | VPP | Viés (ms) | MAE (ms) |', '|---|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|',
    ...rep.records.map((r) => `| ${r.id} | ${r.split} | ${r.rhythm} | ${r.fs} | ${r.lead} | ${r.reference} | ${r.fp} | ${r.fn} | ${f(r.sensitivity, 3)} | ${f(r.ppv, 3)} | ${f(r.biasMs, 1)} | ${f(r.maeMs, 1)} |`),
    '',
  ];
  return out.join('\n');
}

export async function writeReport(rep) {
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(path.join(REPORT_DIR, 'validation.json'), `${JSON.stringify(rep, null, 2)}\n`);
  await writeFile(path.join(REPORT_DIR, 'validation.md'), renderMarkdown(rep));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rep = await buildReport({ includeOptional: process.argv.includes('--include-optional') });
  if (process.argv.includes('--include-optional')) {
    console.log(renderMarkdown(rep)); // relatório com registros não versionados não é gravado
  } else {
    await writeReport(rep);
    console.log(`relatório gravado em data/reports/ (${rep.records.length} registros; sens=${rep.overall.sensitivity}, ppv=${rep.overall.ppv})`);
  }
}
