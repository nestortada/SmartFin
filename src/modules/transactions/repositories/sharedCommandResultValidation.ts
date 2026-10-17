import type { SharedCommandResult } from '../types/SharedExpense';
import { validateTransactionDateFields } from '../../../shared/utils/transactionDate';
import type { Transaction } from '../types';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validTransaction(value: unknown): boolean {
  if (!record(value)) return false;
  if (
    !['id', 'description', 'date', 'accountId', 'createdAt', 'updatedAt'].every(
      key => typeof value[key] === 'string',
    ) ||
    typeof value.amount !== 'number' ||
    !Number.isFinite(value.amount) ||
    value.amount < 0 ||
    value.currency !== 'COP' ||
    ![
      'income',
      'expense',
      'internalTransfer',
      'creditCardPayment',
      'loanPayment',
      'investment',
      'refund',
      'manualAdjustment',
    ].includes(String(value.type)) ||
    !['inflow', 'outflow', 'neutral'].includes(String(value.direction)) ||
    !['posted', 'pending', 'cancelled'].includes(String(value.status))
  )
    return false;
  for (const key of [
    'categoryId',
    'subcategoryId',
    'targetAccountId',
    'merchantName',
    'creditCardHint',
    'dedupeKey',
    'notes',
  ])
    if (value[key] !== undefined && typeof value[key] !== 'string')
      return false;
  if (
    value.paymentMethod !== undefined &&
    !['debit', 'credit'].includes(String(value.paymentMethod))
  )
    return false;
  for (const key of ['civilDate', 'localTime', 'timeZone', 'datePrecision'])
    if (value[key] !== undefined && typeof value[key] !== 'string')
      return false;
  try {
    validateTransactionDateFields(value as Transaction);
  } catch {
    return false;
  }
  return true;
}

export function readSharedCommandResult(json: string): SharedCommandResult {
  const value: unknown = JSON.parse(json);
  const invalid = () => new Error('Resultado de comando inválido.');
  if (
    !record(value) ||
    typeof value.entityId !== 'string' ||
    (value.transaction !== undefined && !validTransaction(value.transaction)) ||
    (value.transactions !== undefined &&
      (!Array.isArray(value.transactions) ||
        !value.transactions.every(validTransaction))) ||
    (value.deletedTransactionIds !== undefined &&
      (!Array.isArray(value.deletedTransactionIds) ||
        !value.deletedTransactionIds.every(id => typeof id === 'string')))
  )
    throw invalid();
  if (value.effects !== undefined) {
    const effects = value.effects;
    if (
      record(effects) &&
      effects.recognizedLossDelta !== undefined &&
      (typeof effects.recognizedLossDelta !== 'number' ||
        !Number.isFinite(effects.recognizedLossDelta))
    )
      throw invalid();
    if (
      !record(effects) ||
      !Array.isArray(effects.accounts) ||
      !effects.accounts.every(
        (account: unknown) =>
          record(account) &&
          typeof account.accountId === 'string' &&
          typeof account.balanceDelta === 'number' &&
          Number.isFinite(account.balanceDelta) &&
          typeof account.debtDelta === 'number' &&
          Number.isFinite(account.debtDelta),
      )
    )
      throw invalid();
    for (const key of [
      'availableDelta',
      'debtDelta',
      'netWorthDelta',
      'receivableDelta',
      'thirdPartyAdvanceDelta',
      'personalIncomeDelta',
      'personalExpenseDelta',
      'bankInflowDelta',
      'bankOutflowDelta',
    ]) {
      if (typeof effects[key] !== 'number' || !Number.isFinite(effects[key]))
        throw invalid();
    }
  }
  return value as SharedCommandResult;
}
