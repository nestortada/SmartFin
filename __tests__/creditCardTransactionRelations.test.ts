import type { Account } from '../src/modules/accounts';
import {
  UNCLASSIFIED_CREDIT_CARD_ACCOUNT_ID,
  associatePendingTransactionsForCreditCard,
  findMatchingCreditCardAccount,
  registerCreditCardPayment,
  reconcileCreditCardTransactions,
  resolveCreditCardTransactionTarget,
  serializeCreditCardVisualMetadata,
  shouldTreatTextAsCreditCardTransaction,
} from '../src/modules/creditCards';
import type {
  CreditCardProfile,
  CreditCardStatement,
  InstallmentPurchase,
} from '../src/modules/creditCards';
import type { CreditCardRepository } from '../src/modules/creditCards/repositories';
import type { Transaction } from '../src/modules/transactions';

function card(overrides: Partial<Account> = {}): Account {
  return {
    id: 'card-visa',
    balance: { amount: 0, currency: 'COP' },
    createdAt: '2026-05-01',
    creditLimit: { amount: 5000000, currency: 'COP' },
    currency: 'COP',
    debtBalance: { amount: 0, currency: 'COP' },
    institutionName: 'Visa',
    name: 'Visa Gold',
    status: 'active',
    type: 'creditCard',
    updatedAt: '2026-05-01',
    ...overrides,
  };
}

function debitAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-bank',
    balance: { amount: 1000000, currency: 'COP' },
    createdAt: '2026-05-01',
    currency: 'COP',
    institutionName: 'Banco',
    name: 'Cuenta bancaria',
    status: 'active',
    type: 'bankAccount',
    updatedAt: '2026-05-01',
    ...overrides,
  };
}

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-card',
    accountId: 'card-visa',
    amount: 100000,
    createdAt: '2026-05-10',
    currency: 'COP',
    date: '2026-05-10',
    description: 'Compra',
    direction: 'outflow',
    merchantName: 'Tienda',
    paymentMethod: 'credit',
    status: 'posted',
    type: 'expense',
    updatedAt: '2026-05-10',
    ...overrides,
  };
}

function createRepositories(initialAccounts: Account[], initialTransactions: Transaction[]) {
  let accounts = [...initialAccounts];
  let transactions = [...initialTransactions];
  let installments: InstallmentPurchase[] = [];
  let statements: CreditCardStatement[] = [];
  const profiles: CreditCardProfile[] = [];

  const accountRepository = {
    getAccounts: async () => accounts,
    saveAccounts: async (nextAccounts: Account[]) => {
      for (const nextAccount of nextAccounts) {
        accounts = [
          ...accounts.filter(account => account.id !== nextAccount.id),
          nextAccount,
        ];
      }
    },
  };

  const transactionRepository = {
    getTransactions: async () => transactions,
    saveTransactions: async (nextTransactions: Transaction[]) => {
      for (const nextTransaction of nextTransactions) {
        transactions = [
          ...transactions.filter(candidate => candidate.id !== nextTransaction.id),
          nextTransaction,
        ];
      }
    },
  };

  const creditCardRepository: CreditCardRepository = {
    closeCreditCardAccount: async () => undefined,
    getCreditCardAccounts: async () => accounts.filter(account => account.type === 'creditCard'),
    getInstallmentPurchases: async accountIds =>
      installments.filter(installment => accountIds.includes(installment.accountId)),
    getProfiles: async accountIds =>
      profiles.filter(profile => accountIds.includes(profile.accountId)),
    getStatements: async accountIds =>
      statements.filter(statement => accountIds.includes(statement.accountId)),
    saveCreditCardAccount: async nextAccount => {
      accounts = [
        ...accounts.filter(account => account.id !== nextAccount.id),
        nextAccount,
      ];
    },
    saveInstallmentPurchases: async nextInstallments => {
      for (const nextInstallment of nextInstallments) {
        installments = [
          ...installments.filter(installment => installment.id !== nextInstallment.id),
          nextInstallment,
        ];
      }
    },
    saveProfiles: async () => undefined,
    saveStatements: async nextStatements => {
      for (const nextStatement of nextStatements) {
        statements = [
          ...statements.filter(statement => statement.id !== nextStatement.id),
          nextStatement,
        ];
      }
    },
    updateInstallmentPurchasesAccount: async (transactionIds, accountId) => {
      installments = installments.map(installment =>
        transactionIds.includes(installment.transactionId)
          ? { ...installment, accountId }
          : installment,
      );
    },
  };

  return {
    accountRepository,
    creditCardRepository,
    get accounts() {
      return accounts;
    },
    get installments() {
      return installments;
    },
    get statements() {
      return statements;
    },
    get transactions() {
      return transactions;
    },
    transactionRepository,
  };
}

test('credit transaction for an existing card updates debt and current statement', async () => {
  const repositories = createRepositories([card()], [transaction({ amount: 250000 })]);

  await reconcileCreditCardTransactions({
    accountRepository: repositories.accountRepository,
    creditCardRepository: repositories.creditCardRepository,
    currentDate: new Date('2026-05-18T12:00:00.000Z'),
    transactionRepository: repositories.transactionRepository,
  });

  expect(repositories.accounts.find(account => account.id === 'card-visa')?.debtBalance?.amount).toBe(250000);
  expect(repositories.statements[0]?.totalAmount).toBe(250000);
  expect(repositories.statements[0]?.minimumPaymentAmount).toBe(25000);
});

