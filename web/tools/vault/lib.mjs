// Biblioteca do cofre de assets licenciados.
//
// Assets de terceiros cuja licença não permite redistribuição em forma extraível
// ficam no repositório apenas CIFRADOS (AES-256-GCM), em fatias de tamanho limitado,
// com nomes neutros. A chave nunca entra no git. Este módulo concentra o formato,
// para que `pack`, `unpack`, `build-rt`, os testes e o decodificador do navegador
// (web/src/view/assetVault.js) concordem byte a byte.
//
// Formato de um bloco cifrado (índice ou fatia): IV(12) || texto cifrado || TAG(16).
// Nenhum cabeçalho em claro: o arquivo começa com bytes aleatórios (o IV).
// O AAD do GCM amarra cada bloco ao conjunto e à posição: "<rótulo>/index" ou "<rótulo>/<i>".
//
// Índice (JSON cifrado) de um conjunto:
//   { v, label, created, size, sha256, slices: [{ file, size, sha256 }], content }
// `sha256` é o hash do payload em claro inteiro; `slices[i].sha256` é o hash do
// arquivo cifrado da fatia, conferido ANTES de decifrar (aponta qual fatia corrompeu).

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';

export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const KEY_BYTES = 32;
export const FORMAT_VERSION = 1;
// O GitHub recusa arquivos acima de 100 MB; fica uma folga.
export const MAX_SLICE_FILE_BYTES = 95_000_000;
export const KEY_ENV = 'OH3D_VAULT_KEY';
export const KEY_DIR = path.join(os.homedir(), '.openheart3d');
export const DEFAULT_KEY_PATH = path.join(KEY_DIR, 'vault.key');

// --- Chave --------------------------------------------------------------------------

export function toBase64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text) {
  const s = String(text).trim().replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s + '='.repeat((4 - (s.length % 4)) % 4), 'base64');
}

export function parseKey(text, origin = 'chave') {
  const key = fromBase64url(text);
  if (key.length !== KEY_BYTES) throw new Error(`${origin}: esperados ${KEY_BYTES} bytes em base64url, vieram ${key.length}`);
  return key;
}

// Ordem: variável de ambiente, depois arquivo fora do repositório. Retorna null se não houver.
export function loadKey({ env = process.env, keyPath = DEFAULT_KEY_PATH } = {}) {
  if (env[KEY_ENV]) return parseKey(env[KEY_ENV], `variável ${KEY_ENV}`);
  if (fs.existsSync(keyPath)) return parseKey(fs.readFileSync(keyPath, 'utf8'), keyPath);
  return null;
}

export function createKey() { return randomBytes(KEY_BYTES); }

// Nunca sobrescreve: perder a chave inutiliza o cofre, e trocá-la sem querer também.
export function saveKey(key, keyPath = DEFAULT_KEY_PATH) {
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, toBase64url(key) + '\n', { flag: 'wx', mode: 0o600 });
  return keyPath;
}

// --- Hash e cifra ---------------------------------------------------------------------

export function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

export async function sha256File(filePath) {
  const h = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) h.update(chunk);
  return h.digest('hex');
}

export function aadFor(label, part) { return Buffer.from(`${label}/${part}`, 'utf8'); }

export function encryptBlock(key, aad, plaintext) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]);
}

export function decryptBlock(key, aad, block) {
  if (block.length < IV_BYTES + TAG_BYTES) throw new Error('bloco cifrado truncado');
  const iv = block.subarray(0, IV_BYTES);
  const tag = block.subarray(block.length - TAG_BYTES);
  const ct = block.subarray(IV_BYTES, block.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error('falha de autenticação: chave errada ou dados alterados');
  }
}

// --- Conjuntos cifrados em fatias --------------------------------------------------

export function letterName(prefix) {
  return (i) => {
    let n = i; let s = '';
    do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return `${prefix}-${s}.dat`;
  };
}

export function numberName(prefix) { return (i) => `${prefix}-${String(i + 1).padStart(2, '0')}.dat`; }

