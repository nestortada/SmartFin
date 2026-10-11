const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve(__dirname, '../../docs/performance/transactions-phase31');
const data = JSON.parse(fs.readFileSync(path.join(directory, 'node-comparison.json'), 'utf8'));
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const summary = [];
for (const size of [1000,10000,100000]) for (const mode of ['before','after']) {
  const interactions = {};
  for (const name of ['initial','combinedFilters','oldSearch','absentSearch','absentExtension','reset']) {
    const samples = data.results.filter(r=>r.size===size&&r.mode===mode&&r.name===name);
    if (samples.length!==5 || samples.some(s=>!s.exact)) throw new Error('Missing/exactness check failed');
    interactions[name] = { medianMs:median(samples.map(s=>s.milliseconds)), medianReturnedRows:median(samples.map(s=>s.returnedRows)),
      medianHeapDeltaBytes:median(samples.map(s=>s.heapDeltaBytes)), retained:samples[0].retained };
  }
  summary.push({size,mode,interactions});
}
const result = { runtime:data.runtime, warmups:data.warmups, samplesPerCase:data.samples, gcAvailable:data.gcAvailable, summary };
fs.writeFileSync(path.join(directory,'node-summary.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
