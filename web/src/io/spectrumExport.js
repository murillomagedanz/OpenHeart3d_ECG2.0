import { LEAD_NAMES } from '../ecg/leads.js';
import { summarizeFilterBands } from '../ecg/spectrum.js';

const SERIES = ['raw', 'filtered', 'difference'];
const ALIASES = ['MLII', 'ML2', 'MLI', 'MLIII', 'AVR', 'AVL', 'AVF', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'];
const PUBLIC_RECORDS = { mitdb: /^\d{3}$/, 'ptb-xl': /^\d{5}_hr$/, ludb: /^\d{1,3}$/ };

function finite(value, name) {
  if (!Number.isFinite(value)) throw new RangeError(`${name}: valor não finito`);
  return value;
}

function vector(values, length, name) {
  if (!values || values.length !== length) throw new RangeError(`${name}: dimensão inválida`);
  return Array.from(values, (value) => finite(value, name));
}

function method(fftSize, fs) {
  return {
    window: 'Hann', removeDC: false, transform: 'radix-2 FFT',
    zeroPadding: 'next-power-of-two', scale: 'one-sided-peak-amplitude',
    normalization: 'sum-of-Hann-weights; doubled-except-DC-and-Nyquist',
    fftSize, resolutionHz: fs / fftSize,
  };
}

// Only public catalog identifiers and recognized ECG tokens cross this boundary.
export function safeSpectrumMetadata({ origin, catalogRecord, lead, alias, unit, fs, endIndex, sampleCount, filters }) {
  if (!['synthetic', 'real'].includes(origin) || !LEAD_NAMES.includes(lead)) {
    throw new RangeError('Fonte ou derivação inválida');
  }
  finite(fs, 'fs');
  if (fs <= 0 || !Number.isSafeInteger(endIndex) || !Number.isSafeInteger(sampleCount)
    || sampleCount < 3 || endIndex < sampleCount) throw new RangeError('Janela inválida');
  const publicRecord = origin === 'real' && catalogRecord
    && PUBLIC_RECORDS[catalogRecord.db]?.test(catalogRecord.record);
  const safeUnit = ['mV', 'uV', 'µV', 'μV', 'V', 'adu'].includes(unit) ? unit : 'unknown';
  return {
    origin,
    recordId: publicRecord ? `${catalogRecord.db}:${catalogRecord.record}` : null,
    lead: { name: lead, alias: ALIASES.includes(alias?.toUpperCase()) ? alias.toUpperCase() : null },
    fs, unit: safeUnit,
    window: {
      sampleCount, durationSeconds: sampleCount / fs,
      startIndex: endIndex - sampleCount, endIndexExclusive: endIndex,
      startSeconds: (endIndex - sampleCount) / fs, endSecondsExclusive: endIndex / fs,
      lastSampleSeconds: (endIndex - 1) / fs,
    },
    filters: {
      highPass: { type: 'first-order-high-pass', cutoffHz: finite(filters.highPassHz, 'passa-alta') },
      notch: { type: 'biquad-notch', centerHz: finite(filters.notchHz, 'notch'),
        q: finite(filters.notchQ, 'Q'), active: filters.notchActive === true },
    },
  };
}

export function serializeSpectrumExport(dataset, exportedAt = new Date()) {
  if (!dataset?.spectra || !dataset.metadata) throw new RangeError('Janela espectral indisponível');
  const { spectra, timeFrequency, metadata: input } = dataset;
  // Rebuild metadata even if a caller attaches incidental fields to the snapshot.
  const metadata = safeSpectrumMetadata({
    origin: input.origin,
    catalogRecord: input.recordId ? { db: input.recordId.split(':')[0], record: input.recordId.split(':')[1] } : null,
    lead: input.lead.name, alias: input.lead.alias, unit: input.unit, fs: input.fs,
    endIndex: input.window.endIndexExclusive, sampleCount: input.window.sampleCount,
    filters: { highPassHz: input.filters.highPass.cutoffHz, notchHz: input.filters.notch.centerHz,
      notchQ: input.filters.notch.q, notchActive: input.filters.notch.active },
  });
  const { fs, window, filters } = metadata;
  const fftSize = spectra.raw.fftSize;
  if (!Number.isSafeInteger(fftSize) || fftSize < window.sampleCount
    || fftSize !== 2 ** Math.ceil(Math.log2(window.sampleCount))) throw new RangeError('FFT inválida');
  const binCount = fftSize / 2 + 1;
  const frequencyHz = vector(spectra.raw.frequency, binCount, 'frequência');
  if (!frequencyHz.every((value, i) => value === i * fs / fftSize)) throw new RangeError('Eixo de frequência inválido');
  const amplitudes = {};
  for (const key of SERIES) {
    if (spectra[key].fs !== fs || spectra[key].sampleCount !== window.sampleCount || spectra[key].fftSize !== fftSize
      || !vector(spectra[key].frequency, binCount, key).every((v, i) => v === frequencyHz[i])) {
      throw new RangeError('Espectros desalinhados');
    }
    amplitudes[key] = vector(spectra[key].amplitude, binCount, key);
  }
  const result = {
    schema: 'openheart3d.ecg.spectral-analysis', version: 1,
    exportedAt: exportedAt.toISOString(),
    ...metadata,
    spectralMethod: method(fftSize, fs),
    spectra: { frequencyHz, differenceDefinition: 'spectrum-of-raw-minus-filtered', amplitude: amplitudes },
    bandMetrics: summarizeFilterBands(spectra, {
      highPassHz: filters.highPass.cutoffHz, notchHz: filters.notch.centerHz,
      notchQ: filters.notch.q, notchActive: filters.notch.active,
    }),
  };
  if (timeFrequency) {
    const tf = timeFrequency;
    if (tf.fs !== fs || tf.frameCount !== Math.floor((window.sampleCount - tf.frameSamples) / tf.hopSamples) + 1
      || !Number.isSafeInteger(tf.frameSamples) || !Number.isSafeInteger(tf.hopSamples)
      || tf.frameSamples < 3 || tf.hopSamples < 1 || tf.frameCount < 1
      || !Number.isSafeInteger(tf.frameCount) || !Number.isSafeInteger(tf.fftSize)
      || tf.fftSize !== 2 ** Math.ceil(Math.log2(tf.frameSamples))) {
      throw new RangeError('STFT desalinhada');
    }
    const times = vector(tf.times, tf.frameCount, 'tempo STFT');
    if (!times.every((t, i) => t === (i * tf.hopSamples + tf.frameSamples / 2) / fs)) {
      throw new RangeError('Eixo temporal STFT inválido');
    }
    const tfFrequency = vector(tf.frequency, tf.fftSize / 2 + 1, 'frequência STFT');
    if (!tfFrequency.every((v, i) => v === i * fs / tf.fftSize)) throw new RangeError('Eixo STFT inválido');
    const frames = {};
    for (const key of SERIES) {
      if (tf[key].frames.length !== tf.frameCount) throw new RangeError('Quadros STFT inválidos');
      if (!vector(tf[key].frequency, tfFrequency.length, key).every((v, i) => v === tfFrequency[i])) {
        throw new RangeError('Frequências STFT desalinhadas');
      }
      frames[key] = tf[key].frames.map((frame) => vector(frame, tf.fftSize / 2 + 1, key));
    }
    result.stft = {
      method: method(tf.fftSize, fs), frameCount: tf.frameCount,
      frameSamples: tf.frameSamples, hopSamples: tf.hopSamples,
      frameSeconds: tf.frameSamples / fs, hopSeconds: tf.hopSamples / fs,
      edgePolicy: 'complete-frames-only', matrixOrder: 'frame-by-frequency',
      frequencyHz: tfFrequency,
      centerSecondsRelative: times,
      centerSecondsAbsolute: times.map((t) => window.startSeconds + t),
      amplitude: frames,
    };
  }
  return JSON.stringify(result, null, 2) + '\n';
}

export function spectrumExportFilename(metadata) {
  const record = metadata.recordId || metadata.origin;
  return `openheart3d-spectrum-${record}-${metadata.lead.name}-${metadata.window.startIndex}-${metadata.window.endIndexExclusive}.json`
    .replace(/[^A-Za-z0-9._-]/g, '-');
}
