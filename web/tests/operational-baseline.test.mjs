import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateWorkload, summarizeTimes } from './operational-baseline.mjs';
import { buildFunctionalReport } from './operational-functional.mjs';
import { virtualApp } from './operational-app.mjs';
import { readLocalRecord } from './validation-report.mjs';
import { loadRecord } from '../src/io/wfdb.js';

const manifest = JSON.parse(readFileSync(new URL('../data/manifest.json', import.meta.url), 'utf8'));

for (const activeMode of ['synthetic', 'file']) {
  for (const loader of ['local', 'manifest']) {
    test(`F01 VM ${loader}: truncamento preserva fonte ${activeMode} e exibe erro explícito`, async () => {
      const app = virtualApp();
      if (activeMode === 'file') {
        app.context.testRecord = (await readLocalRecord(manifest.records.find((entry) => entry.id === 'ludb/8'))).rec;
        app.context.testMeta = { id: 'ludb/8', record: '8', dbName: 'LUDB', mainsHz: 50 };
        app.run('useRecord(testRecord, testMeta)');
      }
      app.run('for (let i = 0; i < 5; i++) step()');
      const source = app.run('state.source');
      const pipeline = app.run('state.pipeline');
      const time = app.run('state.signalTime');
      const headerText = 'fixture 1 500 4\nfixture.dat 16 200';
      const data = new Int16Array([100, 100]).buffer;
      if (loader === 'local') {
        app.context.testFiles = [
          { name: 'fixture.hea', text: async () => headerText },
          { name: 'fixture.dat', arrayBuffer: async () => data },
        ];
        await app.run('loadLocalFiles(testFiles)');
      } else {
        app.context.fetch = async (url) => ({
          ok: true, text: async () => headerText, arrayBuffer: async () => data,
        });
        app.run("manifest = { records: [{ id: 'fixture', db: 'test', files: ['fixture.hea', 'fixture.dat'] }], databases: { test: { name: 'Test' } } }; ui.source.value = 'file'; ui.record.value = 'fixture'");
        await app.run("loadManifestRecord('fixture')");
      }
      assert.equal(app.run('state.source'), source);
      assert.equal(app.run('state.pipeline'), pipeline);
      assert.equal(app.run('state.signalTime'), time);
      assert.equal(app.run('state.mode'), activeMode);
      assert.equal(app.elements.get('source').value, activeMode);
      assert.equal(app.elements.get('record').value, activeMode === 'file' ? 'ludb/8' : '');
      assert.equal(app.elements.get('ctl-synth').hidden, activeMode === 'file');
      assert.equal(app.elements.get('ctl-record').hidden, activeMode === 'synthetic');
      assert.equal(app.elements.get('record-info').hidden, false);
      assert.match(app.elements.get('record-info-body').children[0].children[1].textContent, /WFDB truncado.*4.*amostras/);
    });
  }
}

