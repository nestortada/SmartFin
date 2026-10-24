import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import { realSQLite } from './helpers/realSQLite';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
const fs = require('node:fs') as {
  mkdtempSync: (prefix: string) => string;
  copyFileSync: (from: string, to: string) => void;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
};
const { tmpdir } = require('node:os') as { tmpdir: () => string };
const { join } = require('node:path') as { join: (...parts: string[]) => string };
const { randomUUID } = require('node:crypto') as { randomUUID: () => string };

let directory: string;
let filename: string;
let trace: string[];
let connections: ReturnType<typeof realSQLite>[];
let failCopy: boolean;
let closeFailure: 'before' | 'after' | undefined;
let nativeQuarantined: boolean;
let lifecycle: typeof import('../src/database/sqliteDatabase');
let snapshotApi: typeof import('../src/modules/settings/services/localDatabaseSnapshot');
let coordinator: typeof import('../src/database/databaseCoordination');
let native: { acquire: jest.Mock; checkOwner: jest.Mock; release: jest.Mock; quarantine: jest.Mock; capture: jest.Mock; discard: jest.Mock };

beforeEach(() => {
  jest.resetModules();
  directory = fs.mkdtempSync(join(tmpdir(), 'smartfin-5b1-jest-'));
  filename = join(directory, 'synthetic.db');
  trace = []; connections = []; failCopy = false; closeFailure = undefined; nativeQuarantined = false;
  const { NativeModules, Platform } = require('react-native') as typeof import('react-native');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  native = {
    acquire: jest.fn(async () => {
      if (nativeQuarantined) throw new Error('Native quarantine');
      trace.push('native.acquire'); return 'explicit-owner-token';
    }),
    checkOwner: jest.fn(async () => { if (nativeQuarantined) throw new Error('Native quarantine'); }),
    release: jest.fn(async () => { trace.push('native.release'); }),
    quarantine: jest.fn(async () => { nativeQuarantined = true; trace.push('native.quarantine'); }),
    // This is an explicit Node stand-in for Kotlin, not Android evidence.
    capture: jest.fn(async (_token: string, expectedJson: string) => {
      trace.push('copy');
      if (failCopy) throw new Error('Injected copy failure');
      const id = randomUUID();
      const destination = join(directory, id + '.db');
      fs.copyFileSync(filename, destination);
      const copy = realSQLite({ syntheticPath: destination }); connections.push(copy);
      expect(copy.query('PRAGMA integrity_check').rows.item(0)).toEqual({ integrity_check: 'ok' });
      expect(copy.query('PRAGMA foreign_key_check').rows.length).toBe(0);
      const expected: { tables: [string, number][]; revision: number; journal: string } = JSON.parse(expectedJson);
      for (const [table, count] of expected.tables)
        expect(copy.query(`SELECT count(*) AS total FROM "${table}"`).rows.item(0)?.total).toBe(count);
      expect(copy.query('SELECT revision FROM financial_data_revision WHERE id=1').rows.item(0)?.revision).toBe(expected.revision);
      return JSON.stringify({ id, path: '/private/synthetic/' + id + '.db', bytes: 4096, revision: expected.revision,
        sha256: 'a'.repeat(64), journal: expected.journal, journalBeforeClose: expected.journal, sourceValidationMs: 0, copyMs: 0, validationAndHashMs: 0, nativeTotalMs: 0 });
    }),
    discard: jest.fn(async () => undefined),
  };
  NativeModules.SmartFinDatabaseLifecycle = native;
  const driver = require('react-native-sqlite-storage') as { openDatabase: jest.Mock };
  driver.openDatabase.mockImplementation((_params: unknown, success: (db: SmartFinSQLiteDatabase) => void) => {
    trace.push('open');
    const f = realSQLite({ syntheticPath: filename }); connections.push(f);
    const raw = {
      ...f.database,
      close: async () => {
        trace.push('close');
        if (closeFailure === 'before') throw new Error('Lost close receipt');
        await f.database.close();
        if (closeFailure === 'after') throw new Error('Lost close receipt');
      },
    };
    success(raw); return Promise.resolve(raw);
  });
  lifecycle = require('../src/database/sqliteDatabase');
  snapshotApi = require('../src/modules/settings/services/localDatabaseSnapshot');
  coordinator = require('../src/database/databaseCoordination');
});

