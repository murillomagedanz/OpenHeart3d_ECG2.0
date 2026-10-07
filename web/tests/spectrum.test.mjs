import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  amplitudeSpectrum,
  SpectrumWindow,
  summarizeFilterBands,
  timeFrequencyAnalysis,
} from '../src/ecg/spectrum.js';
import { LeadFilterBank } from '../src/ecg/filters.js';
import { SignalPipeline } from '../src/ecg/pipeline.js';
import { FileSource } from '../src/io/fileSource.js';
import { loadRecord } from '../src/io/wfdb.js';
import { LEAD_NAMES } from '../src/ecg/leads.js';

const FS = 500;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function peakNear(spectrum, hz, tolerance = 0.5) {
  let peak = 0;
  for (let i = 0; i < spectrum.frequency.length; i++) {
    if (Math.abs(spectrum.frequency[i] - hz) <= tolerance) peak = Math.max(peak, spectrum.amplitude[i]);
  }
  return peak;
}

function framePeakHz(series, frameIndex) {
  const frame = series.frames[frameIndex];
  let peak = 0;
  for (let i = 1; i < frame.length; i++) {
    if (frame[i] > frame[peak]) peak = i;
  }
  return series.frequency[peak];
}

test('amplitudeSpectrum localiza tom conhecido e conserva escala de amplitude', () => {
  const samples = Float32Array.from({ length: 1024 }, (_, i) => 0.7 * Math.sin((2 * Math.PI * 12.5 * i) / 100));
  const spectrum = amplitudeSpectrum(samples, 100);
  let peak = 0;
  for (let i = 1; i < spectrum.amplitude.length; i++) {
    if (spectrum.amplitude[i] > spectrum.amplitude[peak]) peak = i;
  }
  assert.ok(Math.abs(spectrum.frequency[peak] - 12.5) < 0.1);
  assert.ok(Math.abs(spectrum.amplitude[peak] - 0.7) < 0.03);
  assert.equal(spectrum.fftSize, 1024);
  assert.equal(spectrum.sampleCount, samples.length);
  assert.throws(() => amplitudeSpectrum([0, 1, Number.NaN], 100), /Amostra inválida/);
  assert.throws(() => amplitudeSpectrum([0, 1], 100), /três amostras/);
  assert.throws(() => new SpectrumWindow(1, 2), /três amostras/);
});

