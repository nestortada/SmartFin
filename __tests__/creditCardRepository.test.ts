import type { ResultSet } from 'react-native-sqlite-storage';

import type { SmartFinSQLiteDatabase } from '../src/database';
import { createSqliteCreditCardRepository } from '../src/modules/creditCards';

type Row = Record<string, string | number | null>;

function createResultSet(rows: Row[]): ResultSet {
  return {
    insertId: 0,
    rows: {
      item: (index: number) => rows[index],
      length: rows.length,
      raw: () => rows,
    },
    rowsAffected: 0,
  };
}

test('sqlite credit card repository reads cards, statements, installments and profiles', async () => {
  const calls: Array<{ statement: string; values?: unknown[] }> = [];
  const executeSql = jest.fn(async (statement: string, values?: unknown[]) => {
    calls.push({ statement, values });

    if (statement.includes('FROM accounts')) {
      return [
        createResultSet([
          {
            id: 'card-nu',
            name: 'Tarjeta Nu',
            type: 'creditCard',
            status: 'active',
            currency: 'COP',
            balance_amount: 0,
            debt_balance_amount: 1280000,
            credit_limit_amount: 5000000,
            institution_name: 'Nu Colombia',
            description: null,
            created_at: '2026-05-01',
            updated_at: '2026-05-16',
          },
        ]),
      ] as const;
    }

    if (statement.includes('FROM credit_card_statements')) {
      return [
        createResultSet([
          {
            id: 'statement-nu',
            account_id: 'card-nu',
            statement_start_date: '2026-04-16',
            statement_end_date: '2026-05-15',
            payment_due_date: '2026-05-25',
            total_amount: 845200,
            minimum_payment_amount: 84000,
            currency: 'COP',
            status: 'pending',
            created_at: '2026-05-01',
            updated_at: '2026-05-01',
          },
        ]),
      ] as const;
    }

    if (statement.includes('FROM installment_purchases')) {
      return [
        createResultSet([
          {
            id: 'installment-macbook',
            transaction_id: 'txn-macbook',
            account_id: 'card-nu',
            merchant_name: 'MacBook Pro 14',
            total_amount: 4800000,
            currency: 'COP',
            installment_count: 24,
            paid_installments: 12,
            monthly_amount: 200000,
            first_due_date: '2026-02-01',
            status: 'active',
            created_at: '2026-01-01',
            updated_at: '2026-05-01',
          },
        ]),
      ] as const;
    }

    if (statement.includes('FROM credit_card_profiles')) {
      return [
        createResultSet([
          {
            account_id: 'card-nu',
            monthly_interest_rate: 0.028,
            created_at: '2026-05-01',
            updated_at: '2026-05-01',
          },
        ]),
      ] as const;
    }

    return [createResultSet([])] as const;
  });
  const database = { executeSql } as unknown as SmartFinSQLiteDatabase;
  const repository = createSqliteCreditCardRepository(database);

  const cards = await repository.getCreditCardAccounts();
  const statements = await repository.getStatements(['card-nu']);
  const installments = await repository.getInstallmentPurchases(['card-nu']);
  const profiles = await repository.getProfiles(['card-nu']);

  expect(cards[0]?.creditLimit?.amount).toBe(5000000);
  expect(cards[0]?.debtBalance?.amount).toBe(1280000);
  expect(statements[0]?.paymentDueDate).toBe('2026-05-25');
  expect(installments[0]?.merchantName).toBe('MacBook Pro 14');
  expect(profiles[0]?.monthlyInterestRate).toBe(0.028);
  expect(calls.some(call => call.statement.includes('WHERE type = ? AND status = ?'))).toBe(true);
  expect(calls.some(call => call.statement.includes('FROM credit_card_profiles'))).toBe(true);
  expect(calls.find(call => call.statement.includes('FROM credit_card_statements'))?.values).toEqual([
    'card-nu',
  ]);
});

test('sqlite credit card repository skips list queries when no account ids are provided', async () => {
  const executeSql = jest.fn(async () => [createResultSet([])] as const);
  const database = { executeSql } as unknown as SmartFinSQLiteDatabase;
  const repository = createSqliteCreditCardRepository(database);

  await expect(repository.getStatements([])).resolves.toEqual([]);
  await expect(repository.getInstallmentPurchases([])).resolves.toEqual([]);
  await expect(repository.getProfiles([])).resolves.toEqual([]);
  expect(executeSql).not.toHaveBeenCalled();
});
