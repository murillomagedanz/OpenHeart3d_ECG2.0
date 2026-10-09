import { QrsDetector } from '../src/ecg/detector.js';

// Limit only the learning contribution of high-energy emitted complexes.
export class CappedLevelDetector extends QrsDetector {
  constructor(fs, energyCap = 2) {
    super(fs);
    if (!Number.isFinite(energyCap) || energyCap < 1) {
      throw new RangeError('Energy cap must be finite and at least one');
    }
    this.energyCap = energyCap;
    this.cappedUpdates = 0;
  }

  _emit(c, weight, t, searchBack) {
    const cappedFeat = Math.min(c.maxFeat, this.energyCap * this.signalLevel);
    if (cappedFeat < c.maxFeat) this.cappedUpdates++;
    return super._emit({ ...c, maxFeat: cappedFeat }, weight, t, searchBack);
  }
}
