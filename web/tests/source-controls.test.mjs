import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LEAD_NAMES } from '../src/ecg/leads.js';
import { SyntheticSource } from '../src/ecg/synth.js';
import { SignalPipeline } from '../src/ecg/pipeline.js';
import { SpectrumExportControl } from '../src/view/spectrumExportControl.js';

const code = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '');

function app() {
  const elements = new Map();
  function element() {
    return {
      value: '', hidden: false, textContent: '', children: [],
      classList: { add() {}, remove() {} },
      addEventListener() {}, append(...items) { this.children.push(...items); },
      appendChild(item) { this.children.push(item); },
      replaceChildren(...items) { this.children = items; },
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    createTextNode: (textContent) => ({ textContent }),
    querySelectorAll: () => [],
  };
  class View {
    reset() {}
    setLeads() {}
  }
  class SpectrumWindow {
    reset() {}
    push() {}
  }
  class SpectrumPlot extends View {
    setContext() {}
    draw() {}
  }
  const context = vm.createContext({
    document, Node: class {}, LEAD_NAMES, SyntheticSource, SignalPipeline,
    SpectrumWindow, SpectrumExportControl, EcgPlot: View, SpectrumPlot, Heart3D: View, performance: { now: () => 0 },
    requestAnimationFrame() {}, console,
    loadRuntimeAsset: async () => null, isDevHost: () => false,
    ResizeObserver: class { observe() {} },
    window: { addEventListener() {} },
    fetch: async () => { throw new Error('offline'); },
  });
  vm.runInContext(code, context);
  vm.runInContext(`manifest = {
    records: [{ id: 'missing', db: 'test', files: ['missing.hea'] }],
    databases: { test: { name: 'Test' } },
  };`, context);
  return { context, elements, run: (source) => vm.runInContext(source, context) };
}

test('falha no primeiro registro restaura controles sintéticos e mantém erro visível', async () => {
  const { elements, run } = app();
  run("ui.source.value = 'file'; ui.record.value = 'missing'");
  await run("loadManifestRecord('missing')");
  assert.equal(elements.get('source').value, 'synthetic');
  assert.equal(elements.get('record').value, '');
  assert.equal(elements.get('ctl-synth').hidden, false);
  assert.equal(elements.get('ctl-record').hidden, true);
  assert.equal(elements.get('record-info').hidden, false);
  assert.match(elements.get('record-info-body').children[0].children[1].textContent, /offline/);
});

test('falha em outro registro restaura o registro ativo, sem alterar reprodução', async () => {
  const { elements, run } = app();
  run(`state.mode = 'file'; state.meta = { id: 'active' };
    ui.source.value = 'file'; ui.record.value = 'missing';`);
  const source = run('state.source');
  await run("loadManifestRecord('missing')");
  assert.equal(elements.get('record').value, 'active');
  assert.equal(elements.get('source').value, 'file');
  assert.equal(run('state.source'), source);
  assert.equal(elements.get('ctl-record').hidden, false);
});

test('falha obsoleta não restaura seleção sobre carregamento mais recente', async () => {
  const { context, elements, run } = app();
  let reject;
  context.fetch = () => new Promise((_, fail) => { reject = fail; });
  const loading = run("loadManifestRecord('missing')");
  run("loadSeq++; ui.record.value = 'newer'");
  reject(new Error('offline'));
  await loading;
  assert.equal(elements.get('record').value, 'newer');
});
