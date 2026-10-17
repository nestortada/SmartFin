import {
  sharedExpenseFixture,
  SHARED_TEST_DATE,
} from './helpers/sharedExpenseFixture';
import { createSharedExpenseApi } from '../src/modules/transactions/useCases/createSharedExpenseApi';
import { createSqliteSharedExpenseRepository } from '../src/modules/transactions/repositories/sqliteSharedExpenseRepository';
import { createSqliteFinancialDataRepository } from '../src/modules/settings/repositories/sqliteFinancialDataRepository';
import { applyVersionedMigrations } from '../src/database/migrations';
import { updateTransactionQuickly } from '../src/modules/transactions/useCases/updateTransactionQuickly';
import { registerCreditCardPayment } from '../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { realSQLite } from './helpers/realSQLite';
import { getDashboardSummaryFromDb } from '../src/modules/dashboard/useCases/getDashboardSummary';
const { mkdtempSync, unlinkSync, rmdirSync } = require('node:fs') as {
  mkdtempSync: (prefix: string) => string;
  unlinkSync: (path: string) => void;
  rmdirSync: (path: string) => void;
};
const { tmpdir } = require('node:os') as { tmpdir: () => string };
const { join } = require('node:path') as {
  join: (...parts: string[]) => string;
};

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'],
  });
  jest.setSystemTime(SHARED_TEST_DATE);
});
afterEach(() => jest.useRealTimers());
type Fixture = Awaited<ReturnType<typeof sharedExpenseFixture>>;
const date = '2026-10-10';
const nextMonth = new Date('2026-11-15T12:00:00Z');
async function verifyPosition(f: Fixture) {
  const position = await f.api.getPosition();
  expect(await f.sharedRepository.getFinancialTotals()).toEqual({
    receivables: position.receivables,
    thirdPartyAdvances: position.thirdPartyAdvances,
  });
  f.verifyForeignKeys();
}
async function snapshot(f: Fixture) {
  return {
    state: await f.sharedRepository.getState(),
    summary: await f.summary(),
    balances: await f.balances(),
    transactions: await f.transactionRepository.getTransactions(),
    commands: f.query('SELECT * FROM shared_commands ORDER BY id').rows.raw(),
    revision: f.query('SELECT * FROM financial_data_revision').rows.raw(),
  };
}

test('principal example: 30000 purchase, 5000 received, 10000 forgiven preserves cash, consumption and reimbursement', async () => {
  const f = await sharedExpenseFixture();
  try {
    const purchase = await f.purchase();
    await f.api.recordReceipt('receipt', {
      contactId: f.contactId,
      accountId: 'target',
      amount: 5000,
      occurrence: { kind: 'date', date: '2026-10-08' },
      applications: [
        { participationId: purchase.participationId, amount: 5000 },
      ],
    });
    const before = await f.transactionRepository.getTransactions();
    const input = {
      participationId: purchase.participationId,
      amount: 10000,
      date,
      reason: 'Asumo el saldo',
    };
    const preview = await f.api.previewForgiveness(input);
    expect(preview).toEqual({
      bankBalanceDelta: 0,
      debtDelta: 0,
      incomeDelta: 0,
      personalExpenseDelta: 0,
      receivableDelta: -10000,
      netWorthDelta: -10000,
      recognizedLossDelta: 10000,
      bankInflowDelta: 0,
      bankOutflowDelta: 0,
    });
    const result = await f.api.forgiveParticipation('forgive', input);
    expect(result.effects).toMatchObject({
      accounts: [],
      availableDelta: 0,
      debtDelta: 0,
      netWorthDelta: -10000,
      receivableDelta: -10000,
      personalIncomeDelta: 0,
      personalExpenseDelta: 0,
      bankInflowDelta: 0,
      bankOutflowDelta: 0,
      recognizedLossDelta: 10000,
    });
    expect(result.transactions).toEqual([]);
    expect(await f.transactionRepository.getTransactions()).toEqual(before);
    expect(await f.balances()).toEqual({ bank: 970000, target: 5000, card: 0 });
    expect(await f.api.getExpense(purchase.entityId)).toMatchObject({
      receivedAmount: 5000,
      forgivenAmount: 10000,
      pendingAmount: 0,
      personalAmount: 15000,
      status: 'completedMixed',
    });
    expect(await f.summary()).toMatchObject({
      availableBalance: 975000,
      totalDebt: 0,
      netWorth: 975000,
      monthlyIncome: 0,
      monthlyExpenses: 15000,
      monthlyForgivenessLosses: 10000,
      monthlyNetLosses: 10000,
      monthlySavings: -25000,
    });
    expect(await f.api.getLossEntries()).toEqual([
      expect.objectContaining({
        classification: 'unrecoveredSharedExpenseLoss',
        lossDelta: 10000,
        bankFlow: 0,
        reason: 'Asumo el saldo',
        date,
        participationId: purchase.participationId,
        contactId: f.contactId,
      }),
    ]);
    await verifyPosition(f);
  } finally {
    f.native.close();
  }
});

