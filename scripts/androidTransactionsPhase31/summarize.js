const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = path.resolve(process.argv[2] || 'docs/performance/transactions-phase31/android');
const repository = path.resolve(__dirname, '../..');
const records = fs.readdirSync(directory).filter(file => file.endsWith('.jsonl'))
  .flatMap(file => fs.readFileSync(path.join(directory, file), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
const fingerprints = JSON.parse(fs.readFileSync(path.join(directory, 'source-fingerprints.json'), 'utf8').replace(/^\uFEFF/, ''));
for (const [file, hash] of Object.entries(fingerprints.fingerprints)) {
  if (crypto.createHash('sha256').update(fs.readFileSync(path.join(repository, file))).digest('hex') !== hash)
    throw new Error('Measured production source changed: ' + file);
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const p95 = values => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)];
const summary = [];
for (const size of [1000, 10000, 100000]) {
  for (const version of ['before', 'after']) {
    const samples = records.filter(record => record.type === 'sample' && record.size === size && record.version === version);
    if (samples.length !== 5) throw new Error(`Expected 5 samples: ${size}/${version}`);
    for (const sample of samples) {
      if (!sample.release || !sample.hermes || !sample.windowFocused || !sample.screenInteractive || sample.keyguardLocked ||
        sample.packageId !== 'com.smartfin.transactionsphase31.bench' || sample.dataset.rows !== size)
        throw new Error('Release/device/window guard failed');
      if (sample.retainedTransactions !== 50) throw new Error('Initial row limit failed');
      if (sample.afterNinePages !== 500) throw new Error('Progressive page depth failed');
      if (sample.queries.some(query => !/^\s*SELECT/i.test(query.sql))) throw new Error('Mutation inside measured query protocol');
      if (version === 'after' && sample.initialReturnedRows > 150) throw new Error('Fast path unexpectedly scanned full records');
    }
    if (new Set(samples.map(s=>s.iteration)).size !== 5) throw new Error('Duplicate sample iterations');
    const metric = field => ({ median: median(samples.map(sample => sample[field])), p95: p95(samples.map(sample => sample[field])) });
    summary.push({ size, version, initialDataMs: metric('initialDataMs'), initialPaintMs: metric('initialPaintMs'),
      initialReturnedRows: metric('initialReturnedRows'), retainedTransactions: metric('retainedTransactions'),
      // Whole sample includes filters/search and, after only, nine progressive pages.
      pssPeakSampledKb: metric('pssPeakSampledKb'), pssEndKb: metric('pssEndKb'),
      maxJsRafGapMsWholeProtocol: metric('maxJsRafGapMs'),
      nativeFrameDurationMsWholeProtocol: { median: median(samples.flatMap(s => s.nativeFrameDurationsMs)), p95: p95(samples.flatMap(s => s.nativeFrameDurationsMs)) },
      interactions: Object.fromEntries(samples[0].interactions.map(({ name }) => [name, {
        medianMs: median(samples.map(s => s.interactions.find(i => i.name === name).ms)),
        medianReturnedRows: median(samples.map(s => s.interactions.find(i => i.name === name).returnedRows)),
        medianSqlMs: median(samples.map(s => s.interactions.find(i => i.name === name).queries.reduce((sum,q)=>sum+q.sqlCursorMs,0))),
        medianNativeEncodingMs: median(samples.map(s => s.interactions.find(i => i.name === name).queries.reduce((sum,q)=>sum+q.nativeQueryMs-q.sqlCursorMs,0))),
        medianAwaitMs: median(samples.map(s => s.interactions.find(i => i.name === name).queries.reduce((sum,q)=>sum+q.queryRoundtripMs,0))),
        medianJsStageMs: Object.fromEntries(['map','searchPredicate','append','grouping'].map(stage => [stage,
          median(samples.map(s=>s.interactions.find(i=>i.name===name).stages[stage]?.ms||0))])),
        rafGapP95Ms: p95(samples.flatMap(s=>s.interactions.find(i=>i.name===name).rafGapsMs)),
      }])),
      ninePagesMs: metric('ninePagesMs'), afterNinePages: metric('afterNinePages'),
      pageRafGapMs: {median:median(samples.flatMap(s=>s.pageRafGapsMs)),p95:p95(samples.flatMap(s=>s.pageRafGapsMs)),max:Math.max(...samples.flatMap(s=>s.pageRafGapsMs))},
    });
  }
}
const functional = records.filter(record => record.type === 'functional');
if (functional.length !== 2 || functional.some(record => !record.allExact)) throw new Error('Functional guard failed');
const production = JSON.parse(fs.readFileSync(path.join(directory, 'production-package-unchanged.json'), 'utf8').replace(/^\uFEFF/, ''));
if (!production.unchanged || production.before !== production.after) throw new Error('Production package changed');
const result = { samples: 30, sourceHashesVerified: true, productionPackageUnchanged: true,
  warmups: records.filter(r=>r.type==='warmup').length,
  functionalComparisons: functional.flatMap(record => record.cases).length, summary };
fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
