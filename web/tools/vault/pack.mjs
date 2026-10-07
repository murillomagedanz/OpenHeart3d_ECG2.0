#!/usr/bin/env node
// Empacota o(s) arquivo(s) originais licenciados no cofre cifrado do repositório.
//
//   node tools/vault/pack.mjs [--source <zip>] [--provenance <json>] [--out <pasta>]
//                             [--slice-bytes <n>] [--keep-temp]
//
// A proveniência (produto, autor, loja, pedido, data, valor, licença) é lida de um JSON
// FORA do repositório (padrão: ~/.openheart3d/provenance.json) e vai para o manifesto
// DENTRO do cofre — nunca em claro no git. O zip é extraído só para uma pasta temporária
// do sistema; zips aninhados são expandidos. A chave (32 bytes) é criada na primeira
// execução, gravada em ~/.openheart3d/vault.key e impressa UMA vez.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  loadKey, createKey, saveKey, toBase64url, DEFAULT_KEY_PATH, KEY_DIR, KEY_ENV, MAX_SLICE_FILE_BYTES, IV_BYTES, TAG_BYTES,
  sha256, extractZipTree, packDirectory, makeTempDir, formatBytes, FORMAT_VERSION,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    source: { type: 'string' },
    provenance: { type: 'string', default: path.join(KEY_DIR, 'provenance.json') },
    out: { type: 'string', default: path.resolve(here, '../../assets/calib') },
    'slice-bytes': { type: 'string', default: String(MAX_SLICE_FILE_BYTES) },
    'keep-temp': { type: 'boolean', default: false },
  },
});

function fail(msg) { console.error(`erro: ${msg}`); process.exit(1); }

const sliceFileBytes = Number(args['slice-bytes']);
const minSliceBytes = IV_BYTES + TAG_BYTES + 2;
if (!Number.isSafeInteger(sliceFileBytes) || sliceFileBytes < minSliceBytes || sliceFileBytes > MAX_SLICE_FILE_BYTES) {
  fail(`--slice-bytes deve ser um inteiro entre ${minSliceBytes} e ${MAX_SLICE_FILE_BYTES}`);
}

if (!fs.existsSync(args.provenance)) {
  fail(`proveniência não encontrada em ${args.provenance}.\n`
    + 'Crie um JSON (fora do repositório) com, por exemplo: { "product", "author", "store", "order", "date", '
    + '"price", "license", "sourceZip", "sourceZipSha256" }. Esses dados ficam só dentro do cofre.');
}
const provenance = JSON.parse(fs.readFileSync(args.provenance, 'utf8'));
const sourceZip = args.source ?? provenance.sourceZip;
if (!sourceZip || !fs.existsSync(sourceZip)) fail(`arquivo de origem não encontrado: ${sourceZip ?? '(informe --source)'}`);

let key = loadKey();
let newKey = false;
if (!key) {
  key = createKey();
  saveKey(key, DEFAULT_KEY_PATH);
  newKey = true;
}

console.log(`origem: ${sourceZip}`);
const zipBuf = fs.readFileSync(sourceZip);
const zipHash = sha256(zipBuf);
console.log(`  ${formatBytes(zipBuf.length)} · SHA-256 ${zipHash}`);
if (provenance.sourceZipSha256 && provenance.sourceZipSha256.toLowerCase() !== zipHash) {
  fail('o SHA-256 do arquivo de origem não bate com o declarado na proveniência');
}

const tmp = makeTempDir('oh3d-pack-');
const srcDir = path.join(tmp, 'src');
fs.mkdirSync(srcDir);
console.log(`extraindo para pasta temporária ${tmp} …`);
const { files, expanded } = extractZipTree(zipBuf, srcDir);
const totalBytes = files.reduce((a, f) => a + f.bytes, 0);
console.log(`  ${files.length} arquivo(s), ${formatBytes(totalBytes)}; ${expanded.length} arquivo(s) aninhado(s) expandido(s)`);

const manifest = {
  v: FORMAT_VERSION,
  created: new Date().toISOString(),
  provenance,
  source: { file: path.basename(sourceZip), bytes: zipBuf.length, sha256: zipHash },
  expandedArchives: expanded,
  files,
};
fs.writeFileSync(path.join(srcDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`cifrando em fatias de até ${formatBytes(sliceFileBytes)} para ${args.out} …`);
const index = await packDirectory(srcDir, args.out, { key, sliceFileBytes, tempDir: path.join(tmp, 'work') });
for (const s of index.slices) console.log(`  ${s.file}  ${formatBytes(s.size)}`);
console.log(`  payload em claro: ${formatBytes(index.size)} · SHA-256 ${index.sha256}`);
console.log(`  índice: ${path.join(args.out, 'index.dat')}`);

if (args['keep-temp']) console.log(`pasta temporária mantida: ${tmp}`);
else fs.rmSync(tmp, { recursive: true, force: true });

if (newKey) {
  console.log('\n' + '='.repeat(78));
  console.log('  CHAVE NOVA GERADA. Guarde-a em um gerenciador de senhas AGORA.');
  console.log(`  Arquivo: ${DEFAULT_KEY_PATH} (fora do repositório; worktrees são apagados).`);
  console.log('  Sem esta chave o cofre é irrecuperável. Ela não será impressa de novo.');
  console.log(`\n  ${toBase64url(key)}\n`);
  console.log(`  Também pode ser fornecida pela variável de ambiente ${KEY_ENV}.`);
  console.log('='.repeat(78));
} else {
  console.log(`\nchave existente reutilizada (${process.env[KEY_ENV] ? `variável ${KEY_ENV}` : DEFAULT_KEY_PATH}).`);
}
console.log('\nNavegador (dev local): copie a chave para web/assets/calib/local.key (ignorado pelo git)'
  + ' ou abra a página com #k=<chave> uma vez.');