// Cifra o arquivo `payloadPath` em fatias dentro de `outDir` e grava o índice cifrado.
export async function writeEncryptedSet({
  key, label, payloadPath, outDir, indexFile, sliceName,
  sliceFileBytes = MAX_SLICE_FILE_BYTES, content = {},
}) {
  if (sliceFileBytes <= IV_BYTES + TAG_BYTES + 1) throw new RangeError('fatia pequena demais');
  const chunkBytes = sliceFileBytes - IV_BYTES - TAG_BYTES;
  fs.mkdirSync(outDir, { recursive: true });
  const size = fs.statSync(payloadPath).size;
  const total = createHash('sha256');
  const slices = [];
  const fd = fs.openSync(payloadPath, 'r');
  try {
    const buf = Buffer.allocUnsafe(Math.min(chunkBytes, size || 1));
    let offset = 0; let i = 0;
    do {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - offset), offset);
      const chunk = buf.subarray(0, n);
      total.update(chunk);
      const block = encryptBlock(key, aadFor(label, i), chunk);
      const file = sliceName(i);
      fs.writeFileSync(path.join(outDir, file), block);
      slices.push({ file, size: block.length, sha256: sha256(block) });
      offset += n; i++;
    } while (offset < size);
  } finally { fs.closeSync(fd); }
  const index = { v: FORMAT_VERSION, label, created: new Date().toISOString(), size, sha256: total.digest('hex'), slices, content };
  fs.writeFileSync(path.join(outDir, indexFile), encryptBlock(key, aadFor(label, 'index'), Buffer.from(JSON.stringify(index), 'utf8')));
  return index;
}

export function readIndex({ key, label, dir, indexFile }) {
  const file = path.join(dir, indexFile);
  if (!fs.existsSync(file)) throw new Error(`índice ${indexFile} não encontrado em ${dir}`);
  const index = JSON.parse(decryptBlock(key, aadFor(label, 'index'), fs.readFileSync(file)).toString('utf8'));
  if (index.v !== FORMAT_VERSION || index.label !== label) throw new Error('índice de outro formato ou conjunto');
  return index;
}

// Confere o hash de cada fatia, decifra na ordem e grava o payload em claro em `destPath`,
// conferindo o hash do todo no fim.
export async function readEncryptedSet({ key, label, dir, indexFile, destPath }) {
  const index = readIndex({ key, label, dir, indexFile });
  const out = fs.createWriteStream(destPath);
  const total = createHash('sha256');
  let written = 0;
  try {
    for (let i = 0; i < index.slices.length; i++) {
      const s = index.slices[i];
      const file = path.join(dir, s.file);
      if (!fs.existsSync(file)) throw new Error(`fatia ${s.file} ausente`);
      const block = fs.readFileSync(file);
      if (block.length !== s.size || sha256(block) !== s.sha256) throw new Error(`fatia ${s.file} corrompida (hash não confere)`);
      const plain = decryptBlock(key, aadFor(label, i), block);
      total.update(plain);
      written += plain.length;
      if (!out.write(plain)) await once(out, 'drain');
    }
  } finally {
    out.end();
    await finished(out);
  }
  if (written !== index.size || total.digest('hex') !== index.sha256) throw new Error('payload não confere com o índice');
  return index;
}

// --- Contêiner próprio (bundle) + gzip -----------------------------------------------
// Sequência de entradas: u32LE tamanho do nome | nome UTF-8 | u64LE tamanho | bytes.

function entryHeader(name, size) {
  const nameBuf = Buffer.from(name, 'utf8');
  const head = Buffer.alloc(4 + nameBuf.length + 8);
  head.writeUInt32LE(nameBuf.length, 0);
  nameBuf.copy(head, 4);
  head.writeBigUInt64LE(BigInt(size), 4 + nameBuf.length);
  return head;
}

async function writeTo(stream, chunk) { if (!stream.write(chunk)) await once(stream, 'drain'); }

