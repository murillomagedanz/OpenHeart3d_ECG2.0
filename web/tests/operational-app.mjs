import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LEAD_NAMES } from '../src/ecg/leads.js';
import { SyntheticSource } from '../src/ecg/synth.js';
import { SignalPipeline } from '../src/ecg/pipeline.js';
import { OnlineScorer } from '../src/ecg/scoring.js';
import { FileSource } from '../src/io/fileSource.js';
import { WaveTracker } from '../src/ecg/waves.js';

const mainCode = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '');

export function virtualApp() {
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
    constructor() { this.resetCount = 0; this.qrsCount = 0; }
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
    onQrs() { this.qrsCount++; }
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
