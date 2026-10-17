const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const directory = path.resolve(
  __dirname,
  '../../docs/performance/shared-commands',
);
const median = values =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function summarize(samples, versionKey) {
  const groups = new Map();
  for (const sample of samples) {
    const key = [
      sample.size,
      sample.shared,
      sample[versionKey],
      sample.operation,
    ].join('/');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }
  return [...groups.values()].map(group => ({
    size: group[0].size,
    shared: group[0].shared,
    version: group[0][versionKey],
    operation: group[0].operation,
    samples: group.length,
    medianMs: median(group.map(s => s.milliseconds)),
    transactionMs: median(group.map(s => s.transactionMs ?? 0)),
    reads: median(group.map(s => s.reads)),
    rows: median(group.map(s => s.rows ?? s.returnedRows)),
    characters: median(group.map(s => s.characters ?? s.returnedCharacters)),
    milliseconds: group.map(s => s.milliseconds),
    ...(group[0].nativeQueryMs === undefined
      ? {}
      : {
          nativeQueryMs: median(group.map(s => s.nativeQueryMs)),
          sqlCursorMs: median(group.map(s => s.sqlCursorMs)),
        }),
  }));
}
const before = JSON.parse(
  fs.readFileSync(path.join(directory, 'node-before.json'), 'utf8'),
);
const after = JSON.parse(
  fs.readFileSync(path.join(directory, 'node-after.json'), 'utf8'),
);
if (before.financial.length !== 72 || after.financial.length !== 72)
  throw Error('All four campaigns must have 18 exact financial checkpoints');
if (JSON.stringify(before.financial) !== JSON.stringify(after.financial))
  throw Error('Node financial oracle differs or is incomplete');
for (const [file, hash] of Object.entries(after.fingerprints)) {
  if (
    createHash('sha256')
      .update(fs.readFileSync(path.join(__dirname, '../../src', file)))
      .digest('hex') !== hash
  )
    throw Error(
      'Node benchmark does not match current production source: ' + file,
    );
}
const node = summarize(
  [
    ...before.samples.map(s => ({ ...s, version: 'before' })),
    ...after.samples.map(s => ({ ...s, version: 'after' })),
  ],
  'version',
);
const readJsonl = file =>
  fs
    .readFileSync(file, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map(line => JSON.parse(line));
const androidDirectory = path.join(directory, 'android/release');
const androidFingerprints = JSON.parse(
  fs.readFileSync(
    path.join(androidDirectory, 'command-fingerprints.json'),
    'utf8',
  ),
);
for (const [file, hash] of Object.entries(androidFingerprints.fingerprints)) {
  if (
    createHash('sha256')
      .update(fs.readFileSync(path.join(__dirname, '../..', file)))
      .digest('hex') !== hash
  )
    throw Error(
      'Physical APK does not match current production source: ' + file,
    );
}
const files = fs
  .readdirSync(androidDirectory)
  .filter(name => name.endsWith('-operations.jsonl'));
const androidRecords = files.flatMap(name =>
  readJsonl(path.join(androidDirectory, name)),
);
const originalRecords = readJsonl(
  path.join(directory, 'exploratory/android-six-fields-partial.jsonl'),
);
const originalSamples = originalRecords.filter(
  r => r.type === 'sample' && r.version === 'before',
);
if (originalSamples.length !== 72)
  throw Error('Physical original 1k/10k measurements incomplete');
if (androidRecords.filter(r => r.type === 'sample').length !== 108)
  throw Error('Final physical measurements incomplete');
if (!androidRecords.some(record => record.type === 'complete'))
  throw Error('Android campaign incomplete');
if (androidRecords.some(record => record.type === 'failure'))
  throw Error('Android campaign failed');
const android = summarize(
  [
    ...originalSamples,
    ...androidRecords.filter(record => record.type === 'sample'),
  ],
  'version',
);
fs.writeFileSync(
  path.join(directory, 'comparison.json'),
  JSON.stringify(
    {
      nodeRuntime: before.runtime,
      nodeSQLite: after.sqlite,
      nodeExactCheckpoints: before.financial.length,
      androidConfig: androidRecords.find(record => record.type === 'start')
        .config,
      androidValidation: androidRecords.filter(record =>
        ['binary64-pass', 'complete'].includes(record.type),
      ),
      androidFunctionalValidation: readJsonl(
        path.join(
          androidDirectory,
          fs
            .readdirSync(androidDirectory)
            .find(name => name.endsWith('-verify3.jsonl')),
        ),
      ),
      androidPreparation: readJsonl(
        path.join(
          androidDirectory,
          fs
            .readdirSync(androidDirectory)
            .find(name => name.endsWith('-prepare.jsonl')),
        ),
      ),
      node,
      android,
    },
    null,
    2,
  ),
);
after.comparedOriginalCheckpoints = 72;
after.financialComparisonComplete = true;
after.financialClock = after.financialClock || after.measuredAt;
delete after.measuredAt;
fs.writeFileSync(
  path.join(directory, 'node-after.json'),
  JSON.stringify(after),
);
console.log('PASS: exact Node oracle and completed physical Android campaign');
