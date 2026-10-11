// Frozen phase 0 implementation for historical characterization only.
import type { Account } from '../../src/modules/accounts';
import type { SqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import type { CreditCardRepository } from '../../src/modules/creditCards/repositories';
import type { InstallmentPurchase } from '../../src/modules/creditCards/types';
import {
  reconcileCreditCardTransactions,
  resolveCreditCardTransactionTarget,
  type ResolveCreditCardTransactionTargetResult,
} from '../../src/modules/creditCards/useCases';
import type { SqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import type { Transaction, TransactionType } from '../../src/modules/transactions/types';

export type ManualTransactionOperationType = 'Débito' | 'Crédito';

type ManualAccountRepository = Pick<SqliteAccountRepository, 'getAccounts' | 'saveAccounts'>;

type ManualTransactionRepository = Pick<
  SqliteTransactionRepository,
  'deleteInstallmentPurchasesByTransactionId' | 'deleteTransaction' | 'getTransactions' | 'saveTransactions'
>;

export type SaveManualTransactionParams = {
  accountId?: string;
  accountRepository: ManualAccountRepository;
  accounts: Account[];
  amount: number;
  categoryId?: string;
  subcategoryId?: string;
  creditCardHint?: string;
  creditCardRepository: CreditCardRepository;
  currentDate?: Date;
  transactionDate?: Date | string;
  now?: Date;
  dedupeKey?: string;
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
  transferTaxCharged?: boolean;
};

export type SaveManualTransactionResult = {
  creditCardTarget: ResolveCreditCardTransactionTargetResult;
  isCreditCardExpense: boolean;
  transaction: Transaction;
  transactions: Transaction[];
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

function buildTransferCompanionTransaction({
  now,
  sourceTransaction,
}: {
  now: string;
  sourceTransaction: Transaction;
}): Transaction {
  return {
    ...sourceTransaction,
    id: `${sourceTransaction.id}-in`,
    accountId: sourceTransaction.targetAccountId as string,
    description: `Entrada: ${sourceTransaction.description}`,
    direction: 'inflow',
    merchantName: `Entrada: ${sourceTransaction.merchantName ?? sourceTransaction.description}`,
    notes: sourceTransaction.notes?.replace('Transferencia', 'Entrada transferencia'),
    targetAccountId: sourceTransaction.accountId,
    updatedAt: now,
  };
}

function buildTransferTaxTransaction({
  now,
  sourceTransaction,
}: {
  now: string;
  sourceTransaction: Transaction;
}): Transaction {
  const taxAmount = Math.max(1, Math.round(sourceTransaction.amount * 0.004));

  return {
    id: `${sourceTransaction.id}-4x1000`,
    accountId: sourceTransaction.accountId,
    amount: taxAmount,
    createdAt: sourceTransaction.createdAt,
    currency: sourceTransaction.currency,
    date: sourceTransaction.date,
    description: 'Impuesto 4x1000',
    direction: 'outflow',
    merchantName: 'Impuesto 4x1000',
    notes: 'DÃ©bito â€¢ Cobro 4x1000 por transferencia',
    paymentMethod: 'debit',
    status: sourceTransaction.status,
    type: 'expense',
    updatedAt: now,
  };
}

export function getNextMonthDueDate(fromDate: string): string {
  const dueDate = new Date(fromDate);
  dueDate.setMonth(dueDate.getMonth() + 1);
  return dueDate.toISOString();
}

export async function saveTransactionInstallments({
  creditCardRepository,
  transactionRepository,
  transaction,
  installmentCount,
  previousTransaction,
}: {
  creditCardRepository: CreditCardRepository;
  transactionRepository: ManualTransactionRepository;
  transaction: Transaction;
  installmentCount: number;
  previousTransaction?: Transaction | null;
}): Promise<void> {
  if (transaction.paymentMethod !== 'credit' || installmentCount <= 1) {
    await transactionRepository.deleteInstallmentPurchasesByTransactionId(transaction.id);
    return;
  }
  const existing = previousTransaction
    ? (await creditCardRepository.getInstallmentPurchases([previousTransaction.accountId]))
      .find(purchase => purchase.transactionId === transaction.id)
    : undefined;
  const unchangedTerms = existing && existing.installmentCount === installmentCount &&
    existing.totalAmount === transaction.amount && existing.currency === transaction.currency;
  const purchase: InstallmentPurchase = {
    id: existing?.id ?? `installment-${transaction.id}`,
    accountId: transaction.accountId,
    createdAt: existing?.createdAt ?? transaction.createdAt,
    currency: transaction.currency,
    firstDueDate: unchangedTerms && previousTransaction?.date === transaction.date
      ? existing.firstDueDate : getNextMonthDueDate(transaction.date),
    installmentCount,
    merchantName: transaction.merchantName,
    monthlyAmount: unchangedTerms ? existing.monthlyAmount : Math.round(transaction.amount / installmentCount),
    paidInstallments: unchangedTerms ? existing.paidInstallments : 0,
    status: unchangedTerms ? existing.status : 'active',
    totalAmount: transaction.amount,
    transactionId: transaction.id,
    updatedAt: transaction.updatedAt,
  };
  await creditCardRepository.saveInstallmentPurchases([purchase]);
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
    subcategoryId,
    creditCardHint,
    creditCardRepository,
    currentDate = new Date(),
    transactionDate,
    now: requestedNow,
    dedupeKey,
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
    transferTaxCharged = false,
  } = params;
  const isCreditCardExpense =
    transactionType !== 'income' &&
    transactionType !== 'internalTransfer' &&
    transactionType !== 'creditCardPayment' &&
    isCreditOperation(operationType);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Monto invÃ¡lido.');
  }

  const nowDate = requestedNow ?? currentDate;
  const now = nowDate.toISOString();
  const effectiveTransactionDate = transactionDate instanceof Date
    ? transactionDate.toISOString()
    : transactionDate ?? editingTransaction?.date ?? currentDate.toISOString();
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
    subcategoryId: subcategoryId || undefined,
    createdAt: editingTransaction?.createdAt ?? now,
    creditCardHint: isCreditCardExpense ? creditCardTarget.creditCardHint : undefined,
    currency: editingTransaction?.currency ?? 'COP',
    date: effectiveTransactionDate,
    description: editingTransaction && merchantName === (editingTransaction.merchantName ?? editingTransaction.description)
      ? editingTransaction.description : merchantName,
    dedupeKey: dedupeKey ?? editingTransaction?.dedupeKey,
    direction: editingTransaction?.type === transactionType
      ? editingTransaction.direction : getTransactionDirection(transactionType),
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
    targetAccountId: transactionType === 'internalTransfer' ? requestedTargetAccountId
      : transactionType === 'creditCardPayment'
        ? requestedTargetAccountId ?? editingTransaction?.targetAccountId : undefined,
    type: transactionType,
    updatedAt: now,
  };

  const accountUpdates = new Map<string, Account>();
  let existingTransferTax: Transaction | undefined;

  if (editingTransaction) {
    applyTransactionImpact({
      accounts,
      accountUpdates,
      multiplier: -1,
      transaction: editingTransaction,
    });

    if (editingTransaction.type === 'internalTransfer') {
      const transactions = await transactionRepository.getTransactions();
      existingTransferTax = transactions.find(
        candidate => candidate.id === `${editingTransaction.id}-4x1000`,
      );
      if (existingTransferTax) {
        applyTransactionImpact({
          accounts,
          accountUpdates,
          multiplier: -1,
          transaction: existingTransferTax,
        });
      }
    }
  }

  applyTransactionImpact({
    accounts,
    accountUpdates,
    multiplier: 1,
    transaction,
  });

  const companionTransaction = transaction.type === 'internalTransfer'
    ? buildTransferCompanionTransaction({ now, sourceTransaction: transaction })
    : undefined;
  const transferTaxTransaction = transaction.type === 'internalTransfer' && transferTaxCharged
    ? buildTransferTaxTransaction({ now, sourceTransaction: transaction })
    : undefined;

  if (transferTaxTransaction) {
    applyTransactionImpact({
      accounts,
      accountUpdates,
      multiplier: 1,
      transaction: transferTaxTransaction,
    });
  }

  if (accountUpdates.size > 0) {
    await accountRepository.saveAccounts(Array.from(accountUpdates.values()));
  }

  const transactionsToSave = [
    transaction,
    ...(companionTransaction ? [companionTransaction] : []),
    ...(transferTaxTransaction ? [transferTaxTransaction] : []),
  ];

  await transactionRepository.saveTransactions(transactionsToSave);

  if (editingTransaction?.type === 'internalTransfer' && transaction.type !== 'internalTransfer') {
    await transactionRepository.deleteTransaction(`${editingTransaction.id}-in`);
  }

  if (existingTransferTax && !transferTaxTransaction) {
    await transactionRepository.deleteTransaction(existingTransferTax.id);
  }

  await saveTransactionInstallments({
    creditCardRepository, transactionRepository, transaction,
    installmentCount: isCreditCardExpense ? installmentCount : 1,
    previousTransaction: editingTransaction,
  });

  if (isCreditCardExpense || editingTransaction?.paymentMethod === 'credit' ||
      transaction.type === 'creditCardPayment' || editingTransaction?.type === 'creditCardPayment') {
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
    transactions: transactionsToSave,
  };
}

