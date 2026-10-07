// Filtros simples por derivação. Cada transformação é explícita e parametrizada
// para que bruto, filtrado e diferença possam ser comparados lado a lado.

export class HighPass1 {
  constructor(fs, fc = 0.5) {
    const rc = 1 / (2 * Math.PI * fc);
    this.alpha = rc / (rc + 1 / fs);
    this.prevX = 0;
    this.prevY = 0;
  }
  process(x) {
    const y = this.alpha * (this.prevY + x - this.prevX);
    this.prevX = x;
    this.prevY = y;
    return y;
  }
  // Re-arma o filtro como se o sinal começasse agora em `x`: saída 0, sem degrau.
  prime(x) {
    this.prevX = x;
    this.prevY = 0;
  }
}

export class Notch {
  constructor(fs, f0 = 60, q = 30) {
    // Acima de fs/2 a frequência não existe no sinal amostrado e os coeficientes
    // ficam instáveis (polos fora do círculo unitário): recusa em vez de divergir.
    if (!(f0 > 0 && f0 < fs / 2)) throw new RangeError(`Notch em ${f0} Hz exige fs > ${2 * f0} Hz (fs = ${fs} Hz)`);
    const w0 = (2 * Math.PI * f0) / fs;
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = 1 / a0;
    this.b1 = (-2 * Math.cos(w0)) / a0;
    this.b2 = 1 / a0;
    this.a1 = (-2 * Math.cos(w0)) / a0;
    this.a2 = (1 - alpha) / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
  // Estado de regime permanente para entrada constante `x` (ganho DC = 1).
  prime(x) {
    this.x1 = this.x2 = this.y1 = this.y2 = x;
  }
}

export class LeadFilterBank {
  constructor(fs, nLeads, { hpHz = 0.5, notchHz = 60 } = {}) {
    // Registros com fs ≤ 2·f0 (ex.: 100 Hz com rede de 60 Hz) ficam sem notch, e a
    // descrição exibida na tela diz isso em vez de fingir um filtro que não existe.
    this.notchActive = notchHz > 0 && notchHz < fs / 2;
    this.description = `PA ${hpHz} Hz (1ª ordem) + ` + (this.notchActive
      ? `notch ${notchHz} Hz (Q=30)`
      : `notch ${notchHz} Hz desativado (fs ${fs} Hz ≤ 2 × ${notchHz} Hz)`);
    this.chains = Array.from({ length: nLeads }, () => (this.notchActive
      ? [new HighPass1(fs, hpHz), new Notch(fs, notchHz)]
      : [new HighPass1(fs, hpHz)]));
    this.lastOut = new Float32Array(nLeads);
    this.skipped = new Uint8Array(nLeads);
  }

  // `skipMask[i]` verdadeiro = amostra ausente nessa derivação: o estado do filtro
  // NÃO avança (nada é inventado) e a saída anterior é repetida. Na primeira
  // amostra válida após uma lacuna, a cadeia é re-armada no novo valor, como no
  // início do registro, para não gerar um degrau artificial.
  process(leads, skipMask = null) {
    const out = new Float32Array(leads.length);
    for (let i = 0; i < leads.length; i++) {
      if (skipMask && skipMask[i]) {
        this.skipped[i] = 1;
        out[i] = this.lastOut[i];
        continue;
      }
      let v = leads[i];
      if (this.skipped[i]) {
        this.skipped[i] = 0;
        for (const f of this.chains[i]) { f.prime(v); v = f.process(v); }
      } else {
        for (const f of this.chains[i]) v = f.process(v);
      }
      this.lastOut[i] = v;
      out[i] = v;
    }
    return out;
  }
}
