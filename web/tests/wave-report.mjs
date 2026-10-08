// Relatório reprodutível do delineador de ondas P/T (docs/specs/001), pontuado
// contra as anotações por derivação do LUDB. Grava data/reports/waves.{json,md}.
// Executar: `npm run report:waves`.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readLocalRecord, rhythmOf, splitOf, root, REPORT_DIR } from './validation-report.mjs';
import { evaluateRecord, foldResults, loadLudbEntries } from './wave-eval.mjs';
import { summarizeMs } from '../src/ecg/waveScoring.js';
import { DEFAULT_WAVE_PARAMS } from '../src/ecg/waves.js';

const r1 = (x) => Math.round(x * 10) / 10;
const r4 = (x) => Math.round(x * 10000) / 10000;
const ratio = (a, b) => (b > 0 ? r4(a / b) : null);

const ms = (v) => {
  const s = summarizeMs(v);
  return { mean: r1(s.mean), sd: r1(s.sd), n: v.length };
};

function stats(items) {
  const a = foldResults(items);
  return {
    tp: a.tp, fp: a.fp, fn: a.fn,
    sensitivity: ratio(a.tp, a.tp + a.fn), ppv: ratio(a.tp, a.tp + a.fp),
    onMs: ms(a.on), peakMs: ms(a.peak), offMs: ms(a.off),
  };
}

export async function buildWavesReport() {
  const { manifest, entries } = await loadLudbEntries();
  const rows = [];
  for (const entry of entries) {
    const { rec, files, headerText } = await readLocalRecord(entry);
    const rhythm = rhythmOf(entry, headerText);
    const sinus = /sinus/i.test(rhythm);
    for (const mode of ['detected', 'reference']) {
      const res = evaluateRecord(entry, rec, files, { mode, mainsHz: manifest.databases.ludb.mainsHz });
      for (const r of res) rows.push({ id: entry.id, split: splitOf(entry), sinus, mode, lead: r.lead, p: r.p, t: r.t });
    }
  }
  const cell = (filter) => {
    const sel = rows.filter(filter);
    return { records: new Set(sel.map((r) => r.id)).size, p: stats(sel.map((r) => r.p)), t: stats(sel.map((r) => r.t)) };
  };
  const groups = [];
  for (const split of ['tuning', 'held-out']) {
    for (const mode of ['detected', 'reference']) {
      groups.push({ split, mode, scope: 'derivação II', ...cell((r) => r.split === split && r.mode === mode && r.lead === 'II') });
      groups.push({ split, mode, scope: '12 derivações', ...cell((r) => r.split === split && r.mode === mode) });
    }
  }
  const sinusOnly = [];
  for (const split of ['tuning', 'held-out']) {
    sinusOnly.push({ split, mode: 'detected', scope: 'derivação II, só ritmo sinusal', ...cell((r) => r.split === split && r.mode === 'detected' && r.lead === 'II' && r.sinus) });
  }
  return {
    schema: 'openheart3d.ecg.waves-report',
    version: 1,
    protocol: {
      toleranceMs: 150,
      split: 'LUDB: id par = ajuste (tuning), id ímpar = held-out',
      modes: 'detected = R do detector; reference = R anotado (isola o delineador)',
      note: 'FA/flutter não têm onda P anotada: P detectadas nesses registros contam como FP',
      params: DEFAULT_WAVE_PARAMS,
    },
    groups: [...groups, ...sinusOnly],
  };
}

export function renderWavesMarkdown(rep) {
  const f = (x, d = 3) => (x == null ? '–' : x.toFixed(d).replace('.', ','));
  const e = (m) => `${f(m.mean, 1)} ± ${f(m.sd, 1)}`;
  const row = (g, w, s) => `| ${g.scope} | ${g.split} | ${g.mode} | ${w} | ${g.records} | ${s.tp} | ${s.fp} | ${s.fn} | ${f(s.sensitivity)} | ${f(s.ppv)} | ${e(s.onMs)} | ${e(s.peakMs)} | ${e(s.offMs)} |`;
  const head = '| Escopo | Divisão | Modo | Onda | Reg. | TP | FP | FN | Sens. | VPP | Início (ms) | Pico (ms) | Fim (ms) |\n|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---|';
  return [
    '# Relatório do delineador de ondas P/T',
    '',
    'Gerado por `npm run report:waves` (determinístico; um teste regenera e compara). Especificação: [SDD 001](../../../docs/specs/001-validacao-detector-e-ondas-pt.md); decisão D16 em [`docs/DECISOES.md`](../../../docs/DECISOES.md).',
    '',
    `Tolerância de ±${rep.protocol.toleranceMs} ms. ${rep.protocol.split}. ${rep.protocol.modes}. ${rep.protocol.note}. Erro = detecção − anotação (ms). Parâmetros ajustados somente em registros pares. Estimativa visual por algoritmo, não diagnóstico.`,
    '',
    head,
    ...rep.groups.flatMap((g) => [row(g, 'P', g.p), row(g, 'T', g.t)]),
    '',
  ].join('\n');
}

export async function writeWavesReport(rep) {
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(path.join(REPORT_DIR, 'waves.json'), `${JSON.stringify(rep, null, 2)}\n`);
  await writeFile(path.join(REPORT_DIR, 'waves.md'), renderWavesMarkdown(rep));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rep = await buildWavesReport();
  await writeWavesReport(rep);
  console.log(renderWavesMarkdown(rep));
  void root;
}
