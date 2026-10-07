// O ECG posiciona o tempo dos clipes de animação do modelo anatômico: nunca autoplay.
// Estes testes fixam o contrato da função que faz essa tradução.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  envelope, smooth, clipTime, VENT_RISE, VENT_HOLD, VENT_FALL, ATRIAL_RISE, ATRIAL_FALL,
} from '../src/view/envelopes.js';

test('envelope: trapézio 0→1→0 e suavização monotônica', () => {
  assert.equal(envelope(-0.01, 0.1, 0.2, 0.3), 0);
  assert.equal(envelope(0.05, 0.1, 0.2, 0.3), 0.5);
  assert.equal(envelope(0.2, 0.1, 0.2, 0.3), 1);
  assert.ok(Math.abs(envelope(0.45, 0.1, 0.2, 0.3) - 0.5) < 1e-9);
  assert.equal(envelope(0.6, 0.1, 0.2, 0.3), 0);
  assert.equal(smooth(0), 0); assert.equal(smooth(1), 1); assert.equal(smooth(0.5), 0.5);
  for (let e = 0; e < 1; e += 0.05) assert.ok(smooth(e + 0.05) > smooth(e));
});

test('clipTime: relaxado fora da janela, contraído em peak na sustentação, descida até duration', () => {
  const peak = 0.2; const duration = 0.6;
  const f = (dt) => clipTime(dt, VENT_RISE, VENT_HOLD, VENT_FALL, peak, duration);
  assert.equal(f(-1), 0);
  assert.equal(f(NaN), 0);
  assert.equal(f(-Infinity), 0);
  assert.equal(f(0), 0);
  // subida: cresce de 0 até peak, sem ultrapassar
  let prev = 0;
  for (let dt = 0; dt < VENT_RISE; dt += VENT_RISE / 20) { const v = f(dt); assert.ok(v >= prev && v <= peak); prev = v; }
  assert.ok(Math.abs(f(VENT_RISE) - peak) < 1e-9);
  assert.ok(Math.abs(f(VENT_RISE + VENT_HOLD / 2) - peak) < 1e-9);
  // descida: avança de peak até duration (trajetória do autor), monotônica
  prev = peak;
  for (let dt = VENT_RISE + VENT_HOLD; dt < VENT_RISE + VENT_HOLD + VENT_FALL; dt += VENT_FALL / 20) { const v = f(dt); assert.ok(v >= prev - 1e-9 && v <= duration); prev = v; }
  assert.ok(Math.abs(f(VENT_RISE + VENT_HOLD + VENT_FALL - 1e-6) - duration) < 1e-3);
  assert.equal(f(VENT_RISE + VENT_HOLD + VENT_FALL), 0); // fim da janela: volta à pose relaxada
  assert.equal(f(10), 0);
});

test('clipTime: envelope atrial (sem sustentação) e clipe sem pico informado', () => {
  const f = (dt) => clipTime(dt, ATRIAL_RISE, 0, ATRIAL_FALL, 0.3, 0.667);
  assert.ok(Math.abs(f(ATRIAL_RISE) - 0.3) < 1e-9);
  assert.ok(f(ATRIAL_RISE + ATRIAL_FALL / 2) > 0.3);
  assert.equal(f(ATRIAL_RISE + ATRIAL_FALL), 0);
  // peak = duration/2 é o padrão quando o arquivo não traz a dica
  assert.ok(Math.abs(clipTime(1, 1, 0, 1, 0.5, 1) - 0.5) < 1e-9);
});
