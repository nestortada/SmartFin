'use strict';
// Phase 1a.4B r5: passive coverage check of one device run, AFTER run-all-r5.ps1 (reads evidence only; no adb, Gradle or
// runner). Requires the 32 campaigns, each passed, with exactly the per-campaign case counts confirmed by Android r4 on
// API 24 (568 in total, replacing the miscounted 502 of the r1/r3 documents) and the 356 failure points (158 new 1a.4B,
// 198 regression), every point passed and, where the device reports it, rolledBack with the exact state restored and the
// next owner confirmed (never unknown); 0 differences against Node in every equivalence summary; com.smartfin unchanged.
// Writes docs/validacion-fase1a4b/r5/android/api<N>-coverage.json (never overwrites) and exits 1 on any shortfall.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const api = process.argv[2];
if (process.argv.length !== 3 || !['24', '35'].includes(api)) throw Error('Use: check-coverage-r5.cjs 24|35');
const CASES = {
  'phase1a4b-register': 9, 'phase1a4b-reversal': 13, 'phase1a4b-guards': 15, 'phase1a4b-idempotency': 4, 'phase1a4b-atomicity': 165,
  'phase1a4b-unknown': 3, 'phase1a4b-unknown-restart': 4,
  'phase1a4a-creation': 14, 'phase1a4a-lifecycle': 4, 'phase1a4a-compatibility': 4, 'phase1a4a-invariants': 4, 'phase1a4a-atomicity': 33,
  'phase1a4a-unknown': 3, 'phase1a4a-unknown-restart': 4,
  'phase1a3b-upgrade': 4, 'phase1a3b-startup-seed': 4, 'phase1a3b-startup-upgrade': 4, 'phase1a3b-upgrade-restart': 4,
  'phase1a3b-migration-atomicity': 33, 'phase1a3b-integrity': 13, 'phase1a3b-flows': 4,
  'phase1a3a-identity': 11, 'phase1a3a-atomicity': 37, 'phase1a3a-unknown': 3, 'phase1a3a-unknown-restart': 4,
  'phase6b3-atomicity': 66, 'phase1a2-atomicity-historical': 53, 'phase1a2-statements': 13, 'phase6b3-probes': 12,
  'phase6b3-unknown': 3, 'phase6b3-unknown-restart': 3, 'phase6a-precision': 18,
};
const POINTS = {'phase1a4b-atomicity': 158, 'phase1a4a-atomicity': 28, 'phase1a3b-migration-atomicity': 30, 'phase1a3a-atomicity': 32,
  'phase6b3-atomicity': 60, 'phase1a2-atomicity-historical': 48};
const BLOCKS = {'1a.4B': [/^phase1a4b-/, 213], '1a.4A': [/^phase1a4a-/, 66], '1a.3B': [/^phase1a3b-/, 66], '1a.3A': [/^phase1a3a-/, 55],
  '1a.2, 6B.3, 6A': [/^phase1a2-|^phase6b3-|^phase6a-/, 168]};
const sum = values => values.reduce((a, b) => a + b, 0);
if (sum(Object.values(CASES)) !== 568 || sum(Object.values(POINTS)) !== 356 || Object.keys(CASES).length !== 32) throw Error('Expected table inconsistent');
const dir = path.join(root, 'docs/validacion-fase1a4b/r5/android/api' + api);
const output = path.join(root, `docs/validacion-fase1a4b/r5/android/api${api}-coverage.json`);
if (fs.existsSync(output)) throw Error('Coverage already recorded; do not overwrite');
const problems = [];
const campaigns = {};
let fields = 0, differences = 0;
for (const [campaign, cases] of Object.entries(CASES)) {
  const file = path.join(dir, campaign, 'result.json');
  if (!fs.existsSync(file)) { problems.push(campaign + ': not executed'); continue; }
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const production = JSON.parse(fs.readFileSync(path.join(dir, campaign, 'production-package-unchanged.json'), 'utf8').replace(/^﻿/, ''));
  const failed = report.cases.filter(item => item.passed !== true).map(item => item.name);
  const points = report.cases.filter(item => /rollback|\((before|after)\)$/.test(item.name));
  const pointEvidence = points.map(item => item.evidence && item.evidence.android ? item.evidence.android : item.evidence);
  const badPoints = points.filter((item, i) => item.passed !== true || (pointEvidence[i] && pointEvidence[i].status !== undefined &&
    (pointEvidence[i].status !== 'rolledBack' || pointEvidence[i].exactStateRestored !== true || pointEvidence[i].nextOwnerConfirmed !== true)));
  const summary = report.cases.find(item => item.name === 'equivalence-summary');
  if (summary) { fields += summary.evidence.fieldsCompared; differences += summary.evidence.differences; }
  if (report.campaign !== campaign || report.passed !== true) problems.push(campaign + ': not passed');
  if (report.config.api !== Number(api)) problems.push(campaign + ': api ' + report.config.api);
  if (report.cases.length !== cases) problems.push(`${campaign}: ${report.cases.length} cases, expected ${cases}`);
  if (failed.length) problems.push(campaign + ': failed cases ' + failed.join(', '));
  if (points.length !== (POINTS[campaign] ?? 0)) problems.push(`${campaign}: ${points.length} failure points, expected ${POINTS[campaign] ?? 0}`);
  if (badPoints.length) problems.push(campaign + ': points not confirmed ' + badPoints.map(item => item.name).join(', '));
  if (summary && summary.evidence.differences !== 0) problems.push(campaign + ': differences against Node');
  if (production.unchanged !== true) problems.push(campaign + ': com.smartfin metadata changed');
  campaigns[campaign] = {cases: report.cases.length, passed: report.cases.length - failed.length, points: points.length};
}
const executed = Object.values(campaigns);
const result = {
  api: Number(api), campaigns: `${executed.length}/32`,
  cases: `${sum(executed.map(c => c.passed))}/568`, points: `${sum(executed.map(c => c.points))}/356`,
  blocks: Object.fromEntries(Object.entries(BLOCKS).map(([name, [pattern, expected]]) =>
    [name, `${sum(Object.entries(campaigns).filter(([c]) => pattern.test(c)).map(([, c]) => c.passed))}/${expected}`])),
  fieldsCompared: fields, differences, approved: problems.length === 0, problems, perCampaign: campaigns,
};
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({...result, perCampaign: undefined}));
if (!result.approved) process.exitCode = 1;
