import {
  sharedExpenseFixture,
  SHARED_TEST_DATE,
} from './helpers/sharedExpenseFixture';
import {
  distributeSharedExpense,
  toMinor,
} from '../src/modules/transactions/useCases/sharedExpenseDomain';
import { createSharedExpenseApi } from '../src/modules/transactions/useCases/createSharedExpenseApi';
import { createSqliteSharedExpenseRepository } from '../src/modules/transactions/repositories/sqliteSharedExpenseRepository';
import { getDebitCardsOverview } from '../src/modules/accounts/useCases/getDebitCardsOverview';
import { registerCreditCardPayment } from '../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { updateTransactionQuickly } from '../src/modules/transactions/useCases/updateTransactionQuickly';
import { createSqliteFinancialDataRepository } from '../src/modules/settings/repositories/sqliteFinancialDataRepository';
import { applyVersionedMigrations } from '../src/database/migrations';
import type { SharedCommandResult } from '../src/modules/transactions/types/SharedExpense';
import { executeAiCommandPlan } from '../src/modules/transactions/useCases/executeAiCommandPlan';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'],
  });
  jest.setSystemTime(SHARED_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

test.each(['after', 'before', 'otherAccount'])(
  'purchase and reimbursement preserve all financial indicators (%s)',
  async order => {
    const f = await sharedExpenseFixture();
    try {
      let receipt: SharedCommandResult | undefined;
      if (order === 'before') {
        receipt = await f.api.recordReceipt('receipt', {
          contactId: f.contactId,
          accountId: 'bank',
          amount: 15000,
          occurrence: { kind: 'date', date: '2026-10-01' },
        });
        expect(await f.summary()).toMatchObject({
          availableBalance: 1015000,
          netWorth: 1000000,
          monthlyIncome: 0,
        });
        expect(await f.api.getPosition()).toMatchObject({
          receivables: 0,
          thirdPartyAdvances: 15000,
        });
      }
      const expense = await f.purchase();
      if (receipt)
        await f.api.applyReceipt(
          'apply',
          receipt.entityId,
          expense.participationId,
          15000,
        );
      else {
        expect(await f.summary()).toMatchObject({
          availableBalance: 970000,
          netWorth: 985000,
          monthlyExpenses: 15000,
          monthlyIncome: 0,
        });
        receipt = await f.api.recordReceipt('receipt', {
          contactId: f.contactId,
          accountId: order === 'otherAccount' ? 'target' : 'bank',
          amount: 15000,
          applications: [
            { participationId: expense.participationId, amount: 15000 },
          ],
        });
      }
      expect(await f.api.getExpense(expense.entityId)).toMatchObject({
        status: 'completed',
        personalAmount: 15000,
        receivedAmount: 15000,
        pendingAmount: 0,
      });
      expect(await f.summary()).toMatchObject({
        availableBalance: 985000,
        netWorth: 985000,
        monthlyIncome: 0,
        monthlyExpenses: 15000,
        monthlySavings: -15000,
        totalDebt: 0,
      });
      expect(await f.balances()).toEqual({
        bank: order === 'otherAccount' ? 970000 : 985000,
        target: order === 'otherAccount' ? 15000 : 0,
        card: 0,
      });
      const transactions = await f.transactionRepository.getTransactions();
      expect(transactions).toHaveLength(2);
      expect(
        transactions.find(t => t.id === expense.transaction?.id)?.amount,
      ).toBe(30000);
      const debit = await getDebitCardsOverview(f, SHARED_TEST_DATE);
      expect(
        debit.cards.reduce((sum, c) => sum + c.monthlyMetrics.income, 0),
      ).toBe(0);
      expect(
        debit.cards.reduce(
          (sum, c) => sum + (c.monthlyMetrics.reimbursementsReceived ?? 0),
          0,
        ),
      ).toBe(15000);
      expect(
        debit.cards.reduce((sum, c) => sum + c.monthlyMetrics.netFlow, 0),
      ).toBe(-15000);
      f.verifyForeignKeys();
    } finally {
      f.native.close();
    }
  },
);

test('partial payments across months leave the expense in its original period', async () => {
  const f = await sharedExpenseFixture();
  try {
    const expense = await f.purchase();
    await f.api.recordReceipt('first', {
      contactId: f.contactId,
      accountId: 'bank',
      amount: 10000,
      occurrence: { kind: 'date', date: '2026-10-10' },
      applications: [
        { participationId: expense.participationId, amount: 10000 },
      ],
    });
    expect(await f.api.getExpense(expense.entityId)).toMatchObject({
      status: 'partiallyReimbursed',
      pendingAmount: 5000,
      receivedAmount: 10000,
    });
    await f.api.recordReceipt('second', {
      contactId: f.contactId,
      accountId: 'target',
      amount: 5000,
      occurrence: { kind: 'date', date: '2026-11-02' },
      applications: [
        { participationId: expense.participationId, amount: 5000 },
      ],
    });
    expect(await f.api.getPosition('2026-10-31')).toMatchObject({
      receivables: 5000,
      thirdPartyAdvances: 0,
    });
    expect(await f.api.getPosition()).toMatchObject({
      receivables: 0,
      thirdPartyAdvances: 0,
    });
    expect(await f.summary()).toMatchObject({
      monthlyExpenses: 15000,
      monthlyIncome: 0,
      netWorth: 985000,
    });
    expect(await f.summary(new Date('2026-11-15T12:00:00Z'))).toMatchObject({
      monthlyExpenses: 0,
      monthlyIncome: 0,
      netWorth: 985000,
    });
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});

test('several participants have individual balances and the full purchase stays on the bank ledger', async () => {
  const f = await sharedExpenseFixture();
  try {
    const b = (await f.api.saveContact('personB', 'B')).entityId;
    const c = (await f.api.saveContact('personC', 'C')).entityId;
    const purchase = await f.api.createPurchase('dinner', {
      purchase: {
        accountId: 'bank',
        amount: 90000,
        categoryId: 'food',
        merchantName: 'Cena',
        operationType: 'Débito',
      },
      distribution: {
        mode: 'amounts',
        personalAmount: 30000,
        participants: [
          { contactId: f.contactId, amount: 20000 },
          { contactId: b, amount: 25000 },
          { contactId: c, amount: 15000 },
        ],
      },
    });
    const overview = await f.api.getExpense(purchase.entityId);
    expect(overview.participants.map(p => p.pendingAmount).sort()).toEqual([
      15000, 20000, 25000,
    ]);
    expect(await f.summary()).toMatchObject({
      availableBalance: 910000,
      netWorth: 970000,
      monthlyExpenses: 30000,
      monthlyIncome: 0,
    });
    expect(await f.api.getPosition()).toMatchObject({ receivables: 60000 });
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});

test('linking an imported income preserves the bank movement and excludes it from personal income', async () => {
  const f = await sharedExpenseFixture();
  try {
    const expense = await f.purchase();
    const imported = await f.save({
      transactionType: 'income',
      categoryId: undefined,
      amount: 15000,
      merchantName: 'Transferencia amiga',
      occurrence: { kind: 'date', date: '2026-10-09' },
    });
    f.native
      .prepare(
        'INSERT INTO raw_financial_messages(id,source_type,raw_text,received_at,parsed_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        'source',
        'imported',
        'Synthetic financial source',
        imported.transaction.date,
        'parsed',
        imported.transaction.date,
        imported.transaction.date,
      );
    f.native
      .prepare('UPDATE transactions SET source_message_id=? WHERE id=?')
      .run('source', imported.transaction.id);
    const before = f
      .query('SELECT * FROM transactions WHERE id=?', [imported.transaction.id])
      .rows.raw();
    const balances = await f.balances();
    await f.api.recordReceipt('link', {
      contactId: f.contactId,
      transactionId: imported.transaction.id,
      applications: [
        { participationId: expense.participationId, amount: 15000 },
      ],
    });
    expect(await f.balances()).toEqual(balances);
    expect(
      f
        .query('SELECT * FROM transactions WHERE id=?', [
          imported.transaction.id,
        ])
        .rows.raw(),
    ).toEqual(before);
    expect(await f.summary()).toMatchObject({
      monthlyIncome: 0,
      monthlyExpenses: 15000,
      netWorth: 985000,
    });
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});

test('commands remain idempotent after reconstructing the API and reject changed payloads and duplicate links', async () => {
  const f = await sharedExpenseFixture();
  try {
    const expense = await f.purchase();
    const input = {
      contactId: f.contactId,
      accountId: 'bank',
      amount: 15000,
      applications: [
        { participationId: expense.participationId, amount: 15000 },
      ],
    };
    const first = await f.api.recordReceipt('receipt', input);
    const api = createSharedExpenseApi(
      createSqliteSharedExpenseRepository(f.database),
    );
    expect(await api.recordReceipt('receipt', input)).toEqual(first);
    await expect(
      api.recordReceipt('receipt', { ...input, amount: 10000 }),
    ).rejects.toThrow('otros datos');
    await expect(
      api.recordReceipt('duplicate', {
        contactId: f.contactId,
        transactionId: first.transaction!.id,
      }),
    ).rejects.toThrow('vinculado');
    await expect(
      api.applyReceipt(
        'duplicateApply',
        first.entityId,
        expense.participationId,
        15000,
      ),
    ).rejects.toThrow('supera');
    expect(await f.balances()).toMatchObject({ bank: 985000 });
    expect(await f.transactionRepository.getTransactions()).toHaveLength(2);
  } finally {
    f.native.close();
  }
});

test('excess is rejected atomically unless explicitly retained as an advance', async () => {
  const f = await sharedExpenseFixture();
  try {
    const expense = await f.purchase();
    const input = {
      contactId: f.contactId,
      accountId: 'bank',
      amount: 20000,
      applications: [
        { participationId: expense.participationId, amount: 15000 },
      ],
    };
    const before = await f.summary();
    await expect(f.api.recordReceipt('rejectExcess', input)).rejects.toThrow(
      'excedente',
    );
    expect(await f.summary()).toEqual(before);
    const receipt = await f.api.recordReceipt('allowExcess', {
      ...input,
      excessPolicy: 'keepAsAdvance',
    });
    expect(await f.api.getPosition()).toMatchObject({
      receivables: 0,
      thirdPartyAdvances: 5000,
    });
    expect(await f.summary()).toMatchObject({
      availableBalance: 990000,
      netWorth: 985000,
      monthlyIncome: 0,
    });
    await f.api.returnAdvance('return', {
      receiptId: receipt.entityId,
      accountId: 'target',
      amount: 5000,
    });
    expect(await f.summary()).toMatchObject({
      availableBalance: 985000,
      netWorth: 985000,
      monthlyIncome: 0,
      monthlyExpenses: 15000,
    });
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});

test('credit purchase keeps full card debt and reimbursement never pays the card or adds income', async () => {
  const f = await sharedExpenseFixture();
  try {
    const expense = await f.api.createPurchase('credit', {
      purchase: {
        accountId: 'card',
        amount: 30000,
        categoryId: 'food',
        merchantName: 'Cena Visa',
        operationType: 'Crédito',
        installmentCount: 3,
      },
      distribution: f.distribution,
    });
    const participant = (await f.api.getExpense(expense.entityId))
      .participants[0]!;
    expect(await f.summary()).toMatchObject({
      availableBalance: 1000000,
      totalDebt: 30000,
      monthlyExpenses: 15000,
      netWorth: 985000,
    });
    await f.api.recordReceipt('receipt', {
      contactId: f.contactId,
      accountId: 'target',
      amount: 15000,
      applications: [
        { participationId: participant.participationId, amount: 15000 },
      ],
    });
    expect(await f.summary()).toMatchObject({
      availableBalance: 1015000,
      totalDebt: 30000,
      monthlyExpenses: 15000,
      monthlyIncome: 0,
      netWorth: 985000,
    });
    await registerCreditCardPayment({
      ...f,
      accountId: 'card',
      sourceAccountId: 'bank',
      amount: 30000,
      currentDate: SHARED_TEST_DATE,
    });
    expect(await f.summary()).toMatchObject({
      availableBalance: 985000,
      totalDebt: 0,
      monthlyExpenses: 15000,
      monthlyIncome: 0,
      netWorth: 985000,
    });
    expect(
      (await f.creditCardRepository.getInstallmentPurchases(['card']))[0],
    ).toMatchObject({ totalAmount: 30000, monthlyAmount: 10000 });
  } finally {
    f.native.close();
  }
});

test('cancel requires resolving payments; unlink preserves the bank balance and creates an advance', async () => {
  const f = await sharedExpenseFixture();
  try {
    const expense = await f.purchase();
    await f.api.recordReceipt('receipt', {
      contactId: f.contactId,
      accountId: 'bank',
      amount: 10000,
      applications: [
        { participationId: expense.participationId, amount: 10000 },
      ],
    });
    expect(await f.api.previewCancellation(expense.entityId)).toMatchObject({
      blocked: true,
      bankBalanceDelta: 0,
    });
    await expect(
      f.api.cancelDivision('cancelBlocked', expense.entityId),
    ).rejects.toThrow('abonos');
    const application = (await f.api.getHistory()).allocations[0]!;
    const balances = await f.balances();
    await f.api.unlinkAllocation('unlink', application.id);
    expect(await f.balances()).toEqual(balances);
    expect(await f.api.getPosition()).toMatchObject({
      receivables: 15000,
      thirdPartyAdvances: 10000,
    });
    await f.api.cancelDivision('cancel', expense.entityId);
    expect(await f.summary()).toMatchObject({
      availableBalance: 980000,
      netWorth: 970000,
      monthlyExpenses: 30000,
      monthlyIncome: 0,
    });
    await f.api.updateDistribution(
      'reactivate',
      expense.entityId,
      f.distribution,
    );
    expect(await f.summary()).toMatchObject({
      netWorth: 985000,
      monthlyExpenses: 15000,
    });
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});

test('deleting a receipt reopens the receivable and deletion of an allocated purchase is blocked', async () => {
  const f = await sharedExpenseFixture();
  try {
    const expense = await f.purchase();
    const receipt = await f.api.recordReceipt('receipt', {
      contactId: f.contactId,
      accountId: 'target',
      amount: 15000,
      applications: [
        { participationId: expense.participationId, amount: 15000 },
      ],
    });
    await expect(
      f.api.deleteMovement('deleteBlocked', expense.transaction!.id),
    ).rejects.toThrow('abonos');
    await f.api.deleteMovement('deleteReceipt', receipt.transaction!.id);
    expect(await f.api.getExpense(expense.entityId)).toMatchObject({
      pendingAmount: 15000,
      status: 'pending',
    });
    expect(await f.summary()).toMatchObject({
      availableBalance: 970000,
      netWorth: 985000,
      monthlyExpenses: 15000,
      monthlyIncome: 0,
    });
    await f.api.deleteMovement('deletePurchase', expense.transaction!.id);
    expect(await f.summary()).toMatchObject({
      availableBalance: 1000000,
      netWorth: 1000000,
      monthlyExpenses: 0,
    });
    expect((await f.api.getHistory()).expenses[0]).toMatchObject({
      expense: { status: 'deleted' },
      personalAmount: 15000,
      participants: [{ name: 'Amiga', amount: 15000 }],
    });
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});

test('normal edits cannot change a shared amount; the coordinated API updates its bank balance and distribution', async () => {
  const f = await sharedExpenseFixture();
  try {
    const expense = await f.purchase();
    const before = await f.summary();
    await expect(
      f.save({ editingTransaction: expense.transaction!, amount: 40000 }),
    ).rejects.toThrow('participaciones');
    expect(await f.summary()).toEqual(before);
    const updated = await f.api.updatePurchase(
      'edit',
      expense.entityId,
      {
        accountId: 'bank',
        amount: 40000,
        merchantName: 'Cena editada',
        operationType: 'Débito',
        categoryId: 'food',
      },
      {
        mode: 'amounts',
        personalAmount: 25000,
        participants: [{ contactId: f.contactId, amount: 15000 }],
      },
    );
    expect(updated.transaction).toMatchObject({
      id: expense.transaction!.id,
      createdAt: expense.transaction!.createdAt,
      date: expense.transaction!.date,
      amount: 40000,
    });
    expect(await f.summary()).toMatchObject({
      availableBalance: 960000,
      netWorth: 975000,
      monthlyExpenses: 25000,
    });
    await expect(
      updateTransactionQuickly(f, updated.transaction!.id, {
        kind: 'paymentMethod',
        operationType: 'Crédito',
      }),
    ).rejects.toThrow('Clasifica');
    const switched = await f.save({
      editingTransaction: updated.transaction,
      amount: 40000,
      accountId: 'card',
      operationType: 'Crédito',
    });
    expect(switched.transaction.amount).toBe(40000);
    expect(await f.summary()).toMatchObject({
      availableBalance: 1000000,
      netWorth: 975000,
      totalDebt: 40000,
      monthlyExpenses: 25000,
    });
  } finally {
    f.native.close();
  }
});

test.each([0, -1, NaN, Infinity, -Infinity, 0.001, 100000000000000])(
  'invalid receipt amount %s changes no financial state',
  async amount => {
    const f = await sharedExpenseFixture();
    try {
      const before = await f.summary();
      await expect(
        f.api.recordReceipt('invalid', {
          contactId: f.contactId,
          accountId: 'bank',
          amount,
        }),
      ).rejects.toThrow();
      expect(await f.summary()).toEqual(before);
      expect(await f.transactionRepository.getTransactions()).toEqual([]);
    } finally {
      f.native.close();
    }
  },
);

test('cent distribution is exact, supports zero personal share and rejects invalid shares', () => {
  expect(
    distributeSharedExpense(0.05, {
      mode: 'percentages',
      personalPercentage: 0,
      participants: [
        { contactId: 'A', percentage: 50 },
        { contactId: 'B', percentage: 50 },
      ],
    }),
  ).toEqual([
    { contactId: undefined, amountMinor: 0 },
    { contactId: 'A', amountMinor: 3 },
    { contactId: 'B', amountMinor: 2 },
  ]);
  expect(
    distributeSharedExpense(30000.25, {
      mode: 'amounts',
      personalAmount: 15000.1,
      participants: [{ contactId: 'A', amount: 15000.15 }],
    }),
  ).toEqual([
    { amountMinor: 1500010 },
    { contactId: 'A', amountMinor: 1500015 },
  ]);
  expect(() =>
    distributeSharedExpense(30, {
      mode: 'amounts',
      personalAmount: 10,
      participants: [{ contactId: 'A', amount: 10 }],
    }),
  ).toThrow('sumar');
  expect(() =>
    distributeSharedExpense(30, {
      mode: 'amounts',
      personalAmount: 30,
      participants: [{ contactId: 'A', amount: 0 }],
    }),
  ).toThrow();
  expect(() =>
    distributeSharedExpense(30, {
      mode: 'percentages',
      personalPercentage: 0,
      participants: [{ contactId: 'A', percentage: 101 }],
    }),
  ).toThrow();
  expect(() => toMinor(Number.MAX_SAFE_INTEGER)).toThrow();
});

test('one advance can pay two expenses of the same person; allocations cannot cross contacts', async () => {
  const f = await sharedExpenseFixture();
  try {
    const a = await f.purchase('a');
    const b = await f.purchase('b');
    const receipt = await f.api.recordReceipt('advance', {
      contactId: f.contactId,
      accountId: 'bank',
      amount: 30000,
    });
    await f.api.applyReceipt(
      'applyA',
      receipt.entityId,
      a.participationId,
      15000,
    );
    await f.api.applyReceipt(
      'applyB',
      receipt.entityId,
      b.participationId,
      15000,
    );
    expect(await f.api.getPosition()).toMatchObject({
      receivables: 0,
      thirdPartyAdvances: 0,
    });
    expect(await f.summary()).toMatchObject({
      availableBalance: 970000,
      netWorth: 970000,
      monthlyExpenses: 30000,
      monthlyIncome: 0,
    });
    const other = (await f.api.saveContact('otherPerson', 'Otro')).entityId;
    const wrongReceipt = await f.api.recordReceipt('wrongReceipt', {
      contactId: other,
      accountId: 'bank',
      amount: 100,
    });
    await expect(
      f.api.applyReceipt(
        'wrongApply',
        wrongReceipt.entityId,
        a.participationId,
        100,
      ),
    ).rejects.toThrow('misma persona');
  } finally {
    f.native.close();
  }
});

test('own transfers cannot be linked as reimbursements', async () => {
  const f = await sharedExpenseFixture();
  try {
    const transfer = await f.save({
      transactionType: 'internalTransfer',
      targetAccountId: 'target',
      amount: 15000,
    });
    await expect(
      f.api.recordReceipt('linkOwn', {
        contactId: f.contactId,
        transactionId: `${transfer.transaction.id}-in`,
      }),
    ).rejects.toThrow('transferencia');
    expect(await f.summary()).toMatchObject({
      monthlyIncome: 0,
      monthlyExpenses: 0,
      netWorth: 1000000,
    });
  } finally {
    f.native.close();
  }
});

test.each([
  'UPDATE accounts',
  'INSERT INTO transactions',
  'INSERT INTO shared_expenses',
  'INSERT INTO transaction_splits',
  'INSERT INTO shared_commands',
])(
  'purchase failure at %s rolls back bank, debt, splits and command receipt',
  async sql => {
    const f = await sharedExpenseFixture();
    try {
      const before = await f.summary();
      f.failOn(sql);
      await expect(f.purchase()).rejects.toThrow();
      f.failOn();
      expect(await f.summary()).toEqual(before);
      expect(await f.transactionRepository.getTransactions()).toEqual([]);
      expect((await f.sharedRepository.getState()).expenses).toEqual([]);
      expect(
        f.query("SELECT * FROM shared_commands WHERE id='purchase'").rows.raw(),
      ).toEqual([]);
      expect((await f.purchase()).transaction?.amount).toBe(30000);
      f.verifyForeignKeys();
    } finally {
      f.native.close();
    }
  },
);

test.each([
  'INSERT INTO shared_receipts',
  'INSERT INTO shared_allocations',
  'INSERT INTO shared_commands',
])(
  'receipt failure at %s rolls back the bank inflow and financial classification',
  async sql => {
    const f = await sharedExpenseFixture();
    try {
      const expense = await f.purchase();
      const before = await f.summary();
      f.failOn(sql);
      await expect(
        f.api.recordReceipt('receipt', {
          contactId: f.contactId,
          accountId: 'bank',
          amount: 15000,
          applications: [
            { participationId: expense.participationId, amount: 15000 },
          ],
        }),
      ).rejects.toThrow();
      f.failOn();
      expect(await f.summary()).toEqual(before);
      expect(await f.api.getExpense(expense.entityId)).toMatchObject({
        pendingAmount: 15000,
      });
      expect((await f.sharedRepository.getState()).receipts).toEqual([]);
      f.verifyForeignKeys();
    } finally {
      f.native.close();
    }
  },
);

test('migration is repeatable, mutations update revision, and wipe removes shared financial data', async () => {
  const f = await sharedExpenseFixture();
  try {
    const before = Number(
      f.query('SELECT revision FROM financial_data_revision').rows.item(0)!
        .revision,
    );
    await f.purchase();
    expect(
      Number(
        f.query('SELECT revision FROM financial_data_revision').rows.item(0)!
          .revision,
      ),
    ).toBeGreaterThan(before);
    await applyVersionedMigrations(f.database);
    await applyVersionedMigrations(f.database);
    expect(
      f
        .query('SELECT version FROM schema_migrations ORDER BY version')
        .rows.raw(),
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
    await createSqliteFinancialDataRepository(f.database).deleteFinancialData('11111111-1111-4111-8111-111111111111', { workIds: [], backupJobIds: [], snapshotIds: [] });
    expect(await f.sharedRepository.getState()).toEqual({
      contacts: [],
      expenses: [],
      participations: [],
      receipts: [],
      allocations: [],
      returns: [],
      lossEvents: [],
    });
    expect(await f.transactionRepository.getTransactions()).toEqual([]);
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});

test('command results explain bank and personal effects, and linking an import only reclassifies income', async () => {
  const f = await sharedExpenseFixture();
  try {
    const expense = await f.purchase();
    expect(expense.effects).toMatchObject({
      availableDelta: -30000,
      netWorthDelta: -15000,
      personalExpenseDelta: 15000,
      personalIncomeDelta: 0,
      receivableDelta: 15000,
      bankOutflowDelta: 30000,
    });
    const imported = await f.save({
      transactionType: 'income',
      amount: 15000,
      categoryId: undefined,
    });
    const linked = await f.api.recordReceipt('linkEffects', {
      contactId: f.contactId,
      transactionId: imported.transaction.id,
      applications: [
        { participationId: expense.participationId, amount: 15000 },
      ],
    });
    expect(linked.effects).toMatchObject({
      accounts: [],
      availableDelta: 0,
      personalIncomeDelta: -15000,
      receivableDelta: -15000,
      bankInflowDelta: 0,
    });
    expect(linked.transactions).toEqual([]);
    expect(
      await f.api.recordReceipt('linkEffects', {
        contactId: f.contactId,
        transactionId: imported.transaction.id,
        applications: [
          { participationId: expense.participationId, amount: 15000 },
        ],
      }),
    ).toEqual(linked);
  } finally {
    f.native.close();
  }
});

test('paid shares cannot be reduced; receipt edits and the AI cannot bypass linked obligations', async () => {
  const f = await sharedExpenseFixture();
  try {
    const expense = await f.purchase();
    const receipt = await f.api.recordReceipt('paid', {
      contactId: f.contactId,
      accountId: 'bank',
      amount: 15000,
      applications: [
        { participationId: expense.participationId, amount: 15000 },
      ],
    });
    const before = await f.summary();
    expect(
      await f.api.previewDistribution(expense.entityId, {
        mode: 'amounts',
        personalAmount: 20000,
        participants: [{ contactId: f.contactId, amount: 10000 }],
      }),
    ).toMatchObject({ blocked: true, bankBalanceDelta: 0 });
    await expect(
      f.api.updateDistribution('reduce', expense.entityId, {
        mode: 'amounts',
        personalAmount: 20000,
        participants: [{ contactId: f.contactId, amount: 10000 }],
      }),
    ).rejects.toThrow('Desvincula');
    await expect(
      f.save({
        editingTransaction: receipt.transaction,
        transactionType: 'refund',
        amount: 10000,
        categoryId: undefined,
      }),
    ).rejects.toThrow('reducir');
    await expect(
      executeAiCommandPlan(f.database, 'aiChange', {
        version: 1,
        summary: '',
        answeredFields: [],
        actions: [
          {
            id: 'edit',
            entity: 'transaction',
            operation: 'update',
            targetId: expense.transaction!.id,
            fields: { amount: 40000 },
          },
        ],
      }),
    ).rejects.toThrow('participaciones');
    expect(await f.summary()).toEqual(before);
    const editDate = await f.save({
      editingTransaction: expense.transaction,
      amount: 30000,
      accountId: 'target',
      occurrence: { kind: 'date', date: '2026-09-30' },
    });
    expect(editDate.transaction.id).toBe(expense.transaction!.id);
    expect(await f.api.getExpense(expense.entityId)).toMatchObject({
      expense: { date: '2026-09-30' },
      status: 'completed',
    });
    expect(await f.summary()).toMatchObject({
      availableBalance: 985000,
      monthlyExpenses: 0,
      netWorth: 985000,
    });
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});

test('zero personal share and decimal payments leave no artificial income or expense', async () => {
  const f = await sharedExpenseFixture();
  try {
    const expense = await f.api.createPurchase('decimalPurchase', {
      purchase: {
        accountId: 'bank',
        amount: 30.25,
        merchantName: 'Compra para amiga',
        operationType: 'Débito',
        categoryId: 'food',
      },
      distribution: {
        mode: 'amounts',
        personalAmount: 0,
        participants: [{ contactId: f.contactId, amount: 30.25 }],
      },
    });
    const split = (await f.api.getExpense(expense.entityId)).participants[0]!;
    await f.api.recordReceipt('decimalReceipt', {
      accountId: 'target',
      contactId: f.contactId,
      amount: 30.25,
      applications: [{ participationId: split.participationId, amount: 30.25 }],
    });
    expect(await f.summary()).toMatchObject({
      netWorth: 1000000,
      availableBalance: 1000000,
      monthlyIncome: 0,
      monthlyExpenses: 0,
    });
    expect(await f.balances()).toMatchObject({
      bank: 999969.75,
      target: 30.25,
    });
  } finally {
    f.native.close();
  }
});

test('editing shared credit metadata preserves paid installments and interest-free terms', async () => {
  const f = await sharedExpenseFixture();
  try {
    const original = await f.save({
      accountId: 'card',
      operationType: 'Crédito',
      installmentCountInput: '3',
      hasInterestFreeInstallments: true,
      interestFreeInstallmentCountInput: '2',
    });
    const expense = await f.api.sharePurchase('splitCredit', {
      transactionId: original.transaction.id,
      distribution: f.distribution,
    });
    const installments = (
      await f.creditCardRepository.getInstallmentPurchases(['card'])
    )[0]!;
    await f.creditCardRepository.saveInstallmentPurchases([
      { ...installments, paidInstallments: 1 },
    ]);
    const edited = await f.api.updatePurchase(
      'creditDate',
      expense.entityId,
      {
        accountId: 'card',
        amount: 30000,
        categoryId: 'food',
        merchantName: 'Cena',
        operationType: 'Crédito',
        occurrence: { kind: 'date', date: '2026-10-06' },
      },
      f.distribution,
    );
    expect(
      (await f.creditCardRepository.getInstallmentPurchases(['card']))[0],
    ).toMatchObject({
      installmentCount: 3,
      paidInstallments: 1,
      totalAmount: 30000,
    });
    expect(edited.transaction?.notes).toContain('Sin intereses: 2');
    expect(edited.effects).toMatchObject({
      availableDelta: 0,
      debtDelta: 0,
      personalExpenseDelta: 0,
      netWorthDelta: 0,
    });
  } finally {
    f.native.close();
  }
});

test('deleting a return restores its advance and a repeated deletion reverses cash once', async () => {
  const f = await sharedExpenseFixture();
  try {
    const receipt = await f.api.recordReceipt('advance', {
      contactId: f.contactId,
      accountId: 'bank',
      amount: 15000,
    });
    const returned = await f.api.returnAdvance('return', {
      receiptId: receipt.entityId,
      accountId: 'target',
      amount: 5000,
    });
    expect(await f.api.getPosition()).toMatchObject({
      thirdPartyAdvances: 10000,
    });
    await expect(
      f.api.deleteMovement('blockedReceipt', receipt.transaction!.id),
    ).rejects.toThrow('devoluciones');
    const deleted = await f.api.deleteMovement(
      'deleteReturn',
      returned.transaction!.id,
    );
    expect(deleted.effects).toMatchObject({
      availableDelta: 5000,
      thirdPartyAdvanceDelta: 5000,
      netWorthDelta: 0,
    });
    expect(
      await f.api.deleteMovement('deleteReturn', returned.transaction!.id),
    ).toEqual(deleted);
    expect(await f.api.getPosition()).toMatchObject({
      thirdPartyAdvances: 15000,
    });
    expect(await f.balances()).toMatchObject({ bank: 1015000, target: 0 });
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});

test.each(['edit', 'delete', 'return'])(
  'a failure after the command journal write fully rolls back %s',
  async operation => {
    const f = await sharedExpenseFixture();
    try {
      const expense = await f.purchase();
      const receipt = await f.api.recordReceipt('advance', {
        contactId: f.contactId,
        accountId: 'target',
        amount: 5000,
      });
      const before = await f.summary();
      const beforeState = await f.sharedRepository.getState();
      const transactions = await f.transactionRepository.getTransactions();
      f.injectFault({ phase: 'after', sql: 'INSERT INTO shared_commands' });
      const run = () =>
        operation === 'edit'
          ? f.api.updatePurchase(
              'fault',
              expense.entityId,
              {
                accountId: 'bank',
                amount: 40000,
                categoryId: 'food',
                merchantName: 'Cena',
                operationType: 'Débito',
              },
              {
                mode: 'amounts',
                personalAmount: 25000,
                participants: [{ contactId: f.contactId, amount: 15000 }],
              },
            )
          : operation === 'delete'
          ? f.api.deleteMovement('fault', expense.transaction!.id)
          : f.api.returnAdvance('fault', {
              receiptId: receipt.entityId,
              accountId: 'bank',
              amount: 5000,
            });
      await expect(run()).rejects.toThrow('Injected');
      expect(await f.summary()).toEqual(before);
      expect(await f.sharedRepository.getState()).toEqual(beforeState);
      expect(await f.transactionRepository.getTransactions()).toEqual(
        transactions,
      );
      expect(
        f.query("SELECT * FROM shared_commands WHERE id='fault'").rows.raw(),
      ).toEqual([]);
      await run();
      f.verifyForeignKeys();
    } finally {
      f.native.close();
    }
  },
);

test('a colliding imported movement identity cannot be overwritten by a new receipt', async () => {
  const f = await sharedExpenseFixture();
  try {
    const original = (await f.save()).transaction;
    const collision = { ...original, id: 'shared:collision:movement' };
    await f.transactionRepository.saveTransactions([collision]);
    const before = await f.summary();
    await expect(
      f.api.recordReceipt('collision', {
        contactId: f.contactId,
        accountId: 'bank',
        amount: 1000,
      }),
    ).rejects.toThrow('identidad');
    expect(await f.summary()).toEqual(before);
    expect(
      (await f.transactionRepository.getTransactions()).find(
        t => t.id === collision.id,
      ),
    ).toEqual(collision);
  } finally {
    f.native.close();
  }
});

test('SQLite constraints require safe integer cents and preserve original financial rows', async () => {
  const f = await sharedExpenseFixture();
  try {
    const expense = await f.purchase();
    const receipt = await f.api.recordReceipt('advance', {
      contactId: f.contactId,
      accountId: 'bank',
      amount: 1000,
    });
    for (const value of [0, -1, 1.5, 9007199254740992])
      expect(() =>
        f.query('UPDATE shared_receipts SET amount_minor=? WHERE id=?', [
          value,
          receipt.entityId,
        ]),
      ).toThrow('CHECK');
    expect(() =>
      f.query(
        'UPDATE transaction_splits SET amount_minor=-1 WHERE shared_expense_id=?',
        [expense.entityId],
      ),
    ).toThrow('CHECK');
    expect(await f.api.getPosition()).toMatchObject({
      receivables: 15000,
      thirdPartyAdvances: 1000,
    });
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});
