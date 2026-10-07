// Benchmark do detector de QRS em registros reais anotados (data/records/).
// Para cada registro com anotações, roda o MESMO SignalPipeline da interface
// (filtros + detector na derivação II ou MLII, frequência nativa, lacunas de
// amostras inválidas respeitadas) e compara com os batimentos anotados
// (janela ±150 ms, ANSI/AAMI EC57). Executar: `npm run bench:real`.

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRecord } from '../src/io/wfdb.js';
import { FileSource } from '../src/io/fileSource.js';
import { detectAll } from '../src/ecg/pipeline.js';
import { matchBeats } from '../src/ecg/scoring.js';
import { LEAD_NAMES } from '../src/ecg/leads.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));

const TOLERANCE_S = 0.15;
const WARMUP_S = 1.0; // filtros e limiar adaptativo ainda se ajustando
const MIN_GROSS_SENS = 0.95;
const MIN_GROSS_PPV = 0.95;

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function readLocalRecord(entry) {
  const dir = path.join(root, 'data', 'records', entry.db);
  const hea = entry.files.find((f) => f.endsWith('.hea'));
  const headerText = await readFile(path.join(dir, hea), 'utf8');
  const files = {};
  for (const f of entry.files) {
    if (f === hea) continue;
    const buf = await readFile(path.join(dir, f));
    files[f] = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return loadRecord({ headerText, files, annotations: entry.annotations ? files[entry.annotations] : null });
}

// O mesmo SignalPipeline da interface: máscara de amostras inválidas respeitada,
// notifyGap/retomada na derivação de detecção. O benchmark mede o que o app faz.
function runDetector(source, mainsHz) {
  return detectAll(source, { notchHz: mainsHz, nLeads: LEAD_NAMES.length }).events.map((e) => e.t);
}

const rows = [];
let gross = { tp: 0, fp: 0, fn: 0 };
for (const entry of manifest.records) {
  if (!entry.annotations) continue;
  if (!(await exists(path.join(root, 'data', 'records', entry.db, entry.files[0])))) {
    console.log(`--   ${entry.id.padEnd(16)} não baixado (npm run fetch-data)`);
    continue;
  }
  const rec = await readLocalRecord(entry);
  const src = new FileSource(rec);
  const refs = rec.beats.map((i) => i / src.fs).filter((t) => t >= WARMUP_S);
  // Detecções após o último batimento anotado não são pontuadas: nas bordas do
  // registro o LUDB, por exemplo, não anota o ciclo incompleto final.
  const scoredUntil = refs.at(-1) + TOLERANCE_S;
  const dets = runDetector(src, manifest.databases[entry.db].mainsHz).filter((t) => t >= WARMUP_S && t <= scoredUntil);
  const m = matchBeats(refs, dets, TOLERANCE_S);
  gross.tp += m.tp; gross.fp += m.fp; gross.fn += m.fn;
  const lead = LEAD_NAMES[src.detectionLead] + (src.aliases[LEAD_NAMES[src.detectionLead]] ? ` (${src.aliases[LEAD_NAMES[src.detectionLead]]})` : '');
  rows.push({ id: entry.id, fs: src.fs, lead, beats: refs.length, missing: rec.missing[src.mapping[src.detectionLead]] ?? 0, ...m });
}

for (const r of rows) {
  console.log(
    `${r.id.padEnd(16)} fs=${String(r.fs).padStart(3)} ${r.lead.padEnd(10)} ` +
      `ref=${String(r.beats).padStart(4)} tp=${String(r.tp).padStart(4)} fp=${String(r.fp).padStart(3)} fn=${String(r.fn).padStart(3)} ` +
      `sens=${r.sensitivity.toFixed(3)} ppv=${r.ppv.toFixed(3)} ` +
      `viés=${r.meanErrorMs.toFixed(1).padStart(6)}ms mae=${r.maeMs.toFixed(1)}ms` +
      (r.missing ? ` lacunas=${r.missing} amostras` : ''),
  );
}

if (rows.length === 0) {
  console.log('Nenhum registro anotado disponível; rode `npm run fetch-data`.');
  process.exit(0);
}

const grossSens = gross.tp / (gross.tp + gross.fn);
const grossPpv = gross.tp / (gross.tp + gross.fp);
console.log(`\nagregado: ${gross.tp + gross.fn} batimentos de referência · sens=${grossSens.toFixed(4)} · ppv=${grossPpv.toFixed(4)} (janela ±${TOLERANCE_S * 1000} ms, após ${WARMUP_S} s)`);

if (grossSens < MIN_GROSS_SENS || grossPpv < MIN_GROSS_PPV) {
  console.error(`Limiar agregado não atingido (sens ≥ ${MIN_GROSS_SENS}, ppv ≥ ${MIN_GROSS_PPV}).`);
  process.exit(1);
}