test('SpectrumWindow produz três sinais alinhados e descarta a janela ao encontrar lacuna', () => {
  const window = new SpectrumWindow(4, 2);
  for (let i = 0; i < 7; i++) assert.equal(window.push(i, i / 2), false);
  assert.equal(window.push(7, 3.5), true);
  const data = window.samples();
  assert.deepEqual(Array.from(data.raw), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(Array.from(data.filtered), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  assert.deepEqual(Array.from(data.difference), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  assert.equal(window.push(8, 4, true), false);
  assert.equal(window.full, false);
  assert.equal(window.invalidated, true);
  for (let i = 0; i < 7; i++) window.push(i, i / 2);
  assert.equal(window.samples(), null);
  window.push(7, 3.5);
  assert.equal(window.full, true);
  window.reset(8);
  assert.equal(window.full, false);
  assert.equal(window.fs, 8);
  assert.equal(window.samples(), null);
});

test('janela de 10 s nativa mostra atenuação coerente com o passa-alta e notch', () => {
  const bank = new LeadFilterBank(FS, 1, { hpHz: 0.5, notchHz: 60 });
  const window = new SpectrumWindow(FS);
  for (let i = 0; i < FS * 12; i++) {
    const t = i / FS;
    const raw = 0.2 * Math.sin(2 * Math.PI * 0.2 * t)
      + 0.5 * Math.sin(2 * Math.PI * 10 * t)
      + 0.1 * Math.sin(2 * Math.PI * 60 * t);
    const filtered = bank.process(new Float32Array([raw]))[0];
    if (i >= FS * 2) window.push(raw, filtered);
  }
  const spectra = window.analyze();
  assert.equal(spectra.raw.sampleCount, FS * 10);
  assert.equal(spectra.raw.fs, FS);
  assert.equal(spectra.raw.fftSize, 8192);
  assert.ok(peakNear(spectra.filtered, 0.2) < peakNear(spectra.raw, 0.2) * 0.55, 'passa-alta reduz 0,2 Hz');
  assert.ok(peakNear(spectra.filtered, 60) < peakNear(spectra.raw, 60) * 0.1, 'notch reduz 60 Hz');
  assert.ok(peakNear(spectra.filtered, 10) > peakNear(spectra.raw, 10) * 0.9, '10 Hz é preservado');
  assert.ok(peakNear(spectra.difference, 60) > peakNear(spectra.raw, 60) * 0.8, 'diferença contém componente removido');
  assert.ok(peakNear(spectra.difference, 10) < peakNear(spectra.raw, 10) * 0.1, 'diferença não domina na banda preservada');
  const bands = summarizeFilterBands(spectra, { highPassHz: 0.5, notchHz: 60, notchQ: 30, notchActive: true });
  assert.ok(bands.low.raw.amplitude > bands.low.filtered.amplitude * 1.5);
  assert.ok(bands.mains.raw.amplitude > bands.mains.filtered.amplitude * 5);
  assert.equal(bands.low.upperHz, 0.5);
  assert.ok(Math.abs(bands.mains.centerHz - 60) < 1e-9);
});

test('faixa de notch acima de Nyquist é indicada como indisponível sem intervalo invertido', () => {
  const spectrum = amplitudeSpectrum(new Float32Array(1000), 100);
  const bands = summarizeFilterBands({
    raw: spectrum,
    filtered: spectrum,
    difference: spectrum,
  }, { notchHz: 60, notchQ: 30, notchActive: false });
  assert.equal(bands.mains.available, false);
  assert.equal(bands.mains.lowerHz, null);
  assert.equal(bands.mains.upperHz, null);
  assert.equal(bands.mains.active, false);
  assert.equal(bands.mains.raw.frequency, null);
  assert.ok(Number.isFinite(bands.low.upperHz));
});

test('timeFrequencyAnalysis localiza tons diferentes em partes distintas do mesmo intervalo', () => {
  const raw = Float32Array.from({ length: 1000 }, (_, i) => {
    const t = i / 100;
    return Math.sin(2 * Math.PI * (t < 5 ? 5 : 20) * t);
  });
  const filtered = Float32Array.from(raw);
  const result = timeFrequencyAnalysis(raw, filtered, 100);
  assert.equal(result.frameSamples, 200);
  assert.equal(result.hopSamples, 100);
  assert.equal(result.frameCount, 9);
  assert.deepEqual(Array.from(result.times), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(Math.abs(framePeakHz(result.raw, 2) - 5) < 0.6);
  assert.ok(Math.abs(framePeakHz(result.raw, 7) - 20) < 0.6);
  assert.deepEqual(Array.from(result.raw.frequency), Array.from(result.filtered.frequency));
  assert.deepEqual(Array.from(result.raw.frequency), Array.from(result.difference.frequency));
  assert.throws(() => timeFrequencyAnalysis(raw.subarray(0, 100), filtered.subarray(0, 100), 100), /curta/);
  assert.throws(() => timeFrequencyAnalysis([1, 2], [1, 2], 1, { frameSeconds: 2 }), /inválidos/);
});

test('registros reais bundled preservam fs nativa e alinhamento em espectro, STFT e medidas de banda', async (t) => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
  const sampleRates = new Set();
  let processed = 0;
  for (const entry of manifest.records.filter((r) => r.bundled)) {
    const directory = path.join(ROOT, 'data', 'records', entry.db);
    try {
      await access(path.join(directory, entry.files[0]));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      continue;
    }
    const headerName = entry.files.find((name) => name.endsWith('.hea'));
    const headerText = await readFile(path.join(directory, headerName), 'utf8');
    const files = {};
    for (const name of entry.files) {
      if (name === headerName) continue;
      const buffer = await readFile(path.join(directory, name));
      files[name] = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    const record = loadRecord({ headerText, files, annotations: entry.annotations ? files[entry.annotations] : null });
    const source = new FileSource(record);
    const pipeline = new SignalPipeline(source.fs, LEAD_NAMES.length, {
      notchHz: manifest.databases[entry.db].mainsHz,
      detectionLead: source.detectionLead,
    });
    const window = new SpectrumWindow(source.fs);
    while (!source.done && !window.full) {
      const sample = source.next();
      const result = pipeline.step(sample);
      window.push(
        sample.leads[source.detectionLead],
        result.filtered[source.detectionLead],
        Boolean(result.mask && result.mask[source.detectionLead]),
      );
    }
    assert.equal(window.full, true, `registro ${entry.id}: janela válida de 10 s`);
    const spectra = window.analyze();
    const tf = window.analyzeTimeFrequency();
    const bands = summarizeFilterBands(spectra, {
      highPassHz: 0.5,
      notchHz: manifest.databases[entry.db].mainsHz,
      notchQ: 30,
      notchActive: pipeline.filters.notchActive,
    });
    assert.deepEqual([spectra.raw.fs, spectra.filtered.fs, spectra.difference.fs], [source.fs, source.fs, source.fs]);
    assert.deepEqual(
      [spectra.raw.sampleCount, spectra.filtered.sampleCount, spectra.difference.sampleCount],
      [source.fs * 10, source.fs * 10, source.fs * 10],
    );
    assert.equal(tf.fs, source.fs);
    assert.equal(tf.frameCount, 9);
    assert.ok(spectra.raw.amplitude.every(Number.isFinite));
    assert.ok(spectra.filtered.amplitude.every(Number.isFinite));
    assert.ok(spectra.difference.amplitude.every(Number.isFinite));
    for (const name of ['raw', 'filtered', 'difference']) {
      assert.ok(tf[name].frames.every((frame) => frame.every(Number.isFinite)));
    }
    assert.ok(Number.isFinite(bands.low.raw.amplitude));
    sampleRates.add(source.fs);
    processed++;
  }
  if (!processed) t.skip('nenhum registro bundled disponível localmente');
  else {
    assert.ok(sampleRates.has(360), 'inclui frequência nativa MIT-BIH');
    assert.ok(sampleRates.has(500), 'inclui frequência nativa PTB-XL/LUDB');
  }
});