test.each([15000, 4000])(
  'full/partial forgiveness %s and independent obligation states',
  async amount => {
    const f = await sharedExpenseFixture();
    try {
      const purchase = await f.purchase();
      await f.api.forgiveParticipation('loss', {
        participationId: purchase.participationId,
        amount,
        date,
      });
      const status = amount === 15000 ? 'fullyForgiven' : 'partiallyForgiven';
      expect(await f.api.getExpense(purchase.entityId)).toMatchObject({
        status,
        pendingAmount: 15000 - amount,
        participants: [
          expect.objectContaining({
            status,
            forgivenAmount: amount,
            receivedAmount: 0,
          }),
        ],
      });
      expect(await f.summary()).toMatchObject({
        netWorth: 985000 - amount,
        monthlyExpenses: 15000,
        monthlyIncome: 0,
      });
      await verifyPosition(f);
    } finally {
      f.native.close();
    }
  },
);

test('several partial losses, subsequent normal reimbursement and exact cents across months', async () => {
  const f = await sharedExpenseFixture();
  try {
    const purchase = await f.purchase();
    await f.api.forgiveParticipation('a', {
      participationId: purchase.participationId,
      amount: 1000.01,
      date,
    });
    await f.api.forgiveParticipation('b', {
      participationId: purchase.participationId,
      amount: 999.99,
      date: '2026-11-01',
    });
    await f.api.recordReceipt('receipt', {
      contactId: f.contactId,
      accountId: 'target',
      amount: 13000,
      occurrence: { kind: 'date', date: '2026-11-02' },
      applications: [
        { participationId: purchase.participationId, amount: 13000 },
      ],
    });
    expect(await f.api.getExpense(purchase.entityId)).toMatchObject({
      forgivenAmount: 2000,
      pendingAmount: 0,
      receivedAmount: 13000,
      status: 'completedMixed',
    });
    expect(await f.summary()).toMatchObject({
      monthlyExpenses: 15000,
      monthlyForgivenessLosses: 1000.01,
      monthlySavings: -16000.01,
    });
    expect(await f.summary(nextMonth)).toMatchObject({
      monthlyExpenses: 0,
      monthlyIncome: 0,
      monthlyForgivenessLosses: 999.99,
      monthlySavings: -999.99,
    });
    expect(await f.api.getPosition('2026-10-31')).toMatchObject({
      receivables: 13999.99,
      thirdPartyAdvances: 0,
    });
    expect(await f.api.getPosition('2026-11-01')).toMatchObject({
      receivables: 13000,
    });
    await verifyPosition(f);
  } finally {
    f.native.close();
  }
});

