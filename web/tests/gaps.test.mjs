// Lacunas de dados (amostras inválidas WFDB): nada inventado entra nos filtros
// nem no detector; na retomada o pipeline é re-armado sem degrau artificial.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SyntheticSource } from '../src/ecg/synth.js';
import { LeadFilterBank, HighPass1, Notch } from '../src/ecg/filters.js';
import { QrsDetector } from '../src/ecg/detector.js';
import { SignalPipeline, detectAll } from '../src/ecg/pipeline.js';
import { FileSource } from '../src/io/fileSource.js';
import { matchBeats } from '../src/ecg/scoring.js';
import { LEAD_NAMES } from '../src/ecg/leads.js';

const FS = 500;
const II = LEAD_NAMES.indexOf('II');

// Registro sintético de 12 derivações com um trecho de II substituído por NaN
// (como loadRecord faz com as sentinelas). Devolve o registro e os R verdadeiros.
function syntheticRecordWithGap({ seconds = 40, gapStart = 15, gapEnd = 18, seed = 7, offsetMv = 0 } = {}) {
  const src = new SyntheticSource({ fs: FS, seed });
  src.setParams({ hr: 72, hrvPct: 4, noiseMv: 0.03, mainsMv: 0.05 });
  const n = seconds * FS;
  const signals = LEAD_NAMES.map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    const s = src.next();
    for (let l = 0; l < LEAD_NAMES.length; l++) signals[l][i] = s.leads[l];
  }
  for (let i = Math.round(gapStart * FS); i < Math.round(gapEnd * FS); i++) signals[II][i] = NaN;
  // Deslocamento DC após a lacuna (ex.: eletrodo reconectado com outro offset).
  if (offsetMv) for (let i = Math.round(gapEnd * FS); i < n; i++) signals[II][i] += offsetMv;
  const record = {
    header: { fs: FS, signals: LEAD_NAMES.map((name) => ({ description: name })) },
    signals, beats: [], nSamples: n,
  };
  return { record, trueBeats: src.beats.filter((t) => t > 2 && t < seconds - 0.5) };
}

// `gapAware` = SignalPipeline compartilhado (interface e benchmark);
// false = comportamento antigo (sample-and-hold atravessa filtros e detector).
function run(record, gapAware) {
  const src = new FileSource(record);
  if (gapAware) {
    const { events, pipeline } = detectAll(src, { notchHz: 60, nLeads: LEAD_NAMES.length });
    return { dets: events, det: pipeline.detector, src };
  }
  const bank = new LeadFilterBank(FS, LEAD_NAMES.length, { notchHz: 60 });
  const det = new QrsDetector(FS);
  const dets = [];
  while (!src.done) {
    const s = src.next();
    const ev = det.process(bank.process(s.leads)[II], s.t);
    if (ev) dets.push(ev);
  }
  return { dets, det, src };
}

test('HighPass1.prime / Notch.prime: retomada sem degrau', () => {
  const hp = new HighPass1(FS, 0.5);
  for (let i = 0; i < 200; i++) hp.process(0.2 * Math.sin(i / 7));
  hp.prime(3.0);
  assert.equal(hp.process(3.0), 0, 'primeira amostra após re-armar sai 0');
  const n = new Notch(FS, 60);
  n.prime(0.7);
  assert.ok(Math.abs(n.process(0.7) - 0.7) < 1e-9, 'notch em regime permanente para DC');
});

test('LeadFilterBank: amostra mascarada não avança o estado; retomada re-arma a cadeia', () => {
  const a = new LeadFilterBank(FS, 1, { notchHz: 60 });
  const b = new LeadFilterBank(FS, 1, { notchHz: 60 });
  const x = (i) => 0.5 * Math.sin((2 * Math.PI * 3 * i) / FS);
  let last = 0;
  for (let i = 0; i < 300; i++) { last = a.process(new Float32Array([x(i)]))[0]; b.process(new Float32Array([x(i)])); }
  // 100 amostras mascaradas em `a`: saída repetida, estado intacto.
  for (let i = 300; i < 400; i++) {
    const out = a.process(new Float32Array([x(i)]), new Uint8Array([1]))[0];
    assert.equal(out, last);
  }
  assert.deepEqual(a.chains[0].map((f) => ({ ...f })), b.chains[0].map((f) => ({ ...f })), 'estado interno igual ao de um banco que não viu nada');
  // Retomada com degrau de +2 mV: re-armado, o passa-alta não propaga o degrau.
  const resumed = a.process(new Float32Array([x(400) + 2]))[0];
  assert.equal(resumed, 0);
  assert.equal(a.skipped[0], 0);
});

