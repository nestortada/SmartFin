import {
  sharedExpenseFixture,
  SHARED_TEST_DATE,
} from './helpers/sharedExpenseFixture';
import { getDashboardSummaryFromDb as before } from './helpers/dashboardSharedStateBaseline';
import { getSharedFinancialPosition } from '../src/modules/transactions/useCases/sharedExpenseDomain';
import { readSharedFinancialTotals } from '../src/modules/transactions/useCases/readSharedFinancialTotals';
import { SHARED_FINANCIAL_TOTALS_SQL } from '../src/modules/transactions/repositories/sharedFinancialTotalsSql';
import { runSharedSQLiteTransaction } from '../src/database/atomicSQLite';
import { createSqliteSharedExpenseRepository } from '../src/modules/transactions/repositories/sqliteSharedExpenseRepository';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
type Fixture = Awaited<ReturnType<typeof sharedExpenseFixture>>;

async function unchangedAndEquivalent(f: Fixture) {
  const original = await f.transactionRepository.getTransactions();
  const balances = await f.balances();
  const position = getSharedFinancialPosition(
    await f.sharedRepository.getState(),
  );
  expect(await f.sharedRepository.getFinancialTotals()).toEqual({
    receivables: position.receivables,
    thirdPartyAdvances: position.thirdPartyAdvances,
  });
  for (const date of [SHARED_TEST_DATE, new Date('2026-11-15T12:00:00Z')])
    expect(await f.summary(date)).toEqual(await before(f.database, date));
  expect(await f.transactionRepository.getTransactions()).toEqual(original);
  expect(await f.balances()).toEqual(balances);
  f.verifyForeignKeys();
}

test.each([
  'empty',
  'pending',
  'partial',
  'complete',
  'advance',
  'unapplied',
  'credit',
  'multiple',
  'return',
  'cancel',
  'legacy',
  'civil',
])(
  'SQL totals and every dashboard indicator exactly match full-state domain (%s)',
  async scenario => {
    const f = await sharedExpenseFixture();
    try {
      if (scenario === 'empty') {
        await unchangedAndEquivalent(f);
        return;
      }
      if (
        scenario === 'advance' ||
        scenario === 'unapplied' ||
        scenario === 'return'
      ) {
        const receipt = await f.api.recordReceipt('advance', {
          contactId: f.contactId,
          accountId: 'target',
          amount: 15000,
          occurrence: { kind: 'date', date: '2026-09-28' },
        });
        await unchangedAndEquivalent(f);
        if (scenario === 'advance') {
          const expense = await f.purchase();
          await f.api.applyReceipt(
            'apply',
            receipt.entityId,
            expense.participationId,
            15000,
          );
        }
        if (scenario === 'return') {
          await f.api.returnAdvance('return', {
            receiptId: receipt.entityId,
            accountId: 'bank',
            amount: 5000,
            occurrence: { kind: 'date', date: '2026-10-08' },
          });
          await f.api.returnAdvance('return-again', {
            receiptId: receipt.entityId,
            accountId: 'target',
            amount: 2000,
            occurrence: { kind: 'date', date: '2026-11-08' },
          });
        }
      } else if (scenario === 'credit') {
        const saved = await f.save({
          accountId: 'card',
          operationType: 'Crédito',
        });
        await f.api.sharePurchase('credit', {
          transactionId: saved.transaction.id,
          distribution: f.distribution,
        });
      } else if (scenario === 'multiple') {
        const second = (
          await f.api.saveContact('second-contact', 'Otra persona')
        ).entityId;
        const a = await f.purchase('first');
        const b = await f.purchase('second');
        await f.api.recordReceipt('multi-payment', {
          contactId: f.contactId,
          accountId: 'target',
          amount: 12000,
          applications: [
            { participationId: a.participationId, amount: 5000 },
            { participationId: b.participationId, amount: 7000 },
          ],
        });
        const saved = await f.save({ amount: 90000 });
        await f.api.sharePurchase('many-people', {
          transactionId: saved.transaction.id,
          distribution: {
            mode: 'amounts',
            personalAmount: 30000,
            participants: [
              { contactId: f.contactId, amount: 20000 },
              { contactId: second, amount: 40000 },
            ],
          },
        });
        await f.api.recordReceipt('unapplied-second', {
          contactId: second,
          accountId: 'bank',
          amount: 3000,
        });
      } else if (scenario === 'legacy' || scenario === 'civil') {
        const saved = await f.save(
          scenario === 'legacy'
            ? {
                occurrence: undefined,
                transactionDate: '2026-10-02T00:00:00.000Z',
              }
            : {
                occurrence: {
                  kind: 'dateTime',
                  date: '2026-10-31',
                  time: '23:00',
                  timeZone: 'America/Bogota',
                },
              },
        );
        await f.api.sharePurchase('date-purchase', {
          transactionId: saved.transaction.id,
          distribution: f.distribution,
        });
      } else {
        const expense = await f.purchase();
        if (
          scenario === 'partial' ||
          scenario === 'complete' ||
          scenario === 'cancel'
        ) {
          await f.api.recordReceipt('partial', {
            contactId: f.contactId,
            accountId: 'target',
            amount: 5000,
            occurrence: { kind: 'date', date: '2026-11-03' },
            applications: [
              { participationId: expense.participationId, amount: 5000 },
            ],
          });
          await unchangedAndEquivalent(f);
          if (scenario === 'complete')
            await f.api.recordReceipt('final', {
              contactId: f.contactId,
              accountId: 'bank',
              amount: 10000,
              applications: [
                { participationId: expense.participationId, amount: 10000 },
              ],
            });
          if (scenario === 'cancel') {
            await f.api.unlinkAllocation(
              'unlink',
              (
                await f.api.getHistory()
              ).allocations[0]!.id,
            );
            await f.api.cancelDivision('cancel', expense.entityId);
          }
        }
      }
      await unchangedAndEquivalent(f);
    } finally {
      f.native.close();
    }
  },
);

