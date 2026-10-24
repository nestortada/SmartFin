// Diagnostic only: newly-created synthetic databases; no device, provider or user DB.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'docs/atomicidad-fase5a');
fs.mkdirSync(output, { recursive: true });
// Transpile only repository TS, without invoking Metro or any native implementation.
require.extensions['.ts'] = (module, filename) => {
  assert(filename.startsWith(root + path.sep));
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};
let alarms = new Set();
let cancelFailure = false;
const nativeStub = {
  getStatus: async () => ({ granted: true }), schedule: async () => {}, cancel: async () => {},
  ensureMaintenance: async () => {}, completeMaintenance: () => {},
  cancelAll: async () => { alarms.clear(); if (cancelFailure) throw new Error('injected native cancellation failure'); },
};
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === 'react-native-sqlite-storage') return {
    openDatabase: () => { throw new Error('Native database opening forbidden in phase5a'); }, enablePromise: () => {},
  };
  if (name === 'react-native') return { NativeModules: { SmartFinSubscriptionReminders: nativeStub }, Platform: { OS: 'android' } };
  return load.call(this, name, ...args);
};
const { realSQLite } = require('../../__tests__/helpers/realSQLite.ts');
const { SQLITE_SCHEMA_STATEMENTS } = require('../../src/database/sqliteSchema.ts');
const { applyVersionedMigrations } = require('../../src/database/migrations.ts');
const { manageSQLiteDatabase, borrowSQLiteDatabase, sqliteConnectionState } = require('../../src/database/managedSQLite.ts');
const { withExclusiveDatabase } = require('../../src/database/databaseCoordination.ts');
const { runSharedSQLiteTransaction } = require('../../src/database/atomicSQLite.ts');
const { createSqliteFinancialDataRepository } = require('../../src/modules/settings/repositories/sqliteFinancialDataRepository.ts');
const { deleteFinancialData } = require('../../src/modules/settings/useCases/deleteFinancialData.ts');
const { readAiCommandReceipt, confirmAiCommandReceipt } = require('../../src/modules/transactions/repositories/aiCommandReceipt.ts');
const fixed = new Date('2026-10-18T15:00:00.000Z');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'smartfin-phase5a-synthetic-'));
const cases = [];
const connections = [];
const file = name => path.join(temp, name);
function open(name, options = {}) {
  const db = new DatabaseSync(file(name), options);
  db.function('strftime', (format, source) => {
    assert.equal(format, '%Y-%m-%dT%H:%M:%fZ'); assert.equal(source, 'now');
    return fixed.toISOString();
  });
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;');
  connections.push(db);
  return db;
}
async function fixture(name, journal = 'DELETE') {
  const f = realSQLite({ syntheticPath: file(name), fixedSqlDate: fixed });
  connections.push(f.native);
  f.native.exec('PRAGMA foreign_keys=ON; BEGIN;');
  for (const sql of SQLITE_SCHEMA_STATEMENTS) f.native.exec(sql);
  f.native.exec('COMMIT;');
  await applyVersionedMigrations(f.database);
  f.native.exec(`PRAGMA journal_mode=${journal}; PRAGMA busy_timeout=0; BEGIN;
    INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at)
      VALUES ('bank','Synthetic','bankAccount','active','COP',1000000,'2026-10-18','2026-10-18');
    INSERT INTO app_settings VALUES ('theme','dark','2026-10-18');
    INSERT INTO recurring_subscriptions(id,name,amount,currency,account_id,periodicity,status,created_at,updated_at)
      VALUES ('s','Synthetic',44900,'COP','bank','monthly','active','2026-10-18','2026-10-18');
    INSERT INTO subscription_occurrences(id,subscription_id,expected_date,expected_amount,currency,account_id,status,created_at,updated_at)
      VALUES ('o','s','2026-10-19',44900,'COP','bank','pending','2026-10-18','2026-10-18');
    INSERT INTO subscription_reminders(id,occurrence_id,offset_days,revision,fire_at,title,message,desired,delivery_status,updated_at)
      VALUES ('subscription-reminder:r','o',1,1,'2026-10-18T15:00:00.000Z','Synthetic','Synthetic','scheduled','pending','2026-10-18'); COMMIT;`);
  return { ...f, rawDatabase: f.database, database: manageSQLiteDatabase(f.database), name };
}
function inspect(db) {
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  const integrity = db.prepare('PRAGMA integrity_check').all();
  assert.deepEqual(fk, []);
  assert.equal(integrity[0].integrity_check, 'ok');
  return {
    revision: db.prepare('SELECT revision FROM financial_data_revision WHERE id=1').get().revision,
    balances: db.prepare('SELECT id,balance_amount,debt_balance_amount FROM accounts ORDER BY id').all(),
    transactions: db.prepare('SELECT id,amount,type,direction,status FROM transactions ORDER BY id').all(),
    reminders: db.prepare('SELECT id,revision,desired,delivery_status,applied_revision FROM subscription_reminders ORDER BY id').all(),
    receipts: db.prepare('SELECT id,phase,plan_json FROM ai_command_drafts ORDER BY id').all(),
    foreignKeyCheck: fk, integrityCheck: integrity[0].integrity_check,
  };
}
function snapshot(db) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all()]));
}
async function record(id, operation) {
  const evidence = await operation();
  cases.push({ id, passed: true, ...evidence });
  process.stdout.write(id + ' passed\n');
}
function writeReminder(db, status = 'scheduled') {
  db.prepare('UPDATE subscription_reminders SET delivery_status=? WHERE id=?').run(status, 'subscription-reminder:r');
}
async function main() {
  await record('R1-js-owner-vs-independent-writer', async () => {
    const f = await fixture('coordination.db');
    const native = open(f.name);
    let observed;
    await withExclusiveDatabase(async permit => {
      const owned = borrowSQLiteDatabase(f.database, permit);
      await owned.executeSql('PRAGMA wal_checkpoint(FULL)');
      const before = inspect(native);
      // Independent native work can commit even while the JS lifecycle permit is held.
      writeReminder(native);
      observed = { before, duringJsPermit: inspect(native) };
      assert.equal(observed.duringJsPermit.revision, before.revision + 1);
    });
    const result = await runSharedSQLiteTransaction(f.database, async participant => {
      await participant.executeSql("UPDATE accounts SET balance_amount=900000 WHERE id='bank'");
      assert.throws(() => writeReminder(native, 'delivered'), /locked/);
      return 'writer excluded by SQLite, not by JS queue';
    });
    assert.equal(result.status, 'confirmed');
    return { ...observed, result, after: inspect(native), scope: 'Actual JS coordinator/runner; independent Node SQLite connection substitutes Kotlin' };
  });
  await record('R2-copy-then-csv-different-revisions', async () => {
    const f = await fixture('copy.db');
    const native = open(f.name);
    const declared = inspect(native).revision;
    fs.copyFileSync(file(f.name), file('copy-export.db'));
    // Barrier: raw copy completed; export connection not opened yet.
    writeReminder(native, 'delivered');
    const copied = open('copy-export.db', { readOnly: true });
    const csvSource = open(f.name, { readOnly: true });
    const beforeCsv = inspect(csvSource);
    const csvAccounts = csvSource.prepare('SELECT balance_amount FROM accounts').all();
    // A second barrier between two separate rawQuery calls, same connection.
    native.exec("UPDATE accounts SET balance_amount=950000 WHERE id='bank'");
    const afterCsv = inspect(csvSource);
    assert.equal(inspect(copied).revision, declared);
    assert.notEqual(beforeCsv.revision, declared);
    assert.notEqual(afterCsv.revision, beforeCsv.revision);
    return { manifestRevision: declared, copied: inspect(copied), beforeCsv, csvAccounts, afterCsv,
      scope: 'Raw-copy/query ordering from Kotlin, simulated barriers; account mutation is a possible independent writer, current receiver only changes reminders' };
  });
  await record('R3-wal-main-file-omits-confirmed-write', async () => {
    const f = await fixture('wal.db', 'WAL');
    f.native.exec('PRAGMA wal_checkpoint(FULL)');
    const baseline = inspect(f.native);
    const native = open(f.name);
    writeReminder(native, 'delivered');
    fs.copyFileSync(file(f.name), file('wal-main-only.db'));
    const copied = open('wal-main-only.db', { readOnly: true });
    assert.equal(inspect(copied).revision, baseline.revision);
    assert.equal(inspect(native).revision, baseline.revision + 1);
    return { checkpointBaseline: baseline, source: inspect(native), copied: inspect(copied), walBytes: fs.statSync(file(f.name + '-wal')).size,
      scope: 'WAL configured only in synthetic fixture; not a claim that production enables WAL' };
  });
  await record('R4-partial-destination-old-manifest-looks-current', async () => {
    const f = await fixture('provider.db');
    const revision = inspect(f.native).revision;
    const priorManifest = { revision, database: 'remote.db', files: ['remote.db', 'accounts.csv'] };
    fs.writeFileSync(file('manifest.json'), JSON.stringify(priorManifest));
    fs.copyFileSync(file(f.name), file('remote.db'));
    const stream = fs.openSync(file('remote.db'), 'w');
    fs.writeSync(stream, fs.readFileSync(file(f.name)).subarray(0, 128));
    fs.closeSync(stream); // Injected provider failure after truncation/partial bytes.
    const manifest = JSON.parse(fs.readFileSync(file('manifest.json'), 'utf8'));
    const currentStatusPredicate = fs.existsSync(file(manifest.database)) && manifest.revision >= revision;
    assert.equal(currentStatusPredicate, true);
    const broken = open('remote.db', { readOnly: true });
    assert.throws(() => broken.prepare('PRAGMA integrity_check').all(), /malformed|not a database/);
    return { currentStatusPredicate, bytes: 128, manifestUnchanged: true, source: inspect(f.native),
      scope: 'Filesystem stand-in for failing provider; Android ContentResolver itself not executed' };
  });
  await record('R5-every-wipe-write-rolls-back-but-alarms-do-not', async () => {
    const successful = await fixture('wipe-discovery.db');
    successful.resetTrace();
    await createSqliteFinancialDataRepository(successful.database).deleteFinancialData();
    const writes = successful.trace.filter(entry => entry.write);
    assert(writes.length > 0);
    let verifiedPositions = 0;
    for (const entry of writes) for (const phase of ['before', 'after']) {
      const f = await fixture(`wipe-${entry.write}-${phase}.db`);
      const before = snapshot(f.native);
      alarms = new Set(['subscription-reminder:r']);
      f.resetTrace(); f.injectFault({ write: entry.write, phase });
      await assert.rejects(deleteFinancialData(createSqliteFinancialDataRepository(f.database)));
      assert.deepEqual(snapshot(f.native), before);
      assert.equal(alarms.size, 0);
      inspect(f.native);
      const reopened = open(f.name);
      assert.deepEqual(snapshot(reopened), before); inspect(reopened);
      verifiedPositions++;
    }
    return { discoveredWrites: writes.length, verifiedPositions, fullSnapshotRestored: true, alarmsCancelledBeforeRollback: true,
      statements: writes.map(entry => entry.sql), successfulEmptyDatabase: inspect(successful.native),
      scope: 'Actual delete use case/repository/schema/runner; native cancellation is a Set mock, every fault before/after DELETE' };
  });
  await record('R6-native-cancel-fails-before-sql', async () => {
    const f = await fixture('cancel-fail.db');
    const before = snapshot(f.native);
    alarms = new Set(['subscription-reminder:r']); cancelFailure = true;
    try { await assert.rejects(deleteFinancialData(createSqliteFinancialDataRepository(f.database)), /cancellation failure/); }
    finally { cancelFailure = false; }
    assert.deepEqual(snapshot(f.native), before);
    return { sqlUnchanged: true, alarmsRemaining: alarms.size, after: inspect(f.native), scope: 'Actual use case; cancellation fails after one modeled external effect' };
  });
  await record('R7-commit-then-cleanup-fails-design-only', async () => {
    const f = await fixture('postcommit.db');
    const ids = f.native.prepare('SELECT id FROM subscription_reminders').all();
    const outcome = await runSharedSQLiteTransaction(f.database, async participant => {
      await createSqliteFinancialDataRepository(participant).deleteFinancialData();
    });
    assert.equal(outcome.status, 'confirmed');
    assert.throws(() => { throw new Error('external cleanup failed'); });
    const after = inspect(f.native); assert.equal(after.balances.length, 0);
    return { outcome: outcome.status, cleanup: 'failed', capturedIds: ids, after, afterReopen: inspect(open(f.name)),
      scope: 'Proposed SQL-before-cleanup order composed in harness, not current production behavior; no durable cleanup implemented' };
  });
  await record('R8-notify-before-ack-rollback-and-redelivery', async () => {
    const f = await fixture('receiver.db');
    const native = open(f.name);
    const before = inspect(native);
    const notifications = new Map(); let notifyCalls = 0;
    native.exec('BEGIN IMMEDIATE');
    // Mirrors notify(tag=id,id=1) before UPDATE/COMMIT. External map is not SQLite.
    notifications.set('subscription-reminder:r/1', 'Synthetic'); notifyCalls++;
    native.exec("UPDATE subscription_reminders SET delivery_status='delivered',applied_revision=revision");
    native.exec('ROLLBACK'); // injected failure after notify and before confirmed commit
    assert.deepEqual(inspect(native), before);
    const reopened = open(f.name);
    reopened.exec('BEGIN IMMEDIATE');
    notifications.set('subscription-reminder:r/1', 'Synthetic'); notifyCalls++;
    reopened.exec("UPDATE subscription_reminders SET delivery_status='delivered',applied_revision=revision; COMMIT;");
    return { before, after: inspect(reopened), notifyCalls, activeNotificationKeys: notifications.size,
      scope: 'Receiver SQL/effect ordering model, external notification map; does not prove Android sound/heads-up behavior' };
  });
  await record('R9-concurrent-receiver-vs-js-maintenance', async () => {
    const f = await fixture('receiver-maintenance.db');
    const native = open(f.name);
    native.exec('BEGIN IMMEDIATE');
    let blocked = false;
    try { await f.database.executeSql("UPDATE subscription_reminders SET applied_revision=revision, delivery_status='scheduled'"); }
    catch (error) { assert.match(String(error), /locked/); blocked = true; }
    native.exec("UPDATE subscription_reminders SET delivery_status='delivered',applied_revision=revision; COMMIT;");
    // Actual JS acknowledgement predicate preserves a concurrent delivered state.
    const { createSqliteSubscriptionRepository } = require('../../src/modules/subscriptions/repositories/sqliteSubscriptionRepository.ts');
    await createSqliteSubscriptionRepository(f.database).acknowledgeReminder('subscription-reminder:r', 1, 'scheduled');
    assert.equal(inspect(native).reminders[0].delivery_status, 'delivered');
    return { blocked, after: inspect(native), scope: 'Actual JS acknowledgement; native SQLite transaction modeled with a second connection' };
  });
  await record('R10-receipt-backup-old-restore-deliberate-wipe', async () => {
    const f = await fixture('receipt.db');
    fs.copyFileSync(file(f.name), file('before-receipt.db'));
    const plan = { version: 1, summary: 'Synthetic', answeredFields: [], actions: [] };
    const outcome = await runSharedSQLiteTransaction(f.database, async participant => {
      await confirmAiCommandReceipt(participant, 'intent', plan, ['Synthetic confirmed']);
    });
    assert.equal(outcome.status, 'confirmed');
    fs.copyFileSync(file(f.name), file('with-receipt.db'));
    const current = open('with-receipt.db', { readOnly: true });
    const old = open('before-receipt.db', { readOnly: true });
    assert.equal(inspect(current).receipts.length, 1);
    assert.equal(inspect(old).receipts.length, 0);
    const olderAdapter = { executeSql: async (sql, values) => {
      const rows = old.prepare(sql).all(...values);
      return [{ rows: { length: rows.length, item: i => rows[i], raw: () => rows } }];
    } };
    assert.equal(await readAiCommandReceipt(olderAdapter, 'intent', plan), undefined);
    await createSqliteFinancialDataRepository(f.database).deleteFinancialData();
    assert.equal(inspect(f.native).receipts.length, 0);
    return { withReceipt: inspect(current), olderRestore: inspect(old), afterWipe: inspect(f.native), olderRead: 'undefined',
      scope: 'Actual receipt helpers and synthetic copied DBs; no restore feature or financial intention re-execution implemented' };
  });
  await record('R11-wipe-lost-commit-receipt-before-and-after', async () => {
    const outcomes = [];
    for (const phase of ['before', 'after']) {
      const f = await fixture(`unknown-${phase}.db`);
      const before = snapshot(f.native);
      const raw = f.rawDatabase;
      // The installed driver labels commit failures; the Node helper's injection
      // does not. Adapt only that label to exercise the current quarantine guard.
      const db = manageSQLiteDatabase({
        executeSql: (...args) => raw.executeSql(...args),
        transaction: async operation => {
          try { return await raw.transaction(operation); }
          catch (error) { throw new Error('error while trying to commit: ' + String(error)); }
        },
        close: () => raw.close(),
      });
      f.injectFault({ sql: 'COMMIT;', phase });
      await assert.rejects(createSqliteFinancialDataRepository(db).deleteFinancialData(), /trying to commit/);
      assert.equal(sqliteConnectionState(db).status, 'quarantined');
      const reopened = open(f.name);
      if (phase === 'before') assert.deepEqual(snapshot(reopened), before);
      else assert.equal(inspect(reopened).balances.length, 0);
      outcomes.push({ phase, connection: sqliteConnectionState(db), reopened: inspect(reopened),
        classification: 'unknown despite reopened state', scope: 'Injected response loss, actual managed quarantine; driver error text adapted explicitly' });
    }
    return { outcomes };
  });
  await record('R12-checkpoint-can-return-busy-without-throwing', async () => {
    const f = await fixture('checkpoint-busy.db', 'WAL');
    f.native.exec('PRAGMA wal_checkpoint(FULL)');
    const reader = open(f.name, { readOnly: true });
    reader.exec('BEGIN'); reader.prepare('SELECT * FROM subscription_reminders').all();
    writeReminder(f.native, 'delivered');
    const checkpoint = f.native.prepare('PRAGMA wal_checkpoint(FULL)').get();
    assert.equal(checkpoint.busy, 1);
    reader.exec('ROLLBACK');
    return { checkpoint, source: inspect(f.native),
      scope: 'Synthetic WAL reader holds old snapshot; JS production currently discards checkpoint rows; not an Android driver result' };
  });
}
main().then(() => {
  const report = { complete: cases.length === 12, harnessSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'reproduce.js'))).digest('hex'),
    node: process.version, sqlite: new DatabaseSync(':memory:').prepare('SELECT sqlite_version() AS v').get().v,
    fixedClock: fixed.toISOString(), syntheticDirectory: temp, androidExecuted: false, cases,
    sourceHashes: Object.fromEntries(Object.keys(require.cache).filter(name => name.startsWith(root + path.sep) && name.endsWith('.ts'))
      .map(name => [path.relative(root, name).replaceAll('\\', '/'), crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex')])) };
  fs.writeFileSync(path.join(output, 'reproductions.json'), JSON.stringify(report, null, 2));
}).catch(error => { process.stderr.write(String(error.stack || error)); process.exitCode = 1; })
  .finally(() => { for (const db of connections.reverse()) { try { db.close(); } catch { /* already closed fixture */ } } });
