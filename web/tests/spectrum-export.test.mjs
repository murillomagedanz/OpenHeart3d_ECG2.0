import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SpectrumWindow, summarizeFilterBands } from '../src/ecg/spectrum.js';
import { safeSpectrumMetadata, serializeSpectrumExport, spectrumExportFilename } from '../src/io/spectrumExport.js';
import { SpectrumExportControl } from '../src/view/spectrumExportControl.js';
import { LEAD_NAMES } from '../src/ecg/leads.js';
import { SyntheticSource } from '../src/ecg/synth.js';
import { SignalPipeline } from '../src/ecg/pipeline.js';
import { WaveTracker } from '../src/ecg/waves.js';
import { FileSource } from '../src/io/fileSource.js';

const DATE = new Date('2026-10-07T20:00:00.000Z');
const FILTERS = { highPassHz: 0.5, notchHz: 60, notchQ: 30, notchActive: false };

function dataset(stft = false) {
  const window = new SpectrumWindow(16);
  for (let i = 0; i < 160; i++) window.push(Math.sin(i), Math.sin(i) / 2);
  return {
    metadata: safeSpectrumMetadata({
      origin: 'real', catalogRecord: { db: 'mitdb', record: '100' },
      lead: 'II', alias: 'MLII', unit: 'mV', fs: 16, endIndex: 320, sampleCount: 160, filters: FILTERS,
    }),
    spectra: window.analyze(), timeFrequency: stft ? window.analyzeTimeFrequency() : null,
  };
}

test('JSON versionado preserva números, arrays completos, bandas e limites reproduzíveis', () => {
  const data = dataset();
  const json = serializeSpectrumExport(data, DATE);
  const result = JSON.parse(json);
  assert.equal(json, serializeSpectrumExport(data, DATE));
  assert.equal(result.schema, 'openheart3d.ecg.spectral-analysis');
  assert.equal(result.version, 1);
  assert.equal(result.exportedAt, DATE.toISOString());
  assert.equal(result.recordId, 'mitdb:100');
  assert.deepEqual(result.lead, { name: 'II', alias: 'MLII' });
  assert.deepEqual(result.window, {
    sampleCount: 160, durationSeconds: 10, startIndex: 160, endIndexExclusive: 320,
    startSeconds: 10, endSecondsExclusive: 20, lastSampleSeconds: 319 / 16,
  });
  assert.equal(result.fs, 16);
  assert.equal(result.unit, 'mV');
  assert.equal(result.filters.notch.active, false);
  assert.equal(result.spectralMethod.fftSize, 256);
  assert.equal(result.spectralMethod.resolutionHz, 16 / 256);
  assert.equal(result.spectralMethod.removeDC, false);
  assert.equal(result.spectralMethod.window, 'Hann');
  assert.equal(result.spectralMethod.scale, 'one-sided-peak-amplitude');
  assert.equal(result.spectralMethod.zeroPadding, 'next-power-of-two');
  assert.deepEqual(result.spectra.frequencyHz, [...data.spectra.raw.frequency]);
  for (const key of ['raw', 'filtered', 'difference']) {
    assert.deepEqual(result.spectra.amplitude[key], [...data.spectra[key].amplitude]);
    assert.equal(result.spectra.amplitude[key].length, 129);
  }
  assert.deepEqual(result.bandMetrics, summarizeFilterBands(data.spectra, FILTERS));
  assert.equal('stft' in result, false);
  assert.match(spectrumExportFilename(data.metadata), /^[A-Za-z0-9._-]+\.json$/);
});

