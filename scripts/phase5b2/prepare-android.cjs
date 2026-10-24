// Disposable harness. Production modules copied with explicit synthetic file/hooks only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const workspace = path.resolve(process.argv[2]);
const packageId = 'com.smartfin.snapshot5b2.tests';
if (!fs.existsSync(workspace)) {
  execFileSync(process.execPath, [path.join(root, 'scripts/androidAtomicityPhase1/prepare.js'), workspace], { stdio: 'inherit' });
}
const gradlePath = path.join(workspace, 'android/app/build.gradle');
const gradle = fs.readFileSync(gradlePath, 'utf8');
if (!gradle.includes('applicationId "com.smartfin.atomicityphase1.tests"') && !gradle.includes(`applicationId "${packageId}"`)) throw Error('Isolated harness required');
fs.writeFileSync(gradlePath, gradle.replace('applicationId "com.smartfin.atomicityphase1.tests"', `applicationId "${packageId}"`));
const nativeDir = 'android/app/src/main/java/com/smartfin/';
const originalHashes = {}, hashes = {}, adaptations = {};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function walk(dir) { return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(dir + '/' + e.name) : [dir + '/' + e.name]); }
function copy(relative, transform = x => x) {
  const original = fs.readFileSync(path.join(root, relative));
  originalHashes[relative] = hash(original);
  const result = transform(original.toString());
  const target = path.join(workspace, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, result);
  hashes[relative] = hash(result);
  if (original.toString() !== result) adaptations[relative] = 'Synthetic name or deterministic test hook; inspect preparer.';
}
for (const file of walk('src')) copy(file, s => {
  if (file === 'src/database/sqliteSchema.ts') return s.replace("'smartfin.db'", "'phase5b2_synthetic.db'");
  if (file === 'src/database/managedSQLite.ts') return s.replace("sqliteLifecycleReceipt(connection.raw.close(), 'closing')", `sqliteLifecycleReceipt((async () => { await connection.raw.close(); if ((globalThis as unknown as { __snapshotCloseLost?: boolean }).__snapshotCloseLost) return new Promise<void>(() => {}); })(), 'closing')`)
    .replace('return handle.connection.raw.executeSql(sql);', `const result = await handle.connection.raw.executeSql(sql); if (sql.startsWith('COMMIT') && (globalThis as unknown as { __snapshotCommitLost?: boolean }).__snapshotCommitLost) throw new Error('Injected lost COMMIT response after native action'); return result;`);
  if (file === 'src/database/sqliteLifecycle.ts') return s.replace('openDatabase(params, resolve, reject)', `openDatabase(params, database => { if ((globalThis as unknown as { __snapshotOpenLost?: boolean }).__snapshotOpenLost) { (globalThis as unknown as { __snapshotOpenSucceeded?: boolean }).__snapshotOpenSucceeded = true; return; } resolve(database); }, reject)`);
  if (file === 'src/modules/settings/services/localDatabaseSnapshot.ts') return s.replace("const [checkpoint] = await owned.executeSql", `if ((globalThis as unknown as { __snapshotCheckpointFault?: boolean }).__snapshotCheckpointFault) throw new Error('Injected checkpoint failure');\n      const [checkpoint] = await owned.executeSql`)
    .replace('assertCompleteCheckpoint(resultSetToRows(checkpoint));', `(globalThis as unknown as { __checkpointRows?: unknown }).__checkpointRows = resultSetToRows(checkpoint); assertCompleteCheckpoint(resultSetToRows(checkpoint));`);
  return s;
});
for (const name of ['SmartFinDatabaseCoordinator.kt', 'SmartFinDatabaseLifecycleModule.kt', 'SmartFinLocalSnapshot.kt', 'SmartFinDriveBackupModule.kt', 'SmartFinBackupPublisher.kt', 'SmartFinBackupCsv.kt', 'SmartFinSubscriptionRemindersModule.kt', 'SmartFinSubscriptionReminderReceiver.kt', 'SmartFinSubscriptionWorker.kt']) {
  copy(nativeDir + name, s => {
    s = s.replaceAll('"smartfin.db"', '"phase5b2_synthetic.db"');
    if (name === 'SmartFinBackupPublisher.kt') s = s.replace('job.put("state", "verified").put("completedFiles", files.size + 1)', 'BackupFaults.hit("publication.beforeCommit"); job.put("state", "verified").put("completedFiles", files.size + 1)').replace('check(find(name) == uri)', 'BackupFaults.hit("stream.close:" + SyntheticBackupProvider.logical(name)); check(find(name) == uri)');
    if (name === 'SmartFinDatabaseCoordinator.kt') {
      s = s.replace('return owner.token', 'Phase5B2Probe.event("owner.acquired"); return owner.token')
        .replace('return Participant(token, owner.generation)', 'Phase5B2Probe.event("participant.borrowed"); return Participant(token, owner.generation)')
        .replace('return Participant(null, generation)', 'Phase5B2Probe.event("participant.independent"); return Participant(null, generation)')
        .replace('if (!quarantined) exclusive = null', 'Phase5B2Probe.event("owner.released"); if (!quarantined) exclusive = null');
    }
    if (name === 'SmartFinSubscriptionRemindersModule.kt') s = s.replace('return block(db)', 'Phase5B2Probe.connection(db); return block(db)');
    if (name === 'SmartFinSubscriptionReminderReceiver.kt') s = s.replace('db.beginTransaction()', 'Phase5B2Probe.hit("receiver.active"); db.beginTransaction()');
    if (name === 'SmartFinLocalSnapshot.kt') {
      s = s.replace('val sourceValidationStart =', 'Phase5B2Probe.hit("snapshot.beforeSource"); val sourceValidationStart =')
        .replace('val copyStart =', 'Phase5B2Probe.hit("snapshot.beforeCopy"); val copyStart =')
        .replace('input.copyTo(output)', 'Phase5B2Probe.copy(input, output)')
        .replace('val validationStart =', 'Phase5B2Probe.hit("snapshot.afterCopy"); val validationStart =')
        .replace('} catch (error: Exception) {\n        // Only', '} catch (error: Exception) { Phase5B2Probe.event("snapshot.failed"); Phase5B2Probe.snapshotFinished.countDown();\n        // Only')
        .replace('verify(describe(db), expected)', 'Phase5B2Probe.connection(db); verify(describe(db), expected)')
        .replace('verify(describe(snapshot), expected)', 'Phase5B2Probe.connection(snapshot); verify(describe(snapshot), expected)');
    }
    if (name === 'SmartFinDatabaseLifecycleModule.kt') s = s.replace('"No se pudo confirmar el ciclo de vida SQLite."', '(error.message ?: "Native lifecycle error")');
    return s;
  });
}
for (const name of ['Phase5B2Package.kt', 'SyntheticBackupProvider.kt', 'Harness.jsx']) {
  const relative = 'scripts/phase5b2/' + name;
  copy(relative);
  fs.copyFileSync(path.join(root, relative), path.join(workspace, name.endsWith('.kt') ? nativeDir + name : name));
}
const appPath = path.join(workspace, nativeDir, 'MainApplication.kt');
fs.writeFileSync(appPath, fs.readFileSync(appPath, 'utf8').replace('add(AtomicityPackage())', 'add(Phase5B2Package())'));
fs.writeFileSync(path.join(workspace, 'index.js'), "import {AppRegistry} from 'react-native';import Harness from './Harness';import {subscriptionHeadlessTask} from './src/modules/subscriptions/services/subscriptionRuntime';AppRegistry.registerHeadlessTask('SmartFinSubscriptionMaintenance',()=>subscriptionHeadlessTask);AppRegistry.registerComponent('SmartFin',()=>Harness);\n");
const manifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET"/><uses-permission android:name="android.permission.POST_NOTIFICATIONS"/><application android:name="com.smartfin.MainApplication" android:label="SmartFin Snapshot Synthetic Tests" android:allowBackup="false" android:theme="@style/AppTheme"><receiver android:name="com.smartfin.SmartFinSubscriptionReminderReceiver" android:exported="false"/><receiver android:name="com.smartfin.SmartFinSubscriptionRecoveryReceiver" android:exported="false"/><provider android:name="com.smartfin.SyntheticBackupProvider" android:authorities="com.smartfin.snapshot5b2.tests.documents" android:exported="true" android:permission="android.permission.MANAGE_DOCUMENTS" android:grantUriPermissions="true"/><activity android:name="com.smartfin.MainActivity" android:exported="true" android:launchMode="singleTask" android:configChanges="keyboard|keyboardHidden|orientation|screenLayout|screenSize|smallestScreenSize|uiMode"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter><intent-filter><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="snapshot5b2"/></intent-filter></activity></application></manifest>`;
fs.writeFileSync(path.join(workspace, 'android/app/src/main/AndroidManifest.xml'), manifest);
for (const relative of ['vendor/sqlite/lib/sqlite.core.js', 'vendor/sqlite/platforms/android/src/main/java/org/pgsqlite/SQLitePlugin.java']) {
  hashes[relative] = hash(fs.readFileSync(path.join(workspace, relative)));
  const original = relative.replace('vendor/sqlite', 'node_modules/react-native-sqlite-storage');
  originalHashes[original] = hash(fs.readFileSync(path.join(root, original)));
  if (originalHashes[original] !== hashes[relative]) throw Error('Driver copy differs from installed driver');
}
for (const relative of ['index.js', 'Harness.jsx', nativeDir + 'Phase5B2Package.kt', nativeDir + 'SyntheticBackupProvider.kt', nativeDir + 'MainApplication.kt', 'android/app/src/main/AndroidManifest.xml', 'android/app/build.gradle']) hashes[relative] = hash(fs.readFileSync(path.join(workspace, relative)));
const report = JSON.stringify({ packageId, workspace, originalHashes, hashes, adaptations }, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), report);
const assetDir = path.join(workspace, 'android/app/src/main/assets'); fs.mkdirSync(assetDir, { recursive: true });
fs.writeFileSync(path.join(assetDir, 'phase5b2-source-fingerprints.json'), report);
console.log(workspace);