test('QrsDetector.notifyGap: fecha candidata, descarta reserva, não conta RR através da lacuna e re-arma buffers', () => {
  const d = new QrsDetector(FS);
  d.n = FS + 1; // fora do período de aprendizado
  d.rr = [0.8, 0.8];
  d.signalLevel = 1; d.noiseLevel = 0.1; d._updateThreshold();
  d.lastPeakT = 10.0;
  d.backup = { startT: 10.5, endT: 10.6, maxFeat: 0.2, maxAbsBp: 0.1, peakT: 10.55, strong: false };
  d.candidate = { startT: 10.9, endT: 10.95, maxFeat: 2, maxAbsBp: 1.2, peakT: 10.92, strong: true };
  const ev = d.notifyGap(10.95);
  assert.ok(ev && Math.abs(ev.t - (10.92 - d.groupDelay)) < 1e-9, 'candidata forte pré-lacuna vira QRS');
  assert.ok(Math.abs(ev.rr - (ev.t - 10.0)) < 1e-9, 'RR da candidata pré-lacuna ainda vale');
  assert.equal(d.backup, null);
  assert.equal(d.gapSinceLastPeak, true);
  assert.equal(d.resumePending, true);
  // Buffers com "memória" antiga; a primeira amostra pós-lacuna os re-arma.
  d.bufShort.fill(0.9); d.bufLong.fill(0.9); d.mwi.fill(5); d.mwiSum = 5 * d.mwiLen;
  const rrBefore = d.rr.length;
  d.process(0, 14.0);
  assert.equal(d.resumePending, false);
  assert.equal(d.mwiSum, 0);
  assert.ok(d.bufShort.every((v) => v === 0) && d.bufLong.every((v) => v === 0));
  // Próximo QRS após a lacuna: emitido, mas o RR (que atravessaria a lacuna) não entra na média.
  d.candidate = { startT: 14.5, endT: 14.6, maxFeat: 2, maxAbsBp: 1.2, peakT: 14.55, strong: true };
  const ev2 = d._closeCandidate(14.6);
  assert.equal(ev2.rr, null);
  assert.equal(d.rr.length, rrBefore);
  assert.equal(d.gapSinceLastPeak, false);
});

test('lacuna de 3 s em II: nenhuma detecção dentro da lacuna nem transiente na retomada; os demais batimentos continuam detectados', () => {
  for (const offsetMv of [0, 1.5]) {
    const { record, trueBeats } = syntheticRecordWithGap({ offsetMv });
    const { dets, src } = run(record, true);
    assert.equal(src.missingSamples, 3 * FS);
    const times = dets.map((e) => e.t);
    const inGap = times.filter((t) => t >= 15 && t < 18);
    assert.deepEqual(inGap, [], `offset ${offsetMv}: detecções dentro da lacuna`);
    const refsOutside = trueBeats.filter((t) => t < 15 - 0.2 || t > 18 + 0.2);
    const detsOutside = times.filter((t) => t > 2 && (t < 15 - 0.2 || t > 18 + 0.2));
    const m = matchBeats(refsOutside, detsOutside, 0.08);
    assert.ok(m.sensitivity >= 0.98 && m.ppv >= 0.98, `offset ${offsetMv}: sens ${m.sensitivity.toFixed(3)} ppv ${m.ppv.toFixed(3)} fp ${m.fp} fn ${m.fn}`);
    // Nenhuma detecção pode ter sido causada pelo degrau na retomada (primeiros 300 ms após 18 s).
    const atResume = times.filter((t) => t >= 18 && t < 18.3 && !trueBeats.some((r) => Math.abs(r - t) < 0.08));
    assert.deepEqual(atResume, [], `offset ${offsetMv}: falso positivo na retomada`);
    // A FC não deve ter sido contaminada por um RR de 3 s.
    const { det } = run(record, true);
    assert.ok(det.rr.every((rr) => rr < 1.5), `RR médio contaminado: ${det.rr.map((v) => v.toFixed(2)).join(',')}`);
  }
});

test('comparação com o comportamento antigo (sample-and-hold através do pipeline): o degrau da retomada gerava falso positivo', () => {
  const { record, trueBeats } = syntheticRecordWithGap({ offsetMv: 1.5 });
  const { dets } = run(record, false);
  const fpAtResume = dets.map((e) => e.t).filter((t) => t >= 17.8 && t < 18.4 && !trueBeats.some((r) => Math.abs(r - t) < 0.08));
  assert.ok(fpAtResume.length >= 1, 'o teste só é informativo se o comportamento antigo de fato falhava aqui');
});

test('SignalPipeline.step: passo a passo (interface) e detectAll (benchmark) produzem exatamente os mesmos eventos', () => {
  const { record } = syntheticRecordWithGap({ offsetMv: 1.5 });
  const a = detectAll(new FileSource(record), { notchHz: 60, nLeads: LEAD_NAMES.length }).events;
  const src = new FileSource(record);
  const p = new SignalPipeline(FS, LEAD_NAMES.length, { notchHz: 60, detectionLead: src.detectionLead });
  const b = [];
  let gapSamples = 0;
  while (!src.done) {
    const s = src.next();
    const { filtered, mask, event } = p.step(s);
    if (mask && mask[II]) gapSamples++;
    assert.ok(filtered.every(Number.isFinite), 'a saída filtrada nunca contém NaN');
    if (event) b.push(event);
  }
  assert.equal(gapSamples, 3 * FS);
  assert.deepEqual(b.map((e) => e.t), a.map((e) => e.t));
  assert.ok(a.length > 30);
});
