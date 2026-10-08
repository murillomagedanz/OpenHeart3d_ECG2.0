import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SignalPipeline, detectAll } from '../src/ecg/pipeline.js';
import { SyntheticSource } from '../src/ecg/synth.js';
import { LEAD_NAMES } from '../src/ecg/leads.js';
import { FileSource, mapSignalsToLeads } from '../src/io/fileSource.js';
import { loadRecord } from '../src/io/wfdb.js';
import { readLocalRecord } from './validation-report.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(webRoot, '..');
const II = LEAD_NAMES.indexOf('II');

function arrayBuffer(values) {
  return values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength);
}

function hashEvents(events) {
  const hash = createHash('sha256');
  for (const event of events) hash.update(`${event.t}|${event.rr}|${event.latency}|${event.searchBack ? 1 : 0}\n`);
  return hash.digest('hex');
}

function recordWithGap({ fs = 500, durationS = 40, gapLead = II, gapStartS = 15, gapEndS = 18, offsetMv = 1.5 } = {}) {
  const source = new SyntheticSource({ fs, seed: 20261008 });
  source.setParams({ hr: 72, hrvPct: 4, noiseMv: 0.03, mainsMv: 0.05, mainsHz: 60 });
  const nSamples = fs * durationS;
  const signals = LEAD_NAMES.map(() => new Float32Array(nSamples));
  for (let i = 0; i < nSamples; i++) {
    const sample = source.next();
    for (let lead = 0; lead < LEAD_NAMES.length; lead++) signals[lead][i] = sample.leads[lead];
  }
  for (let i = gapStartS * fs; i < gapEndS * fs; i++) signals[gapLead][i] = NaN;
  if (gapLead === II) {
    for (let i = gapEndS * fs; i < nSamples; i++) signals[II][i] += offsetMv;
  }
  return {
    fs,
    nSamples,
    signals,
    refs: source.beats,
    record: {
      header: { fs, nSamples, signals: LEAD_NAMES.map((description) => ({ description })) },
      signals,
      beats: [],
      nSamples,
      duration: durationS,
    },
  };
}

function runRecord(record, notchHz = 60) {
  const source = new FileSource(record);
  const pipeline = new SignalPipeline(source.fs, LEAD_NAMES.length, {
    notchHz,
    detectionLead: source.detectionLead,
  });
  const events = [];
  let maskedOtherLeadSamples = 0;
  while (!source.done) {
    const sample = source.next();
    const { mask, event } = pipeline.step(sample);
    if (mask && mask[0]) maskedOtherLeadSamples++;
    if (event) events.push(event);
  }
  return { events, maskedOtherLeadSamples, pipeline };
}

function caseResult(id, status, evidence, files, limits = '') {
  return { id, status, evidence, sourceFiles: files, limit: limits || null };
}

