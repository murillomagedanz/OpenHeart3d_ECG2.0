// Fonte de reprodução para registros carregados de arquivo (WFDB). Mapeia os
// sinais do registro nas 12 derivações padrão e entrega amostras uma a uma,
// com a mesma interface da fonte sintética. Os sinais nunca são reamostrados:
// o pipeline é reconstruído na frequência nativa do registro.

import { LEAD_NAMES } from '../ecg/leads.js';

const ALIASES = {
  MLII: 'II', ML2: 'II', MLI: 'I', MLIII: 'III', AVR: 'aVR', AVL: 'aVL', AVF: 'aVF',
  // Alguns equipamentos nomeiam as precordiais C1–C6 (posição do eletrodo); são as mesmas V1–V6.
  C1: 'V1', C2: 'V2', C3: 'V3', C4: 'V4', C5: 'V5', C6: 'V6',
};

export function mapSignalsToLeads(descriptions) {
  const mapping = new Int32Array(LEAD_NAMES.length).fill(-1);
  const aliases = {};
  const unmapped = [];

  descriptions.forEach((desc, i) => {
    const key = (desc || '').trim().toUpperCase().replace(/\s+/g, '');
    const std = ALIASES[key] ?? LEAD_NAMES.find((n) => n.toUpperCase() === key);
    const li = std ? LEAD_NAMES.indexOf(std) : -1;
    if (li >= 0 && mapping[li] < 0) {
      mapping[li] = i;
      if (std.toUpperCase() !== key) aliases[std] = desc.trim(); // ex.: II ← MLII; não para 'avr' → aVR
    } else {
      unmapped.push({ index: i, description: desc });
    }
  });

  const iiIdx = LEAD_NAMES.indexOf('II');
  const recognizedII = mapping[iiIdx] >= 0;

  // Nenhum nome reconhecido: mostra os sinais na ordem, com o nome original, para
  // que registros de 1–2 canais genéricos ainda possam ser reproduzidos.
  if (mapping.every((v) => v < 0)) {
    const pending = unmapped.splice(0);
    pending.forEach((u, k) => {
      if (k < LEAD_NAMES.length) {
        mapping[k] = u.index;
        aliases[LEAD_NAMES[k]] = u.description || `sinal ${u.index}`;
      } else unmapped.push(u);
    });
  }

  const available = Array.from(mapping, (v) => v >= 0);
  const detectionLead = recognizedII ? iiIdx : available.indexOf(true);
  return { mapping, aliases, unmapped, available, detectionLead };
}

export class FileSource {
  constructor(record) {
    this.record = record;
    this.fs = record.header.fs;
    this.dt = 1 / this.fs;
    this.nSamples = record.nSamples;
    this.beats = record.beats; // índices de amostra das anotações de referência (pode ser vazio)
    Object.assign(this, mapSignalsToLeads(record.header.signals.map((s) => s.description)));
    this.lastValidLeads = new Float32Array(LEAD_NAMES.length);
    this.reset();
  }

  get duration() { return this.nSamples / this.fs; }
  get position() { return this.index / this.fs; }
  get done() { return this.index >= this.nSamples; }

  reset() {
    this.index = 0;
    this.missingSamples = 0;
    this.lastValidLeads.fill(0);
  }

  // Retorna { t, index, leads: Float32Array(12), missing, missingLeads } em mV.
  // Derivações ausentes no registro ficam em 0. Numa amostra inválida (sentinela
  // WFDB), `leads[l]` repete a última amostra válida — só para quem ignorar a
  // máscara nunca receber NaN — e `missingLeads[l] = 1` avisa quem processa para
  // NÃO tratar o valor como medida (filtros, detector e traçado usam a máscara).
  next() {
    const i = this.index;
    const leads = new Float32Array(LEAD_NAMES.length);
    const missingLeads = new Uint8Array(LEAD_NAMES.length);
    let missing = false;
    for (let l = 0; l < leads.length; l++) {
      const s = this.mapping[l];
      if (s >= 0) {
        const v = this.record.signals[s][i];
        if (Number.isFinite(v)) {
          leads[l] = v;
          this.lastValidLeads[l] = v;
        } else {
          leads[l] = this.lastValidLeads[l];
          missingLeads[l] = 1;
          this.missingSamples++;
          missing = true;
        }
      }
    }
    this.index++;
    return { t: i / this.fs, index: i, leads, missing, missingLeads };
  }
}
