import {
  sharedExpenseFixture,
  SHARED_TEST_DATE,
} from './helpers/sharedExpenseFixture';
import {
  encodeTransactionDate,
  parseTransactionDate,
  bogotaToday,
  transactionDateKey,
  TRANSACTION_TIME_ZONE,
} from '../src/shared/utils/transactionDate';
import {
  groupTransactionsByDate,
  formatTransactionDateHeader,
} from '../src/modules/transactions/ui/transactionsScreenFormatters';
import { applyVersionedMigrations } from '../src/database/migrations';
import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import {
  SHARED_EXPENSE_INDEXES,
  SHARED_EXPENSE_SCHEMA,
  SHARED_EXPENSE_TRIGGERS,
} from '../src/modules/transactions/database/sharedExpenseSchema';
import {
  applyClarificationAnswer,
  buildClarificationQuestions,
  normalizeAiCommandPlan,
} from '../src/modules/transactions/useCases/aiCommandPlanner';
import { executeAiCommandPlan } from '../src/modules/transactions/useCases/executeAiCommandPlan';
import type {
  AiCommandPlan,
  AiPlanningContext,
} from '../src/modules/transactions/types';
import type { TransactionHistoryCursor } from '../src/modules/transactions/types/TransactionHistoryQuery';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'],
  });
  jest.setSystemTime(SHARED_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

test('civil dates and explicit Colombia hours have distinct storage; UTC rollover cannot change the civil day', () => {
  expect(encodeTransactionDate({ kind: 'date', date: '2026-10-05' })).toEqual({
    date: '2026-10-05',
    civilDate: '2026-10-05',
    datePrecision: 'date',
  });
  expect(
    encodeTransactionDate({
      kind: 'dateTime',
      date: '2026-10-05',
      time: '23:00',
      timeZone: TRANSACTION_TIME_ZONE,
    }),
  ).toEqual({
    date: '2026-10-06T04:00:00.000Z',
    civilDate: '2026-10-05',
    localTime: '23:00',
    timeZone: TRANSACTION_TIME_ZONE,
    datePrecision: 'dateTime',
  });
  expect(bogotaToday(new Date('2026-10-06T00:00:00Z'))).toBe('2026-10-05');
  expect(parseTransactionDate('2026-10-05')).toEqual({
    kind: 'date',
    date: '2026-10-05',
  });
  expect(parseTransactionDate('2026-10-05T23:00:00-05:00')).toMatchObject({
    date: '2026-10-05',
    time: '23:00',
  });
});

test.each([
  '2026-02-30',
  '2026-13-01',
  '0000-01-01',
  '05/10/2026',
  '2026-10-05T24:00',
  '2026-10-05T12:60',
  '2026-10-05T12:01:60',
])('invalid or ambiguous date %s is rejected', date => {
  expect(() => parseTransactionDate(date)).toThrow();
});

test('changing and removing the hour preserves balance, identity and createdAt, while original UTC dates remain untouched', async () => {
  const f = await sharedExpenseFixture();
  try {
    const original = await f.save({
      occurrence: undefined,
      transactionDate: '2026-10-06T00:00:00.000Z',
    });
    const untouched = await f.save({
      editingTransaction: original.transaction,
      occurrence: undefined,
    });
    expect(untouched.transaction.date).toBe('2026-10-06T00:00:00.000Z');
    expect(untouched.transaction.civilDate).toBeUndefined();
    expect(transactionDateKey(untouched.transaction)).toBe('2026-10-06');
    const timed = await f.save({
      editingTransaction: untouched.transaction,
      occurrence: {
        kind: 'dateTime',
        date: '2026-10-05',
        time: '23:00',
        timeZone: TRANSACTION_TIME_ZONE,
      },
    });
    expect(timed.transaction).toMatchObject({
      id: original.transaction.id,
      createdAt: original.transaction.createdAt,
      amount: 30000,
      civilDate: '2026-10-05',
      localTime: '23:00',
    });
    const withoutHour = await f.save({
      editingTransaction: timed.transaction,
      occurrence: { kind: 'date', date: '2026-10-05' },
    });
    expect(withoutHour.transaction.localTime).toBeUndefined();
    expect(withoutHour.transaction.datePrecision).toBe('date');
    expect(await f.balances()).toMatchObject({ bank: 970000 });
    const restored = (await f.transactionRepository.getTransactions())[0]!;
    expect(restored.civilDate).toBe('2026-10-05');
    expect(restored.localTime).toBeUndefined();
  } finally {
    f.native.close();
  }
});

test('month filters, counters, personal statistics, sections and card cycles use the civil month', async () => {
  const f = await sharedExpenseFixture();
  try {
    const result = await f.save({
      accountId: 'card',
      operationType: 'Crédito',
      occurrence: {
        kind: 'dateTime',
        date: '2026-09-30',
        time: '23:00',
        timeZone: TRANSACTION_TIME_ZONE,
      },
    });
    expect(result.transaction.date).toBe('2026-10-01T04:00:00.000Z');
    expect(await f.summary()).toMatchObject({
      monthlyExpenses: 0,
      totalDebt: 30000,
    });
    expect(await f.summary(new Date('2026-09-30T20:00:00Z'))).toMatchObject({
      monthlyExpenses: 30000,
    });
    const query = {
      month: '2026-09',
      accountId: 'all',
      categoryId: 'all',
      search: '',
      sort: 'newest' as const,
    };
    const september = await f.transactionRepository.getTransactionPage(query);
    expect(september.transactions.map(t => t.id)).toEqual([
      result.transaction.id,
    ]);
    expect(
      (
        await f.transactionRepository.getTransactionPage({
          ...query,
          month: '2026-10',
        })
      ).transactions,
    ).toEqual([]);
    expect(await f.transactionRepository.getTransactionMonths()).toEqual([
      '2026-09',
    ]);
    expect(groupTransactionsByDate(september.transactions)[0]?.date).toBe(
      '2026-09-30',
    );
    expect(
      (await f.creditCardRepository.getStatements(['card']))[0]?.totalAmount,
    ).toBe(0);
    expect(
      await f.transactionRepository.getTransactionCountsByDay({
        startDate: '2026-09-01',
        endDateExclusive: '2026-10-01',
        status: 'posted',
      }),
    ).toEqual([{ date: '2026-09-30', count: 1 }]);
    expect(await f.summary(new Date('2026-10-01T02:00:00Z'))).toMatchObject({
      monthlyExpenses: 30000,
    });
  } finally {
    f.native.close();
  }
});

test('transfer companions and 4x1000 inherit both the civil date and explicit hour', async () => {
  const f = await sharedExpenseFixture();
  try {
    await f.save({
      transactionType: 'internalTransfer',
      targetAccountId: 'target',
      amount: 100000,
      transferTaxCharged: true,
      occurrence: {
        kind: 'dateTime',
        date: '2026-10-05',
        time: '23:00',
        timeZone: TRANSACTION_TIME_ZONE,
      },
    });
    const transactions = await f.transactionRepository.getTransactions();
    expect(transactions).toHaveLength(3);
    transactions.forEach(t =>
      expect(t).toMatchObject({
        date: '2026-10-06T04:00:00.000Z',
        civilDate: '2026-10-05',
        localTime: '23:00',
      }),
    );
    expect(await f.summary()).toMatchObject({
      availableBalance: 999600,
      monthlyExpenses: 400,
      monthlyIncome: 0,
    });
  } finally {
    f.native.close();
  }
});

test('paginated mixed legacy/date-only/timed records have stable civil ordering and invalidate on date edit', async () => {
  const f = await sharedExpenseFixture();
  try {
    const originals = [];
    for (let i = 0; i < 55; i++)
      originals.push(
        (
          await f.save({
            amount: 1,
            occurrence:
              i % 2
                ? { kind: 'date', date: '2026-10-05' }
                : {
                    kind: 'dateTime',
                    date: '2026-10-05',
                    time: '23:00',
                    timeZone: TRANSACTION_TIME_ZONE,
                  },
          })
        ).transaction,
      );
    const legacy = (
      await f.save({
        amount: 1,
        occurrence: undefined,
        transactionDate: '2026-10-06T00:00:00.000Z',
      })
    ).transaction;
    const query = {
      month: 'all',
      accountId: 'all',
      categoryId: 'all',
      search: '',
      sort: 'newest' as const,
    };
    let cursor: TransactionHistoryCursor | undefined;
    const actual: string[] = [];
    do {
      const page = await f.transactionRepository.getTransactionPage(
        query,
        cursor,
      );
      actual.push(...page.transactions.map(t => t.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(actual).size).toBe(56);
    expect(actual[0]).toBe(legacy.id);
    const firstPage = await f.transactionRepository.getTransactionPage(query);
    await f.save({
      editingTransaction: originals[0],
      amount: 1,
      occurrence: { kind: 'date', date: '2026-10-04' },
    });
    await expect(
      f.transactionRepository.getTransactionPage(query, firstPage.nextCursor),
    ).rejects.toThrow('cambió');
  } finally {
    f.native.close();
  }
});

test('today labels use Colombia even when UTC is already on the following day', () => {
  jest.setSystemTime(new Date('2026-10-06T02:00:00Z'));
  expect(formatTransactionDateHeader('2026-10-05')).toBe('HOY');
  expect(formatTransactionDateHeader('2026-10-04')).toBe('AYER');
});

test('repositories reject partial or conflicting date metadata before writing a movement', async () => {
  const f = await sharedExpenseFixture();
  try {
    const original = (await f.save()).transaction;
    for (const invalid of [
      {
        ...original,
        civilDate: undefined,
        localTime: '23:00',
        datePrecision: undefined,
      },
      { ...original, localTime: '23:00' },
      {
        ...original,
        datePrecision: 'dateTime' as const,
        localTime: '24:00',
        timeZone: TRANSACTION_TIME_ZONE,
      },
      { ...original, date: '2026-10-06' },
    ])
      await expect(
        f.transactionRepository.saveTransactions([invalid]),
      ).rejects.toThrow();
    expect(await f.transactionRepository.getTransactions()).toEqual([original]);
  } finally {
    f.native.close();
  }
});

test('upgrading an old schema does not rewrite midnight ISO records, and is idempotent', async () => {
  const sql = realSQLite();
  try {
    for (const statement of SQLITE_SCHEMA_STATEMENTS) {
      if (
        [
          ...SHARED_EXPENSE_INDEXES,
          ...SHARED_EXPENSE_SCHEMA,
          ...SHARED_EXPENSE_TRIGGERS,
        ].includes(statement)
      )
        continue;
      const legacy = statement
        .replace(
          / {4}(civil_date|local_time|time_zone|date_precision) TEXT,\n/g,
          '',
        )
        .replace(
          / {4}(shared_expense_id|contact_id|amount_minor|shared_active) [^\n]+\n/g,
          '',
        );
      sql.native.exec(legacy);
    }
    sql.native.exec(
      "INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES('bank','Bank','bankAccount','active','COP',100,'2026-01-01','2026-01-01');",
    );
    sql.native.exec(
      "INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at) VALUES('old',10,'COP','Old','2026-10-06T00:00:00.000Z','bank','expense','outflow','posted','2026-10-06','2026-10-06');",
    );
    await applyVersionedMigrations(sql.database);
    await applyVersionedMigrations(sql.database);
    expect(
      sql
        .query(
          'SELECT date,civil_date,local_time,date_precision FROM transactions',
        )
        .rows.raw(),
    ).toEqual([
      {
        date: '2026-10-06T00:00:00.000Z',
        civil_date: null,
        local_time: null,
        date_precision: null,
      },
    ]);
    expect(sql.query('PRAGMA foreign_key_check').rows.raw()).toEqual([]);
  } finally {
    sql.native.close();
  }
});

test('AI clarification retains a bare date and asks for impossible dates instead of silently dropping them', () => {
  const context: AiPlanningContext = {
    accounts: [],
    categories: [],
    subcategories: [],
    transactions: [],
  };
  const plan: AiCommandPlan = {
    version: 1,
    summary: '',
    answeredFields: [],
    actions: [
      {
        id: 't',
        entity: 'transaction',
        operation: 'create',
        fields: { date: '2026-02-30' },
      },
    ],
  };
  const normalized = normalizeAiCommandPlan(plan, context);
  const question = buildClarificationQuestions(normalized, context).find(
    q => q.field === 'date',
  )!;
  expect(question).toBeDefined();
  const answered = applyClarificationAnswer(
    normalized,
    question,
    '2026-10-05',
    context,
  );
  expect(
    answered.actions[0]?.entity === 'transaction' &&
      answered.actions[0].fields.date,
  ).toBe('2026-10-05');
});

test('migration failure rolls back new tables and date columns without rewriting historical records', async () => {
  const sql = realSQLite();
  try {
    for (const statement of SQLITE_SCHEMA_STATEMENTS) {
      if (
        [
          ...SHARED_EXPENSE_INDEXES,
          ...SHARED_EXPENSE_SCHEMA,
          ...SHARED_EXPENSE_TRIGGERS,
        ].includes(statement)
      )
        continue;
      sql.native.exec(
        statement
          .replace(
            / {4}(civil_date|local_time|time_zone|date_precision) TEXT,\n/g,
            '',
          )
          .replace(
            / {4}(shared_expense_id|contact_id|amount_minor|shared_active) [^\n]+\n/g,
            '',
          ),
      );
    }
    sql.native.exec(
      "INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES('bank','Bank','bankAccount','active','COP',100,'2026-01-01','2026-01-01');",
    );
    sql.native.exec(
      "INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at) VALUES('old',10,'COP','Old','2026-10-06T00:00:00.000Z','bank','expense','outflow','posted','2026-10-06','2026-10-06');",
    );
    sql.injectFault({ phase: 'after', sql: 'ADD COLUMN local_time' });
    await expect(applyVersionedMigrations(sql.database)).rejects.toThrow(
      'Injected',
    );
    expect(sql.query('SELECT date FROM transactions').rows.raw()).toEqual([
      { date: '2026-10-06T00:00:00.000Z' },
    ]);
    expect(
      sql
        .query('PRAGMA table_info(transactions)')
        .rows.raw()
        .some(column => column.name === 'civil_date'),
    ).toBe(false);
    expect(
      sql
        .query("SELECT name FROM sqlite_master WHERE name='shared_expenses'")
        .rows.raw(),
    ).toEqual([]);
    expect(
      sql.query('SELECT version FROM schema_migrations').rows.raw(),
    ).toEqual([]);
    await applyVersionedMigrations(sql.database);
    expect(sql.query('PRAGMA foreign_key_check').rows.raw()).toEqual([]);
  } finally {
    sql.native.close();
  }
});

test('explicit dates honor historical America/Bogota offsets as well as year boundaries', () => {
  const historical = encodeTransactionDate({
    kind: 'dateTime',
    date: '1992-10-05',
    time: '23:00',
    timeZone: TRANSACTION_TIME_ZONE,
  });
  expect(historical.date).toBe('1992-10-06T03:00:00.000Z');
  expect(parseTransactionDate(historical.date)).toMatchObject({
    date: '1992-10-05',
    time: '23:00',
  });
  expect(
    encodeTransactionDate({
      kind: 'dateTime',
      date: '2026-12-31',
      time: '23:59',
      timeZone: TRANSACTION_TIME_ZONE,
    }),
  ).toMatchObject({
    date: '2027-01-01T04:59:00.000Z',
    civilDate: '2026-12-31',
  });
});

test.each(['2026-10-05', '2026-10-05T23:00:00-05:00'])(
  'AI execution persists the supplied precision (%s)',
  async date => {
    const f = await sharedExpenseFixture();
    try {
      const plan: AiCommandPlan = {
        version: 1,
        summary: '',
        answeredFields: [],
        actions: [
          {
            id: 't',
            entity: 'transaction',
            operation: 'create',
            fields: {
              transactionType: 'expense',
              accountId: 'bank',
              amount: 5000,
              description: 'Bus',
              categoryId: 'food',
              date,
            },
          },
        ],
      };
      await executeAiCommandPlan(f.database, 'draft', plan);
      const movement = (await f.transactionRepository.getTransactions())[0]!;
      expect(movement.civilDate).toBe('2026-10-05');
      expect(movement.datePrecision).toBe(
        date.length === 10 ? 'date' : 'dateTime',
      );
      expect(movement.localTime).toBe(date.length === 10 ? undefined : '23:00');
      expect(await f.balances()).toMatchObject({ bank: 995000 });
    } finally {
      f.native.close();
    }
  },
);

test('AI date-only edits preserve card installment progress and transfer tax', async () => {
  const f = await sharedExpenseFixture();
  try {
    const card = await f.save({
      accountId: 'card',
      operationType: 'Crédito',
      installmentCountInput: '3',
      hasInterestFreeInstallments: true,
      interestFreeInstallmentCountInput: '2',
    });
    const installments = (
      await f.creditCardRepository.getInstallmentPurchases(['card'])
    )[0]!;
    await f.creditCardRepository.saveInstallmentPurchases([
      { ...installments, paidInstallments: 1 },
    ]);
    const transfer = await f.save({
      transactionType: 'internalTransfer',
      targetAccountId: 'target',
      amount: 15000,
      transferTaxCharged: true,
    });
    const before = await f.summary();
    await executeAiCommandPlan(f.database, 'dateEdit', {
      version: 1,
      summary: '',
      answeredFields: [],
      actions: [
        {
          id: 'creditDate',
          entity: 'transaction',
          operation: 'update',
          targetId: card.transaction.id,
          fields: { date: '2026-10-06' },
        },
        {
          id: 'transferDate',
          entity: 'transaction',
          operation: 'update',
          targetId: transfer.transaction.id,
          fields: { date: '2026-10-06T23:00:00-05:00' },
        },
      ],
    });
    expect(await f.summary()).toEqual(before);
    expect(
      (await f.creditCardRepository.getInstallmentPurchases(['card']))[0],
    ).toMatchObject({ installmentCount: 3, paidInstallments: 1 });
    const transactions = await f.transactionRepository.getTransactions();
    expect(
      transactions.find(t => t.id === card.transaction.id)?.notes,
    ).toContain('Sin intereses: 2');
    for (const id of [
      transfer.transaction.id,
      `${transfer.transaction.id}-in`,
      `${transfer.transaction.id}-4x1000`,
    ])
      expect(transactions.find(t => t.id === id)).toMatchObject({
        civilDate: '2026-10-06',
        localTime: '23:00',
      });
    expect(
      transactions.find(t => t.id === `${transfer.transaction.id}-4x1000`)
        ?.amount,
    ).toBe(60);
    f.verifyForeignKeys();
  } finally {
    f.native.close();
  }
});
