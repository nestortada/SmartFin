import type {
  SharedCommandResult,
  SharedExpenseState,
  SharedLossPeriodTotals,
} from '../types/SharedExpense';
import type { SqliteTransactionRepository } from './sqliteTransactionRepository';
import type { SqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import type { CreditCardRepository } from '../../creditCards/repositories';
import type { SharedFinancialTotals } from '../useCases/readSharedFinancialTotals';
import type { Transaction } from '../types';

/** Only fields used by command effects. REAL reductions retain ledger ordering. */
export type SharedEffectTransaction = Pick<Transaction, 'id' | 'amount'> &
  (
    | Pick<
        Transaction,
        'type' | 'direction' | 'status' | 'accountId' | 'paymentMethod'
      >
    | { contribution: number }
  );

export type SharedExpenseContext = {
  state: SharedExpenseState;
  now: string;
  id: (suffix: string) => string;
  transactionRepository: SqliteTransactionRepository;
  accountRepository: SqliteAccountRepository;
  creditCardRepository: CreditCardRepository;
  reloadState: () => Promise<SharedExpenseState>;
  flushState: () => Promise<void>;
  readEffectTransactions?: () => Promise<SharedEffectTransaction[]>;
  readTransactionChanges?: () => Promise<
    Pick<SharedCommandResult, 'transactions' | 'deletedTransactionIds'>
  >;
};
export type SharedExpenseRepository = {
  getState: () => Promise<SharedExpenseState>;
  getFinancialTotals: () => Promise<SharedFinancialTotals>;
  getLossPeriodTotals: (
    startDate: string,
    endDateExclusive: string,
  ) => Promise<SharedLossPeriodTotals>;
  execute: (
    commandId: string,
    payload: unknown,
    operation: (context: SharedExpenseContext) => Promise<SharedCommandResult>,
  ) => Promise<SharedCommandResult>;
};