for (const activeMode of ['synthetic', 'file']) {
  for (const loader of ['local', 'manifest']) {
    for (const failure of [
      { kind: 'checksum', header: 'fixture 1 500 2\nfixture.dat 16 200 16 0 100 201 0 II', message: /checksum WFDB divergente.*II/i },
      { kind: 'unit', header: 'fixture 1 500 2\nfixture.dat 16 200(0)/mmHg 16 0 100 200 0 II', message: /unidade WFDB desconhecida.*mmHg.*II/i },
    ]) {
      test(`F02 VM ${loader}: ${failure.kind} inválido preserva fonte ${activeMode} e informa recusa`, async () => {
        const app = virtualApp();
        if (activeMode === 'file') {
          app.context.testRecord = (await readLocalRecord(manifest.records.find((entry) => entry.id === 'ludb/8'))).rec;
          app.context.testMeta = { id: 'ludb/8', record: '8', dbName: 'LUDB', mainsHz: 50 };
          app.run('useRecord(testRecord, testMeta)');
        }
        app.run('for (let i = 0; i < 5; i++) step()');
        const source = app.run('state.source');
        const pipeline = app.run('state.pipeline');
        const time = app.run('state.signalTime');
        const data = new Int16Array([100, 100]).buffer;
        if (loader === 'local') {
          app.context.testFiles = [
            { name: 'fixture.hea', text: async () => failure.header },
            { name: 'fixture.dat', arrayBuffer: async () => data },
          ];
          await app.run('loadLocalFiles(testFiles)');
        } else {
          app.context.fetch = async () => ({
            ok: true, text: async () => failure.header, arrayBuffer: async () => data,
          });
          app.run("manifest = { records: [{ id: 'fixture', db: 'test', files: ['fixture.hea', 'fixture.dat'] }], databases: { test: { name: 'Test' } } }; ui.source.value = 'file'; ui.record.value = 'fixture'");
          await app.run("loadManifestRecord('fixture')");
        }
        assert.equal(app.run('state.source'), source);
        assert.equal(app.run('state.pipeline'), pipeline);
        assert.equal(app.run('state.signalTime'), time);
        assert.equal(app.run('state.mode'), activeMode);
        assert.equal(app.elements.get('source').value, activeMode);
        assert.equal(app.elements.get('record').value, activeMode === 'file' ? 'ludb/8' : '');
        assert.equal(app.elements.get('ctl-synth').hidden, activeMode === 'file');
        assert.equal(app.elements.get('ctl-record').hidden, activeMode === 'synthetic');
        assert.match(app.elements.get('record-info-body').children[0].children[1].textContent, failure.message);
      });
    }
  }
}

test('F02 VM exibe checksum ausente como não verificado', () => {
  const app = virtualApp();
  app.context.testRecord = loadRecord({
    headerText: 'fixture 1 500 2\nfixture.dat 16 100(0)/mV 16 0 100',
    files: { 'fixture.dat': new Int16Array([100, 100]).buffer },
  });
  app.context.testMeta = { id: 'fixture', record: 'fixture', dbName: 'Test', mainsHz: 50 };
  app.run('useRecord(testRecord, testMeta)');
  const checksumRow = app.elements.get('record-info-body').children
    .find((row) => row.children[0].textContent.trim() === 'Checksum WFDB:');
  assert.match(checksumRow.children[1].textContent, /não declarado \(não verificado\)/);
});

test('B04 current functional report v4 checks corrected F01/F02/F08 and leaves browser cases partial', async () => {
  const report = await buildFunctionalReport();
  assert.equal(report.schema, 'openheart3d.ecg.operational-functional-current');
  assert.equal(report.cases.length, 11);
  assert.equal(report.globalStatus, 'partial');
  const byId = new Map(report.cases.map((item) => [item.id, item]));
  assert.equal(report.version, 4);
  assert.equal(byId.get('F01').status, 'passed');
  assert.equal(byId.get('F01').evidence.truncatedThrows, true);
  assert.equal(byId.get('F01').evidence.truncatedReturnedSamples, null);
  assert.equal(byId.get('F02').status, 'passed');
  assert.equal(byId.get('F02').evidence.declaredChecksumMismatch.recordLoadRejected, true);
  assert.equal(byId.get('F02').evidence.declaredUnknownUnit.recordLoadRejected, true);
  assert.equal(byId.get('F02').evidence.absentChecksumAllowed, true);
  for (const id of ['F03', 'F04', 'F05', 'F06']) assert.equal(byId.get(id).status, 'passed', id);
  assert.equal(byId.get('F04').evidence.rrCrossesGap, false);
  assert.equal(byId.get('F06').evidence.fullyFiniteFilteredSteps, byId.get('F06').evidence.samples);
  assert.equal(report.version, 4);
  assert.equal(byId.get('F08').status, 'partial');
  assert.equal(byId.get('F08').evidence.signalTimeResetOnPipelineRebuild, true);
  assert.equal(byId.get('F08').evidence.newContextFrameReceivedOldSignalTime, false);
  assert.equal(byId.get('F08').evidence.nodeVmStatus, 'passed');
  assert.equal(byId.get('F08').evidence.switchedFile.fs, 360);
  assert.equal(byId.get('F08').evidence.switchedFile.aliasII, 'MLII');
  assert.equal(byId.get('F08').evidence.continuingSynthetic.sourcePreserved, true);
  assert.equal(byId.get('F08').evidence.continuingSynthetic.resetDidNotTriggerQrs, true);
  for (const id of ['F07', 'F09', 'F10', 'F11']) assert.equal(byId.get(id).status, 'partial', id);
  assert.match(byId.get('F10').evidence.optionalAsset, /no key lookup/);
});

