import { PRIMARY_CURRENCY } from '../../../shared/types';
import type { ISODateString } from '../../../shared/types';
import type { Transaction } from '../types';

export type TransactionRepository = {
  getTransactions: (referenceDate?: Date) => Promise<Transaction[]> | Transaction[];
  saveTransactions?: (transactions: Transaction[]) => Promise<void>;
  deleteTransaction?: (id: string) => Promise<void>;
  updateTransactionCategory?: (id: string, categoryId: string | null) => Promise<void>;
  updateTransactionsCategoryByDescription?: (description: string, categoryId: string | null) => Promise<void>;
  saveMerchantMapping?: (rawMerchantText: string, categoryId: string) => Promise<void>;
  getMerchantMapping?: (rawMerchantText: string) => Promise<string | null>;
};

// In-memory store for additional transactions (SMS-captured, etc.)
let additionalTransactions: Transaction[] = [];

function toDateString(date: Date): ISODateString {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function dateInCurrentMonth(
  referenceDate: Date,
  preferredDay: number,
): ISODateString {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const day = Math.max(
    1,
    Math.min(preferredDay, referenceDate.getDate(), lastDayOfMonth),
  );

  return toDateString(new Date(year, month, day));
}

function dateInPreviousMonth(
  referenceDate: Date,
  preferredDay: number,
): ISODateString {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth() - 1;
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const day = Math.max(1, Math.min(preferredDay, lastDayOfMonth));

  return toDateString(new Date(year, month, day));
}

function buildMockTransactions(referenceDate: Date): Transaction[] {
  const salaryDate = dateInCurrentMonth(referenceDate, 1);
  const freelanceDate = dateInCurrentMonth(referenceDate, 6);
  const d1Date = dateInCurrentMonth(referenceDate, 8);
  const exitoDate = dateInCurrentMonth(referenceDate, 10);
  const transportDate = dateInCurrentMonth(referenceDate, 11);
  const netflixDate = dateInCurrentMonth(referenceDate, 12);
  const spotifyDate = dateInCurrentMonth(referenceDate, 13);
  const cardPaymentDate = dateInCurrentMonth(referenceDate, 14);
  const transferDate = dateInCurrentMonth(referenceDate, 15);
  const loanPaymentDate = dateInCurrentMonth(referenceDate, 16);
  const previousUtilityDate = dateInPreviousMonth(referenceDate, 25);

  return [
    {
      id: 'txn-salary',
      amount: 7200000,
      currency: PRIMARY_CURRENCY,
      description: 'Salario mensual',
      date: salaryDate,
      accountId: 'account-nu-savings',
      categoryId: 'category-income',
      type: 'income',
      direction: 'inflow',
      status: 'posted',
      merchantName: 'Empresa colombiana',
      createdAt: salaryDate,
      updatedAt: salaryDate,
    },
    {
      id: 'txn-freelance',
      amount: 1500000,
      currency: PRIMARY_CURRENCY,
      description: 'Proyecto freelance',
      date: freelanceDate,
      accountId: 'account-nu-savings',
      categoryId: 'category-income',
      type: 'income',
      direction: 'inflow',
      status: 'posted',
      merchantName: 'Cliente independiente',
      createdAt: freelanceDate,
      updatedAt: freelanceDate,
    },
    {
      id: 'txn-d1',
      amount: 185600,
      currency: PRIMARY_CURRENCY,
      description: 'Mercado semanal',
      date: d1Date,
      accountId: 'account-nu-credit-card',
      categoryId: 'category-food',
      type: 'expense',
      direction: 'outflow',
      status: 'posted',
      merchantName: 'Tiendas D1',
      createdAt: d1Date,
      updatedAt: d1Date,
    },
    {
      id: 'txn-exito',
      amount: 242300,
      currency: PRIMARY_CURRENCY,
      description: 'Compra de supermercado',
      date: exitoDate,
      accountId: 'account-nu-credit-card',
      categoryId: 'category-food',
      type: 'expense',
      direction: 'outflow',
      status: 'posted',
      merchantName: 'Éxito',
      createdAt: exitoDate,
      updatedAt: exitoDate,
    },
    {
      id: 'txn-transport',
      amount: 48000,
      currency: PRIMARY_CURRENCY,
      description: 'Recargas de transporte',
      date: transportDate,
      accountId: 'account-nu-savings',
      categoryId: 'category-transport',
      type: 'expense',
      direction: 'outflow',
      status: 'posted',
      merchantName: 'Transporte Bogotá',
      createdAt: transportDate,
      updatedAt: transportDate,
    },
    {
      id: 'txn-netflix',
      amount: 44900,
      currency: PRIMARY_CURRENCY,
      description: 'Suscripción mensual',
      date: netflixDate,
      accountId: 'account-nu-credit-card',
      categoryId: 'category-entertainment',
      type: 'expense',
      direction: 'outflow',
      status: 'posted',
      merchantName: 'Netflix',
      createdAt: netflixDate,
      updatedAt: netflixDate,
    },
    {
      id: 'txn-spotify',
      amount: 19900,
      currency: PRIMARY_CURRENCY,
      description: 'Música en streaming',
      date: spotifyDate,
      accountId: 'account-nu-credit-card',
      categoryId: 'category-entertainment',
      type: 'expense',
      direction: 'outflow',
      status: 'posted',
      merchantName: 'Spotify',
      createdAt: spotifyDate,
      updatedAt: spotifyDate,
    },
    {
      id: 'txn-nu-card-payment',
      amount: 650000,
      currency: PRIMARY_CURRENCY,
      description: 'Pago de tarjeta Nu',
      date: cardPaymentDate,
      accountId: 'account-nu-savings',
      categoryId: 'category-debts',
      type: 'creditCardPayment',
      direction: 'outflow',
      status: 'posted',
      targetAccountId: 'account-nu-credit-card',
      merchantName: 'Nu Colombia',
      notes: 'No cuenta como gasto adicional del mes.',
      createdAt: cardPaymentDate,
      updatedAt: cardPaymentDate,
    },
    {
      id: 'txn-internal-transfer',
      amount: 200000,
      currency: PRIMARY_CURRENCY,
      description: 'Retiro para efectivo',
      date: transferDate,
      accountId: 'account-nu-savings',
      categoryId: 'category-other',
      type: 'internalTransfer',
      direction: 'neutral',
      status: 'posted',
      targetAccountId: 'account-cash',
      notes: 'Movimiento entre cuentas propias.',
      createdAt: transferDate,
      updatedAt: transferDate,
    },
    {
      id: 'txn-loan-payment',
      amount: 300000,
      currency: PRIMARY_CURRENCY,
      description: 'Abono a préstamo familiar',
      date: loanPaymentDate,
      accountId: 'account-nu-savings',
      categoryId: 'category-debts',
      type: 'loanPayment',
      direction: 'outflow',
      status: 'posted',
      targetAccountId: 'account-family-loan',
      notes: 'Pago separado de los gastos comunes.',
      createdAt: loanPaymentDate,
      updatedAt: loanPaymentDate,
    },
    {
      id: 'txn-utilities-previous-month',
      amount: 186000,
      currency: PRIMARY_CURRENCY,
      description: 'Servicios del mes anterior',
      date: previousUtilityDate,
      accountId: 'account-nu-savings',
      categoryId: 'category-utilities',
      type: 'expense',
      direction: 'outflow',
      status: 'posted',
      merchantName: 'Servicios públicos',
      createdAt: previousUtilityDate,
      updatedAt: previousUtilityDate,
    },
  ];
}

export const mockTransactionRepository: TransactionRepository = {
  getTransactions: (referenceDate = new Date()) => {
    const mockTransactions = buildMockTransactions(referenceDate).map(transaction => ({ ...transaction }));
    return [...mockTransactions, ...additionalTransactions];
  },
  saveTransactions: async (transactions: Transaction[]) => {
    // Keep only the new transactions that aren't from the mock data
    const mockIds = buildMockTransactions(new Date()).map(t => t.id);
    additionalTransactions = transactions.filter(t => !mockIds.includes(t.id));
  },
  deleteTransaction: async (id: string) => {
    additionalTransactions = additionalTransactions.filter(t => t.id !== id);
  },
  updateTransactionCategory: async (id: string, categoryId: string | null) => {
    additionalTransactions = additionalTransactions.map(t =>
      t.id === id ? { ...t, categoryId: categoryId ?? undefined } : t
    );
  },
  updateTransactionsCategoryByDescription: async (description: string, categoryId: string | null) => {
    additionalTransactions = additionalTransactions.map(t =>
      t.description === description || t.merchantName === description
        ? { ...t, categoryId: categoryId ?? undefined }
        : t
    );
  },
  saveMerchantMapping: async (_rawMerchantText: string, _categoryId: string) => {
    // Mock implementation doesn't need to persist mappings in DB
  },
  getMerchantMapping: async (_rawMerchantText: string) => {
    return null;
  },
};
