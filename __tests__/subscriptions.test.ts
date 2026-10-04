import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { createSqliteSubscriptionRepository } from '../src/modules/subscriptions/repositories/sqliteSubscriptionRepository';
import { createSubscriptionApi } from '../src/modules/subscriptions/useCases/createSubscriptionApi';
import type { SubscriptionReminderService } from '../src/modules/subscriptions/services/SubscriptionReminderService';
import type { SubscriptionInput } from '../src/modules/subscriptions/types';
import { createSqliteTransactionRepository } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteFinancialDataRepository } from '../src/modules/settings/repositories/sqliteFinancialDataRepository';
import type { Transaction } from '../src/modules/transactions/types';
import { createSqliteAccountRepository } from '../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteCategoryRepository } from '../src/modules/categories/repositories/sqliteCategoryRepository';
import { createSqliteSubcategoryRepository } from '../src/modules/categories/repositories/sqliteSubcategoryRepository';

jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  openDatabase: jest.fn(),
}));

async function fixture() {
  const sql = realSQLite();
  for (const statement of SQLITE_SCHEMA_STATEMENTS)
    await sql.database.executeSql(statement);
  await applyVersionedMigrations(sql.database);
  sql.native
    .exec(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('bank','Banco','bankAccount','active','COP',1000000,'2026-01-01','2026-01-01');
    INSERT INTO categories VALUES ('entertainment','Entretenimiento','expense','entertainment','#000');`);
  let now = new Date('2026-10-03T12:00:00Z');
  let count = 0;
  const service: SubscriptionReminderService = {
    getStatus: jest.fn(async () => ({
      available: true,
      permission: 'granted' as const,
    })),
    requestPermission: jest.fn(async () => ({
      available: true,
      permission: 'granted' as const,
    })),
    schedule: jest.fn(async () => undefined),
    cancel: jest.fn(async () => undefined),
    cancelAll: jest.fn(async () => undefined),
    ensureMaintenance: jest.fn(async () => undefined),
  };
  const repository = createSqliteSubscriptionRepository(sql.database);
  const api = createSubscriptionApi({
    repository,
    reminderService: service,
    clock: { now: () => now },
    createId: () => `test-${++count}`,
    categoryRepository: createSqliteCategoryRepository(sql.database),
    subcategoryRepository: createSqliteSubcategoryRepository(sql.database),
  });
  const input: SubscriptionInput = {
    name: 'Netflix',
    amount: 38900,
    recurrence: { periodicity: 'monthly' },
    anchorDate: '2026-10-15',
    accountId: 'bank',
    categoryId: 'entertainment',
  };
  const transaction: Transaction = {
    id: 'payment',
    accountId: 'bank',
    amount: 42900,
    currency: 'COP',
    type: 'expense',
    direction: 'outflow',
    status: 'posted',
    date: '2026-10-15T15:00:00Z',
    description: 'Netflix',
    merchantName: 'Netflix',
    categoryId: 'entertainment',
    createdAt: '2026-10-15',
    updatedAt: '2026-10-15',
  };
  return {
    ...sql,
    api,
    service,
    input,
    repository,
    transaction,
    setNow: (date: string) => {
      now = new Date(date);
    },
    transactions: createSqliteTransactionRepository(sql.database),
  };
}

test('UI queries return reference names, paginate overdue charges and preserve balances', async () => {
  const f = await fixture();
  try {
    const created = await f.api.createSubscription(f.input);
    f.setNow('2027-04-16T12:00:00Z');
    await f.api.syncSubscriptions();
    expect((await f.api.getSubscriptionFormOptions()).accounts[0]?.name).toBe(
      'Banco',
    );
    const first = await f.api.getOverdueSubscriptionCharges({ limit: 2 });
    const second = await f.api.getOverdueSubscriptionCharges({
      limit: 2,
      offset: 2,
    });
    expect(first.map(value => value.expectedDate)).toEqual([
      '2026-10-15',
      '2026-11-15',
    ]);
    expect(second.map(value => value.expectedDate)).toEqual([
      '2026-12-15',
      '2027-01-15',
    ]);
    expect(
      await f.api.getSubscriptionHistory(created.value.id, {
        limit: 1,
        offset: 1,
      }),
    ).toHaveLength(1);
    expect(
      f
        .query("SELECT balance_amount FROM accounts WHERE id='bank'")
        .rows.item(0)?.balance_amount,
    ).toBe(1000000);
    await expect(
      f.api.getOverdueSubscriptionCharges({ limit: 0 }),
    ).rejects.toThrow('Paginación');
  } finally {
    f.native.close();
  }
});

test('payment candidates reuse scoring, search manual candidates and exclude linked/incompatible transactions', async () => {
  const f = await fixture();
  try {
    await f.api.createSubscription(f.input);
    const charge = (await f.api.getNextSubscriptionCharge())!;
    f.native.exec(
      "INSERT INTO accounts (id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('other','Otra','bankAccount','active','COP',0,'2026-01-01','2026-01-01');",
    );
    await f.transactions.saveTransactions([
      f.transaction,
      {
        ...f.transaction,
        id: 'outside',
        date: '2026-09-01T12:00:00Z',
        description: 'Servicio fuera de ventana',
      },
      { ...f.transaction, id: 'wrong-account', accountId: 'other' },
      { ...f.transaction, id: 'income', type: 'income', direction: 'inflow' },
      { ...f.transaction, id: 'draft', status: 'pending' },
    ]);
    const suggestions = await f.api.getSubscriptionPaymentCandidates({
      occurrenceId: charge.id,
    });
    expect(suggestions.map(value => value.transaction.id)).toEqual(['payment']);
    expect(suggestions[0]?.score).toBe(80);
    expect(suggestions[0]?.reasons).toContain('Misma cuenta');
    const manual = await f.api.getSubscriptionPaymentCandidates({
      occurrenceId: charge.id,
      suggestedOnly: false,
      query: 'FUERA',
    });
    expect(manual.map(value => value.transaction.id)).toEqual(['outside']);
    expect(manual[0]?.score).toBe(0);
    const another = await f.api.createSubscription({
      ...f.input,
      name: 'Otra suscripción',
    });
    const otherCharge = (
      await f.api.getSubscriptionHistory(another.value.id)
    ).find(value => value.expectedDate === charge.expectedDate)!;
    await f.api.confirmSubscriptionPayment({
      occurrenceId: otherCharge.id,
      transactionId: 'payment',
    });
    expect(
      await f.api.getSubscriptionPaymentCandidates({ occurrenceId: charge.id }),
    ).toEqual([]);
    await expect(
      f.api.getSubscriptionPaymentCandidates({ occurrenceId: otherCharge.id }),
    ).rejects.toThrow('ya no admite');
    expect(
      f.query('SELECT COUNT(*) AS count FROM transactions').rows.item(0)?.count,
    ).toBe(5);
    await expect(
      f.api.getSubscriptionPaymentCandidates({
        occurrenceId: charge.id,
        offset: -1,
      }),
    ).rejects.toThrow('Paginación');
  } finally {
    f.native.close();
  }
});

test('suggested payment dates include exactly seven days and exclude eight days', async () => {
  const f = await fixture();
  try {
    await f.api.createSubscription(f.input);
    const charge = (await f.api.getNextSubscriptionCharge())!;
    await f.transactions.saveTransactions(
      [7, 8, -7, -8].map(offset => ({
        ...f.transaction,
        id: `day-${offset}`,
        date: `2026-10-${String(15 + offset).padStart(2, '0')}T12:00:00Z`,
      })),
    );
    expect(
      (
        await f.api.getSubscriptionPaymentCandidates({
          occurrenceId: charge.id,
        })
      )
        .map(value => value.transaction.id)
        .sort(),
    ).toEqual(['day--7', 'day-7']);
  } finally {
    f.native.close();
  }
});

test('Netflix lifecycle is projected, paid manually, and retains history without balance changes', async () => {
  const f = await fixture();
  try {
    const created = await f.api.createSubscription(f.input);
    const id = created.value.id;
    const next = (await f.api.getNextSubscriptionCharge())!;
    expect(next.expectedDate).toBe('2026-10-15');
    expect(
      f.query("SELECT * FROM cash_flow_events WHERE status='projected'").rows
        .length,
    ).toBeGreaterThan(0);
    expect(f.service.schedule).toHaveBeenCalled();
    f.setNow('2026-10-16T12:00:00Z');
    await f.api.syncSubscriptions();
    expect(
      (await f.api.getSubscriptionHistory(id)).find(item => item.id === next.id)
        ?.status,
    ).toBe('overdue');
    await f.transactions.saveTransactions([f.transaction]);
    expect((await f.api.findSubscriptionMatches('payment'))[0]?.score).toBe(80);
    const paid = await f.api.confirmSubscriptionPayment({
      occurrenceId: next.id,
      transactionId: 'payment',
    });
    expect(paid.value).toMatchObject({
      status: 'paid',
      expectedAmount: 38900,
      actualAmount: 42900,
    });
    await f.api.confirmSubscriptionPayment({
      occurrenceId: next.id,
      transactionId: 'payment',
    });
    await f.api.updateSubscription(id, { amount: 23900 });
    const history = await f.api.getSubscriptionHistory(id);
    expect(history.find(item => item.id === next.id)?.expectedAmount).toBe(
      38900,
    );
    expect(
      history.find(item => item.expectedDate === '2026-11-15')?.expectedAmount,
    ).toBe(23900);
    expect((await f.api.getNextSubscriptionCharge())?.expectedDate).toBe(
      '2026-11-15',
    );
    await f.api.pauseSubscription(id);
    expect(await f.api.getActiveSubscriptions()).toHaveLength(0);
    expect(
      (await f.api.getSubscriptionHistory(id)).some(
        item => item.skipReason === 'pause',
      ),
    ).toBe(true);
    f.setNow('2026-11-20T12:00:00Z');
    await f.api.resumeSubscription(id);
    expect((await f.api.getNextSubscriptionCharge())?.expectedDate).toBe(
      '2026-12-15',
    );
    const december = (await f.api.getNextSubscriptionCharge())!;
    await f.api.skipSubscriptionOccurrence(december.id, 'Gratis este mes');
    expect((await f.api.getNextSubscriptionCharge())?.expectedDate).toBe(
      '2027-01-15',
    );
    expect(await f.api.getMonthlySubscriptionCommitment()).toBe(23900);
    expect(await f.api.getAnnualSubscriptionCommitment()).toBe(286800);
    await f.api.cancelSubscription(id);
    expect(
      (await f.api.getSubscriptionHistory(id)).find(item => item.id === next.id)
        ?.transaction?.id,
    ).toBe('payment');
    expect(
      f
        .query("SELECT balance_amount FROM accounts WHERE id='bank'")
        .rows.item(0)?.balance_amount,
    ).toBe(1000000);
    expect(f.query('SELECT * FROM transactions').rows.length).toBe(1);
    await expect(f.api.resumeSubscription(id)).rejects.toThrow('definitiva');
  } finally {
    f.native.close();
  }
});
test('synchronization and concurrent creation are idempotent, including backup revision', async () => {
  const f = await fixture();
  try {
    await f.api.createSubscription(f.input);
    await f.api.syncSubscriptions();
    const revision = f
      .query('SELECT revision FROM financial_data_revision')
      .rows.item(0)?.revision;
    const state = f.query('SELECT * FROM subscription_occurrences').rows.raw();
    await Promise.all([f.api.syncSubscriptions(), f.api.syncSubscriptions()]);
    expect(
      f.query('SELECT * FROM subscription_occurrences').rows.raw(),
    ).toEqual(state);
    expect(
      f.query('SELECT revision FROM financial_data_revision').rows.item(0)
        ?.revision,
    ).toBe(revision);
    expect(f.query('SELECT * FROM cash_flow_events').rows.length).toBe(
      state.length,
    );
  } finally {
    f.native.close();
  }
});
test('validates domain input and rolls back failed multi-entity mutations', async () => {
  const f = await fixture();
  try {
    for (const patch of [
      { name: '' },
      { amount: -1 },
      { accountId: 'missing' },
      { categoryId: 'missing' },
      { subcategoryId: 'missing' },
      { anchorDate: '2026-02-30' },
      { amount: NaN },
    ]) {
      await expect(
        f.api.createSubscription({ ...f.input, ...patch }),
      ).rejects.toThrow();
    }
    f.failOn('INSERT INTO cash_flow_events');
    await expect(f.api.createSubscription(f.input)).rejects.toThrow();
    f.failOn();
    expect(await f.api.getSubscriptions()).toHaveLength(0);
    expect(f.query('SELECT * FROM subscription_occurrences').rows.length).toBe(
      0,
    );
  } finally {
    f.native.close();
  }
});
test('payment edits update actual values and deletion restores an unresolved obligation atomically', async () => {
  const f = await fixture();
  try {
    const created = await f.api.createSubscription(f.input);
    const occurrence = (await f.api.getNextSubscriptionCharge())!;
    await f.transactions.saveTransactions([f.transaction]);
    await f.api.confirmSubscriptionPayment({
      occurrenceId: occurrence.id,
      transactionId: f.transaction.id,
    });
    await f.transactions.saveTransactions([
      { ...f.transaction, amount: 45000 },
    ]);
    expect(
      (await f.api.getSubscriptionHistory(created.value.id)).find(
        item => item.id === occurrence.id,
      )?.actualAmount,
    ).toBe(45000);
    await f.transactions.deleteTransaction(f.transaction.id);
    const history = await f.api.getSubscriptionHistory(created.value.id);
    expect(history.find(item => item.id === occurrence.id)).toMatchObject({
      status: 'pending',
      transactionId: undefined,
      actualAmount: undefined,
    });
    expect(
      f.query(
        "SELECT * FROM cash_flow_events WHERE source_entity_id=? AND status='projected'",
        [occurrence.id],
      ).rows.length,
    ).toBe(1);
  } finally {
    f.native.close();
  }
});
test('rejects missing, cancelled, skipped and duplicate reconciliation', async () => {
  const f = await fixture();
  try {
    await f.api.createSubscription(f.input);
    const occurrence = (await f.api.getNextSubscriptionCharge())!;
    await expect(
      f.api.confirmSubscriptionPayment({
        occurrenceId: occurrence.id,
        transactionId: 'missing',
      }),
    ).rejects.toThrow();
    await f.transactions.saveTransactions([
      { ...f.transaction, status: 'cancelled' },
    ]);
    await expect(
      f.api.confirmSubscriptionPayment({
        occurrenceId: occurrence.id,
        transactionId: 'payment',
      }),
    ).rejects.toThrow();
    await f.transactions.saveTransactions([f.transaction]);
    await f.api.confirmSubscriptionPayment({
      occurrenceId: occurrence.id,
      transactionId: 'payment',
    });
    const next = (await f.api.getNextSubscriptionCharge())!;
    await expect(
      f.api.confirmSubscriptionPayment({
        occurrenceId: next.id,
        transactionId: 'payment',
      }),
    ).rejects.toThrow();
    await f.api.skipSubscriptionOccurrence(next.id);
    await expect(
      f.api.confirmSubscriptionPayment({
        occurrenceId: next.id,
        transactionId: 'payment',
      }),
    ).rejects.toThrow();
  } finally {
    f.native.close();
  }
});
test('platform failures preserve SQLite intentions, permission denial and recovery are safe', async () => {
  const f = await fixture();
  try {
    (f.service.schedule as jest.Mock).mockRejectedValue(
      new Error('platform failed'),
    );
    const created = await f.api.createSubscription(f.input);
    expect(created.sync.reminderErrors.length).toBeGreaterThan(0);
    expect(await f.api.getSubscriptions()).toHaveLength(1);
    expect(
      f.query(
        "SELECT * FROM subscription_reminders WHERE delivery_status='failed'",
      ).rows.length,
    ).toBeGreaterThan(0);
    (f.service.schedule as jest.Mock).mockResolvedValue(undefined);
    await f.api.syncSubscriptionReminders();
    expect(
      f.query(
        "SELECT * FROM subscription_reminders WHERE delivery_status='failed'",
      ).rows.length,
    ).toBe(0);
    (f.service.getStatus as jest.Mock).mockResolvedValue({
      available: true,
      permission: 'denied',
    });
    await f.api.syncSubscriptionReminders();
    expect(
      f.query(
        "SELECT * FROM subscription_reminders WHERE delivery_status='blocked'",
      ).rows.length,
    ).toBeGreaterThan(0);
  } finally {
    f.native.close();
  }
});
test('legacy migration preserves data, is repeatable and rolls back failures', async () => {
  const sql = realSQLite();
  try {
    for (const statement of SQLITE_SCHEMA_STATEMENTS)
      await sql.database.executeSql(statement);
    sql.native.exec(
      "INSERT INTO recurring_subscriptions (id,name,amount,currency,periodicity,next_charge_date,status,created_at,updated_at) VALUES ('legacy','Netflix',38900,'COP','monthly','2026-10-15','active','2026-01-01','2026-01-01');",
    );
    sql.failOn('CREATE TABLE IF NOT EXISTS subscription_reminders');
    await expect(applyVersionedMigrations(sql.database)).rejects.toThrow();
    expect(sql.query('SELECT * FROM schema_migrations').rows.length).toBe(0);
    sql.failOn();
    await applyVersionedMigrations(sql.database);
    await applyVersionedMigrations(sql.database);
    expect(sql.query('SELECT * FROM schema_migrations').rows.length).toBe(2);
    expect(
      sql
        .query('SELECT anchor_date,amount FROM recurring_subscriptions')
        .rows.item(0),
    ).toEqual({ anchor_date: '2026-10-15', amount: 38900 });
    expect(
      await createSqliteSubscriptionRepository(sql.database).getSubscriptions(),
    ).toHaveLength(1);
  } finally {
    sql.native.close();
  }
});
test('closed accounts produce configuration alerts and financial wipe leaves settings and schema intact', async () => {
  const f = await fixture();
  try {
    await f.api.createSubscription(f.input);
    f.native.exec("UPDATE accounts SET status='closed' WHERE id='bank';");
    await f.api.syncSubscriptions();
    expect(
      f.query(
        "SELECT * FROM smart_alerts WHERE alert_type='subscription_account_invalid' AND status='open'",
      ).rows.length,
    ).toBe(1);
    f.native.exec(
      "INSERT INTO app_settings VALUES ('theme','dark','2026-01-01');",
    );
    await createSqliteFinancialDataRepository(f.database).deleteFinancialData();
    expect(f.query('SELECT * FROM subscription_occurrences').rows.length).toBe(
      0,
    );
    expect(f.query('SELECT * FROM subscription_reminders').rows.length).toBe(0);
    expect(f.query('SELECT * FROM app_settings').rows.length).toBe(1);
    expect(f.query('SELECT * FROM schema_migrations').rows.length).toBe(2);
    expect(f.query('PRAGMA foreign_key_check').rows.length).toBe(0);
  } finally {
    f.native.close();
  }
});

test('schedule edits preserve paid and past obligations, and only replace future periods', async () => {
  const f = await fixture();
  try {
    const created = await f.api.createSubscription(f.input);
    const october = (await f.api.getNextSubscriptionCharge())!;
    await f.transactions.saveTransactions([f.transaction]);
    await f.api.confirmSubscriptionPayment({
      occurrenceId: october.id,
      transactionId: 'payment',
    });
    f.setNow('2026-10-20T12:00:00Z');
    await f.api.updateSubscription(created.value.id, {
      recurrence: { periodicity: 'weekly' },
      anchorDate: '2026-10-22',
    });
    const history = await f.api.getSubscriptionHistory(created.value.id);
    expect(history.find(item => item.id === october.id)).toMatchObject({
      status: 'paid',
      expectedAmount: 38900,
      actualAmount: 42900,
    });
    expect(
      history.find(item => item.expectedDate === '2026-11-15')?.skipReason,
    ).toBe('rescheduled');
    expect((await f.api.getNextSubscriptionCharge())?.expectedDate).toBe(
      '2026-10-22',
    );
    const cursor = (await f.api.getSubscriptionById(created.value.id))
      ?.generationCursor;
    await f.api.updateSubscription(created.value.id, {
      name: 'Netflix nuevo nombre',
    });
    expect(
      (await f.api.getSubscriptionById(created.value.id))?.generationCursor,
    ).toBe(cursor);
  } finally {
    f.native.close();
  }
});
test('long pauses never backfill suspended periods or revive manual skips', async () => {
  const f = await fixture();
  try {
    const created = await f.api.createSubscription(f.input);
    const october = (await f.api.getNextSubscriptionCharge())!;
    await f.api.skipSubscriptionOccurrence(october.id);
    await f.api.pauseSubscription(created.value.id);
    f.setNow('2028-03-01T12:00:00Z');
    await f.api.syncSubscriptions();
    await f.api.resumeSubscription(created.value.id);
    expect((await f.api.getNextSubscriptionCharge())?.expectedDate).toBe(
      '2028-03-15',
    );
    expect(
      f.query(
        "SELECT * FROM subscription_occurrences WHERE expected_date BETWEEN '2027-01-01' AND '2028-02-29'",
      ).rows.length,
    ).toBe(0);
    expect(
      (await f.api.getSubscriptionHistory(created.value.id)).find(
        item => item.id === october.id,
      )?.skipReason,
    ).toBe('manual');
  } finally {
    f.native.close();
  }
});
test('annual charges always materialize the next obligation beyond the 90-day horizon', async () => {
  const f = await fixture();
  try {
    await f.api.createSubscription({
      ...f.input,
      recurrence: { periodicity: 'yearly' },
    });
    const october = (await f.api.getNextSubscriptionCharge())!;
    await f.api.skipSubscriptionOccurrence(october.id);
    expect((await f.api.getNextSubscriptionCharge())?.expectedDate).toBe(
      '2027-10-15',
    );
    await f.api.syncSubscriptions();
    expect(
      f.query(
        "SELECT * FROM subscription_occurrences WHERE expected_date='2027-10-15'",
      ).rows.length,
    ).toBe(1);
  } finally {
    f.native.close();
  }
});
test('account UPSERT and category fallback preserve occurrences and transaction links', async () => {
  const f = await fixture();
  try {
    const created = await f.api.createSubscription(f.input);
    const october = (await f.api.getNextSubscriptionCharge())!;
    await f.transactions.saveTransactions([f.transaction]);
    await f.api.confirmSubscriptionPayment({
      occurrenceId: october.id,
      transactionId: 'payment',
    });
    const accountRepository = createSqliteAccountRepository(f.database);
    const accounts = await accountRepository.getAccounts();
    await accountRepository.saveAccounts(
      accounts.map(account => ({ ...account, name: 'Banco actualizado' })),
    );
    f.native.exec(
      "INSERT INTO categories VALUES ('other','Otros','expense','other','#000');",
    );
    await createSqliteCategoryRepository(f.database).deleteCategoryAndReassign(
      'entertainment',
      'other',
    );
    expect(
      (await f.api.getSubscriptionById(created.value.id))?.categoryId,
    ).toBe('other');
    expect(
      (await f.api.getSubscriptionHistory(created.value.id)).find(
        item => item.id === october.id,
      )?.transactionId,
    ).toBe('payment');
    expect(f.query('PRAGMA foreign_key_check').rows.length).toBe(0);
  } finally {
    f.native.close();
  }
});
test('incompatible edits reopen paid occurrences and roll back when dependent writes fail', async () => {
  const f = await fixture();
  try {
    const created = await f.api.createSubscription(f.input);
    const october = (await f.api.getNextSubscriptionCharge())!;
    await f.transactions.saveTransactions([f.transaction]);
    await f.api.confirmSubscriptionPayment({
      occurrenceId: october.id,
      transactionId: 'payment',
    });
    f.failOn('UPDATE subscription_occurrences');
    await expect(
      f.transactions.saveTransactions([{ ...f.transaction, type: 'income' }]),
    ).rejects.toThrow();
    f.failOn();
    expect(
      f.query("SELECT type FROM transactions WHERE id='payment'").rows.item(0)
        ?.type,
    ).toBe('expense');
    await f.transactions.saveTransactions([
      { ...f.transaction, type: 'income' },
    ]);
    expect(
      (await f.api.getSubscriptionHistory(created.value.id)).find(
        item => item.id === october.id,
      )?.transactionId,
    ).toBeUndefined();
  } finally {
    f.native.close();
  }
});
test('invalid legacy rules are quarantined with stable alerts without deleting their data', async () => {
  const f = await fixture();
  try {
    f.native.exec(
      "INSERT INTO recurring_subscriptions (id,name,amount,currency,periodicity,status,created_at,updated_at) VALUES ('bad','Herencia',12,'USD','unrecognized','active','2026-01-01','2026-01-01');",
    );
    await f.api.syncSubscriptions();
    await f.api.syncSubscriptions();
    expect(await f.api.getSubscriptionDiagnostics()).toHaveLength(1);
    expect(await f.api.getSubscriptions()).toHaveLength(0);
    expect(
      f.query("SELECT * FROM recurring_subscriptions WHERE id='bad'").rows
        .length,
    ).toBe(1);
    expect(
      f.query(
        "SELECT * FROM smart_alerts WHERE alert_type='subscription_configuration_invalid'",
      ).rows.length,
    ).toBe(1);
    await expect(f.api.getSubscriptionById('bad')).rejects.toThrow();
  } finally {
    f.native.close();
  }
});
test('ranges are inclusive, history paginates, and summary computes annualized totals', async () => {
  const f = await fixture();
  try {
    const created = await f.api.createSubscription({
      ...f.input,
      amount: 700,
      recurrence: { periodicity: 'weekly' },
    });
    expect(
      await f.api.getUpcomingSubscriptionCharges({
        from: '2026-10-15',
        to: '2026-10-15',
      }),
    ).toHaveLength(1);
    expect(
      await f.api.getSubscriptionHistory(created.value.id, {
        limit: 2,
        offset: 1,
      }),
    ).toHaveLength(2);
    const summary = await f.api.getSubscriptionSummary();
    expect(summary).toMatchObject({
      activeCount: 1,
      annualEquivalent: 36524.25,
      monthlyEquivalent: 3043.69,
      overdueCount: 0,
    });
    await expect(
      f.api.getUpcomingSubscriptionCharges({
        from: '2026-11-01',
        to: '2026-10-01',
      }),
    ).rejects.toThrow();
    expect(() =>
      f.api.getSubscriptionHistory(created.value.id, { limit: 0 }),
    ).toThrow();
  } finally {
    f.native.close();
  }
});
test('bounded backlog processing still guarantees a future occurrence and converges', async () => {
  const f = await fixture();
  try {
    const created = await f.api.createSubscription({
      ...f.input,
      anchorDate: '2024-01-01',
      recurrence: { periodicity: 'custom', interval: 1, unit: 'days' },
      reminders: { enabled: false },
    });
    expect(created.sync.hasMore).toBe(true);
    expect((await f.api.getNextSubscriptionCharge())?.expectedDate).toBe(
      '2026-10-03',
    );
    let result = await f.api.syncSubscriptions();
    while (result.hasMore) result = await f.api.syncSubscriptions();
    const rows = f
      .query('SELECT expected_date FROM subscription_occurrences')
      .rows.raw();
    expect(rows.length).toBe(new Set(rows.map(row => row.expected_date)).size);
    expect(rows.length).toBeGreaterThan(1000);
  } finally {
    f.native.close();
  }
});
test('post-commit acknowledgement failure returns the saved subscription with a recoverable error', async () => {
  const f = await fixture();
  try {
    jest
      .spyOn(f.repository, 'acknowledgeReminder')
      .mockRejectedValue(new Error('acknowledgement unavailable'));
    const created = await f.api.createSubscription(f.input);
    expect(created.value.name).toBe('Netflix');
    expect(created.sync.reminderErrors.length).toBeGreaterThan(0);
    expect(await f.api.getSubscriptions()).toHaveLength(1);
  } finally {
    f.native.close();
  }
});

test('device timezone changes reschedule local reminders while preserving civil due dates', () => {
  const runtime = require('node:process') as {
    execPath: string;
    env: Record<string, string | undefined>;
    cwd: () => string;
  };
  const { execFileSync } = require('node:child_process') as {
    execFileSync: (
      file: string,
      args: string[],
      options: {
        cwd: string;
        env: Record<string, string | undefined>;
        encoding: string;
      },
    ) => string;
  };
  // Jest virtualizes process.env; separate runtimes exercise actual timezone/DST behavior.
  const script = `
    const ts = require('typescript');
    const fs = require('node:fs');
    require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,filename);
    const lifecycle = require('./src/modules/subscriptions/useCases/subscriptionLifecycle.ts');
    const state = process.argv[1] ? JSON.parse(process.argv[1]) : { subscriptions: [],occurrences: [],reminders: [],projections: [],alerts: [],accounts: [],categories: [],subcategories: [],transactions: [],diagnostics: [] };
    if (!state.subscriptions.length) lifecycle.buildSubscription(state,{ name: 'Netflix',amount: 38900,recurrence: { periodicity: 'monthly' },anchorDate: '2026-03-10' },'timezone-test','2026-03-07T12:00:00.000Z');
    lifecycle.synchronizeSubscriptionState(state,'2026-03-07','2026-03-07T12:00:00.000Z');
    process.stdout.write(JSON.stringify(state));
  `;
  const run = (zone: string, state?: string) =>
    execFileSync(runtime.execPath, ['-e', script, ...(state ? [state] : [])], {
      cwd: runtime.cwd(),
      env: { ...runtime.env, TZ: zone },
      encoding: 'utf8',
    });
  const first = run('America/New_York');
  const newYork = JSON.parse(first) as {
    reminders: { offsetDays: number; fireAt: string }[];
  };
  expect(newYork.reminders.find(value => value.offsetDays === 3)?.fireAt).toBe(
    '2026-03-07T14:00:00.000Z',
  );
  expect(newYork.reminders.find(value => value.offsetDays === 1)?.fireAt).toBe(
    '2026-03-09T13:00:00.000Z',
  );
  const bogota = JSON.parse(run('America/Bogota', first)) as {
    reminders: { offsetDays: number; fireAt: string }[];
    subscriptions: { nextChargeDate: string }[];
  };
  expect(bogota.reminders.find(value => value.offsetDays === 1)?.fireAt).toBe(
    '2026-03-09T14:00:00.000Z',
  );
  expect(bogota.subscriptions[0]?.nextChargeDate).toBe('2026-03-10');
});

test('synchronization at a later clock time avoids needless writes', async () => {
  const f = await fixture();
  try {
    await f.api.createSubscription(f.input);
    const revision = f
      .query('SELECT revision FROM financial_data_revision')
      .rows.item(0)?.revision;
    f.setNow('2026-10-03T14:00:00Z');
    await f.api.syncSubscriptions();
    expect(
      f.query('SELECT revision FROM financial_data_revision').rows.item(0)
        ?.revision,
    ).toBe(revision);
  } finally {
    f.native.close();
  }
});

test('editing a transaction linked to an old paid period updates history outside the future scope', async () => {
  const f = await fixture();
  try {
    const created = await f.api.createSubscription({
      ...f.input,
      anchorDate: '2026-07-15',
    });
    const old = (await f.api.getSubscriptionHistory(created.value.id)).find(
      item => item.expectedDate === '2026-07-15',
    )!;
    await f.transactions.saveTransactions([
      { ...f.transaction, date: '2026-07-15T12:00:00Z' },
    ]);
    await f.api.confirmSubscriptionPayment({
      occurrenceId: old.id,
      transactionId: 'payment',
    });
    await f.transactions.saveTransactions([
      { ...f.transaction, date: '2026-07-15T12:00:00Z', amount: 47000 },
    ]);
    expect(
      (await f.api.getSubscriptionHistory(created.value.id)).find(
        item => item.id === old.id,
      )?.actualAmount,
    ).toBe(47000);
  } finally {
    f.native.close();
  }
});

test('one-date amount edits preserve the contract, other months, actual payment and balances', async () => {
  const f = await fixture();
  try {
    const { value } = await f.api.createSubscription(f.input);
    const before = await f.api.getSubscriptionHistory(value.id);
    const occurrence = before.find(item => item.expectedDate === '2026-10-15');
    if (!occurrence) throw new Error('Missing occurrence');
    await f.api.updateSubscriptionOccurrenceAmount(occurrence.id, 42000);
    await f.api.syncSubscriptions();
    const after = await f.api.getSubscriptionHistory(value.id);
    expect(after.find(item => item.id === occurrence.id)?.expectedAmount).toBe(
      42000,
    );
    expect(after.filter(item => item.id !== occurrence.id)).toEqual(
      before.filter(item => item.id !== occurrence.id),
    );
    expect((await f.api.getSubscriptionById(value.id))?.amount).toBe(38900);
    await f.transactions.saveTransactions([f.transaction]);
    await f.api.confirmSubscriptionPayment({
      occurrenceId: occurrence.id,
      transactionId: f.transaction.id,
    });
    await f.api.updateSubscriptionOccurrenceAmount(occurrence.id, 42900);
    const paid = (await f.api.getSubscriptionHistory(value.id)).find(
      item => item.id === occurrence.id,
    );
    expect(paid).toMatchObject({
      status: 'paid',
      actualAmount: 42900,
      expectedAmount: 42900,
      transactionId: f.transaction.id,
    });
    expect(
      f
        .query('SELECT status FROM smart_alerts WHERE id=?', [
          `subscription-price-actual-${occurrence.id}`,
        ])
        .rows.item(0)?.status,
    ).toBe('resolved');
    await f.api.updateSubscriptionOccurrenceAmount(occurrence.id, 44000);
    expect(
      f
        .query('SELECT message FROM smart_alerts WHERE id=?', [
          `subscription-price-actual-${occurrence.id}`,
        ])
        .rows.item(0)?.message,
    ).toContain('44000');
    for (const amount of [0, -1, Infinity, Number.MAX_SAFE_INTEGER])
      await expect(
        f.api.updateSubscriptionOccurrenceAmount(occurrence.id, amount),
      ).rejects.toThrow();
    expect(
      f
        .query("SELECT balance_amount FROM accounts WHERE id='bank'")
        .rows.item(0)?.balance_amount,
    ).toBe(1000000);
    expect(
      f.query('SELECT COUNT(*) AS count FROM transactions').rows.item(0)?.count,
    ).toBe(1);
  } finally {
    f.native.close();
  }
});

test('subscription category creation reuses category rules and validates expense parents', async () => {
  const f = await fixture();
  try {
    const category = await f.api.createSubscriptionCategory('Streaming');
    const subcategory = await f.api.createSubscriptionSubcategory(
      category.value.id,
      'Video',
    );
    expect(category.value.type).toBe('expense');
    expect(subcategory.value).toMatchObject({
      categoryId: category.value.id,
      name: 'Video',
      isActive: true,
    });
    await expect(
      f.api.createSubscriptionCategory(' streaming '),
    ).rejects.toThrow();
    await expect(
      f.api.createSubscriptionSubcategory('missing', 'Audio'),
    ).rejects.toThrow();
    await expect(
      f.api.createSubscriptionSubcategory(category.value.id, 'video'),
    ).rejects.toThrow();
    expect(
      (await f.api.getSubscriptionFormOptions()).subcategories.some(
        item => item.id === subcategory.value.id,
      ),
    ).toBe(true);
  } finally {
    f.native.close();
  }
});