test('repeated receipts and returns do not multiply joined amounts; historical key survives nullable FK', async () => {
  const f = await sharedExpenseFixture();
  try {
    const expense = await f.purchase();
    const receipt = await f.api.recordReceipt('receipt', {
      contactId: f.contactId,
      accountId: 'target',
      amount: 10000,
      applications: [
        { participationId: expense.participationId, amount: 3000 },
        { participationId: expense.participationId, amount: 4000 },
      ],
      excessPolicy: 'keepAsAdvance',
    });
    await f.api.returnAdvance('return-1', {
      receiptId: receipt.entityId,
      accountId: 'bank',
      amount: 1000,
    });
    await f.api.returnAdvance('return-2', {
      receiptId: receipt.entityId,
      accountId: 'target',
      amount: 500,
    });
    // The reference domain joins allocations by participation_key, not FK.
    f.native.exec('UPDATE shared_allocations SET participation_id = NULL');
    expect(await f.sharedRepository.getFinancialTotals()).toEqual({
      receivables: 8000,
      thirdPartyAdvances: 1500,
    });
    await unchangedAndEquivalent(f);
  } finally {
    f.native.close();
  }
});

test('integer centavos near MAX_SAFE_INTEGER stay exact through the SQLite/JS boundary', async () => {
  const f = await sharedExpenseFixture();
  try {
    f.native
      .prepare(
        "INSERT INTO shared_receipts VALUES('large',NULL,?,?,'2026-10-05','active','2026-01-01','2026-01-01')",
      )
      .run(f.contactId, Number.MAX_SAFE_INTEGER);
    f.native
      .prepare(
        "INSERT INTO shared_returns VALUES('return','large',NULL,?,'2026-10-06','active','2026-01-01','2026-01-01')",
      )
      .run(Number.MAX_SAFE_INTEGER - 1);
    expect(await f.sharedRepository.getFinancialTotals()).toEqual({
      receivables: 0,
      thirdPartyAdvances: 0.01,
    });
    await unchangedAndEquivalent(f);
    // Net one cent is insufficient: the original domain also rejects an unsafe
    // gross received total even when almost all of it has been returned.
    f.native
      .prepare(
        "INSERT INTO shared_receipts VALUES('overflow',NULL,?,1,'2026-10-05','active','2026-01-01','2026-01-01')",
      )
      .run(f.contactId);
    await expect(f.api.getPosition()).rejects.toThrow('rango seguro');
    await expect(f.sharedRepository.getFinancialTotals()).rejects.toThrow(
      'rango seguro',
    );
  } finally {
    f.native.close();
  }
});

