import { LEAD_NAMES } from './ecg/leads.js';
import { SyntheticSource } from './ecg/synth.js';
import { SignalPipeline } from './ecg/pipeline.js';
import { SpectrumWindow, summarizeFilterBands } from './ecg/spectrum.js';
import { OnlineScorer, DEFAULT_TOLERANCE_S } from './ecg/scoring.js';
import { loadRecord } from './io/wfdb.js';
import { FileSource } from './io/fileSource.js';
import { safeSpectrumMetadata } from './io/spectrumExport.js';
import { WaveTracker } from './ecg/waves.js';
import { EcgPlot } from './view/ecgPlot.js';
import { SpectrumPlot } from './view/spectrumPlot.js';
import { SpectrumExportControl } from './view/spectrumExportControl.js';
import { Heart3D } from './view/heart3d.js';
import { loadRuntimeAsset, isDevHost } from './view/assetVault.js';

const SYNTH_FS = 500;
const SCORER_WARMUP_S = 1.0;
const $ = (id) => document.getElementById(id);

const ui = {
  source: $('source'), record: $('record'), openFiles: $('open-files'),
  hr: $('hr'), hrv: $('hrv'), noise: $('noise'), mains: $('mains'), mainsHz: $('mains-hz'),
  showWaves: $('show-waves'), viewMode: $('view-mode'), filteredOption: $('opt-filtered'), speed: $('speed'), pause: $('pause'),
  hrDetected: $('hr-detected'), rrMean: $('rr-mean'), lastQrs: $('last-qrs'), phase: $('phase'),
  recordStatus: $('record-status'), refStatus: $('ref-status'),
  banner: $('data-banner'), synthControls: $('ctl-synth'), recordControls: [$('ctl-record'), $('ctl-open')],
  recordInfo: $('record-info'), recordInfoBody: $('record-info-body'),
  modelLabel: $('model-label'), autoRotate: $('auto-rotate'), xray: $('xray'),
  clipOn: $('clip-on'), clipAxis: $('clip-axis'), clipPos: $('clip-pos'),
  spectrumCanvas: $('spectrum-canvas'), spectrumStatus: $('spectrum-status'),
  spectrumMetrics: $('spectrum-metrics'),
};

const SYNTH_BANNER = 'DADOS SINTÉTICOS — simulação didática. Não é dispositivo médico, não realiza diagnóstico. '
  + 'A animação indica sincronização temporal com eventos elétricos detectados; não representa anatomia ou força reais.';

const plot = new EcgPlot($('ecg-canvas'), SYNTH_FS);
const spectrumWindow = new SpectrumWindow(SYNTH_FS);
const spectrumPlot = new SpectrumPlot(ui.spectrumCanvas, ui.spectrumStatus, ui.spectrumMetrics);
const spectrumExport = new SpectrumExportControl($('spectrum-export'), $('spectrum-export-status'));
const heart = new Heart3D($('heart-canvas'));
let spectrumMode = 'frequency';

const state = {
  paused: false, speed: 1, viewMode: 'filtered', mainsHz: 60,
  mode: 'synthetic', source: null, pipeline: null, scorer: null,
  detectionLead: LEAD_NAMES.indexOf('II'), nextBeat: 0, scoredUntil: Infinity,
  signalTime: 0, signalIndex: -1, lastQrsT: null, meta: null,
  lastPass: null, // escore fechado da última reprodução completa do registro
};
let manifest = null;
let latestSpectrum = null;
let latestTimeFrequency = null;
let latestBandMetrics = null;
let latestExportMetadata = null;
let lastSpectrumVersion = -1;
let lastSpectrumAt = 0;
let pendingFileRestart = false;

// --- Pipeline -----------------------------------------------------------------