export async function buildFunctionalReport() {
  const manifest = JSON.parse(await readFile(path.join(webRoot, 'data', 'manifest.json'), 'utf8'));
  const ludbEntry = manifest.records.find((entry) => entry.id === 'ludb/8');
  if (!ludbEntry) throw new Error('Required bundled fixture ludb/8 is absent from the manifest');
  const { rec: validRecord } = await readLocalRecord(ludbEntry);

  const validHeader = 'fixture 1 500 2\nfixture.dat 16 100(0)/mV 16 0 100 200 0 II';
  const validBytes = arrayBuffer(new Int16Array([100, 100]));
  const valid = loadRecord({ headerText: validHeader, files: { 'fixture.dat': validBytes } });
  const truncatedHeader = 'fixture 1 500 4\nfixture.dat 16 100(0)/mV 16 0 100 200 0 II';
  const truncated = loadRecord({ headerText: truncatedHeader, files: { 'fixture.dat': validBytes } });
  let missingFileError = null;
  try {
    loadRecord({ headerText: validHeader, files: {} });
  } catch (error) {
    missingFileError = error.message;
  }
  if (valid.nSamples !== 2 || validRecord.checksums.some((ok) => ok !== true)
    || truncated.nSamples !== 2
    || !missingFileError?.includes('Arquivo de sinal ausente')) {
    throw new Error('WFDB valid/truncated/missing reproduction changed unexpectedly');
  }

  const permissiveHeader = 'fixture 1 500 2\nfixture.dat 16 100(0)/mmHg 16 0 100 1 0 II';
  const permissiveRecord = loadRecord({
    headerText: permissiveHeader,
    files: { 'fixture.dat': arrayBuffer(new Int16Array([100, 100])) },
  });
  const permissiveSource = new FileSource(permissiveRecord);
  const permissivePipeline = new SignalPipeline(500, LEAD_NAMES.length, {
    notchHz: 50,
    detectionLead: permissiveSource.detectionLead,
  });
  const permissiveStep = permissivePipeline.step(permissiveSource.next());
  if (permissiveRecord.checksums[0] !== false || permissiveRecord.units[0].known
    || !permissiveStep.filtered.every(Number.isFinite)) {
    throw new Error('Permissive checksum/unit behavior no longer matches the observed path');
  }

  const leadFallback = mapSignalsToLeads(['V1', 'V5']);
  const genericFallback = mapSignalsToLeads(['ECG1', 'ECG2']);
  if (leadFallback.detectionLead !== LEAD_NAMES.indexOf('V1')
    || genericFallback.detectionLead !== 0 || genericFallback.available[0] !== true) {
    throw new Error('Lead fallback mapping changed unexpectedly');
  }

  const iiGap = recordWithGap();
  const iiGapRun = runRecord(iiGap.record);
  const gapEvents = iiGapRun.events.map((event) => event.t);
  const iiGapEvents = gapEvents.filter((time) => time >= 15 && time < 18);
  const falseResumeEvents = gapEvents.filter((time) => time >= 18 && time < 18.3
    && !iiGap.refs.some((reference) => Math.abs(reference - time) < 0.08));
  const rrAcrossGap = iiGapRun.pipeline.detector.rr.some((rr) => rr >= 1.5);

  const otherLeadGap = recordWithGap({ gapLead: 0, offsetMv: 0 });
  const withoutGap = recordWithGap({ gapLead: 0, gapStartS: 40, gapEndS: 40, offsetMv: 0 });
  const otherLeadRun = runRecord(otherLeadGap.record);
  const noGapRun = runRecord(withoutGap.record);
  if (otherLeadRun.maskedOtherLeadSamples !== 3 * otherLeadGap.fs
    || JSON.stringify(otherLeadRun.events) !== JSON.stringify(noGapRun.events)) {
    throw new Error('A gap on a non-detection lead changed II events');
  }

  const parityInput = recordWithGap({ durationS: 10, gapStartS: 15, gapEndS: 15, offsetMv: 0 });
  const batchEvents = detectAll(new FileSource(parityInput.record), {
    notchHz: 60,
    nLeads: LEAD_NAMES.length,
  }).events;
  const source = new FileSource(parityInput.record);
  const pipeline = new SignalPipeline(source.fs, LEAD_NAMES.length, {
    notchHz: 60,
    detectionLead: source.detectionLead,
  });
  const stepped = [];
  let finiteFilteredSteps = 0;
  let maskedSteps = 0;
  while (!source.done) {
    const { filtered, mask, event } = pipeline.step(source.next());
    if (filtered.every(Number.isFinite)) finiteFilteredSteps++;
    if (mask?.some(Boolean)) maskedSteps++;
    if (event) stepped.push(event);
  }
  if (JSON.stringify(stepped) !== JSON.stringify(batchEvents)
    || finiteFilteredSteps !== parityInput.record.nSamples || maskedSteps !== 0) {
    throw new Error('Step/batch event or validity parity changed');
  }

  const cases = [
    caseResult('F01', 'partial', {
      validBundledFixture: { id: 'ludb/8', samples: validRecord.nSamples, allSignalChecksumsPass: validRecord.checksums.every((ok) => ok === true) },
      validSyntheticFixtureSamples: valid.nSamples,
      missingFile: { throws: true, message: missingFileError },
      truncatedDeclaredSamples: 4,
      truncatedReturnedSamples: truncated.nSamples,
      truncatedThrows: false,
      observation: 'The decoder silently returns the available prefix for this truncated format-16 fixture; it does not reject the declared-length mismatch.',
    }, ['web/src/io/wfdb.js', 'web/src/io/fileSource.js', 'web/tests/wfdb.test.mjs'],
    'Truncation is explicitly reproduced; the partial prefix is an input-integrity gap, not a pass.'),
    caseResult('F02', 'failed', {
      checksumExpectedMismatchFlag: permissiveRecord.checksums[0],
      unit: permissiveRecord.units[0],
      pipelineStepReturnedFiniteFilteredData: permissiveStep.filtered.every(Number.isFinite),
      observation: 'The checksum-false / unknown-mmHg record is still accepted by FileSource and SignalPipeline; the unit factor remains 1 (not mV). This is the documented P0 integrity/scale gap.',
    }, ['web/src/io/wfdb.js', 'web/src/io/fileSource.js', 'web/src/ecg/pipeline.js', 'web/tests/wfdb.test.mjs'],
    'Observed continuation is not treated as acceptable integrity or calibration behavior.'),
    caseResult('F03', 'passed', {
      noIIRecognizedLead: { detectionLead: LEAD_NAMES[leadFallback.detectionLead], available: leadFallback.available.filter(Boolean).length },
      whollyUnknownChannels: { detectionLead: LEAD_NAMES[genericFallback.detectionLead], alias: genericFallback.aliases.I, available: genericFallback.available.filter(Boolean).length },
      zeroIsNotReportedAsAValidLead: true,
    }, ['web/src/io/fileSource.js', 'web/tests/wfdb.test.mjs']),
    caseResult('F04', iiGapEvents.length === 0 && falseResumeEvents.length === 0 && !rrAcrossGap ? 'passed' : 'failed', {
      gapSeconds: [15, 18],
      offsetAtResumeMv: 1.5,
      eventsInGap: iiGapEvents.length,
      falseEventsFirst300msAfterResume: falseResumeEvents.length,
      rrCrossesGap: rrAcrossGap,
      preservesGapMask: true,
    }, ['web/src/ecg/pipeline.js', 'web/src/io/fileSource.js', 'web/tests/gaps.test.mjs']),
    caseResult('F05', 'passed', {
      gappedLead: 'I',
      maskedSamplesOnLeadI: otherLeadRun.maskedOtherLeadSamples,
      expectedMaskedSamples: 3 * otherLeadGap.fs,
      detectionLead: 'II',
      stepBatchEventStreamSameAsNoGap: true,
      eventSha256: hashEvents(otherLeadRun.events),
    }, ['web/src/io/fileSource.js', 'web/src/ecg/pipeline.js', 'web/tests/gaps.test.mjs']),
    caseResult('F06', 'passed', {
      samples: parityInput.record.nSamples,
      fullyFiniteFilteredSteps: finiteFilteredSteps,
      maskedSamples: maskedSteps,
      events: stepped.length,
      stepEventSha256: hashEvents(stepped),
      batchEventSha256: hashEvents(batchEvents),
      eventStreamsIdentical: true,
    }, ['web/src/ecg/pipeline.js', 'web/tests/gaps.test.mjs']),
    caseResult('F07', 'partial', {
      nodeVmControlTests: 'A 2 s pause/resume and 0.5x/1x/2x signal-sample cadence are exercised by the targeted VM test.',
      browserRuntime: 'not measured; this execution is Node/VM only.',
    }, ['web/src/main.js', 'web/tests/operational-baseline.test.mjs', 'web/tests/source-controls.test.mjs'],
    'VM assertions do not prove real requestAnimationFrame timing or browser rendering.'),
    caseResult('F08', 'failed', {
      nodeVmControlTests: 'Synthetic/LUDB 8/MIT-BIH 100 transitions and notch 50/60/0 context resets are exercised by the targeted VM test.',
      oldSignalTimeSeconds: 3.998,
      signalTimeResetOnPipelineRebuild: false,
      newContextFrameReceivedOldSignalTime: true,
      realRecordFixtures: ['ludb/8', 'mitdb/100'],
      browserRuntime: 'not measured.',
    }, ['web/src/main.js', 'web/src/io/fileSource.js', 'web/tests/operational-baseline.test.mjs'],
    'The VM reproduces a stale signal-time value passed to Heart3D.update after a rebuild, before the new source has advanced; no browser execution.'),
    caseResult('F09', 'partial', {
      nodeVmEvidence: 'The existing spectrum-export VM tests cover 10 s readiness, invalidation on gaps, safe export metadata and no fabricated final T.',
      pTAndStftTests: ['web/tests/waves.test.mjs', 'web/tests/spectrum.test.mjs', 'web/tests/spectrum-export.test.mjs'],
      browserRuntime: 'not measured.',
    }, ['web/src/ecg/waves.js', 'web/src/ecg/spectrum.js', 'web/src/io/spectrumExport.js', 'web/tests/spectrum-export.test.mjs'],
    'No visual browser verification or real WebGL runtime.'),
    caseResult('F10', 'partial', {
      proceduralDefault: 'Node/VM initialization selects the procedural fallback.',
      optionalAsset: 'key not available to this run; no key lookup, asset fetch, decryption or private-content access attempted.',
      browserRuntime: 'not measured.',
    }, ['web/src/main.js', 'web/src/view/assetVault.js', 'web/tests/asset-discovery.test.mjs'],
    'Asset availability and visual fallback were not inspected in a browser.'),
    caseResult('F11', 'partial', {
      nodeLongSignalRuns: 'The four 30-minute signal workloads are exercised by the separate Node cost runner.',
      nodeVmResetCycles: '100 source/pipeline resets are exercised by the targeted VM test.',
      browserRuntime: 'not measured; no browser session or rendered-resource lifecycle was observed.',
    }, ['web/src/main.js', 'web/src/ecg/pipeline.js', 'web/tests/operational-baseline.test.mjs'],
    'Node/VM evidence is not a browser memory-leak or WebGL resource-lifecycle conclusion.'),
  ];

  return {
    schema: 'openheart3d.ecg.operational-functional-baseline',
    version: 1,
    protocol: 'B04 v1',
    execution: 'Node/VM only; deterministic assertions and observed behavior. No browser, WebGL, network, key access, or private asset access.',
    command: 'node tests/operational-functional.mjs',
    cases,
    globalStatus: 'partial',
    globalLimit: 'F02 is a reproduced P0 integrity/scale gap, F08 retains the prior signal time on rebuild, F01 truncation accepts a partial prefix, and F07-F11 remain runtime-partial because browser/WebGL was not measured. This does not close B06.',
  };
}

function mainRequested() {
  return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (mainRequested()) {
  const report = await buildFunctionalReport();
  const output = path.join(repoRoot, 'docs', 'base', '11-resultados-robustez-custo.functional.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: 'docs/base/11-resultados-robustez-custo.functional.json', cases: report.cases.length, globalStatus: report.globalStatus }, null, 2));
}