test('multiple people remain independent and a recovered loss keeps the original forgiven classification', async () => {
  const f = await sharedExpenseFixture();
  try {
    const other = (await f.api.saveContact('other', 'Otra')).entityId;
    const purchase = await f.api.createPurchase('two', {
      purchase: {
        accountId: 'bank',
        amount: 30000,
        categoryId: 'food',
        merchantName: 'Cena',
        operationType: 'Débito',
        occurrence: { kind: 'date', date: '2026-10-05' },
      },
      distribution: {
        mode: 'amounts',
        personalAmount: 10000,
        participants: [
          { contactId: f.contactId, amount: 10000 },
          { contactId: other, amount: 10000 },
        ],
      },
    });
    const parts = (await f.api.getExpense(purchase.entityId)).participants;
    const first = parts.find(p => p.contactId === f.contactId)!;
    const second = parts.find(p => p.contactId === other)!;
    const loss = await f.api.forgiveParticipation('loss', {
      participationId: first.participationId,
      amount: 10000,
      date,
    });
    const receipt = await f.api.recordReceipt('receipt', {
      contactId: other,
      accountId: 'target',
      amount: 10000,
    });
    await expect(
      f.api.recoverForgiveness('wrong', {
        forgivenessId: loss.entityId,
        receiptId: receipt.entityId,
        amount: 100,
        date: '2026-10-11',
      }),
    ).rejects.toThrow('misma persona');
    await f.api.applyReceipt(
      'apply',
      receipt.entityId,
      second.participationId,
      10000,
    );
    expect((await f.api.getExpense(purchase.entityId)).participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contactId: f.contactId,
          pendingAmount: 0,
          status: 'fullyForgiven',
        }),
        expect.objectContaining({
          contactId: other,
          pendingAmount: 0,
          status: 'completed',
        }),
      ]),
    );
    await verifyPosition(f);
  } finally {
    f.native.close();
  }
});

test('auditable reversal in November reopens receivable without changing October loss or bank flows', async () => {
  const f = await sharedExpenseFixture();
  try {
    const p = await f.purchase();
    const loss = await f.api.forgiveParticipation('loss', {
      participationId: p.participationId,
      amount: 15000,
      date,
    });
    const input = {
      eventId: loss.entityId,
      date: '2026-11-01',
      reason: 'Corrección',
    };
    expect(await f.api.previewLossReversal(input)).toMatchObject({
      receivableDelta: 15000,
      netWorthDelta: 15000,
      recognizedLossDelta: -15000,
    });
    const reversed = await f.api.reverseLossEvent('undo', input);
    expect(reversed.effects).toMatchObject({
      netWorthDelta: 15000,
      receivableDelta: 15000,
      recognizedLossDelta: -15000,
      bankInflowDelta: 0,
      bankOutflowDelta: 0,
      personalExpenseDelta: 0,
    });
    expect(await f.summary()).toMatchObject({
      monthlyForgivenessLosses: 15000,
      monthlyNetLosses: 15000,
      netWorth: 985000,
    });
    expect(await f.summary(nextMonth)).toMatchObject({
      monthlyLossReversals: 15000,
      monthlyNetLosses: -15000,
      monthlySavings: 15000,
    });
    expect(await f.api.getPosition('2026-10-31')).toMatchObject({
      receivables: 0,
    });
    expect(await f.api.getPosition('2026-11-01')).toMatchObject({
      receivables: 15000,
    });
    expect(await f.api.getExpense(p.entityId)).toMatchObject({
      status: 'pending',
      forgivenAmount: 0,
    });
    const events = (await f.api.getHistory()).lossEvents;
    expect(events).toHaveLength(2);
    expect(events.find(e => e.id === reversed.entityId)).toMatchObject({
      relatedEventId: loss.entityId,
      kind: 'forgivenessReversal',
      amountMinor: 1500000,
    });
    await expect(f.api.reverseLossEvent('again', input)).rejects.toThrow(
      'reversión',
    );
    await verifyPosition(f);
  } finally {
    f.native.close();
  }
});

