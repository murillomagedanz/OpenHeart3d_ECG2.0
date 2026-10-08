import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { validateWorkload, summarizeTimes } from './operational-baseline.mjs';
import { buildFunctionalReport } from './operational-functional.mjs';
import { LEAD_NAMES } from '../src/ecg/leads.js';
import { SyntheticSource } from '../src/ecg/synth.js';
import { SignalPipeline } from '../src/ecg/pipeline.js';
import { OnlineScorer } from '../src/ecg/scoring.js';
import { FileSource } from '../src/io/fileSource.js';
import { WaveTracker } from '../src/ecg/waves.js';
import { readLocalRecord } from './validation-report.mjs';

const mainPath = fileURLToPath(new URL('../src/main.js', import.meta.url));
const mainCode = readFileSync(mainPath, 'utf8').replace(/^import .*;\r?$/gm, '');
const manifest = JSON.parse(readFileSync(new URL('../data/manifest.json', import.meta.url), 'utf8'));

function virtualApp() {
  const elements = new Map();
  const makeElement = () => ({
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    checked: false,
    children: [],
    handlers: {},
    classList: { add() {}, remove() {} },
    addEventListener(type, callback) { this.handlers[type] = callback; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {},
    getBoundingClientRect() { return { height: 0 }; },
  });
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    createElement: makeElement,
    createTextNode: (textContent) => ({ textContent }),
    querySelectorAll: () => [],
  };
  class View {
    constructor() { this.resetCount = 0; }
    reset() { this.resetCount++; }
    setLeads() {}
    setBottomInset() {}
    setMode() {}
    setContext() {}
    push() {}
    markRef() {}
    markQrs() {}
    markWave() {}
    draw() {}
    update(value) { this.lastUpdate = value; }
    onQrs() {}
    get phaseLabel() { return 'relaxado'; }
    get modelLabel() { return 'Procedural'; }
  }
  class MockSpectrumWindow {
    reset(fs) { this.fs = fs; this.count = 0; this.version = 0; this.full = false; this.invalidated = false; }
    push() { this.count++; this.version++; }
    analyze() { return null; }
    analyzeTimeFrequency() { return null; }
  }
  class MockSpectrumExport {
    setDataset() {}
  }

  const context = vm.createContext({
    document,
    Node: class {},
    LEAD_NAMES,
    SyntheticSource,
    SignalPipeline,
    SpectrumWindow: MockSpectrumWindow,
    OnlineScorer,
    DEFAULT_TOLERANCE_S: 0.15,
    FileSource,
    WaveTracker,
    safeSpectrumMetadata: () => ({}),
    summarizeFilterBands: () => ({ low: {}, mains: {} }),
    EcgPlot: View,
    SpectrumPlot: View,
    SpectrumExportControl: MockSpectrumExport,
    Heart3D: View,
    performance: { now: () => 0 },
    requestAnimationFrame() {},
    console,
    loadRuntimeAsset: async () => null,
    isDevHost: () => false,
    ResizeObserver: class { observe() {} },
    window: { addEventListener() {} },
    fetch: async () => { throw new Error('offline'); },
  });
  for (const [id, value] of Object.entries({
    hr: '72', hrv: '4', noise: '0.02', mains: '0', 'mains-hz': '50', speed: '1',
  })) document.getElementById(id).value = value;
  vm.runInContext(mainCode, context);
  const run = (code) => vm.runInContext(code, context);
  const frame = (time) => run(`frame(${time})`);
  return { context, elements, run, frame };
}

test('B04 functional report records observed Node behavior and leaves browser cases partial', async () => {
  const report = await buildFunctionalReport();
  assert.equal(report.schema, 'openheart3d.ecg.operational-functional-baseline');
  assert.equal(report.cases.length, 11);
  assert.equal(report.globalStatus, 'partial');
  const byId = new Map(report.cases.map((item) => [item.id, item]));
  assert.equal(byId.get('F01').status, 'partial');
  assert.equal(byId.get('F01').evidence.truncatedThrows, false);
  assert.equal(byId.get('F01').evidence.truncatedReturnedSamples, 2);
  assert.equal(byId.get('F02').status, 'failed');
  assert.equal(byId.get('F02').evidence.checksumExpectedMismatchFlag, false);
  assert.equal(byId.get('F02').evidence.pipelineStepReturnedFiniteFilteredData, true);
  for (const id of ['F03', 'F04', 'F05', 'F06']) assert.equal(byId.get(id).status, 'passed', id);
  assert.equal(byId.get('F04').evidence.rrCrossesGap, false);
  assert.equal(byId.get('F06').evidence.fullyFiniteFilteredSteps, byId.get('F06').evidence.samples);
  assert.equal(byId.get('F08').status, 'failed');
  assert.equal(byId.get('F08').evidence.signalTimeResetOnPipelineRebuild, false);
  for (const id of ['F07', 'F09', 'F10', 'F11']) assert.equal(byId.get(id).status, 'partial', id);
  assert.match(byId.get('F10').evidence.optionalAsset, /no key lookup/);
});

test('B04 workload and timing validators reject invalid inputs without absolute timing gates', () => {
  assert.deepEqual(validateWorkload({ fs: 360, notchHz: 60, durationSeconds: 2, seed: 1 }), {
    fs: 360, notchHz: 60, durationSeconds: 2, seed: 1, nSamples: 720,
  });
  assert.throws(() => validateWorkload({ fs: 0, notchHz: 50 }), /fs must be positive/);
  assert.throws(() => validateWorkload({ fs: 500, notchHz: 250 }), /below Nyquist/);
  assert.throws(() => validateWorkload({ fs: 500, notchHz: 50, durationSeconds: 0.001 }), /safe integer/);
  assert.deepEqual(summarizeTimes([5, 1, 4, 2, 3]), { count: 5, min: 1, p50: 3, p95: 5, max: 5 });
  assert.throws(() => summarizeTimes([]), /non-empty/);
  assert.throws(() => summarizeTimes([NaN]), /non-empty/);
});

