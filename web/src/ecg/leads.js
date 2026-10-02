// Nomes e vetores aproximados das 12 derivações.
// Sistema de coordenadas do paciente: x = esquerda, y = inferior, z = anterior.
// Os vetores precordiais são aproximações didáticas, não medidas de um torso real.

export const LEAD_NAMES = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

// Layout padrão de 12 derivações em 4 colunas × 3 linhas.
export const LEAD_LAYOUT = [
  ['I', 'aVR', 'V1', 'V4'],
  ['II', 'aVL', 'V2', 'V5'],
  ['III', 'aVF', 'V3', 'V6'],
];

export const RHYTHM_LEAD = 'II';

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

const I = [1, 0, 0];
const II = norm([Math.cos(Math.PI / 3), Math.sin(Math.PI / 3), 0]);
const III = [II[0] - I[0], II[1] - I[1], II[2] - I[2]];
const aVR = [-(I[0] + II[0]) / 2, -(I[1] + II[1]) / 2, -(I[2] + II[2]) / 2];
const aVL = [(I[0] - III[0]) / 2, (I[1] - III[1]) / 2, (I[2] - III[2]) / 2];
const aVF = [(II[0] + III[0]) / 2, (II[1] + III[1]) / 2, (II[2] + III[2]) / 2];

export const LEAD_VECTORS = {
  I, II, III, aVR, aVL, aVF,
  V1: norm([-0.5, 0.2, 0.84]),
  V2: norm([-0.1, 0.2, 0.97]),
  V3: norm([0.3, 0.2, 0.93]),
  V4: norm([0.6, 0.25, 0.76]),
  V5: norm([0.85, 0.2, 0.5]),
  V6: norm([0.95, 0.15, 0.2]),
};

export function projectDipole(vec) {
  const out = new Float32Array(LEAD_NAMES.length);
  for (let i = 0; i < LEAD_NAMES.length; i++) {
    const l = LEAD_VECTORS[LEAD_NAMES[i]];
    out[i] = vec[0] * l[0] + vec[1] * l[1] + vec[2] * l[2];
  }
  return out;
}