// `entries`: [{ name, path }] ou [{ name, data }]. Nomes usam '/' como separador.
export async function writeBundleGz(entries, outPath, { level = 6 } = {}) {
  const gz = zlib.createGzip({ level });
  const out = fs.createWriteStream(outPath);
  gz.pipe(out);
  for (const e of entries) {
    if (e.data !== undefined) {
      const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
      await writeTo(gz, entryHeader(e.name, data.length));
      await writeTo(gz, data);
    } else {
      await writeTo(gz, entryHeader(e.name, fs.statSync(e.path).size));
      for await (const chunk of fs.createReadStream(e.path)) await writeTo(gz, chunk);
    }
  }
  gz.end();
  await finished(out);
}

class ByteReader {
  constructor(iterable) { this.it = iterable[Symbol.asyncIterator](); this.queue = []; this.len = 0; this.done = false; }
  async fill(n) {
    while (this.len < n && !this.done) {
      const { value, done } = await this.it.next();
      if (done) { this.done = true; break; }
      this.queue.push(value); this.len += value.length;
    }
    return this.len >= n;
  }
  take(n) {
    const parts = []; let need = n;
    while (need > 0) {
      const head = this.queue[0];
      if (head.length <= need) { parts.push(head); need -= head.length; this.queue.shift(); } else { parts.push(head.subarray(0, need)); this.queue[0] = head.subarray(need); need = 0; }
    }
    this.len -= n;
    return Buffer.concat(parts);
  }
  async read(n) {
    if (!(await this.fill(n))) throw new Error('contêiner truncado');
    return this.take(n);
  }
}

// Percorre as entradas; `onEntry(name, size)` devolve um Writable (ou null para pular).
export async function readBundleGz(inPath, onEntry) {
  const reader = new ByteReader(fs.createReadStream(inPath).pipe(zlib.createGunzip()));
  const names = [];
  while (await reader.fill(4)) {
    const nameLen = reader.take(4).readUInt32LE(0);
    if (nameLen === 0 || nameLen > 4096) throw new Error('contêiner inválido');
    const name = (await reader.read(nameLen)).toString('utf8');
    let size = (await reader.read(8)).readBigUInt64LE(0);
    if (/(^|\/)\.\.(\/|$)/.test(name) || path.isAbsolute(name)) throw new Error(`nome inválido no contêiner: ${name}`);
    const sink = await onEntry(name, Number(size));
    names.push(name);
    while (size > 0n) {
      const n = Number(size > 1048576n ? 1048576n : size);
      const chunk = await reader.read(n);
      if (sink) await writeTo(sink, chunk);
      size -= BigInt(n);
    }
    if (sink) { sink.end(); await finished(sink); }
  }
  if (reader.len > 0) throw new Error('contêiner com bytes sobrando no fim');
  return names;
}

// --- Leitor ZIP mínimo (métodos 0 e 8, sem ZIP64) ----------------------------------

