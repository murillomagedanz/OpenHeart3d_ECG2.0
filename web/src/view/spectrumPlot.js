const COLORS = { raw: '#7CFC9A', filtered: '#7cc4ff', difference: '#ffd166' };
const LABELS = { raw: 'Bruto', filtered: 'Filtrado', difference: 'Diferença (bruto − filtrado)' };

export class SpectrumPlot {
  constructor(canvas, status) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.status = status;
    this.context = null;
    this._resize();
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
  }

  setContext(context) {
    this.context = context;
  }

  draw(spectra, { ready, invalidated, paused }) {
    const ctx = this.ctx;
    ctx.fillStyle = '#111820';
    ctx.fillRect(0, 0, this.width, this.height);
    const state = !ready
      ? `${paused ? 'Pausado · ' : ''}${invalidated ? 'Lacuna/amostra inválida — aguardando 10 s contínuos válidos' : 'Aguardando 10 s contínuos válidos'}`
      : paused ? 'Pausado · janela congelada' : 'Janela completa · frequência nativa';
    const details = this.context && ready && spectra
      ? ` · ${this.context.source} · ${this.context.lead} · fs ${this.context.fs} Hz · ${this.context.filterDescription}`
        + ` · Hann · sem remoção de DC · N=${spectra.raw.sampleCount} · FFT=${spectra.raw.fftSize} · Δf ${(this.context.fs / spectra.raw.fftSize).toFixed(3)} Hz`
      : this.context
        ? ` · ${this.context.source} · ${this.context.lead} · fs ${this.context.fs} Hz · ${this.context.filterDescription}`
        : '';
    this.status.textContent = `${state}${details}`;

    if (!ready || !spectra) return;
    const left = 42;
    const right = 8;
    const top = 4;
    const bottom = 20;
    const gap = 8;
    const rowHeight = (this.height - top - bottom - gap * 2) / 3;
    const plotWidth = Math.max(1, this.width - left - right);
    const maxHz = this.context.fs / 2;

    for (let row = 0; row < 3; row++) {
      const key = ['raw', 'filtered', 'difference'][row];
      const spectrum = spectra[key];
      const y = top + row * (rowHeight + gap);
      const maxAmplitude = spectrum.amplitude.reduce((max, value) => Math.max(max, value), 0) || 1;
      ctx.strokeStyle = '#34414e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, y + rowHeight);
      ctx.lineTo(this.width - right, y + rowHeight);
      ctx.stroke();
      ctx.fillStyle = COLORS[key];
      ctx.font = '11px system-ui';
      ctx.fillText(LABELS[key], 4, y + 12);
      ctx.strokeStyle = COLORS[key];
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < spectrum.frequency.length; i++) {
        const x = left + (spectrum.frequency[i] / maxHz) * plotWidth;
        const py = y + rowHeight - (spectrum.amplitude[i] / maxAmplitude) * (rowHeight - 16);
        if (i === 0) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
      ctx.fillStyle = '#8b98a5';
      ctx.fillText(`${maxAmplitude.toFixed(3)} mV pico`, left + 3, y + 12);
    }
    ctx.fillStyle = '#8b98a5';
    ctx.font = '10px system-ui';
    ctx.fillText(`0 Hz`, left, this.height - 4);
    ctx.textAlign = 'right';
    ctx.fillText(`${maxHz.toFixed(0)} Hz`, this.width - right, this.height - 4);
    ctx.textAlign = 'left';
    ctx.fillText('Frequência · Hann · FFT radix-2 com zero-padding · amplitude unilateral (mV)', left + 45, this.height - 4);
  }
}
