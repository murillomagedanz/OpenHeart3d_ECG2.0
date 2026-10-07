// Testes do cofre de assets licenciados: ida e volta em dados sintéticos pequenos
// (nunca os originais), chave errada, fatia corrompida, decodificador do navegador e a
// guarda contra vazamento, que percorre todos os arquivos rastreados pelo git.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  createKey, toBase64url, parseKey, packDirectory, unpackArchive, packRuntime, readIndex, walkFiles, makeTempDir,
  listZip, readZipEntry, extractZipTree, ARCHIVE, RUNTIME, IV_BYTES, TAG_BYTES, MAX_ZIP_ENTRY_BYTES,
} from '../tools/vault/lib.mjs';
import { openEncryptedSet, base64urlToBytes } from '../src/view/assetVault.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

// Pasta sintética: binário aleatório (não comprime → várias fatias), texto com acentos,
// arquivo vazio e subpastas. Nada disso é asset real.
function makeSyntheticSource() {
  const dir = makeTempDir('oh3d-test-src-');
  fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a', 'aleatorio.bin'), randomBytes(300 * 1024));
  fs.writeFileSync(path.join(dir, 'a', 'b', 'texto.txt'), 'coração, sincronização temporal — não é anatomia\n'.repeat(200));
  fs.writeFileSync(path.join(dir, 'vazio.bin'), Buffer.alloc(0));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ v: 1, provenance: { product: 'teste sintético' }, files: [] }));
  return dir;
}

function hashTree(dir) {
  const out = {};
  for (const rel of walkFiles(dir)) out[rel] = sha256(fs.readFileSync(path.join(dir, ...rel.split('/'))));
  return out;
}

test('cofre: ida e volta com fatias pequenas forçadas', async () => {
  const key = createKey();
  const src = makeSyntheticSource();
  const out = makeTempDir('oh3d-test-out-');
  const index = await packDirectory(src, out, { key, sliceFileBytes: 64 * 1024 });
  assert.ok(index.slices.length >= 4, `esperava várias fatias, veio ${index.slices.length}`);
  for (const s of index.slices) {
    const block = fs.readFileSync(path.join(out, s.file));
    assert.ok(block.length <= 64 * 1024);
    assert.equal(sha256(block), s.sha256);
  }
  // Sem cabeçalho reconhecível: os primeiros bytes são o IV aleatório (assinaturas de vários bytes).
  for (const f of fs.readdirSync(out)) {
    const head = fs.readFileSync(path.join(out, f)).subarray(0, 8).toString('latin1');
    assert.doesNotMatch(head, /gltf|Kaydara|BLENDER|\x1f\x8b/);
  }
  assert.equal(readIndex({ key, dir: out, ...ARCHIVE }).sha256, index.sha256);

  const dest = makeTempDir('oh3d-test-dest-');
  const { names, manifest } = await unpackArchive(out, dest, { key });
  assert.equal(names[0], 'manifest.json');
  assert.equal(manifest.provenance.product, 'teste sintético');
  assert.deepEqual(hashTree(dest), hashTree(src));
  for (const d of [src, out, dest]) fs.rmSync(d, { recursive: true, force: true });
});

test('cofre: chave errada falha na autenticação, sem gravar conteúdo', async () => {
  const src = makeSyntheticSource();
  const out = makeTempDir('oh3d-test-out-');
  await packDirectory(src, out, { key: createKey(), sliceFileBytes: 64 * 1024 });
  const dest = makeTempDir('oh3d-test-dest-');
  await assert.rejects(unpackArchive(out, dest, { key: createKey() }), /autenticação/);
  assert.equal(fs.readdirSync(dest).length, 0);
  for (const d of [src, out, dest]) fs.rmSync(d, { recursive: true, force: true });
});

test('cofre: fatia corrompida ou truncada é apontada pelo nome', async () => {
  const key = createKey();
  const src = makeSyntheticSource();
  const out = makeTempDir('oh3d-test-out-');
  const index = await packDirectory(src, out, { key, sliceFileBytes: 64 * 1024 });
  const victim = path.join(out, index.slices[1].file);
  const original = fs.readFileSync(victim);
  const flipped = Buffer.from(original);
  flipped[IV_BYTES + 100] ^= 0x01;
  fs.writeFileSync(victim, flipped);
  const dest = makeTempDir('oh3d-test-dest-');
  await assert.rejects(unpackArchive(out, dest, { key }), new RegExp(`${index.slices[1].file}.*corrompida`));
  fs.writeFileSync(victim, original.subarray(0, original.length - TAG_BYTES));
  await assert.rejects(unpackArchive(out, dest, { key }), new RegExp(index.slices[1].file));
  fs.writeFileSync(victim, original);
  await unpackArchive(out, dest, { key }); // restaurada, volta a abrir
  for (const d of [src, out, dest]) fs.rmSync(d, { recursive: true, force: true });
});

