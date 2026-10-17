const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const ts = require('typescript');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const target = path.resolve(process.argv[2]);
if (!fs.existsSync(path.join(target, 'vendor/sqlite')))
  throw Error(
    'Run androidDashboardPhase2/prepare.js in a fresh external directory first',
  );
if (target === root || target.startsWith(root + path.sep))
  throw Error('External synthetic harness required');
const packageId = 'com.smartfin.sharedcommands.bench';
for (const relative of [
  'android/app/build.gradle',
  'android/app/src/main/java/com/smartfin/BenchmarkPackage.kt',
]) {
  const file = path.join(target, relative);
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replaceAll('com.smartfin.dashboardphase2.bench', packageId),
  );
}
fs.cpSync(path.join(root, 'src'), path.join(target, 'src'), {
  recursive: true,
});
const baseline = path.join(target, 'srcBefore');
if (!fs.existsSync(baseline))
  child.execFileSync(process.execPath, [
    path.join(__dirname, 'prepareBaseline.js'),
    baseline,
  ]);
const legacy = child.execFileSync(
  'git',
  [
    'show',
    '6c98f98be9812e9b7345f01268984e1e3f961306:src/database/sqliteSchema.ts',
  ],
  { cwd: root, encoding: 'utf8' },
);
const mod = { exports: {} };
require('node:vm').runInNewContext(
  ts.transpileModule(legacy, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { module: mod, exports: mod.exports },
);
fs.writeFileSync(
  path.join(target, 'legacySchema.json'),
  JSON.stringify(mod.exports.SQLITE_SCHEMA_STATEMENTS),
);
fs.writeFileSync(
  path.join(target, 'src/database/legacyCommandMigrations.ts'),
  child.execFileSync(
    'git',
    [
      'show',
      '6c98f98be9812e9b7345f01268984e1e3f961306:src/database/migrations.ts',
    ],
    { cwd: root, encoding: 'utf8' },
  ),
);
fs.copyFileSync(
  path.join(__dirname, 'campaign.js'),
  path.join(target, 'campaign.js'),
);
fs.copyFileSync(
  path.join(__dirname, 'SharedCommandsApp.jsx'),
  path.join(target, 'BenchmarkApp.jsx'),
);
const oracle = JSON.parse(
  fs.readFileSync(
    path.join(root, 'docs/performance/shared-commands/node-after.json'),
    'utf8',
  ),
);
fs.writeFileSync(
  path.join(target, 'commandFinancialOracle.json'),
  JSON.stringify(
    oracle.financial.map(s => ({
      size: s.size,
      shared: s.shared,
      operation: s.operation,
      summary: s.summary,
      effects: s.result.effects,
      counts: Object.fromEntries(
        Object.entries(s.state).map(([table, value]) => [table, value.count]),
      ),
    })),
  ),
);
fs.writeFileSync(
  path.join(target, 'commandExactOracle.json'),
  JSON.stringify(oracle.exactBinary || []),
);
const native = path.join(
  target,
  'android/app/src/main/java/com/smartfin/BenchmarkPackage.kt',
);
let source = fs.readFileSync(native, 'utf8');
if (!source.includes('fun commandSeed'))
  source = source.replace(
    '  @ReactMethod fun beginSample',
    fs.readFileSync(path.join(__dirname, 'commandNative.kt.txt'), 'utf8') +
      '\n  @ReactMethod fun beginSample',
  );
// Upgrade observational hashing without touching any synthetic or production database.
source = source.replace(
  'val raw=if(cursor.isNull(i))"<NULL>" else cursor.getString(i)',
  'val raw=if(cursor.isNull(i))"<NULL>" else if(cursor.getType(i)==android.database.Cursor.FIELD_TYPE_FLOAT)java.lang.Long.toHexString(java.lang.Double.doubleToLongBits(cursor.getDouble(i))) else cursor.getString(i)',
);
source = source.replace(
  / {2}private fun syntheticCommandFile[\s\S]*?\n {2}@ReactMethod fun beginSample/,
  fs.readFileSync(path.join(__dirname, 'commandNative.kt.txt'), 'utf8') +
    '\n  @ReactMethod fun beginSample',
);
fs.writeFileSync(native, source);
const fingerprints = {};
for (const file of [
  'src/modules/transactions/useCases/createSharedExpenseApi.ts',
  'src/modules/transactions/useCases/sharedExpenseDomain.ts',
  'src/modules/transactions/useCases/sharedCommandEffects.ts',
  'src/modules/transactions/repositories/SharedExpenseRepository.ts',
  'src/modules/transactions/repositories/sqliteSharedExpenseRepository.ts',
  'src/modules/transactions/repositories/sqliteSharedCommandReads.ts',
  'src/modules/transactions/repositories/sharedTransactionIntegrity.ts',
  'src/modules/transactions/useCases/saveManualTransaction.ts',
])
  fingerprints[file] = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(root, file)))
    .digest('hex');
fs.writeFileSync(
  path.join(target, 'command-fingerprints.json'),
  JSON.stringify({ packageId, fingerprints }, null, 2),
);
