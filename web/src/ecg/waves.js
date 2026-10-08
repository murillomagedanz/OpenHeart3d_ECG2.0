// DelineaÃ§Ã£o de ondas P e T por algoritmo (docs/specs/001, D16).
//
// Os marcadores resultantes sÃ£o ESTIMATIVAS do algoritmo, somente para exibiÃ§Ã£o
// e pontuaÃ§Ã£o contra anotaÃ§Ãµes pÃºblicas: nÃ£o alimentam o coraÃ§Ã£o 3D (D1) nem
// tÃªm interpretaÃ§Ã£o clÃ­nica. A mesma funÃ§Ã£o nÃºcleo (`delineatePair`) serve ao
// relatÃ³rio em lote e Ã  interface em tempo real, entÃ£o o que se mede Ã© o que se
// exibe. Quando a onda nÃ£o Ã© discernÃ­vel devolve `null`, nunca um valor forÃ§ado.
//
// Todos os Ã­ndices sÃ£o amostras absolutas na frequÃªncia nativa (sem reamostrar).

export const DEFAULT_WAVE_PARAMS = {
  smoothS: 0.03,        // mÃ©dia mÃ³vel centrada (zero-fase) para localizar picos
  rRefineS: 0.04,       // refino do R do detector: mÃ¡ximo |x| nesta vizinhanÃ§a
  qrsSlopeFrac: 0.1,    // limites do QRS: fraÃ§Ã£o da inclinaÃ§Ã£o mÃ¡xima
  qrsMaxHalfS: 0.12,    // alcance mÃ¡ximo do QRS a cada lado do R
  tStartS: 0.03,        // inÃ­cio da janela T apÃ³s o fim do QRS
  tMaxEndS: 0.6,        // fim da janela T, no mÃ¡ximo, apÃ³s o R anterior
  tRrFrac: 0.7,         // ... ou esta fraÃ§Ã£o do RR
  pMaxBackS: 0.32,      // inÃ­cio da janela P, no mÃ¡ximo, antes do R
  pEndGapS: 0.02,       // a janela P termina antes do inÃ­cio do QRS
  minWindowS: 0.05,
  marginS: 0.015,       // o pico precisa ser interior Ã  janela
  minAmpP: 0.02,        // piso absoluto de amplitude (unidade do sinal, mV)
  minAmpT: 0.03,
  noiseK: 3,            // limiar = max(piso, noiseK Ã— ruÃ­do de alta frequÃªncia)
  edgeFrac: 0.1,        // inÃ­cio/fim da onda: fraÃ§Ã£o da amplitude do pico
};

const MAD_TO_SIGMA = 1.4826;

function movingAverage(x, n) {
  const half = n >> 1;
  const out = new Float64Array(x.length);
  const cum = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) cum[i + 1] = cum[i] + x[i];
  for (let i = 0; i < x.length; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(x.length - 1, i + half);
    out[i] = (cum[b + 1] - cum[a]) / (b - a + 1);
  }
  return out;
}

