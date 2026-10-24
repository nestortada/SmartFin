import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState, requireIntegralRollback } from './helpers/financialState';
import { manageSQLiteDatabase } from '../src/database/managedSQLite';
import { runSharedSQLiteTransaction } from '../src/database/atomicSQLite';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import type { SQLitePrimitive } from '../src/database/sqliteRows';
import { createSqliteCreditCardRepository } from '../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { createSqliteCreditCardRepository as baselineCards } from './helpers/post3BCreditCardRepositoryBaseline';
import { createSqliteAccountRepository } from '../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { associatePendingTransactionsForCreditCard } from '../src/modules/creditCards/useCases/creditCardTransactionRelations';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

async function setup(count: number, parameterLimit = 999) {
  const f = await financialIntegrityFixture();
  const bindings: number[] = [];
  const validate = (values: SQLitePrimitive[]) => {
    bindings.push(values.length);
    if (values.length > parameterLimit) throw new Error('too many SQL variables (test envelope)');
  };
  const limited = new Proxy(f.database, { get(target, key) {
    if (key === 'executeSql') return (sql: string, values: SQLitePrimitive[] = []) => { validate(values); return target.executeSql(sql, values); };
    if (key === 'transaction') return (callback: Parameters<SmartFinSQLiteDatabase['transaction']>[0]) => target.transaction(tx => callback(new Proxy(tx, { get(transaction, property) {
      if (property === 'executeSql') return (...args: Parameters<typeof tx.executeSql>) => { validate(args[1] ?? []); return transaction.executeSql(...args); };
      return Reflect.get(transaction, property);
    } })));
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const database = manageSQLiteDatabase(limited);
  f.native.exec(`INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at)
    VALUES ('account-credit-card-unclassified','Unclassified','bankAccount','active','COP',0,'2026-01-01','2026-01-01');`);
  if (count) f.native.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<${count})
    INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,payment_method,credit_card_hint,created_at,updated_at)
    SELECT 'purchase-'||n,100+(n%3)*0.25,'COP','Visa',CASE WHEN n%2=0 THEN '2024-01-10' ELSE '2026-10-10' END,
      'account-credit-card-unclassified','expense','outflow',CASE WHEN n%13=0 THEN 'cancelled' WHEN n%3=0 THEN 'pending' ELSE 'posted' END,
      'credit','Visa','2026-01-01','2026-01-01' FROM seq;
    INSERT INTO installment_purchases(id,transaction_id,account_id,total_amount,currency,installment_count,paid_installments,monthly_amount,first_due_date,status,created_at,updated_at)
    SELECT 'installment-'||id,id,account_id,amount,'COP',3,1,ROUND(amount/3),'2026-11-25','active','2026-01-01','2026-01-01' FROM transactions;`);
  const repository = createSqliteCreditCardRepository(database);
  const associate = async (historical = false) => {
    const result = await runSharedSQLiteTransaction(database, async participant => {
      const accountRepository = createSqliteAccountRepository(participant);
      return associatePendingTransactionsForCreditCard({ accountRepository,
        creditCardRepository: (historical ? baselineCards : createSqliteCreditCardRepository)(participant),
        transactionRepository: createSqliteTransactionRepository(participant),
        account: (await accountRepository.getAccounts()).find(card => card.id === 'card')!,
      });
    });
    if (result.status !== 'confirmed') throw result.error;
    return result.value;
  };
  return { ...f, database, bindings, repository, associate };
}

test('reproduces the previous binding failure after transaction updates and requires exact rollback', async () => {
  const f = await setup(998);
  try {
    const before = await financialState(f);
    await expect(f.associate(true)).rejects.toThrow('too many SQL variables');
    expect(f.bindings).toContain(1000);
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});

// These tests initially fail against phase 3B, establishing the narrow correction's target.
test.each([0, 1, 997, 998, 1000, 10000])('%s matching purchases are associated without exceeding 999 bindings', async count => {
  const f = await setup(count);
  try {
    expect(await f.associate()).toBe(count);
    expect(Math.max(...f.bindings)).toBeLessThanOrEqual(999);
    expect(f.query("SELECT COUNT(*) AS n FROM transactions WHERE account_id='card'").rows.item(0)?.n).toBe(count);
    expect(f.query("SELECT COUNT(*) AS n FROM installment_purchases WHERE account_id='card' AND paid_installments=1 AND first_due_date='2026-11-25'").rows.item(0)?.n).toBe(count);
    expect(f.query('PRAGMA foreign_key_check').rows.raw()).toEqual([]);
  } finally { f.native.close(); }
}, 60000);

test('ten thousand real matches preserve exact financial rows against the previous successful Node implementation', async () => {
  const current = await setup(10000); const previous = await setup(10000, 32766);
  try {
    expect(await current.associate()).toBe(10000); expect(await previous.associate(true)).toBe(10000);
    expect(await financialState(current)).toEqual(await financialState(previous));
  } finally { current.native.close(); previous.native.close(); }
}, 60000);

test.each(['before', 'after'] as const)('failure %s each fragment restores every row and revision', async phase => {
  for (const occurrence of [1, 2, 3]) {
    const f = await setup(2100);
    try {
      const before = await financialState(f); f.resetTrace();
      f.injectFault({ sql: 'UPDATE installment_purchases', phase, occurrence });
      await expect(f.associate()).rejects.toThrow();
      expect(f.trace.some(entry => entry.outcome === `injected-${phase}`)).toBe(true);
      expect(f.trace.filter(entry => entry.sql.startsWith('ROLLBACK') && entry.outcome === 'ok')).toHaveLength(1);
      requireIntegralRollback(before, await financialState(f));
    } finally { f.native.close(); }
  }
}, 60000);

test('duplicate IDs spanning fragments update each purchase once, preserving revision equivalence', async () => {
  const f = await setup(1000); const previous = await setup(1000, 32766);
  try {
    const ids = Array.from({ length: 1000 }, (_, i) => 'purchase-' + (i + 1));
    const duplicated = [...ids, ...ids.slice(0, 950)];
    await f.repository.updateInstallmentPurchasesAccount(duplicated, 'card');
    await baselineCards(previous.database).updateInstallmentPurchasesAccount(duplicated, 'card');
    expect(await financialState(f)).toEqual(await financialState(previous));
  } finally { f.native.close(); previous.native.close(); }
});

test.each(['before', 'after'] as const)('standalone repository failure %s each fragment is locally atomic', async phase => {
  for (const occurrence of [1, 2, 3]) {
    const f = await setup(2100);
    try {
      const before = await financialState(f); f.resetTrace();
      f.injectFault({ sql: 'UPDATE installment_purchases', phase, occurrence });
      await expect(f.repository.updateInstallmentPurchasesAccount(Array.from({ length: 2100 }, (_, i) => 'purchase-' + (i + 1)), 'card')).rejects.toThrow();
      expect(f.trace.some(entry => entry.outcome === `injected-${phase}`)).toBe(true);
      requireIntegralRollback(before, await financialState(f));
    } finally { f.native.close(); }
  }
}, 60000);
