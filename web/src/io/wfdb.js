// Leitor WFDB (formato dos bancos do PhysioNet): cabeçalho .hea, sinais .dat e
// anotações no formato MIT (.atr e afins). Não depende de DOM: o mesmo código
// roda no navegador e nos testes em Node. Referência: WFDB Applications Guide,
// seções header(5), signal(5) e annot(5).

export const ANNOTATION_SYMBOLS = {
  1: 'N', 2: 'L', 3: 'R', 4: 'a', 5: 'V', 6: 'F', 7: 'J', 8: 'A', 9: 'S', 10: 'E',
  11: 'j', 12: '/', 13: 'Q', 14: '~', 16: '|', 18: 's', 19: 'T', 20: '*', 21: 'D',
  22: '"', 23: '=', 24: 'p', 25: 'B', 26: '^', 27: 't', 28: '+', 29: 'u', 30: '?',
  31: '!', 32: '[', 33: ']', 34: 'e', 35: 'n', 36: '@', 37: 'x', 38: 'f', 39: '(',
  40: ')', 41: 'r',
};

// Símbolos que marcam um complexo QRS (conjunto "beat" do WFDB, sem o código de aprendizado).
export const BEAT_SYMBOLS = new Set(['N', 'L', 'R', 'B', 'A', 'a', 'J', 'S', 'V', 'r', 'F', 'e', 'j', 'n', 'E', '/', 'f', 'Q']);

const SUPPORTED_FORMATS = new Set([16, 24, 32, 61, 80, 160, 212]);

export function invalidSampleValue(format) {
  switch (format) {
    case 16:
    case 61:
    case 160:
      return -32768;
    case 80:
      return -128;
    case 212:
      return -2048;
    case 24:
      return -(1 << 23);
    case 32:
      return -2147483648;
    default:
      return null;
  }
}

// --- Cabeçalho -------------------------------------------------------------

export function parseHeader(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const comments = lines.filter((l) => l.startsWith('#')).map((l) => l.slice(1).trim());
  const spec = lines.filter((l) => !l.startsWith('#'));
  if (spec.length === 0) throw new Error('Cabeçalho WFDB vazio');

  const rec = spec[0].split(/\s+/);
  const [name, nSegments] = rec[0].split('/');
  if (nSegments !== undefined) throw new Error('Registros multi-segmento não são suportados');

  const nSig = parseInt(rec[1], 10);
  const fs = rec[2] !== undefined ? parseFloat(rec[2].split('/')[0]) : 250;
  const nSamples = rec[3] !== undefined ? parseInt(rec[3], 10) : 0;
  if (!(nSig > 0) || !(fs > 0)) throw new Error(`Linha de registro inválida: "${spec[0]}"`);

  const signals = spec.slice(1, 1 + nSig).map(parseSignalLine);
  if (signals.length !== nSig) throw new Error(`Cabeçalho declara ${nSig} sinais, mas há ${signals.length} linhas`);

  return { name, nSig, fs, nSamples, baseTime: rec[4] ?? null, baseDate: rec[5] ?? null, signals, comments };
}