test('cofre: o decodificador do navegador (WebCrypto) abre o conjunto de runtime do Node', async () => {
  const key = createKey();
  const tmp = makeTempDir('oh3d-test-rt-');
  const payload = randomBytes(200 * 1024 + 17);
  const file = path.join(tmp, 'payload.glb');
  fs.writeFileSync(file, payload);
  const index = await packRuntime(file, tmp, { key, sliceFileBytes: 50 * 1024, content: { type: 'glb' } });
  assert.ok(index.slices.length >= 4);
  assert.equal(index.slices[0].file, 'rt-01.dat');
  const fetchBytes = async (name) => new Uint8Array(fs.readFileSync(path.join(tmp, name)));
  const keyBytes = base64urlToBytes(toBase64url(key));
  assert.deepEqual(parseKey(toBase64url(key)), key);
  const { index: seen, data } = await openEncryptedSet({ fetchBytes, keyBytes, set: RUNTIME });
  assert.equal(seen.content.type, 'glb');
  assert.ok(Buffer.from(data).equals(payload));
  await assert.rejects(openEncryptedSet({ fetchBytes, keyBytes: new Uint8Array(createKey()), set: RUNTIME }));
  const broken = async (name) => { const b = await fetchBytes(name); if (name === 'rt-02.dat') b[20] ^= 0xff; return b; };
  await assert.rejects(openEncryptedSet({ fetchBytes: broken, keyBytes, set: RUNTIME }), /rt-02\.dat corrompida/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('leitor zip mínimo: métodos armazenado e deflate, zip aninhado expandido em pasta homônima', async () => {
  const { deflateRawSync } = await import('node:zlib');
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  // Zip montado aqui mesmo (sem dependências): [nome, dados, método].
  const buildZip = (files) => {
    const parts = []; const central = []; let offset = 0;
    for (const [name, data, method] of files) {
      const comp = method === 8 ? deflateRawSync(data) : data;
      const n = Buffer.from(name);
      const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc(data), 14);
      local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
      const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(method, 10); cd.writeUInt32LE(crc(data), 16);
      cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(offset, 42);
      parts.push(local, n, comp); central.push(cd, n); offset += local.length + n.length + comp.length;
    }
    const cdBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, cdBuf, eocd]);
  };
  const inner = buildZip([['stored.txt', Buffer.from('abc'), 0], ['sub/deflate.txt', Buffer.from('xyz'.repeat(100)), 8]]);
  const entries = listZip(inner);
  assert.deepEqual(entries.map((e) => e.name), ['stored.txt', 'sub/deflate.txt']);
  assert.equal(readZipEntry(inner, entries[0]).toString(), 'abc');
  assert.equal(readZipEntry(inner, entries[1]).toString(), 'xyz'.repeat(100));

  const outer = buildZip([['raiz.txt', Buffer.from('r'), 0], ['Pacote.zip', inner, 0]]);
  const dest = makeTempDir('oh3d-test-zip-');
  const { files, expanded } = extractZipTree(outer, dest);
  assert.deepEqual(files.map((f) => f.path).sort(), ['Pacote/stored.txt', 'Pacote/sub/deflate.txt', 'raiz.txt']);
  assert.deepEqual(expanded.map((e) => [e.path, e.into]), [['Pacote.zip', 'Pacote/']]);
  assert.equal(fs.readFileSync(path.join(dest, 'Pacote', 'sub', 'deflate.txt'), 'utf8'), 'xyz'.repeat(100));
  assert.equal(files.find((f) => f.path === 'raiz.txt').sha256, sha256('r'));
  fs.rmSync(dest, { recursive: true, force: true });
});

test('leitor zip limita saída descomprimida mesmo quando o tamanho declarado é falso', () => {
  const compressed = deflateRawSync(Buffer.alloc(4096));
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  const zip = Buffer.concat([header, compressed]);
  const entry = { name: 'test', localOffset: 0, compressedSize: compressed.length, size: 10, method: 8 };
  assert.throws(() => readZipEntry(zip, entry), { code: 'ERR_BUFFER_TOO_LARGE' });
  assert.throws(() => readZipEntry(zip, { ...entry, size: MAX_ZIP_ENTRY_BYTES + 1 }), /limite/);
  assert.equal(readZipEntry(zip, { ...entry, size: 4096 }).length, 4096);
  const empty = deflateRawSync(Buffer.alloc(0));
  assert.equal(readZipEntry(Buffer.concat([header, empty]), { ...entry, compressedSize: empty.length, size: 0 }).length, 0);
});

