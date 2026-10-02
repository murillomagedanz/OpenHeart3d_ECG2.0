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
}

export class Notch {
  constructor(fs, f0 = 60, q = 30) {
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
}

export class LeadFilterBank {
  constructor(fs, nLeads, { hpHz = 0.5, notchHz = 60 } = {}) {
    this.description = `PA ${hpHz} Hz (1ª ordem) + notch ${notchHz} Hz (Q=30)`;
    this.chains = Array.from({ length: nLeads }, () => [new HighPass1(fs, hpHz), new Notch(fs, notchHz)]);
  }
  process(leads) {
    const out = new Float32Array(leads.length);
    for (let i = 0; i < leads.length; i++) {
      let v = leads[i];
      for (const f of this.chains[i]) v = f.process(v);
      out[i] = v;
    }
    return out;
  }
}
