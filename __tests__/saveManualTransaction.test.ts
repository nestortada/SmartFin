import type { Account } from '../src/modules/accounts';
import type {
  CreditCardProfile,
  CreditCardStatement,
  InstallmentPurchase,
} from '../src/modules/creditCards';
import type { CreditCardRepository } from '../src/modules/creditCards/repositories';
import { saveManualTransaction } from '../src/modules/transactions';
import type { Transaction } from '../src/modules/transactions';

function bankAccount(overrides: Partial<Account> = {}): Account {
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

function creditCard(overrides: Partial<Account> = {}): Account {
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

function createRepositories(initialAccounts: Account[]) {
  let accounts = [...initialAccounts];
  let transactions: Transaction[] = [];
  let installments: InstallmentPurchase[] = [];
  let statements: CreditCardStatement[] = [];
  const profiles: CreditCardProfile[] = [];

  const accountRepository = {
    getAccounts: async () => accounts,
    saveAccounts: async (nextAccounts: Account[]) => {
      nextAccounts.forEach(nextAccount => {
        const index = accounts.findIndex(account => account.id === nextAccount.id);
        if (index >= 0) {
          accounts[index] = nextAccount;
        } else {
          accounts.push(nextAccount);
        }
      });
    },
  };

  const transactionRepository = {
    deleteTransaction: jest.fn(async (transactionId: string) => {
      transactions = transactions.filter(transaction => transaction.id !== transactionId);
    }),
    deleteInstallmentPurchasesByTransactionId: jest.fn(async (transactionId: string) => {
      installments = installments.filter(installment => installment.transactionId !== transactionId);
    }),
    getTransactions: async () => transactions,
    saveTransactions: async (nextTransactions: Transaction[]) => {
      nextTransactions.forEach(nextTransaction => {
        const index = transactions.findIndex(transaction => transaction.id === nextTransaction.id);
        if (index >= 0) {
          transactions[index] = nextTransaction;
        } else {
          transactions.push(nextTransaction);
        }
      });
    },
  };

  const creditCardRepository: CreditCardRepository = {
    closeCreditCardAccount: async accountId => {
      accounts = accounts.map(account =>
        account.id === accountId ? { ...account, status: 'closed' } : account,
      );
    },
    getCreditCardAccounts: async () =>
      accounts.filter(account => account.type === 'creditCard' && account.status === 'active'),
    getInstallmentPurchases: async accountIds =>
      installments.filter(installment => accountIds.includes(installment.accountId)),
    getProfiles: async accountIds =>
      profiles.filter(profile => accountIds.includes(profile.accountId)),
    getStatements: async accountIds =>
      statements.filter(statement => accountIds.includes(statement.accountId)),
    saveCreditCardAccount: async account => {
      await accountRepository.saveAccounts([account]);
    },
    saveInstallmentPurchases: jest.fn(async nextInstallments => {
      installments = [
        ...installments.filter(
          installment => !nextInstallments.some(next => next.id === installment.id),
        ),
        ...nextInstallments,
      ];
    }),
    saveProfiles: async nextProfiles => {
      nextProfiles.forEach(nextProfile => {
        const index = profiles.findIndex(profile => profile.accountId === nextProfile.accountId);
        if (index >= 0) {
          profiles[index] = nextProfile;
        } else {
          profiles.push(nextProfile);
        }
      });
    },
    saveStatements: async nextStatements => {
      statements = [
        ...statements.filter(
          statement => !nextStatements.some(next => next.id === statement.id),
        ),
        ...nextStatements,
      ];
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
    getAccounts: () => accounts,
    getTransactions: () => transactions,
    transactionRepository,
  };
}

describe('saveManualTransaction', () => {
  it('persists a debit expense and applies the account balance impact outside the screen', async () => {
    const repositories = createRepositories([bankAccount()]);

    const result = await saveManualTransaction({
      accountId: 'account-bank',
      accountRepository: repositories.accountRepository,
      accounts: repositories.getAccounts(),
      amount: 250000,
      categoryId: 'category-food',
      creditCardRepository: repositories.creditCardRepository,
      currentDate: new Date('2026-05-18T12:00:00.000Z'),
      editingTransaction: null,
      hasInterestFreeInstallments: false,
      installmentCountInput: '1',
      interestFreeInstallmentCountInput: '',
      merchantName: 'Mercado',
      notes: 'Compra semanal',
      operationType: 'Débito',
      transactionRepository: repositories.transactionRepository,
      transactionType: 'expense',
    });

    expect(result.transaction.paymentMethod).toBe('debit');
    expect(result.transaction.notes).toBe('Débito • Compra semanal');
    expect(repositories.getAccounts()[0]?.balance.amount).toBe(750000);
    expect(repositories.getTransactions()).toHaveLength(1);
    expect(repositories.transactionRepository.deleteInstallmentPurchasesByTransactionId)
      .toHaveBeenCalledWith(result.transaction.id);
  });

  it('persists credit-card installments from the use case instead of the screen', async () => {
    const repositories = createRepositories([bankAccount(), creditCard()]);

    const result = await saveManualTransaction({
      accountId: 'card-visa',
      accountRepository: repositories.accountRepository,
      accounts: repositories.getAccounts(),
      amount: 1200000,
      categoryId: 'category-tech',
      creditCardHint: 'Visa Gold',
      creditCardRepository: repositories.creditCardRepository,
      currentDate: new Date('2026-05-18T12:00:00.000Z'),
      editingTransaction: null,
      hasInterestFreeInstallments: true,
      installmentCountInput: '3',
      interestFreeInstallmentCountInput: '2',
      merchantName: 'Tecnologia',
      notes: '',
      operationType: 'Crédito',
      transactionRepository: repositories.transactionRepository,
      transactionType: 'expense',
    });

    expect(result.transaction.paymentMethod).toBe('credit');
    expect(result.transaction.accountId).toBe('card-visa');
    expect(result.transaction.notes).toBe('Crédito • Registro manual | Cuotas: 3 | Sin intereses: 2');
    expect(repositories.creditCardRepository.saveInstallmentPurchases).toHaveBeenCalledWith([
      expect.objectContaining({
        accountId: 'card-visa',
        installmentCount: 3,
        monthlyAmount: 400000,
        totalAmount: 1200000,
        transactionId: result.transaction.id,
      }),
    ]);
  });

  it('persists an internal transfer and updates source and target balances', async () => {
    const repositories = createRepositories([
      bankAccount(),
      bankAccount({
        id: 'account-savings',
        balance: { amount: 300000, currency: 'COP' },
        name: 'Ahorros',
        type: 'savingsAccount',
      }),
    ]);

    const result = await saveManualTransaction({
      accountId: 'account-bank',
      accountRepository: repositories.accountRepository,
      accounts: repositories.getAccounts(),
      amount: 200000,
      creditCardRepository: repositories.creditCardRepository,
      currentDate: new Date('2026-05-18T12:00:00.000Z'),
      editingTransaction: null,
      hasInterestFreeInstallments: false,
      installmentCountInput: '1',
      interestFreeInstallmentCountInput: '',
      merchantName: 'Recarga de ahorros',
      notes: 'Reserva',
      operationType: 'Débito',
      targetAccountId: 'account-savings',
      transactionRepository: repositories.transactionRepository,
      transactionType: 'internalTransfer',
    });

    expect(result.transaction).toEqual(expect.objectContaining({
      accountId: 'account-bank',
      direction: 'outflow',
      paymentMethod: 'debit',
      targetAccountId: 'account-savings',
      type: 'internalTransfer',
    }));
    expect(result.transactions).toEqual([
      expect.objectContaining({
        accountId: 'account-bank',
        direction: 'outflow',
        merchantName: 'Recarga de ahorros',
      }),
      expect.objectContaining({
        accountId: 'account-savings',
        direction: 'inflow',
        merchantName: 'Entrada: Recarga de ahorros',
      }),
    ]);
    expect(repositories.getTransactions()).toHaveLength(2);
    expect(repositories.getAccounts().find(account => account.id === 'account-bank')?.balance.amount).toBe(800000);
    expect(repositories.getAccounts().find(account => account.id === 'account-savings')?.balance.amount).toBe(500000);
  });

  it('persists 4x1000 as an additional debit expense when a transfer is taxed', async () => {
    const repositories = createRepositories([
      bankAccount(),
      bankAccount({
        id: 'account-savings',
        balance: { amount: 300000, currency: 'COP' },
        name: 'Ahorros',
        type: 'savingsAccount',
      }),
    ]);

    const result = await saveManualTransaction({
      accountId: 'account-bank',
      accountRepository: repositories.accountRepository,
      accounts: repositories.getAccounts(),
      amount: 200000,
      creditCardRepository: repositories.creditCardRepository,
      currentDate: new Date('2026-05-18T12:00:00.000Z'),
      editingTransaction: null,
      hasInterestFreeInstallments: false,
      installmentCountInput: '1',
      interestFreeInstallmentCountInput: '',
      merchantName: 'Recarga de ahorros',
      notes: 'Reserva',
      operationType: 'Débito',
      targetAccountId: 'account-savings',
      transactionRepository: repositories.transactionRepository,
      transactionType: 'internalTransfer',
      transferTaxCharged: true,
    });

    expect(result.transactions).toEqual([
      expect.objectContaining({ accountId: 'account-bank', direction: 'outflow' }),
      expect.objectContaining({ accountId: 'account-savings', direction: 'inflow' }),
      expect.objectContaining({ accountId: 'account-bank', amount: 800, type: 'expense' }),
    ]);
    expect(repositories.getAccounts().find(account => account.id === 'account-bank')?.balance.amount).toBe(799200);
    expect(repositories.getAccounts().find(account => account.id === 'account-savings')?.balance.amount).toBe(500000);
  });

  it('reverses the previous transfer impact before applying an edited transfer', async () => {
    const repositories = createRepositories([
      bankAccount({ balance: { amount: 800000, currency: 'COP' } }),
      bankAccount({
        id: 'account-savings',
        balance: { amount: 500000, currency: 'COP' },
        name: 'Ahorros',
        type: 'savingsAccount',
      }),
      bankAccount({
        id: 'account-wallet',
        balance: { amount: 100000, currency: 'COP' },
        name: 'Billetera',
        type: 'savingsAccount',
      }),
    ]);
    const editingTransaction: Transaction = {
      id: 'tx-transfer',
      accountId: 'account-bank',
      amount: 200000,
      createdAt: '2026-05-18T12:00:00.000Z',
      currency: 'COP',
      date: '2026-05-18T12:00:00.000Z',
      description: 'Transferencia original',
      direction: 'neutral',
      merchantName: 'Transferencia original',
      paymentMethod: 'debit',
      status: 'posted',
      targetAccountId: 'account-savings',
      type: 'internalTransfer',
      updatedAt: '2026-05-18T12:00:00.000Z',
    };

    await saveManualTransaction({
      accountId: 'account-bank',
      accountRepository: repositories.accountRepository,
      accounts: repositories.getAccounts(),
      amount: 150000,
      creditCardRepository: repositories.creditCardRepository,
      currentDate: new Date('2026-05-19T12:00:00.000Z'),
      editingTransaction,
      hasInterestFreeInstallments: false,
      installmentCountInput: '1',
      interestFreeInstallmentCountInput: '',
      merchantName: 'Transferencia editada',
      notes: 'Cambio destino',
      operationType: 'Débito',
      targetAccountId: 'account-wallet',
      transactionRepository: repositories.transactionRepository,
      transactionType: 'internalTransfer',
    });

    expect(repositories.getAccounts().find(account => account.id === 'account-bank')?.balance.amount).toBe(850000);
    expect(repositories.getAccounts().find(account => account.id === 'account-savings')?.balance.amount).toBe(300000);
    expect(repositories.getAccounts().find(account => account.id === 'account-wallet')?.balance.amount).toBe(250000);
  });
});
