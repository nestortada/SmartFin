jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
jest.mock('react-native-config', () => ({}));

import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { executeAiCommandPlan } from '../src/modules/transactions/useCases/executeAiCommandPlan';
import type { AiCommandPlan } from '../src/modules/transactions/types';

function transferPlan(taxed: boolean): AiCommandPlan {
  return {
    version: 1,
    summary: 'Transferencia entre cuentas',
    answeredFields: [],
    actions: [{
      id: 'transfer', entity: 'transaction', operation: 'create',
      fields: {
        accountId: 'bank', targetAccountId: 'target', amount: 10000,
        date: '2026-10-11', description: 'Transferencia entre cuentas',
        transactionType: 'internalTransfer', transferTaxCharged: taxed,
      },
    }],
  };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

test.each([false, true])('AI transfer with tax=%s saves both legs and keeps deduplication on the principal', async taxed => {
  const f = await financialIntegrityFixture();
  try {
    const plan = transferPlan(taxed);
    const result = await executeAiCommandPlan(f.database, 'draft-transfer', plan);
    expect(result.completed).toHaveLength(1);
    const transactions = await f.transactionRepository.getTransactions();
    const principal = transactions.find(tx => tx.direction === 'outflow' && tx.type === 'internalTransfer')!;
    expect(principal).toMatchObject({ accountId: 'bank', targetAccountId: 'target', amount: 10000, dedupeKey: 'draft-transfer:transfer' });
    expect(transactions.find(tx => tx.id === `${principal.id}-in`)).toMatchObject({
      accountId: 'target', targetAccountId: 'bank', direction: 'inflow', amount: 10000, dedupeKey: undefined,
    });
    expect(transactions).toHaveLength(taxed ? 3 : 2);
    if (taxed) expect(transactions.find(tx => tx.id === `${principal.id}-4x1000`)).toMatchObject({
      accountId: 'bank', type: 'expense', direction: 'outflow', amount: 40, dedupeKey: undefined,
    });
    expect(await f.snapshot()).toMatchObject({
      balances: { bank: taxed ? 989960 : 990000, target: 10000 }, debt: 0,
      available: taxed ? 999960 : 1000000, wealth: taxed ? 999960 : 1000000,
      income: 0, expense: taxed ? 40 : 0,
    });

    const beforeRetry = await f.snapshot();
    // Phase 4 recognizes the committed intention durably instead of reaching a UNIQUE error.
    await expect(executeAiCommandPlan(f.database, 'draft-transfer', plan)).resolves.toEqual(result);
    expect(await f.snapshot()).toEqual(beforeRetry);
    expect(await f.transactionRepository.getTransactions()).toEqual(transactions);

    const action = plan.actions[0]!;
    if (action.entity !== 'transaction') throw new Error('Expected a transfer action');
    const edit: AiCommandPlan = {
      ...plan,
      actions: [{ ...action, operation: 'update', targetId: principal.id,
        fields: { ...action.fields, amount: 20000 } }],
    };
    await executeAiCommandPlan(f.database, 'draft-edit', edit);
    const edited = await f.transactionRepository.getTransactions();
    expect(edited.map(tx => tx.id).sort()).toEqual(transactions.map(tx => tx.id).sort());
    expect(edited.find(tx => tx.id === principal.id)).toMatchObject({ dedupeKey: principal.dedupeKey, createdAt: principal.createdAt, amount: 20000 });
    expect(edited.find(tx => tx.id === `${principal.id}-in`)).toMatchObject({ amount: 20000, dedupeKey: undefined });
    expect(await f.snapshot()).toMatchObject({
      balances: { bank: taxed ? 979920 : 980000, target: 20000 },
      available: taxed ? 999920 : 1000000, wealth: taxed ? 999920 : 1000000,
      income: 0, expense: taxed ? 80 : 0,
    });
  } finally { f.native.close(); }
});

test.each([false, true])('AI transfer with tax=%s rolls back the entire batch on companion failure and can be retried', async taxed => {
  const f = await financialIntegrityFixture();
  try {
    const transfer = transferPlan(taxed);
    const plan: AiCommandPlan = {
      ...transfer,
      actions: [{ id: 'income', entity: 'transaction', operation: 'create',
        fields: { accountId: 'bank', amount: 5000, transactionType: 'income', date: '2026-10-11', description: 'Ingreso' } },
      ...transfer.actions],
    };
    const before = await f.snapshot();
    f.injectFault({ phase: 'after', sql: 'INSERT INTO transactions', occurrence: 3 });
    await expect(executeAiCommandPlan(f.database, 'draft-batch', plan)).rejects.toThrow('Injected SQLite failure');
    expect(await f.snapshot()).toEqual(before);
    expect(await f.transactionRepository.getTransactions()).toEqual([]);

    await executeAiCommandPlan(f.database, 'draft-batch', plan);
    expect(await f.snapshot()).toMatchObject({
      balances: { bank: taxed ? 994960 : 995000, target: 10000 },
      wealth: taxed ? 1004960 : 1005000, income: 5000, expense: taxed ? 40 : 0,
    });
    expect(await f.transactionRepository.getTransactions()).toHaveLength(taxed ? 4 : 3);
  } finally { f.native.close(); }
});
