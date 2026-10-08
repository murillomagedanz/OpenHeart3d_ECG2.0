// Usage: node tests/qrs-decay-experiment.mjs [tau-seconds=3] [record-id ...]
import { compareRecords } from './qrs-experiment.mjs';

const [tauArg = '3', ...ids] = process.argv.slice(2);
const tau = Number(tauArg);
if (!Number.isFinite(tau) || tau <= 0) throw new RangeError('tau-seconds must be finite and greater than zero');
console.log(JSON.stringify({
  experiment: 'test-only exponential signalLevel decay toward noiseLevel between candidates',
  signalDecayTauS: tau,
  ...await compareRecords(ids, { signalDecayTauS: tau }),
}, null, 2));
