const COLORS = { raw: '#7CFC9A', filtered: '#7cc4ff', difference: '#ffd166' };
const LABELS = { raw: 'Bruto', filtered: 'Filtrado', difference: 'Diferença (bruto − filtrado)' };

function formatPeak(peak, unit) {
  return peak.frequency === null ? '—' : `${peak.frequency.toFixed(2)} Hz/${peak.amplitude.toFixed(3)} ${unit}`;
}

function formatBand(name, band, unit) {
  return `${name} ${band.lowerHz.toFixed(2)}–${band.upperHz.toFixed(2)} Hz · bruto ${formatPeak(band.raw, unit)} · filtrado ${formatPeak(band.filtered, unit)} · diferença ${formatPeak(band.difference, unit)}`;
}

function setMetricLines(element, lines) {
  element.replaceChildren(...lines.map((text) => {
    const line = element.ownerDocument.createElement('div');
    line.textContent = text;
    return line;
  }));
}

export class SpectrumPlot {
  constructor(canvas, status, metrics) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.status = status;
    this.metrics = metrics;
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

  draw(spectra, timeFrequency, bands, { ready, invalidated, paused, mode }) {
    const ctx = this.ctx;
    ctx.fillStyle = '#111820';
    ctx.fillRect(0, 0, this.width, this.height);
    const state = !ready
      ? `${paused ? 'Pausado · ' : ''}${invalidated ? 'Lacuna/amostra inválida — aguardando 10 s contínuos válidos' : 'Aguardando 10 s contínuos válidos'}`
      : paused ? 'Pausado · janela congelada' : 'Janela completa · frequência nativa';
    const method = mode === 'time-frequency'
      ? timeFrequency
        ? `Hann STFT · sem remoção de DC · radix-2 + zero-padding · quadro ${timeFrequency.frameSeconds.toFixed(1)} s · avanço ${timeFrequency.hopSeconds.toFixed(1)} s`
          + ` · N=${timeFrequency.frameSamples} · FFT=${timeFrequency.fftSize} · Δf ${(this.context.fs / timeFrequency.fftSize).toFixed(3)} Hz`
        : 'STFT aguardando cálculo'
      : spectra
        ? `Hann · sem remoção de DC · N=${spectra.raw.sampleCount} · FFT=${spectra.raw.fftSize} · Δf ${(this.context.fs / spectra.raw.fftSize).toFixed(3)} Hz`
        : '';
    const details = this.context && ready && method
      ? ` · ${this.context.source} · ${this.context.lead} · fs ${this.context.fs} Hz · ${this.context.filterDescription} · ${method}`
      : this.context
        ? ` · ${this.context.source} · ${this.context.lead} · fs ${this.context.fs} Hz · ${this.context.filterDescription}`
        : '';
    this.status.textContent = `${state}${details}`;
    if (!ready || !bands) {
      this.metrics.textContent = 'Medidas de banda disponíveis após uma janela válida de 10 s.';
      this.metrics.title = '';
    } else {
      setMetricLines(this.metrics, [
        formatBand('Abaixo do passa-alta', bands.low, this.context.unit),
        formatBand(
          bands.mains.active ? `Notch ${bands.mains.centerHz.toFixed(0)} Hz` : `Faixa nominal ${bands.mains.centerHz.toFixed(0)} Hz (notch inativo)`,
          bands.mains, this.context.unit,
        ),
      ]);
      this.metrics.title = 'Picos de conteúdo, não classificação de artefato nem interpretação clínica.';
    }

    if (!ready || (!spectra && !timeFrequency)) return;
    if (mode === 'time-frequency') {
      this.canvas.setAttribute('aria-label', 'Espectrogramas STFT alinhados de bruto, filtrado e diferença na mesma janela válida de 10 segundos');
      if (timeFrequency) this._drawTimeFrequency(timeFrequency);
      return;
    }
    this.canvas.setAttribute('aria-label', 'Espectros de amplitude unilateral de bruto, filtrado e diferença calculados sobre a mesma janela de 10 segundos');
    if (spectra) this._drawFrequency(spectra);
  }

  _drawFrequency(spectra) {
    const ctx = this.ctx;
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
      ctx.fillText(`${maxAmplitude.toFixed(3)} ${this.context.unit} pico`, left + 3, y + 12);
    }
    ctx.fillStyle = '#8b98a5';
    ctx.font = '10px system-ui';
    ctx.fillText(`0 Hz`, left, this.height - 4);
    ctx.textAlign = 'right';
    ctx.fillText(`${maxHz.toFixed(0)} Hz`, this.width - right, this.height - 4);
    ctx.textAlign = 'left';
    ctx.fillText(`Frequência · Hann · FFT radix-2 com zero-padding · amplitude unilateral (${this.context.unit})`, left + 45, this.height - 4);
  }

  _drawTimeFrequency(result) {
    const ctx = this.ctx;
    const left = 42;
    const right = 8;
    const top = 4;
    const bottom = 20;
    const gap = 5;
    const rowHeight = (this.height - top - bottom - gap * 2) / 3;
    const plotWidth = Math.max(1, this.width - left - right);
    const maxHz = this.context.fs / 2;
    let maxAmplitude = 0;
    for (const key of ['raw', 'filtered', 'difference']) {
      for (const frame of result[key].frames) {
        for (const value of frame) maxAmplitude = Math.max(maxAmplitude, value);
      }
    }
    maxAmplitude ||= 1;

    const colorAt = (amplitude) => {
      const db = Math.max(-60, 20 * Math.log10(Math.max(amplitude / maxAmplitude, 1e-6)));
      const level = (db + 60) / 60;
      const red = Math.round(20 + 235 * Math.max(0, (level - 0.45) / 0.55));
      const green = Math.round(35 + 205 * Math.min(1, level * 1.6));
      const blue = Math.round(80 + 80 * (1 - level));
      return `rgb(${red},${green},${blue})`;
    };

    for (let row = 0; row < 3; row++) {
      const key = ['raw', 'filtered', 'difference'][row];
      const y = top + row * (rowHeight + gap);
      ctx.fillStyle = '#0b0f14';
      ctx.fillRect(left, y, plotWidth, rowHeight);
      ctx.fillStyle = COLORS[key];
      ctx.font = '11px system-ui';
      ctx.fillText(LABELS[key], 4, y + 12);
      for (let frame = 0; frame < result.frameCount; frame++) {
        const x0 = left + (frame / result.frameCount) * plotWidth;
        const x1 = left + ((frame + 1) / result.frameCount) * plotWidth;
        const frameData = result[key].frames[frame];
        for (let bin = 0; bin < frameData.length; bin++) {
          const y0 = y + rowHeight - ((bin + 1) / frameData.length) * rowHeight;
          const y1 = y + rowHeight - (bin / frameData.length) * rowHeight;
          ctx.fillStyle = colorAt(frameData[bin]);
          ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
        }
      }
    }

    ctx.fillStyle = '#8b98a5';
    ctx.font = '10px system-ui';
    ctx.fillText(`0 s · ${result.frameSeconds.toFixed(1)} s janela / ${result.hopSeconds.toFixed(1)} s avanço`, left, this.height - 4);
    ctx.textAlign = 'right';
    ctx.fillText(`${(result.times.at(-1) + result.frameSeconds / 2).toFixed(1)} s`, this.width - right, this.height - 4);
    ctx.textAlign = 'left';
    ctx.fillText(`Tempo × frequência (0–${maxHz.toFixed(0)} Hz) · Hann · escala comum 0 a −60 dB relativa ao maior pico`, left + 230, this.height - 4);
  }
}
