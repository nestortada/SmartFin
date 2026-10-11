import { SQLITE_SCHEMA_STATEMENTS } from '../../src/database/sqliteSchema';
import type {
  Account,
  AccountStatus,
  AccountType,
} from '../../src/modules/accounts/types';
import type { Transaction } from '../../src/modules/transactions/types';
import { realSQLite } from './realSQLite';

export const DASHBOARD_DATE = new Date(2026, 9, 10, 12);

export function dashboardAccount(
  id: string,
  type: AccountType,
  amount: number,
  debt?: number,
  status: AccountStatus = 'active',
): Account {
  return {
    id,
    name: id,
    type,
    status,
    currency: 'COP',
    balance: { amount, currency: 'COP' },
    ...(debt === undefined
      ? {}
      : { debtBalance: { amount: debt, currency: 'COP' as const } }),
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

export const DASHBOARD_ACCOUNTS: Account[] = [
  dashboardAccount('cash', 'cash', 100),
  dashboardAccount('bank', 'bankAccount', 1000),
  dashboardAccount('savings', 'savingsAccount', 2000),
  dashboardAccount('investment', 'investment', 5000),
  dashboardAccount('card', 'creditCard', 900, 400),
  dashboardAccount('loan', 'loan', 800, 600),
  dashboardAccount('closed', 'bankAccount', 9999, undefined, 'closed'),
  dashboardAccount('inactive', 'creditCard', 9999, 9999, 'inactive'),
];

export function dashboardTransaction(
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: 'movement',
    accountId: 'bank',
    amount: 100,
    currency: 'COP',
    description: 'Synthetic movement',
    date: '2026-10-05T12:00:00Z',
    createdAt: '2026-10-05T12:00:00Z',
    updatedAt: '2026-10-05T12:00:00Z',
    type: 'expense',
    direction: 'outflow',
    status: 'posted',
    ...overrides,
  };
}

export async function dashboardFixture(
  accounts: Account[] = DASHBOARD_ACCOUNTS,
) {
  const sql = realSQLite();
  for (const statement of SQLITE_SCHEMA_STATEMENTS) {
    await sql.database.executeSql(statement);
  }
  const insertAccount = sql.native.prepare(`INSERT INTO accounts
    (id, name, type, status, currency, balance_amount, debt_balance_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`);
  for (const account of accounts) {
    insertAccount.run(
      account.id,
      account.name,
      account.type,
      account.status,
      account.currency,
      account.balance.amount,
      account.debtBalance?.amount ?? null,
      account.createdAt,
      account.updatedAt,
    );
  }
  const insert = sql.native.prepare(`INSERT INTO transactions
    (id, amount, currency, description, date, account_id, type, direction, status,
     target_account_id, merchant_name, payment_method, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`);
  const insertTransaction = (transaction: Transaction) => {
    insert.run(
      transaction.id,
      transaction.amount,
      transaction.currency,
      transaction.description,
      transaction.date,
      transaction.accountId,
      transaction.type,
      transaction.direction,
      transaction.status,
      transaction.targetAccountId ?? null,
      transaction.merchantName ?? null,
      transaction.paymentMethod ?? null,
      transaction.notes ?? null,
      transaction.createdAt,
      transaction.updatedAt,
    );
  };
  return { ...sql, insertTransaction };
}

// Fixed distribution over three years; no real financial data or random seed.
export function insertSyntheticHistory(
  fixture: Awaited<ReturnType<typeof dashboardFixture>>,
  size: number,
): void {
  const types: Transaction['type'][] = [
    'income',
    'expense',
    'internalTransfer',
    'creditCardPayment',
    'loanPayment',
    'refund',
    'investment',
    'manualAdjustment',
  ];
  fixture.native.exec('BEGIN;');
  try {
    for (let index = 0; index < size; index += 1) {
      const date = new Date(
        Date.UTC(2023, 9, 11 + ((index * 37) % 1096)),
      ).toISOString();
      const type = types[index % types.length] ?? 'expense';
      fixture.insertTransaction(
        dashboardTransaction({
          id: `synthetic-${index}`,
          date,
          type,
          amount: (index % 10000) + (index % 3 === 0 ? 0.1 : 0.2),
          direction:
            type === 'income' || type === 'refund' ? 'inflow' : 'outflow',
          status:
            index % 10 < 7
              ? 'posted'
              : index % 10 < 9
              ? 'pending'
              : 'cancelled',
          description: `Synthetic merchant ${index % 50}`,
          merchantName: `Synthetic merchant ${index % 50}`,
          notes:
            'Synthetic notes used to represent the full-history payload. '.repeat(
              3,
            ),
          createdAt: new Date(Date.UTC(2026, 9, 10, 0, 0, index)).toISOString(),
        }),
      );
    }
    fixture.native.exec('COMMIT;');
  } catch (error) {
    fixture.native.exec('ROLLBACK;');
    throw error;
  }
}
