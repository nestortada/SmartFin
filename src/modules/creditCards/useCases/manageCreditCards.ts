import { PRIMARY_CURRENCY } from '../../../shared/types';
import type { Account } from '../../accounts';
import type { CreditCardRepository } from '../repositories';
import type {
  CreditCardFormInput,
  CreditCardVisualMetadata,
} from '../types';

const DESCRIPTION_METADATA_PREFIX = 'smartfin:credit-card:';

function clampBillingDay(day?: number): number | undefined {
  if (day === undefined || Number.isNaN(day)) {
    return undefined;
  }

  return Math.min(Math.max(Math.trunc(day), 1), 31);
}

function createCreditCardId(): string {
  return `credit-card-${Date.now().toString(36)}-${Math.round(Math.random() * 10000).toString(36)}`;
}

export function parseCreditCardVisualMetadata(
  description?: string,
): CreditCardVisualMetadata {
  if (!description?.startsWith(DESCRIPTION_METADATA_PREFIX)) {
    return {};
  }

  try {
    const parsed = JSON.parse(description.slice(DESCRIPTION_METADATA_PREFIX.length)) as unknown;

    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const candidate = parsed as Record<string, unknown>;
    return {
      closingDay: typeof candidate.closingDay === 'number' ? clampBillingDay(candidate.closingDay) : undefined,
      lastFourDigits: typeof candidate.lastFourDigits === 'string' ? candidate.lastFourDigits.slice(0, 4) : undefined,
      managementFee: typeof candidate.managementFee === 'number' ? Math.max(candidate.managementFee, 0) : undefined,
      paymentDay: typeof candidate.paymentDay === 'number' ? clampBillingDay(candidate.paymentDay) : undefined,
    };
  } catch {
    return {};
  }
}

export function serializeCreditCardVisualMetadata(
  metadata: CreditCardVisualMetadata,
): string {
  return `${DESCRIPTION_METADATA_PREFIX}${JSON.stringify({
    closingDay: clampBillingDay(metadata.closingDay),
    lastFourDigits: metadata.lastFourDigits?.replace(/\D/g, '').slice(0, 4),
    managementFee: metadata.managementFee !== undefined ? Math.max(metadata.managementFee, 0) : undefined,
    paymentDay: clampBillingDay(metadata.paymentDay),
  })}`;
}

function annualEffectiveRateToMonthly(annualEffectiveInterestRate: number): number {
  return Math.pow(1 + annualEffectiveInterestRate, 1 / 12) - 1;
}

export async function saveCreditCardFromForm(
  repository: CreditCardRepository,
  input: CreditCardFormInput,
  existingAccount?: Account,
): Promise<Account> {
  const now = new Date().toISOString();
  const normalizedLimit = Math.max(0, input.creditLimit);
  const account: Account = {
    id: existingAccount?.id ?? input.accountId ?? createCreditCardId(),
    balance: existingAccount?.balance ?? {
      amount: 0,
      currency: PRIMARY_CURRENCY,
    },
    createdAt: existingAccount?.createdAt ?? now,
    creditLimit: {
      amount: normalizedLimit,
      currency: PRIMARY_CURRENCY,
    },
    currency: PRIMARY_CURRENCY,
    debtBalance: existingAccount?.debtBalance ?? {
      amount: 0,
      currency: PRIMARY_CURRENCY,
    },
    description: serializeCreditCardVisualMetadata({
      closingDay: input.closingDay,
      lastFourDigits: input.lastFourDigits,
      managementFee: input.managementFee,
      paymentDay: input.paymentDay,
    }),
    institutionName: input.bankName?.trim() || undefined,
    name: input.name.trim(),
    status: 'active',
    type: 'creditCard',
    updatedAt: now,
  };

  await repository.saveCreditCardAccount(account);

  if (input.annualEffectiveInterestRate !== undefined) {
    await repository.saveProfiles([
      {
        accountId: account.id,
        createdAt: existingAccount?.createdAt ?? now,
        monthlyInterestRate: annualEffectiveRateToMonthly(input.annualEffectiveInterestRate),
        updatedAt: now,
      },
    ]);
  }

  return account;
}

export async function deleteCreditCard(
  repository: CreditCardRepository,
  accountId: string,
): Promise<void> {
  await repository.closeCreditCardAccount(accountId);
}
