// Testes dos filtros por derivação: o notch precisa existir de fato na
// frequência de amostragem do registro, senão é desativado e dito na tela.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Notch, HighPass1, LeadFilterBank } from '../src/ecg/filters.js';

function rms(fn, fs, hz, seconds = 4) {
  let acc = 0; let n = 0;
  const skip = Math.round(fs * 1); // descarta o transitório
  for (let i = 0; i < fs * seconds; i++) {
    const y = fn(Math.sin(2 * Math.PI * hz * (i / fs)));
    if (i >= skip) { acc += y * y; n++; }
  }
  return Math.sqrt(acc / n);
}

test('Notch: recusa f0 ≥ fs/2 (coeficientes instáveis)', () => {
  assert.throws(() => new Notch(100, 60), RangeError);
  assert.throws(() => new Notch(120, 60), RangeError);
  assert.doesNotThrow(() => new Notch(360, 60));
  assert.doesNotThrow(() => new Notch(125, 60));
});

test('Notch 60 Hz a 360 Hz: atenua 60 Hz e preserva 5 Hz', () => {
  const n60 = new Notch(360, 60);
  const n5 = new Notch(360, 60);
  const at60 = rms((x) => n60.process(x), 360, 60) / Math.SQRT1_2;
  const at5 = rms((x) => n5.process(x), 360, 5) / Math.SQRT1_2;
  assert.ok(at60 < 0.05, `60 Hz deveria cair > 26 dB; ganho = ${at60.toFixed(3)}`);
  assert.ok(at5 > 0.97, `5 Hz deveria passar quase intacto; ganho = ${at5.toFixed(3)}`);
});

test('LeadFilterBank: com fs ≤ 2·f0 o notch é desativado, a saída fica limitada e a descrição avisa', () => {
  const bank = new LeadFilterBank(100, 1, { notchHz: 60 });
  assert.equal(bank.notchActive, false);
  assert.match(bank.description, /notch 60 Hz desativado/);
  const hp = new HighPass1(100, 0.5);
  let maxAbs = 0;
  for (let i = 0; i < 100 * 10; i++) {
    const x = Math.sin(2 * Math.PI * 7 * (i / 100));
    const y = bank.process(new Float32Array([x]))[0];
    maxAbs = Math.max(maxAbs, Math.abs(y));
    assert.ok(Math.abs(y - hp.process(x)) < 1e-6, 'sem notch, a cadeia deve ser só o passa-alta');
  }
  assert.ok(maxAbs < 1.5, `saída deveria ficar limitada; máximo = ${maxAbs}`);
});

test('LeadFilterBank: com fs normal o notch está ativo e a descrição o informa', () => {
  const bank = new LeadFilterBank(500, 12, { notchHz: 50 });
  assert.equal(bank.notchActive, true);
  assert.match(bank.description, /notch 50 Hz \(Q=30\)/);
  assert.equal(bank.chains[0].length, 2);
});
