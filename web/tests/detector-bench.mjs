// Benchmark reprodutível do detector de QRS contra a verdade-terreno da fonte
// sintética (instantes reais do pico R). Executar: `npm run bench`.
// O detector NUNCA vê `source.beats`; a lista só é usada aqui para pontuar.

import { SyntheticSource } from '../src/ecg/synth.js';
import { LeadFilterBank } from '../src/ecg/filters.js';
import { QrsDetector } from '../src/ecg/detector.js';
import { matchBeats } from '../src/ecg/scoring.js';

const FS = 500;
const DURATION_S = 60;
const WARMUP_S = 1.5;        // filtros e limiar ainda se ajustando
const TAIL_S = 0.5;          // o último batimento não tem tempo de ser confirmado
const TOLERANCE_S = 0.08;    // janela de acerto (±80 ms): aqui o instante do R é conhecido exatamente
const LEAD_II = 1;
const SEED = 2024;           // sequência pseudoaleatória fixa → resultados reprodutíveis

const SCENARIOS = [
  { label: 'repouso limpo', hr: 72, hrvPct: 4, noiseMv: 0.02, mainsMv: 0 },
  { label: 'repouso c/ rede', hr: 75, hrvPct: 5, noiseMv: 0.05, mainsMv: 0.1 },
  { label: 'bradicardia ruidosa', hr: 40, hrvPct: 8, noiseMv: 0.1, mainsMv: 0.2 },
  { label: 'exercício', hr: 100, hrvPct: 15, noiseMv: 0.2, mainsMv: 0.3 },
  { label: 'taquicardia', hr: 150, hrvPct: 3, noiseMv: 0.03, mainsMv: 0.05 },
  { label: 'taquicardia extrema', hr: 180, hrvPct: 3, noiseMv: 0.02, mainsMv: 0 },
];

const MIN_SENS = 0.98;
const MIN_PPV = 0.98;

function runScenario(p) {
  const src = new SyntheticSource({ fs: FS, seed: SEED });
  const bank = new LeadFilterBank(FS, 12);
  const det = new QrsDetector(FS);
  src.setParams(p);

  const dets = [];
  const latencies = [];
  for (let i = 0; i < FS * DURATION_S; i++) {
    const s = src.next();
    const f = bank.process(s.leads);
    const ev = det.process(f[LEAD_II], s.t);
    if (ev) {
      dets.push(ev.t);
      latencies.push(ev.latency * 1000);
    }
  }

  const inWindow = (t) => t >= WARMUP_S && t <= DURATION_S - TAIL_S;
  const m = matchBeats(src.beats.filter(inWindow), dets.filter(inWindow), TOLERANCE_S);
  return { ...m, label: p.label, beats: m.tp + m.fn, latencyMs: latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length), hrDetected: det.heartRate };
}

let failed = false;
for (const sc of SCENARIOS) {
  const r = runScenario(sc);
  const ok = r.sensitivity >= MIN_SENS && r.ppv >= MIN_PPV;
  failed ||= !ok;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${r.label.padEnd(22)} ` +
      `bpm=${String(sc.hr).padStart(3)} ` +
      `sens=${r.sensitivity.toFixed(3)} ppv=${r.ppv.toFixed(3)} ` +
      `tp=${r.tp}/${r.beats} fp=${r.fp} ` +
      `mae=${r.maeMs.toFixed(1)}ms lat=${r.latencyMs.toFixed(0)}ms ` +
      `fc=${r.hrDetected ? r.hrDetected.toFixed(1) : '-'}`,
  );
}

if (failed) {
  console.error(`\nLimiar não atingido (sens ≥ ${MIN_SENS}, ppv ≥ ${MIN_PPV}).`);
  process.exit(1);
}
