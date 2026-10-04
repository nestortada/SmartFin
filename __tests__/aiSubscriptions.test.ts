jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  openDatabase: jest.fn(),
}));
jest.mock('react-native-config', () => ({}));

import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { executeAiCommandPlan } from '../src/modules/transactions/useCases/executeAiCommandPlan';
import {
  applyClarificationAnswer,
  buildClarificationQuestions,
  buildEditableFields,
  normalizeAiCommandPlan,
  parseAiCommandPlan,
  updateAiActionField,
} from '../src/modules/transactions/useCases/aiCommandPlanner';
import { createSqliteSubscriptionRepository } from '../src/modules/subscriptions/repositories/sqliteSubscriptionRepository';
import type { AiPlanningContext } from '../src/modules/transactions/types';
import type { SubscriptionReminderService } from '../src/modules/subscriptions/services/SubscriptionReminderService';

const fields = {
  name: 'Netflix',
  merchantName: 'Netflix Colombia',
  amount: 44900,
  accountId: 'bank',
  categoryId: 'entertainment',
  subcategoryId: null,
  anchorDate: '2026-10-31',
  billingDay: 31,
  periodicity: 'monthly',
  remindersEnabled: true,
  reminderOffsets: '3,1,0',
  reminderHour: 9,
  reminderMinute: 0,
};
const plan = (values: Record<string, unknown> = fields) =>
  parseAiCommandPlan({
    summary: 'Suscripción',
    answeredFields: ['netflix.subcategoryId'],
    actions: [
      {
        id: 'netflix',
        entity: 'subscription',
        operation: 'create',
        fields: values,
      },
    ],
  });
const context: AiPlanningContext = {
  accounts: [
    {
      id: 'bank',
      name: 'Banco',
      type: 'bankAccount',
      status: 'active',
      currency: 'COP',
      balance: { amount: 1000000, currency: 'COP' },
      createdAt: '',
      updatedAt: '',
    },
  ],
  categories: [
    {
      id: 'entertainment',
      name: 'Entretenimiento',
      type: 'expense',
      macroCategory: 'entertainment',
      color: '#000000',
    },
  ],
  subcategories: [],
  transactions: [],
};
async function fixture() {
  const sql = realSQLite();
  for (const statement of SQLITE_SCHEMA_STATEMENTS)
    await sql.database.executeSql(statement);
  await applyVersionedMigrations(sql.database);
  sql.native.exec(
    "INSERT INTO accounts (id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('bank','Banco','bankAccount','active','COP',1000000,'2026-01-01','2026-01-01'); INSERT INTO categories VALUES ('entertainment','Entretenimiento','expense','entertainment','#000');",
  );
  const service: SubscriptionReminderService = {
    getStatus: jest.fn(async () => ({
      available: true,
      permission: 'granted' as const,
    })),
    requestPermission: jest.fn(async () => ({
      available: true,
      permission: 'granted' as const,
    })),
    ensureMaintenance: jest.fn(async () => undefined),
    schedule: jest.fn(async () => undefined),
    cancel: jest.fn(async () => undefined),
    cancelAll: jest.fn(async () => undefined),
  };
  return {
    ...sql,
    service,
    repository: createSqliteSubscriptionRepository(sql.database),
  };
}

test('a complete subscription resolves spoken names and exposes every editable parameter', () => {
  const complete = normalizeAiCommandPlan(
    plan({
      ...fields,
      accountId: undefined,
      accountName: 'Banco',
      categoryId: undefined,
      categoryName: 'Entretenimiento',
    }),
    context,
  );
  expect(buildClarificationQuestions(complete, context)).toEqual([]);
  expect(complete.actions[0]?.fields).toMatchObject({
    accountId: 'bank',
    categoryId: 'entertainment',
  });
  expect(
    buildEditableFields(complete.actions[0]!, complete, context).map(
      item => item.field,
    ),
  ).toEqual(
    expect.arrayContaining([
      'name',
      'merchantName',
      'amount',
      'anchorDate',
      'billingDay',
      'periodicity',
      'accountId',
      'categoryId',
      'subcategoryId',
      'remindersEnabled',
      'reminderOffsets',
      'reminderHour',
      'reminderMinute',
    ]),
  );
  const period = buildEditableFields(
    complete.actions[0]!,
    complete,
    context,
  ).find(item => item.field === 'periodicity')!;
  const changed = updateAiActionField(complete, period, 'custom', context);
  expect(
    buildClarificationQuestions(changed, context).map(item => item.field),
  ).toEqual(['customInterval', 'customUnit']);
});

