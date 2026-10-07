import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SpectrumPlot } from '../src/view/spectrumPlot.js';

function makePlot() {
  const ctx = {
    fillCalls: 0,
    fillRect() { this.fillCalls++; },
    setTransform() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {},
  };
  let rect = { width: 240, height: 96 };
  const canvas = {
    width: 0,
    height: 0,
    parentElement: { getBoundingClientRect() { throw new Error('parent must not be measured'); } },
    getBoundingClientRect() { return rect; },
    getContext() { return ctx; },
    setAttribute() {},
  };
  let observer;
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.target = target; observer = this; }
  }
  let statusWrites = 0;
  const status = {
    _text: '',
    get textContent() { return this._text; },
    set textContent(value) { statusWrites++; this._text = value; },
  };
  let metricWrites = 0;
  const metrics = {
    children: [],
    title: '',
    ownerDocument: { createElement: () => ({ textContent: '' }) },
    _text: '',
    get textContent() { return this._text; },
    set textContent(value) { metricWrites++; this._text = value; },
    replaceChildren(...children) { this.children = children; },
  };
  const oldWindow = globalThis.window;
  const oldObserver = globalThis.ResizeObserver;
  globalThis.window = { devicePixelRatio: 2 };
  globalThis.ResizeObserver = Observer;
  const plot = new SpectrumPlot(canvas, status, metrics);
  return {
    plot, canvas, ctx, status, metrics,
    get statusWrites() { return statusWrites; },
    get metricWrites() { return metricWrites; },
    get observed() { return observer?.target; },
    resize(width, height) { rect = { width, height }; },
    triggerResize() { observer.callback(); },
    restore() {
      if (oldWindow === undefined) delete globalThis.window;
      else globalThis.window = oldWindow;
      if (oldObserver === undefined) delete globalThis.ResizeObserver;
      else globalThis.ResizeObserver = oldObserver;
    },
  };
}

test('usa as dimensões e o observador do canvas e não repete mutações de regiões live', () => {
  const fixture = makePlot();
  try {
    const { plot, canvas, metrics } = fixture;
    assert.equal(fixture.observed, canvas);
    assert.equal(canvas.width, 480);
    assert.equal(canvas.height, 192);
    const args = { ready: false, invalidated: false, paused: false, mode: 'frequency' };
    plot.draw(null, null, null, args);
    plot.draw(null, null, null, args);
    assert.equal(fixture.statusWrites, 1);
    assert.equal(fixture.metricWrites, 1);
    fixture.resize(180, 80);
    fixture.triggerResize();
    assert.equal(canvas.width, 360);
    assert.equal(canvas.height, 160);
    assert.equal(metrics.textContent, 'Medidas de banda disponíveis após uma janela válida de 10 s.');
  } finally {
    fixture.restore();
  }
});

test('reutiliza o desenho STFT enquanto resultado, modo e dimensões não mudam', () => {
  const fixture = makePlot();
  try {
    const { plot } = fixture;
    plot.setContext({ fs: 10, unit: 'mV' });
    const frame = Float64Array.from([0.5, 0.1]);
    const timeFrequency = {
      fs: 10, frameSeconds: 2, hopSeconds: 1, frameSamples: 20, fftSize: 2,
      frameCount: 1, times: [1], frequency: [0, 5],
      raw: { frames: [frame] },
      filtered: { frames: [frame] },
      difference: { frames: [frame] },
    };
    const args = { ready: true, invalidated: false, paused: false, mode: 'time-frequency' };
    plot.draw(null, timeFrequency, null, args);
    const firstDrawCalls = fixture.ctx.fillCalls;
    assert.ok(firstDrawCalls > 1);
    plot.draw(null, timeFrequency, null, args);
    assert.equal(fixture.ctx.fillCalls, firstDrawCalls);
  } finally {
    fixture.restore();
  }
});
