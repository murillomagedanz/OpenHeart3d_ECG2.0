import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { discoverKey, loadRuntimeAsset } from '../src/view/assetVault.js';
import { makeTempDir, packRuntime } from '../tools/vault/lib.mjs';

function browser(t, { hostname = 'localhost', hash = '', stored = null, fetch } = {}) {
  const values = new Map(stored ? [['oh3d.calib.key', stored]] : []);
  const replaced = [];
  const requests = [];
  const globals = {
    location: { hostname, hash, pathname: '/web/', search: '?view=1' },
    history: { replaceState: (...args) => replaced.push(args) },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    fetch: async (url, options) => {
      requests.push([url, options]);
      if (!fetch) throw new Error(`fetch inesperado: ${url}`);
      return fetch(url, options);
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
  return { values, replaced, requests };
}

test('fragmento tem prioridade, é removido e persiste somente em host local', async (t) => {
  const key = randomBytes(32);
  const text = key.toString('base64url');
  const { values, replaced, requests } = browser(t, { hash: `#k=${text}` });
  assert.deepEqual(Buffer.from(await discoverKey()), key);
  assert.equal(values.get('oh3d.calib.key'), text);
  assert.deepEqual(replaced, [[null, '', '/web/?view=1']]);
  assert.equal(requests.length, 0);
  globalThis.location.hostname = 'example.org';
  values.clear();
  assert.deepEqual(Buffer.from(await discoverKey()), key);
  assert.equal(values.size, 0);
});

test('chave armazenada é lida; valor inválido é removido antes de procurar arquivo local', async (t) => {
  const key = randomBytes(32);
  const { values, requests } = browser(t, {
    stored: key.toString('base64url'),
    fetch: async () => ({ ok: true, text: async () => '<a href="rt.dat">rt.dat</a>' }),
  });
  assert.deepEqual(Buffer.from(await discoverKey()), key);
  assert.equal(requests.length, 0);
  values.set('oh3d.calib.key', 'invalid');
  assert.equal(await discoverKey(), null);
  assert.equal(values.size, 0);
  assert.deepEqual(requests.map(([url]) => url), ['assets/calib/']);
});

test('arquivo local só é buscado quando anunciado na listagem, sem cache', async (t) => {
  const key = randomBytes(32);
  const { requests } = browser(t, {
    fetch: async (url) => ({
      ok: true,
      text: async () => url.endsWith('local.key') ? ` ${key.toString('base64url')}\n` : '<a href="./local.key">chave</a>',
    }),
  });
  assert.deepEqual(Buffer.from(await discoverKey()), key);
  assert.deepEqual(requests, [
    ['assets/calib/', { cache: 'no-store' }],
    ['assets/calib/local.key', { cache: 'no-store' }],
  ]);
});

test('host público sem chave não consulta listagem nem conteúdo cifrado', async (t) => {
  const { requests } = browser(t, { hostname: 'example.org' });
  assert.equal(await loadRuntimeAsset(), null);
  assert.equal(requests.length, 0);
});

test('runtime carrega conjunto cifrado e remove chave armazenada que falha autenticação', async (t) => {
  const tmp = makeTempDir('oh3d-discovery-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const key = randomBytes(32);
  const payload = randomBytes(100);
  const input = path.join(tmp, 'input.bin');
  fs.writeFileSync(input, payload);
  await packRuntime(input, tmp, { key });
  const { values } = browser(t, {
    hostname: 'example.org', stored: key.toString('base64url'),
    fetch: async (url) => {
      const data = fs.readFileSync(path.join(tmp, path.basename(url)));
      return { ok: true, arrayBuffer: async () => Uint8Array.from(data).buffer };
    },
  });
  const asset = await loadRuntimeAsset();
  assert.deepEqual(Buffer.from(asset.buffer), payload);
  values.set('oh3d.calib.key', randomBytes(32).toString('base64url'));
  assert.equal(await loadRuntimeAsset(), null);
  assert.equal(values.size, 0);
});

test('runtime relata chave inválida e erro HTTP em dev, mantendo fallback procedural', async (t) => {
  const info = t.mock.method(console, 'info', () => {});
  const { values, replaced } = browser(t, { hash: '#k=invalid' });
  assert.equal(await loadRuntimeAsset(), null);
  assert.equal(replaced.length, 1);
  assert.equal(info.mock.callCount(), 1);
  globalThis.location.hash = '';
  values.set('oh3d.calib.key', randomBytes(32).toString('base64url'));
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  assert.equal(await loadRuntimeAsset(), null);
  assert.match(info.mock.calls[1].arguments[1], /HTTP 503/);
});