test('STFT serializa matrizes e centros relativos/absolutos alinhados na mesma janela', () => {
  const data = dataset(true);
  const { stft } = JSON.parse(serializeSpectrumExport(data, DATE));
  assert.equal(stft.frameCount, 9);
  assert.equal(stft.frameSamples, 32);
  assert.equal(stft.hopSamples, 16);
  assert.equal(stft.frameSeconds, 2);
  assert.equal(stft.hopSeconds, 1);
  assert.equal(stft.matrixOrder, 'frame-by-frequency');
  assert.equal(stft.method.fftSize, 32);
  assert.equal(stft.method.resolutionHz, 0.5);
  assert.deepEqual(stft.centerSecondsRelative, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(stft.centerSecondsAbsolute, [11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.deepEqual(stft.frequencyHz, [...data.timeFrequency.frequency]);
  for (const key of ['raw', 'filtered', 'difference']) {
    assert.deepEqual(stft.amplitude[key], data.timeFrequency[key].frames.map((f) => [...f]));
  }
});

test('campos incidentais, amostras, caminhos e metadados pessoais nunca cruzam a allowlist', () => {
  const data = dataset(true);
  const forbidden = {
    samples: [1, 2, 3], header: 'PRIVATE-CANARY', annotations: 'PRIVATE-CANARY',
    labels: 'PRIVATE-CANARY', datasetLabels: 'PRIVATE-CANARY', path: 'C:\\PRIVATE-CANARY',
    vaultKey: 'PRIVATE-CANARY', patient: 'PRIVATE-CANARY', notes: 'PRIVATE-CANARY',
  };
  for (const target of [data, data.metadata, data.metadata.filters, data.spectra.raw,
    data.timeFrequency, data.timeFrequency.raw]) Object.assign(target, forbidden);
  const json = serializeSpectrumExport(data, DATE);
  assert.ok(!json.includes('PRIVATE-CANARY'));
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      assert.ok(!Object.keys(forbidden).includes(key), `propriedade proibida: ${key}`);
      inspect(item);
    }
  }
  inspect(JSON.parse(json));
  const local = safeSpectrumMetadata({
    origin: 'real', catalogRecord: { db: 'local', record: 'PRIVATE-CANARY' },
    lead: 'I', alias: 'PRIVATE-CANARY', unit: 'PRIVATE-CANARY', fs: 16,
    endIndex: 160, sampleCount: 160, filters: FILTERS, ...forbidden,
  });
  assert.equal(local.recordId, null);
  assert.equal(local.lead.alias, null);
  assert.equal(local.unit, 'unknown');
  assert.ok(!JSON.stringify(local).includes('PRIVATE-CANARY'));
});

test('contrato recusa janela ausente, valores não finitos e espectros/STFT desalinhados', () => {
  assert.throws(() => serializeSpectrumExport(null), /indisponível/);
  const data = dataset(true);
  data.spectra.filtered.amplitude[1] = NaN;
  assert.throws(() => serializeSpectrumExport(data), /não finito/);
  const mismatch = dataset(true);
  mismatch.timeFrequency.times[0] = 99;
  assert.throws(() => serializeSpectrumExport(mismatch), /temporal STFT/);
  const fsMismatch = dataset();
  fsMismatch.spectra.filtered.fs = 500;
  assert.throws(() => serializeSpectrumExport(fsMismatch), /desalinhados/);
});

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace(/^import .*;\r?$/gm, '');

function app() {
  const elements = new Map();
  const downloads = [];
  const revoked = [];
  const deferred = [];
  let blob;
  let failClick = false;
  function element() {
    const handlers = {};
    return {
      value: '0', textContent: '', disabled: false, children: [], handlers,
      classList: { add() {}, remove() {} },
      addEventListener(name, handler) { handlers[name] = handler; },
      append(...items) { this.children.push(...items); },
      appendChild(item) { this.children.push(item); },
      replaceChildren(...items) { this.children = items; },
      setAttribute() {}, remove() {},
      click() {
        assert.ok(!elements.get('spectrum-export-status').textContent.includes('solicitado'));
        if (failClick) throw new Error('download bloqueado');
        downloads.push({ href: this.href, filename: this.download, blob });
      },
    };
  }
  const modeButtons = ['frequency', 'time-frequency'].map((mode) => {
    const button = element();
    button.dataset = { spectrumMode: mode };
    return button;
  });
  const document = {
    getElementById(id) {
      if (!elements.has(id)) { const el = element(); el.ownerDocument = document; elements.set(id, el); }
      return elements.get(id);
    },
    createElement: element, createTextNode: (textContent) => ({ textContent }), body: element(),
    querySelectorAll: (selector) => selector === '[data-spectrum-mode]' ? modeButtons : [],
  };
  class View {
    reset() {} setLeads() {} setMode() {} draw() {} update() {} onQrs() {} setContext() {}
    push() {} markQrs() {} markWave() {}
  }
  class ExportControl extends SpectrumExportControl {
    constructor(button, status) {
      super(button, status, {
        document, Blob, defer: (callback) => deferred.push(callback),
        URL: { createObjectURL(value) { blob = value; return 'blob:local-test'; },
          revokeObjectURL(url) { revoked.push(url); } },
      });
    }
  }
  const context = vm.createContext({
    document, Node: class {}, LEAD_NAMES, SyntheticSource, SignalPipeline, WaveTracker, FileSource,
    SpectrumWindow, summarizeFilterBands, safeSpectrumMetadata, SpectrumExportControl: ExportControl,
    EcgPlot: View, SpectrumPlot: View, Heart3D: View, performance: { now: () => 0 },
    requestAnimationFrame() {}, console,
    fetch() { assert.fail('Export must never use the network'); },
    loadRuntimeAsset: async () => null, isDevHost: () => false,
    ResizeObserver: class { observe() {} }, window: { addEventListener() {} },
  });
  for (const [id, value] of Object.entries({ hr: '72', hrv: '4', noise: '0.02', mains: '0' })) {
    document.getElementById(id).value = value;
  }
  vm.runInContext(main, context);
  vm.runInContext('function render(now) { lastFrame = now; frame(now); }', context);
  const run = (code) => vm.runInContext(code, context);
  const click = (id) => elements.get(id).handlers.click();
  return { elements, downloads, revoked, deferred, run, click, modeButtons,
    failDownload() { failClick = true; } };
}

test('UI integrada: desabilitada antes da janela, download local, pausa, modos e reset', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Download não pode acessar a rede'));
  const a = app();
  const button = a.elements.get('spectrum-export');
  assert.equal(button.disabled, true);
  a.click('spectrum-export');
  assert.equal(a.downloads.length, 0);
  a.run('for (let i = 0; i < 4999; i++) step(); render(250)');
  assert.equal(button.disabled, true);
  a.run('step(); render(500)');
  assert.equal(button.disabled, false);
  a.click('pause');
  a.run('frame(750)');
  assert.equal(button.disabled, false);
  a.click('spectrum-export');
  assert.equal(a.downloads.length, 1);
  const first = JSON.parse(await a.downloads[0].blob.text());
  assert.equal(first.origin, 'synthetic');
  assert.equal(first.recordId, null);
  assert.equal(first.window.startIndex, 0);
  assert.equal(first.window.endIndexExclusive, 5000);
  assert.equal(first.stft, undefined);
  assert.equal(a.downloads[0].blob.type, 'application/json');
  assert.match(a.downloads[0].filename, /^[A-Za-z0-9._-]+\.json$/);
  assert.equal(a.revoked.length, 0);
  a.deferred.shift()();
  assert.deepEqual(a.revoked, ['blob:local-test']);
  a.modeButtons[1].handlers.click();
  assert.equal(button.disabled, true);
  a.run('frame(1000)');
  assert.equal(button.disabled, false);
  a.click('spectrum-export');
  const second = JSON.parse(await a.downloads[1].blob.text());
  assert.deepEqual(second.window, first.window);
  assert.deepEqual(second.spectra, first.spectra);
  assert.equal(second.stft.frameCount, 9);
  a.run('useSynthetic()');
  assert.equal(button.disabled, true);
  a.click('spectrum-export');
  assert.equal(a.downloads.length, 2);
});

