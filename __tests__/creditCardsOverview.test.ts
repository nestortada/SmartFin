import type { Account } from '../src/modules/accounts';
import {
  buildCreditCardsOverview,
  DEFAULT_MONTHLY_INTEREST_RATE,
} from '../src/modules/creditCards';
import type {
  CreditCardProfile,
  CreditCardStatement,
  InstallmentPurchase,
} from '../src/modules/creditCards';

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
