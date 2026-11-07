'use strict';
// Phase 1a.4B r2 — offline analysis of the attempt-b Android evidence against the Node diagnostic. Reads files only and
// writes docs/validacion-fase1a4b/r2/analysis-b.json (never overwrites). The APK compares traces index by index; Android
// runs one extra statement per reset (DELETE FROM "android_metadata": that table exists only on Android), which shifts
// every later index. Here the traces are aligned by dropping exactly those statements (listed and counted, never hidden);
// every remaining field is compared without normalization.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'docs/validacion-fase1a4b/r2/analysis-b.json');
if (process.argv.length !== 2) throw Error('No arguments');
if (fs.existsSync(output)) throw Error('Analysis exists; review and delete it explicitly before regenerating');
const android = JSON.parse(fs.readFileSync(path.join(root, 'docs/validacion-fase1a4b/r2/android-b/api24/phase1a4b-r2-editamount/result.json'), 'utf8'));
const node = JSON.parse(fs.readFileSync(path.join(root, 'docs/validacion-fase1a4b/r2/node/diagnostic.json'), 'utf8'));
const evidence = name => android.cases.find(entry => entry.name === name).evidence;
const FIELDS = ['stage', 'kind', 'verb', 'table', 'sql', 'paramTypes', 'outcome', 'directRows', 'triggerRows', 'counterDelta',
  'revisionBefore', 'revisionAfter', 'inTransactionBefore', 'transaction'];
const ANDROID_ONLY = event => event.table === 'android_metadata';
function align(a, n) {
  const dropped = a.filter(ANDROID_ONLY).map(event => ({seq: event.seq, sql: event.sql, outcome: event.outcome, directRows: event.directRows,
    counterDelta: event.counterDelta, error: event.error ?? null}));
  const kept = a.filter(event => !ANDROID_ONLY(event));
  const differences = [];
  for (let i = 0; i < Math.max(kept.length, n.length); i++) {
    const x = kept[i], y = n[i];
    if (!x || !y) { differences.push({index: i, missingIn: x ? 'node' : 'android', sql: (x ?? y).sql}); continue; }
    const fields = FIELDS.filter(field => JSON.stringify(x[field]) !== JSON.stringify(y[field]));
    if (fields.length) differences.push({index: i, androidSeq: x.seq, nodeSeq: y.seq, sql: x.sql.slice(0, 100), source: x.source,
      fields: Object.fromEntries(fields.map(field => [field, {android: x[field], node: y[field]}]))});
  }
  const writes = list => list.filter(event => event.kind === 'write');
  const edit = list => list.filter(event => /:edit$/.test(event.stage));
  return {statements: {android: a.length, androidAligned: kept.length, node: n.length}, droppedAndroidOnly: dropped,
    differenceCount: differences.length, differences,
    driverRowsAffected: kept.map((event, i) => ({i, sql: event.sql.slice(0, 80), android: event.driverRowsAffected, node: n[i]?.driverRowsAffected}))
      .filter(entry => entry.android !== entry.node),
    writes: {android: writes(kept).length, node: writes(n).length}, editWrites: {android: writes(edit(kept)).length, node: writes(edit(n)).length}};
}
const counterPath = list => list.filter(event => (event.counterDelta ?? 0) !== 0 || event.source.startsWith('probe seed'))
  .map(event => `${event.seq}:${event.sql.slice(0, 48)}:${event.revisionBefore}->${event.revisionAfter}`);
const cases = {};
for (const [name, nodeCase] of [['editAmount-fresh-traced', node.apkOrder.freshTraced], ['editAmount-warm-traced', node.apkOrder.warmTraced]]) {
  const a = evidence(name);
  cases[name] = {differencesFromReference: a.differencesFromReference, differencesFromNodeSameConditions: a.differencesFromNode,
    nativeBatches: a.nativeBatches, trace: align(a.trace, nodeCase.trace),
    seedCategories: {android: a.trace.filter(e => /INSERT OR IGNORE INTO categories/.test(e.sql)).map(e => ({seq: e.seq, directRows: e.directRows,
      triggerRows: e.triggerRows, driverRowsAffected: e.driverRowsAffected, revisionBefore: e.revisionBefore, revisionAfter: e.revisionAfter})),
    node: nodeCase.trace.filter(e => /INSERT OR IGNORE INTO categories/.test(e.sql)).map(e => ({seq: e.seq, directRows: e.directRows,
      triggerRows: e.triggerRows, driverRowsAffected: e.driverRowsAffected, revisionBefore: e.revisionBefore, revisionAfter: e.revisionAfter}))},
    counterMovesAndroid: counterPath(a.trace), counterMovesNode: counterPath(nodeCase.trace)};
}
const staged = evidence('editAmount-staged-warm');
cases['editAmount-staged-warm'] = {stageDifferencesFromNode: staged.stageDifferencesFromNode,
  stageCounters: Object.fromEntries(Object.entries(staged.stages).map(([k, v]) => [k, v.financialDataRevision])),
  nodeStageCounters: Object.fromEntries(Object.entries(node.apkOrder.stagedWarm.stages).map(([k, v]) => [k, v.financialDataRevision])),
  nodeFreshStageCounters: Object.fromEntries(Object.entries(node.freshStaged.stages).map(([k, v]) => [k, v.financialDataRevision])),
  trace: align(staged.trace, node.apkOrder.stagedWarm.trace)};
// Reference-session (oracle layout) vs Android fresh: where the two first diverge.
const refTrace = node.referenceSession.trace;
const freshAligned = evidence('editAmount-fresh-traced').trace.filter(event => !ANDROID_ONLY(event));
const firstVsOracle = freshAligned.findIndex((event, i) => !refTrace[i] || ['sql', 'directRows', 'counterDelta']
  .some(field => JSON.stringify(event[field]) !== JSON.stringify(refTrace[i][field])) && !/^DELETE FROM "|^SELECT/.test(event.sql));
const result = {android: {apk: JSON.parse(fs.readFileSync(path.join(root, 'docs/validacion-fase1a4b/r2/android-b/api24/phase1a4b-r2-editamount/environment.json'), 'utf8')).apkSha256,
  passed: android.passed, failure: android.failure, runtime: evidence('runtime'), selfTest: evidence('tracer-installed'),
  schemaDifferencesFromNode: evidence('schema-facts').differencesFromNode, sqliteVersions: evidence('schema-facts').sqliteVersions},
  cases,
  firstDivergenceFromOracleLayout: firstVsOracle < 0 ? null : {index: firstVsOracle,
    android: (({seq, stage, sql, directRows, triggerRows, revisionBefore, revisionAfter, counterDelta}) => ({seq, stage, sql, directRows, triggerRows, revisionBefore, revisionAfter, counterDelta}))(freshAligned[firstVsOracle]),
    nodeOracleLayout: (({seq, stage, sql, directRows, triggerRows, revisionBefore, revisionAfter, counterDelta}) => ({seq, stage, sql, directRows, triggerRows, revisionBefore, revisionAfter, counterDelta}))(refTrace[firstVsOracle])}};
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
const brief = Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, {refDiffs: v.differencesFromReference?.length, nodeDiffs: v.differencesFromNodeSameConditions?.length ?? v.stageDifferencesFromNode?.length,
  traceDiffsAligned: v.trace.differenceCount, dropped: v.trace.droppedAndroidOnly.length, writes: v.trace.writes, editWrites: v.trace.editWrites, rowsAffectedDriverOnly: v.trace.driverRowsAffected.length}]));
console.log(JSON.stringify({brief, firstDivergenceFromOracleLayout: result.firstDivergenceFromOracleLayout}, null, 1));
