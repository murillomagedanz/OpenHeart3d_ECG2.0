// Anotações de delineação do LUDB: um arquivo por derivação com sequências
// `(` início, `p`/`N`/`t` pico, `)` fim. Agrupa cada tripleto em uma onda.
import { parseAnnotations } from './wfdb.js';

const KIND = { p: 'p', N: 'qrs', t: 't' };

// Retorna { p: [{on, peak, off}], qrs: [...], t: [...] } em amostras, ordenado.
// Ondas incompletas (sem início ou fim, como nas bordas do registro) ficam com
// o campo ausente = null e NÃO entram na pontuação.
export function parseDelineation(buffer) {
  const anns = parseAnnotations(buffer);
  const out = { p: [], qrs: [], t: [] };
  for (let i = 0; i < anns.length; i++) {
    const kind = KIND[anns[i].symbol];
    if (!kind) continue;
    const before = anns[i - 1]?.symbol === '(' ? anns[i - 1].sample : null;
    const after = anns[i + 1]?.symbol === ')' ? anns[i + 1].sample : null;
    out[kind].push({ on: before, peak: anns[i].sample, off: after });
  }
  return out;
}