export function listZip(buf) {
  const minEocd = 22;
  let eocd = -1;
  for (let p = buf.length - minEocd; p >= Math.max(0, buf.length - 65557); p--) {
    if (buf.readUInt32LE(p) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error('arquivo zip sem diretório central');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff) throw new Error('zip64 não suportado');
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('diretório central inválido');
    const method = buf.readUInt16LE(p + 10);
    const crc32 = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if ([compressedSize, size, localOffset].includes(0xffffffff)) throw new Error('zip64 não suportado');
    if (!name.endsWith('/')) entries.push({ name, method, crc32, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readZipEntry(buf, entry) {
  const p = entry.localOffset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`cabeçalho local inválido: ${entry.name}`);
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  let data;
  if (entry.method === 0) data = raw;
  else if (entry.method === 8) data = zlib.inflateRawSync(raw);
  else throw new Error(`método de compressão ${entry.method} não suportado: ${entry.name}`);
  if (data.length !== entry.size) throw new Error(`tamanho não confere: ${entry.name}`);
  return data;
}

// Extrai um zip para `destDir`, expandindo zips aninhados em pastas homônimas.
// Devolve { files: [{ path, bytes, sha256 }], expanded: [{ path, sha256, into }] }.
export function extractZipTree(buf, destDir, prefix = '') {
  const files = []; const expanded = [];
  for (const e of listZip(buf)) {
    const rel = (prefix + e.name).replace(/\\/g, '/');
    if (/(^|\/)\.\.(\/|$)/.test(rel)) throw new Error(`caminho inválido no zip: ${rel}`);
    const data = readZipEntry(buf, e);
    if (/\.zip$/i.test(rel)) {
      const into = rel.replace(/\.zip$/i, '') + '/';
      expanded.push({ path: rel, bytes: data.length, sha256: sha256(data), into });
      const inner = extractZipTree(data, destDir, into);
      files.push(...inner.files); expanded.push(...inner.expanded);
      continue;
    }
    const target = path.join(destDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    files.push({ path: rel, bytes: data.length, sha256: sha256(data) });
  }
  return { files, expanded };
}

// Lista recursiva de arquivos de uma pasta (caminhos relativos com '/').
export function walkFiles(dir, base = dir) {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

export function makeTempDir(tag = 'oh3d-') { return fs.mkdtempSync(path.join(os.tmpdir(), tag)); }

// --- Rotinas de alto nível usadas por pack/unpack/build-rt e pelos testes -------------

export const ARCHIVE = { label: 'archive', indexFile: 'index.dat', sliceName: letterName('set') };
export const RUNTIME = { label: 'rt', indexFile: 'rt.dat', sliceName: numberName('rt') };

// Remove fatias e índice antigos de um conjunto (só os arquivos que o conjunto gera).
export function clearSet(outDir, set) {
  if (!fs.existsSync(outDir)) return;
  const re = set === ARCHIVE ? /^set-[a-z]+\.dat$/ : /^rt-\d+\.dat$/;
  for (const f of fs.readdirSync(outDir)) if (re.test(f) || f === set.indexFile) fs.unlinkSync(path.join(outDir, f));
}

// Empacota uma pasta (com `manifest.json` já dentro) no conjunto ARCHIVE.
export async function packDirectory(srcDir, outDir, { key, sliceFileBytes = MAX_SLICE_FILE_BYTES, tempDir } = {}) {
  const tmp = tempDir ?? makeTempDir('oh3d-pack-');
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const payload = path.join(tmp, 'payload.tmp');
    const names = walkFiles(srcDir);
    // manifest.json primeiro: quem decifra lê a proveniência antes do resto.
    names.sort((a, b) => (a === 'manifest.json' ? -1 : b === 'manifest.json' ? 1 : a.localeCompare(b)));
    await writeBundleGz(names.map((n) => ({ name: n, path: path.join(srcDir, ...n.split('/')) })), payload);
    clearSet(outDir, ARCHIVE);
    return await writeEncryptedSet({
      key, outDir, payloadPath: payload, sliceFileBytes, content: { type: 'bundle+gzip', files: names.length }, ...ARCHIVE,
    });
  } finally {
    if (!tempDir) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Decifra o conjunto ARCHIVE de `dir` para `destDir`. Devolve { index, names, manifest }.
export async function unpackArchive(dir, destDir, { key, tempDir } = {}) {
  const tmp = tempDir ?? makeTempDir('oh3d-unpack-');
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const payload = path.join(tmp, 'payload.tmp');
    const index = await readEncryptedSet({ key, dir, destPath: payload, ...ARCHIVE });
    fs.mkdirSync(destDir, { recursive: true });
    const names = await readBundleGz(payload, (name) => {
      const target = path.join(destDir, ...name.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      return fs.createWriteStream(target);
    });
    const manifestPath = path.join(destDir, 'manifest.json');
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
    return { index, names, manifest };
  } finally {
    if (!tempDir) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Cifra um único arquivo (o derivado para o navegador) no conjunto RUNTIME.
export async function packRuntime(filePath, outDir, { key, sliceFileBytes = MAX_SLICE_FILE_BYTES, content = {} } = {}) {
  clearSet(outDir, RUNTIME);
  return writeEncryptedSet({ key, outDir, payloadPath: filePath, sliceFileBytes, content, ...RUNTIME });
}

export function formatBytes(n) {
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} kB`;
  return `${(n / 1e6).toFixed(1)} MB`;
}
