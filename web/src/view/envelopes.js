// Envelopes de contração comandados pelos eventos detectados no ECG. Sem DOM nem Three.js:
// o mesmo código roda no navegador (heart3d.js) e nos testes.

export const VENT_RISE = 0.08;
export const VENT_HOLD = 0.2;
export const VENT_FALL = 0.25;
export const ATRIAL_LEAD = 0.16; // PR aproximado: átrio contrai ~160 ms antes do R
export const ATRIAL_DUR = 0.12;
export const ATRIAL_RISE = ATRIAL_DUR * 0.4;
export const ATRIAL_FALL = ATRIAL_DUR * 0.6;

// Trapézio 0→1→0: sobe em `rise`, segura por `hold`, desce em `fall`. dt = tempo desde o evento.
export function envelope(dt, rise, hold, fall) {
  if (dt < 0) return 0;
  if (dt < rise) return dt / rise;
  if (dt < rise + hold) return 1;
  if (dt < rise + hold + fall) return 1 - (dt - rise - hold) / fall;
  return 0;
}

export function smooth(e) { return e * e * (3 - 2 * e); }

// Instante de um clipe de animação para o envelope: a subida percorre [0, peak] (pose
// relaxada → contraída), a sustentação fica em `peak`, a descida percorre [peak, duration]
// (volta ao relaxado, pela trajetória que o autor animou). Fora da janela o clipe fica em 0
// (pose relaxada). O clipe nunca avança sozinho: é o ECG que posiciona o tempo.
export function clipTime(dt, rise, hold, fall, peak, duration) {
  if (!(dt >= 0) || dt >= rise + hold + fall) return 0;
  if (dt < rise) return peak * smooth(dt / rise);
  if (dt < rise + hold) return peak;
  return peak + (duration - peak) * smooth((dt - rise - hold) / fall);
}
