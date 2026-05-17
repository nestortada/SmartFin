import { PRIMARY_CURRENCY } from '../../../shared/types';
import type { Account } from '../types';

export type AccountRepository = {
  getAccounts: () => Account[];
};

const mockAccounts: Account[] = [
  {
    id: 'account-nu-savings',
    name: 'Cuenta Nu ahorro',
    type: 'savingsAccount',
    status: 'active',
    currency: PRIMARY_CURRENCY,
    balance: {
      amount: 7400000,
      currency: PRIMARY_CURRENCY,
    },
    institutionName: 'Nu Colombia',
    description: 'Cuenta de ahorro local para saldos disponibles.',
    createdAt: '2026-05-01',
    updatedAt: '2026-05-16',
  },
  {
    id: 'account-nu-credit-card',
    name: 'Tarjeta de crédito Nu',
    type: 'creditCard',
    status: 'active',
    currency: PRIMARY_CURRENCY,
    balance: {
      amount: 0,
      currency: PRIMARY_CURRENCY,
    },
    debtBalance: {
      amount: 1280000,
      currency: PRIMARY_CURRENCY,
    },
    creditLimit: {
      amount: 5000000,
      currency: PRIMARY_CURRENCY,
    },
    institutionName: 'Nu Colombia',
    description: 'Tarjeta local de ejemplo con deuda actual.',
    createdAt: '2026-05-01',
    updatedAt: '2026-05-16',
  },
  {
    id: 'account-cash',
    name: 'Efectivo',
    type: 'cash',
    status: 'active',
    currency: PRIMARY_CURRENCY,
    balance: {
      amount: 280000,
      currency: PRIMARY_CURRENCY,
    },
    description: 'Dinero disponible en efectivo.',
    createdAt: '2026-05-01',
    updatedAt: '2026-05-16',
  },
  {
    id: 'account-family-loan',
    name: 'Préstamo familiar',
    type: 'loan',
    status: 'active',
    currency: PRIMARY_CURRENCY,
    balance: {
      amount: 0,
      currency: PRIMARY_CURRENCY,
    },
    debtBalance: {
      amount: 3200000,
      currency: PRIMARY_CURRENCY,
    },
    description: 'Deuda simple registrada de forma local.',
    createdAt: '2026-05-01',
    updatedAt: '2026-05-16',
  },
];

function cloneAccount(account: Account): Account {
  return {
    ...account,
    balance: { ...account.balance },
    ...(account.debtBalance
      ? { debtBalance: { ...account.debtBalance } }
      : {}),
    ...(account.creditLimit ? { creditLimit: { ...account.creditLimit } } : {}),
  };
}

export const mockAccountRepository: AccountRepository = {
  getAccounts: () => mockAccounts.map(cloneAccount),
};
