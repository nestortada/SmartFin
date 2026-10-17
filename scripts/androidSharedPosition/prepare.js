/* Creates a fresh disposable release harness; never installs production. */
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const crypto = require('node:crypto');
const repository = path.resolve(__dirname, '../..');
const workspace = path.resolve(process.argv[2] || 'C:/sf-shared-position');
if (fs.existsSync(workspace)) throw Error('Choose a fresh harness directory');
child.execFileSync(
  process.execPath,
  [
    path.join(repository, 'scripts/androidDashboardPhase2/prepare.js'),
    workspace,
  ],
  { stdio: 'inherit' },
);
const native = path.join(
  workspace,
  'android/app/src/main/java/com/smartfin/BenchmarkPackage.kt',
);
const build = path.join(workspace, 'android/app/build.gradle');
for (const file of [native, build])
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replaceAll(
        'com.smartfin.dashboardphase2.bench',
        'com.smartfin.sharedposition.bench',
      ),
  );
const manifest = path.join(
  workspace,
  'android/app/src/main/AndroidManifest.xml',
);
fs.writeFileSync(
  manifest,
  fs
    .readFileSync(manifest, 'utf8')
    .replace(
      'SmartFin Phase 2 Synthetic',
      'SmartFin Shared Position Synthetic',
    ),
);
// Benchmark exactly the production source, without timing wrappers injected by
// the phase-2 preparation. The SQLite plugin retains its query timing fields.
for (const file of [
  'src/modules/dashboard/useCases/getDashboardSummary.ts',
  'src/modules/accounts/repositories/sqliteAccountRepository.ts',
  'src/modules/transactions/repositories/sqliteTransactionRepository.ts',
])
  fs.copyFileSync(path.join(repository, file), path.join(workspace, file));
fs.copyFileSync(
  path.join(
    repository,
    'docs/performance/shared-position/dashboard-before.ts.txt',
  ),
  path.join(
    workspace,
    'src/modules/dashboard/useCases/getDashboardSummaryBaseline.ts',
  ),
);
fs.copyFileSync(
  path.join(__dirname, 'SharedPositionApp.jsx'),
  path.join(workspace, 'BenchmarkApp.jsx'),
);
const seed = fs.readFileSync(path.join(__dirname, 'seedShared.kt.txt'), 'utf8');
fs.writeFileSync(
  native,
  fs
    .readFileSync(native, 'utf8')
    .replace(
      '  @ReactMethod fun beginSample',
      seed + '\n  @ReactMethod fun beginSample',
    ),
);
const fingerprints = {};
for (const file of [
  'src/modules/dashboard/useCases/getDashboardSummary.ts',
  'src/modules/transactions/repositories/sqliteSharedExpenseRepository.ts',
  'src/modules/transactions/repositories/sharedFinancialTotalsSql.ts',
  'src/modules/transactions/useCases/readSharedFinancialTotals.ts',
  'docs/performance/shared-position/dashboard-before.ts.txt',
])
  fingerprints[file] = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(repository, file)))
    .digest('hex');
fs.writeFileSync(
  path.join(workspace, 'shared-position-fingerprints.json'),
  JSON.stringify(
    { packageId: 'com.smartfin.sharedposition.bench', fingerprints },
    null,
    2,
  ),
);