test('pack recusa fatias inválidas antes de acessar proveniência ou criar chave', () => {
  const script = fileURLToPath(new URL('../tools/vault/pack.mjs', import.meta.url));
  for (const value of ['0', '-1', '29', '30.5', 'NaN', '95000001']) {
    const result = spawnSync(process.execPath, [script, `--slice-bytes=${value}`], { encoding: 'utf8' });
    assert.equal(result.status, 1, value);
    assert.match(result.stderr, /erro: --slice-bytes deve ser um inteiro entre 30 e 95000000/);
  }
});

// --- Guarda contra vazamento ---------------------------------------------------------
// Falha se QUALQUER arquivo rastreado pelo git parecer um asset em claro, se houver chave
// versionada, se o cofre contiver algo além de blocos cifrados ou se um texto versionado
// citar termos de proveniência que só devem existir dentro do cofre.

const SIGNATURES = [
  ['binário de cena animada', Buffer.from('Kaydara FBX Binary')],
  ['arquivo de modelagem', Buffer.from('BLENDER')],
  ['TIFF (II)', Buffer.from([0x49, 0x49, 0x2a, 0x00])],
  ['TIFF (MM)', Buffer.from([0x4d, 0x4d, 0x00, 0x2a])],
  ['OpenEXR', Buffer.from([0x76, 0x2f, 0x31, 0x01])],
  ['glTF binário', Buffer.from('glTF')],
];
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|exr|hdr|ktx2?)$/i;
const MODEL_EXT = /\.(fbx|obj|mtl|blend1?|glb|gltf|dae|3ds|stl|ply|usdz?|abc)$/i;
// SHA-256 de termos de proveniência (loja, autor, pedido) que não devem aparecer em claro.
const FORBIDDEN_TOKEN_HASHES = new Set([
  '3234e75db1a24f9f0f5af77bb67f862b8151240d9ed5b2b71341851137803ce9',
  'd8f0933eb3b111222e1d6232e3dbe2c59641af7d1394b4e3180a1a545e897a15',
  '61b7dd01ec6f0793d1de55f803d7f507eea6355cc1a581c08bae6e9396fa0120',
]);

function entropyBitsPerByte(buf) {
  const counts = new Uint32Array(256);
  for (const b of buf) counts[b]++;
  let h = 0;
  for (const c of counts) if (c) { const p = c / buf.length; h -= p * Math.log2(p); }
  return h;
}

test('guarda contra vazamento: nenhum arquivo rastreado é asset em claro, chave ou termo de proveniência', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
  assert.ok(tracked.length > 20, 'git ls-files devolveu pouca coisa');
  const problems = [];
  for (const rel of tracked) {
    const full = path.join(repoRoot, ...rel.split('/'));
    if (!fs.existsSync(full)) continue; // removido no índice mas ainda listado
    if (/\.key$/i.test(rel)) problems.push(`${rel}: arquivo de chave versionado`);
    if (MODEL_EXT.test(rel)) problems.push(`${rel}: extensão de modelo 3D em claro`);
    const fd = fs.openSync(full, 'r');
    const head = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    const sample = head.subarray(0, n);
    for (const [what, sig] of SIGNATURES) {
      if (sample.length >= sig.length && sample.subarray(0, sig.length).equals(sig)) problems.push(`${rel}: assinatura de ${what}`);
    }
    if (rel.startsWith('web/assets/calib/')) {
      const base = path.basename(rel);
      if (base === 'LEIA-ME.md') { /* único texto permitido */ } else if (!/\.dat$/.test(base)) problems.push(`${rel}: só blocos .dat e LEIA-ME.md podem estar no cofre`);
      else if (sample.length >= 4096 && entropyBitsPerByte(sample) < 7.5) problems.push(`${rel}: entropia baixa para conteúdo cifrado`);
      else if (fs.statSync(full).size > 100 * 1024 * 1024) problems.push(`${rel}: acima do limite de 100 MB do GitHub`);
    }
    if (IMAGE_EXT.test(rel)) {
      const size = fs.statSync(full).size;
      const allowed = rel.startsWith('docs/') || rel.startsWith('web/vendor/');
      if (!allowed) problems.push(`${rel}: imagem fora de docs/ ou web/vendor/`);
      else if (size > 1.5 * 1024 * 1024) problems.push(`${rel}: imagem grande demais para uma captura documentada (${size} bytes)`);
    }
    const isText = !sample.subarray(0, 8192).includes(0);
    if (isText && sample.length > 0) {
      const text = fs.readFileSync(full, 'utf8').toLowerCase();
      for (const tok of text.match(/[a-z0-9]+/g) ?? []) {
        if (tok.length >= 8 && FORBIDDEN_TOKEN_HASHES.has(sha256(tok))) { problems.push(`${rel}: termo de proveniência em claro`); break; }
      }
    }
  }
  assert.deepEqual(problems, []);
});
