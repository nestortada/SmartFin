// Build a reviewable CODE rollback only, without applying it or touching any DB.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'docs/atomicidad-fase5b1');
const initial = JSON.parse(fs.readFileSync(path.join(out, 'baseline/scope-audit.json'), 'utf8')).before;
const files = [
  'src/database/databaseCoordination.ts', 'src/database/nativeDatabaseLifecycle.ts',
  'src/database/sqliteDatabase.ts', 'src/database/managedSQLite.ts', 'src/database/sqliteLifecycle.ts',
  'src/modules/settings/services/localDatabaseSnapshot.ts',
  'src/modules/settings/services/androidDriveBackupService.ts', 'src/modules/settings/useCases/deleteFinancialData.ts',
  'src/modules/subscriptions/services/androidSubscriptionReminderService.ts',
  'src/modules/subscriptions/services/subscriptionRuntime.ts',
  'src/modules/transactions/useCases/executeAiCommandPlan.ts', 'src/navigation/AppNavigator.tsx',
  'android/app/src/main/java/com/smartfin/SmartFinDatabaseCoordinator.kt',
  'android/app/src/main/java/com/smartfin/SmartFinDatabaseLifecycleModule.kt',
  'android/app/src/main/java/com/smartfin/SmartFinLocalSnapshot.kt',
  'android/app/src/main/java/com/smartfin/SmartFinDriveBackupModule.kt',
  'android/app/src/main/java/com/smartfin/SmartFinSubscriptionRemindersModule.kt',
  'android/app/src/main/java/com/smartfin/SmartFinNativePackage.kt',
];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const baselineDir = path.join(out, 'baseline-sources'); fs.mkdirSync(baselineDir, { recursive: true });
let patch = '';
const report = [];
for (const file of files) {
  const current = fs.readFileSync(path.join(root, file));
  let before = '';
  if (initial[file]) {
    if (file.endsWith('/subscriptionRuntime.ts')) before = current.toString()
      .replace('import { sqliteConnectionState, sqliteBorrowedPermit }', 'import { sqliteConnectionState }')
      .replace('createSubscriptionReminderService(sqliteBorrowedPermit(database))', 'createSubscriptionReminderService()');
    else if (file.endsWith('/executeAiCommandPlan.ts')) before = current.toString().replaceAll('createSubscriptionReminderService(permit)', 'createSubscriptionReminderService()');
    else if (file.endsWith('/SmartFinNativePackage.kt')) before = current.toString()
      .replace(/^[ \t]*SmartFinDatabaseLifecycleModule\(reactContext\),\r?\n/m, '');
    else {
      const blob = spawnSync('git', ['show', 'HEAD:' + file], { cwd: root, encoding: 'utf8' });
      if (blob.status !== 0) throw Error('Cannot read original ' + file);
      before = blob.stdout;
    }
    if (hash(before) !== initial[file]) before = before.replace(/\r?\n/g, '\r\n');
    if (hash(before) !== initial[file]) throw Error('Original source mismatch; refusing rollback artifact: ' + file);
  }
  const saved = path.join(baselineDir, file.replaceAll('/', '__') + '.before.txt');
  fs.writeFileSync(saved, before);
  const difference = spawnSync('git', ['diff', '--no-index', '--', path.join(root, file), saved], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (difference.status !== 1) throw Error('Expected code difference for ' + file);
  const hunk = difference.stdout.slice(difference.stdout.indexOf('@@'));
  patch += `diff --git a/${file} b/${file}\n` + (initial[file] ? '' : 'deleted file mode 100644\n') +
    `--- a/${file}\n+++ ${initial[file] ? 'b/' + file : '/dev/null'}\n` + hunk;
  report.push({ file, beforeSha256: initial[file] || null, currentSha256: hash(current), newFile: !initial[file] });
}
fs.writeFileSync(path.join(out, 'revert-phase5b1.patch'), patch);
fs.writeFileSync(path.join(out, 'code-rollback.json'), JSON.stringify({ applied: false, files: report,
  scope: 'Only the 18 production files of phase 5B.1. Preserves pre-existing phase 3B/4 changes and phase 1.1. Does not remove snapshots or any financial information.' }, null, 2));
console.log('Prepared rollback; not applied. Validate with git apply --check.');
