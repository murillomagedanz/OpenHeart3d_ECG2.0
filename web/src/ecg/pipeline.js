// Um passo do pipeline de sinal — a MESMA lógica para a interface (main.js), o
// benchmark em dados reais e os testes, para que o que é medido seja exatamente
// o que é exibido. Entrada: a amostra da fonte (sintética ou de arquivo), com
// máscara opcional de amostras inválidas por derivação.
//
// Regras:
// - amostras inválidas (sentinelas WFDB) não são medidas: o banco de filtros não
//   avança nelas e o detector não as vê;
// - o início de uma lacuna na derivação de detecção fecha a candidata aberta
//   (pode emitir o QRS real pré-lacuna) e descarta o search-back;
// - a retomada re-arma filtros e detector sem degrau artificial.

import { LeadFilterBank } from './filters.js';
import { QrsDetector } from './detector.js';

export class SignalPipeline {
  constructor(fs, nLeads, { notchHz = 60, detectionLead = 1 } = {}) {
    this.fs = fs;
    this.filters = new LeadFilterBank(fs, nLeads, { notchHz });
    this.detector = new QrsDetector(fs);
    this.detectionLead = detectionLead;
    this.inGap = false;
  }

  // sample: { t, leads, missing?, missingLeads? } como devolvido por next().
  // Retorna { filtered: Float32Array, mask: Uint8Array|null, event: null|{t, rr, latency, searchBack} }.
  step(sample) {
    const mask = sample.missing ? sample.missingLeads : null;
    const filtered = this.filters.process(sample.leads, mask);
    let event = null;
    if (mask && mask[this.detectionLead]) {
      if (!this.inGap) event = this.detector.notifyGap(sample.t);
      this.inGap = true;
    } else {
      this.inGap = false;
      event = this.detector.process(filtered[this.detectionLead], sample.t);
    }
    return { filtered, mask, event };
  }
}

// Roda uma fonte até o fim e devolve os eventos detectados (offline/benchmark).
export function detectAll(source, { notchHz = 60, nLeads = 12 } = {}) {
  const pipeline = new SignalPipeline(source.fs, nLeads, { notchHz, detectionLead: source.detectionLead ?? 1 });
  const events = [];
  while (!source.done) {
    const { event } = pipeline.step(source.next());
    if (event) events.push(event);
  }
  return { events, pipeline };
}
