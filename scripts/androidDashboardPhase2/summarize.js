const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve(
  process.argv[2] || 'docs/performance/android-phase2',
);
const files = fs.readdirSync(directory).filter(file => file.endsWith('.jsonl'));
const runs = files.flatMap(file =>
  fs
    .readFileSync(path.join(directory, file), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map(line => ({ ...JSON.parse(line), sourceFile: file })),
);
const samples = runs.filter(record => record.type === 'sample');
const functional = runs.filter(record => record.type === 'functional');
const stats = values => {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    n: sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted.at(-1),
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    values,
  };
};
const sumQueries = (record, field) =>
  record.queries.reduce((sum, query) => sum + (query[field] || 0), 0);
const groups = [];
const comparisons = [];
for (const size of [1000, 10000, 50000, 100000]) {
  const pair = {};
  for (const version of ['before', 'after']) {
    const records = samples.filter(
      record => record.size === size && record.version === version,
    );
    if (records.length !== 5)
      throw new Error(
        `Expected 5 ${version}/${size} samples; got ${records.length}`,
      );
    for (const record of records) {
      if (
        !record.release ||
        record.dev ||
        !record.hermes ||
        !record.windowFocused ||
        !record.screenInteractive ||
        record.keyguardLocked ||
        record.error ||
        !record.dataset.reused
      )
        throw new Error(
          `Invalid measurement conditions: ${record.sourceFile}/${record.iteration}`,
        );
      if (record.queries.some(query => !/^\s*SELECT/.test(query.sql)))
        throw new Error('Unexpected write during measured refresh');
      if (
        record.queries.some(query =>
          ['sqlCursorMs', 'nativeQueryMs', 'queryRoundtripMs'].some(
            field => !Number.isFinite(query[field]) || query[field] <= 0,
          ),
        )
      )
        throw new Error('Missing native or roundtrip query measurements');
    }
    const metrics = {
      sqlCursorMs: stats(
        records.map(record => sumQueries(record, 'sqlCursorMs')),
      ),
      nativeQueryAndEncodingMs: stats(
        records.map(record => sumQueries(record, 'nativeQueryMs')),
      ),
      summedQueryRoundtripMs: stats(
        records.map(record => sumQueries(record, 'queryRoundtripMs')),
      ),
      computeMs: stats(records.map(record => record.computeMs)),
      mappingMs: stats(records.map(record => record.mappingMs)),
      jsMappingAndComputeMs: stats(
        records.map(record => record.mappingMs + record.computeMs),
      ),
      dataReadyMs: stats(records.map(record => record.dataReadyMs)),
      layoutCommitMs: stats(records.map(record => record.layoutCommitMs)),
      fullRefreshMs: stats(records.map(record => record.fullRefreshMs)),
      pssEndKb: stats(records.map(record => record.pssEndKb)),
      pssPeakSampledKb: stats(records.map(record => record.pssPeakSampledKb)),
      pssDeltaKb: stats(
        records.map(record => record.pssEndKb - record.pssStartKb),
      ),
      maxJsRafGapMs: stats(records.map(record => record.maxJsRafGapMs)),
      returnedHistoryRows: stats(
        records.map(record =>
          record.queries
            .filter(query => query.sql.includes('FROM transactions'))
            .reduce((sum, query) => sum + query.returnedRows, 0),
        ),
      ),
      summedIndexRangeCandidateRows: stats(
        records.map(record => sumQueries(record, 'indexRangeCandidateRows')),
      ),
      summedMatchingTransactionRows: stats(
        records.map(record => sumQueries(record, 'matchingTransactionRows')),
      ),
      queryCount: records[0].queries.length,
    };
    const frames = records.flatMap(record => record.nativeFrameDurationsMs);
    const budget = 1000 / records[0].displayRefreshHz;
    const frameMetrics = {
      frameCount: frames.length,
      durationMs: stats(frames),
      displayRefreshHz: records[0].displayRefreshHz,
      budgetMs: budget,
      overBudgetFrames: frames.filter(duration => duration > budget).length,
    };
    pair[version] = {
      size,
      version,
      metrics,
      frameMetrics,
      summary: records[0].summary,
      dataset: records[0].dataset.name,
    };
    if (
      records.some(
        record =>
          JSON.stringify(record.summary) !== JSON.stringify(records[0].summary),
      )
    )
      throw new Error('Non-deterministic summary');
    groups.push(pair[version]);
  }
  const exact =
    JSON.stringify(pair.before.summary) === JSON.stringify(pair.after.summary);
  if (!exact || pair.before.dataset !== pair.after.dataset)
    throw new Error(`Financial or dataset mismatch at ${size}`);
  comparisons.push({
    size,
    exact,
    dataset: pair.before.dataset,
    metrics: Object.fromEntries(
      Object.keys(pair.before.metrics)
        .filter(key => key !== 'queryCount')
        .map(key => {
          const before = pair.before.metrics[key].median;
          const after = pair.after.metrics[key].median;
          return [
            key,
            {
              before,
              after,
              changePercent: before === 0 ? null : (after / before - 1) * 100,
            },
          ];
        }),
    ),
  });
}
if (
  functional.length !== 2 ||
  functional.some(
    record =>
      !record.allExact ||
      !record.release ||
      !record.hermes ||
      record.cases.length !== 6 ||
      record.cases.some(
        item => JSON.stringify(item.before) !== JSON.stringify(item.after),
      ),
  )
)
  throw new Error('Functional edge-case validation failed or missing');
for (const record of [
  ...samples,
  ...functional.flatMap(run =>
    run.cases.map(item => ({ summary: item.after })),
  ),
]) {
  const summary = record.summary;
  if (
    summary.availableBalance !== 3100 ||
    summary.totalDebt !== 1000 ||
    summary.netWorth !== 7100
  )
    throw new Error('Synthetic account balance or net worth mismatch');
}
const empty = functional.find(record => record.size === 0);
const edges = functional.find(record => record.size === 80);
if (
  !empty ||
  !edges ||
  empty.cases.some(item =>
    [
      'monthlyIncome',
      'monthlyExpenses',
      'monthlySavings',
      'recentTransactionCount',
    ].some(key => item.after[key] !== 0),
  )
)
  throw new Error('Empty-history validation failed');
const inflow = edges.transferRows.find(row => row.direction === 'inflow');
const outflow = edges.transferRows.find(row => row.direction === 'outflow');
if (
  edges.transferRows.length !== 2 ||
  !inflow ||
  !outflow ||
  inflow.status !== 'posted' ||
  outflow.status !== 'posted' ||
  inflow.count !== 4 ||
  outflow.count !== 4 ||
  inflow.amount !== outflow.amount
)
  throw new Error('Synthetic transfer pair validation failed');
const report = {
  environment: JSON.parse(
    fs.readFileSync(path.join(directory, 'preflight.json'), 'utf8'),
  ),
  methodology: {
    warmups: 2,
    measuredIterations: 5,
    p95Method: 'nearest-rank; with 5 samples p95 equals maximum',
    preparationInSeparateProcess: true,
    nativeSqlMetric:
      'rawQuery + moveToFirst + moveToNext; excludes row encoding',
    fullRefreshMetric:
      'refreshKey trigger through summary commit plus two requestAnimationFrame callbacks',
    pssIntervalMs: 100,
    visitedSqliteVmRowsMeasured: false,
  },
  allFinancialResultsExact: true,
  samples: samples.length,
  functionalChecks: functional.flatMap(record => record.cases).length,
  groups,
  comparisons,
  functional,
};
fs.writeFileSync(
  path.join(directory, 'summary.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(comparisons, null, 2));