export type DeleteManualTransactionParams = {
  accountRepository: ManualAccountRepository;
  accounts: Account[];
  creditCardRepository: CreditCardRepository;
  transaction: Transaction;
  transactionRepository: ManualTransactionRepository;
};

export async function deleteManualTransactionSafely({
  accountRepository,
  accounts,
  creditCardRepository,
  transaction,
  transactionRepository,
}: DeleteManualTransactionParams): Promise<void> {
  const allTransactions = await transactionRepository.getTransactions();
  const accountUpdates = new Map<string, Account>();
  applyTransactionImpact({
    accounts,
    accountUpdates,
    multiplier: -1,
    transaction,
  });

  const transferTax = transaction.type === 'internalTransfer'
    ? allTransactions.find(candidate => candidate.id === `${transaction.id}-4x1000`)
    : undefined;
  if (transferTax) {
    applyTransactionImpact({
      accounts,
      accountUpdates,
      multiplier: -1,
      transaction: transferTax,
    });
  }

  if (accountUpdates.size > 0) {
    await accountRepository.saveAccounts(Array.from(accountUpdates.values()));
  }

  await transactionRepository.deleteTransaction(`${transaction.id}-in`);
  await transactionRepository.deleteTransaction(`${transaction.id}-4x1000`);
  await transactionRepository.deleteInstallmentPurchasesByTransactionId(transaction.id);
  await transactionRepository.deleteTransaction(transaction.id);

  if (transaction.paymentMethod === 'credit' || transaction.type === 'creditCardPayment') {
    await reconcileCreditCardTransactions({
      accountRepository,
      creditCardRepository,
      transactionRepository,
    });
  }
}