test('money received after full forgiveness requires explicit recovery, never earned income or ordinary allocation', async () => {
  const f = await sharedExpenseFixture();
  try {
    const p = await f.purchase();
    const loss = await f.api.forgiveParticipation('loss', {
      participationId: p.participationId,
      amount: 15000,
      date,
    });
    const before = await snapshot(f);
    await expect(
      f.api.recordReceipt('invalid', {
        contactId: f.contactId,
        accountId: 'target',
        amount: 5000,
        occurrence: { kind: 'date', date: '2026-11-01' },
        applications: [{ participationId: p.participationId, amount: 5000 }],
      }),
    ).rejects.toThrow('pendiente');
    expect(await snapshot(f)).toEqual(before);
    const receipt = await f.api.recordReceipt('late', {
      contactId: f.contactId,
      accountId: 'target',
      amount: 5000,
      occurrence: { kind: 'date', date: '2026-11-01' },
    });
    expect(await f.summary(nextMonth)).toMatchObject({
      monthlyIncome: 0,
      netWorth: 970000,
      availableBalance: 975000,
    });
    const input = {
      forgivenessId: loss.entityId,
      receiptId: receipt.entityId,
      amount: 5000,
      date: '2026-11-01',
    };
    expect(await f.api.previewRecovery(input)).toMatchObject({
      netWorthDelta: 5000,
      receivableDelta: 0,
      recognizedLossDelta: -5000,
      bankBalanceDelta: 0,
    });
    const recovery = await f.api.recoverForgiveness('recover', input);
    expect(recovery.effects).toMatchObject({
      netWorthDelta: 5000,
      thirdPartyAdvanceDelta: -5000,
      personalIncomeDelta: 0,
      receivableDelta: 0,
      recognizedLossDelta: -5000,
      bankInflowDelta: 0,
    });
    expect(await f.summary(nextMonth)).toMatchObject({
      monthlyIncome: 0,
      monthlyExpenses: 0,
      monthlyLossRecoveries: 5000,
      monthlyNetLosses: -5000,
      monthlySavings: 5000,
      netWorth: 975000,
    });
    expect(await f.api.getExpense(p.entityId)).toMatchObject({
      receivedAmount: 0,
      forgivenAmount: 15000,
      recoveredAmount: 5000,
      pendingAmount: 0,
      status: 'fullyForgiven',
    });
    await expect(
      f.api.reverseLossEvent('blocked', {
        eventId: loss.entityId,
        date: '2026-11-02',
      }),
    ).rejects.toThrow('recuperaciones');
    await expect(
      f.api.deleteMovement('delete', receipt.transaction!.id),
    ).rejects.toThrow('recuperaciones');
    await expect(
      f.api.recoverForgiveness('excess', { ...input, amount: 5000.01 }),
    ).rejects.toThrow('disponible');
    const reversal = await f.api.reverseLossEvent('undoRecovery', {
      eventId: recovery.entityId,
      date: '2026-11-02',
    });
    expect(reversal.effects).toMatchObject({
      recognizedLossDelta: 5000,
      netWorthDelta: -5000,
      thirdPartyAdvanceDelta: 5000,
      bankInflowDelta: 0,
    });
    await f.api.reverseLossEvent('undoLoss', {
      eventId: loss.entityId,
      date: '2026-11-02',
    });
    await expect(
      f.api.applyReceipt('normal', receipt.entityId, p.participationId, 5000),
    ).rejects.toThrow('historial');
    await f.api.deleteMovement('deleteResolved', receipt.transaction!.id);
    await verifyPosition(f);
  } finally {
    f.native.close();
  }
});

test('multiple recoveries capped to original loss with exact cents and no duplicate money', async () => {
  const f = await sharedExpenseFixture();
  try {
    const p = await f.purchase();
    const loss = await f.api.forgiveParticipation('loss', {
      participationId: p.participationId,
      amount: 1000.03,
      date,
    });
    const receipt = await f.api.recordReceipt('receipt', {
      contactId: f.contactId,
      accountId: 'target',
      amount: 2000,
      occurrence: { kind: 'date', date: '2026-11-01' },
    });
    for (const [command, amount] of [
      ['a', 400.01],
      ['b', 600.02],
    ] as const)
      await f.api.recoverForgiveness(command, {
        forgivenessId: loss.entityId,
        receiptId: receipt.entityId,
        amount,
        date: '2026-11-01',
      });
    await expect(
      f.api.recoverForgiveness('excess', {
        forgivenessId: loss.entityId,
        receiptId: receipt.entityId,
        amount: 0.01,
        date: '2026-11-01',
      }),
    ).rejects.toThrow('pérdida');
    expect(await f.api.getPosition()).toMatchObject({
      receivables: 13999.97,
      thirdPartyAdvances: 999.97,
    });
    expect(await f.summary(nextMonth)).toMatchObject({
      monthlyLossRecoveries: 1000.03,
      monthlyIncome: 0,
    });
    await verifyPosition(f);
  } finally {
    f.native.close();
  }
});