test('installment purchase uses full amount for credit usage and monthly amount for statement payment', async () => {
  const repositories = createRepositories([card()], [transaction({ amount: 1200000 })]);
  await repositories.creditCardRepository.saveInstallmentPurchases([
    {
      id: 'installment-tx-card',
      accountId: 'card-visa',
      createdAt: '2026-05-10',
      currency: 'COP',
      installmentCount: 12,
      monthlyAmount: 100000,
      paidInstallments: 0,
      status: 'active',
      totalAmount: 1200000,
      transactionId: 'tx-card',
      updatedAt: '2026-05-10',
    },
  ]);

  await reconcileCreditCardTransactions({
    accountRepository: repositories.accountRepository,
    creditCardRepository: repositories.creditCardRepository,
    currentDate: new Date('2026-05-18T12:00:00.000Z'),
    transactionRepository: repositories.transactionRepository,
  });

  expect(repositories.accounts.find(account => account.id === 'card-visa')?.debtBalance?.amount).toBe(1200000);
  expect(repositories.statements[0]?.totalAmount).toBe(100000);
});

test('credit card payment reduces card debt and does not create an expense transaction', async () => {
  const repositories = createRepositories(
    [
      debitAccount(),
      card({
        debtBalance: { amount: 250000, currency: 'COP' },
      }),
    ],
    [transaction({ amount: 250000 })],
  );

  const result = await registerCreditCardPayment({
    accountId: 'card-visa',
    accountRepository: repositories.accountRepository,
    amount: 100000,
    creditCardRepository: repositories.creditCardRepository,
    currentDate: new Date('2026-05-18T12:00:00.000Z'),
    sourceAccountId: 'account-bank',
    transactionRepository: repositories.transactionRepository,
  });

  expect(result.paidAmount).toBe(100000);
  expect(repositories.transactions.find(candidate => candidate.id === result.transaction.id)?.type).toBe(
    'creditCardPayment',
  );
  expect(repositories.transactions.find(candidate => candidate.id === result.transaction.id)?.targetAccountId).toBe(
    'card-visa',
  );
  expect(repositories.accounts.find(account => account.id === 'account-bank')?.balance.amount).toBe(900000);
  expect(repositories.accounts.find(account => account.id === 'card-visa')?.debtBalance?.amount).toBe(150000);
  expect(repositories.statements[0]?.totalAmount).toBe(150000);
});

test('billing cycle uses credit card closing and payment days when available', async () => {
  const repositories = createRepositories(
    [
      card({
        description: serializeCreditCardVisualMetadata({
          closingDay: 15,
          paymentDay: 25,
        }),
      }),
    ],
    [
      transaction({
        id: 'tx-before-close',
        amount: 100000,
        date: '2026-05-14',
      }),
      transaction({
        id: 'tx-after-close',
        amount: 400000,
        date: '2026-05-16',
      }),
    ],
  );

  await reconcileCreditCardTransactions({
    accountRepository: repositories.accountRepository,
    creditCardRepository: repositories.creditCardRepository,
    currentDate: new Date('2026-05-18T12:00:00.000Z'),
    transactionRepository: repositories.transactionRepository,
  });

  expect(repositories.accounts.find(account => account.id === 'card-visa')?.debtBalance?.amount).toBe(500000);
  expect(repositories.statements[0]?.statementStartDate).toBe('2026-05-16');
  expect(repositories.statements[0]?.statementEndDate).toBe('2026-06-15');
  expect(repositories.statements[0]?.paymentDueDate).toBe('2026-06-25');
  expect(repositories.statements[0]?.totalAmount).toBe(400000);
});

test('missing card target stores the movement as unclassified without affecting a real card', async () => {
  const repositories = createRepositories([card()], []);

  const target = await resolveCreditCardTransactionTarget({
    accountRepository: repositories.accountRepository,
    accounts: repositories.accounts,
    creditCardHint: 'Banco sin crear',
    isCreditTransaction: true,
    rawText: 'Compra con tarjeta Banco sin crear',
  });

  await repositories.transactionRepository.saveTransactions([
    transaction({
      accountId: target.accountId,
      creditCardHint: target.creditCardHint,
    }),
  ]);
  await reconcileCreditCardTransactions({
    accountRepository: repositories.accountRepository,
    creditCardRepository: repositories.creditCardRepository,
    currentDate: new Date('2026-05-18T12:00:00.000Z'),
    transactionRepository: repositories.transactionRepository,
  });

  expect(target.missingCreditCard).toBe(true);
  expect(target.accountId).toBe(UNCLASSIFIED_CREDIT_CARD_ACCOUNT_ID);
  expect(repositories.accounts.find(account => account.id === 'card-visa')?.debtBalance?.amount).toBe(0);
});

test('creating a matching card associates pending unclassified transactions', async () => {
  const repositories = createRepositories(
    [card()],
    [
      transaction({
        accountId: UNCLASSIFIED_CREDIT_CARD_ACCOUNT_ID,
        creditCardHint: 'Visa Gold',
      }),
    ],
  );

  const associatedCount = await associatePendingTransactionsForCreditCard({
    account: card(),
    accountRepository: repositories.accountRepository,
    creditCardRepository: repositories.creditCardRepository,
    transactionRepository: repositories.transactionRepository,
  });

  expect(associatedCount).toBe(1);
  expect(repositories.transactions[0]?.accountId).toBe('card-visa');
  expect(repositories.accounts.find(account => account.id === 'card-visa')?.debtBalance?.amount).toBe(100000);
});

test('sms credit card heuristics match existing cards or classify credit-like texts', () => {
  const accounts = [card()];

  expect(findMatchingCreditCardAccount(accounts, 'Visa', 'Compra tarjeta Visa')).toEqual(card());
  expect(shouldTreatTextAsCreditCardTransaction('Compra con tarjeta de credito terminada en 1234')).toBe(true);
  expect(shouldTreatTextAsCreditCardTransaction('CREDITP: Compra por $325.000')).toBe(true);
});