function parseSignalLine(line) {
  const parts = line.split(/\s+/);
  if (parts.length < 2) throw new Error(`Linha de sinal inválida: "${line}"`);

  const fmt = /^(\d+)(?:x(\d+))?(?::(-?\d+))?(?:\+(\d+))?$/.exec(parts[1]);
  if (!fmt) throw new Error(`Campo de formato inválido: "${parts[1]}"`);
  const format = parseInt(fmt[1], 10);
  const samplesPerFrame = fmt[2] ? parseInt(fmt[2], 10) : 1;
  const skew = fmt[3] ? parseInt(fmt[3], 10) : 0;
  const byteOffset = fmt[4] ? parseInt(fmt[4], 10) : 0;
  if (!SUPPORTED_FORMATS.has(format)) throw new Error(`Formato WFDB ${format} não suportado`);
  if (samplesPerFrame !== 1) throw new Error('Registros multi-frequência não são suportados');

  let gain = 200;
  let baseline = null;
  let units = 'mV';
  if (parts[2] !== undefined) {
    const g = /^([-+]?[\d.]+(?:[eE][-+]?\d+)?)(?:\(([-+]?\d+)\))?(?:\/(\S+))?$/.exec(parts[2]);
    if (!g) throw new Error(`Campo de ganho inválido: "${parts[2]}"`);
    gain = parseFloat(g[1]) || 200; // ganho 0 significa "desconhecido": o padrão WFDB é 200
    if (g[2] !== undefined) baseline = parseInt(g[2], 10);
    if (g[3] !== undefined) units = g[3];
  }
  const adcRes = parts[3] !== undefined ? parseInt(parts[3], 10) : 12;
  const adcZero = parts[4] !== undefined ? parseInt(parts[4], 10) : 0;
  const initValue = parts[5] !== undefined ? parseInt(parts[5], 10) : adcZero;
  const checksum = parts[6] !== undefined ? parseInt(parts[6], 10) : null;
  const blockSize = parts[7] !== undefined ? parseInt(parts[7], 10) : 0;
  const description = parts.slice(8).join(' ');
  if (baseline === null) baseline = adcZero;

  return { file: parts[0], format, skew, byteOffset, gain, baseline, units, adcRes, adcZero, initValue, checksum, blockSize, description };
}

// --- Sinais ----------------------------------------------------------------

function readAdcStream(buffer, format, byteOffset) {
  const bytes = new Uint8Array(buffer, byteOffset);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let n;
  let out;
  switch (format) {
    case 16:
    case 61: {
      n = bytes.length >> 1; out = new Int32Array(n);
      for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, format === 16);
      return out;
    }
    case 160: {
      n = bytes.length >> 1; out = new Int32Array(n);
      for (let i = 0; i < n; i++) out[i] = view.getUint16(i * 2, true) - 32768;
      return out;
    }
    case 80: {
      out = new Int32Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] - 128;
      return out;
    }
    case 24: {
      n = Math.floor(bytes.length / 3); out = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const v = bytes[3 * i] | (bytes[3 * i + 1] << 8) | (bytes[3 * i + 2] << 16);
        out[i] = v & 0x800000 ? v - 0x1000000 : v;
      }
      return out;
    }
    case 32: {
      n = bytes.length >> 2; out = new Int32Array(n);
      for (let i = 0; i < n; i++) out[i] = view.getInt32(i * 4, true);
      return out;
    }
    case 212: {
      // Pares de amostras de 12 bits em 3 bytes: b0 | (b1 & 0x0f) << 8 e b2 | (b1 & 0xf0) << 4.
      n = Math.floor(bytes.length / 3) * 2; out = new Int32Array(n);
      for (let i = 0, j = 0; j < n; i += 3, j += 2) {
        let a = bytes[i] | ((bytes[i + 1] & 0x0f) << 8);
        let b = bytes[i + 2] | ((bytes[i + 1] & 0xf0) << 4);
        if (a > 2047) a -= 4096;
        if (b > 2047) b -= 4096;
        out[j] = a; out[j + 1] = b;
      }
      return out;
    }
    default:
      throw new Error(`Formato WFDB ${format} não suportado`);
  }
}

