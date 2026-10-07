#!/usr/bin/env node
// Verifica e decifra o cofre para uma pasta local ignorada pelo git (uso do dono).
//
//   node tools/vault/unpack.mjs [--dir <pasta do cofre>] [--dest <pasta destino>] [--list]
//
// Exige a chave (variável OH3D_VAULT_KEY ou ~/.openheart3d/vault.key). Com --list, só
// decifra o índice e mostra as fatias, sem gravar nada.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadKey, readIndex, unpackArchive, ARCHIVE, DEFAULT_KEY_PATH, KEY_ENV, formatBytes } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    dir: { type: 'string', default: path.resolve(here, '../../assets/calib') },
    dest: { type: 'string', default: path.resolve(here, '../../../.local/calib') },
    list: { type: 'boolean', default: false },
  },
});

const key = loadKey();
if (!key) {
  console.error(`erro: chave não encontrada (${KEY_ENV} ou ${DEFAULT_KEY_PATH}).`);
  process.exit(1);
}

try {
  const index = readIndex({ key, dir: args.dir, ...ARCHIVE });
  console.log(`conjunto "${index.label}" criado em ${index.created}: ${index.slices.length} fatia(s), ${formatBytes(index.size)} em claro`);
  for (const s of index.slices) console.log(`  ${s.file}  ${formatBytes(s.size)}  ${s.sha256.slice(0, 16)}…`);
  if (args.list) process.exit(0);

  console.log(`decifrando para ${args.dest} …`);
  const { names, manifest } = await unpackArchive(args.dir, args.dest, { key });
  console.log(`  ${names.length} arquivo(s) gravado(s); hash do todo conferido.`);
  if (manifest) {
    console.log(`  manifesto: ${manifest.files.length} arquivo(s) de origem, criado em ${manifest.created}`);
    console.log(`  proveniência: ${Object.keys(manifest.provenance ?? {}).length} campo(s) em ${path.join(args.dest, 'manifest.json')}`);
  }
  console.log('Lembre: a pasta destino está no .gitignore; não copie nada dela para dentro do repositório.');
} catch (err) {
  console.error(`erro: ${err.message}`);
  process.exit(1);
}
