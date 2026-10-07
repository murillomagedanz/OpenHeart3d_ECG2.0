// Testes do escore ao vivo (OnlineScorer): a janela de espera de uma referência
// deve acompanhar a latência máxima do detector, que no search-back chega a
// 1,66 × RR; e o fim do registro deve fechar a contagem.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OnlineScorer, matchBeats } from '../src/ecg/scoring.js';
import { QrsDetector } from '../src/ecg/detector.js';

test('OnlineScorer: detecção atrasada pelo search-back não vira FN + FP quando maxLatencyS cobre o atraso', () => {
  // Batimento de referência em 10,0 s; detector com RR médio de 1,0 s só o
  // declara por search-back em ~11,66 s (latência 1,66 s > 0,6 s).
  const s = new OnlineScorer({ toleranceS: 0.15 });
  s.maxLatencyS = 1.66 + 0.12 + 0.15;
  s.addRef(10.0);
  for (let t = 10.0; t <= 11.66; t += 0.002) s.flush(t);
  assert.deepEqual([s.tp, s.fp, s.fn], [0, 0, 0], 'referência ainda deve estar pendente');
  s.addDet(10.02);
  s.flush(11.7);
  assert.deepEqual([s.tp, s.fp, s.fn], [1, 0, 0]);
});

test('OnlineScorer: com a janela fixa antiga (0,6 s) o mesmo caso dava FN + FP', () => {
  const s = new OnlineScorer({ toleranceS: 0.15, maxLatencyS: 0.6 });
  s.addRef(10.0);
  for (let t = 10.0; t <= 11.66; t += 0.002) s.flush(t);
  s.addDet(10.02);
  s.flush(12.5);
  assert.deepEqual([s.tp, s.fp, s.fn], [0, 1, 1]);
});

test('OnlineScorer: detecção sem referência vira FP após a tolerância, não após a latência máxima', () => {
  const s = new OnlineScorer({ toleranceS: 0.15, maxLatencyS: 3 });
  s.addDet(5.0);
  s.flush(5.7); // 2 × 0,15 + 0,3 = 0,6 s de carência
  assert.equal(s.fp, 1);
});

test('OnlineScorer: flush(Infinity) fecha pendências como FN/FP (fim do registro)', () => {
  const s = new OnlineScorer({ toleranceS: 0.15, maxLatencyS: 3 });
  s.addRef(1.0); s.addDet(1.02); // par
  s.addRef(2.0);                 // sem detecção
  s.addDet(3.0);                 // sem referência
  assert.deepEqual([s.tp, s.fp, s.fn], [1, 0, 0]);
  s.flush(Infinity);
  assert.deepEqual([s.tp, s.fp, s.fn], [1, 1, 1]);
  assert.deepEqual(s.snapshot(), { tp: 1, fp: 1, fn: 1, sensitivity: 0.5, ppv: 0.5 });
});

test('OnlineScorer: pareamento cronológico — detecção ambígua casa com a referência mais antiga, como no offline', () => {
  // Exemplo da revisão: referências em 1,00 e 1,28 s já pendentes quando chega a
  // detecção 1,141 s (dentro de ±150 ms de AMBAS); depois chega 1,30 s.
  // "Mais próxima" roubaria 1,28 e deixaria 1,00 órfã (FN + FP); cronológico dá 2 TP.
  const refs = [1.0, 1.28];
  const dets = [1.141, 1.3];
  const offline = matchBeats(refs, dets, 0.15);
  const live = new OnlineScorer({ toleranceS: 0.15, maxLatencyS: 2 });
  live.addRef(1.0); live.flush(1.0);
  live.addRef(1.28); live.flush(1.28);
  live.addDet(1.141); live.flush(1.3);   // emitida com atraso, após as duas referências
  live.addDet(1.3); live.flush(1.45);
  live.flush(Infinity);
  assert.deepEqual([live.tp, live.fp, live.fn], [2, 0, 0]);
  assert.deepEqual([live.tp, live.fp, live.fn], [offline.tp, offline.fp, offline.fn]);
});

test('OnlineScorer: referência casa com a detecção pendente mais antiga; detecções ficam ordenadas por tempo', () => {
  const live = new OnlineScorer({ toleranceS: 0.15, maxLatencyS: 2 });
  live.addDet(1.0);    // normal
  live.addDet(0.9);    // search-back com t mais antigo, emitida depois
  assert.deepEqual(live.pendingDets, [0.9, 1.0]);
  live.addRef(1.0);    // compatível com as duas: fica com a mais antiga (0,9), como matchBeats
  assert.equal(live.tp, 1);
  assert.deepEqual(live.pendingDets, [1.0]);
  const offline = matchBeats([1.0], [1.0, 0.9], 0.15);
  live.flush(Infinity);
  assert.deepEqual([live.tp, live.fp, live.fn], [offline.tp, offline.fp, offline.fn]);
});

test('QrsDetector.maxLatency cresce com o RR médio e nunca fica abaixo de 0,6 s', () => {
  const d = new QrsDetector(500);
  assert.equal(d.maxLatency, 0.6);
  d.rr = [1.0, 1.0, 1.0];
  assert.ok(Math.abs(d.maxLatency - (1.66 + d.candidateMax + 0.15)) < 1e-9);
  d.rr = [0.3];
  assert.ok(Math.abs(d.maxLatency - (1.66 * 0.3 + d.candidateMax + 0.15)) < 1e-9);
  assert.ok(d.maxLatency >= 0.6);
});

test('matchBeats (offline) e OnlineScorer (ao vivo) concordam num registro com search-back simulado', () => {
  // Batimentos a 1 s; a detecção do batimento 5 chega atrasada (search-back) com t exato.
  const refs = [1, 2, 3, 4, 5, 6, 7, 8];
  const emitted = [[1.01, 1.13], [2.0, 2.12], [3.02, 3.13], [4.0, 4.12], [5.01, 6.66], [6.0, 6.12], [7.0, 7.13], [8.01, 8.13]]; // [tDet, tEmitido]
  const offline = matchBeats(refs, emitted.map((e) => e[0]), 0.15);
  const live = new OnlineScorer({ toleranceS: 0.15, maxLatencyS: 1.66 + 0.27 });
  const events = [...refs.map((t) => ({ at: t, kind: 'ref', t })), ...emitted.map(([t, at]) => ({ at, kind: 'det', t }))].sort((a, b) => a.at - b.at);
  for (const e of events) { (e.kind === 'ref' ? live.addRef(e.t) : live.addDet(e.t)); live.flush(e.at); }
  live.flush(Infinity);
  assert.deepEqual([live.tp, live.fp, live.fn], [offline.tp, offline.fp, offline.fn]);
  assert.deepEqual([live.tp, live.fp, live.fn], [8, 0, 0]);
});