test.each([
  15000.01,
  0,
  -1,
  NaN,
  Infinity,
  -Infinity,
  1.001,
  Number.MAX_SAFE_INTEGER,
])(
  'invalid forgiveness %s rejects without any persisted change',
  async amount => {
    const f = await sharedExpenseFixture();
    try {
      const p = await f.purchase();
      const before = await snapshot(f);
      await expect(
        f.api.forgiveParticipation('invalid', {
          participationId: p.participationId,
          amount,
          date,
        }),
      ).rejects.toThrow();
      expect(await snapshot(f)).toEqual(before);
    } finally {
      f.native.close();
    }
  },
);

test('stable commands survive repository reconstruction, conflict and concurrent overcommit', async () => {
  const f = await sharedExpenseFixture();
  try {
    const p = await f.purchase();
    const input = { participationId: p.participationId, amount: 10000, date };
    const results = await Promise.all([
      f.api.forgiveParticipation('same', input),
      f.api.forgiveParticipation('same', input),
    ]);
    expect(results[0]).toEqual(results[1]);
    const rebuilt = createSharedExpenseApi(
      createSqliteSharedExpenseRepository(f.database),
    );
    expect(await rebuilt.forgiveParticipation('same', input)).toEqual(
      results[0],
    );
    expect(await rebuilt.getHistory()).toEqual(await f.api.getHistory());
    await expect(
      rebuilt.forgiveParticipation('same', { ...input, amount: 1 }),
    ).rejects.toThrow('otros datos');
    const outcomes = await Promise.allSettled([
      f.api.forgiveParticipation('a', { ...input, amount: 4000 }),
      rebuilt.forgiveParticipation('b', { ...input, amount: 4000 }),
    ]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect((await rebuilt.getExpense(p.entityId)).pendingAmount).toBe(1000);
    expect(await f.summary()).toMatchObject({
      monthlyNetLosses: 14000,
      netWorth: 971000,
    });
    await verifyPosition(f);
  } finally {
    f.native.close();
  }
});

test.each(['before', 'after'] as const)(
  'rollback %s journal and command writes; retry commits once',
  async phase => {
    for (const sql of [
      'INSERT INTO shared_loss_events',
      'INSERT INTO shared_commands',
    ]) {
      const f = await sharedExpenseFixture();
      try {
        const p = await f.purchase();
        const before = await snapshot(f);
        const input = {
          participationId: p.participationId,
          amount: 15000,
          date,
        };
        f.injectFault({ phase, sql });
        await expect(
          f.api.forgiveParticipation('fail', input),
        ).rejects.toThrow();
        expect(await snapshot(f)).toEqual(before);
        await f.api.forgiveParticipation('fail', input);
        expect((await f.api.getHistory()).lossEvents).toHaveLength(1);
        await verifyPosition(f);
      } finally {
        f.native.close();
      }
    }
  },
);

test('recoveries and both reversals roll back after journal write and retry idempotently', async () => {
  const f = await sharedExpenseFixture();
  try {
    const p = await f.purchase();
    const loss = await f.api.forgiveParticipation('loss', {
      participationId: p.participationId,
      amount: 15000,
      date,
    });
    const receipt = await f.api.recordReceipt('receipt', {
      contactId: f.contactId,
      accountId: 'target',
      amount: 10000,
    });
    const retry = async (
      operation: () => ReturnType<typeof f.api.forgiveParticipation>,
    ) => {
      const before = await snapshot(f);
      f.injectFault({ phase: 'after', sql: 'INSERT INTO shared_commands' });
      await expect(operation()).rejects.toThrow();
      expect(await snapshot(f)).toEqual(before);
      const result = await operation();
      expect(await operation()).toEqual(result);
      return result;
    };
    const recovery = await retry(() =>
      f.api.recoverForgiveness('recover', {
        forgivenessId: loss.entityId,
        receiptId: receipt.entityId,
        amount: 10000,
        date: '2026-10-11',
      }),
    );
    await retry(() =>
      f.api.reverseLossEvent('undoRecovery', {
        eventId: recovery.entityId,
        date: '2026-10-11',
      }),
    );
    await retry(() =>
      f.api.reverseLossEvent('undoLoss', {
        eventId: loss.entityId,
        date: '2026-10-11',
      }),
    );
    await verifyPosition(f);
  } finally {
    f.native.close();
  }
});

test('cancellation, deletion, distribution and quick edits cannot erase or overspend forgiven cents', async () => {
  const f = await sharedExpenseFixture();
  try {
    const p = await f.purchase();
    const loss = await f.api.forgiveParticipation('loss', {
      participationId: p.participationId,
      amount: 15000,
      date,
    });
    expect(await f.api.previewCancellation(p.entityId)).toMatchObject({
      blocked: true,
    });
    await expect(f.api.cancelDivision('cancel', p.entityId)).rejects.toThrow();
    await expect(
      f.api.deleteMovement('delete', p.transaction!.id),
    ).rejects.toThrow();
    const distribution = {
      ...f.distribution,
      personalAmount: 20000,
      participants: [{ contactId: f.contactId, amount: 10000 }],
    };
    expect(
      await f.api.previewDistribution(p.entityId, distribution),
    ).toMatchObject({ blocked: true });
    await expect(
      f.api.updateDistribution('reduce', p.entityId, distribution),
    ).rejects.toThrow();
    await expect(
      f.transactionRepository.saveTransactions([
        { ...p.transaction!, amount: 10000 },
      ]),
    ).rejects.toThrow();
    await expect(
      updateTransactionQuickly(f, p.transaction!.id, {
        kind: 'paymentMethod',
        operationType: 'Crédito',
      }),
    ).rejects.toThrow();
    await f.api.reverseLossEvent('undo', { eventId: loss.entityId, date });
    await f.api.cancelDivision('cancelResolved', p.entityId);
    await f.api.deleteMovement('deleteResolved', p.transaction!.id);
    expect((await f.api.getHistory()).lossEvents).toHaveLength(2);
    expect(await f.summary()).toMatchObject({
      netWorth: 1000000,
      availableBalance: 1000000,
      monthlyExpenses: 0,
      monthlyNetLosses: 0,
    });
    await verifyPosition(f);
    await createSqliteFinancialDataRepository(f.database).deleteFinancialData();
    expect(f.query('SELECT * FROM shared_loss_events').rows.raw()).toEqual([]);
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});

test('loss on credit purchase preserves debt and payment conserves net worth', async () => {
  const f = await sharedExpenseFixture();
  try {
    const p = await f.api.createPurchase('credit', {
      purchase: {
        accountId: 'card',
        amount: 30000,
        categoryId: 'food',
        merchantName: 'Cena',
        operationType: 'Crédito',
        occurrence: { kind: 'date', date: '2026-10-05' },
      },
      distribution: f.distribution,
    });
    const part = (await f.api.getExpense(p.entityId)).participants[0]!;
    await f.api.forgiveParticipation('loss', {
      participationId: part.participationId,
      amount: 15000,
      date,
    });
    expect(await f.summary()).toMatchObject({
      availableBalance: 1000000,
      totalDebt: 30000,
      netWorth: 970000,
      monthlyExpenses: 15000,
      monthlyNetLosses: 15000,
    });
    await registerCreditCardPayment({
      accountRepository: f.accountRepository,
      transactionRepository: f.transactionRepository,
      creditCardRepository: f.creditCardRepository,
      accountId: 'card',
      sourceAccountId: 'bank',
      amount: 30000,
      currentDate: SHARED_TEST_DATE,
    });
    expect(await f.summary()).toMatchObject({
      availableBalance: 970000,
      totalDebt: 0,
      netWorth: 970000,
      monthlyExpenses: 15000,
      monthlyNetLosses: 15000,
    });
    await verifyPosition(f);
  } finally {
    f.native.close();
  }
});

test('migration 4 retries atomically over a synthetic version 3 database and preserves domain rows', async () => {
  const f = await sharedExpenseFixture();
  try {
    await f.purchase();
    const before = await f.sharedRepository.getState();
    f.native.exec(
      'DROP TABLE shared_loss_events; DELETE FROM schema_migrations WHERE version = 4;',
    );
    f.injectFault({
      phase: 'after',
      sql: 'CREATE TABLE IF NOT EXISTS shared_loss_events',
    });
    await expect(applyVersionedMigrations(f.database)).rejects.toThrow();
    expect(
      f
        .query("SELECT name FROM sqlite_master WHERE name='shared_loss_events'")
        .rows.raw(),
    ).toEqual([]);
    await applyVersionedMigrations(f.database);
    await applyVersionedMigrations(f.database);
    expect(await f.sharedRepository.getState()).toEqual(before);
    expect(
      f
        .query('SELECT version FROM schema_migrations ORDER BY version')
        .rows.raw(),
    ).toEqual([1, 2, 3, 4].map(version => ({ version })));
    await verifyPosition(f);
  } finally {
    f.native.close();
  }
});

test('dates enforce civil chronology and immutable journal rejects SQL update', async () => {
  const f = await sharedExpenseFixture();
  try {
    const p = await f.purchase();
    for (const invalid of ['2026-02-30', '2026-10-01', '2026-10-10T00:00:00Z'])
      await expect(
        f.api.forgiveParticipation(invalid, {
          participationId: p.participationId,
          amount: 100,
          date: invalid,
        }),
      ).rejects.toThrow();
    const loss = await f.api.forgiveParticipation('loss', {
      participationId: p.participationId,
      amount: 1000,
      date,
    });
    await expect(
      f.api.reverseLossEvent('early', {
        eventId: loss.entityId,
        date: '2026-10-09',
      }),
    ).rejects.toThrow();
    expect(() =>
      f.native
        .prepare('UPDATE shared_loss_events SET amount_minor = 1 WHERE id = ?')
        .run(loss.entityId),
    ).toThrow('append-only');
    await verifyPosition(f);
  } finally {
    f.native.close();
  }
});

test('close and reopen a temporary synthetic SQLite file preserves exact financial results and command receipts', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'smartfin-synthetic-forgiveness-'));
  const syntheticPath = join(folder, 'synthetic.db');
  const f = await sharedExpenseFixture({ syntheticPath });
  let open = true;
  try {
    const p = await f.purchase();
    const input = { participationId: p.participationId, amount: 1234.56, date };
    const command = await f.api.forgiveParticipation('loss', input);
    const expectedHistory = await f.api.getHistory();
    const expectedSummary = await f.summary();
    f.native.close();
    open = false;
    const reopened = realSQLite({ syntheticPath });
    try {
      reopened.native.exec('PRAGMA foreign_keys = ON');
      await applyVersionedMigrations(reopened.database);
      const api = createSharedExpenseApi(
        createSqliteSharedExpenseRepository(reopened.database),
      );
      expect(await api.getHistory()).toEqual(expectedHistory);
      expect(
        await getDashboardSummaryFromDb(reopened.database, SHARED_TEST_DATE),
      ).toEqual(expectedSummary);
      expect(await api.forgiveParticipation('loss', input)).toEqual(command);
      expect(reopened.query('PRAGMA foreign_key_check').rows.raw()).toEqual([]);
    } finally {
      reopened.native.close();
    }
  } finally {
    if (open) f.native.close();
    unlinkSync(syntheticPath);
    rmdirSync(folder);
  }
});

