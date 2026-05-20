import type { Account } from '../../accounts';
import type { SqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import type { CreditCardRepository } from '../../creditCards/repositories';
import {
  reconcileCreditCardTransactions,
  resolveCreditCardTransactionTarget,
  type ResolveCreditCardTransactionTargetResult,
} from '../../creditCards/useCases';
import type { SqliteTransactionRepository } from '../repositories/sqliteTransactionRepository';
import type { Transaction, TransactionType } from '../types';

export type ManualTransactionOperationType = 'Débito' | 'Crédito';

type ManualAccountRepository = Pick<SqliteAccountRepository, 'getAccounts' | 'saveAccounts'>;

type ManualTransactionRepository = Pick<
  SqliteTransactionRepository,
  'deleteInstallmentPurchasesByTransactionId' | 'getTransactions' | 'saveTransactions'
>;

export type SaveManualTransactionParams = {
  accountId?: string;
  accountRepository: ManualAccountRepository;
  accounts: Account[];
  amount: number;
  categoryId?: string;
  creditCardHint?: string;
  creditCardRepository: CreditCardRepository;
  currentDate?: Date;
  editingTransaction?: Transaction | null;
  hasInterestFreeInstallments: boolean;
  installmentCountInput: string;
  interestFreeInstallmentCountInput: string;
  merchantName: string;
  notes?: string;
  operationType: ManualTransactionOperationType;
  targetAccountId?: string;
  transactionRepository: ManualTransactionRepository;
  transactionType: TransactionType;
};

export type SaveManualTransactionResult = {
  creditCardTarget: ResolveCreditCardTransactionTargetResult;
  isCreditCardExpense: boolean;
  transaction: Transaction;
};

type AccountImpact = {
  balanceDelta: number;
  debtDelta: number;
};

function isCreditOperation(operationType: ManualTransactionOperationType): boolean {
  return operationType.toLowerCase().includes('cr');
}

function getAccountImpact(
  transaction: Transaction,
  account: Account,
  role: 'source' | 'target' = 'source',
): AccountImpact {
  if (transaction.type === 'internalTransfer') {
    return {
      balanceDelta: role === 'target' ? transaction.amount : -transaction.amount,
      debtDelta: 0,
    };
  }

  const isIncomeTransaction = transaction.direction === 'inflow' || transaction.type === 'income';
  const isCreditExpense = !isIncomeTransaction && account.type === 'creditCard';

  return {
    balanceDelta: isIncomeTransaction ? transaction.amount : isCreditExpense ? 0 : -transaction.amount,
    debtDelta: isCreditExpense ? transaction.amount : 0,
  };
}

function applyAccountImpact(
  account: Account,
  transaction: Transaction,
  multiplier: 1 | -1,
  role: 'source' | 'target' = 'source',
): Account {
  const impact = getAccountImpact(transaction, account, role);
  const nextDebtAmount = (account.debtBalance?.amount ?? 0) + impact.debtDelta * multiplier;

  return {
    ...account,
    balance: {
      ...account.balance,
      amount: account.balance.amount + impact.balanceDelta * multiplier,
    },
    ...(account.type === 'creditCard'
      ? {
          debtBalance: {
            amount: Math.max(0, nextDebtAmount),
            currency: account.currency,
          },
        }
      : {}),
    updatedAt: new Date().toISOString(),
  };
}

function shouldApplyBalanceImpact(transaction: Transaction, account: Account): boolean {
  return account.type !== 'creditCard' && transaction.paymentMethod !== 'credit';
}

function getTransactionDirection(transactionType: TransactionType): Transaction['direction'] {
  if (transactionType === 'income') {
    return 'inflow';
  }

  if (transactionType === 'internalTransfer') {
    return 'neutral';
  }

  return 'outflow';
}

function buildTransactionNotes({
  installmentCount,
  interestFreeInstallmentCount,
  isCreditCardExpense,
  notes,
  operationType,
  transactionType,
}: {
  installmentCount: number;
  interestFreeInstallmentCount: number;
  isCreditCardExpense: boolean;
  notes?: string;
  operationType: ManualTransactionOperationType;
  transactionType: TransactionType;
}): string {
  const installmentNotes = isCreditCardExpense && installmentCount > 1
    ? ` | Cuotas: ${installmentCount}${interestFreeInstallmentCount ? ` | Sin intereses: ${interestFreeInstallmentCount}` : ''}`
    : '';
  const baseNotes = notes ? notes : 'Registro manual';
  const prefix = transactionType === 'internalTransfer' ? 'Transferencia' : operationType;

  return `${prefix} • ${baseNotes}${installmentNotes}`;
}

function normalizeInstallmentCount(value: string): number {
  return Math.max(1, Number(value) || 1);
}

function normalizeInterestFreeInstallmentCount({
  enabled,
  installmentCount,
  value,
}: {
  enabled: boolean;
  installmentCount: number;
  value: string;
}): number {
  if (!enabled) {
    return 0;
  }

  return Math.min(Math.max(1, Number(value) || installmentCount), installmentCount);
}

function applyTransactionImpact({
  accounts,
  accountUpdates,
  multiplier,
  transaction,
}: {
  accounts: Account[];
  accountUpdates: Map<string, Account>;
  multiplier: 1 | -1;
  transaction: Transaction;
}) {
  const getMutableAccount = (candidateAccountId: string) =>
    accountUpdates.get(candidateAccountId) ?? accounts.find(account => account.id === candidateAccountId);

  const sourceAccount = getMutableAccount(transaction.accountId);
  if (sourceAccount && shouldApplyBalanceImpact(transaction, sourceAccount)) {
    accountUpdates.set(
      sourceAccount.id,
      applyAccountImpact(sourceAccount, transaction, multiplier, 'source'),
    );
  }

  if (transaction.type !== 'internalTransfer' || !transaction.targetAccountId) {
    return;
  }

  const targetAccount = getMutableAccount(transaction.targetAccountId);
  if (targetAccount && shouldApplyBalanceImpact(transaction, targetAccount)) {
    accountUpdates.set(
      targetAccount.id,
      applyAccountImpact(targetAccount, transaction, multiplier, 'target'),
    );
  }
}

export function getNextMonthDueDate(fromDate: string): string {
  const dueDate = new Date(fromDate);
  dueDate.setMonth(dueDate.getMonth() + 1);
  return dueDate.toISOString();
}

export async function saveManualTransaction(
  params: SaveManualTransactionParams,
): Promise<SaveManualTransactionResult> {
  const {
    accountId,
    accountRepository,
    accounts,
    amount,
    categoryId,
    creditCardHint,
    creditCardRepository,
    currentDate = new Date(),
    editingTransaction,
    hasInterestFreeInstallments,
    installmentCountInput,
    interestFreeInstallmentCountInput,
    merchantName,
    notes,
    operationType,
    targetAccountId: requestedTargetAccountId,
    transactionRepository,
    transactionType,
  } = params;
  const isCreditCardExpense =
    transactionType !== 'income' &&
    transactionType !== 'internalTransfer' &&
    isCreditOperation(operationType);

  if (!amount || amount <= 0) {
    throw new Error('Monto invÃ¡lido.');
  }

  const now = currentDate.toISOString();
  const installmentCount = normalizeInstallmentCount(installmentCountInput);
  const interestFreeInstallmentCount = normalizeInterestFreeInstallmentCount({
    enabled: hasInterestFreeInstallments,
    installmentCount,
    value: interestFreeInstallmentCountInput,
  });
  const selectedAccount = accounts.find(account => account.id === accountId);
  const creditCardTarget = await resolveCreditCardTransactionTarget({
    accountRepository,
    accounts,
    creditCardHint: creditCardHint?.trim() || selectedAccount?.name || merchantName,
    isCreditTransaction: isCreditCardExpense,
    rawText: `${merchantName} ${notes ?? ''}`,
    selectedAccountId: accountId,
  });
  const targetAccountId = transactionType === 'internalTransfer'
    ? requestedTargetAccountId
    : creditCardTarget.accountId ?? accountId;

  if (!targetAccountId) {
    throw new Error('Selecciona una cuenta o indica la tarjeta pendiente.');
  }

  if (transactionType === 'internalTransfer') {
    if (!accountId || !requestedTargetAccountId) {
      throw new Error('Selecciona cuenta origen y destino.');
    }

    if (accountId === requestedTargetAccountId) {
      throw new Error('La cuenta origen y destino deben ser diferentes.');
    }
  }

  const transaction: Transaction = {
    id: editingTransaction?.id ?? `tx_manual_${Date.now()}`,
    accountId: transactionType === 'internalTransfer' ? accountId as string : targetAccountId,
    amount,
    categoryId: categoryId || undefined,
    createdAt: editingTransaction?.createdAt ?? now,
    creditCardHint: isCreditCardExpense ? creditCardTarget.creditCardHint : undefined,
    currency: editingTransaction?.currency ?? 'COP',
    date: editingTransaction?.date ?? now,
    description: merchantName,
    direction: getTransactionDirection(transactionType),
    merchantName,
    notes: buildTransactionNotes({
      installmentCount,
      interestFreeInstallmentCount,
      isCreditCardExpense,
      notes,
      operationType,
      transactionType,
    }),
    paymentMethod: isCreditCardExpense ? 'credit' : 'debit',
    status: editingTransaction?.status ?? 'posted',
    targetAccountId: transactionType === 'internalTransfer' ? requestedTargetAccountId : undefined,
    type: transactionType,
    updatedAt: now,
  };

  const accountUpdates = new Map<string, Account>();

  if (editingTransaction) {
    applyTransactionImpact({
      accounts,
      accountUpdates,
      multiplier: -1,
      transaction: editingTransaction,
    });
  }

  applyTransactionImpact({
    accounts,
    accountUpdates,
    multiplier: 1,
    transaction,
  });

  if (accountUpdates.size > 0) {
    await accountRepository.saveAccounts(Array.from(accountUpdates.values()));
  }

  await transactionRepository.saveTransactions([transaction]);

  if (isCreditCardExpense && installmentCount > 1) {
    await creditCardRepository.saveInstallmentPurchases([
      {
        id: `installment-${transaction.id}`,
        accountId: transaction.accountId,
        createdAt: editingTransaction?.createdAt ?? now,
        currency: transaction.currency,
        firstDueDate: getNextMonthDueDate(transaction.date),
        installmentCount,
        merchantName: transaction.merchantName,
        monthlyAmount: Math.round(transaction.amount / installmentCount),
        paidInstallments: 0,
        status: 'active',
        totalAmount: transaction.amount,
        transactionId: transaction.id,
        updatedAt: now,
      },
    ]);
  } else {
    await transactionRepository.deleteInstallmentPurchasesByTransactionId(transaction.id);
  }

  if (isCreditCardExpense || editingTransaction?.paymentMethod === 'credit') {
    await reconcileCreditCardTransactions({
      accountRepository,
      creditCardRepository,
      transactionRepository,
    });
  }

  return {
    creditCardTarget,
    isCreditCardExpense,
    transaction,
  };
}