afterEach(() => {
  for (const f of connections) { try { f.native.close(); } catch { /* Already closed by production lifecycle. */ } }
  fs.rmSync(directory, { recursive: true, force: true });
});

async function seed() {
  const db = await lifecycle.openSmartFinDatabase();
  await db.executeSql("INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('bank','Synthetic','bankAccount','active','COP',1000000,'2026-10-18','2026-10-18')");
  return db;
}

test('snapshot owns JS/native until confirmed close, complete private copy and verified reopen', async () => {
  await seed(); trace.length = 0;
  const result = await snapshotApi.captureLocalDatabaseSnapshot();
  expect(trace).toEqual(['native.acquire', 'close', 'copy', 'open', 'native.release']);
  expect(result.snapshot.revision).toBeGreaterThan(0);
  expect(result.database).toBe(await lifecycle.openSmartFinDatabase());
  expect(native.capture).toHaveBeenCalledWith('explicit-owner-token', expect.stringContaining('shared_loss_events'));
  await snapshotApi.discardLocalDatabaseSnapshot(result.snapshot.id);
  expect(native.discard).toHaveBeenCalledWith('explicit-owner-token', result.snapshot.id);
});

test('a real second connection sees committed state only and incomplete WAL checkpoint rejects before close/copy', async () => {
  const db = await seed();
  await db.executeSql('PRAGMA journal_mode=WAL');
  await db.executeSql('PRAGMA busy_timeout=0');
  const second = realSQLite({ syntheticPath: filename }); connections.push(second);
  second.native.exec('PRAGMA foreign_keys=ON; BEGIN;');
  expect(second.query("SELECT balance_amount FROM accounts WHERE id='bank'").rows.item(0)?.balance_amount).toBe(1000000);
  await db.executeSql("UPDATE accounts SET balance_amount=900000 WHERE id='bank'");
  trace.length = 0;
  await expect(snapshotApi.captureLocalDatabaseSnapshot()).rejects.toThrow('Checkpoint');
  expect(native.capture).not.toHaveBeenCalled(); expect(trace).not.toContain('close');
  expect(second.query("SELECT balance_amount FROM accounts WHERE id='bank'").rows.item(0)?.balance_amount).toBe(1000000);
  second.native.exec('ROLLBACK;');
  const captured = await snapshotApi.captureLocalDatabaseSnapshot();
  expect(captured.snapshot.journal).toBe('wal');
});

test.each(['delete', 'persist', 'truncate', 'wal'])('captures complete tables after verified %s mode', async journal => {
  const db = await seed(); await db.executeSql(`PRAGMA journal_mode=${journal}`);
  await db.executeSql("INSERT INTO ai_command_drafts(id,raw_input,plan_json,phase,created_at,updated_at) VALUES ('receipt','Synthetic','{\"_localCompleted\":[]}','confirmed','2026-10-18','2026-10-18')");
  const value = await snapshotApi.captureLocalDatabaseSnapshot();
  expect(value.snapshot.journalBeforeClose).toBe(journal);
  expect(native.capture.mock.calls[0]?.[1]).toContain('["ai_command_drafts",1]');
});

test('copy failure restores a verified managed handle and does not imply financial rollback', async () => {
  await seed(); failCopy = true;
  const result = await snapshotApi.captureLocalDatabaseSnapshot().catch((error: unknown) => error);
  expect(result).toBeInstanceOf(snapshotApi.LocalSnapshotFailure);
  const failure = result as import('../src/modules/settings/services/localDatabaseSnapshot').LocalSnapshotFailure;
  expect(failure.recoveryError).toBeUndefined();
  const [rows] = await failure.database!.executeSql("SELECT balance_amount FROM accounts WHERE id='bank'");
  expect(rows.rows.item(0).balance_amount).toBe(1000000);
  expect(trace.slice(-4)).toEqual(['open', 'native.release', 'native.acquire', 'native.release']);
});

