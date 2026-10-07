// Acesso opcional a um asset cifrado (AES-256-GCM) servido junto com a página.
//
// O repositório público só contém o conteúdo cifrado (web/assets/calib/). Sem chave,
// `loadRuntimeAsset()` devolve null em silêncio e o aplicativo segue com o modelo
// procedural. A chave pode vir de: (1) fragmento de URL `#k=<base64url>` (removido da
// barra de endereço depois de lido; em host local é guardada no localStorage),
// (2) localStorage, (3) em host local, o arquivo `assets/calib/local.key` (ignorado pelo
// git) — descoberto pela listagem de diretório do servidor estático, para não gerar
// requisição 404 quando ele não existe.
//
// O formato espelha web/tools/vault/lib.mjs: bloco = IV(12) || cifrado || TAG(16); AAD
// "<rótulo>/index" para o índice e "<rótulo>/<i>" para cada fatia. Nunca existe URL de
// modelo em claro: o conteúdo decifrado fica só em memória.

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const FORMAT_VERSION = 1;
const KEY_STORAGE = 'oh3d.calib.key';
export const RUNTIME_SET = { label: 'rt', indexFile: 'rt.dat' };
const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const subtle = globalThis.crypto?.subtle;
const encoder = new TextEncoder();

export function base64urlToBytes(text) {
  const s = String(text).trim().replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export async function sha256Hex(bytes) {
  return bytesToHex(new Uint8Array(await subtle.digest('SHA-256', bytes)));
}

export function parseKey(text) {
  const key = base64urlToBytes(text);
  if (key.length !== KEY_BYTES) throw new Error('chave com tamanho inválido');
  return key;
}

async function decryptBlock(cryptoKey, aad, block) {
  if (block.length < IV_BYTES + TAG_BYTES) throw new Error('bloco truncado');
  const iv = block.subarray(0, IV_BYTES);
  const body = block.subarray(IV_BYTES); // WebCrypto espera o TAG anexado ao cifrado
  try {
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad), tagLength: TAG_BYTES * 8 }, cryptoKey, body);
    return new Uint8Array(plain);
  } catch {
    throw new Error('falha de autenticação: chave errada ou dados alterados');
  }
}

// Decifra um conjunto (índice + fatias) obtido por `fetchBytes(nomeDoArquivo) → Uint8Array`.
// Confere o hash de cada fatia antes de decifrar e o hash do todo no fim.
export async function openEncryptedSet({ fetchBytes, keyBytes, set = RUNTIME_SET }) {
  if (!subtle) throw new Error('WebCrypto indisponível');
  const cryptoKey = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const indexBytes = await decryptBlock(cryptoKey, `${set.label}/index`, await fetchBytes(set.indexFile));
  const index = JSON.parse(new TextDecoder().decode(indexBytes));
  if (index.v !== FORMAT_VERSION || index.label !== set.label) throw new Error('índice incompatível');
  const data = new Uint8Array(index.size);
  let offset = 0;
  for (let i = 0; i < index.slices.length; i++) {
    const s = index.slices[i];
    const block = await fetchBytes(s.file);
    if (block.length !== s.size || (await sha256Hex(block)) !== s.sha256) throw new Error(`fatia ${s.file} corrompida`);
    const plain = await decryptBlock(cryptoKey, `${set.label}/${i}`, block);
    if (offset + plain.length > data.length) throw new Error('payload maior que o índice');
    data.set(plain, offset);
    offset += plain.length;
  }
  if (offset !== index.size || (await sha256Hex(data)) !== index.sha256) throw new Error('payload não confere com o índice');
  return { index, data };
}

export function isDevHost(loc = globalThis.location) {
  return Boolean(loc && DEV_HOSTS.has(loc.hostname));
}

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

// Chave do fragmento `#k=`; remove o fragmento da barra de endereço depois de ler.
function keyFromFragment() {
  const loc = globalThis.location;
  if (!loc || !loc.hash) return null;
  const m = /(?:^#|[#&])k=([A-Za-z0-9_-]+)/.exec(loc.hash);
  if (!m) return null;
  try { globalThis.history?.replaceState(null, '', loc.pathname + loc.search); } catch { /* sem histórico: segue */ }
  return m[1];
}

// Em host local, procura `local.key` pela listagem de diretório (sem 404 quando falta).
async function keyFromLocalFile(baseUrl) {
  const listing = await fetch(baseUrl, { cache: 'no-store' }).catch(() => null);
  if (!listing || !listing.ok) return null;
  const html = await listing.text();
  if (!/href="(?:\.\/)?local\.key"/.test(html)) return null;
  const res = await fetch(`${baseUrl}local.key`, { cache: 'no-store' });
  return res.ok ? (await res.text()).trim() : null;
}

export async function discoverKey({ baseUrl = 'assets/calib/', dev = isDevHost() } = {}) {
  const store = storage();
  const fromUrl = keyFromFragment();
  if (fromUrl) {
    const key = parseKey(fromUrl);
    if (dev) store?.setItem(KEY_STORAGE, fromUrl);
    return key;
  }
  const stored = store?.getItem(KEY_STORAGE);
  if (stored) {
    try { return parseKey(stored); } catch { store.removeItem(KEY_STORAGE); }
  }
  if (dev) {
    const text = await keyFromLocalFile(baseUrl);
    if (text) return parseKey(text);
  }
  return null;
}

// Devolve { buffer: ArrayBuffer, index } ou null (sem chave, sem conteúdo ou falha).
export async function loadRuntimeAsset({ baseUrl = 'assets/calib/', dev = isDevHost() } = {}) {
  let keyBytes = null;
  try {
    keyBytes = await discoverKey({ baseUrl, dev });
  } catch (err) {
    if (dev) console.info('[calib] chave fornecida é inválida:', err.message);
    return null;
  }
  if (!keyBytes) return null;
  try {
    const fetchBytes = async (file) => {
      const res = await fetch(baseUrl + file);
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${file}`);
      return new Uint8Array(await res.arrayBuffer());
    };
    const { index, data } = await openEncryptedSet({ fetchBytes, keyBytes });
    return { index, buffer: data.buffer };
  } catch (err) {
    // Chave que não abre o conteúdo não merece ser lembrada.
    if (/autenticação/.test(err.message)) storage()?.removeItem(KEY_STORAGE);
    if (dev) console.info('[calib] asset opcional indisponível; segue o modelo procedural:', err.message);
    return null;
  }
}
