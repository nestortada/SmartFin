import type { Account } from '../types';
import type { SqliteAccountRepository } from '../repositories/sqliteAccountRepository';

export type DebitCardIncomeFrequency = 'none' | 'biweekly' | 'monthly' | 'specificDay';
export type DebitCardIncomeType = 'salary' | 'allowance' | 'business' | 'other';

export type DebitCardRecurringIncome = {
  amount: number;
  dayOfMonth?: number;
  frequency: DebitCardIncomeFrequency;
  incomeType: DebitCardIncomeType;
};

export type DebitCardFormInput = {
  accountId?: string;
  bankName?: string;
  currentBalance: number;
  name: string;
  recurringIncome?: DebitCardRecurringIncome;
};

type DebitAccountRepository = Pick<SqliteAccountRepository, 'getAccounts' | 'saveAccounts'>;

const DEBIT_CARD_META_PREFIX = 'SMARTFIN_DEBIT_CARD_META:';

type DebitCardMetadata = {
  bankName?: string;
  recurringIncome?: DebitCardRecurringIncome;
};

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function serializeDescription(metadata: DebitCardMetadata): string {
  return `${DEBIT_CARD_META_PREFIX}${JSON.stringify(metadata)}`;
}

export function parseDebitCardMetadata(account: Account): DebitCardMetadata {
  const description = account.description ?? '';

  if (!description.startsWith(DEBIT_CARD_META_PREFIX)) {
    return {
      bankName: account.institutionName,
    };
  }

  try {
    const parsed = JSON.parse(description.slice(DEBIT_CARD_META_PREFIX.length)) as DebitCardMetadata;
    return {
      bankName: parsed.bankName ?? account.institutionName,
      recurringIncome: parsed.recurringIncome,
    };
  } catch {
    return {
      bankName: account.institutionName,
    };
  }
}

export async function saveDebitCardFromForm(
  repository: DebitAccountRepository,
  input: DebitCardFormInput,
): Promise<Account> {
  const name = input.name.trim();
  const bankName = input.bankName?.trim() || name;

  if (!name) {
    throw new Error('Ingresa el nombre de la tarjeta debito.');
  }

  const accounts = await repository.getAccounts();
  const existingAccount = input.accountId
    ? accounts.find(account => account.id === input.accountId)
    : undefined;
  const now = new Date().toISOString();
  const account: Account = {
    id: existingAccount?.id ?? `debit-card-${normalizeSlug(`${bankName}-${name}`) || Date.now()}`,
    balance: {
      amount: Math.max(0, input.currentBalance),
      currency: existingAccount?.currency ?? 'COP',
    },
    createdAt: existingAccount?.createdAt ?? now,
    currency: existingAccount?.currency ?? 'COP',
    description: serializeDescription({
      bankName,
      recurringIncome: input.recurringIncome?.frequency === 'none' ? undefined : input.recurringIncome,
    }),
    institutionName: bankName,
    name,
    status: 'active',
    type: existingAccount?.type === 'savingsAccount' ? 'savingsAccount' : 'bankAccount',
    updatedAt: now,
  };

  await repository.saveAccounts([account]);

  return account;
}

export async function deleteDebitCard(
  repository: DebitAccountRepository,
  accountId: string,
): Promise<void> {
  const accounts = await repository.getAccounts();
  const account = accounts.find(candidate => candidate.id === accountId);

  if (!account) {
    throw new Error('No se encontro la tarjeta debito.');
  }

  await repository.saveAccounts([
    {
      ...account,
      status: 'closed',
      updatedAt: new Date().toISOString(),
    },
  ]);
}