test.each(['before', 'after'] as const)('lost close response %s native close keeps quarantine and prevents snapshot', async phase => {
  await seed(); closeFailure = phase;
  const failure = await snapshotApi.captureLocalDatabaseSnapshot().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(snapshotApi.LocalSnapshotFailure);
  expect(native.quarantine).toHaveBeenCalled(); expect(native.capture).not.toHaveBeenCalled();
  await expect(lifecycle.openSmartFinDatabase()).rejects.toThrow('quarantine');
});

test('borrowed permission reuses its native owner and escaped tokens are rejected', async () => {
  let escaped!: import('../src/database/databaseCoordination').DatabasePermit;
  await coordinator.withDatabaseMaintenance(async permit => {
    escaped = permit;
    await coordinator.withDatabaseMaintenance(async borrowed => {
      expect(coordinator.nativeDatabaseToken(borrowed)).toBe('explicit-owner-token');
    }, permit);
  });
  expect(native.acquire).toHaveBeenCalledTimes(1); expect(native.release).toHaveBeenCalledTimes(1);
  expect(() => coordinator.nativeDatabaseToken(escaped)).toThrow('expired');
});

test('a snapshot after actual COMMIT with lost response keeps the original unknown result', async () => {
  const db = await seed();
  connections[0]!.injectFault({ sql: 'COMMIT', phase: 'after' });
  const { runSharedSQLiteTransaction } = require('../src/database/atomicSQLite') as typeof import('../src/database/atomicSQLite');
  const result = await runSharedSQLiteTransaction(db, scope => scope.executeSql("UPDATE accounts SET balance_amount=900000 WHERE id='bank'"));
  expect(result.status).toBe('unknown');
  const captured = await snapshotApi.captureLocalDatabaseSnapshot();
  const [rows] = await captured.database.executeSql("SELECT balance_amount FROM accounts WHERE id='bank'");
  expect(rows.rows.item(0).balance_amount).toBe(900000);
  expect(result.status).toBe('unknown');
});

test('revoked native owner cannot initiate recovery opening after capture failure', async () => {
  await seed();
  native.capture.mockImplementationOnce(async () => {
    nativeQuarantined = true;
    throw new Error('Native host revoked');
  });
  const error = await snapshotApi.captureLocalDatabaseSnapshot().catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(snapshotApi.LocalSnapshotFailure);
  expect(error).toMatchObject({ database: undefined, recoveryError: expect.any(Error) });
  const driver = require('react-native-sqlite-storage') as { openDatabase: jest.Mock };
  expect(driver.openDatabase).toHaveBeenCalledTimes(1);
});

test('malformed native acquisition response quarantines before SQLite is opened', async () => {
  native.acquire.mockResolvedValueOnce(null);
  await expect(lifecycle.openSmartFinDatabase()).rejects.toThrow('permiso SQLite inválido');
  expect(native.quarantine).toHaveBeenCalledTimes(1);
  expect(native.release).not.toHaveBeenCalled();
  const driver = require('react-native-sqlite-storage') as { openDatabase: jest.Mock };
  expect(driver.openDatabase).not.toHaveBeenCalled();
});

test('busy, incomplete, malformed and uncertain checkpoints never certify capture', () => {
  for (const rows of [[], [{ busy: 1, log: 4, checkpointed: 2 }], [{ busy: 0, log: 4, checkpointed: 4 }],
    [{ busy: 0, log: -1, checkpointed: -1 }], [{ busy: 0, log: NaN, checkpointed: 0 }]])
    expect(() => snapshotApi.assertCompleteCheckpoint(rows)).toThrow();
  expect(() => snapshotApi.assertCompleteCheckpoint([{ busy: 0, log: 0, checkpointed: 0 }])).not.toThrow();
});
