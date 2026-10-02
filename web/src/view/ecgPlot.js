// Traçado de 12 derivações em papel padrão (25 mm/s, 10 mm/mV) com varredura,
// mais uma tira de ritmo. Os dados ficam em buffers circulares por derivação.

import { LEAD_NAMES, LEAD_LAYOUT, RHYTHM_LEAD } from '../ecg/leads.js';

const CELL_SECONDS = 2.5;
const RHYTHM_SECONDS = 10;
const MM_PER_SEC = 25;
const MM_PER_MV = 10;

export class EcgPlot {
  constructor(canvas, fs) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fs = fs;
    this.cellLen = Math.round(CELL_SECONDS * fs);
    this.rhythmLen = Math.round(RHYTHM_SECONDS * fs);
    this.cellBuf = LEAD_NAMES.map(() => new Float32Array(this.cellLen));
    this.rhythmBuf = new Float32Array(this.rhythmLen);
    this.markers = new Uint8Array(this.rhythmLen);
    this.n = 0;
    this.rhythmIdx = LEAD_NAMES.indexOf(RHYTHM_LEAD);
    this.label = '';
    this._resize();
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.floor(r.width * dpr);
    this.canvas.height = Math.floor(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width; this.h = r.height;
  }

  push(leads) {
    const ci = this.n % this.cellLen;
    for (let i = 0; i < leads.length; i++) this.cellBuf[i][ci] = leads[i];
    const ri = this.n % this.rhythmLen;
    this.rhythmBuf[ri] = leads[this.rhythmIdx];
    this.markers[ri] = 0;
    this.n++;
  }

  markQrs(samplesAgo) {
    const ri = (this.n - 1 - samplesAgo + this.rhythmLen * 2) % this.rhythmLen;
    this.markers[ri] = 1;
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

  _trace(buf, len, x, y, w, h, pxPerMm, markers) {
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
      const py = mid - buf[k] * pxPerMv;
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke();

    if (markers) {
      ctx.fillStyle = '#ffd166';
      for (let k = 0; k < count; k++) {
        if (markers[k]) ctx.fillRect(x + (k / len) * w - 1, y + 2, 2, 6);
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
        this._trace(this.cellBuf[li], this.cellLen, x, y, cellW, cellH, pxPerMm);
        ctx.fillStyle = '#e6edf3';
        ctx.fillText(name, x + 6, y + 14);
      }
    }

    const ry = pad * 2 + gridH;
    const rw = this.w - pad * 2;
    const rPxPerMm = rw / (RHYTHM_SECONDS * MM_PER_SEC);
    this._grid(pad, ry, rw, rhythmH, rPxPerMm);
    this._trace(this.rhythmBuf, this.rhythmLen, pad, ry, rw, rhythmH, rPxPerMm, this.markers);
    ctx.fillStyle = '#e6edf3';
    ctx.fillText(`${RHYTHM_LEAD} — ritmo 10 s · marcas = QRS detectado`, pad + 6, ry + 14);

    ctx.fillStyle = '#8b98a5';
    ctx.font = '11px system-ui';
    ctx.fillText(`${MM_PER_SEC} mm/s · ${MM_PER_MV} mm/mV · fs ${this.fs} Hz · ${this.label}`, pad + 6, this.h - 6);
  }
}
