import { sharedExpenseFixture } from './helpers/sharedExpenseFixture';
import { sharedFinancialSnapshot } from '../src/modules/transactions/useCases/sharedCommandEffects';
import { sqliteSharedCommandReads } from '../src/modules/transactions/repositories/sqliteSharedCommandReads';
import type { Transaction } from '../src/modules/transactions/types';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));

test('loss, recovery and allocation commands never transport ledger rows', async () => {
  const f = await sharedExpenseFixture();
  try {
    const purchase = await f.purchase();
    const receipt = await f.api.recordReceipt('advance', {
      contactId: f.contactId,
      accountId: 'target',
      amount: 1000,
      occurrence: { kind: 'date', date: '2026-10-10' },
    });
    for (const command of [
      () =>
        f.api.applyReceipt(
          'apply',
          receipt.entityId,
          purchase.participationId,
          500,
        ),
      () =>
        f.api.forgiveParticipation('loss', {
          participationId: purchase.participationId,
          amount: 500,
          date: '2026-10-10',
        }),
      () =>
        f.api.recoverForgiveness('recover', {
          forgivenessId: 'shared:loss:loss',
          receiptId: receipt.entityId,
          amount: 500,
          date: '2026-10-10',
        }),
      () =>
        f.api.reverseLossEvent('reverse', {
          eventId: 'shared:recover:loss',
          date: '2026-10-10',
        }),
    ]) {
      f.resetTrace();
      const result = await command();
      expect(result.transactions).toEqual([]);
      expect(f.trace.some(q => /FROM transactions\b/i.test(q.sql))).toBe(false);
      expect(f.trace.filter(q => q.sql === 'BEGIN IMMEDIATE;')).toHaveLength(1);
      expect(f.trace.filter(q => q.sql === 'COMMIT;')).toHaveLength(1);
    }
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});

test('narrow posted projection retains exact REAL reductions with ties, old statuses, closed accounts and credit', async () => {
  const f = await sharedExpenseFixture();
  try {
    await f.purchase();
    const template: Transaction = {
      id: 'x',
      amount: 0.1,
      currency: 'COP',
      description: 'Synthetic',
      date: '2026-10-05',
      accountId: 'bank',
      type: 'income',
      direction: 'inflow',
      status: 'posted',
      paymentMethod: 'debit',
      createdAt: 'same-sort-key',
      updatedAt: 'fixed',
    };
    const transactions: Transaction[] = [
      { ...template, id: 'big', amount: 90071992547400 },
      { ...template, id: 'small' },
      { ...template, id: 'small-2', amount: 0.2 },
      { ...template, id: 'pending', status: 'pending', amount: 7 },
      { ...template, id: 'cancelled', status: 'cancelled', amount: 9 },
      {
        ...template,
        id: 'credit',
        accountId: 'card',
        type: 'expense',
        direction: 'outflow',
        paymentMethod: 'credit',
      },
      {
        ...template,
        id: 'neutral',
        type: 'manualAdjustment',
        direction: 'neutral',
      },
      { ...template, id: 'refund', type: 'refund' },
      {
        ...template,
        id: 'transfer',
        type: 'internalTransfer',
        direction: 'outflow',
      },
      { ...template, id: 'null-payment', paymentMethod: undefined },
      { ...template, id: 'wrong-direction', direction: 'outflow' },
    ];
    await f.transactionRepository.saveTransactions(transactions);
    const accounts = await f.accountRepository.getAccounts();
    const state = await f.sharedRepository.getState();
    const full = await f.transactionRepository.getTransactions();
    const narrow = await sqliteSharedCommandReads(
      f.database,
    ).readEffectTransactions();
    expect(sharedFinancialSnapshot(accounts, narrow, state)).toEqual(
      sharedFinancialSnapshot(accounts, full, state),
    );
    expect(narrow.map(t => t.id)).not.toContain('neutral');
    accounts.find(a => a.id === 'bank')!.status = 'closed';
    expect(sharedFinancialSnapshot(accounts, narrow, state)).toEqual(
      sharedFinancialSnapshot(accounts, full, state),
    );
  } finally {
    f.native.close();
  }
});

test('changed rows span Android-safe parameter batches and retain global ledger order', async () => {
  const f = await sharedExpenseFixture();
  try {
    const execute = f.database.executeSql;
    f.database.executeSql = (sql, values = []) => {
      if (values.length > 999) throw new Error('Android bind limit');
      return execute(sql, values);
    };
    const command = sqliteSharedCommandReads(f.database);
    const saved: Transaction[] = Array.from({ length: 1005 }, (_, i) => ({
      id: `batch-${i}`,
      amount: 0.1,
      currency: 'COP',
      description: 'Synthetic',
      date: i % 2 ? '2026-10-05' : '2026-10-06',
      accountId: 'bank',
      type: 'expense',
      direction: 'outflow',
      status: 'posted',
      createdAt: 'same',
      updatedAt: 'same',
    }));
    await command.transactionRepository.saveTransactions(saved);
    expect((await command.readTransactionChanges()).transactions).toEqual(
      await f.transactionRepository.getTransactions(),
    );
    expect(
      f.trace.filter(q => q.sql.includes('FROM transactions WHERE id IN')),
    ).toHaveLength(4);
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});

test('failure while reading changed rows rolls back bank, movement, sharing and idempotency receipt', async () => {
  const f = await sharedExpenseFixture();
  try {
    const accounts = await f.accountRepository.getAccounts();
    const state = await f.sharedRepository.getState();
    const transactions = await f.transactionRepository.getTransactions();
    f.failOn('FROM transactions WHERE id IN');
    await expect(f.purchase()).rejects.toThrow('Injected SQLite failure');
    f.failOn();
    expect(await f.accountRepository.getAccounts()).toEqual(accounts);
    expect(await f.sharedRepository.getState()).toEqual(state);
    expect(await f.transactionRepository.getTransactions()).toEqual(
      transactions,
    );
    expect(
      f.query("SELECT * FROM shared_commands WHERE id='purchase'").rows.length,
    ).toBe(0);
    await f.purchase();
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});

test('deleting a transfer through the shared facade preserves companion ordering and exact tax reversal', async () => {
  const f = await sharedExpenseFixture();
  try {
    const saved = await f.save({
      transactionType: 'internalTransfer',
      targetAccountId: 'target',
      amount: 10000,
      transferTaxCharged: true,
    });
    const before = await f.transactionRepository.getTransactions();
    const balances = await f.balances();
    const result = await f.api.deleteMovement(
      'delete-transfer',
      saved.transaction.id,
    );
    const afterIds = new Set(
      (await f.transactionRepository.getTransactions()).map(t => t.id),
    );
    expect(result.deletedTransactionIds).toEqual(
      before.filter(t => !afterIds.has(t.id)).map(t => t.id),
    );
    expect(result.effects!.availableDelta).toBe(40);
    expect(result.effects!.accounts).toEqual([
      { accountId: 'bank', balanceDelta: 10040, debtDelta: 0 },
      { accountId: 'target', balanceDelta: -10000, debtDelta: 0 },
    ]);
    expect(balances.bank).toBe(989960);
    expect(await f.balances()).toEqual({ bank: 1000000, target: 0, card: 0 });
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});
