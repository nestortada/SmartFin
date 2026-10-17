/* global performance */
import React, { useEffect, useState } from 'react';
import { NativeModules, Text, View } from 'react-native';
import SQLite from 'react-native-sqlite-storage';
import legacySchema from './legacySchema.json';
import nodeOracle from './commandFinancialOracle.json';
import exactOracle from './commandExactOracle.json';
import { SQLITE_SCHEMA_STATEMENTS } from './src/database/sqliteSchema';
import { applyVersionedMigrations } from './src/database/migrations';
import { applyVersionedMigrations as legacyMigrations } from './src/database/legacyCommandMigrations';
import { createSharedExpenseApi as afterApi } from './src/modules/transactions/useCases/createSharedExpenseApi';
import { createSharedExpenseApi as beforeApi } from './srcBefore/modules/transactions/useCases/createSharedExpenseApi';
import { createSqliteSharedExpenseRepository as afterRepo } from './src/modules/transactions/repositories/sqliteSharedExpenseRepository';
import { createSqliteSharedExpenseRepository as beforeRepo } from './srcBefore/modules/transactions/repositories/sqliteSharedExpenseRepository';
import { getDashboardSummaryFromDb } from './src/modules/dashboard/useCases/getDashboardSummary';
import { createSqliteAccountRepository } from './src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from './src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from './src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { registerCreditCardPayment } from './src/modules/creditCards/useCases/creditCardTransactionRelations';
import { saveManualTransaction } from './src/modules/transactions/useCases/saveManualTransaction';
import { campaign, seedStatements } from './campaign';
const native = NativeModules.DashboardBenchmark;
const config = native.getConstants();
if (
  config.packageId !== 'com.smartfin.sharedcommands.bench' ||
  !config.release ||
  __DEV__ ||
  !global.HermesInternal
)
  throw Error('Isolated release Hermes package required');
SQLite.enablePromise(true);
SQLite.DEBUG(false);
const RealDate = Date;
const fixed = '2026-10-12T12:00:00Z';
// Fixed financial/audit clock, independent from performance.now.
global.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [fixed]));
  }
  static now() {
    return new RealDate(fixed).getTime();
  }
};
const canonical = value =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map(key => [key, canonical(value[key])]),
      )
    : value;
const normalized = value =>
  JSON.parse(
    JSON.stringify(value).replace(
      /tx_manual_\d+(?:_\d+)?/g,
      'generated-purchase',
    ),
  );