// Filtros, detector e traçado são reconstruídos na frequência da fonte: nada é
// reamostrado. O SignalPipeline é o mesmo usado pelo benchmark em dados reais.
function buildPipeline(fs) {
  pendingFileRestart = false;
  state.pipeline = new SignalPipeline(fs, LEAD_NAMES.length, { notchHz: state.mainsHz, detectionLead: state.detectionLead });
  plot.reset(fs);
  state.waves = new WaveTracker(fs);
  spectrumWindow.reset(fs);
  latestSpectrum = null;
  latestTimeFrequency = null;
  latestBandMetrics = null;
  latestExportMetadata = null;
  spectrumExport.setDataset(null);
  state.signalIndex = -1;
  // Arquivos reiniciam; notch sintético mantém a fonte na próxima amostra.
  state.signalTime = state.mode === 'file' ? state.source.position : state.source.t;
  lastSpectrumVersion = -1;
  lastSpectrumAt = 0;
  heart.reset();
  state.lastQrsT = null;
  state.nextBeat = 0;
  if (state.scorer) state.scorer.reset();
  ui.filteredOption.textContent = `Filtrado (PA 0,5 Hz + notch ${state.mainsHz} Hz${state.pipeline.filters.notchActive ? '' : ' desativado: fs baixa'})`;
}

function useSynthetic() {
  loadSeq++; // invalida carregamentos pendentes ao voltar para a fonte sintética
  state.mode = 'synthetic';
  state.meta = null;
  state.scorer = null;
  state.lastPass = null;
  state.scoredUntil = Infinity;
  state.source = new SyntheticSource({ fs: SYNTH_FS });
  state.detectionLead = LEAD_NAMES.indexOf('II');
  syncParams();
  plot.setLeads({});
  buildPipeline(SYNTH_FS);
  ui.banner.textContent = SYNTH_BANNER;
  ui.banner.classList.remove('real');
  ui.synthControls.hidden = false;
  for (const el of ui.recordControls) el.hidden = true;
  ui.recordInfo.hidden = true;
  syncSourceControls();
}

function useRecord(record, meta) {
  const src = new FileSource(record);
  state.mode = 'file';
  state.source = src;
  state.meta = meta;
  state.detectionLead = src.detectionLead;
  if (meta.mainsHz) { state.mainsHz = meta.mainsHz; ui.mainsHz.value = String(meta.mainsHz); }
  state.scorer = src.beats.length ? new OnlineScorer({ toleranceS: DEFAULT_TOLERANCE_S, ignoreBeforeS: SCORER_WARMUP_S }) : null;
  state.lastPass = null;
  // Bancos como o LUDB não anotam o ciclo incompleto do fim: não pontuar detecções depois disso.
  state.scoredUntil = src.beats.length ? src.beats.at(-1) / src.fs + DEFAULT_TOLERANCE_S : Infinity;
  plot.setLeads({ available: src.available, aliases: src.aliases, rhythmLead: src.detectionLead, hasReference: src.beats.length > 0 });
  buildPipeline(src.fs);

  ui.banner.textContent = `DADOS REAIS — ${meta.dbName}, registro ${meta.record} (${meta.license ?? 'licença: ver fonte'}). `
    + 'Uso didático e de pesquisa: não é dispositivo médico e não realiza diagnóstico. Rótulos exibidos são os do banco de dados, '
    + 'não inferências deste software. A animação indica sincronização temporal com eventos detectados; não representa anatomia ou força reais.';
  ui.banner.classList.add('real');
  ui.synthControls.hidden = true;
  for (const el of ui.recordControls) el.hidden = false;
  renderRecordInfo(record, src, meta);
  syncSourceControls();
}

function syncSourceControls() {
  const synthetic = state.mode === 'synthetic';
  ui.source.value = synthetic ? 'synthetic' : 'file';
  ui.record.value = synthetic ? '' : state.meta.id;
  ui.synthControls.hidden = !synthetic;
  for (const el of ui.recordControls) el.hidden = synthetic;
}

// --- Parâmetros da fonte sintética ----------------------------------------------

function syncParams() {
  if (state.mode !== 'synthetic') return;
  state.source.setParams({
    hr: Number(ui.hr.value),
    hrvPct: Number(ui.hrv.value),
    noiseMv: Number(ui.noise.value),
    mainsMv: Number(ui.mains.value),
    mainsHz: state.mainsHz,
  });
  $('hr-val').textContent = ui.hr.value;
  $('hrv-val').textContent = ui.hrv.value;
  $('noise-val').textContent = Number(ui.noise.value).toFixed(2);
  $('mains-val').textContent = Number(ui.mains.value).toFixed(2);
}

