// Pontuação de detecção de batimentos contra uma referência (anotações de um
// banco público ou verdade-terreno do gerador sintético). Janela padrão de
// ±150 ms, como na norma ANSI/AAMI EC57 para comparação batimento a batimento.

export const DEFAULT_TOLERANCE_S = 0.15;

// refs e dets: tempos em segundos. Pareamento guloso em ordem temporal.
export function matchBeats(refs, dets, toleranceS = DEFAULT_TOLERANCE_S) {
  const r = [...refs].sort((a, b) => a - b);
  const d = [...dets].sort((a, b) => a - b);
  const errors = [];
  let i = 0;
  let j = 0;
  let tp = 0;
  while (i < r.length && j < d.length) {
    const diff = d[j] - r[i];
    if (Math.abs(diff) <= toleranceS) { tp++; errors.push(diff); i++; j++; }
    else if (diff < 0) j++; // detecção sem referência próxima
    else i++;               // referência sem detecção
  }
  const fn = r.length - tp;
  const fp = d.length - tp;
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    tp, fp, fn,
    sensitivity: r.length ? tp / r.length : 0,
    ppv: d.length ? tp / d.length : 0,
    meanErrorMs: mean(errors) * 1000,
    maeMs: mean(errors.map(Math.abs)) * 1000,
  };
}

// Versão incremental para reprodução ao vivo: referências e detecções chegam
// fora de ordem (a detecção tem ~125 ms de latência; no search-back, até
// 1,66 × RR) e são casadas quando ambas existem. Uma referência só vira FN
// depois de esperar a latência máxima do detector (`maxLatencyS`, que quem
// usa deve manter atualizada); uma detecção só vira FP depois da tolerância,
// porque a referência chega no instante exato do batimento.
export class OnlineScorer {
  constructor({ toleranceS = DEFAULT_TOLERANCE_S, ignoreBeforeS = 0, maxLatencyS = 0.6 } = {}) {
    this.toleranceS = toleranceS;
    this.ignoreBeforeS = ignoreBeforeS;
    this.maxLatencyS = maxLatencyS;
    this.reset();
  }

  reset() {
    this.pendingRefs = [];
    this.pendingDets = [];
    this.tp = 0; this.fp = 0; this.fn = 0;
  }

  _takeNearest(list, t) {
    let best = -1;
    let bestD = this.toleranceS;
    for (let i = 0; i < list.length; i++) {
      const d = Math.abs(list[i] - t);
      if (d <= bestD) { bestD = d; best = i; }
    }
    if (best >= 0) list.splice(best, 1);
    return best >= 0;
  }

  addRef(t) {
    if (t < this.ignoreBeforeS) return;
    if (this._takeNearest(this.pendingDets, t)) this.tp++;
    else this.pendingRefs.push(t);
  }

  addDet(t) {
    if (t < this.ignoreBeforeS) return;
    if (this._takeNearest(this.pendingRefs, t)) this.tp++;
    else this.pendingDets.push(t);
  }

  // Descarta pendências velhas demais para ainda serem casadas. `flush(Infinity)`
  // finaliza tudo (fim do registro).
  flush(now) {
    const grace = 2 * this.toleranceS + 0.3;
    const refLimit = now - Math.max(this.maxLatencyS, grace);
    const detLimit = now - grace;
    while (this.pendingRefs.length && this.pendingRefs[0] < refLimit) { this.pendingRefs.shift(); this.fn++; }
    while (this.pendingDets.length && this.pendingDets[0] < detLimit) { this.pendingDets.shift(); this.fp++; }
  }

  get sensitivity() { return this.tp + this.fn ? this.tp / (this.tp + this.fn) : null; }
  get ppv() { return this.tp + this.fp ? this.tp / (this.tp + this.fp) : null; }

  snapshot() {
    return { tp: this.tp, fp: this.fp, fn: this.fn, sensitivity: this.sensitivity, ppv: this.ppv };
  }
}
