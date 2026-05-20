import type { Account } from '../src/modules/accounts';
import {
  buildCreditCardsOverview,
  DEFAULT_MONTHLY_INTEREST_RATE,
  deleteCreditCard,
} from '../src/modules/creditCards';
import type {
  CreditCardProfile,
  CreditCardStatement,
  InstallmentPurchase,
} from '../src/modules/creditCards';
import type { CreditCardRepository } from '../src/modules/creditCards/repositories';

const cardAccount: Account = {
  id: 'card-nu',
  balance: {
    amount: 0,
    currency: 'COP',
  },
  createdAt: '2026-05-01',
  creditLimit: {
    amount: 12000000,
    currency: 'COP',
  },
  currency: 'COP',
  debtBalance: {
    amount: 7750000,
    currency: 'COP',
  },
  institutionName: 'Nu Colombia',
  name: 'Tarjeta Nu',
  status: 'active',
  type: 'creditCard',
  updatedAt: '2026-05-16',
};

function statement(overrides: Partial<CreditCardStatement> = {}): CreditCardStatement {
  return {
    id: 'statement-current',
    accountId: 'card-nu',
    createdAt: '2026-05-01',
    currency: 'COP',
    minimumPaymentAmount: 84000,
    paymentDueDate: '2026-05-25',
    statementEndDate: '2026-05-15',
    statementStartDate: '2026-04-16',
    status: 'pending',
    totalAmount: 845200,
    updatedAt: '2026-05-01',
    ...overrides,
  };
}

function installment(overrides: Partial<InstallmentPurchase> = {}): InstallmentPurchase {
  return {
    id: 'installment-macbook',
    accountId: 'card-nu',
    createdAt: '2026-01-01',
    currency: 'COP',
    firstDueDate: '2026-02-01',
    installmentCount: 24,
    merchantName: 'MacBook Pro 14',
    monthlyAmount: 200000,
    paidInstallments: 12,
    status: 'active',
    totalAmount: 4800000,
    transactionId: 'txn-macbook',
    updatedAt: '2026-05-01',
    ...overrides,
  };
}

function createCreditCardRepository({
  accounts = [cardAccount],
  installments = [],
  profiles = [],
  statements = [],
}: {
  accounts?: Account[];
  installments?: InstallmentPurchase[];
  profiles?: CreditCardProfile[];
  statements?: CreditCardStatement[];
} = {}): CreditCardRepository & { closedAccountIds: string[] } {
  const closedAccountIds: string[] = [];

  return {
    closedAccountIds,
    closeCreditCardAccount: async accountId => {
      closedAccountIds.push(accountId);
    },
    getCreditCardAccounts: async () => accounts,
    getInstallmentPurchases: async accountIds =>
      installments.filter(purchase => accountIds.includes(purchase.accountId)),
    getProfiles: async accountIds =>
      profiles.filter(profile => accountIds.includes(profile.accountId)),
    getStatements: async accountIds =>
      statements.filter(candidate => accountIds.includes(candidate.accountId)),
    saveCreditCardAccount: async () => undefined,
    saveInstallmentPurchases: async () => undefined,
    saveProfiles: async () => undefined,
    saveStatements: async () => undefined,
    updateInstallmentPurchasesAccount: async () => undefined,
  };
}

test('builds credit limit and utilization from credit card account balances', () => {
  const overview = buildCreditCardsOverview({
    accounts: [cardAccount],
    currentDate: new Date('2026-05-18T12:00:00.000Z'),
    installments: [],
    profiles: [],
    statements: [statement()],
  });

  expect(overview.cards).toHaveLength(1);
  expect(overview.cards[0]?.availableCredit).toBe(4250000);
  expect(overview.cards[0]?.totalLimit).toBe(12000000);
  expect(overview.cards[0]?.usedCredit).toBe(7750000);
  expect(overview.cards[0]?.utilizationRatio).toBeCloseTo(0.6458, 4);
});

test('selects the next pending statement for the active card', () => {
  const overview = buildCreditCardsOverview({
    accounts: [cardAccount],
    currentDate: new Date('2026-05-18T12:00:00.000Z'),
    installments: [],
    profiles: [],
    statements: [
      statement({
        id: 'statement-old',
        paymentDueDate: '2026-04-25',
        statementEndDate: '2026-04-15',
      }),
      statement({
        id: 'statement-next',
        paymentDueDate: '2026-05-25',
      }),
      statement({
        id: 'statement-paid',
        paymentDueDate: '2026-05-20',
        status: 'paid',
      }),
    ],
  });

  expect(overview.cards[0]?.currentStatement?.id).toBe('statement-next');
  expect(overview.cards[0]?.nextPaymentAmount).toBe(845200);
});

