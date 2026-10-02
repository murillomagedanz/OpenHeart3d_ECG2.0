// Traçado de 12 derivações em papel padrão (25 mm/s, 10 mm/mV) com varredura,
// mais uma tira de ritmo. Bruto e filtrado ficam em buffers circulares por
// derivação; o modo de exibição (bruto | filtrado | diferença) é escolhido na
// hora de desenhar, então trocar de modo redesenha o histórico inteiro de
// imediato, mesmo em pausa, em vez de misturar representações.

import { LEAD_NAMES, LEAD_LAYOUT, RHYTHM_LEAD } from '../ecg/leads.js';

const CELL_SECONDS = 2.5;
const RHYTHM_SECONDS = 10;
const MM_PER_SEC = 25;
const MM_PER_MV = 10;

export const VIEW_MODES = ['raw', 'filtered', 'diff'];

export class EcgPlot {
  constructor(canvas, fs) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.label = '';
    this.mode = 'filtered';
    this.setLeads({});
    this.reset(fs);
    this._resize();
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
  }

  // Reinicia os buffers (troca de fonte, de frequência de amostragem ou reinício do registro).
  reset(fs) {
    this.fs = fs;
    this.cellLen = Math.round(CELL_SECONDS * fs);
    this.rhythmLen = Math.round(RHYTHM_SECONDS * fs);
    this.rawCell = LEAD_NAMES.map(() => new Float32Array(this.cellLen));
    this.filtCell = LEAD_NAMES.map(() => new Float32Array(this.cellLen));
    this.rawRhythm = new Float32Array(this.rhythmLen);
    this.filtRhythm = new Float32Array(this.rhythmLen);
    this.markers = new Uint8Array(this.rhythmLen);
    this.refMarkers = new Uint8Array(this.rhythmLen);
    this.n = 0;
  }

  setMode(mode) {
    if (!VIEW_MODES.includes(mode)) throw new RangeError(`Modo de exibição desconhecido: ${mode}`);
    this.mode = mode;
  }

  // available: quais derivações existem na fonte; aliases: nome original do sinal
  // (ex.: II ← MLII); rhythmLead: índice da derivação usada na tira de ritmo/detecção;
  // hasReference: se há anotações de referência a mostrar.
  setLeads({ available = LEAD_NAMES.map(() => true), aliases = {}, rhythmLead = LEAD_NAMES.indexOf(RHYTHM_LEAD), hasReference = false }) {
    this.available = available;
    this.aliases = aliases;
    this.rhythmIdx = rhythmLead;
    this.hasReference = hasReference;
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.floor(r.width * dpr);
    this.canvas.height = Math.floor(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width; this.h = r.height;
  }

  // raw e filtered: Float32Array(12) em mV da mesma amostra.
  push(raw, filtered) {
    const ci = this.n % this.cellLen;
    for (let i = 0; i < raw.length; i++) {
      this.rawCell[i][ci] = raw[i];
      this.filtCell[i][ci] = filtered[i];
    }
    const ri = this.n % this.rhythmLen;
    this.rawRhythm[ri] = raw[this.rhythmIdx];
    this.filtRhythm[ri] = filtered[this.rhythmIdx];
    this.markers[ri] = 0;
    this.refMarkers[ri] = 0;
    this.n++;
  }

  // Valor a desenhar no modo atual, a partir dos pares bruto/filtrado.
  _sample(rawBuf, filtBuf, k) {
    if (this.mode === 'raw') return rawBuf[k];
    if (this.mode === 'diff') return rawBuf[k] - filtBuf[k];
    return filtBuf[k];
  }

  markQrs(samplesAgo) {
    const ri = (this.n - 1 - samplesAgo + this.rhythmLen * 2) % this.rhythmLen;
    this.markers[ri] = 1;
  }

  // Batimento de referência (anotação do banco de dados), desenhado na base da tira.
  markRef(samplesAgo) {
    const ri = (this.n - 1 - samplesAgo + this.rhythmLen * 2) % this.rhythmLen;
    this.refMarkers[ri] = 1;
  }

  _leadLabel(name) {
    const alias = this.aliases[name];
    return alias ? `${name} (${alias})` : name;
  }

  _grid(x, y, w, h, pxPerMm) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#231b1e';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let gx = x; gx <= x + w; gx += pxPerMm) { ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); }
    for (let gy = y; gy <= y + h; gy += pxPerMm) { ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); }
    ctx.stroke();
    ctx.strokeStyle = '#3f2c32';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let gx = x; gx <= x + w; gx += pxPerMm * 5) { ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); }
    for (let gy = y; gy <= y + h; gy += pxPerMm * 5) { ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); }
    ctx.stroke();
  }

  _trace(rawBuf, filtBuf, len, x, y, w, h, pxPerMm, markers, refMarkers) {
    const ctx = this.ctx;
    const mid = y + h / 2;
    const pxPerMv = pxPerMm * MM_PER_MV;
    const head = this.n % len;
    const count = Math.min(this.n, len);

    ctx.strokeStyle = '#7CFC9A';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let started = false;
    for (let k = 0; k < count; k++) {
      if (k === head) { started = false; continue; }
      const px = x + (k / len) * w;
      const py = mid - this._sample(rawBuf, filtBuf, k) * pxPerMv;
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke();

    if (markers) {
      ctx.fillStyle = '#ffd166';
      for (let k = 0; k < count; k++) {
        if (markers[k]) ctx.fillRect(x + (k / len) * w - 1, y + 2, 2, 6);
      }
    }
    if (refMarkers) {
      ctx.fillStyle = '#4cc9f0';
      for (let k = 0; k < count; k++) {
        if (refMarkers[k]) ctx.fillRect(x + (k / len) * w - 1, y + h - 8, 2, 6);
      }
    }

    // Barra de varredura: cobre a região recém-sobrescrita.
    const sx = x + (head / len) * w;
    ctx.fillStyle = 'rgba(17,24,32,0.9)';
    ctx.fillRect(sx, y, Math.max(6, w * 0.015), h);
  }

  draw() {
    const ctx = this.ctx;
    ctx.fillStyle = '#111820';
    ctx.fillRect(0, 0, this.w, this.h);

    const pad = 6;
    const cols = LEAD_LAYOUT[0].length;
    const rows = LEAD_LAYOUT.length;
    const rhythmH = Math.min(120, this.h * 0.22);
    const gridH = this.h - rhythmH - pad * 3;
    const cellW = (this.w - pad * 2) / cols;
    const cellH = gridH / rows;
    const pxPerMm = cellW / (CELL_SECONDS * MM_PER_SEC);

    ctx.font = '12px system-ui';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const name = LEAD_LAYOUT[r][c];
        const li = LEAD_NAMES.indexOf(name);
        const x = pad + c * cellW; const y = pad + r * cellH;
        this._grid(x, y, cellW, cellH, pxPerMm);
        if (this.available[li]) {
          this._trace(this.rawCell[li], this.filtCell[li], this.cellLen, x, y, cellW, cellH, pxPerMm);
          ctx.fillStyle = '#e6edf3';
          ctx.fillText(this._leadLabel(name), x + 6, y + 14);
        } else {
          ctx.fillStyle = '#596673';
          ctx.fillText(`${name} — sem sinal neste registro`, x + 6, y + 14);
        }
      }
    }

    const ry = pad * 2 + gridH;
    const rw = this.w - pad * 2;
    const rPxPerMm = rw / (RHYTHM_SECONDS * MM_PER_SEC);
    this._grid(pad, ry, rw, rhythmH, rPxPerMm);
    this._trace(this.rawRhythm, this.filtRhythm, this.rhythmLen, pad, ry, rw, rhythmH, rPxPerMm, this.markers, this.hasReference ? this.refMarkers : null);
    ctx.fillStyle = '#e6edf3';
    const legend = this.hasReference
      ? 'marcas amarelas (acima) = QRS detectado · azuis (abaixo) = referência anotada no banco'
      : 'marcas = QRS detectado';
    ctx.fillText(`${this._leadLabel(LEAD_NAMES[this.rhythmIdx])} — ritmo 10 s · ${legend}`, pad + 6, ry + 14);

    ctx.fillStyle = '#8b98a5';
    ctx.font = '11px system-ui';
    ctx.fillText(`${MM_PER_SEC} mm/s · ${MM_PER_MV} mm/mV · fs ${this.fs} Hz · ${this.label}`, pad + 6, this.h - 6);
  }
}
