const fs = require('node:fs');
const path = require('node:path');
const input = process.argv[2];
if (!input) throw Error('Pass the collected JSONL path');
const records = fs
  .readFileSync(input, 'utf8')
  .trim()
  .split(/\r?\n/)
  .map(line => JSON.parse(line));
if (
  records.some(record => record.type === 'failure') ||
  !records.some(record => record.type === 'complete')
)
  throw Error('Campaign did not complete successfully');
const median = values =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const start = records.find(record => record.type === 'start');
if (start?.metadata.rows !== 100000)
  throw Error('Campaign metadata does not confirm 100,000 movements');
const canonical = value =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map(key => [key, canonical(value[key])]),
      )
    : value;
const entries = [];
for (const size of [0, 100, 1000, 5000])
  for (const version of ['before', 'after']) {
    const samples = records.filter(
      record =>
        record.type === 'sample' &&
        record.sharedExpenses === size &&
        record.version === version,
    );
    if (samples.length !== 7)
      throw Error(`Expected seven samples: ${size} ${version}`);
    const reference = records.find(
      record =>
        record.type === 'sample' &&
        record.sharedExpenses === size &&
        record.version === 'before',
    );
    if (
      !reference ||
      samples.some(
        sample =>
          sample.size !== 100000 ||
          JSON.stringify(canonical(sample.summary)) !==
            JSON.stringify(canonical(reference.summary)),
      )
    )
      throw Error(
        `Financial equality or movement count not confirmed: ${size} ${version}`,
      );
    entries.push({
      sharedExpenses: size,
      version,
      medianMs: median(samples.map(s => s.milliseconds)),
      milliseconds: samples.map(s => s.milliseconds),
      queries: samples[0].queryCount,
      returnedRows: samples[0].returnedRows,
      returnedJsonCharacters: samples[0].returnedJsonCharacters,
      medianSampledPssGrowthKb: median(
        samples.map(s => s.pssPeakSampledKb - s.pssStartKb),
      ),
      pssStartKb: samples.map(s => s.pssStartKb),
      pssPeakSampledKb: samples.map(s => s.pssPeakSampledKb),
      financialEquality: true,
      summary: samples[0].summary,
      windowFocused: samples.every(s => s.windowFocused),
      screenInteractive: samples.every(s => s.screenInteractive),
      keyguardUnlocked: samples.every(s => !s.keyguardLocked),
    });
  }
const report = {
  config: start.config,
  metadata: start.metadata,
  warmups: start.warmups,
  samples: start.samples,
  target: start.target,
  pssSamplingIntervalMs: 100,
  entries,
  complete: records.find(record => record.type === 'complete'),
};
fs.writeFileSync(
  path.join(path.dirname(input), 'summary.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    entries.map(
      ({
        sharedExpenses,
        version,
        medianMs,
        queries,
        returnedRows,
        returnedJsonCharacters,
        medianSampledPssGrowthKb,
      }) => ({
        sharedExpenses,
        version,
        medianMs,
        queries,
        returnedRows,
        returnedJsonCharacters,
        medianSampledPssGrowthKb,
      }),
    ),
    null,
    2,
  ),
);
