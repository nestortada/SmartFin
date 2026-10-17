// Frozen pre-phase-3A payment boundary, exclusively for historic characterization.
import { reconcileCreditCardTransactions, type RegisterCreditCardPaymentParams, type RegisterCreditCardPaymentResult } from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import type { Transaction } from '../../src/modules/transactions/types';
import type { Account } from '../../src/modules/accounts/types';
function isRealCreditCardAccount(account: Account) { return account.type === 'creditCard' && account.status === 'active'; }
function isPaymentSourceAccount(account: Account) { return account.status === 'active' && ['cash', 'bankAccount', 'savingsAccount'].includes(account.type); }

export async function registerCreditCardPayment({
  accountId,
  accountRepository,
  amount,
  creditCardRepository,
  currentDate = new Date(),
  sourceAccountId,
  transactionRepository,
}: RegisterCreditCardPaymentParams): Promise<RegisterCreditCardPaymentResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Ingresa un monto valido para el pago de la tarjeta.');
  }

  await reconcileCreditCardTransactions({
    accountRepository,
    creditCardRepository,
    currentDate,
    transactionRepository,
  });

  const accounts = await accountRepository.getAccounts();
  const card = accounts.find(account => account.id === accountId && isRealCreditCardAccount(account));
  const sourceAccount = accounts.find(account => account.id === sourceAccountId && isPaymentSourceAccount(account));

  if (!card) {
    throw new Error('Selecciona una tarjeta de credito activa.');
  }

  if (!sourceAccount) {
    throw new Error('Selecciona una cuenta origen activa para registrar el pago.');
  }

  const previousDebt = Math.max(card.debtBalance?.amount ?? 0, 0);
  if (previousDebt <= 0) {
    throw new Error('La tarjeta no tiene saldo pendiente por pagar.');
  }

  const paidAmount = Math.min(Math.round(amount), previousDebt);
  if (sourceAccount.balance.amount < paidAmount) {
    throw new Error('La cuenta origen no tiene saldo suficiente para ese pago.');
  }

  const now = currentDate.toISOString();
  const transaction: Transaction = {
    id: `tx-credit-card-payment-${card.id}-${Date.now()}`,
    accountId: sourceAccount.id,
    amount: paidAmount,
    createdAt: now,
    currency: card.currency,
    date: now,
    description: `Pago de tarjeta de credito - ${card.name}`,
    direction: 'outflow',
    merchantName: card.name,
    notes: 'Pago de tarjeta de credito. No cuenta como gasto del mes.',
    paymentMethod: 'debit',
    status: 'posted',
    targetAccountId: card.id,
    type: 'creditCardPayment',
    updatedAt: now,
  };

  await accountRepository.saveAccounts([
    {
      ...sourceAccount,
      balance: {
        ...sourceAccount.balance,
        amount: sourceAccount.balance.amount - paidAmount,
      },
      updatedAt: now,
    },
  ]);
  await transactionRepository.saveTransactions([transaction]);
  await reconcileCreditCardTransactions({
    accountRepository,
    creditCardRepository,
    currentDate,
    transactionRepository,
  });

  return {
    paidAmount,
    previousDebt,
    remainingDebt: Math.max(previousDebt - paidAmount, 0),
    transaction,
  };
}
