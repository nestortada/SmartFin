import {
  financialIntegrityFixture,
  FINANCIAL_TEST_DATE,
} from './financialIntegrityFixture';
import { deleteManualTransactionSafely } from './phase0ManualTransactions';
import { registerCreditCardPayment } from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { financialState } from './financialState';
import type { SQLiteFault } from './realSQLite';

type Fixture = Awaited<ReturnType<typeof financialIntegrityFixture>>;
const pay = (f: Fixture) =>
  registerCreditCardPayment({
    ...f,
    accountId: 'card',
    sourceAccountId: 'bank',
    amount: 100000,
    currentDate: FINANCIAL_TEST_DATE,
  });

export const financialAtomicityScenarios = [
  {
    name: 'taxed transfer',
    faultSQL: 'INSERT INTO transactions',
    initial: {
      balances: { bank: 1000000, target: 0 },
      debt: 0,
      wealth: 1000000,
      expense: 0,
    },
    partial: {
      balances: { bank: 899600, target: 100000 },
      debt: 0,
      wealth: 999600,
      expense: 0,
    },
    success: {
      balances: { bank: 899600, target: 100000 },
      debt: 0,
      wealth: 999600,
      expense: 400,
    },
    prepare: async (f: Fixture) => () =>
      f.save({
        transactionType: 'internalTransfer',
        targetAccountId: 'target',
        amount: 100000,
        transferTaxCharged: true,
      }),
  },
  {
    name: 'card payment',
    faultSQL: 'INSERT INTO transactions',
    initial: {
      balances: { bank: 1000000 },
      debt: 250000,
      wealth: 750000,
      expense: 250000,
    },
    partial: {
      balances: { bank: 900000 },
      debt: 250000,
      wealth: 650000,
      expense: 250000,
    },
    success: {
      balances: { bank: 900000 },
      debt: 150000,
      wealth: 750000,
      expense: 250000,
    },
    prepare: async (f: Fixture) => {
      await f.save({ accountId: 'card', operationType: 'Crédito' });
      return () => pay(f);
    },
  },
  {
    name: 'expense deletion',
    faultSQL: 'DELETE FROM transactions',
    initial: {
      balances: { bank: 750000 },
      debt: 0,
      wealth: 750000,
      expense: 250000,
    },
    partial: {
      balances: { bank: 1000000 },
      debt: 0,
      wealth: 1000000,
      expense: 250000,
    },
    success: {
      balances: { bank: 1000000 },
      debt: 0,
      wealth: 1000000,
      expense: 0,
    },
    prepare: async (f: Fixture) => {
      const original = await f.save();
      return async () =>
        deleteManualTransactionSafely({
          ...f,
          accounts: await f.accountRepository.getAccounts(),
          transaction: original.transaction,
        });
    },
  },
  {
    name: 'payment edit',
    faultSQL: 'INSERT OR REPLACE INTO credit_card_statements',
    initial: {
      balances: { bank: 900000 },
      debt: 150000,
      wealth: 750000,
      expense: 250000,
    },
    partial: {
      balances: { bank: 950000 },
      debt: 200000,
      wealth: 750000,
      expense: 250000,
    },
    success: {
      balances: { bank: 950000 },
      debt: 200000,
      wealth: 750000,
      expense: 250000,
    },
    prepare: async (f: Fixture) => {
      await f.save({ accountId: 'card', operationType: 'Crédito' });
      const payment = await pay(f);
      return () =>
        f.save({
          editingTransaction: payment.transaction,
          transactionType: 'creditCardPayment',
          amount: 50000,
          targetAccountId: 'card',
        });
    },
  },
];

/** Reusable runner: always a fresh synthetic in-memory database, no outer transaction.
 * Returns the actual error/state; it never compensates balances or retries the operation. */
export async function runFinancialScenario(
  scenario: (typeof financialAtomicityScenarios)[number],
  fault?: SQLiteFault,
  options: {managed?: boolean} = {},
) {
  const f = await financialIntegrityFixture({ ...options, historical: true });
  try {
    const operation = await scenario.prepare(f);
    const before = await financialState(f);
    f.resetTrace();
    f.injectFault(fault);
    let error: unknown;
    try {
      await operation();
    } catch (caught) {
      error = caught;
    }
    const trace = f.trace.map(entry => ({
      ...entry,
      values: [...entry.values],
    }));
    f.injectFault();
    const after = await financialState(f);
    return { before, after, trace, error };
  } finally {
    f.native.close();
  }
}
