// Detector de QRS em tempo real (Pan–Tompkins simplificado) sobre uma derivação.
// Trabalha apenas com o sinal recebido: é ele que comanda a animação do coração.
//
// Etapas: passa-banda por médias móveis → derivada sobre 10 ms → quadrado →
// integração em janela móvel (MWI). Quando a MWI cruza metade do limiar, abre-se
// uma janela "candidata" que acompanha o pico; ao fechar, ela vira QRS se tiver
// cruzado o limiar cheio, ou fica guardada como reserva. Se passar 1,66 × RR
// médio sem QRS, a melhor reserva é declarada (search-back do Pan–Tompkins).
// O instante do R é o máximo em módulo do passa-banda dentro da janela, para
// que complexos predominantemente negativos (QS, S profundo) sejam marcados
// na deflexão dominante e não no rebote. Latência típica: ~60–130 ms.

export class QrsDetector {
  constructor(fs) {
    this.fs = fs;
    this.winShort = Math.round(0.03 * fs);   // passa-baixa (~15 Hz)
    this.winLong = Math.round(0.15 * fs);    // estimativa de linha de base
    this.derivLag = Math.round(0.01 * fs);   // derivada sobre 10 ms
    this.mwiLen = Math.round(0.1 * fs);
    this.refractory = 0.22;
    this.candidateMax = 0.12;                // duração máxima da janela candidata (s)
    this.searchBackFactor = 1.66;            // RR sem QRS que dispara o search-back
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

    this.candidate = null; // { startT, endT, maxFeat, maxAbsBp, peakT, strong }
    this.backup = null;    // melhor candidata fraca desde o último QRS
  }

  get rrMean() {
    if (!this.rr.length) return null;
    return this.rr.reduce((a, b) => a + b, 0) / this.rr.length;
  }

  get heartRate() {
    const m = this.rrMean;
    return m ? 60 / m : null;
  }

  // Limite superior do atraso entre o pico R e a emissão do evento: a janela
  // candidata com os filtros (~0,25 s) ou, no search-back, 1,66 × RR médio.
  // Quem pontua ao vivo usa isso para não declarar FN cedo demais.
  get maxLatency() {
    const m = this.rrMean;
    return Math.max(0.6, (m ? this.searchBackFactor * m : 0) + this.candidateMax + 0.15);
  }

  _updateThreshold() {
    this.threshold = this.noiseLevel + 0.3 * (this.signalLevel - this.noiseLevel);
  }

  _emit(c, levelWeight, nowT, searchBack) {
    const peakT = c.peakT - this.groupDelay;
    const rr = Number.isFinite(this.lastPeakT) ? peakT - this.lastPeakT : null;
    this.lastPeakT = peakT;
    if (rr) {
      this.rr.push(rr);
      if (this.rr.length > 8) this.rr.shift();
    }
    this.signalLevel = levelWeight * c.maxFeat + (1 - levelWeight) * this.signalLevel;
    this._updateThreshold();
    this.backup = null;
    return { t: peakT, rr, latency: nowT - peakT, searchBack };
  }

  _closeCandidate(nowT) {
    const c = this.candidate;
    this.candidate = null;
    if (c.strong) return this._emit(c, 0.125, nowT, false);
    if (!this.backup || c.maxFeat > this.backup.maxFeat) this.backup = c;
    return null;
  }

  // Retorna null ou { t: instante estimado do pico R, rr, latency, searchBack }.
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

    // Search-back: muito tempo sem QRS e existe uma candidata fraca guardada.
    const rrMean = this.rrMean;
    if (this.backup && rrMean && t - this.lastPeakT > this.searchBackFactor * rrMean) {
      const c = this.backup;
      return this._emit(c, 0.25, t, true);
    }

    if (this.candidate) {
      const c = this.candidate;
      if (feat > c.maxFeat) c.maxFeat = feat;
      if (feat > this.threshold) c.strong = true;
      const abs = Math.abs(bp);
      if (abs > c.maxAbsBp) { c.maxAbsBp = abs; c.peakT = t; }
      c.endT = t;
      const elapsed = t - c.startT;
      const pastPeak = feat < 0.5 * c.maxFeat && elapsed > 0.04;
      if (pastPeak || elapsed >= this.candidateMax) return this._closeCandidate(t);
      return null;
    }

    const sinceLast = t - this.lastPeakT;
    const halfThreshold = this.noiseLevel + 0.5 * (this.threshold - this.noiseLevel);
    if (feat > halfThreshold && sinceLast > this.refractory) {
      this.candidate = { startT: t, endT: t, maxFeat: feat, maxAbsBp: Math.abs(bp), peakT: t, strong: feat > this.threshold };
      return null;
    }

    this.noiseLevel += this.noiseAlpha * (feat - this.noiseLevel);
    this._updateThreshold();
    return null;
  }
}