test('missing and invalid parameters require clarification; subscription update/delete is rejected', () => {
  const questions = buildClarificationQuestions(
    normalizeAiCommandPlan(
      plan({
        name: 'Netflix',
        amount: -1,
        anchorDate: '2026-02-31',
        periodicity: 'custom',
        customInterval: 0,
      }),
      context,
    ),
    context,
  );
  expect(questions.map(item => item.field)).toEqual(
    expect.arrayContaining([
      'amount',
      'anchorDate',
      'customInterval',
      'customUnit',
      'accountId',
      'categoryId',
      'remindersEnabled',
    ]),
  );
  for (const operation of ['update', 'delete'])
    expect(() =>
      parseAiCommandPlan({
        actions: [{ id: 'x', entity: 'subscription', operation, fields: {} }],
      }),
    ).toThrow('solo permite crear');
});

test('category/subcategory answers create linked actions before the subscription', () => {
  let current = plan({
    ...fields,
    categoryId: undefined,
    subcategoryId: undefined,
  });
  let question = buildClarificationQuestions(current, context).find(
    item => item.field === 'categoryId',
  )!;
  current = normalizeAiCommandPlan(
    applyClarificationAnswer(current, question, 'Streaming', context),
    context,
  );
  question = buildClarificationQuestions(current, context).find(
    item => item.field === 'subcategoryId',
  )!;
  current = applyClarificationAnswer(current, question, 'Video', context);
  expect(current.actions.map(item => item.entity)).toEqual([
    'category',
    'subcategory',
    'subscription',
  ]);
  expect(current.actions[2]?.fields).toMatchObject({
    categoryRef: 'netflix-category-ref',
    subcategoryRef: 'netflix-subcategory-ref',
  });
});

test('confirmed subscription persists occurrences and reminder intent, remains idempotent and never changes money', async () => {
  const f = await fixture();
  try {
    await executeAiCommandPlan(f.database, 'draft1', plan(), f.service);
    await executeAiCommandPlan(f.database, 'draft1', plan(), f.service);
    const subscriptions = await f.repository.getSubscriptions();
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({
      amount: 44900,
      billingDay: 31,
      merchantName: 'Netflix Colombia',
      accountId: 'bank',
      recurrence: { periodicity: 'monthly' },
      reminders: { enabled: true, offsets: [3, 1, 0], hour: 9, minute: 0 },
    });
    expect(
      f.query('SELECT * FROM subscription_occurrences').rows.length,
    ).toBeGreaterThan(0);
    expect(
      f.query('SELECT * FROM subscription_reminders').rows.length,
    ).toBeGreaterThan(0);
    expect(f.query('SELECT * FROM transactions').rows.length).toBe(0);
    expect(
      f
        .query('SELECT balance_amount, debt_balance_amount FROM accounts')
        .rows.item(0),
    ).toMatchObject({ balance_amount: 1000000, debt_balance_amount: null });
    expect(f.service.requestPermission).not.toHaveBeenCalled();
  } finally {
    f.native.close();
  }
});

