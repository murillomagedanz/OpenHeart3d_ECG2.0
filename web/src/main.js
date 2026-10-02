import { LEAD_NAMES } from './ecg/leads.js';
import { SyntheticSource } from './ecg/synth.js';
import { LeadFilterBank } from './ecg/filters.js';
import { QrsDetector } from './ecg/detector.js';
import { OnlineScorer, DEFAULT_TOLERANCE_S } from './ecg/scoring.js';
import { loadRecord } from './io/wfdb.js';
import { FileSource } from './io/fileSource.js';
import { EcgPlot } from './view/ecgPlot.js';
import { Heart3D } from './view/heart3d.js';

const SYNTH_FS = 500;
const SCORER_WARMUP_S = 1.0;
const $ = (id) => document.getElementById(id);

const ui = {
  source: $('source'), record: $('record'), openFiles: $('open-files'),
  hr: $('hr'), hrv: $('hrv'), noise: $('noise'), mains: $('mains'), mainsHz: $('mains-hz'),
  viewMode: $('view-mode'), filteredOption: $('opt-filtered'), speed: $('speed'), pause: $('pause'),
  hrDetected: $('hr-detected'), rrMean: $('rr-mean'), lastQrs: $('last-qrs'), phase: $('phase'),
  recordStatus: $('record-status'), refStatus: $('ref-status'),
  banner: $('data-banner'), synthControls: $('ctl-synth'), recordControls: [$('ctl-record'), $('ctl-open')],
  recordInfo: $('record-info'), recordInfoBody: $('record-info-body'),
};

const SYNTH_BANNER = 'DADOS SINTÉTICOS — simulação didática. Não é dispositivo médico, não realiza diagnóstico. '
  + 'A animação indica sincronização temporal com eventos elétricos detectados; não representa anatomia ou força reais.';

const plot = new EcgPlot($('ecg-canvas'), SYNTH_FS);
const heart = new Heart3D($('heart-canvas'));

const state = {
  paused: false, speed: 1, viewMode: 'filtered', mainsHz: 60,
  mode: 'synthetic', source: null, filters: null, detector: null, scorer: null,
  detectionLead: LEAD_NAMES.indexOf('II'), nextBeat: 0, scoredUntil: Infinity,
  signalTime: 0, lastQrsT: null, meta: null,
};
let manifest = null;

// --- Pipeline -----------------------------------------------------------------

// Filtros, detector e traçado são reconstruídos na frequência da fonte: nada é reamostrado.
function buildPipeline(fs) {
  state.filters = new LeadFilterBank(fs, LEAD_NAMES.length, { notchHz: state.mainsHz });
  state.detector = new QrsDetector(fs);
  plot.reset(fs);
  heart.reset();
  state.lastQrsT = null;
  state.nextBeat = 0;
  if (state.scorer) state.scorer.reset();
  ui.filteredOption.textContent = `Filtrado (PA 0,5 Hz + notch ${state.mainsHz} Hz)`;
}

function useSynthetic() {
  loadSeq++; // invalida carregamentos pendentes ao voltar para a fonte sintética
  state.mode = 'synthetic';
  state.meta = null;
  state.scorer = null;
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
}

function useRecord(record, meta) {
  const src = new FileSource(record);
  state.mode = 'file';
  state.source = src;
  state.meta = meta;
  state.detectionLead = src.detectionLead;
  if (meta.mainsHz) { state.mainsHz = meta.mainsHz; ui.mainsHz.value = String(meta.mainsHz); }
  state.scorer = src.beats.length ? new OnlineScorer({ toleranceS: DEFAULT_TOLERANCE_S, ignoreBeforeS: SCORER_WARMUP_S }) : null;
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
  rows.push(row('Detecção', `${LEAD_NAMES[src.detectionLead]}${src.aliases[LEAD_NAMES[src.detectionLead]] ? ` (${src.aliases[LEAD_NAMES[src.detectionLead]]})` : ''} · notch ${state.mainsHz} Hz`));
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
    rows.push(row('Amostras ausentes', `${record.missingTotal} (sentinelas WFDB de amostra inválida) — na reprodução são preenchidas com a última amostra válida e não entram nos filtros nem no detector`));
  }
  if (meta.notes) rows.push(row('Notas', meta.notes));
  if (meta.license) rows.push(row('Licença', meta.license));
  if (meta.citation) rows.push(row('Citar', meta.citation));
  ui.recordInfo.hidden = false;
  ui.recordInfoBody.replaceChildren(...rows);
}

// --- Controles ----------------------------------------------------------------------

for (const el of [ui.hr, ui.hrv, ui.noise, ui.mains]) el.addEventListener('input', syncParams);
ui.viewMode.addEventListener('change', () => { state.viewMode = ui.viewMode.value; });
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

// --- Laço principal -------------------------------------------------------------------

const viewLabels = () => ({
  raw: 'bruto',
  filtered: `filtrado: ${state.filters.description}`,
  diff: `diferença (bruto − filtrado): ${state.filters.description}`,
});

function step() {
  const src = state.source;
  if (state.mode === 'file' && src.done) {
    // Fim do registro: recomeça do zero, com filtros e detector zerados (como uma nova reprodução).
    src.reset();
    buildPipeline(src.fs);
    return;
  }
  const s = src.next();
  const filtered = state.filters.process(s.leads);
  state.signalTime = s.t;

  // O detector vê apenas o sinal; nunca os instantes verdadeiros do gerador nem as anotações.
  const ev = state.detector.process(filtered[state.detectionLead], s.t);

  let shown = filtered;
  if (state.viewMode === 'raw') shown = s.leads;
  else if (state.viewMode === 'diff') {
    shown = new Float32Array(s.leads.length);
    for (let i = 0; i < shown.length; i++) shown[i] = s.leads[i] - filtered[i];
  }
  plot.push(shown);

  if (state.mode === 'file') {
    while (state.nextBeat < src.beats.length && src.beats[state.nextBeat] <= s.index) {
      plot.markRef(s.index - src.beats[state.nextBeat]);
      state.scorer?.addRef(src.beats[state.nextBeat] / src.fs);
      state.nextBeat++;
    }
  }

  if (ev) {
    heart.onQrs(ev.t, state.detector.rrMean);
    state.lastQrsT = ev.t;
    plot.markQrs(Math.round((s.t - ev.t) * src.fs));
    if (state.scorer && ev.t <= state.scoredUntil) state.scorer.addDet(ev.t);
  }
  state.scorer?.flush(s.t);
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
    for (let i = 0; i < nSamples; i++) step();
  }

  plot.label = viewLabels()[state.viewMode];
  plot.draw();
  heart.update(state.signalTime);

  const det = state.detector;
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
      ui.refStatus.textContent = `TP ${sc.tp} · FP ${sc.fp} · FN ${sc.fn}`
        + (sens !== null && ppv !== null ? ` · sens ${(sens * 100).toFixed(0)}% · VPP ${(ppv * 100).toFixed(0)}%` : '')
        + ` (±${DEFAULT_TOLERANCE_S * 1000} ms)`;
    } else ui.refStatus.textContent = 'sem anotações no registro';
  } else {
    ui.recordStatus.textContent = 'sintético';
    ui.refStatus.textContent = '—';
  }

  requestAnimationFrame(frame);
}

useSynthetic();
requestAnimationFrame(frame);