test('lacuna, recuperação e reconstrução do pipeline invalidam o dataset', () => {
  const a = app();
  a.run('for (let i = 0; i < 5000; i++) step(); render(250)');
  assert.equal(a.elements.get('spectrum-export').disabled, false);
  a.run('spectrumWindow.push(NaN, 0); render(500)');
  assert.equal(a.elements.get('spectrum-export').disabled, true);
  assert.match(a.elements.get('spectrum-export-status').textContent, /lacuna/);
  a.run('for (let i = 0; i < 4999; i++) step(); render(750)');
  assert.equal(a.elements.get('spectrum-export').disabled, true);
  a.run('step(); render(1000)');
  assert.equal(a.elements.get('spectrum-export').disabled, false);
  a.run('buildPipeline(500)');
  assert.equal(a.elements.get('spectrum-export').disabled, true);
});

test('troca por arquivo local não exporta nome/cabeçalho; fim do registro limpa o export', async () => {
  const a = app();
  a.run(`state.source = new SyntheticSource({ fs: 16, seed: 42 }); buildPipeline(16);
    for (let i = 0; i < 160; i++) step(); render(250);
    useRecord({
      header: { fs: 16, name: 'PRIVATE-CANARY', nSig: 1, comments: ['PRIVATE-CANARY'],
        signals: [{ description: 'PRIVATE-CANARY' }] },
      signals: [new Float32Array(160).fill(0.5)], nSamples: 160, duration: 10,
      beats: [], units: [{ known: false, declared: 'PRIVATE-CANARY' }], checksums: [],
    }, { id: 'local/PRIVATE-CANARY', record: 'PRIVATE-CANARY', dbName: 'arquivo local' });`);
  assert.equal(a.elements.get('spectrum-export').disabled, true);
  a.run('for (let i = 0; i < 159; i++) step(); render(500)');
  assert.equal(a.elements.get('spectrum-export').disabled, true);
  a.run('step(); render(750)');
  a.click('pause');
  a.click('spectrum-export');
  const json = await a.downloads[0].blob.text();
  assert.ok(!json.includes('PRIVATE-CANARY'));
  const result = JSON.parse(json);
  assert.equal(result.recordId, null);
  assert.equal(result.lead.alias, null);
  assert.equal(result.unit, 'unknown');
  assert.equal(result.origin, 'real');
  a.run('step()');
  assert.equal(a.elements.get('spectrum-export').disabled, false);
  a.run('render(1000)');
  assert.equal(a.elements.get('spectrum-export').disabled, true);
  a.run(`manifest = { records: [{ id: 'mitdb/100', db: 'mitdb', record: '100' }] };
    state.source.record.header.signals[0].description = 'MLII';
    useRecord(state.source.record, { id: 'mitdb/100', record: '100', dbName: 'MIT-BIH' });
    for (let i = 0; i < 160; i++) step(); render(1000);`);
  a.click('spectrum-export');
  const publicResult = JSON.parse(await a.downloads[1].blob.text());
  assert.equal(publicResult.recordId, 'mitdb:100');
  assert.equal(publicResult.lead.name, 'II');
  assert.equal(publicResult.lead.alias, 'MLII');
});

test('falha no clique é explícita, sem sucesso antecipado e com liberação de URL', () => {
  const a = app();
  a.run('for (let i = 0; i < 5000; i++) step(); render(250)');
  a.failDownload();
  a.click('spectrum-export');
  assert.equal(a.downloads.length, 0);
  assert.match(a.elements.get('spectrum-export-status').textContent, /Falha.*download bloqueado/);
  a.deferred.shift()();
  assert.deepEqual(a.revoked, ['blob:local-test']);
});