test('global safe range and overallocated participations reject rather than round or cancel out', async () => {
  const f = await sharedExpenseFixture();
  try {
    const second = (await f.api.saveContact('second', 'Second')).entityId;
    for (const [id, person, amount] of [
      ['large', f.contactId, Number.MAX_SAFE_INTEGER],
      ['small', second, 1],
    ] as const)
      f.native
        .prepare(
          "INSERT INTO shared_receipts VALUES(?,NULL,?,?,'2026-10-05','active','2026-01-01','2026-01-01')",
        )
        .run(id, person, amount);
    await expect(f.api.getPosition()).rejects.toThrow('rango seguro');
    await expect(f.sharedRepository.getFinancialTotals()).rejects.toThrow(
      'rango seguro',
    );
    f.native.exec('DELETE FROM shared_receipts');
    const expense = await f.purchase();
    await f.api.recordReceipt('receipt', {
      contactId: f.contactId,
      accountId: 'bank',
      amount: 15000,
      applications: [
        { participationId: expense.participationId, amount: 15000 },
      ],
    });
    f.native.exec('UPDATE shared_allocations SET amount_minor=1500001');
    await expect(f.api.getPosition()).rejects.toThrow();
    await expect(f.sharedRepository.getFinancialTotals()).rejects.toThrow();
  } finally {
    f.native.close();
  }
});

test('inactive history is excluded before summing allocations, including stale active applications', async () => {
  const f = await sharedExpenseFixture();
  try {
    const expense = await f.purchase();
    await f.api.cancelDivision('cancel', expense.entityId);
    const receipt = await f.api.recordReceipt('advance', {
      contactId: f.contactId,
      accountId: 'bank',
      amount: 15000,
    });
    // Relationally valid historical rows, outside active financial participation.
    // Summing them first would cause a 64-bit SQLite overflow, although the
    // reference position ignores them and still has an unapplied 15,000 advance.
    const insert = f.native.prepare(
      'INSERT INTO shared_allocations VALUES(?,?,?,?,?,?,?,?)',
    );
    for (let index = 0; index < 1100; index++)
      insert.run(
        `historical-${index}`,
        receipt.entityId,
        expense.participationId,
        expense.participationId,
        Number.MAX_SAFE_INTEGER,
        1,
        '2026-01-01',
        '2026-01-01',
      );
    expect(await f.sharedRepository.getFinancialTotals()).toEqual({
      receivables: 0,
      thirdPartyAdvances: 15000,
    });
    await unchangedAndEquivalent(f);
  } finally {
    f.native.close();
  }
});

test('totals participate in the existing transaction and never commit pending writes', async () => {
  const f = await sharedExpenseFixture();
  try {
    await f.api.recordReceipt('advance', {
      contactId: f.contactId,
      accountId: 'bank',
      amount: 5000,
    });
    const balances = await f.balances();
    const result = await runSharedSQLiteTransaction(
      f.database,
      async participant => {
        await participant.executeSql(
          'UPDATE shared_receipts SET amount_minor=600000',
        );
        expect(
          await createSqliteSharedExpenseRepository(
            participant,
          ).getFinancialTotals(),
        ).toEqual({ receivables: 0, thirdPartyAdvances: 6000 });
        throw new Error('Synthetic rollback');
      },
    );
    expect(result.status).toBe('rolledBack');
    expect(await f.sharedRepository.getFinancialTotals()).toEqual({
      receivables: 0,
      thirdPartyAdvances: 5000,
    });
    expect(await f.balances()).toEqual(balances);
    await unchangedAndEquivalent(f);
  } finally {
    f.native.close();
  }
});

test('aggregate projection returns one row and no command, description or entire relation payload', async () => {
  const f = await sharedExpenseFixture();
  try {
    await f.purchase();
    const rows = f.query(SHARED_FINANCIAL_TOTALS_SQL).rows.raw();
    expect(rows).toEqual([
      { receivable_minor: '1500000', advance_minor: '0', invalid: 0 },
    ]);
    for (const invalid of [
      { receivableMinor: '9007199254740992', advanceMinor: '0', invalid: 0 },
      { receivableMinor: '1.2', advanceMinor: '0', invalid: 0 },
      { receivableMinor: '0', advanceMinor: '-1', invalid: 0 },
      { receivableMinor: '0', advanceMinor: '0', invalid: 1 },
    ])
      expect(() => readSharedFinancialTotals(invalid)).toThrow();
  } finally {
    f.native.close();
  }
});
