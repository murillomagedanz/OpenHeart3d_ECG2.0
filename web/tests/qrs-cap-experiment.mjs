// Usage: node tests/qrs-cap-experiment.mjs [energy-cap=2] [record-id ...]
import { compareRecords } from './qrs-experiment.mjs';
import { CappedLevelDetector } from './qrs-capped-level.mjs';

const [capArg = '2', ...ids] = process.argv.slice(2);
const cap = Number(capArg);
// Validate before loading data.
new CappedLevelDetector(360, cap);
console.log(JSON.stringify({
  experiment: 'test-only cap on high-energy contribution to signalLevel',
  energyCap: cap,
  ...await compareRecords(ids, { detectorFactory: (fs) => new CappedLevelDetector(fs, cap) }),
}, null, 2));