test('B04 frozen functional baseline v1 retains the historical F08 failure, not current expectations', () => {
  const baseline = JSON.parse(readFileSync(new URL('../../docs/base/11-resultados-robustez-custo.functional.json', import.meta.url), 'utf8'));
  assert.equal(baseline.version, 1);
  const f08 = baseline.cases.find((item) => item.id === 'F08');
  assert.equal(f08.status, 'failed');
  assert.equal(f08.evidence.oldSignalTimeSeconds, 3.998);
  assert.equal(f08.evidence.signalTimeResetOnPipelineRebuild, false);
});

test('B04 workload and timing validators reject invalid inputs without absolute timing gates', () => {
  assert.deepEqual(validateWorkload({ fs: 360, notchHz: 60, durationSeconds: 2, seed: 1 }), {
    fs: 360, notchHz: 60, durationSeconds: 2, seed: 1, nSamples: 720,
  });
  assert.throws(() => validateWorkload({ fs: 0, notchHz: 50 }), /fs must be positive/);
  assert.throws(() => validateWorkload({ fs: 500, notchHz: 250 }), /below Nyquist/);
  assert.throws(() => validateWorkload({ fs: 500, notchHz: 50, durationSeconds: 0.001 }), /safe integer/);
  assert.deepEqual(summarizeTimes([5, 1, 4, 2, 3]), { count: 5, min: 1, p50: 3, p95: 5, max: 5 });
  assert.throws(() => summarizeTimes([]), /non-empty/);
  assert.throws(() => summarizeTimes([NaN]), /non-empty/);
});

test('F07 VM source clock pauses, resumes and changes cadence without changing fs or sample order', () => {
  const app = virtualApp();
  const source = app.run('state.source');
  app.frame(0);
  app.frame(100);
  assert.equal(app.run('state.signalIndex'), 49);
  const initialFs = app.run('state.source.fs');

  app.elements.get('pause').handlers.click();
  for (let time = 200; time <= 2100; time += 100) app.frame(time);
  assert.equal(app.run('state.signalIndex'), 49);
  assert.ok(Math.abs(app.run('state.signalTime') - 49 / 500) < 1e-12);
  app.elements.get('pause').handlers.click();
  app.frame(2200);
  assert.equal(app.run('state.signalIndex'), 99);

  const beforeHalf = app.run('state.signalIndex');
  app.elements.get('speed').value = '0.5';
  app.elements.get('speed').handlers.change();
  app.frame(2300);
  assert.equal(app.run('state.signalIndex') - beforeHalf, 25);

  const beforeOne = app.run('state.signalIndex');
  app.elements.get('speed').value = '1';
  app.elements.get('speed').handlers.change();
  app.frame(2400);
  assert.equal(app.run('state.signalIndex') - beforeOne, 50);

  const beforeDouble = app.run('state.signalIndex');
  app.elements.get('speed').value = '2';
  app.elements.get('speed').handlers.change();
  app.frame(2500);
  assert.equal(app.run('state.signalIndex') - beforeDouble, 100);
  assert.equal(app.run('state.source.fs'), initialFs);
  assert.equal(app.run('state.source'), source);
  assert.ok(Math.abs(app.run('state.signalTime') - app.run('state.signalIndex') / initialFs) < 1e-12);
});

