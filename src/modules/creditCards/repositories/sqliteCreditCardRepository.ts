import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import {
  readNullableNumber,
  readNullableString,
  readNumber,
  readString,
  resultSetToRows,
  type SQLiteRow,
} from '../../../database/sqliteRows';
import type { CurrencyCode } from '../../../shared/types';
import type { Account, AccountStatus, AccountType } from '../../accounts';
import type {
  CreditCardProfile,
  CreditCardStatement,
  CreditCardStatementStatus,
  InstallmentPurchase,
  InstallmentPurchaseStatus,
} from '../types';

export type CreditCardRepository = {
  closeCreditCardAccount: (accountId: string) => Promise<void>;
  getCreditCardAccounts: () => Promise<Account[]>;
  getStatements: (accountIds: string[]) => Promise<CreditCardStatement[]>;
  getInstallmentPurchases: (accountIds: string[]) => Promise<InstallmentPurchase[]>;
  getProfiles: (accountIds: string[]) => Promise<CreditCardProfile[]>;
  saveCreditCardAccount: (account: Account) => Promise<void>;
  saveStatements: (statements: CreditCardStatement[]) => Promise<void>;
  saveInstallmentPurchases: (purchases: InstallmentPurchase[]) => Promise<void>;
  saveProfiles: (profiles: CreditCardProfile[]) => Promise<void>;
};

function accountFromRow(row: SQLiteRow): Account {
  const currency = readString(row, 'currency') as CurrencyCode;
  const debtBalanceAmount = readNullableNumber(row, 'debt_balance_amount');
  const creditLimitAmount = readNullableNumber(row, 'credit_limit_amount');

  return {
    id: readString(row, 'id'),
    name: readString(row, 'name'),
    type: readString(row, 'type') as AccountType,
    status: readString(row, 'status') as AccountStatus,
    currency,
    balance: {
      amount: readNumber(row, 'balance_amount'),
      currency,
    },
    ...(debtBalanceAmount !== undefined
      ? {
          debtBalance: {
            amount: debtBalanceAmount,
            currency,
          },
        }
      : {}),
    ...(creditLimitAmount !== undefined
      ? {
          creditLimit: {
            amount: creditLimitAmount,
            currency,
          },
        }
      : {}),
    institutionName: readNullableString(row, 'institution_name'),
    description: readNullableString(row, 'description'),
    createdAt: readString(row, 'created_at'),
    updatedAt: readString(row, 'updated_at'),
  };
}

function statementFromRow(row: SQLiteRow): CreditCardStatement {
  return {
    id: readString(row, 'id'),
    accountId: readString(row, 'account_id'),
    statementStartDate: readString(row, 'statement_start_date'),
    statementEndDate: readString(row, 'statement_end_date'),
    paymentDueDate: readString(row, 'payment_due_date'),
    totalAmount: readNumber(row, 'total_amount'),
    minimumPaymentAmount: readNullableNumber(row, 'minimum_payment_amount'),
    currency: readString(row, 'currency') as CurrencyCode,
    status: readString(row, 'status') as CreditCardStatementStatus,
    createdAt: readString(row, 'created_at'),
    updatedAt: readString(row, 'updated_at'),
  };
}

function installmentPurchaseFromRow(row: SQLiteRow): InstallmentPurchase {
  return {
    id: readString(row, 'id'),
    transactionId: readString(row, 'transaction_id'),
    accountId: readString(row, 'account_id'),
    merchantName: readNullableString(row, 'merchant_name'),
    totalAmount: readNumber(row, 'total_amount'),
    currency: readString(row, 'currency') as CurrencyCode,
    installmentCount: readNumber(row, 'installment_count'),
    paidInstallments: readNumber(row, 'paid_installments'),
    monthlyAmount: readNumber(row, 'monthly_amount'),
    firstDueDate: readNullableString(row, 'first_due_date'),
    status: readString(row, 'status') as InstallmentPurchaseStatus,
    createdAt: readString(row, 'created_at'),
    updatedAt: readString(row, 'updated_at'),
  };
}

function profileFromRow(row: SQLiteRow): CreditCardProfile {
  return {
    accountId: readString(row, 'account_id'),
    monthlyInterestRate: readNumber(row, 'monthly_interest_rate'),
    createdAt: readString(row, 'created_at'),
    updatedAt: readString(row, 'updated_at'),
  };
}

function placeholders(values: string[]): string {
  return values.map(() => '?').join(', ');
}

