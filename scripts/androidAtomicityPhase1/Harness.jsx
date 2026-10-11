import React, { useEffect, useState } from 'react';
import { Linking, NativeModules, Text, View } from 'react-native';
import SQLite from 'react-native-sqlite-storage';
import { SQLITE_SCHEMA_STATEMENTS } from './src/database/sqliteSchema';
import { applyVersionedMigrations } from './src/database/migrations';
import {
  manageSQLiteDatabase,
  sqliteConnectionState,
  borrowSQLiteDatabase,
  discardSQLiteConnection,
} from './src/database/managedSQLite';
import { openConfirmedSQLiteConnection } from './src/database/sqliteLifecycle';
import {
  runSharedSQLiteTransaction,
  runSQLiteTransaction,
} from './src/database/atomicSQLite';
import { withDatabaseMaintenance } from './src/database/databaseCoordination';
const config = NativeModules.AtomicityReport.getConstants();
if (
  config.packageId !== 'com.smartfin.atomicityphase1.tests' ||
  !config.release ||
  __DEV__ ||
  !global.HermesInternal
)
  throw new Error('Isolated release guard failed');
SQLite.enablePromise(true);
const check = (value, message) => {
  if (!value) throw new Error(message);
};
let sequence = 0;
let lastFixture;
async function fixture() {
  const name = `atomicity_phase1_${Date.now()}_${sequence++}.db`;
  const raw = await openConfirmedSQLiteConnection({
    name,
    location: 'default',
  });
  for (const sql of SQLITE_SCHEMA_STATEMENTS) await raw.executeSql(sql);
  await applyVersionedMigrations(raw);
  await raw.executeSql(
    "INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('bank','Synthetic','bankAccount','active','COP',1000000,'2026-10-11','2026-10-11')",
  );
  let fault;
  let closeFault;
  let barrier;
  const trace = [];
  const adapter = new Proxy(raw, {
    get(target, key) {
      if (key === 'close')
        return async () => {
          trace.push('CLOSE REQUEST');
          const failure = closeFault;
          closeFault = undefined;
          if (failure === 'before') throw new Error('Injected before close');
          const result = await target.close();
          trace.push('CLOSE RESPONSE');
          if (failure === 'no-receipt') return new Promise(() => {});
          if (failure === 'after')
            throw new Error('Injected lost close receipt');
          return result;
        };
      if (key === 'executeSql')
        return async (sql, values) => {
          trace.push(sql);
          const hit = fault && sql.includes(fault.sql);
          const current = hit ? fault : undefined;
          if (hit) fault = undefined;
          if (current?.phase === 'before')
            throw new Error('Injected before SQL');
          const result = await target.executeSql(sql, values);
          if (barrier && sql.includes(barrier.sql)) {
            const b = barrier;
            barrier = undefined;
            b.reached();
            await b.release;
          }
          if (current?.phase === 'after') throw new Error('Injected after SQL');
          return result;
        };
      if (key === 'then') return undefined;
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const database = manageSQLiteDatabase(adapter);
  lastFixture = { name, trace, database };
  return {
    database,
    name,
    raw,
    trace,
    inject: (sql, phase) => {
      fault = { sql, phase };
    },
    injectClose: phase => {
      closeFault = phase;
    },
    pause: sql => {
      let reached, release;
      const arrived = new Promise(r => {
        reached = r;
      });
      const released = new Promise(r => {
        release = r;
      });
      barrier = { sql, reached, release: released };
      return { arrived, release };
    },
    amount: async () => {
      const [r] = await database.executeSql(
        "SELECT balance_amount FROM accounts WHERE id='bank'",
      );
      return r.rows.item(0).balance_amount;
    },
    snapshot: async (connection = database) => {
      const [tables] = await connection.executeSql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      const state = {};
      for (const { name: table } of tables.rows.raw()) {
        const quoted = '"' + table.replace(/"/g, '""') + '"';
        const [columns] = await connection.executeSql(
          `PRAGMA table_info(${quoted})`,
        );
        const order = columns.rows
          .raw()
          .map(c => '"' + c.name.replace(/"/g, '""') + '"')
          .join(',');
        const [rows] = await connection.executeSql(
          `SELECT * FROM ${quoted} ORDER BY ${order}`,
        );
        state[table] = rows.rows.raw();
      }
      return JSON.stringify(state);
    },
  };
}
async function reopen(name) {
  check(/^atomicity_phase1_\d+_\d+\.db$/.test(name), 'synthetic name required');
  lastFixture.stage = 'reopen: openDatabase pending';
  const raw = await openConfirmedSQLiteConnection({
    name,
    location: 'default',
  });
  lastFixture.stage = 'reopen: foreign_keys pending';
  await raw.executeSql('PRAGMA foreign_keys=ON');
  const [mode] = await raw.executeSql('PRAGMA foreign_keys');
  const [fk] = await raw.executeSql('PRAGMA foreign_key_check');
  const [integrity] = await raw.executeSql('PRAGMA integrity_check');
  const [revision] = await raw.executeSql(
    'SELECT revision FROM financial_data_revision WHERE id=1',
  );
  check(
    mode.rows.item(0).foreign_keys === 1 &&
      fk.rows.length === 0 &&
      integrity.rows.item(0).integrity_check === 'ok' &&
      revision.rows.length === 1 &&
      Number.isSafeInteger(revision.rows.item(0).revision),
    'reopened connection integrity and revision',
  );
  lastFixture.stage = 'reopen: completed';
  return manageSQLiteDatabase(raw);
}
async function execute() {
  const cases = [];
  const launch = await Linking.getInitialURL();
  const campaign = launch?.split('/').pop() || 'core';
  if (campaign === 'native-probe') {
    const clean = await NativeModules.AtomicityReport.probeAbandonedSession(
      true,
      false,
    );
    const abandoned = await NativeModules.AtomicityReport.probeAbandonedSession(
      false,
      false,
    );
    const marked = await NativeModules.AtomicityReport.probeAbandonedSession(
      true,
      true,
    );
    return {
      config,
      campaign,
      passed:
        clean.completedWithinFiveSeconds &&
        clean.persistedAmount === 1000000 &&
        marked.completedWithinFiveSeconds &&
        marked.persistedAmount === 900000 &&
        (!abandoned.completedWithinFiveSeconds || !!abandoned.readerError),
      clean,
      abandoned,
      marked,
      nativeStacks: await NativeModules.AtomicityReport.nativeStacks(),
    };
  }
  if (campaign === 'raw-driver') {
    const f = await fixture();
    const exercise = async () => {
      await f.raw.executeSql('BEGIN IMMEDIATE;');
      await f.raw.executeSql(
        "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
      );
      await f.raw.close();
      await reopen(f.name);
    };
    let timer;
    try {
      await Promise.race([
        exercise(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  JSON.stringify({
                    campaign,
                    diagnostic: {
                      stage: lastFixture.stage,
                      driverOpenState: f.raw.openDBs[f.name],
                    },
                  }),
                ),
              ),
            30000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    return { config, campaign, passed: true };
  }
  const isolated = {
    'begin-after': 'BEGIN after failure excludes body and foreign rollback',
    'commit-before': 'COMMIT before lost response quarantines',
    'rollback-before': 'ROLLBACK before lost response quarantines',
  };
  check(campaign === 'core' || isolated[campaign], 'known synthetic campaign');
  const probe = await fixture();
  const [version] = await probe.database.executeSql(
    'SELECT sqlite_version() AS version',
  );
  const [journal] = await probe.database.executeSql('PRAGMA journal_mode');
  const [foreignKeys] = await probe.database.executeSql('PRAGMA foreign_keys');
  const driver = {
    sqliteVersion: version.rows.item(0).version,
    journal: journal.rows.raw(),
    foreignKeys: foreignKeys.rows.raw(),
  };
  await probe.database.close();
  const test = async (name, operation) => {
    if (
      campaign === 'core'
        ? Object.values(isolated).includes(name)
        : isolated[campaign] !== name
    )
      return;
    let timer;
    const started = Date.now();
    try {
      await Promise.race([
        operation(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('CASE_TIMEOUT: possible deadlock')),
            30000,
          );
        }),
      ]);
      cases.push({
        name,
        passed: true,
        durationMs: Date.now() - started,
        evidence: lastFixture?.verification,
      });
    } catch (error) {
      cases.push({ name, passed: false, error: String(error) });
      if (String(error).includes('CASE_TIMEOUT')) {
        return Promise.reject(
          new Error(
            JSON.stringify({
              cases,
              driver,
              campaign,
              diagnostic: {
                name: lastFixture?.name,
                stage:
                  lastFixture?.stage || 'operation or native close pending',
                trace: lastFixture?.trace,
                connection:
                  lastFixture && sqliteConnectionState(lastFixture.database),
              },
            }),
          ),
        );
      }
    } finally {
      clearTimeout(timer);
    }
  };
  await test('actual driver callbacks and local generator rollback', async () => {
    const f = await fixture();
    const before = await f.snapshot();
    let callbacks = 0;
    try {
      await runSQLiteTransaction(f.database, function* () {
        yield {
          sql: "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
        };
        callbacks++;
        throw new Error('domain');
      });
      throw new Error('expected rejection');
    } catch (error) {
      check(String(error).includes('domain'), 'original domain error');
    }
    check(callbacks === 1, 'callback advanced');
    check((await f.snapshot()) === before, 'rows/revision rollback');
    await f.database.close();
  });
  for (const phase of ['before', 'after'])
    await test(`shared write ${phase} failure`, async () => {
      const f = await fixture();
      const before = await f.snapshot();
      f.inject('UPDATE accounts', phase);
      const result = await runSharedSQLiteTransaction(f.database, async s =>
        s.executeSql(
          "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
        ),
      );
      check(result.status === 'rolledBack', 'verified rollback');
      check((await f.snapshot()) === before, 'exact rows/revision');
      await f.database.close();
    });
  await test('foreign key SQL failure and full rollback', async () => {
    const f = await fixture();
    const before = await f.snapshot();
    const result = await runSharedSQLiteTransaction(f.database, async s => {
      await s.executeSql(
        "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
      );
      await s.executeSql(
        "INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at) VALUES ('invalid',1,'COP','Synthetic','2026-10-11','missing','expense','outflow','posted','2026-10-11','2026-10-11')",
      );
    });
    check(result.status === 'rolledBack', 'FK rollback');
    check((await f.snapshot()) === before, 'restored revision');
    const [fk] = await f.database.executeSql('PRAGMA foreign_key_check');
    check(fk.rows.length === 0, 'FK clean');
    await f.database.close();
  });
  await test('parent child debt and financial revision rollback', async () => {
    const f = await fixture();
    await f.database.executeSql(
      "INSERT INTO accounts(id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at) VALUES ('card','Synthetic card','creditCard','active','COP',0,250000,'2026-10-11','2026-10-11')",
    );
    const before = await f.snapshot();
    const result = await runSharedSQLiteTransaction(f.database, async s => {
      await s.executeSql(
        "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
      );
      await s.executeSql(
        "UPDATE accounts SET debt_balance_amount=150000 WHERE id='card'",
      );
      await s.executeSql(
        "INSERT INTO transactions(id,amount,currency,description,date,account_id,target_account_id,type,direction,status,created_at,updated_at) VALUES ('payment',100000,'COP','Synthetic payment','2026-10-11','bank','card','creditCardPayment','outflow','posted','2026-10-11','2026-10-11')",
      );
      await s.executeSql(
        "INSERT INTO transaction_splits(id,transaction_id,split_type,amount,currency,created_at,updated_at) VALUES ('child','payment','synthetic',100000,'COP','2026-10-11','2026-10-11')",
      );
      throw new Error('after parent child debt writes');
    });
    check(result.status === 'rolledBack', 'rollback confirmed');
    check(
      (await f.snapshot()) === before,
      'all tables, balances, debt, references and revision restored',
    );
    const [fk] = await f.database.executeSql('PRAGMA foreign_key_check');
    const [integrity] = await f.database.executeSql('PRAGMA integrity_check');
    check(
      fk.rows.length === 0 && integrity.rows.item(0).integrity_check === 'ok',
      'SQLite integrity',
    );
    await f.database.close();
  });
  for (const phase of ['before', 'after'])
    await test(`BEGIN ${phase} failure excludes body and foreign rollback`, async () => {
      const f = await fixture();
      const before = await f.snapshot();
      f.inject('BEGIN', phase);
      let calls = 0;
      const result = await runSharedSQLiteTransaction(f.database, async () => {
        calls++;
      });
      check(
        result.status === 'unknown' && calls === 0,
        'uncertain begin excludes body',
      );
      check(
        !f.trace.some(sql => sql.startsWith('ROLLBACK')),
        'no rollback without confirmed ownership',
      );
      check(
        sqliteConnectionState(f.database).status !== 'open',
        'old connection blocked',
      );
      const next = await reopen(f.name);
      const [rows] = await next.executeSql(
        "SELECT balance_amount FROM accounts WHERE id='bank'",
      );
      check(rows.rows.item(0).balance_amount === 1000000, 'no financial write');
      check(
        (await f.snapshot(next)) === before,
        'BEGIN recovery preserves all tables and financial revision',
      );
      lastFixture.verification = {
        outcome: result.status,
        bodyCalls: calls,
        before: JSON.parse(before),
        after: JSON.parse(await f.snapshot(next)),
        trace: [...f.trace],
        reopen: lastFixture.stage,
      };
      await next.close();
    });
  await test('concurrent owners external read backup and revoked scopes', async () => {
    const f = await fixture();
    const b = f.pause('UPDATE accounts');
    let escaped;
    const events = [];
    const first = runSharedSQLiteTransaction(f.database, async s => {
      escaped = s;
      events.push('first');
      await s.executeSql(
        "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
      );
    });
    await b.arrived;
    const reader = f.amount().then(value => {
      events.push('reader');
      check(value === 900000, 'committed read');
    });
    const second = runSharedSQLiteTransaction(f.database, async s => {
      events.push('second');
      await s.executeSql(
        "UPDATE accounts SET balance_amount=800000 WHERE id='bank'",
      );
    });
    const backup = withDatabaseMaintenance(async permit => {
      events.push('backup');
      await borrowSQLiteDatabase(f.database, permit).executeSql(
        'PRAGMA wal_checkpoint(FULL)',
      );
    });
    check(events.join(',') === 'first', 'no interleaving');
    b.release();
    check((await first).status === 'confirmed', 'first commit');
    await reader;
    check((await second).status === 'confirmed', 'second commit');
    await backup;
    check(events.join(',') === 'first,reader,second,backup', 'queue order');
    try {
      await escaped.executeSql('SELECT 1');
      throw new Error('scope escaped');
    } catch (e) {
      check(!String(e).includes('scope escaped'), 'revoked');
    }
    check(
      f.trace.filter(sql => sql.startsWith('BEGIN')).length === 2,
      'no nested BEGIN',
    );
    await f.database.close();
  });
  await test('nested runner rejected and borrowed owner has no deadlock', async () => {
    const f = await fixture();
    let escaped;
    await withDatabaseMaintenance(async permit => {
      const borrowed = borrowSQLiteDatabase(f.database, permit);
      escaped = borrowed;
      await runSQLiteTransaction(borrowed, function* () {
        yield { sql: 'SELECT 1' };
      });
      const result = await runSharedSQLiteTransaction(borrowed, async s => {
        try {
          await runSharedSQLiteTransaction(s, async () => {});
          throw new Error('nested accepted');
        } catch (e) {
          check(!String(e).includes('nested accepted'), 'nested denied');
        }
        await s.executeSql('SELECT 1');
      });
      check(result.status === 'confirmed', 'commit');
    });
    const before = f.trace.length;
    try {
      await escaped.executeSql('SELECT 1');
      throw new Error('expired permission accepted');
    } catch (error) {
      check(
        !String(error).includes('expired permission accepted'),
        'borrowed permission revoked',
      );
    }
    check(
      f.trace.length === before,
      'expired permission rejected before driver',
    );
    await f.database.close();
  });
  for (const sql of ['COMMIT', 'ROLLBACK'])
    for (const phase of ['before', 'after'])
      await test(`${sql} ${phase} lost response quarantines`, async () => {
        const f = await fixture();
        const before = JSON.parse(await f.snapshot());
        const expected = JSON.parse(JSON.stringify(before));
        f.inject(sql, phase);
        let calls = 0;
        const result = await runSharedSQLiteTransaction(f.database, async s => {
          calls++;
          await s.executeSql(
            "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
          );
          if (sql === 'ROLLBACK') throw new Error('domain');
        });
        check(result.status === 'unknown', 'unknown result');
        check(calls === 1, 'never retry');
        check(
          sqliteConnectionState(f.database).status !== 'open',
          'unusable handle',
        );
        check(
          f.trace.filter(statement => statement.startsWith(sql)).length === 1,
          'finalization attempted once',
        );
        const next = await reopen(f.name);
        const [rows] = await next.executeSql(
          "SELECT balance_amount FROM accounts WHERE id='bank'",
        );
        check(
          rows.rows.item(0).balance_amount ===
            (sql === 'COMMIT' && phase === 'after' ? 900000 : 1000000),
          'actual persisted state after uncertain response',
        );
        const after = JSON.parse(await f.snapshot(next));
        if (sql === 'COMMIT' && phase === 'after') {
          expected.accounts.find(
            account => account.id === 'bank',
          ).balance_amount = 900000;
          // Revision trigger timestamp is nondeterministic; inspect its value separately.
          check(
            after.financial_data_revision[0].revision ===
              before.financial_data_revision[0].revision + 1,
            'committed revision persisted once',
          );
          expected.financial_data_revision = after.financial_data_revision;
        }
        check(
          JSON.stringify(after) === JSON.stringify(expected),
          'all persisted financial tables match the actual outcome',
        );
        check(
          result.status === 'unknown',
          'integrity verification never relabels uncertain command',
        );
        lastFixture.verification = {
          outcome: result.status,
          bodyCalls: calls,
          before,
          after,
          trace: [...f.trace],
          reopen: lastFixture.stage,
        };
        await next.close();
      });
  for (const phase of ['before', 'after', 'no-receipt'])
    await test(`failed recovery close ${phase} preserves quarantine and revoked scopes`, async () => {
      const f = await fixture();
      let escaped;
      let calls = 0;
      f.inject('ROLLBACK', 'before');
      f.injectClose(phase);
      const result = await runSharedSQLiteTransaction(
        f.database,
        async scope => {
          escaped = scope;
          calls++;
          await scope.executeSql(
            "UPDATE accounts SET balance_amount=900000 WHERE id='bank'",
          );
          throw new Error('domain');
        },
      );
      check(
        result.status === 'unknown' && !!result.recoveryError && calls === 1,
        'unknown failure without retry',
      );
      check(
        sqliteConnectionState(f.database).status === 'quarantined',
        'failed recovery remains blocked',
      );
      const before = f.trace.length;
      for (const handle of [escaped, f.database]) {
        let rejected = false;
        try {
          await handle.executeSql('SELECT 987654');
        } catch {
          rejected = true;
        }
        check(rejected, 'reader/escaped scope blocked');
      }
      let rejected = false;
      try {
        await withDatabaseMaintenance(owner =>
          discardSQLiteConnection(f.database, owner),
        );
      } catch {
        rejected = true;
      }
      check(
        rejected && f.trace.length === before,
        'sticky failure refuses another native close or query',
      );
      check(
        f.trace.filter(sql => sql === 'CLOSE REQUEST').length === 1,
        'close attempted only once',
      );
      // Test teardown only: no managed handle is made usable after this cleanup.
      if (phase === 'before') await f.raw.close();
      check(
        sqliteConnectionState(f.database).status === 'quarantined',
        'teardown does not fake recovery',
      );
      lastFixture.verification = {
        outcome: result.status,
        recoveryError: String(result.recoveryError),
        bodyCalls: calls,
        state: sqliteConnectionState(f.database),
        trace: [...f.trace],
      };
    });
  await test('close request waits for transaction', async () => {
    const f = await fixture();
    const b = f.pause('UPDATE accounts');
    const operation = runSharedSQLiteTransaction(f.database, async s =>
      s.executeSql("UPDATE accounts SET balance_amount=900000 WHERE id='bank'"),
    );
    await b.arrived;
    const close = f.database.close();
    check(
      sqliteConnectionState(f.database).status === 'open',
      'not closed early',
    );
    b.release();
    check((await operation).status === 'confirmed', 'commit');
    await close;
    check(
      sqliteConnectionState(f.database).status === 'closed',
      'closed after commit',
    );
    const next = await reopen(f.name);
    check(
      sqliteConnectionState(next).generation !==
        sqliteConnectionState(f.database).generation,
      'new generation',
    );
    const [rows] = await next.executeSql(
      "SELECT balance_amount FROM accounts WHERE id='bank'",
    );
    check(
      rows.rows.item(0).balance_amount === 900000,
      'committed balance persisted across reopen',
    );
    try {
      await f.database.executeSql('SELECT 1');
      throw new Error('closed handle accepted');
    } catch (error) {
      check(
        !String(error).includes('closed handle accepted'),
        'old handle revoked',
      );
    }
    await next.close();
  });
  return {
    config,
    driver,
    campaign,
    hermes: !!global.HermesInternal,
    cases,
    passed: cases.every(c => c.passed),
  };
}
export default function Harness() {
  const [message, setMessage] = useState('Running synthetic SQLite tests');
  useEffect(() => {
    execute()
      .then(async result => {
        await NativeModules.AtomicityReport.report(
          JSON.stringify(result, null, 2),
        );
        setMessage(JSON.stringify(result));
      })
      .catch(async error => {
        let details = {};
        try {
          details = JSON.parse(error.message);
        } catch {
          /* Ordinary startup failure. */
        }
        const result = {
          config,
          passed: false,
          failure: String(error),
          ...details,
          nativeStacks: await NativeModules.AtomicityReport.nativeStacks(),
        };
        await NativeModules.AtomicityReport.report(JSON.stringify(result));
        setMessage(String(error));
      });
  }, []);
  return (
    <View>
      <Text>{message}</Text>
    </View>
  );
}