test('F08/F10/F11 VM changes LUDB/MIT/synthetic context and survives 100 resets with procedural fallback', async () => {
  const app = virtualApp();
  const ludbEntry = manifest.records.find((entry) => entry.id === 'ludb/8');
  const mitEntry = manifest.records.find((entry) => entry.id === 'mitdb/100');
  const ludbRecord = (await readLocalRecord(ludbEntry)).rec;
  const mitRecord = (await readLocalRecord(mitEntry)).rec;
  app.context.testRecord = ludbRecord;
  app.context.testMeta = { id: ludbEntry.id, record: ludbEntry.record, dbName: 'LUDB', license: 'fixture', mainsHz: 50 };
  app.run('useRecord(testRecord, testMeta)');
  const originalPipeline = app.run('state.pipeline');
  assert.equal(app.run('state.source.index'), 0);
  assert.equal(app.run('state.source.fs'), 500);
  app.run('for (let i = 0; i < 2000; i++) step()');
  assert.equal(app.run('state.source.index'), 2000);
  const oldSignalTime = app.run('state.signalTime');
  assert.ok(Math.abs(oldSignalTime - 3.998) < 1e-12);
  let previousPipeline = originalPipeline;
  for (const notchHz of [60, 0, 50]) {
    app.elements.get('mains-hz').value = String(notchHz);
    app.elements.get('mains-hz').handlers.change();
    assert.notEqual(app.run('state.pipeline'), previousPipeline);
    assert.equal(app.run('state.source.index'), 0);
    assert.equal(app.run('state.pipeline.fs'), 500);
    assert.equal(app.run('state.pipeline.filters.notchActive'), notchHz !== 0);
    assert.equal(app.run('state.waves.n'), 0);
    assert.equal(app.run('spectrumWindow.count'), 0);
    assert.equal(app.run('state.signalIndex'), -1);
    assert.equal(app.run('state.signalTime'), 0);
    app.frame(0);
    assert.equal(app.run('heart.lastUpdate'), 0);
    previousPipeline = app.run('state.pipeline');
  }

  app.context.testRecord = mitRecord;
  app.context.testMeta = { id: mitEntry.id, record: mitEntry.record, dbName: 'MIT-BIH', license: 'fixture', mainsHz: 60 };
  app.run('useRecord(testRecord, testMeta)');
  assert.equal(app.run('state.source.fs'), 360);
  assert.equal(app.run("state.source.aliases.II"), 'MLII');
  assert.equal(app.run('state.signalTime'), 0);
  assert.equal(app.run('state.signalIndex'), -1);
  app.run('step()');
  assert.equal(app.run('state.source.index'), 1);
  app.run('useSynthetic()');
  const syntheticSource = app.run('state.source');
  assert.equal(app.run('state.mode'), 'synthetic');
  assert.equal(app.run('state.signalTime'), 0);
  assert.equal(app.run('state.source.index'), undefined);
  assert.equal(app.run('heart.modelLabel'), 'Procedural');
  await Promise.resolve();

  app.run('for (let i = 0; i < 100; i++) { useSynthetic(); step(); }');
  assert.notEqual(app.run('state.source'), syntheticSource);
  assert.equal(app.run('state.source.fs'), 500);
  assert.equal(app.run('state.pipeline.fs'), 500);
  assert.equal(app.run('state.signalIndex'), 0);
  assert.equal(app.run('state.waves.n'), 1);
  assert.equal(app.run('spectrumWindow.count'), 1);
});

