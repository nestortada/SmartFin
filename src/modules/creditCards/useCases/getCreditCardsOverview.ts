import type { ISODateString } from '../../../shared/types';
import type { Account } from '../../accounts';
import type { CreditCardRepository } from '../repositories';
import type {
  CreditCardInstallmentSummary,
  CreditCardMinimumPaymentSimulation,
  CreditCardProfile,
  CreditCardStatement,
  CreditCardsOverview,
  InstallmentPurchase,
} from '../types';

export const DEFAULT_MONTHLY_INTEREST_RATE = 0.028;
const DEFAULT_MINIMUM_PAYMENT_RATIO = 0.1;
const MAX_SIMULATION_MONTHS = 600;

type BuildCreditCardsOverviewParams = {
  accounts: Account[];
  currentDate?: Date;
  installments: InstallmentPurchase[];
  profiles: CreditCardProfile[];
  statements: CreditCardStatement[];
};

function toDateOnly(date: Date): ISODateString {
  return date.toISOString().slice(0, 10);
}

function isPendingStatement(statement: CreditCardStatement): boolean {
  return statement.status !== 'paid' && statement.status !== 'closed';
}

function selectCurrentStatement(
  statements: CreditCardStatement[],
  currentDate: Date,
): CreditCardStatement | undefined {
  const today = toDateOnly(currentDate);
  const pendingStatements = statements.filter(isPendingStatement);
  const upcomingStatement = [...pendingStatements]
    .filter(statement => statement.paymentDueDate.slice(0, 10) >= today)
    .sort((left, right) => left.paymentDueDate.localeCompare(right.paymentDueDate))[0];

  if (upcomingStatement) {
    return upcomingStatement;
  }

  return [...pendingStatements]
    .sort((left, right) => right.paymentDueDate.localeCompare(left.paymentDueDate))[0];
}

function simulateMinimumPayment(
  balance: number,
  minimumPayment: number,
  monthlyInterestRate: number,
): CreditCardMinimumPaymentSimulation {
  if (balance <= 0 || minimumPayment <= 0) {
    return {
      additionalInterest: 0,
      amortizable: balance <= 0,
      balance,
      minimumPayment,
      monthlyInterestRate,
      monthsToPayOff: balance <= 0 ? 0 : undefined,
    };
  }

  const firstMonthInterest = balance * monthlyInterestRate;

  if (minimumPayment <= firstMonthInterest) {
    return {
      additionalInterest: firstMonthInterest,
      amortizable: false,
      balance,
      minimumPayment,
      monthlyInterestRate,
    };
  }

  let remainingBalance = balance;
  let additionalInterest = 0;
  let months = 0;

  while (remainingBalance > 0.01 && months < MAX_SIMULATION_MONTHS) {
    const interest = remainingBalance * monthlyInterestRate;
    additionalInterest += interest;
    remainingBalance = Math.max(0, remainingBalance + interest - minimumPayment);
    months += 1;
  }

  return {
    additionalInterest,
    amortizable: remainingBalance <= 0.01,
    balance,
    minimumPayment,
    monthlyInterestRate,
    monthsToPayOff: remainingBalance <= 0.01 ? months : undefined,
  };
}

function summarizeInstallment(purchase: InstallmentPurchase): CreditCardInstallmentSummary {
  const paidInstallments = Math.min(
    Math.max(purchase.paidInstallments, 0),
    purchase.installmentCount,
  );
  const installmentCount = Math.max(purchase.installmentCount, 1);

  return {
    ...purchase,
    paidInstallments,
    pendingInstallments: Math.max(installmentCount - paidInstallments, 0),
    progressRatio: paidInstallments / installmentCount,
  };
}

export function buildCreditCardsOverview({
  accounts,
  currentDate = new Date(),
  installments,
  profiles,
  statements,
}: BuildCreditCardsOverviewParams): CreditCardsOverview {
  const cards = accounts
    .filter(account => account.status === 'active' && account.type === 'creditCard')
    .map(account => {
      const totalLimit = account.creditLimit?.amount ?? 0;
      const usedCredit = account.debtBalance?.amount ?? 0;
      const availableCredit = Math.max(totalLimit - usedCredit, 0);
      const utilizationRatio = totalLimit > 0 ? Math.min(usedCredit / totalLimit, 1) : 0;
      const accountStatements = statements.filter(
        statement => statement.accountId === account.id,
      );
      const currentStatement = selectCurrentStatement(accountStatements, currentDate);
      const accountInstallments = installments
        .filter(purchase => purchase.accountId === account.id)
        .filter(purchase => purchase.status !== 'cancelled')
        .map(summarizeInstallment);
      const profile = profiles.find(candidate => candidate.accountId === account.id);
      const balance = currentStatement?.totalAmount ?? usedCredit;
      const minimumPayment =
        currentStatement?.minimumPaymentAmount ?? Math.round(balance * DEFAULT_MINIMUM_PAYMENT_RATIO);
      const minimumPaymentSimulation = simulateMinimumPayment(
        balance,
        minimumPayment,
        profile?.monthlyInterestRate ?? DEFAULT_MONTHLY_INTEREST_RATE,
      );

      return {
        account,
        availableCredit,
        currentStatement,
        installments: accountInstallments,
        minimumPaymentSimulation,
        nextPaymentAmount: currentStatement?.totalAmount ?? usedCredit,
        totalLimit,
        usedCredit,
        utilizationRatio,
      };
    });

  return {
    cards,
    generatedAt: currentDate.toISOString(),
  };
}

export async function getCreditCardsOverview(
  repository: CreditCardRepository,
  currentDate: Date = new Date(),
): Promise<CreditCardsOverview> {
  const accounts = await repository.getCreditCardAccounts();
  const accountIds = accounts.map(account => account.id);
  const [statements, installments, profiles] = await Promise.all([
    repository.getStatements(accountIds),
    repository.getInstallmentPurchases(accountIds),
    repository.getProfiles(accountIds),
  ]);

  return buildCreditCardsOverview({
    accounts,
    currentDate,
    installments,
    profiles,
    statements,
  });
}