test('a mixed category/subcategory/subscription command uses references and rolls back if a later action fails', async () => {
  const f = await fixture();
  const batch = parseAiCommandPlan({
    actions: [
      {
        id: 'cat',
        clientRef: 'new-cat',
        entity: 'category',
        operation: 'create',
        fields: { name: 'Streaming', type: 'expense' },
      },
      {
        id: 'sub',
        clientRef: 'new-sub',
        entity: 'subcategory',
        operation: 'create',
        fields: { name: 'Video', categoryRef: 'new-cat' },
      },
      {
        id: 'netflix',
        entity: 'subscription',
        operation: 'create',
        fields: {
          ...fields,
          categoryId: undefined,
          categoryRef: 'new-cat',
          subcategoryId: undefined,
          subcategoryRef: 'new-sub',
          periodicity: 'custom',
          customInterval: 2,
          customUnit: 'months',
        },
      },
      {
        id: 'invalid',
        entity: 'subscription',
        operation: 'create',
        fields: { ...fields, amount: 0 },
      },
    ],
  });
  try {
    await expect(
      executeAiCommandPlan(f.database, 'mixed', batch, f.service),
    ).rejects.toThrow();
    expect(await f.repository.getSubscriptions()).toHaveLength(0);
    expect(
      f.query("SELECT * FROM categories WHERE name='Streaming'").rows.length,
    ).toBe(0);
    expect(f.query('SELECT * FROM subscription_occurrences').rows.length).toBe(
      0,
    );
    expect(f.service.schedule).not.toHaveBeenCalled();
    batch.actions.pop();
    await executeAiCommandPlan(f.database, 'mixed', batch, f.service);
    expect((await f.repository.getSubscriptions())[0]).toMatchObject({
      recurrence: { periodicity: 'custom', interval: 2, unit: 'months' },
    });
    expect(f.query('SELECT * FROM subcategories').rows.length).toBe(1);
  } finally {
    f.native.close();
  }
});

test('a notification failure after commit reports financial success and keeps retryable reminders', async () => {
  const f = await fixture();
  try {
    f.service.schedule = jest.fn(async () => {
      throw new Error('Alarm failure');
    });
    const result = await executeAiCommandPlan(
      f.database,
      'notifications',
      plan(),
      f.service,
    );
    expect(result.completed.join(' ')).toContain(
      'Hay recordatorios pendientes',
    );
    expect(await f.repository.getSubscriptions()).toHaveLength(1);
    expect(
      f.query(
        "SELECT * FROM subscription_reminders WHERE delivery_status='failed'",
      ).rows.length,
    ).toBeGreaterThan(0);
  } finally {
    f.native.close();
  }
});

test('only an explicitly requested expense changes money; a persistence failure rolls back the entire mixed command', async () => {
  const f = await fixture();
  const batch = parseAiCommandPlan({ actions: [
    { id: 'expense', entity: 'transaction', operation: 'create', fields: { accountId: 'bank', amount: 44900, description: 'Netflix pagado', date: '2026-10-03T12:00:00Z', transactionType: 'expense', categoryId: 'entertainment' } },
    { id: 'netflix', entity: 'subscription', operation: 'create', fields },
  ] });
  try {
    f.failOn('INSERT INTO subscription_reminders');
    await expect(executeAiCommandPlan(f.database, 'mixed-expense', batch, f.service)).rejects.toThrow('Injected SQLite failure');
    expect(f.query('SELECT * FROM transactions').rows.length).toBe(0);
    expect(f.query('SELECT balance_amount FROM accounts').rows.item(0)).toMatchObject({ balance_amount: 1000000 });
    expect(await f.repository.getSubscriptions()).toHaveLength(0);
    f.failOn();
    await executeAiCommandPlan(f.database, 'mixed-expense', batch, f.service);
    expect(f.query('SELECT * FROM transactions').rows.length).toBe(1);
    expect(f.query('SELECT balance_amount FROM accounts').rows.item(0)).toMatchObject({ balance_amount: 955100 });
    expect(await f.repository.getSubscriptions()).toHaveLength(1);
    expect(f.query("SELECT * FROM subscription_occurrences WHERE status='paid'").rows.length).toBe(0);
  } finally { f.native.close(); }
});

test.each([
  { accountId: 'missing' },
  { categoryId: 'missing' },
  { subcategoryId: 'missing' },
  { reminderOffsets: '366' },
  { reminderHour: 24 },
  { amount: Number.MAX_SAFE_INTEGER },
])(
  'domain rejects invalid references and configuration without persisting: %j',
  async invalid => {
    const f = await fixture();
    try {
      await expect(
        executeAiCommandPlan(
          f.database,
          'invalid',
          plan({ ...fields, ...invalid }),
          f.service,
        ),
      ).rejects.toThrow();
      expect(await f.repository.getSubscriptions()).toHaveLength(0);
    } finally {
      f.native.close();
    }
  },
);
