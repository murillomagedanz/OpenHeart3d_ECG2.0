const WINDOW_SECONDS = 10;

function nextPowerOfTwo(value) {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

function fft(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const angle = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let j = 0; j < half; j++) {
        const wr = Math.cos(angle * j);
        const wi = Math.sin(angle * j);
        const even = start + j;
        const odd = even + half;
        const tr = wr * real[odd] - wi * imag[odd];
        const ti = wr * imag[odd] + wi * real[odd];
        real[odd] = real[even] - tr;
        imag[odd] = imag[even] - ti;
        real[even] += tr;
        imag[even] += ti;
      }
    }
  }
}

// One-sided peak amplitude spectrum in the input unit (mV), Hann windowed.
export function amplitudeSpectrum(samples, fs) {
  if (!Number.isFinite(fs) || fs <= 0) throw new RangeError('fs deve ser positiva e finita');
  if (!samples || samples.length < 2) throw new RangeError('O espectro exige ao menos duas amostras');
  const n = samples.length;
  const fftSize = nextPowerOfTwo(n);
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);
  let windowSum = 0;

  for (let i = 0; i < n; i++) {
    const value = samples[i];
    if (!Number.isFinite(value)) throw new RangeError(`Amostra inválida no índice ${i}`);
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    real[i] = value * window;
    windowSum += window;
  }
  fft(real, imag);

  const bins = Math.floor(fftSize / 2) + 1;
  const frequency = new Float64Array(bins);
  const amplitude = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    frequency[k] = (k * fs) / fftSize;
    const scale = k === 0 || (fftSize % 2 === 0 && k === fftSize / 2) ? 1 : 2;
    amplitude[k] = (scale * Math.hypot(real[k], imag[k])) / windowSum;
  }
  return { frequency, amplitude, fs, sampleCount: n, fftSize };
}

export class SpectrumWindow {
  constructor(fs, seconds = WINDOW_SECONDS) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new RangeError('A duração da janela deve ser positiva e finita');
    this.seconds = seconds;
    this.reset(fs);
  }

  reset(fs) {
    if (!Number.isFinite(fs) || fs <= 0) throw new RangeError('fs deve ser positiva e finita');
    this.fs = fs;
    this.length = Math.round(this.seconds * fs);
    if (this.length < 2) throw new RangeError('A janela deve conter ao menos duas amostras');
    this.raw = new Float32Array(this.length);
    this.filtered = new Float32Array(this.length);
    this.count = 0;
    this.writeIndex = 0;
    this.invalidated = false;
    this.version = 0;
  }

  push(raw, filtered, invalid = false) {
    if (invalid || !Number.isFinite(raw) || !Number.isFinite(filtered)) {
      this.count = 0;
      this.writeIndex = 0;
      this.invalidated = true;
      this.version++;
      return false;
    }
    this.raw[this.writeIndex] = raw;
    this.filtered[this.writeIndex] = filtered;
    this.writeIndex = (this.writeIndex + 1) % this.length;
    this.count = Math.min(this.count + 1, this.length);
    this.version++;
    return this.full;
  }

  get full() { return this.count === this.length; }

  // Return aligned chronological arrays; difference is derived from this same pair.
  samples() {
    if (!this.full) return null;
    const raw = new Float32Array(this.length);
    const filtered = new Float32Array(this.length);
    const difference = new Float32Array(this.length);
    for (let i = 0; i < this.length; i++) {
      const sourceIndex = (this.writeIndex + i) % this.length;
      raw[i] = this.raw[sourceIndex];
      filtered[i] = this.filtered[sourceIndex];
      difference[i] = raw[i] - filtered[i];
    }
    return { raw, filtered, difference };
  }

  analyze() {
    const samples = this.samples();
    if (!samples) return null;
    return {
      raw: amplitudeSpectrum(samples.raw, this.fs),
      filtered: amplitudeSpectrum(samples.filtered, this.fs),
      difference: amplitudeSpectrum(samples.difference, this.fs),
    };
  }
}