test('F07 VM source clock pauses, resumes and changes cadence without changing fs or sample order', () => {
  const app = virtualApp();
  const source = app.run('state.source');
  app.frame(0);
  app.frame(100);
  assert.equal(app.run('state.signalIndex'), 49);
  const initialFs = app.run('state.source.fs');

  app.elements.get('pause').handlers.click();
  for (let time = 200; time <= 2100; time += 100) app.frame(time);
  assert.equal(app.run('state.signalIndex'), 49);
  assert.ok(Math.abs(app.run('state.signalTime') - 49 / 500) < 1e-12);
  app.elements.get('pause').handlers.click();
  app.frame(2200);
  assert.equal(app.run('state.signalIndex'), 99);

  const beforeHalf = app.run('state.signalIndex');
  app.elements.get('speed').value = '0.5';
  app.elements.get('speed').handlers.change();
  app.frame(2300);
  assert.equal(app.run('state.signalIndex') - beforeHalf, 25);

  const beforeOne = app.run('state.signalIndex');
  app.elements.get('speed').value = '1';
  app.elements.get('speed').handlers.change();
  app.frame(2400);
  assert.equal(app.run('state.signalIndex') - beforeOne, 50);

  const beforeDouble = app.run('state.signalIndex');
  app.elements.get('speed').value = '2';
  app.elements.get('speed').handlers.change();
  app.frame(2500);
  assert.equal(app.run('state.signalIndex') - beforeDouble, 100);
  assert.equal(app.run('state.source.fs'), initialFs);
  assert.equal(app.run('state.source'), source);
  assert.ok(Math.abs(app.run('state.signalTime') - app.run('state.signalIndex') / initialFs) < 1e-12);
});

test('F08/F10/F11 VM changes LUDB/MIT/synthetic context and survives 100 resets with procedural fallback', async () => {
  const app = virtualApp();
  const ludbEntry = manifest.records.find((entry) => entry.id === 'ludb/8');
  const mitEntry = manifest.records.find((entry) => entry.id === 'mitdb/100');
  const ludbRecord = (await readLocalRecord(ludbEntry)).rec;
  const mitRecord = (await readLocalRecord(mitEntry)).rec;
  app.context.testRecord = ludbRecord;
  app.context.testMeta = { id: ludbEntry.id, record: ludbEntry.record, dbName: 'LUDB', license: 'fixture', mainsHz: 50 };
  app.run('useRecord(testRecord, testMeta)');
  const originalPipeline = app.run('state.pipeline');
  assert.equal(app.run('state.source.index'), 0);
  assert.equal(app.run('state.source.fs'), 500);
  app.run('for (let i = 0; i < 2000; i++) step()');
  assert.equal(app.run('state.source.index'), 2000);
  const oldSignalTime = app.run('state.signalTime');
  assert.ok(Math.abs(oldSignalTime - 3.998) < 1e-12);
  let previousPipeline = originalPipeline;
  for (const notchHz of [60, 0, 50]) {
    app.elements.get('mains-hz').value = String(notchHz);
    app.elements.get('mains-hz').handlers.change();
    assert.notEqual(app.run('state.pipeline'), previousPipeline);
    assert.equal(app.run('state.source.index'), 0);
    assert.equal(app.run('state.pipeline.fs'), 500);
    assert.equal(app.run('state.pipeline.filters.notchActive'), notchHz !== 0);
    assert.equal(app.run('state.waves.n'), 0);
    assert.equal(app.run('spectrumWindow.count'), 0);
    assert.equal(app.run('state.signalIndex'), -1);
    assert.equal(app.run('state.signalTime'), oldSignalTime);
    app.frame(0);
    assert.equal(app.run('heart.lastUpdate'), oldSignalTime);
    previousPipeline = app.run('state.pipeline');
  }

  app.context.testRecord = mitRecord;
  app.context.testMeta = { id: mitEntry.id, record: mitEntry.record, dbName: 'MIT-BIH', license: 'fixture', mainsHz: 60 };
  app.run('useRecord(testRecord, testMeta)');
  assert.equal(app.run('state.source.fs'), 360);
  assert.equal(app.run("state.source.aliases.II"), 'MLII');
  assert.equal(app.run('state.signalTime'), oldSignalTime);
  assert.equal(app.run('state.signalIndex'), -1);
  app.run('step()');
  assert.equal(app.run('state.source.index'), 1);
  app.run('useSynthetic()');
  const syntheticSource = app.run('state.source');
  assert.equal(app.run('state.mode'), 'synthetic');
  assert.equal(app.run('state.source.index'), undefined);
  assert.equal(app.run('heart.modelLabel'), 'Procedural');
  await Promise.resolve();

  app.run('for (let i = 0; i < 100; i++) { useSynthetic(); step(); }');
  assert.notEqual(app.run('state.source'), syntheticSource);
  assert.equal(app.run('state.source.fs'), 500);
  assert.equal(app.run('state.pipeline.fs'), 500);
  assert.equal(app.run('state.signalIndex'), 0);
  assert.equal(app.run('state.waves.n'), 1);
  assert.equal(app.run('spectrumWindow.count'), 1);
});