const equal = (actual, expected, label) => {
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected)))
    throw Error(
      label + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected),
    );
};
const rows = async (db, sql, values = []) => {
  const [r] = await db.executeSql(sql, values);
  return r.rows.raw();
};
const emit = record => native.writeFunctional(JSON.stringify(record));
async function migrationAndRestart() {
  const name =
    config.version === 'prepare3'
      ? 'dashboard_phase2_cmd_migration6.db'
      : 'dashboard_phase2_cmd_migration.db';
  await native.commandSeed(name, legacySchema);
  const db = await SQLite.openDatabase({ name, location: 'default' });
  await db.executeSql('PRAGMA foreign_keys=ON');
  await legacyMigrations(db);
  await db.executeSql(
    "INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES('historic-bank','Synthetic','bankAccount','active','COP',1,'old','old')",
  );
  await db.executeSql(
    "INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at) VALUES('historic',0.1,'COP','Synthetic','2025-12-31T23:00:00Z','historic-bank','expense','outflow','posted','old','old')",
  );
  const old = await rows(db, 'SELECT * FROM transactions');
  const failing = new Proxy(db, {
    get(target, key) {
      if (key !== 'transaction') return Reflect.get(target, key);
      return (operation, ...args) =>
        db.transaction(
          tx =>
            operation(
              new Proxy(tx, {
                get(current, member) {
                  if (member !== 'executeSql')
                    return Reflect.get(current, member);
                  return (sql, ...parameters) =>
                    tx.executeSql(
                      sql.includes('idx_shared_loss_participation')
                        ? 'SELECT * FROM synthetic_missing_table'
                        : sql,
                      ...parameters,
                    );
                },
              }),
            ),
          ...args,
        );
    },
  });
  let failed = false;
  try {
    await applyVersionedMigrations(failing);
  } catch (error) {
    failed = true;
  }
  equal(failed, true, 'migration failure rejected');
  equal(
    await rows(db, 'SELECT * FROM transactions'),
    old,
    'migration rollback historical rows',
  );
  equal(
    (
      await rows(db, 'SELECT version FROM schema_migrations ORDER BY version')
    ).map(r => r.version),
    [1, 2],
    'migration rollback versions',
  );
  equal(
    await rows(
      db,
      "SELECT name FROM sqlite_master WHERE name IN ('shared_expenses','shared_loss_events')",
    ),
    [],
    'migration rollback DDL',
  );
  await applyVersionedMigrations(db);
  await applyVersionedMigrations(db);
  equal(
    await rows(db, `SELECT ${Object.keys(old[0]).join(',')} FROM transactions`),
    old,
    'migration 3/4 preserve historical rows',
  );
  equal(
    (
      await rows(db, 'SELECT version FROM schema_migrations ORDER BY version')
    ).map(r => r.version),
    [1, 2, 3, 4],
    'migration versions',
  );
  await native.commandSeed(name, seedStatements(1000, 10));
  const api = afterApi(afterRepo(db));
  const shared = await api.sharePurchase('persist-share', {
    transactionId: 'ledger-000000',
    distribution: {
      mode: 'amounts',
      personalAmount: 15000,
      participants: [{ contactId: 'person', amount: 15000 }],
    },
  });
  await api.forgiveParticipation('persist-loss', {
    participationId: 'shared:persist-share:split:1',
    amount: 15000,
    date: '2026-10-10',
  });
  const summary = await getDashboardSummaryFromDb(db, new Date(fixed));
  const state = await native.commandDigest(name);
  await db.executeSql(
    "INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES('command-oracle',?,'fixed')",
    [JSON.stringify({ summary, state, expense: shared.entityId })],
  );
  equal((await rows(db, 'PRAGMA foreign_key_check')).length, 0, 'migration FK');
  const sqlite = (await rows(db, 'SELECT sqlite_version() AS version'))[0]
    .version;
  await db.close();
  await emit({
    type: 'prepared',
    sqlite,
    checks: [
      'migration3',
      'migration4',
      'historicalRows',
      'repeatedMigration',
      'persistedForgiveness',
      'migrationRollback',
    ],
    name,
  });
}
async function restart() {
  const name =
    config.version === 'verify3'
      ? 'dashboard_phase2_cmd_migration6.db'
      : 'dashboard_phase2_cmd_migration.db';
  const db = await SQLite.openDatabase({ name, location: 'default' });
  const saved = JSON.parse(
    (
      await rows(
        db,
        "SELECT setting_value FROM app_settings WHERE setting_key='command-oracle'",
      )
    )[0].setting_value,
  );
  equal(
    await native.commandDigest(name),
    saved.state,
    'physical restart exact tables',
  );
  equal(
    await getDashboardSummaryFromDb(db, new Date(fixed)),
    saved.summary,
    'restart exact financial summary',
  );
  const api = afterApi(afterRepo(db));
  const input = {
    participationId: 'shared:persist-share:split:1',
    amount: 15000,
    date: '2026-10-10',
  };
  await api.forgiveParticipation('persist-loss', input);
  equal(await native.commandDigest(name), saved.state, 'restart idempotency');
  const before = await native.commandDigest(name);
  // Real SQLite failures from aborting triggers, at journal and command receipt writes.
  for (const table of ['shared_loss_events', 'shared_commands']) {
    await db.executeSql(
      `CREATE TRIGGER synthetic_fail BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic fault'); END;`,
    );
    let rejected = false;
    try {
      await api.reverseLossEvent('fault-' + table, {
        eventId: 'shared:persist-loss:loss',
        date: '2026-10-10',
      });
    } catch (error) {
      rejected = true;
    }
    equal(rejected, true, 'fault rejected ' + table);
    await db.executeSql('DROP TRIGGER synthetic_fail');
    equal(
      await native.commandDigest(name),
      before,
      'rollback exact tables ' + table,
    );
  }
  const receipt = await api.recordReceipt('persist-receipt', {
    contactId: 'person',
    accountId: 'target',
    amount: 5000,
    occurrence: { kind: 'date', date: '2026-11-03' },
  });
  let signal;
  const begun = new Promise(resolve => {
    signal = resolve;
  });
  let committed = false,
    readerStart,
    firstReaderSql;
  const execute = db.executeSql.bind(db);
  const coordinated = new Proxy(db, {
    get(target, key) {
      if (key !== 'executeSql') return Reflect.get(target, key);
      return async (sql, values = []) => {
        if (
          committed &&
          readerStart !== undefined &&
          firstReaderSql === undefined
        )
          firstReaderSql = performance.now();
        const result = await execute(sql, values);
        if (sql === 'BEGIN IMMEDIATE;') signal();
        if (sql === 'COMMIT;') committed = true;
        return result;
      };
    },
  });
  const recovery = afterApi(afterRepo(coordinated)).recoverForgiveness(
    'persist-recovery',
    {
      forgivenessId: 'shared:persist-loss:loss',
      receiptId: receipt.entityId,
      amount: 5000,
      date: '2026-11-03',
    },
  );
  await begun;
  readerStart = performance.now();
  const reader = getDashboardSummaryFromDb(coordinated, new Date(fixed));
  await recovery;
  equal(
    await reader,
    await getDashboardSummaryFromDb(db, new Date(fixed)),
    'reader sees committed recovery',
  );
  await emit({
    type: 'reader-wait',
    operation: 'recoverForgiveness',
    milliseconds: firstReaderSql - readerStart,
    scope: 'application maintenance queue; no injected sleep',
  });
  equal(
    (await api.getExpense(saved.expense)).participants[0].recoveredAmount,
    5000,
    'recovery persisted',
  );
  equal((await rows(db, 'PRAGMA foreign_key_check')).length, 0, 'restart FK');
  equal(
    (await rows(db, 'PRAGMA integrity_check'))[0].integrity_check,
    'ok',
    'restart integrity',
  );
  await db.close();
  await emit({
    type: 'restart-pass',
    checks: [
      'processRestart',
      'exactTables',
      'exactSummary',
      'idempotency',
      'rollbackJournal',
      'rollbackCommand',
      'receipt',
      'recovery',
      'FK',
      'integrity',
    ],
  });
}
async function benchmarks(setText) {
  const report = [];
  const optimized = config.version === 'optimized';
  for (const [size, shared] of [
    [1000, 10],
    [10000, 100],
    [100000, 100],
    [100000, 1000],
  ]) {
    const expected = [];
    // 100k before is measured in Node; avoid a multi-hour Hermes quadratic campaign.
    for (const version of optimized || size === 100000
      ? ['after']
      : ['before', 'after']) {
      for (
        let iteration = 0;
        iteration < (size === 1000 ? 3 : 1);
        iteration++
      ) {
        const name = `dashboard_phase2_cmd_${size}_${shared}_${version}${
          optimized ? '6' : ''
        }_${iteration}.db`;
        setText(`${size} / ${shared} / ${version} / ${iteration}`);
        await emit({ type: 'progress', size, shared, version, iteration });
        await native.commandSeed(name, SQLITE_SCHEMA_STATEMENTS);
        const db = await SQLite.openDatabase({ name, location: 'default' });
        await db.executeSql('PRAGMA foreign_keys=ON');
        await applyVersionedMigrations(db);
        const statements = seedStatements(size, shared);
        for (let i = 0; i < statements.length; i += 500)
          await native.commandSeed(name, statements.slice(i, i + 500));
        const execute = db.executeSql.bind(db);
        let queries = [];
        let begin, end;
        const measured = new Proxy(db, {
          get(target, key) {
            if (key !== 'executeSql') return Reflect.get(target, key);
            return async (sql, values = []) => {
              const start = performance.now();
              const results = await execute(sql, values);
              const r = results[0];
              queries.push({
                sql,
                rows: r.rows.length,
                characters: JSON.stringify(r.rows.raw()).length,
                roundtripMs: performance.now() - start,
                nativeQueryMs: r.__nativeQueryMs,
                sqlCursorMs: r.__sqlCursorMs,
              });
              if (sql.startsWith('BEGIN')) begin = start;
              if (sql.startsWith('COMMIT')) end = performance.now();
              return results;
            };
          },
        });
        const api =
          version === 'before'
            ? beforeApi(beforeRepo(measured))
            : afterApi(afterRepo(measured));
        let step = 0;
        await campaign(api, async (operation, command) => {
          queries = [];
          begin = undefined;
          end = undefined;
          const start = performance.now();
          const result = await command();
          const milliseconds = performance.now() - start;
          const summary = await getDashboardSummaryFromDb(db, new Date(fixed));
          const financial = {
            result: normalized(result),
            summary,
            state: JSON.parse(await native.commandDigest(name)),
          };
          const nodeExpected = nodeOracle.find(
            s =>
              s.size === size &&
              s.shared === shared &&
              s.operation === operation,
          );
          equal(
            financial.summary,
            nodeExpected.summary,
            'Hermes/Node exact dashboard ' + operation,
          );
          equal(
            financial.result.effects,
            nodeExpected.effects,
            'Hermes/Node exact command effects ' + operation,
          );
          equal(
            Object.fromEntries(
              Object.entries(financial.state).map(([table, value]) => [
                table,
                value.count,
              ]),
            ),
            nodeExpected.counts,
            'Hermes/Node table counts ' + operation,
          );
          if (
            (optimized || version === 'before' || size === 100000) &&
            iteration === 0
          )
            expected.push(financial);
          if ((!optimized && size < 100000) || iteration > 0)
            equal(financial, expected[step], 'before/after exact ' + operation);
          if (operation === 'idempotentReplay' && optimized)
            equal(
              financial.state,
              exactOracle.find(s => s.size === size && s.shared === shared)
                .state,
              'Node/Hermes binary64 persisted terminal state',
            );
          report.push({
            type: 'sample',
            revision: version === 'before' ? 'original' : 'three-fields',
            size,
            shared,
            version,
            iteration,
            operation,
            milliseconds,
            transactionMs: begin === undefined ? null : end - begin,
            reads: queries.filter(q => /^\s*(SELECT|WITH|PRAGMA)/i.test(q.sql))
              .length,
            returnedRows: queries.reduce((n, q) => n + q.rows, 0),
            returnedCharacters: queries.reduce((n, q) => n + q.characters, 0),
            nativeQueryMs: queries.reduce(
              (n, q) => n + (q.nativeQueryMs || 0),
              0,
            ),
            sqlCursorMs: queries.reduce((n, q) => n + (q.sqlCursorMs || 0), 0),
            financial,
          });
          await emit(report[report.length - 1]);
          step++;
          return result;
        });
        equal(
          (await rows(db, 'PRAGMA foreign_key_check')).length,
          0,
          'campaign FK',
        );
        await db.close();
      }
    }
  }
  await emit({
    type: 'complete',
    config,
    financialEquality: true,
    equalityComparedVolumes: [1000, 10000],
    nodeOracleComparedVolumes: [1000, 10000, 100000],
    beforeAndroidVolumes: [1000, 10000],
    afterAndroidVolumes: [1000, 10000, 100000],
    samples: report.length,
    revision: 'three-fields',
  });
}
async function verifyExistingBinary() {
  for (const [size, shared] of [
    [1000, 10],
    [10000, 100],
  ]) {
    const after = JSON.parse(
      await native.commandDigest(
        `dashboard_phase2_cmd_${size}_${shared}_after_0.db`,
      ),
    );
    equal(
      after,
      exactOracle.find(s => s.size === size && s.shared === shared).state,
      'existing physical terminal state equals Node binary64',
    );
    if (size < 100000)
      equal(
        after,
        JSON.parse(
          await native.commandDigest(
            `dashboard_phase2_cmd_${size}_${shared}_before_0.db`,
          ),
        ),
        'original/optimized physical terminal binary64',
      );
  }
  await emit({
    type: 'binary64-pass',
    checks: [
      'physicalBeforeAfter1000',
      'physicalBeforeAfter10000',
      'NodeHermes1000',
      'NodeHermes10000',
    ],
  });
}
async function creditAndCompanions() {
  const name =
    config.version === 'verify3'
      ? 'dashboard_phase2_cmd_credit6.db'
      : 'dashboard_phase2_cmd_credit.db';
  await native.commandSeed(name, SQLITE_SCHEMA_STATEMENTS);
  const db = await SQLite.openDatabase({ name, location: 'default' });
  await db.executeSql('PRAGMA foreign_keys=ON');
  await applyVersionedMigrations(db);
  const seed = seedStatements(1000, 10);
  for (let i = 0; i < seed.length; i += 500)
    await native.commandSeed(name, seed.slice(i, i + 500));
  const api = afterApi(afterRepo(db));
  const deps = {
    accountRepository: createSqliteAccountRepository(db),
    transactionRepository: createSqliteTransactionRepository(db),
    creditCardRepository: createSqliteCreditCardRepository(db),
  };
  const input = {
    purchase: {
      accountId: 'card',
      amount: 30000,
      categoryId: 'food',
      merchantName: 'Synthetic credit',
      operationType: 'Crédito',
      installmentCount: 3,
      occurrence: { kind: 'date', date: '2026-10-05' },
    },
    distribution: {
      mode: 'amounts',
      personalAmount: 15000,
      participants: [{ contactId: 'person', amount: 15000 }],
    },
  };
  const created = await api.createPurchase('credit-create', input);
  equal(
    (
      await rows(
        db,
        "SELECT debt_balance_amount AS debt FROM accounts WHERE id='card'",
      )
    )[0].debt,
    30000,
    'credit full debt',
  );
  equal(
    (
      await rows(
        db,
        'SELECT installment_count FROM installment_purchases WHERE transaction_id=?',
        [created.transactions[0].id],
      )
    )[0].installment_count,
    3,
    'persisted three installments',
  );
  const before = await getDashboardSummaryFromDb(db, new Date(fixed));
  await api.forgiveParticipation('credit-loss', {
    participationId: 'shared:credit-create:split:1',
    amount: 5000,
    date: '2026-10-10',
  });
  const after = await getDashboardSummaryFromDb(db, new Date(fixed));
  equal(
    [after.availableBalance, after.totalDebt, after.monthlyExpenses],
    [before.availableBalance, before.totalDebt, before.monthlyExpenses],
    'credit loss preserves bank debt and consumption',
  );
  equal(after.netWorth, before.netWorth - 5000, 'credit loss exact wealth');
  await api.createPurchase('credit-create', input);
  equal(
    (await rows(db, 'SELECT COUNT(*) AS n FROM transactions'))[0].n,
    1001,
    'credit replay does not duplicate',
  );
  await registerCreditCardPayment({
    ...deps,
    accountId: 'card',
    sourceAccountId: 'bank',
    amount: 30000,
    currentDate: new Date(fixed),
  });
  const paid = await getDashboardSummaryFromDb(db, new Date(fixed));
  equal(
    [paid.netWorth, paid.monthlyExpenses, paid.totalDebt],
    [after.netWorth, after.monthlyExpenses, 0],
    'credit payment exact wealth consumption and debt',
  );
  const transfer = await saveManualTransaction({
    ...deps,
    accounts: await deps.accountRepository.getAccounts(),
    accountId: 'bank',
    targetAccountId: 'target',
    amount: 10000,
    categoryId: 'food',
    merchantName: 'Synthetic transfer',
    transactionType: 'internalTransfer',
    operationType: 'Débito',
    transferTaxCharged: true,
    hasInterestFreeInstallments: false,
    installmentCountInput: '1',
    interestFreeInstallmentCountInput: '',
    occurrence: { kind: 'date', date: '2026-10-05' },
  });
  const ledgerBefore = await deps.transactionRepository.getTransactions();
  const deleted = await api.deleteMovement(
    'transfer-delete',
    transfer.transaction.id,
  );
  const ledgerIds = new Set(
    (await deps.transactionRepository.getTransactions()).map(t => t.id),
  );
  equal(
    deleted.deletedTransactionIds,
    ledgerBefore.filter(t => !ledgerIds.has(t.id)).map(t => t.id),
    'companion ordering matches full ledger',
  );
  equal(deleted.effects.availableDelta, 40, 'tax reversal');
  equal(
    await getDashboardSummaryFromDb(db, new Date(fixed)),
    paid,
    'transfer delete exact dashboard',
  );
  equal(
    (await rows(db, 'PRAGMA foreign_key_check')).length,
    0,
    'credit and companions FK',
  );
  await db.close();
  await emit({
    type: 'credit-companions-pass',
    checks: [
      'fullCreditDebt',
      'installments',
      'lossBankDebtConsumption',
      'exactWealthLoss',
      'creditIdempotency',
      'paymentWealthDebtConsumption',
      'companionOrdering',
      'taxReversal',
      'FK',
    ],
    purchase: created.entityId,
  });
}
async function run(setText) {
  await emit({ type: 'start', config, hermes: true });
  if (config.version === 'prepare' || config.version === 'prepare3')
    await migrationAndRestart();
  else if (config.version === 'verify3') {
    await restart();
    await creditAndCompanions();
    await emit({
      type: 'complete',
      revision: 'three-fields',
      scope: 'migration-restart-credit-rollback',
    });
  } else if (config.version === 'optimized') {
    await verifyExistingBinary();
    await benchmarks(setText);
  } else {
    await restart();
    await creditAndCompanions();
    await benchmarks(setText);
  }
  setText('PASS');
}
export default function App() {
  const [text, setText] = useState('Synthetic command audit');
  useEffect(() => {
    run(setText).catch(async error => {
      setText('FAIL ' + error.message);
      await emit({ type: 'failure', error: error.message, stack: error.stack });
    });
  }, []);
  return (
    <View style={{ padding: 30 }}>
      <Text>{text}</Text>
    </View>
  );
}
