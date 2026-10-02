// Detector de QRS em tempo real (Pan–Tompkins simplificado) sobre uma derivação.
// Trabalha apenas com o sinal recebido: é ele que comanda a animação do coração.
//
// Etapas: passa-banda por médias móveis → derivada sobre 10 ms → quadrado →
// integração em janela móvel (MWI). Quando a MWI cruza o limiar, abre-se uma
// janela "candidata"; o QRS só é declarado após o pico da MWI, com o instante do
// R tomado do máximo do sinal passa-banda. Isso introduz latência de ~60–120 ms,
// mas evita que o limiar colapse e que ondas T sejam marcadas como QRS.

export class QrsDetector {
  constructor(fs) {
    this.fs = fs;
    this.winShort = Math.round(0.03 * fs);   // passa-baixa (~15 Hz)
    this.winLong = Math.round(0.15 * fs);    // estimativa de linha de base
    this.derivLag = Math.round(0.01 * fs);   // derivada sobre 10 ms
    this.mwiLen = Math.round(0.1 * fs);
    this.refractory = 0.22;
    this.candidateMax = 0.12;                // duração máxima da janela candidata (s)
    this.groupDelay = (this.winShort - 1) / 2 / fs;
    this.noiseAlpha = 1 / (0.5 * fs);        // EMA de ruído com constante de 0,5 s

    this.bufShort = new Float32Array(this.winShort);
    this.bufLong = new Float32Array(this.winLong);
    this.sumShort = 0; this.sumLong = 0; this.idx = 0;

    this.bpHist = new Float32Array(this.derivLag + 1);
    this.mwi = new Float32Array(this.mwiLen);
    this.mwiSum = 0;

    this.threshold = 0;
    this.signalLevel = 0;
    this.noiseLevel = 0;
    this.lastPeakT = -Infinity;
    this.rr = [];
    this.n = 0;

    this.candidate = null; // { startT, endT, maxFeat, maxBp, maxBpT }
  }

  get rrMean() {
    if (!this.rr.length) return null;
    return this.rr.reduce((a, b) => a + b, 0) / this.rr.length;
  }

  get heartRate() {
    const m = this.rrMean;
    return m ? 60 / m : null;
  }

  _updateThreshold() {
    this.threshold = this.noiseLevel + 0.3 * (this.signalLevel - this.noiseLevel);
  }

  _finalize() {
    const c = this.candidate;
    this.candidate = null;
    const peakT = c.maxBpT - this.groupDelay;
    const rr = Number.isFinite(this.lastPeakT) ? peakT - this.lastPeakT : null;
    this.lastPeakT = peakT;
    if (rr) {
      this.rr.push(rr);
      if (this.rr.length > 8) this.rr.shift();
    }
    this.signalLevel = 0.125 * c.maxFeat + 0.875 * this.signalLevel;
    this._updateThreshold();
    return { t: peakT, rr, latency: c.endT - peakT };
  }

  // Retorna null ou { t: instante estimado do pico R, rr, latency }.
  process(x, t) {
    const i = this.idx;
    this.sumShort += x - this.bufShort[i % this.winShort];
    this.bufShort[i % this.winShort] = x;
    this.sumLong += x - this.bufLong[i % this.winLong];
    this.bufLong[i % this.winLong] = x;
    const bp = this.sumShort / this.winShort - this.sumLong / this.winLong;

    const hl = this.bpHist.length;
    const deriv = bp - this.bpHist[i % hl];
    this.bpHist[i % hl] = bp;
    const sq = deriv * deriv;

    this.mwiSum += sq - this.mwi[i % this.mwiLen];
    this.mwi[i % this.mwiLen] = sq;
    const feat = this.mwiSum / this.mwiLen;

    this.idx++;
    this.n++;

    // Período de aprendizado inicial (1 s): só calibra os níveis.
    if (this.n < this.fs) {
      this.signalLevel = Math.max(this.signalLevel, feat);
      this.noiseLevel = 0.1 * this.signalLevel;
      this._updateThreshold();
      return null;
    }

    if (this.candidate) {
      const c = this.candidate;
      if (feat > c.maxFeat) c.maxFeat = feat;
      if (bp > c.maxBp) { c.maxBp = bp; c.maxBpT = t; }
      c.endT = t;
      const elapsed = t - c.startT;
      const pastPeak = feat < 0.5 * c.maxFeat && elapsed > 0.04;
      if (pastPeak || elapsed >= this.candidateMax) return this._finalize();
      return null;
    }

    const sinceLast = t - this.lastPeakT;
    if (feat > this.threshold && sinceLast > this.refractory) {
      this.candidate = { startT: t, endT: t, maxFeat: feat, maxBp: bp, maxBpT: t };
      return null;
    }

    this.noiseLevel += this.noiseAlpha * (feat - this.noiseLevel);
    this._updateThreshold();
    return null;
  }
}