function median(a) {
  if (!a.length) return 0;
  const s = Float64Array.from(a).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function refineR(xs, r, rad) {
  let best = r;
  let bestV = -1;
  for (let i = Math.max(0, r - rad); i <= Math.min(xs.length - 1, r + rad); i++) {
    const v = Math.abs(xs[i]);
    if (v > bestV) { bestV = v; best = i; }
  }
  return best;
}

// Limites do QRS por inclinaÃ§Ã£o, em Ã­ndices do segmento.
function qrsBounds(xs, r, fs, p) {
  const d = (i) => (xs[Math.min(xs.length - 1, i + 1)] - xs[Math.max(0, i - 1)]) / 2;
  const half = Math.round(p.qrsMaxHalfS * fs);
  const near = Math.round(0.06 * fs);
  let iPre = r;
  let iPost = r;
  let mPre = 0;
  let mPost = 0;
  for (let i = Math.max(1, r - near); i <= r; i++) if (Math.abs(d(i)) > mPre) { mPre = Math.abs(d(i)); iPre = i; }
  for (let i = r; i <= Math.min(xs.length - 2, r + near); i++) if (Math.abs(d(i)) > mPost) { mPost = Math.abs(d(i)); iPost = i; }
  const maxSlope = Math.max(mPre, mPost);
  const thr = p.qrsSlopeFrac * maxSlope;
  const hold = Math.max(1, Math.round(0.01 * fs));
  let on = iPre;
  for (let i = iPre, below = 0; i > Math.max(1, r - half); i--) {
    if (Math.abs(d(i)) > thr) { below = 0; on = i; } else if (++below >= hold) break;
  }
  let off = iPost;
  for (let i = iPost, below = 0; i < Math.min(xs.length - 2, r + half); i++) {
    if (Math.abs(d(i)) > thr) { below = 0; off = i; } else if (++below >= hold) break;
  }
  return { on, off };
}

// Procura uma onda em [i0, i1]: linha de base linear entre as bordas, pico =
// mÃ¡ximo |desvio| interior (permite onda invertida), limiar acima do ruÃ­do.
function findWave(xs, i0, i1, fs, minAmp, noise, p) {
  if (i1 - i0 < Math.round(p.minWindowS * fs)) return null;
  const margin = Math.max(1, Math.round(p.marginS * fs));
  const a = xs[i0];
  const b = xs[i1];
  const dev = (i) => xs[i] - (a + ((b - a) * (i - i0)) / (i1 - i0));
  let k = i0;
  let amp = 0;
  for (let i = i0; i <= i1; i++) if (Math.abs(dev(i)) > amp) { amp = Math.abs(dev(i)); k = i; }
  if (k - i0 < margin || i1 - k < margin) return null;
  if (amp < Math.max(minAmp, p.noiseK * noise)) return null;
  const sign = Math.sign(dev(k));
  const level = p.edgeFrac * amp;
  let on = k;
  while (on > i0 && sign * dev(on - 1) > level && sign * dev(on - 1) <= sign * dev(on) + 1e-12) on--;
  if (on > i0) on--; // primeira amostra jÃ¡ abaixo da fraÃ§Ã£o
  let off = k;
  while (off < i1 && sign * dev(off + 1) > level && sign * dev(off + 1) <= sign * dev(off) + 1e-12) off++;
  if (off < i1) off++;
  return { on, peak: k, off, amp: sign * amp };
}

// x: janela contÃ­gua (Float32Array/Float64Array) cujo Ã­ndice 0 Ã© a amostra
// absoluta x0. rPrev pode ser null (primeiro batimento). Devolve:
//   { r, qrsOn, qrsOff, p }   para o batimento atual (P Ã© da onda que o antecede);
//   { prev: { r, qrsOn, qrsOff, t } } quando rPrev existe (T do batimento anterior).
// Qualquer NaN (lacuna) na janela usada â†’ ondas null.
export function delineatePair(x, x0, fs, rPrev, rCur, params = DEFAULT_WAVE_PARAMS) {
  const p = { ...DEFAULT_WAVE_PARAMS, ...params };
  const empty = { r: rCur, qrsOn: null, qrsOff: null, p: null, prev: rPrev == null ? null : { r: rPrev, qrsOn: null, qrsOff: null, t: null } };
  const S = (s) => Math.round(s * fs);
  const lo = Math.max(x0, (rPrev ?? rCur - S(0.5)) - S(0.15));
  const hi = Math.min(x0 + x.length - 1, rCur + S(0.15));
  if (hi - lo < S(0.3)) return empty;
  const seg = x.subarray(lo - x0, hi - x0 + 1);
  for (let i = 0; i < seg.length; i++) if (!Number.isFinite(seg[i])) return empty;
  const xs = movingAverage(seg, Math.max(1, S(p.smoothS)) | 1);
  const noise = (() => {
    const res = new Float64Array(seg.length);
    for (let i = 0; i < seg.length; i++) res[i] = seg[i] - xs[i];
    const m = median(res);
    for (let i = 0; i < res.length; i++) res[i] = Math.abs(res[i] - m);
    return median(res) * MAD_TO_SIGMA;
  })();

  const rad = S(p.rRefineS);
  const cur = refineR(xs, rCur - lo, rad);
  const curQ = qrsBounds(xs, cur, fs, p);
  const out = { r: cur + lo, qrsOn: curQ.on + lo, qrsOff: curQ.off + lo, p: null, prev: null };

  let tEnd = null;
  if (rPrev != null) {
    const prev = refineR(xs, rPrev - lo, rad);
    const prevQ = qrsBounds(xs, prev, fs, p);
    out.prev = { r: prev + lo, qrsOn: prevQ.on + lo, qrsOff: prevQ.off + lo, t: null };
    const rr = cur - prev;
    const tStart = prevQ.off + S(p.tStartS);
    tEnd = Math.min(prev + Math.min(S(p.tMaxEndS), Math.round(p.tRrFrac * rr)), curQ.on - S(p.pEndGapS));
    const w = findWave(xs, tStart, tEnd, fs, p.minAmpT, noise, p);
    if (w) out.prev.t = { on: w.on + lo, peak: w.peak + lo, off: w.off + lo, amp: w.amp };
  }
  const pStart = Math.max(cur - S(p.pMaxBackS), tEnd ?? 0, 0);
  const pEnd = curQ.on - S(p.pEndGapS);
  const w = findWave(xs, pStart, pEnd, fs, p.minAmpP, noise, p);
  if (w) out.p = { on: w.on + lo, peak: w.peak + lo, off: w.off + lo, amp: w.amp };
  return out;
}

// Em lote: `filtered` = sinal filtrado de uma derivaÃ§Ã£o (NaN em amostras
// invÃ¡lidas), `rIdxs` = amostras dos R detectados (ordenadas). Para cada
// batimento devolve { r, qrsOn, qrsOff, p, t }. O T do Ãºltimo batimento fica
// null (em tempo real sÃ³ se conhece o T ao chegar o QRS seguinte).
export function delineateWaves(filtered, fs, rIdxs, params = DEFAULT_WAVE_PARAMS) {
  const beats = rIdxs.map((r) => ({ r, qrsOn: null, qrsOff: null, p: null, t: null }));
  for (let i = 0; i < rIdxs.length; i++) {
    const d = delineatePair(filtered, 0, fs, i > 0 ? rIdxs[i - 1] : null, rIdxs[i], params);
    beats[i].r = d.r; beats[i].qrsOn = d.qrsOn; beats[i].qrsOff = d.qrsOff; beats[i].p = d.p;
    if (i > 0 && d.prev) {
      beats[i - 1].t = d.prev.t;
      if (beats[i - 1].qrsOn == null) { beats[i - 1].qrsOn = d.prev.qrsOn; beats[i - 1].qrsOff = d.prev.qrsOff; }
    }
  }
  return beats;
}

// Tempo real: acumula o sinal filtrado de UMA derivaÃ§Ã£o num buffer circular e,
// a cada QRS detectado (`onQrs(samplesAgo)`), delineia o P do batimento atual e
// o T do anterior com a mesma `delineatePair`. Amostra invÃ¡lida entra como NaN.
export class WaveTracker {
  constructor(fs, { params = DEFAULT_WAVE_PARAMS, bufferS = 4 } = {}) {
    this.fs = fs;
    this.params = params;
    this.cap = Math.round(bufferS * fs);
    this.buf = new Float32Array(this.cap);
    this.n = 0;             // amostras absolutas jÃ¡ recebidas
    this.lastR = null;      // R anterior (absoluto)
    this.reset();
  }

  reset() {
    this.buf.fill(0);
    this.n = 0;
    this.lastR = null;
  }

  push(value, valid = true) {
    this.buf[this.n % this.cap] = valid ? value : NaN;
    this.n++;
  }

  // Janela contÃ­gua mais recente e seu offset absoluto.
  _window() {
    const len = Math.min(this.n, this.cap);
    const x0 = this.n - len;
    const w = new Float32Array(len);
    for (let i = 0; i < len; i++) w[i] = this.buf[(x0 + i) % this.cap];
    return { w, x0 };
  }

  // Retorna null ou { p, prevT, r, prevR } em amostras ATRÃS do instante atual
  // (samplesAgo: 0 = a amostra mais recente), prontas para marcadores.
  onQrs(samplesAgo) {
    const rAbs = this.n - 1 - Math.round(samplesAgo);
    const { w, x0 } = this._window();
    const rPrev = this.lastR != null && this.lastR - x0 >= 0 && rAbs > this.lastR ? this.lastR : null;
    const d = delineatePair(w, x0, this.fs, rPrev, rAbs, this.params);
    this.lastR = d.r;
    const ago = (i) => this.n - 1 - i;
    const wave = (o) => (o ? { on: ago(o.on), peak: ago(o.peak), off: ago(o.off), amp: o.amp } : null);
    return { r: ago(d.r), p: wave(d.p), prevT: wave(d.prev?.t) };
  }
}