// `files`: objeto { nomeDoArquivo: ArrayBuffer } com os .dat referenciados no cabeçalho.
// Retorna sinais em unidades físicas (Float32Array) e os valores ADC brutos (Int32Array).
export function decodeSignals(header, files) {
  const byFile = new Map();
  header.signals.forEach((s, i) => {
    if (!byFile.has(s.file)) byFile.set(s.file, []);
    byFile.get(s.file).push(i);
  });

  const physical = new Array(header.nSig).fill(null);
  const adc = new Array(header.nSig).fill(null);
  const missing = new Array(header.nSig).fill(0);

  for (const [file, idxs] of byFile) {
    const buffer = files[file];
    if (!buffer) throw new Error(`Arquivo de sinal ausente: ${file}`);
    const first = header.signals[idxs[0]];
    const stream = readAdcStream(buffer, first.format, first.byteOffset);
    const perSignal = Math.floor(stream.length / idxs.length);
    const n = header.nSamples > 0 ? Math.min(perSignal, header.nSamples) : perSignal;

    idxs.forEach((sigIdx, k) => {
      const s = header.signals[sigIdx];
      const sentinel = invalidSampleValue(s.format);
      const raw = new Int32Array(n);
      const phys = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        const streamIndex = (j + s.skew) * idxs.length + k;
        const v = streamIndex < stream.length ? stream[streamIndex] : sentinel;
        raw[j] = v;
        if (v === sentinel) {
          phys[j] = NaN;
          missing[sigIdx]++;
        } else {
          phys[j] = (v - s.baseline) / s.gain;
        }
      }
      adc[sigIdx] = raw;
      physical[sigIdx] = phys;
    });
  }
  return { physical, adc, missing };
}

// Soma de 16 bits de todos os valores ADC, comparada ao checksum do cabeçalho.
export function verifyChecksums(header, adc) {
  return header.signals.map((s, i) => {
    if (s.checksum === null || !adc[i]) return null;
    let sum = 0;
    for (let j = 0; j < adc[i].length; j++) sum = (sum + adc[i][j]) & 0xffff;
    return sum === (s.checksum & 0xffff);
  });
}

// --- Anotações -------------------------------------------------------------

const SKIP = 59, NUM = 60, SUB = 61, CHN = 62, AUX = 63;

export function parseAnnotations(buffer) {
  const bytes = new Uint8Array(buffer);
  const anns = [];
  let pos = 0;
  let time = 0;
  let chan = 0;
  let num = 0;
  const read16 = () => { const v = bytes[pos] | (bytes[pos + 1] << 8); pos += 2; return v; };

  while (pos + 1 < bytes.length) {
    let word = read16();
    if (word === 0) break; // fim do arquivo
    let code = word >> 10;
    while (code === SKIP) {
      // Intervalo longo: as duas palavras seguintes formam um inteiro de 32 bits (alta primeiro).
      const hi = read16();
      const lo = read16();
      time += (hi << 16) | lo;
      word = read16();
      code = word >> 10;
    }
    time += word & 0x3ff;
    const ann = { sample: time, code, symbol: ANNOTATION_SYMBOLS[code] ?? '', subtype: 0, chan, num, aux: null };

    while (pos + 1 < bytes.length) {
      const w = bytes[pos] | (bytes[pos + 1] << 8);
      const c = w >> 10;
      if (c < NUM) break; // próxima anotação
      pos += 2;
      if (c === NUM) { num = w & 0x3ff; ann.num = num; }
      else if (c === SUB) { ann.subtype = (w & 0xff) > 127 ? (w & 0xff) - 256 : w & 0xff; }
      else if (c === CHN) { chan = w & 0x3ff; ann.chan = chan; }
      else if (c === AUX) {
        const len = w & 0xff;
        ann.aux = String.fromCharCode(...bytes.subarray(pos, pos + len)).replace(/\0+$/, '');
        pos += len + (len & 1);
      }
    }
    anns.push(ann);
  }
  return anns;
}

// --- Conveniência ----------------------------------------------------------

// headerText: conteúdo do .hea; files: { nome: ArrayBuffer }; annotations: ArrayBuffer ou null.
export function loadRecord({ headerText, files, annotations = null }) {
  const header = parseHeader(headerText);
  const { physical, adc, missing } = decodeSignals(header, files);
  const checksums = verifyChecksums(header, adc);
  const anns = annotations ? parseAnnotations(annotations) : [];
  const beats = anns.filter((a) => BEAT_SYMBOLS.has(a.symbol)).map((a) => a.sample);
  const nSamples = physical[0] ? physical[0].length : 0;
  const missingTotal = missing.reduce((sum, n) => sum + n, 0);
  return { header, signals: physical, adc, missing, missingTotal, checksums, annotations: anns, beats, nSamples, duration: nSamples / header.fs };
}
