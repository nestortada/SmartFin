const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve(process.argv[2] || 'docs/performance/transactions-phase31/scroll');
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const samples = fs.readdirSync(directory).filter(file => file.endsWith('.jsonl')).map(file => {
  const sample = fs.readFileSync(path.join(directory, file), 'utf8').trim().split('\n')
    .map(line => JSON.parse(line)).find(record => record.type === 'scroll');
  if (!sample || sample.retainedTransactions <= 50 || sample.retainedTransactions !== sample.uniqueTransactions ||
    sample.visible.length < 3 || !sample.windowFocused || sample.keyguardLocked || !sample.release || !sample.hermes)
    throw new Error('Invalid progressive scroll sample: ' + file);
  return { size: sample.size, version: sample.version, retained: sample.retainedTransactions, unique: sample.uniqueTransactions,
    jsStages: sample.stages,
    viewabilityEvents: sample.visible.length, queries: sample.queries.length,
    rafP95Ms: percentile(sample.rafGapsMs, 0.95), rafMaxMs: sample.maxJsRafGapMs,
    nativeFrameP95Ms: percentile(sample.nativeFrameDurationsMs, 0.95),
    nativeFrames: sample.nativeFrameDurationsMs.length, pssPeakKb: sample.pssPeakSampledKb };
});
if (samples.length !== 6 || new Set(samples.map(sample => `${sample.size}/${sample.version}`)).size !== 6) throw new Error('Expected one sample per size/version');
const summary = { protocol: '45 seconds; 20 ADB swipes of 500ms; existing bottom overlay excluded from start point; phase 3 and 3.1; one sample per size/version; idle frames included', samples };
fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