export function createSqliteCreditCardRepository(
  database: SmartFinSQLiteDatabase,
): CreditCardRepository {
  return {
    closeCreditCardAccount: async accountId => {
      await database.executeSql(
        `UPDATE accounts
        SET status = ?, updated_at = ?
        WHERE id = ? AND type = ?;`,
        ['closed', new Date().toISOString(), accountId, 'creditCard'],
      );
    },
    getCreditCardAccounts: async () => {
      const [resultSet] = await database.executeSql(
        `SELECT
          id,
          name,
          type,
          status,
          currency,
          balance_amount,
          debt_balance_amount,
          credit_limit_amount,
          institution_name,
          description,
          created_at,
          updated_at
        FROM accounts
        WHERE type = ? AND status = ?
        ORDER BY name ASC;`,
        ['creditCard', 'active'],
      );

      return resultSetToRows(resultSet).map(accountFromRow);
    },
    getStatements: async accountIds => {
      if (accountIds.length === 0) {
        return [];
      }

      const [resultSet] = await database.executeSql(
        `SELECT
          id,
          account_id,
          statement_start_date,
          statement_end_date,
          payment_due_date,
          total_amount,
          minimum_payment_amount,
          currency,
          status,
          created_at,
          updated_at
        FROM credit_card_statements
        WHERE account_id IN (${placeholders(accountIds)})
        ORDER BY payment_due_date ASC, statement_end_date DESC;`,
        accountIds,
      );

      return resultSetToRows(resultSet).map(statementFromRow);
    },
    getInstallmentPurchases: async accountIds => {
      if (accountIds.length === 0) {
        return [];
      }

      const [resultSet] = await database.executeSql(
        `SELECT
          id,
          transaction_id,
          account_id,
          merchant_name,
          total_amount,
          currency,
          installment_count,
          paid_installments,
          monthly_amount,
          first_due_date,
          status,
          created_at,
          updated_at
        FROM installment_purchases
        WHERE account_id IN (${placeholders(accountIds)})
        ORDER BY created_at DESC;`,
        accountIds,
      );

      return resultSetToRows(resultSet).map(installmentPurchaseFromRow);
    },
    getProfiles: async accountIds => {
      if (accountIds.length === 0) {
        return [];
      }

      const [resultSet] = await database.executeSql(
        `SELECT
          account_id,
          monthly_interest_rate,
          created_at,
          updated_at
        FROM credit_card_profiles
        WHERE account_id IN (${placeholders(accountIds)});`,
        accountIds,
      );

      return resultSetToRows(resultSet).map(profileFromRow);
    },
    saveCreditCardAccount: async account => {
      await database.executeSql(
        `INSERT OR REPLACE INTO accounts (
          id,
          name,
          type,
          status,
          currency,
          balance_amount,
          debt_balance_amount,
          credit_limit_amount,
          institution_name,
          description,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          account.id,
          account.name,
          account.type,
          account.status,
          account.currency,
          account.balance.amount,
          account.debtBalance?.amount ?? null,
          account.creditLimit?.amount ?? null,
          account.institutionName ?? null,
          account.description ?? null,
          account.createdAt,
          account.updatedAt,
        ],
      );
    },
    saveStatements: async statements => {
      for (const statement of statements) {
        await database.executeSql(
          `INSERT OR REPLACE INTO credit_card_statements (
            id,
            account_id,
            statement_start_date,
            statement_end_date,
            payment_due_date,
            total_amount,
            minimum_payment_amount,
            currency,
            status,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            statement.id,
            statement.accountId,
            statement.statementStartDate,
            statement.statementEndDate,
            statement.paymentDueDate,
            statement.totalAmount,
            statement.minimumPaymentAmount ?? null,
            statement.currency,
            statement.status,
            statement.createdAt,
            statement.updatedAt,
          ],
        );
      }
    },
    saveInstallmentPurchases: async purchases => {
      for (const purchase of purchases) {
        await database.executeSql(
          `INSERT OR REPLACE INTO installment_purchases (
            id,
            transaction_id,
            account_id,
            merchant_name,
            total_amount,
            currency,
            installment_count,
            paid_installments,
            monthly_amount,
            first_due_date,
            status,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            purchase.id,
            purchase.transactionId,
            purchase.accountId,
            purchase.merchantName ?? null,
            purchase.totalAmount,
            purchase.currency,
            purchase.installmentCount,
            purchase.paidInstallments,
            purchase.monthlyAmount,
            purchase.firstDueDate ?? null,
            purchase.status,
            purchase.createdAt,
            purchase.updatedAt,
          ],
        );
      }
    },
    saveProfiles: async profiles => {
      for (const profile of profiles) {
        await database.executeSql(
          `INSERT OR REPLACE INTO credit_card_profiles (
            account_id,
            monthly_interest_rate,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?);`,
          [
            profile.accountId,
            profile.monthlyInterestRate,
            profile.createdAt,
            profile.updatedAt,
          ],
        );
      }
    },
  };
}
