// Fonte sintética de ECG: um vetor cardíaco (dipolo) é a soma de ondas gaussianas
// (P, Q, R, S, T) posicionadas no TEMPO em relação a cada pico R, e projetado nas
// 12 derivações. Isso mantém as derivações fisicamente relacionadas entre si, em
// vez de 12 sinais independentes. Modelo didático, inspirado em McSharry et al.
// (2003), mas com intervalos em segundos: o QRS não se alarga com o RR, o QT
// encurta com √RR (Bazett) e o PR fica quase constante.

import { projectDipole } from './leads.js';

const TWO_PI = Math.PI * 2;

// Amplitude vetorial (mV) e largura (s) de cada onda; o centro é calculado por batimento.
const SHAPES = {
  P: { a: [0.06, 0.12, 0.02], b: 0.025 },
  Q: { a: [-0.18, -0.02, 0.22], b: 0.008 },
  R: { a: [0.9, 1.3, -0.35], b: 0.011 },
  S: { a: [-0.3, -0.25, -0.65], b: 0.009 },
  T: { a: [0.28, 0.36, -0.08], b: 0.05 },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussRandom(rand) {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v);
}

// Centros das ondas (s, relativos ao R) para um batimento com intervalo RR dado.
function waveCenters(rr) {
  const k = Math.sqrt(rr / 0.8);
  return {
    P: -Math.min(0.16, 0.3 * rr),
    Q: -0.022,
    R: 0,
    S: 0.028,
    T: 0.3 * k,
    tWidthScale: k,
  };
}

export class SyntheticSource {
  // `seed` opcional torna a sequ�ncia reprodut�vel (benchmarks); sem ela usa Math.random.
  constructor({ fs = 500, seed = null } = {}) {
    this.fs = fs;
    this.dt = 1 / fs;
    this.t = 0;
    this.rand = seed === null ? Math.random : mulberry32(seed);
    this.params = { hr: 72, hrvPct: 4, noiseMv: 0.02, mainsMv: 0, mainsHz: 60 };
    this.respPhase = 0;
    this.beats = []; // instantes verdadeiros do pico R (apenas para avaliar o detector)

    // Dois batimentos vizinhos bastam: P/Q do próximo e R/S/T do anterior.
    this.prev = { r: -0.4, rr: 60 / this.params.hr };
    this.beatNext = { r: 0.4, rr: 60 / this.params.hr };
  }

  setParams(p) {
    Object.assign(this.params, p);
  }

  _nextRR() {
    const mean = 60 / this.params.hr;
    const sd = mean * (this.params.hrvPct / 100);
    return Math.max(0.3, mean + sd * gaussRandom(this.rand));
  }

  _addWave(vec, name, center, width) {
    const s = SHAPES[name];
    const d = (this.t - center) / width;
    const g = Math.exp(-0.5 * d * d);
    vec[0] += s.a[0] * g;
    vec[1] += s.a[1] * g;
    vec[2] += s.a[2] * g;
  }

  // Retorna { t, leads: Float32Array(12) } em mV.
  next() {
    if (this.t >= this.beatNext.r) {
      this.beats.push(this.beatNext.r);
      this.prev = this.beatNext;
      const rr = this._nextRR();
      this.beatNext = { r: this.prev.r + rr, rr };
    }

    const vec = [0, 0, 0];
    const cp = waveCenters(this.prev.rr);
    this._addWave(vec, 'R', this.prev.r, SHAPES.R.b);
    this._addWave(vec, 'S', this.prev.r + cp.S, SHAPES.S.b);
    this._addWave(vec, 'T', this.prev.r + cp.T, SHAPES.T.b * cp.tWidthScale);
    const cn = waveCenters(this.beatNext.rr);
    this._addWave(vec, 'P', this.beatNext.r + cn.P, SHAPES.P.b);
    this._addWave(vec, 'Q', this.beatNext.r + cn.Q, SHAPES.Q.b);
    this._addWave(vec, 'R', this.beatNext.r, SHAPES.R.b);

    const leads = projectDipole(vec);

    // Flutuação de linha de base respiratória (~0,25 Hz) e artefatos comuns.
    this.respPhase += TWO_PI * 0.25 * this.dt;
    const baseline = 0.08 * Math.sin(this.respPhase);
    const mains = this.params.mainsMv * Math.sin(TWO_PI * this.params.mainsHz * this.t);
    for (let i = 0; i < leads.length; i++) {
      leads[i] += baseline + mains + this.params.noiseMv * gaussRandom(this.rand);
    }

    const sample = { t: this.t, leads };
    this.t += this.dt;
    return sample;
  }
}
