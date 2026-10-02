// Baixa do PhysioNet os arquivos dos registros listados em data/manifest.json
// que ainda não existem em data/records/<banco>/.
//
//   node scripts/fetch-records.mjs              baixa tudo que falta
//   node scripts/fetch-records.mjs mitdb/105    adiciona um registro ao manifesto e baixa
//   node scripts/fetch-records.mjs ptb-xl/4117  (PTB-XL: id numérico; usa records500/*_hr)
//   node scripts/fetch-records.mjs ludb/70

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'data', 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const LUDB_LEADS = ['i', 'ii', 'iii', 'avr', 'avl', 'avf', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6'];

// Convenções de nomes por banco, para adicionar registros pela linha de comando.
const CONVENTIONS = {
  mitdb: (rec) => ({ record: rec, remoteDir: '', files: [`${rec}.hea`, `${rec}.dat`, `${rec}.atr`], annotations: `${rec}.atr` }),
  ludb: (rec) => ({
    record: rec, remoteDir: 'data/',
    files: [`${rec}.hea`, `${rec}.dat`, ...LUDB_LEADS.map((l) => `${rec}.${l}`)],
    annotations: `${rec}.ii`,
  }),
  'ptb-xl': (rec) => {
    const id = parseInt(rec, 10);
    if (!Number.isFinite(id)) throw new Error(`PTB-XL espera um ecg_id numérico, recebido "${rec}"`);
    const name = `${String(id).padStart(5, '0')}_hr`;
    const folder = String(Math.floor(id / 1000) * 1000).padStart(5, '0');
    return { record: name, remoteDir: `records500/${folder}/`, files: [`${name}.hea`, `${name}.dat`], annotations: null };
  },
};

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

let manifestChanged = false;
for (const spec of process.argv.slice(2)) {
  const [db, rec] = spec.split('/');
  if (!CONVENTIONS[db] || !rec) throw new Error(`Especificação inválida "${spec}"; use banco/registro, ex.: mitdb/105`);
  const conv = CONVENTIONS[db](rec);
  const id = `${db}/${conv.record}`;
  if (manifest.records.some((r) => r.id === id)) continue;
  manifest.records.push({
    id, db, record: conv.record,
    title: `${manifest.databases[db].shortName} ${conv.record} — adicionado pela linha de comando`,
    remoteDir: conv.remoteDir, files: conv.files, annotations: conv.annotations,
    bundled: false, datasetLabels: '', notes: 'Complete título, rótulos e notas consultando a documentação do banco.',
  });
  manifestChanged = true;
  console.log(`adicionado ao manifesto: ${id}`);
}
if (manifestChanged) await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

let downloaded = 0;
let skipped = 0;
let failed = 0;
for (const r of manifest.records) {
  const db = manifest.databases[r.db];
  const dir = path.join(root, 'data', 'records', r.db);
  await mkdir(dir, { recursive: true });
  for (const f of r.files) {
    const dest = path.join(dir, f);
    if (await exists(dest)) { skipped++; continue; }
    const url = `${db.filesBase}${r.remoteDir}${f}`;
    process.stdout.write(`baixando ${url} ... `);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      console.log('ok');
      downloaded++;
    } catch (err) {
      console.log(`falhou (${err.message})`);
      failed++;
    }
  }
}
console.log(`\n${downloaded} arquivo(s) baixado(s), ${skipped} já existiam, ${failed} falha(s).`);
if (failed) process.exit(1);
