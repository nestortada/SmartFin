import type { Account } from '../types';
import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { runSQLiteTransaction } from '../../../database/atomicSQLite';
import { upsertSQLiteRow } from '../../../database/upsertSQLiteRow';

export async function saveSqliteAccounts(
  database: SmartFinSQLiteDatabase,
  accounts: Account[],
): Promise<void> {
  await runSQLiteTransaction(database, function* () {
    for (const account of accounts) {
      yield* upsertSQLiteRow('accounts', {
        id: account.id,
        name: account.name,
        type: account.type,
        status: account.status,
        currency: account.currency,
        balance_amount: account.balance.amount,
        debt_balance_amount: account.debtBalance?.amount ?? null,
        credit_limit_amount: account.creditLimit?.amount ?? null,
        institution_name: account.institutionName ?? null,
        description: account.description ?? null,
        created_at: account.createdAt,
        updated_at: account.updatedAt,
      });
    }
    return undefined;
  });
}
