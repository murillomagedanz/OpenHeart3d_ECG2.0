// Research-only memory. Labels and detector decisions are never inputs.
export const SHADOW_PROTOCOL = Object.freeze({
  maxTemplates: 4, minCorrelation: 0.9, matureAfter: 3, expireS: 30,
  windowRadiusS: 0.08, updateWeight: 0.125,
});

function normalize(vector) {
  if (!vector || vector.length < 2 || !vector.every(Number.isFinite)) return null;
  const mean = vector.reduce((sum, x) => sum + x, 0) / vector.length;
  const centered = vector.map((x) => x - mean);
  const norm = Math.sqrt(centered.reduce((sum, x) => sum + x * x, 0));
  return norm > 1e-12 ? centered.map((x) => x / norm) : null;
}

export class ShadowBank {
  constructor() {
    this.templates = [];
    this.nextId = 1;
    this.lastTime = -Infinity;
    this.expired = 0;
    this.evicted = 0;
    this.gaps = 0;
  }

  notifyGap() {
    this.templates = [];
    this.gaps++;
  }

  query(vector, time) {
    if (!Number.isFinite(time) || time < this.lastTime) throw new RangeError('Shadow queries require finite times not before observations');
    const input = normalize(vector);
    if (!input) return { status: 'unavailable', templateId: null, matureBefore: false };
    const live = this.templates.filter((t) => t.lastSeen < time && time - t.lastSeen <= SHADOW_PROTOCOL.expireS);
    if (!live.length) return { status: 'cold-start', templateId: null, matureBefore: false };
    let best = null;
    let similarity = -Infinity;
    for (const t of live) {
      if (t.vector.length !== input.length) throw new Error('Shadow template dimension changed');
      const score = input.reduce((sum, x, i) => sum + x * t.vector[i], 0);
      if (score > similarity) { best = t; similarity = score; }
    }
    const matched = similarity >= SHADOW_PROTOCOL.minCorrelation;
    const matureBefore = matched && best.count >= SHADOW_PROTOCOL.matureAfter;
    return { status: matched ? matureBefore ? 'mature-match' : 'immature-match' : 'no-match',
      templateId: matched ? best.id : null, matureBefore, similarity,
      supportBefore: best.count, ageS: time - best.createdAt };
  }

  observe(vector, time) {
    if (!Number.isFinite(time) || time < this.lastTime) throw new RangeError('Shadow observations require monotonic finite emission times');
    this.lastTime = time;
    const live = this.templates.filter((t) => time - t.lastSeen <= SHADOW_PROTOCOL.expireS);
    this.expired += this.templates.length - live.length;
    this.templates = live;
    const input = normalize(vector);
    if (!input) return { status: 'unavailable', templateId: null, matureBefore: false };
    let best = null;
    let similarity = -Infinity;
    for (const t of live) {
      if (t.vector.length !== input.length) throw new Error('Shadow template dimension changed');
      const score = input.reduce((sum, x, i) => sum + x * t.vector[i], 0);
      if (score > similarity) { best = t; similarity = score; }
    }
    if (best && similarity >= SHADOW_PROTOCOL.minCorrelation) {
      const matureBefore = best.count >= SHADOW_PROTOCOL.matureAfter;
      best.vector = normalize(best.vector.map((x, i) =>
        (1 - SHADOW_PROTOCOL.updateWeight) * x + SHADOW_PROTOCOL.updateWeight * input[i]));
      best.count++;
      best.lastSeen = time;
      return { status: 'matched', templateId: best.id, matureBefore, similarity,
        supportBefore: best.count - 1, ageS: time - best.createdAt };
    }
    if (this.templates.length === SHADOW_PROTOCOL.maxTemplates) {
      this.templates.sort((a, b) => a.lastSeen - b.lastSeen || a.id - b.id);
      this.templates.shift();
      this.evicted++;
    }
    const id = this.nextId++;
    this.templates.push({ id, vector: input, count: 1, createdAt: time, lastSeen: time });
    return { status: 'created', templateId: id, matureBefore: false,
      similarity: Number.isFinite(similarity) ? similarity : null, supportBefore: 0, ageS: 0 };
  }
}
