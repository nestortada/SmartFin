const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve(process.argv[2] || 'docs/performance/transactions-phase3/scroll');
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const samples = fs.readdirSync(directory).filter(file => file.endsWith('.jsonl')).map(file => {
  const sample = fs.readFileSync(path.join(directory, file), 'utf8').trim().split('\n')
    .map(line => JSON.parse(line)).find(record => record.type === 'scroll');
  if (!sample || sample.retainedTransactions <= 50 || sample.retainedTransactions !== sample.uniqueTransactions ||
    sample.visible.length < 3 || !sample.windowFocused || sample.keyguardLocked || !sample.release || !sample.hermes)
    throw new Error('Invalid progressive scroll sample: ' + file);
  return { size: sample.size, retained: sample.retainedTransactions, unique: sample.uniqueTransactions,
    viewabilityEvents: sample.visible.length, queries: sample.queries.length,
    rafP95Ms: percentile(sample.rafGapsMs, 0.95), rafMaxMs: sample.maxJsRafGapMs,
    nativeFrameP95Ms: percentile(sample.nativeFrameDurationsMs, 0.95),
    nativeFrames: sample.nativeFrameDurationsMs.length, pssPeakKb: sample.pssPeakSampledKb };
});
if (samples.length !== 3 || new Set(samples.map(sample => sample.size)).size !== 3) throw new Error('Expected one sample per size');
const summary = { protocol: '45 seconds; 20 ADB swipes of 500ms; existing bottom overlay excluded from start point; after only; one sample per size', samples };
fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
