import { LEAD_NAMES, RHYTHM_LEAD } from './ecg/leads.js';
import { SyntheticSource } from './ecg/synth.js';
import { LeadFilterBank } from './ecg/filters.js';
import { QrsDetector } from './ecg/detector.js';
import { EcgPlot } from './view/ecgPlot.js';
import { Heart3D } from './view/heart3d.js';

const FS = 500;

const source = new SyntheticSource({ fs: FS });
const filters = new LeadFilterBank(FS, LEAD_NAMES.length);
const detector = new QrsDetector(FS);
const plot = new EcgPlot(document.getElementById('ecg-canvas'), FS);
const heart = new Heart3D(document.getElementById('heart-canvas'));

const ui = {
  hr: document.getElementById('hr'),
  hrv: document.getElementById('hrv'),
  noise: document.getElementById('noise'),
  mains: document.getElementById('mains'),
  viewMode: document.getElementById('view-mode'),
  speed: document.getElementById('speed'),
  pause: document.getElementById('pause'),
  hrDetected: document.getElementById('hr-detected'),
  rrMean: document.getElementById('rr-mean'),
  lastQrs: document.getElementById('last-qrs'),
  phase: document.getElementById('phase'),
};

const state = { paused: false, speed: 1, viewMode: 'filtered', signalTime: 0, lastQrsT: null };

function syncParams() {
  source.setParams({
    hr: Number(ui.hr.value),
    hrvPct: Number(ui.hrv.value),
    noiseMv: Number(ui.noise.value),
    mainsMv: Number(ui.mains.value),
  });
  document.getElementById('hr-val').textContent = ui.hr.value;
  document.getElementById('hrv-val').textContent = ui.hrv.value;
  document.getElementById('noise-val').textContent = Number(ui.noise.value).toFixed(2);
  document.getElementById('mains-val').textContent = Number(ui.mains.value).toFixed(2);
}

for (const el of [ui.hr, ui.hrv, ui.noise, ui.mains]) el.addEventListener('input', syncParams);
ui.viewMode.addEventListener('change', () => { state.viewMode = ui.viewMode.value; });
ui.speed.addEventListener('change', () => { state.speed = Number(ui.speed.value); });
ui.pause.addEventListener('click', () => {
  state.paused = !state.paused;
  ui.pause.textContent = state.paused ? 'Retomar' : 'Pausar';
});
syncParams();

const rhythmIdx = LEAD_NAMES.indexOf(RHYTHM_LEAD);
const viewLabels = {
  raw: 'bruto',
  filtered: `filtrado: ${filters.description}`,
  diff: `diferença (bruto − filtrado): ${filters.description}`,
};

function step() {
  const s = source.next();
  const filtered = filters.process(s.leads);
  state.signalTime = s.t;

  // O detector vê apenas o sinal; nunca os instantes verdadeiros do gerador.
  const ev = detector.process(filtered[rhythmIdx], s.t);

  let shown = filtered;
  if (state.viewMode === 'raw') shown = s.leads;
  else if (state.viewMode === 'diff') {
    shown = new Float32Array(s.leads.length);
    for (let i = 0; i < shown.length; i++) shown[i] = s.leads[i] - filtered[i];
  }
  plot.push(shown);

  if (ev) {
    heart.onQrs(ev.t, detector.rrMean);
    state.lastQrsT = ev.t;
    plot.markQrs(Math.round((s.t - ev.t) * FS));
  }
}

let lastFrame = performance.now();
let accumulator = 0;

function frame(now) {
  const dtReal = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  if (!state.paused) {
    accumulator += dtReal * state.speed;
    const nSamples = Math.floor(accumulator * FS);
    accumulator -= nSamples / FS;
    for (let i = 0; i < nSamples; i++) step();
  }

  plot.label = viewLabels[state.viewMode];
  plot.draw();
  heart.update(state.signalTime);

  const hr = detector.heartRate;
  ui.hrDetected.textContent = hr ? `${hr.toFixed(0)} bpm` : '—';
  ui.rrMean.textContent = detector.rrMean ? `${(detector.rrMean * 1000).toFixed(0)} ms` : '—';
  ui.lastQrs.textContent = state.lastQrsT != null ? `t = ${state.lastQrsT.toFixed(2)} s` : '—';
  ui.phase.textContent = heart.phaseLabel;

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