// --- Carregamento de registros -------------------------------------------------------

async function fetchOk(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar ${url}`);
  return res;
}

async function loadManifest() {
  manifest = await (await fetchOk('data/manifest.json')).json();
  ui.record.innerHTML = '';
  for (const r of manifest.records) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.bundled ? r.title : `${r.title} — requer npm run fetch-data`;
    ui.record.appendChild(opt);
  }
}

let loadSeq = 0;

async function loadManifestRecord(id) {
  const entry = manifest.records.find((r) => r.id === id);
  const db = manifest.databases[entry.db];
  const base = `data/records/${entry.db}/`;
  const heaName = entry.files.find((f) => f.endsWith('.hea'));
  const token = ++loadSeq;
  showInfo(`Carregando ${entry.id}…`);
  try {
    const headerText = await (await fetchOk(base + heaName)).text();
    const files = {};
    await Promise.all(entry.files.filter((f) => f !== heaName).map(async (f) => {
      files[f] = await (await fetchOk(base + f)).arrayBuffer();
    }));
    if (token !== loadSeq) return; // o usuário já escolheu outro registro enquanto este baixava
    const annotations = entry.annotations ? files[entry.annotations] : null;
    const record = loadRecord({ headerText, files, annotations });
    if (entry.annotations && record.beats.length === 0) {
      console.warn(`${entry.id}: ${entry.annotations} tem ${annotations?.byteLength ?? 0} bytes e nenhum batimento reconhecido`);
    }
    useRecord(record, { ...entry, dbName: db.name, dbUrl: db.url, license: db.license, mainsHz: db.mainsHz, citation: db.citation });
  } catch (err) {
    if (token !== loadSeq) return;
    syncSourceControls();
    showInfo(`Não foi possível carregar ${entry.id}: ${err.message}. `
      + 'Se o registro não estiver em web/data/records/, execute `npm run fetch-data` dentro de web/ — ou abra os arquivos pelo seletor ao lado.');
  }
}

const ANNOTATION_EXTENSIONS = ['atr', 'qrs', 'ecg', 'ii', 'i', 'v5', 'v1', 'man', 'ari'];

async function loadLocalFiles(fileList) {
  const list = [...fileList];
  const hea = list.find((f) => f.name.toLowerCase().endsWith('.hea'));
  if (!hea) { showInfo('Selecione o arquivo .hea junto com o(s) .dat (e as anotações, se houver).'); return; }
  const token = ++loadSeq;
  try {
    const headerText = await hea.text();
    if (token !== loadSeq) return;
    const files = {};
    for (const f of list) if (f !== hea) {
      const data = await f.arrayBuffer();
      if (token !== loadSeq) return;
      files[f.name] = data;
    }
    const base = hea.name.slice(0, -4);
    const annName = ANNOTATION_EXTENSIONS.map((e) => `${base}.${e}`).find((n) => files[n]) ?? null;
    const record = loadRecord({ headerText, files, annotations: annName ? files[annName] : null });
    if (token !== loadSeq) return;
    useRecord(record, {
      id: `local/${base}`, record: base, title: `Arquivo local ${base}`, dbName: 'arquivo local', license: null,
      mainsHz: null, annotations: annName, datasetLabels: '', notes: 'Registro aberto do disco; proveniência e licença são responsabilidade de quem forneceu os arquivos.',
    });
  } catch (err) {
    if (token !== loadSeq) return;
    syncSourceControls();
    showInfo(`Falha ao abrir os arquivos: ${err.message}`);
  }
}

// --- Painel "Sobre o registro" ----------------------------------------------------

function showInfo(text) {
  ui.recordInfo.hidden = false;
  ui.recordInfo.open = true;
  ui.recordInfoBody.replaceChildren(row('Estado', text));
}

function row(label, value) {
  const div = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = `${label}: `;
  div.append(b, value instanceof Node ? value : document.createTextNode(String(value)));
  return div;
}

function renderRecordInfo(record, src, meta) {
  const h = record.header;
  const rows = [];
  if (meta.dbUrl) {
    const a = document.createElement('a');
    a.href = meta.dbUrl; a.target = '_blank'; a.rel = 'noopener'; a.textContent = meta.dbName;
    rows.push(row('Banco', a));
  } else rows.push(row('Banco', meta.dbName));
  rows.push(row('Registro', `${h.name} · ${h.fs} Hz · ${record.nSamples} amostras · ${record.duration.toFixed(1)} s · ${h.nSig} sinal(is)`));
  const mapped = LEAD_NAMES.map((n, i) => (src.available[i] ? (src.aliases[n] ? `${n}←${src.aliases[n]}` : n) : null)).filter(Boolean);
  rows.push(row('Derivações', mapped.join(', ') + (src.unmapped.length ? ` · não mapeados: ${src.unmapped.map((u) => u.description).join(', ')}` : '')));
  rows.push(row('Detecção', `${LEAD_NAMES[src.detectionLead]}${src.aliases[LEAD_NAMES[src.detectionLead]] ? ` (${src.aliases[LEAD_NAMES[src.detectionLead]]})` : ''} · ${state.pipeline.filters.description}`));
  const nonMv = record.units.map((u, i) => ({ u, name: h.signals[i].description || `sinal ${i}` })).filter(({ u }) => u.declared !== 'mV' || !u.known);
  if (nonMv.length) {
    rows.push(row('Unidades', nonMv.map(({ u, name }) => (u.known
      ? `${name}: ${u.declared} → mV (×${u.scaleToMv})`
      : `${name}: "${u.declared}" DESCONHECIDA — exibida sem conversão; a escala em mV não vale para este sinal`)).join(' · ')));
  }
  if (meta.datasetLabels) rows.push(row('Rótulos do banco (não são inferências deste software)', meta.datasetLabels));
  if (h.comments.length) rows.push(row('Comentários do cabeçalho', h.comments.join(' · ')));
  if (record.beats.length) {
    const symbols = {};
    for (const a of record.annotations) symbols[a.symbol || '␀'] = (symbols[a.symbol || '␀'] ?? 0) + 1;
    rows.push(row('Anotações', `${meta.annotations}: ${record.beats.length} batimentos de referência · símbolos ${Object.entries(symbols).map(([s, n]) => `${s}×${n}`).join(' ')}`));
  } else if (meta.annotations) {
    rows.push(row('Anotações', `${meta.annotations} foi lido, mas nenhum batimento foi reconhecido (${record.annotations.length} anotações) — sem referência para pontuar`));
  } else rows.push(row('Anotações', 'nenhuma anotação de batimento — sem referência para pontuar o detector'));
  const ck = record.checksums.map((ok, i) => `${h.signals[i].description || i}:${ok === null ? '—' : ok ? 'ok' : 'FALHA'}`).join(' ');
  rows.push(row('Checksum WFDB', ck));
  if (record.missingTotal) {
    rows.push(row('Amostras ausentes', `${record.missingTotal} (sentinelas WFDB de amostra inválida) — aparecem como vãos no traçado; filtros e detector não avançam nelas e são re-armados quando o sinal volta`));
  }
  if (meta.notes) rows.push(row('Notas', meta.notes));
  if (meta.license) rows.push(row('Licença', meta.license));
  if (meta.citation) rows.push(row('Citar', meta.citation));
  ui.recordInfo.hidden = false;
  ui.recordInfoBody.replaceChildren(...rows);
}

// --- Controles ----------------------------------------------------------------------

for (const el of [ui.hr, ui.hrv, ui.noise, ui.mains]) el.addEventListener('input', syncParams);
ui.showWaves.addEventListener('change', () => { plot.showWaves = ui.showWaves.checked; });
ui.viewMode.addEventListener('change', () => {
  state.viewMode = ui.viewMode.value;
  plot.setMode(state.viewMode); // o traçado guarda bruto e filtrado: redesenha o histórico no novo modo
});
for (const button of document.querySelectorAll('[data-spectrum-mode]')) {
  button.addEventListener('click', () => {
    spectrumMode = button.dataset.spectrumMode;
    for (const option of document.querySelectorAll('[data-spectrum-mode]')) {
      option.setAttribute('aria-pressed', String(option === button));
    }
    lastSpectrumVersion = -1;
    lastSpectrumAt = -Infinity;
    spectrumExport.setDataset(null);
  });
}
ui.speed.addEventListener('change', () => { state.speed = Number(ui.speed.value); });
ui.pause.addEventListener('click', () => {
  state.paused = !state.paused;
  ui.pause.textContent = state.paused ? 'Retomar' : 'Pausar';
});
ui.mainsHz.addEventListener('change', () => {
  state.mainsHz = Number(ui.mainsHz.value);
  if (state.mode === 'file') state.source.reset();
  buildPipeline(state.source.fs);
  syncParams();
  // O painel do registro mostra o notch em uso; atualiza-o junto com o pipeline.
  if (state.mode === 'file') renderRecordInfo(state.source.record, state.source, state.meta);
});
ui.source.addEventListener('change', async () => {
  if (ui.source.value === 'synthetic') { useSynthetic(); return; }
  const token = ++loadSeq;
  for (const el of ui.recordControls) el.hidden = false;
  ui.synthControls.hidden = true;
  if (!manifest) {
    try {
      await loadManifest();
      if (token !== loadSeq) return;
    } catch (err) {
      if (token !== loadSeq) return;
      syncSourceControls();
      showInfo(`Manifesto indisponível: ${err.message}`);
      return;
    }
  }
  const firstBundled = manifest.records.find((r) => r.bundled) ?? manifest.records[0];
  ui.record.value = firstBundled.id;
  await loadManifestRecord(firstBundled.id);
});
ui.record.addEventListener('change', () => loadManifestRecord(ui.record.value));
ui.openFiles.addEventListener('change', () => loadLocalFiles(ui.openFiles.files));

// --- Coração 3D: vistas, camadas, raio-X e corte (filtros de exibição, não medidas) ----

for (const btn of document.querySelectorAll('#heart-tools [data-view]')) {
  btn.addEventListener('click', () => heart.setView(btn.dataset.view));
}
ui.autoRotate.addEventListener('change', () => heart.setAutoRotate(ui.autoRotate.checked));
for (const cb of document.querySelectorAll('#heart-layers [data-layer]')) {
  cb.addEventListener('change', () => heart.setLayerVisible(cb.dataset.layer, cb.checked));
}
for (const sl of document.querySelectorAll('#heart-layers [data-layer-opacity]')) {
  sl.addEventListener('input', () => heart.setLayerOpacity(sl.dataset.layerOpacity, Number(sl.value) / 100));
}
ui.xray.addEventListener('change', () => heart.setXray(ui.xray.checked));
const syncClip = () => heart.setClip({ enabled: ui.clipOn.checked, axis: ui.clipAxis.value, position: Number(ui.clipPos.value) / 100 });
ui.clipOn.addEventListener('change', syncClip);
ui.clipAxis.addEventListener('change', syncClip);
ui.clipPos.addEventListener('input', syncClip);

// Modelo anatômico opcional: só existe cifrado no repositório. Sem chave, nada acontece e
// o procedural segue como modelo padrão. O GLB decifrado fica apenas em memória.
async function loadOptionalModel() {
  const asset = await loadRuntimeAsset();
  if (!asset) return;
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(asset.buffer, '', resolve, reject));
    heart.setModel(gltf);
    ui.modelLabel.textContent = heart.modelLabel;
    ui.modelLabel.title = heart.hasAnimatedModel ? 'clipes de animação com o tempo posicionado pelo ECG (nunca autoplay)' : '';
  } catch (err) {
    if (isDevHost()) console.info('[calib] modelo opcional não carregado; segue o procedural:', err.message);
  }
}

// --- Laço principal -------------------------------------------------------------------

const viewLabels = () => ({
  raw: 'bruto',
  filtered: `filtrado: ${state.pipeline.filters.description}`,
  diff: `diferença (bruto − filtrado): ${state.pipeline.filters.description}`,
});

function step() {
  const src = state.source;
  if (state.mode === 'file' && src.done) {
    // Fim do registro: fecha a contagem (referências ainda à espera viram FN,
    // detecções sem par viram FP), guarda o resultado da passagem completa e
    // recomeça do zero, com filtros e detector zerados (como uma nova reprodução).
    if (state.scorer) {
      state.scorer.flush(Infinity);
      state.lastPass = state.scorer.snapshot();
    }
    pendingFileRestart = true;
    return false;
  }
  const s = src.next();
  // Mesmo passo de processamento do benchmark: amostras inválidas (sentinelas
  // WFDB) não são medidas — filtros e detector não avançam nelas, o início da
  // lacuna fecha a candidata aberta, a retomada re-arma tudo e o traçado mostra
  // um vão. O detector vê apenas o sinal; nunca os instantes verdadeiros do
  // gerador nem as anotações.
  const { filtered, mask, event: ev } = state.pipeline.step(s);
  state.signalTime = s.t;
  state.signalIndex = s.index ?? Math.round(s.t * src.fs);

  plot.push(s.leads, filtered, mask);
  state.waves.push(filtered[state.detectionLead], !(mask && mask[state.detectionLead]));
  spectrumWindow.push(
    s.leads[state.detectionLead],
    filtered[state.detectionLead],
    Boolean(mask && mask[state.detectionLead]),
  );

  if (state.mode === 'file') {
    while (state.nextBeat < src.beats.length && src.beats[state.nextBeat] <= s.index) {
      plot.markRef(s.index - src.beats[state.nextBeat]);
      state.scorer?.addRef(src.beats[state.nextBeat] / src.fs);
      state.nextBeat++;
    }
  }

  if (ev) {
    // A animação começa no instante da detecção (s.t); ev.t (R retroativo) fica
    // para a marca no traçado, o painel e a previsão do próximo ciclo.
    heart.onQrs(s.t, state.pipeline.detector.rrMean, ev.t);
    state.lastQrsT = ev.t;
    const qrsAgo = Math.round((s.t - ev.t) * src.fs);
    plot.markQrs(qrsAgo);
    const wv = state.waves.onQrs(qrsAgo);
    if (wv?.p) plot.markWave('P', wv.p.peak);
    if (wv?.prevT) plot.markWave('T', wv.prevT.peak);
    if (state.scorer && ev.t <= state.scoredUntil) state.scorer.addDet(ev.t);
  }
  if (state.scorer) {
    // Uma referência só vira FN depois do pior atraso possível do detector (search-back).
    state.scorer.maxLatencyS = state.pipeline.detector.maxLatency;
    state.scorer.flush(s.t);
  }
}

let lastFrame = performance.now();
let accumulator = 0;

function frame(now) {
  const dtReal = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  if (!state.paused) {
    const fs = state.source.fs;
    accumulator += dtReal * state.speed;
    const nSamples = Math.floor(accumulator * fs);
    accumulator -= nSamples / fs;
    for (let i = 0; i < nSamples; i++) {
      if (step() === false) {
        accumulator += (nSamples - i) / fs;
        break;
      }
    }
  }

  plot.label = viewLabels()[state.viewMode];
  plot.draw();
  const leadName = LEAD_NAMES[state.detectionLead];
  const alias = state.source.aliases?.[leadName];
  const signalIndex = state.mode === 'file' ? state.source.mapping[state.detectionLead] : -1;
  const declaredUnit = signalIndex >= 0 ? state.source.record.units[signalIndex] : null;
  if (spectrumWindow.full && spectrumWindow.version !== lastSpectrumVersion
    && (pendingFileRestart || now - lastSpectrumAt >= 250)) {
    latestSpectrum = spectrumWindow.analyze();
    const filters = {
      highPassHz: 0.5,
      notchHz: state.mainsHz,
      notchQ: 30,
      notchActive: state.pipeline.filters.notchActive,
    };
    latestBandMetrics = summarizeFilterBands(latestSpectrum, filters);
    latestExportMetadata = safeSpectrumMetadata({
      origin: state.mode === 'synthetic' ? 'synthetic' : 'real',
      catalogRecord: state.mode === 'file' ? manifest?.records.find((r) => r.id === state.meta.id) : null,
      lead: leadName, alias, fs: state.source.fs,
      unit: !declaredUnit || declaredUnit.known ? 'mV' : declaredUnit.declared,
      endIndex: state.signalIndex + 1, sampleCount: latestSpectrum.raw.sampleCount, filters,
    });
    latestTimeFrequency = spectrumMode === 'time-frequency' ? spectrumWindow.analyzeTimeFrequency() : null;
    lastSpectrumVersion = spectrumWindow.version;
    lastSpectrumAt = now;
  }
  if (!spectrumWindow.full) {
    latestSpectrum = null;
    latestTimeFrequency = null;
    latestBandMetrics = null;
    latestExportMetadata = null;
  }
  spectrumExport.setDataset(latestSpectrum && latestExportMetadata ? {
    metadata: latestExportMetadata, spectra: latestSpectrum,
    timeFrequency: spectrumMode === 'time-frequency' ? latestTimeFrequency : null,
  } : null, spectrumWindow.invalidated);
  spectrumPlot.setContext({
    source: state.mode === 'synthetic' ? 'Sintética' : `Real · ${state.meta?.record ?? 'registro'}`,
    lead: alias ? `${leadName} (${alias})` : leadName,
    fs: state.source.fs,
    unit: !declaredUnit || declaredUnit.known ? 'mV' : declaredUnit.declared || 'unidade desconhecida',
    filterDescription: state.pipeline.filters.description,
  });
  spectrumPlot.draw(latestSpectrum, latestTimeFrequency, latestBandMetrics, {
    ready: spectrumWindow.full,
    invalidated: spectrumWindow.invalidated,
    paused: state.paused,
    mode: spectrumMode,
  });
  heart.update(state.signalTime);

  const det = state.pipeline.detector;
  const hr = det.heartRate;
  ui.hrDetected.textContent = hr ? `${hr.toFixed(0)} bpm` : '—';
  ui.rrMean.textContent = det.rrMean ? `${(det.rrMean * 1000).toFixed(0)} ms` : '—';
  ui.lastQrs.textContent = state.lastQrsT != null ? `t = ${state.lastQrsT.toFixed(2)} s` : '—';
  ui.phase.textContent = heart.phaseLabel;

  if (state.mode === 'file') {
    const src = state.source;
    ui.recordStatus.textContent = `${state.meta.record} · ${src.position.toFixed(1)} / ${src.duration.toFixed(1)} s`;
    if (state.scorer) {
      const sc = state.scorer;
      const sens = sc.sensitivity, ppv = sc.ppv;
      const pct = (v) => `${(v * 100).toFixed(0)}%`;
      let text = `TP ${sc.tp} · FP ${sc.fp} · FN ${sc.fn}`
        + (sens !== null && ppv !== null ? ` · sens ${pct(sens)} · VPP ${pct(ppv)}` : '')
        + ` (±${DEFAULT_TOLERANCE_S * 1000} ms)`;
      const lp = state.lastPass;
      if (lp && lp.sensitivity !== null && lp.ppv !== null) {
        text += ` · passagem completa anterior: sens ${pct(lp.sensitivity)} · VPP ${pct(lp.ppv)} (FN ${lp.fn}, FP ${lp.fp})`;
      }
      ui.refStatus.textContent = text;
    } else ui.refStatus.textContent = 'sem anotações no registro';
  } else {
    ui.recordStatus.textContent = 'sintético';
    ui.refStatus.textContent = '—';
  }

  if (pendingFileRestart) {
    state.source.reset();
    buildPipeline(state.source.fs);
  }
  requestAnimationFrame(frame);
}

useSynthetic();
ui.modelLabel.textContent = heart.modelLabel;
// O painel de estado cobre a base do quadro 3D: o coração é centralizado na área livre.
const heartStatus = $('heart-status');
new ResizeObserver(() => heart.setBottomInset(heartStatus.getBoundingClientRect().height + 10)).observe(heartStatus);
requestAnimationFrame(frame);
loadOptionalModel();
// Chave colada na barra de endereço com a página já aberta (#k=…): tenta de novo.
window.addEventListener('hashchange', () => { if (/(?:^#|[#&])k=/.test(location.hash)) loadOptionalModel(); });
if (isDevHost()) globalThis.__oh3d = { heart, state }; // inspeção em desenvolvimento (console/testes)
