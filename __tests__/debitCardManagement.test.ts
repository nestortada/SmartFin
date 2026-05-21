import {
  deleteDebitCard,
  parseDebitCardMetadata,
  saveDebitCardFromForm,
} from '../src/modules/accounts';
import type { Account } from '../src/modules/accounts';

function createRepository(initialAccounts: Account[] = []) {
  let accounts = [...initialAccounts];

  return {
    getAccounts: async () => accounts,
    repository: {
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
    },
  };
}

describe('debit card management', () => {
  it('saves a debit card account with recurring income metadata', async () => {
    const { getAccounts, repository } = createRepository();

    const account = await saveDebitCardFromForm(repository, {
      bankName: 'Banco Uno',
      currentBalance: 1500000,
      name: 'Debito principal',
      recurringIncome: {
        amount: 3200000,
        frequency: 'monthly',
        incomeType: 'salary',
      },
    });

    expect(account).toEqual(expect.objectContaining({
      balance: { amount: 1500000, currency: 'COP' },
      institutionName: 'Banco Uno',
      name: 'Debito principal',
      status: 'active',
      type: 'bankAccount',
    }));
    expect(parseDebitCardMetadata(account).recurringIncome).toEqual({
      amount: 3200000,
      frequency: 'monthly',
      incomeType: 'salary',
    });
    expect(await getAccounts()).toHaveLength(1);
  });

  it('closes a debit card without deleting historic account data', async () => {
    const { getAccounts, repository } = createRepository([
      {
        id: 'debit-card',
        balance: { amount: 100000, currency: 'COP' },
        createdAt: '2026-05-01',
        currency: 'COP',
        name: 'Debito',
        status: 'active',
        type: 'bankAccount',
        updatedAt: '2026-05-01',
      },
    ]);

    await deleteDebitCard(repository, 'debit-card');

    expect((await getAccounts())[0]).toEqual(expect.objectContaining({
      id: 'debit-card',
      status: 'closed',
    }));
  });
});
