// Testes do leitor WFDB. Os registros reais em data/records/ trazem no cabeçalho
// um checksum de 16 bits por sinal e o valor da primeira amostra: se a
// decodificação estiver errada, esses testes falham. Executar: `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHeader, parseAnnotations, decodeSignals, verifyChecksums, loadRecord, unitsToMv, BEAT_SYMBOLS } from '../src/io/wfdb.js';
import { FileSource, mapSignalsToLeads } from '../src/io/fileSource.js';
import { matchBeats, OnlineScorer } from '../src/ecg/scoring.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

function checksum16(values) {
  return values.reduce((sum, v) => (sum + v) & 0xffff, 0);
}

async function readLocalRecord(entry) {
  const dir = path.join(root, 'data', 'records', entry.db);
  const hea = entry.files.find((f) => f.endsWith('.hea'));
  const headerText = await readFile(path.join(dir, hea), 'utf8');
  const files = {};
  for (const f of entry.files) {
    if (f === hea) continue;
    const buf = await readFile(path.join(dir, f));
    files[f] = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return loadRecord({ headerText, files, annotations: entry.annotations ? files[entry.annotations] : null });
}

// --- Cabeçalho (sem arquivos) -------------------------------------------------

test('parseHeader: MIT-BIH (formato 212, baseline implícito no adc_zero)', () => {
  const h = parseHeader(['100 2 360 650000', '100.dat 212 200 11 1024 995 -22131 0 MLII', '100.dat 212 200 11 1024 1011 20052 0 V5', '# 69 M 1085 1629 x1'].join('\n'));
  assert.equal(h.name, '100');
  assert.equal(h.fs, 360);
  assert.equal(h.nSamples, 650000);
  assert.equal(h.signals.length, 2);
  assert.deepEqual(h.comments, ['69 M 1085 1629 x1']);
  const s = h.signals[0];
  assert.equal(s.format, 212);
  assert.equal(s.gain, 200);
  assert.equal(s.baseline, 1024);
  assert.equal(s.initValue, 995);
  assert.equal(s.checksum, -22131);
  assert.equal(s.description, 'MLII');
});

test('parseHeader: LUDB (ganho com baseline entre parênteses e unidade)', () => {
  const h = parseHeader('1 12 500 5000\n1.dat 16 1716(6)/mV 0 0 -120 -32198 0 i\n' + '1.dat 16 1206(2)/mV 0 0 25 12402 0 ii\n'.repeat(11));
  assert.equal(h.signals[0].gain, 1716);
  assert.equal(h.signals[0].baseline, 6);
  assert.equal(h.signals[0].units, 'mV');
  assert.equal(h.signals[0].description, 'i');
});

test('parseHeader: rejeita multi-segmento e formatos desconhecidos', () => {
  assert.throws(() => parseHeader('x/3 1 250\nx.dat 16 200'), /multi-segmento/);
  assert.throws(() => parseHeader('x 1 250\nx.dat 310 200'), /não suportado/);
});

// --- Decodificação sintética -----------------------------------------------------

test('decodeSignals: formato 212 empacota pares de 12 bits com sinal', () => {
  // amostras: sinal A = [-1, 2047], sinal B = [-2048, 5]
  const bytes = new Uint8Array(6);
  const pack = (i, a, b) => {
    a &= 0xfff; b &= 0xfff;
    bytes[i] = a & 0xff; bytes[i + 1] = ((a >> 8) & 0x0f) | ((b >> 8) << 4); bytes[i + 2] = b & 0xff;
  };
  pack(0, -1, -2048);
  pack(3, 2047, 5);
  const h = parseHeader('r 2 360 2\nr.dat 212 200 11 0 -1 0 0 A\nr.dat 212 200 11 0 -2048 0 0 B');
  const { adc, physical } = decodeSignals(h, { 'r.dat': bytes.buffer });
  assert.deepEqual(Array.from(adc[0]), [-1, 2047]);
  assert.deepEqual(Array.from(adc[1]), [-2048, 5]);
  assert.ok(Math.abs(physical[0][1] - 2047 / 200) < 1e-6);
});

test('decodeSignals: formato 16 little-endian intercalado e checksum', () => {
  const v = new Int16Array([10, -20, 30, -40]); // sinal 0 = [10, 30], sinal 1 = [-20, -40]
  const h = parseHeader('r 2 500 2\nr.dat 16 1000(0)/mV 16 0 10 40 0 I\nr.dat 16 1000(0)/mV 16 0 -20 -60 0 II');
  const { adc } = decodeSignals(h, { 'r.dat': v.buffer });
  assert.deepEqual(Array.from(adc[0]), [10, 30]);
  assert.deepEqual(Array.from(adc[1]), [-20, -40]);
  assert.deepEqual(verifyChecksums(h, adc), [true, true]);
});

test('decodeSignals: aplica skew por sinal, marca cauda ausente e confere o checksum sobre as amostras armazenadas', () => {
  const sentinel = -32768;
  const values = [10, 100, 20, 200, 30, 300]; // intercalado: sinal 0 = 10,20,30; sinal 1 = 100,200,300
  const v = new Int16Array(values);
  // O checksum do cabeçalho WFDB cobre as amostras como estão no arquivo (antes do skew).
  const c0 = checksum16([10, 20, 30]);
  const c1 = checksum16([100, 200, 300]);
  const h = parseHeader(`r 2 500 3\nr.dat 16 100(0)/mV 16 0 10 ${c0} 0 I\nr.dat 16:1 100(0)/mV 16 0 200 ${c1} 0 II`);
  const { adc, physical, missing, storedChecksums } = decodeSignals(h, { 'r.dat': v.buffer });
  assert.deepEqual(Array.from(adc[0]), [10, 20, 30]);
  assert.deepEqual(Array.from(adc[1]), [200, 300, sentinel], 'sinal com skew 1 sai alinhado: começa na 2ª amostra armazenada');
  assert.deepEqual(Array.from(physical[1].slice(0, 2)), [2, 3]);
  assert.ok(Number.isNaN(physical[1][2]));
  assert.deepEqual(missing, [0, 1]);
  assert.deepEqual(storedChecksums, [c0, c1]);
  assert.deepEqual(verifyChecksums(h, storedChecksums), [true, true]);
  // Somar o ADC já deslocado daria outro valor para o sinal com skew — por isso não é isso que se confere.
  assert.deepEqual(verifyChecksums(h, adc), [true, false]);
  const rec = loadRecord({ headerText: `r 2 500 3\nr.dat 16 100(0)/mV 16 0 10 ${c0} 0 I\nr.dat 16:1 100(0)/mV 16 0 200 ${c1} 0 II`, files: { 'r.dat': v.buffer } });
  assert.deepEqual(rec.checksums, [true, true]);
});

test('decodeSignals/FileSource: sentinela formato 16 vira NaN e playback faz sample-and-hold', () => {
  const headerText = 'r 1 500 3\nr.dat 16 100(0)/mV 16 0 100 0 0 I';
  const v = new Int16Array([100, -32768, 120]);
  const rec = loadRecord({ headerText, files: { 'r.dat': v.buffer } });
  assert.deepEqual(Array.from(rec.adc[0]), [100, -32768, 120]);
  assert.equal(rec.signals[0][0], 1);
  assert.ok(Number.isNaN(rec.signals[0][1]));
  assert.ok(Math.abs(rec.signals[0][2] - 1.2) < 1e-6);
  assert.deepEqual(rec.missing, [1]);
  assert.equal(rec.missingTotal, 1);

  const source = new FileSource(rec);
  const first = source.next();
  const second = source.next();
  assert.equal(first.leads[0], 1);
  assert.equal(first.missing, false);
  assert.equal(second.leads[0], 1);
  assert.equal(second.missing, true);
  assert.equal(source.missingSamples, 1);
  assert.ok(Number.isFinite(second.leads[0]));
});

test('decodeSignals: sentinela formato 212 vira NaN físico', () => {
  const bytes = new Uint8Array(3);
  const pack = (i, a, b) => {
    a &= 0xfff; b &= 0xfff;
    bytes[i] = a & 0xff; bytes[i + 1] = ((a >> 8) & 0x0f) | ((b >> 8) << 4); bytes[i + 2] = b & 0xff;
  };
  pack(0, -2048, 5);
  const h = parseHeader('r 2 360 1\nr.dat 212 200 12 0 -2048 0 0 I\nr.dat 212 200 12 0 5 0 0 II');
  const { adc, physical, missing } = decodeSignals(h, { 'r.dat': bytes.buffer });
  assert.deepEqual(Array.from(adc[0]), [-2048]);
  assert.ok(Number.isNaN(physical[0][0]));
  assert.ok(Math.abs(physical[1][0] - 0.025) < 1e-6);
  assert.deepEqual(missing, [1, 0]);
});

test('decodeSignals: unidades uV e V são convertidas para mV; unidade desconhecida fica sem conversão e é sinalizada', () => {
  // Mesmo valor ADC (1000 acima da linha de base) em quatro declarações de unidade.
  const v = new Int16Array([1000, 1000, 1000, 1000]);
  const h = parseHeader([
    'r 4 500 1',
    'r.dat 16 1000(0)/mV 16 0 1000 0 0 A',
    'r.dat 16 1000(0)/uV 16 0 1000 0 0 B',
    'r.dat 16 1000(0)/V 16 0 1000 0 0 C',
    'r.dat 16 1000(0)/mmHg 16 0 1000 0 0 D',
  ].join('\n'));
  assert.deepEqual(h.signals.map((s) => s.units), ['mV', 'uV', 'V', 'mmHg']);
  const { physical, units } = decodeSignals(h, { 'r.dat': v.buffer });
  assert.ok(Math.abs(physical[0][0] - 1) < 1e-6, 'mV: 1000/1000 = 1 mV');
  assert.ok(Math.abs(physical[1][0] - 0.001) < 1e-9, 'uV: 1 uV = 0,001 mV');
  assert.ok(Math.abs(physical[2][0] - 1000) < 1e-3, 'V: 1 V = 1000 mV');
  assert.ok(Math.abs(physical[3][0] - 1) < 1e-6, 'desconhecida: valor declarado, sem fator');
  assert.deepEqual(units.map((u) => u.known), [true, true, true, false]);
  assert.deepEqual(units.map((u) => u.scaleToMv), [1, 1e-3, 1e3, 1]);
  assert.equal(unitsToMv('µV'), 1e-3);
  assert.equal(unitsToMv(undefined), 1);
  assert.equal(unitsToMv('adu'), null);
});

test('parseAnnotations: SKIP, AUX, NUM/CHN e terminador', () => {
  const words = [];
  const w = (code, data) => words.push((code << 10) | (data & 0x3ff));
  w(1, 100);                 // N em 100
  w(59, 0); words.push(0x0001, 0x0000); w(5, 7); // SKIP de 65536 + V em +7 → 65643
  w(63, 4); words.push(0x6261, 0x6463);          // AUX "abcd"
  w(62, 1); w(60, 3);        // CHN=1, NUM=3 (modificadores da mesma anotação)
  w(28, 50);                 // '+' em 65693 (herda chan=1)
  w(0, 0);                   // fim
  const buf = new Uint8Array(words.length * 2);
  words.forEach((x, i) => { buf[2 * i] = x & 0xff; buf[2 * i + 1] = (x >> 8) & 0xff; });
  const anns = parseAnnotations(buf.buffer);
  assert.equal(anns.length, 3);
  assert.deepEqual(anns.map((a) => a.symbol), ['N', 'V', '+']);
  assert.deepEqual(anns.map((a) => a.sample), [100, 65643, 65693]);
  assert.equal(anns[1].aux, 'abcd');
  assert.equal(anns[1].chan, 1);
  assert.equal(anns[1].num, 3);
  assert.equal(anns[2].chan, 1);
});

// --- Mapeamento e pontuação ---------------------------------------------------------

test('mapSignalsToLeads: MLII vira II; nomes minúsculos; registro genérico', () => {
  const m = mapSignalsToLeads(['MLII', 'V5']);
  assert.equal(m.available.filter(Boolean).length, 2);
  assert.equal(m.aliases.II, 'MLII');
  assert.equal(m.detectionLead, 1);

  const l = mapSignalsToLeads(['i', 'ii', 'iii', 'avr', 'avl', 'avf', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
  assert.ok(l.available.every(Boolean));
  assert.equal(l.unmapped.length, 0);

  const g = mapSignalsToLeads(['ECG1', 'ECG2']);
  assert.deepEqual(Array.from(g.mapping.slice(0, 2)), [0, 1]);
  assert.equal(g.aliases.I, 'ECG1');
  assert.equal(g.detectionLead, 0); // sem II: usa o primeiro sinal disponível

  // C1–C6 (posição do eletrodo) são as precordiais V1–V6, mesmo quando outras derivações são reconhecidas.
  const c = mapSignalsToLeads(['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
  assert.ok(c.available.every(Boolean));
  assert.equal(c.unmapped.length, 0);
  assert.deepEqual([c.aliases.V1, c.aliases.V6], ['C1', 'C6']);
  assert.equal(c.aliases.I, undefined);
});

test('matchBeats e OnlineScorer concordam num caso simples', () => {
  const refs = [1.0, 2.0, 3.0, 4.0];
  const dets = [1.05, 2.2, 3.01, 5.0]; // 2.2 fora da janela de 150 ms → FN+FP; 5.0 → FP
  const m = matchBeats(refs, dets, 0.15);
  assert.deepEqual([m.tp, m.fp, m.fn], [2, 2, 2]);

  const s = new OnlineScorer({ toleranceS: 0.15 });
  // Ao vivo, referências e detecções chegam intercaladas no tempo.
  const events = [...refs.map((t) => ({ t, kind: 'ref' })), ...dets.map((t) => ({ t, kind: 'det' }))].sort((a, b) => a.t - b.t);
  for (const e of events) { (e.kind === 'ref' ? s.addRef(e.t) : s.addDet(e.t)); s.flush(e.t); }
  s.flush(10);
  assert.deepEqual([s.tp, s.fp, s.fn], [2, 2, 2]);
});

// --- Registros reais (se baixados) ----------------------------------------------------

for (const entry of manifest.records) {
  const present = await exists(path.join(root, 'data', 'records', entry.db, entry.files[0]));
  test(`registro ${entry.id}: checksums, primeira amostra e anotações`, { skip: !present && 'não baixado (npm run fetch-data)' }, async () => {
    const rec = await readLocalRecord(entry);
    assert.equal(rec.nSamples, rec.header.nSamples);
    rec.checksums.forEach((ok, i) => assert.equal(ok, true, `checksum do sinal ${rec.header.signals[i].description}`));
    rec.adc.forEach((a, i) => assert.equal(a[0], rec.header.signals[i].initValue, `primeira amostra do sinal ${i}`));
    assert.ok(rec.signals.every((s) => s.every(Number.isFinite)));

    if (entry.annotations) {
      assert.ok(rec.beats.length > 0, 'deveria haver batimentos anotados');
      for (let i = 1; i < rec.beats.length; i++) assert.ok(rec.beats[i] > rec.beats[i - 1], 'batimentos em ordem crescente');
      assert.ok(rec.beats.at(-1) < rec.nSamples);
      assert.ok(rec.annotations.every((a) => a.symbol === '' || BEAT_SYMBOLS.has(a.symbol) || '~|+"()pt=!x[]sTD*^u?@'.includes(a.symbol)));
    } else {
      assert.equal(rec.beats.length, 0);
    }
    if (entry.id === 'mitdb/100') assert.equal(rec.beats.length, 2273); // 2239 N + 33 A + 1 V
    if (entry.id === 'mitdb/105') assert.equal(rec.beats.length, 2572);
    if (entry.db === 'ludb') assert.ok(rec.beats.length >= 6 && rec.beats.length <= 30);
  });
}