test('effect deltas use exact cents for successive losses and recoveries', async () => {
  const f = await sharedExpenseFixture();
  try {
    const p = await f.purchase();
    await f.api.forgiveParticipation('a', {
      participationId: p.participationId,
      amount: 0.1,
      date,
    });
    const second = await f.api.forgiveParticipation('b', {
      participationId: p.participationId,
      amount: 0.2,
      date,
    });
    expect(second.effects).toMatchObject({
      receivableDelta: -0.2,
      netWorthDelta: -0.2,
      recognizedLossDelta: 0.2,
    });
    const receipt = await f.api.recordReceipt('receipt', {
      contactId: f.contactId,
      accountId: 'target',
      amount: 0.2,
    });
    const recovered = await f.api.recoverForgiveness('recover', {
      forgivenessId: second.entityId,
      receiptId: receipt.entityId,
      amount: 0.1,
      date: '2026-10-11',
    });
    expect(recovered.effects).toMatchObject({
      recognizedLossDelta: -0.1,
      thirdPartyAdvanceDelta: -0.1,
      netWorthDelta: 0.1,
    });
    await verifyPosition(f);
  } finally {
    f.native.close();
  }
});

test.each([0, -1, NaN, Infinity, -Infinity, 0.001, Number.MAX_SAFE_INTEGER])(
  'invalid recovery %s rolls back without affecting available receipt',
  async amount => {
    const f = await sharedExpenseFixture();
    try {
      const p = await f.purchase();
      const loss = await f.api.forgiveParticipation('loss', {
        participationId: p.participationId,
        amount: 1000,
        date,
      });
      const receipt = await f.api.recordReceipt('receipt', {
        contactId: f.contactId,
        accountId: 'target',
        amount: 1000,
      });
      const before = await snapshot(f);
      await expect(
        f.api.recoverForgiveness('invalid', {
          forgivenessId: loss.entityId,
          receiptId: receipt.entityId,
          amount,
          date: '2026-10-11',
        }),
      ).rejects.toThrow();
      expect(await snapshot(f)).toEqual(before);
    } finally {
      f.native.close();
    }
  },
);