test('uses configurable monthly interest rate for minimum payment simulation', () => {
  const profile: CreditCardProfile = {
    accountId: 'card-nu',
    createdAt: '2026-05-01',
    monthlyInterestRate: 0.02,
    updatedAt: '2026-05-01',
  };

  const overview = buildCreditCardsOverview({
    accounts: [cardAccount],
    currentDate: new Date('2026-05-18T12:00:00.000Z'),
    installments: [],
    profiles: [profile],
    statements: [statement()],
  });

  const simulation = overview.cards[0]?.minimumPaymentSimulation;

  expect(simulation?.monthlyInterestRate).toBe(0.02);
  expect(simulation?.amortizable).toBe(true);
  expect(simulation?.monthsToPayOff).toBeGreaterThan(0);
  expect(simulation?.additionalInterest).toBeGreaterThan(0);
});

test('marks minimum payment as not amortizable when it does not cover interest', () => {
  const overview = buildCreditCardsOverview({
    accounts: [cardAccount],
    currentDate: new Date('2026-05-18T12:00:00.000Z'),
    installments: [],
    profiles: [
      {
        accountId: 'card-nu',
        createdAt: '2026-05-01',
        monthlyInterestRate: 0.02,
        updatedAt: '2026-05-01',
      },
    ],
    statements: [
      statement({
        minimumPaymentAmount: 10000,
        totalAmount: 1000000,
      }),
    ],
  });

  const simulation = overview.cards[0]?.minimumPaymentSimulation;

  expect(simulation?.amortizable).toBe(false);
  expect(simulation?.monthsToPayOff).toBeUndefined();
  expect(simulation?.additionalInterest).toBe(20000);
});

test('filters and summarizes installment purchases by credit card', () => {
  const overview = buildCreditCardsOverview({
    accounts: [cardAccount],
    currentDate: new Date('2026-05-18T12:00:00.000Z'),
    installments: [
      installment(),
      installment({
        id: 'installment-other-card',
        accountId: 'other-card',
      }),
      installment({
        id: 'installment-cancelled',
        status: 'cancelled',
      }),
    ],
    profiles: [],
    statements: [statement()],
  });

  expect(overview.cards[0]?.installments).toHaveLength(1);
  expect(overview.cards[0]?.installments[0]?.pendingInstallments).toBe(12);
  expect(overview.cards[0]?.installments[0]?.progressRatio).toBe(0.5);
  expect(overview.cards[0]?.minimumPaymentSimulation.monthlyInterestRate).toBe(
    DEFAULT_MONTHLY_INTEREST_RATE,
  );
});

test('blocks deleting a credit card with active installment purchases', async () => {
  const repository = createCreditCardRepository({
    accounts: [
      {
        ...cardAccount,
        debtBalance: { amount: 0, currency: 'COP' },
      },
    ],
    installments: [installment()],
  });

  await expect(deleteCreditCard(repository, 'card-nu')).rejects.toThrow(
    'compras a cuotas vigentes',
  );
  expect(repository.closedAccountIds).toHaveLength(0);
});

test('blocks deleting a credit card until credit utilization is zero', async () => {
  const repository = createCreditCardRepository();

  await expect(deleteCreditCard(repository, 'card-nu')).rejects.toThrow(
    'uso del cupo este en 0%',
  );
  expect(repository.closedAccountIds).toHaveLength(0);
});

test('blocks deleting a credit card with unsettled current period movements', async () => {
  const repository = createCreditCardRepository({
    accounts: [
      {
        ...cardAccount,
        debtBalance: { amount: 0, currency: 'COP' },
      },
    ],
    statements: [statement()],
  });

  await expect(deleteCreditCard(repository, 'card-nu')).rejects.toThrow(
    'movimientos del periodo',
  );
  expect(repository.closedAccountIds).toHaveLength(0);
});

test('deletes a credit card only when installments and current debt are cleared', async () => {
  const repository = createCreditCardRepository({
    accounts: [
      {
        ...cardAccount,
        debtBalance: { amount: 0, currency: 'COP' },
      },
    ],
    installments: [
      installment({
        paidInstallments: 24,
        status: 'paid',
      }),
    ],
    statements: [
      statement({
        status: 'paid',
        totalAmount: 0,
      }),
    ],
  });

  await deleteCreditCard(repository, 'card-nu');

  expect(repository.closedAccountIds).toEqual(['card-nu']);
});
