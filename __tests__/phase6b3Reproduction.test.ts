jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
jest.mock('react-native-config', () => ({}));

import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { NEXT_IMPLEMENTATION, PHASE6B3_DATE, PHASE6B3_PROBES, runPhase6B3Probe } from '../scripts/phase6b3/probes';
import { createSqliteAccountRepository } from '../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { saveManualTransaction } from '../src/modules/transactions/useCases/saveManualTransaction';

// Phase 6B.3 reproduction of 6B-C1 with the production code of the checkout. Run once on the
// unmodified 6B.2 code (commit 8985346) to record the evidence before the correction:
//   PHASE6B3_REPRODUCTION=before npm test -- --runInBand __tests__/phase6b3Reproduction.test.ts
// Without the variable it only checks that every probe runs on a valid SQLite database.
const fs = require('node:fs') as { writeFileSync: (f: string, c: string) => void; mkdirSync: (p: string, o: object) => void };
const process = require('node:process') as { env: Record<string, string | undefined> };

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(PHASE6B3_DATE);
});
afterEach(() => jest.useRealTimers());

test('6B.3 probes run through the production payment use case on real SQLite', async () => {
  const results: Record<string, unknown> = {};
  for (const probe of PHASE6B3_PROBES) {
    const sql = realSQLite({ fixedSqlDate: PHASE6B3_DATE });
    try {
      sql.native.exec('PRAGMA foreign_keys = ON;');
      for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
      await applyVersionedMigrations(sql.database);
      results[probe] = await runPhase6B3Probe(sql.database, probe, NEXT_IMPLEMENTATION);
      expect(sql.query('PRAGMA integrity_check').rows.raw()).toEqual([{ integrity_check: 'ok' }]);
      expect(sql.query('PRAGMA foreign_key_check').rows.raw()).toEqual([]);
    } finally { sql.native.close(); }
  }
  if (process.env.PHASE6B3_REPRODUCTION === 'before') {
    fs.mkdirSync('docs/correccion-fase6b3/node', { recursive: true });
    fs.writeFileSync('docs/correccion-fase6b3/node/reproduction-before-fix.json', JSON.stringify(results, null, 2) + '\n');
  }
  expect(Object.keys(results)).toEqual([...PHASE6B3_PROBES]);
});

// 6B.3.1: the Android campaigns ran with the device clock (2026-11-01) and failed on
// scenarioA.initial.statement.minimum_payment_amount (0 instead of 1000). Not a settlement defect:
// the purchase reconciliation reads the wall clock and selected the November statement.
const DEVICE_DATE = new Date('2026-11-01T15:00:00.000Z');

async function freshDatabase() {
  const sql = realSQLite({ fixedSqlDate: PHASE6B3_DATE });
  sql.native.exec('PRAGMA foreign_keys = ON;');
  for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  return sql;
}

test('6B.3.1 reproduction: a purchase dated on the probe day reconciles with the wall clock', async () => {
  jest.setSystemTime(DEVICE_DATE);
  const sql = await freshDatabase();
  try {
    await sql.database.executeSql(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,created_at,updated_at)
      VALUES ('card','Visa','creditCard','active','COP',0,0,'2026-01-01','2026-01-01')`);
    const deps = {
      accountRepository: createSqliteAccountRepository(sql.database),
      transactionRepository: createSqliteTransactionRepository(sql.database),
      creditCardRepository: createSqliteCreditCardRepository(sql.database),
    };
    await saveManualTransaction({
      ...deps, accounts: await deps.accountRepository.getAccounts(), accountId: 'card', amount: 10000.4,
      merchantName: 'Sintetico 6B.3.1', operationType: 'Crédito', transactionType: 'expense', hasInterestFreeInstallments: false,
      installmentCountInput: '1', interestFreeInstallmentCountInput: '', currentDate: PHASE6B3_DATE,
    });
    expect(sql.query("SELECT total_amount, minimum_payment_amount FROM credit_card_statements WHERE account_id = 'card'").rows.raw())
      .toEqual([{ total_amount: 0, minimum_payment_amount: 0 }]);
  } finally { sql.native.close(); }
});

test('6B.3.1 probes do not depend on the device clock', async () => {
  const run = async (clock: Date) => {
    jest.setSystemTime(clock);
    const sql = await freshDatabase();
    try { return await runPhase6B3Probe(sql.database, 'scenarioA', NEXT_IMPLEMENTATION); } finally { sql.native.close(); }
  };
  const fixed = await run(PHASE6B3_DATE);
  const device = await run(DEVICE_DATE);
  expect(device).toEqual(fixed);
  expect(fixed).toMatchObject({ initial: { statement: { total_amount: 10000.4, minimum_payment_amount: 1000, status: 'pending' } } });
  expect(Date.now()).toBe(DEVICE_DATE.getTime());
});
