// Pontuação de ondas P/T delineadas contra anotações de referência (LUDB).
// Pareamento guloso em ordem temporal por pico, tolerância de ±150 ms como no
// artigo do LUDB; erro = detecção − anotação, em ms (positivo = tardio).

export const WAVE_TOLERANCE_S = 0.15;

// refs/dets: [{ on, peak, off }] em amostras, ordenados por pico.
// span: [lo, hi] em amostras; só detecções com pico no intervalo contam como FP.
export function matchWaves(refs, dets, fs, span, toleranceS = WAVE_TOLERANCE_S) {
  const tol = toleranceS * fs;
  const r = refs.filter((w) => w.on != null && w.off != null).sort((a, b) => a.peak - b.peak);
  const d = dets.filter((w) => w.peak >= span[0] && w.peak <= span[1]).sort((a, b) => a.peak - b.peak);
  const errors = { on: [], peak: [], off: [] };
  let i = 0;
  let j = 0;
  let tp = 0;
  while (i < r.length && j < d.length) {
    const diff = d[j].peak - r[i].peak;
    if (Math.abs(diff) <= tol) {
      tp++;
      errors.on.push(((d[j].on - r[i].on) / fs) * 1000);
      errors.peak.push((diff / fs) * 1000);
      errors.off.push(((d[j].off - r[i].off) / fs) * 1000);
      i++; j++;
    } else if (diff < 0) j++;
    else i++;
  }
  return { tp, fp: d.length - tp, fn: r.length - tp, errors };
}

export function summarizeMs(values) {
  const n = values.length;
  if (!n) return { n: 0, mean: 0, sd: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { n, mean, sd };
}
