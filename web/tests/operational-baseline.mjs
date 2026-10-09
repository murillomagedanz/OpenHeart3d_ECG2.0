import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getHeapStatistics } from 'node:v8';
import { performance } from 'node:perf_hooks';

import { SignalPipeline } from '../src/ecg/pipeline.js';
import { SyntheticSource } from '../src/ecg/synth.js';
import { LEAD_NAMES } from '../src/ecg/leads.js';
import { delineateWaves } from '../src/ecg/waves.js';
import { amplitudeSpectrum, timeFrequencyAnalysis } from '../src/ecg/spectrum.js';
import { loadRecord } from '../src/io/wfdb.js';
import { FileSource } from '../src/io/fileSource.js';
import { safeSpectrumMetadata, serializeSpectrumExport } from '../src/io/spectrumExport.js';

export const DURATION_S = 30 * 60;
export const SEED = 20261008;
export const CHANNELS = 12;
export const WARMUPS = 1;
export const MEASUREMENTS = 5;
const II = LEAD_NAMES.indexOf('II');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(root, '..');

function assertFinitePositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite`);
}

export function validateWorkload({ fs, notchHz, durationSeconds = DURATION_S, seed = SEED }) {
  assertFinitePositive(fs, 'fs');
  assertFinitePositive(notchHz, 'notchHz');
  assertFinitePositive(durationSeconds, 'durationSeconds');
  if (!Number.isSafeInteger(fs * durationSeconds)) throw new RangeError('fs * durationSeconds must be a safe integer');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('seed must be an unsigned 32-bit integer');
  if (notchHz >= fs / 2) throw new RangeError('notchHz must be below Nyquist');
  return { fs, notchHz, durationSeconds, seed, nSamples: fs * durationSeconds };
}

function quantile(values, q) {
  if (!values.length || !Number.isFinite(q) || q < 0 || q > 1) {
    throw new RangeError('quantile requires values and q in [0, 1]');
  }
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(q * ordered.length) - 1)];
}

export function summarizeTimes(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('timings must be a non-empty array of finite non-negative values');
  }
  return {
    count: values.length,
    min: Math.min(...values),
    p50: quantile(values, 0.5),
    p95: quantile(values, 0.95),
    max: Math.max(...values),
  };
}

function syntheticSource({ fs, notchHz, seed }) {
  const source = new SyntheticSource({ fs, seed });
  source.setParams({
    hr: 72,
    hrvPct: 4,
    noiseMv: 0.03,
    mainsMv: 0.05,
    mainsHz: notchHz,
  });
  return source;
}

function processMemory() {
  const usage = process.memoryUsage();
  return {
    heapUsedBytes: usage.heapUsed,
    rssBytes: usage.rss,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers,
  };
}

function pipelineRun(config, { collectBlocks = false, collectMemory = false, hashEvents = false } = {}) {
  const source = syntheticSource(config);
  const pipeline = new SignalPipeline(config.fs, CHANNELS, { notchHz: config.notchHz, detectionLead: II });
  const blocksMs = [];
  const memory = [];
  const blockSamples = config.fs;
  let eventCount = 0;
  let digest = hashEvents ? createHash('sha256') : null;
  let startedAt = performance.now();
  let blockStartedAt = startedAt;
  if (collectMemory) memory.push({ signalSeconds: 0, ...processMemory() });

  for (let index = 0; index < config.nSamples; index++) {
    const sample = source.next();
    const { event } = pipeline.step(sample);
    if (event) {
      eventCount++;
      if (digest) digest.update(`${event.t}|${event.rr}|${event.latency}|${event.searchBack ? 1 : 0}\n`);
    }

    const completedSamples = index + 1;
    if (collectBlocks && completedSamples % blockSamples === 0) {
      const now = performance.now();
      blocksMs.push(now - blockStartedAt);
      blockStartedAt = now;
    }
    if (collectMemory && completedSamples % (config.fs * 60) === 0) {
      memory.push({ signalSeconds: completedSamples / config.fs, ...processMemory() });
    }
  }

  const elapsedMs = performance.now() - startedAt;
  if (collectMemory) {
    const last = memory.at(-1);
    if (last.signalSeconds !== config.durationSeconds) {
      memory.push({ signalSeconds: config.durationSeconds, ...processMemory() });
    }
  }
  return {
    elapsedMs,
    eventCount,
    eventSha256: digest?.digest('hex') ?? null,
    blocksMs,
    memory,
  };
}

function bytesPerSecond(samplesPerChannel, elapsedMs) {
  return samplesPerChannel / (elapsedMs / 1000);
}

async function loadFixture(entry) {
  const directory = path.join(root, 'data', 'records', entry.db);
  const heaName = entry.files.find((file) => file.endsWith('.hea'));
  if (!heaName) throw new Error(`No WFDB header declared for ${entry.id}`);
  const headerText = await readFile(path.join(directory, heaName), 'utf8');
  const files = {};
  for (const file of entry.files) {
    if (file === heaName) continue;
    const bytes = await readFile(path.join(directory, file));
    files[file] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  return { entry, headerText, files, annotations: entry.annotations ? files[entry.annotations] : null };
}

function realPipelineRun(record, notchHz) {
  const source = new FileSource(record);
  const pipeline = new SignalPipeline(source.fs, CHANNELS, { notchHz, detectionLead: source.detectionLead });
  let events = 0;
  const digest = createHash('sha256');
  while (!source.done) {
    const { event } = pipeline.step(source.next());
    if (event) {
      events++;
      digest.update(`${event.t}|${event.rr}|${event.latency}|${event.searchBack ? 1 : 0}\n`);
    }
  }
  return { events, eventSha256: digest.digest('hex') };
}

async function benchmarkRealRecord(entry) {
  const fixture = await loadFixture(entry);
  const decodeTimesMs = [];
  let record = null;
  for (let i = 0; i <= MEASUREMENTS; i++) {
    const started = performance.now();
    record = loadRecord(fixture);
    const elapsed = performance.now() - started;
    if (i > 0) decodeTimesMs.push(elapsed);
  }
  if (!record || record.checksums.some((ok) => ok !== true)) {
    throw new Error(`Expected all local WFDB checksums to pass for ${entry.id}`);
  }

  const processTimesMs = [];
  let processResult = null;
  const notchHz = entry.db === 'ludb' ? 50 : 60;
  for (let i = 0; i <= MEASUREMENTS; i++) {
    const started = performance.now();
    processResult = realPipelineRun(record, notchHz);
    const elapsed = performance.now() - started;
    if (i > 0) processTimesMs.push(elapsed);
  }
  const durationSeconds = record.nSamples / record.header.fs;
  return {
    id: entry.id,
    fs: record.header.fs,
    durationSeconds,
    samplesPerChannel: record.nSamples,
    leadsInFile: record.header.nSig,
    mappedLeads: CHANNELS,
    detectionLead: LEAD_NAMES[new FileSource(record).detectionLead],
    annotations: record.beats.length,
    checksums: { verified: record.checksums.filter(Boolean).length, total: record.checksums.length },
    decode: {
      warmups: WARMUPS,
      measurementsMs: decodeTimesMs,
      summary: summarizeTimes(decodeTimesMs),
      samplesPerSecond: bytesPerSecond(record.nSamples, quantile(decodeTimesMs, 0.5)),
    },
    filtersQrs: {
      notchHz,
      warmups: WARMUPS,
      measurementsMs: processTimesMs,
      summary: summarizeTimes(processTimesMs),
      signalSecondsPerWallSecond: durationSeconds / (quantile(processTimesMs, 0.5) / 1000),
      events: processResult.events,
      eventSha256: processResult.eventSha256,
    },
  };
}

function materializeSignals(config) {
  const source = syntheticSource(config);
  const signals = Array.from({ length: CHANNELS }, () => new Float32Array(config.nSamples));
  for (let i = 0; i < config.nSamples; i++) {
    const sample = source.next();
    for (let lead = 0; lead < CHANNELS; lead++) signals[lead][i] = sample.leads[lead];
  }
  return signals;
}

function materializedPipelineRun(signals, config, { captureFiltered = false } = {}) {
  const pipeline = new SignalPipeline(config.fs, CHANNELS, { notchHz: config.notchHz, detectionLead: II });
  const leads = new Float32Array(CHANNELS);
  let filteredII = captureFiltered ? new Float32Array(config.nSamples) : null;
  const events = [];
  for (let index = 0; index < config.nSamples; index++) {
    for (let lead = 0; lead < CHANNELS; lead++) leads[lead] = signals[lead][index];
    const { filtered, event } = pipeline.step({ t: index / config.fs, leads });
    if (captureFiltered) filteredII[index] = filtered[II];
    if (event) events.push(event);
  }
  return { filteredII, events };
}

function measurePhase(run, resultShape) {
  run();
  const measurementsMs = [];
  let result;
  for (let i = 0; i < MEASUREMENTS; i++) {
    const started = performance.now();
    result = run();
    measurementsMs.push(performance.now() - started);
  }
  return { warmups: WARMUPS, measurementsMs, summary: summarizeTimes(measurementsMs), _result: result, ...resultShape(result) };
}

function syntheticPhaseBenchmarks() {
  const config = validateWorkload({ fs: 500, notchHz: 50 });
  const signals = materializeSignals(config);
  const fixture = materializedPipelineRun(signals, config, { captureFiltered: true });
  const eventIndexes = fixture.events.map((event) => Math.round(event.t * config.fs));
  const pt = measurePhase(
    () => delineateWaves(fixture.filteredII, config.fs, eventIndexes),
    (waves) => ({
      events: waves.length,
      pWaves: waves.filter((beat) => beat.p !== null).length,
      tWaves: waves.filter((beat) => beat.t !== null).length,
    }),
  );

  const start = config.nSamples - config.fs * 10;
  const rawWindow = signals[II].subarray(start);
  const filteredWindow = fixture.filteredII.subarray(start);
  const spectrum = measurePhase(() => {
    const difference = new Float32Array(rawWindow.length);
    for (let i = 0; i < rawWindow.length; i++) difference[i] = rawWindow[i] - filteredWindow[i];
    const spectra = {
      raw: amplitudeSpectrum(rawWindow, config.fs),
      filtered: amplitudeSpectrum(filteredWindow, config.fs),
      difference: amplitudeSpectrum(difference, config.fs),
    };
    const stft = timeFrequencyAnalysis(rawWindow, filteredWindow, config.fs);
    return { spectra, stft };
  }, ({ stft }) => ({ inputWindowSeconds: 10, stftFrames: stft.frameCount, fftSize: stft.fftSize }));

  const timedDataset = spectrum._result;
  const metadata = safeSpectrumMetadata({
    origin: 'synthetic',
    catalogRecord: null,
    lead: 'II',
    alias: null,
    unit: 'mV',
    fs: config.fs,
    endIndex: config.nSamples,
    sampleCount: config.fs * 10,
    filters: { highPassHz: 0.5, notchHz: config.notchHz, notchQ: 30, notchActive: true },
  });
  const serialize = measurePhase(
    () => serializeSpectrumExport({ spectra: timedDataset.spectra, timeFrequency: timedDataset.stft, metadata }, new Date('2026-10-08T00:00:00.000Z')),
    (json) => ({ serializedBytes: Buffer.byteLength(json), schema: 'openheart3d.ecg.spectral-analysis' }),
  );

  const filterQrsMeasurements = [];
  let last = null;
  for (let i = 0; i <= MEASUREMENTS; i++) {
    const started = performance.now();
    last = materializedPipelineRun(signals, config);
    const elapsed = performance.now() - started;
    if (i > 0) filterQrsMeasurements.push(elapsed);
  }
  return {
    input: { fs: config.fs, notchHz: config.notchHz, durationSeconds: config.durationSeconds, channels: CHANNELS, samplesPerChannel: config.nSamples },
    filterQrs: {
      warmups: WARMUPS,
      measurementsMs: filterQrsMeasurements,
      summary: summarizeTimes(filterQrsMeasurements),
      events: last.events.length,
      eventSha256: createHash('sha256').update(last.events.map((event) => `${event.t}|${event.rr}|${event.latency}|${event.searchBack ? 1 : 0}\n`).join('')).digest('hex'),
    },
    delineationPT: (({ _result, ...report }) => report)(pt),
    spectralStft: (({ _result, ...report }) => report)(spectrum),
    serialization: (({ _result, ...report }) => report)(serialize),
    setup: 'Synthetic materialization and one production-pipeline replay to supply P/T and 10 s spectral inputs are outside phase timers.',
    note: 'These phase measurements use distinct contexts and are not additive; STFT/export process the application 10 s window.',
  };
}

function percentileSummary(measurements, field) {
  return summarizeTimes(measurements.map((item) => item[field]));
}

function environment(commit) {
  return {
    platform: `${os.platform()} ${os.release()}`,
    architecture: os.arch(),
    cpu: { model: os.cpus()[0]?.model ?? 'unknown', logicalProcessors: os.cpus().length },
    totalMemoryBytes: os.totalmem(),
    nodeVersion: process.version,
    v8Version: process.versions.v8,
    heapLimitBytes: getHeapStatistics().heap_size_limit,
    commit,
  };
}

async function currentCommit() {
  const { execFileSync } = await import('node:child_process');
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function workloadBenchmark({ fs, notchHz }) {
  const config = validateWorkload({ fs, notchHz });
  pipelineRun(config);
  const control = pipelineRun(config);
  let expectedDigest = null;
  const expectedCount = control.eventCount;
  const measurements = [];
  let memoryProfile = [];
  for (let i = 0; i < MEASUREMENTS; i++) {
    const result = pipelineRun(config, { collectBlocks: true, collectMemory: i === 0, hashEvents: true });
    if (result.eventCount !== expectedCount || (expectedDigest !== null && result.eventSha256 !== expectedDigest)) {
      throw new Error(`Non-deterministic event stream for fs=${fs}, notch=${notchHz}, repetition=${i + 1}`);
    }
    expectedDigest ??= result.eventSha256;
    if (i === 0) memoryProfile = result.memory;
    measurements.push({
      repetition: i + 1,
      elapsedMs: result.elapsedMs,
      samplesPerChannelPerSecond: bytesPerSecond(config.nSamples, result.elapsedMs),
      allChannelSamplesPerSecond: bytesPerSecond(config.nSamples * CHANNELS, result.elapsedMs),
      signalSecondsPerWallSecond: config.durationSeconds / (result.elapsedMs / 1000),
      events: result.eventCount,
      eventSha256: result.eventSha256,
      blockMs: result.blocksMs,
    });
  }
  return {
    fs,
    notchHz,
    durationSeconds: config.durationSeconds,
    seed: config.seed,
    channels: CHANNELS,
    samplesPerChannel: config.nSamples,
    denominator: 'samplesPerChannel counts one lead (II); allChannelSamplesPerSecond multiplies by 12.',
    warmups: WARMUPS,
    uninstrumentedControlMs: control.elapsedMs,
    instrumentationOverheadIndicativePercent: ((quantile(measurements.map((item) => item.elapsedMs), 0.5) - control.elapsedMs) / control.elapsedMs) * 100,
    controlEvents: control.eventCount,
    measuredEventSha256: expectedDigest,
    measurements,
    summary: {
      elapsedMs: summarizeTimes(measurements.map((item) => item.elapsedMs)),
      samplesPerChannelPerSecond: percentileSummary(measurements, 'samplesPerChannelPerSecond'),
      allChannelSamplesPerSecond: percentileSummary(measurements, 'allChannelSamplesPerSecond'),
      signalSecondsPerWallSecond: percentileSummary(measurements, 'signalSecondsPerWallSecond'),
      oneSecondSignalBlockMs: {
        p50Ms: quantile(measurements.flatMap((item) => item.blockMs), 0.5),
        p95Ms: quantile(measurements.flatMap((item) => item.blockMs), 0.95),
        maxMs: Math.max(...measurements.flatMap((item) => item.blockMs)),
        blockCount: measurements.reduce((sum, item) => sum + item.blockMs.length, 0),
      },
    },
    memory: {
      measuredRepetition: 1,
      sampling: 'start, every 60 s of signal, end; no forced GC',
      samples: memoryProfile,
    },
  };
}

export async function runCostBaseline() {
  const startedAtUtc = new Date().toISOString();
  const manifest = JSON.parse(await readFile(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const workloads = [];
  for (const fs of [360, 500]) {
    for (const notchHz of [50, 60]) workloads.push(workloadBenchmark({ fs, notchHz }));
  }
  const realRecords = [];
  for (const id of ['ludb/8', 'mitdb/100']) {
    const entry = manifest.records.find((item) => item.id === id);
    if (!entry) throw new Error(`Required baseline record ${id} is missing from the manifest`);
    realRecords.push(await benchmarkRealRecord(entry));
  }
  return {
    schema: 'openheart3d.ecg.operational-cost-baseline',
    version: 1,
    protocol: {
      protocol: 'B04 v1',
      startedAtUtc,
      repetitions: { warmup: WARMUPS, measured: MEASUREMENTS },
      syntheticSeed: SEED,
      notchConfigurationsHz: [50, 60],
      signalDurationSeconds: DURATION_S,
      sampling: 'accelerated sample-by-sample processing; no 30 minute wall-clock wait',
      timingsAreDeterministic: false,
      eventDigestsAreDeterministic: true,
      memorySampling: 'heapUsed, RSS, external and arrayBuffers at signal time 0, every 60 s, and end; no explicit GC',
      phaseRule: 'Decoder, filters+QRS, P/T, spectrum/STFT and serialization have independent timers; phase results are not summed into an integrated total.',
    },
    environment: environment(await currentCommit()),
    syntheticWorkloads: workloads,
    realCorpora: realRecords,
    representativePhases: syntheticPhaseBenchmarks(),
    interpretationLimits: [
      'This is a local Node/VM baseline, not an approved product budget or efficiency certification.',
      'No browser, WebGL, frame scheduling, rendering, asset decryption, or battery behavior was measured.',
      'Event emission latency is algorithmic signal-time latency and is not CPU time or display latency.',
      'Real corpus results are only LUDB 8 and MIT-BIH 100, separate examples, not a generalization claim.',
    ],
  };
}

function mainRequested() {
  return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (mainRequested()) {
  if (process.argv.slice(2).some((arg) => arg !== '--help')) {
    throw new Error('Usage: node tests/operational-baseline.mjs [--help]');
  }
  if (process.argv.includes('--help')) {
    console.log('Runs the frozen B04 Node cost baseline (1 warmup + 5 measured runs; 4 synthetic workloads; LUDB 8 and MIT-BIH 100).');
  } else {
    const report = await runCostBaseline();
    const output = path.join(repoRoot, 'docs', 'base', '11-resultados-robustez-custo.cost.json');
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      output: 'docs/base/11-resultados-robustez-custo.cost.json',
      commit: report.environment.commit,
      syntheticWorkloads: report.syntheticWorkloads.length,
      realCorpora: report.realCorpora.map((item) => item.id),
      representativePhases: Object.keys(report.representativePhases),
      wallClockSeconds: report.syntheticWorkloads.reduce((sum, item) => sum + item.summary.elapsedMs.p50, 0) / 1000,
    }, null, 2));
  }
}