test('F08 v2 continuing synthetic notch rebuild uses the next source time even while paused', () => {
  const app = virtualApp();
  app.frame(0);
  app.frame(1);
  assert.equal(app.run('state.signalIndex'), -1);
  assert.equal(app.run('accumulator'), 0.001);
  app.run('for (let i = 0; i < 2000; i++) step()');
  const source = app.run('state.source');
  const position = app.run('state.source.t');
  const previousTime = app.run('state.signalTime');
  const qrsCount = app.run('heart.qrsCount');
  assert.ok(Math.abs(position - 4) < 1e-12);
  assert.ok(Math.abs(previousTime - 3.998) < 1e-12);
  app.elements.get('pause').handlers.click();
  for (const notchHz of [50, 60, 0]) {
    app.elements.get('mains-hz').value = String(notchHz);
    app.elements.get('mains-hz').handlers.change();
    assert.equal(app.run('state.source'), source);
    assert.equal(app.run('state.source.t'), position);
    assert.equal(app.run('state.signalTime'), position);
    assert.equal(app.run('state.signalIndex'), -1);
    assert.equal(app.run('state.lastQrsT'), null);
    assert.equal(app.run('heart.qrsCount'), qrsCount);
    assert.equal(app.run('state.pipeline.detector.rr.length'), 0);
    assert.equal(app.run('state.waves.n'), 0);
    assert.equal(app.run('spectrumWindow.count'), 0);
    assert.equal(app.run('accumulator'), 0.001);
    app.frame(100);
    assert.equal(app.run('heart.lastUpdate'), position);
    assert.equal(app.run('state.source.t'), position);
  }
  app.elements.get('pause').handlers.click();
  app.frame(101);
  assert.equal(app.run('state.signalTime'), position);
  assert.equal(app.run('state.signalIndex'), 2000);
  assert.equal(app.run('state.waves.n'), 1);
  assert.equal(app.run('spectrumWindow.count'), 1);
});

test('F08 v2 paused source switches, explicit file restart and EOF rebuild clear the clock before a new sample', () => {
  const app = virtualApp();
  app.run('for (let i = 0; i < 2000; i++) step()');
  app.elements.get('pause').handlers.click();
  app.context.testRecord = {
    header: { name: 'short', nSig: 1, fs: 360, nSamples: 2, comments: [], signals: [{ description: 'MLII' }] },
    signals: [new Float32Array([0, 0])], units: [{ known: true, declared: 'mV' }],
    beats: [], checksums: [true], nSamples: 2, duration: 2 / 360,
  };
  app.context.testMeta = { id: 'short', record: 'short', dbName: 'fixture', mainsHz: 60 };
  app.run('useRecord(testRecord, testMeta)');
  assert.equal(app.run('state.signalTime'), 0);
  assert.equal(app.run('state.source.position'), 0);
  assert.equal(app.run('state.source.aliases.II'), 'MLII');
  app.frame(0);
  assert.equal(app.run('heart.lastUpdate'), 0);
  assert.equal(app.run('state.source.index'), 0);
  app.run('step(); step()');
  assert.equal(app.run('state.signalTime'), 1 / 360);
  app.run('state.source.reset(); buildPipeline(state.source.fs)');
  assert.equal(app.run('state.signalTime'), 0);
  app.frame(100);
  assert.equal(app.run('heart.lastUpdate'), 0);
  assert.equal(app.run('state.source.index'), 0);
  app.run('step(); step(); step()');
  assert.equal(app.run('pendingFileRestart'), true);
  app.frame(200);
  assert.equal(app.run('heart.lastUpdate'), 1 / 360);
  assert.equal(app.run('state.signalTime'), 0);
  assert.equal(app.run('state.signalIndex'), -1);
  assert.equal(app.run('state.source.position'), 0);
  assert.equal(app.run('state.waves.n'), 0);
  assert.equal(app.run('spectrumWindow.count'), 0);
  assert.equal(app.run('state.pipeline.detector.rr.length'), 0);
  app.frame(300);
  assert.equal(app.run('heart.lastUpdate'), 0);
  app.run('step()');
  assert.equal(app.run('state.signalTime'), 0);
  assert.equal(app.run('state.signalIndex'), 0);
  app.run('useSynthetic()');
  assert.equal(app.run('state.signalTime'), 0);
  assert.equal(app.run('state.source.t'), 0);
  app.frame(400);
  assert.equal(app.run('heart.lastUpdate'), 0);
});
