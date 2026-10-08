import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { delineateWaves, WaveTracker } from '../src/ecg/waves.js';
import { buildWavesReport, renderWavesMarkdown } from './wave-report.mjs';
import { REPORT_DIR } from './validation-report.mjs';

const FS = 250;
const gauss = (t, c, w, a) => a * Math.exp(-0.5 * ((t - c) / w) ** 2);

// ECG sintético: P (0,12 mV), QRS (1,0 mV), T (0,3 mV) a cada RR segundos.
function synth({ beats = 10, rr = 0.9, p = 0.12, t = 0.3, noise = 0, seed = 1 } = {}) {
  const n = Math.round((beats + 1) * rr * FS);
  const x = new Float32Array(n);
  const rs = [];
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 2;
  for (let b = 0; b < beats; b++) {
    const r = (0.6 + b * rr);
    rs.push(Math.round(r * FS));
    for (let i = 0; i < n; i++) {
      const ti = i / FS;
      x[i] += gauss(ti, r - 0.16, 0.025, p) + gauss(ti, r, 0.012, 1.0) + gauss(ti, r + 0.25, 0.05, t);
    }
  }
  for (let i = 0; i < n; i++) x[i] += noise * rnd();
  return { x, rs, n };
}

const near = (a, b, tolS) => Math.abs(a - b) / FS <= tolS;

test('delineia P e T de um ECG sintético limpo', () => {
  const { x, rs } = synth();
  const beats = delineateWaves(x, FS, rs);
  const mid = beats.slice(1, -1);
  assert.ok(mid.length >= 7);
  for (const b of mid) {
    const i = rs.findIndex((r) => near(r, b.r, 0.05));
    assert.ok(b.p && near(b.p.peak, rs[i] - 0.16 * FS, 0.03), 'pico da P');
    assert.ok(b.t && near(b.t.peak, rs[i] + 0.25 * FS, 0.04), 'pico da T');
  }
});

test('ruído moderado mantém P e T', () => {
  const { x, rs } = synth({ noise: 0.01 });
  const mid = delineateWaves(x, FS, rs).slice(1, -1);
  assert.ok(mid.filter((b) => b.p).length >= mid.length - 1);
  assert.ok(mid.filter((b) => b.t).length >= mid.length - 1);
});

test('T invertida é detectada com amplitude negativa', () => {
  const { x, rs } = synth({ t: -0.3 });
  const mid = delineateWaves(x, FS, rs).slice(1, -1);
  assert.ok(mid.every((b) => b.t && b.t.amp < 0));
});

test('sem P (fibrilação) não inventa P em sinal limpo', () => {
  const { x, rs } = synth({ p: 0 });
  const mid = delineateWaves(x, FS, rs).slice(1, -1);
  assert.equal(mid.filter((b) => b.p).length, 0);
});

test('lacuna NaN na janela invalida a onda, sem lançar', () => {
  const { x, rs } = synth();
  for (let i = rs[3] + 20; i < rs[3] + 80; i++) x[i] = NaN;
  const beats = delineateWaves(x, FS, rs);
  assert.ok(beats.length > 0);
  assert.ok(beats.some((b) => b.t === null));
});

test('WaveTracker em streaming concorda com o lote', () => {
  const { x, rs } = synth();
  const batch = delineateWaves(x, FS, rs);
  const tr = new WaveTracker(FS);
  const got = [];
  const delayS = 0.12; // R é anunciado após o atraso do detector
  const pending = rs.map((r) => r + Math.round(delayS * FS));
  for (let i = 0; i < x.length; i++) {
    tr.push(x[i], true);
    while (pending.length && pending[0] === i) {
      const r = rs[got.length];
      got.push({ r, res: tr.onQrs(i - r), i });
      pending.shift();
    }
  }
  let compared = 0;
  for (const g of got.slice(2)) {
    if (!g.res?.p) continue;
    const b = batch.find((q) => q.r === g.r);
    if (!b?.p) continue;
    assert.ok(Math.abs(g.i - g.res.p.peak - b.p.peak) <= 3, 'pico P em streaming ≈ lote');
    compared++;
  }
  assert.ok(compared >= 5);
});

test('relatório de ondas commitado coincide com o regenerado', async () => {
  const rep = await buildWavesReport();
  const json = (await readFile(path.join(REPORT_DIR, 'waves.json'), 'utf8')).replace(/\r\n/g, '\n');
  const md = (await readFile(path.join(REPORT_DIR, 'waves.md'), 'utf8')).replace(/\r\n/g, '\n');
  assert.equal(json, `${JSON.stringify(rep, null, 2)}\n`, 'waves.json desatualizado: rode `npm run report:waves`');
  assert.equal(md, renderWavesMarkdown(rep));
});

test('regressão: held-out na derivação II (ritmo sinusal) acima do piso', async () => {
  const rep = await buildWavesReport();
  const g = rep.groups.find((x) => x.split === 'held-out' && x.scope.includes('sinusal'));
  assert.ok(g.p.sensitivity >= 0.9 && g.p.ppv >= 0.85, 'P');
  assert.ok(g.t.sensitivity >= 0.93 && g.t.ppv >= 0.95, 'T');
  assert.ok(Math.abs(g.p.peakMs.mean) <= 10 && g.p.peakMs.sd <= 15, 'pico P');
  assert.ok(Math.abs(g.t.peakMs.mean) <= 15 && g.t.peakMs.sd <= 40, 'pico T');
});