test('general edits cannot backdate an applied receipt across a forgiveness reversal or reduce recovered cash', async () => {
  const f = await sharedExpenseFixture();
  try {
    const p = await f.purchase();
    const loss = await f.api.forgiveParticipation('loss', {
      participationId: p.participationId,
      amount: 15000,
      date,
    });
    await f.api.reverseLossEvent('reverse', {
      eventId: loss.entityId,
      date: '2026-10-11',
    });
    const receipt = await f.api.recordReceipt('receipt', {
      contactId: f.contactId,
      accountId: 'target',
      amount: 15000,
      occurrence: { kind: 'date', date: '2026-10-11' },
      applications: [{ participationId: p.participationId, amount: 15000 }],
    });
    const before = await snapshot(f);
    await expect(
      f.transactionRepository.saveTransactions([
        {
          ...receipt.transaction!,
          date: '2026-10-09',
          civilDate: '2026-10-09',
        },
      ]),
    ).rejects.toThrow('historial');
    expect(await snapshot(f)).toEqual(before);
    await verifyPosition(f);
  } finally {
    f.native.close();
  }
});

test('later recoveries cannot be backdated across a recovery reversal', async () => {
  const f = await sharedExpenseFixture();
  try {
    const p = await f.purchase();
    const loss = await f.api.forgiveParticipation('loss', {
      participationId: p.participationId,
      amount: 1000,
      date,
    });
    const receipt = await f.api.recordReceipt('receipt', {
      contactId: f.contactId,
      accountId: 'target',
      amount: 1000,
    });
    const input = {
      forgivenessId: loss.entityId,
      receiptId: receipt.entityId,
      amount: 1000,
      date: '2026-10-11',
    };
    const recovery = await f.api.recoverForgiveness('recover', input);
    await f.api.reverseLossEvent('undo', {
      eventId: recovery.entityId,
      date: '2026-11-01',
    });
    await expect(f.api.recoverForgiveness('backdate', input)).rejects.toThrow(
      'anterior',
    );
    await f.api.recoverForgiveness('again', { ...input, date: '2026-11-01' });
    expect(await f.api.getPosition('2026-10-31')).toMatchObject({
      thirdPartyAdvances: 0,
    });
    expect(await f.api.getPosition('2026-11-01')).toMatchObject({
      thirdPartyAdvances: 0,
    });
    await verifyPosition(f);
  } finally {
    f.native.close();
  }
});
