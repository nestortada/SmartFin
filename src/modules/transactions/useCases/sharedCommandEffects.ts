import type { Account } from '../../accounts/types/Account';
import type { SharedEffectTransaction } from '../repositories/SharedExpenseRepository';
import { lossMinor, forgivenMinor } from './sharedLossDomain';
import type {
  SharedExpenseState,
  SharedFinancialEffects,
} from '../types/SharedExpense';
import {
  getPersonalFinancialEntries,
  getSharedFinancialPosition,
  allocatedToParticipation,
  availableReceipt,
  sumMinor,
} from './sharedExpenseDomain';

export const SHARED_EFFECT_CONTRIBUTIONS = {
  income: 1,
  expense: 2,
  bankInflow: 4,
  bankOutflow: 8,
} as const;

export function sharedFinancialSnapshot(
  accounts: Account[],
  transactions: SharedEffectTransaction[],
  state: SharedExpenseState,
) {
  const active = accounts.filter(a => a.status === 'active');
  const liquid = (a: Account) =>
    ['cash', 'bankAccount', 'savingsAccount'].includes(a.type);
  const available = active
    .filter(liquid)
    .reduce((sum, a) => sum + a.balance.amount, 0);
  const assets = active
    .filter(a => liquid(a) || a.type === 'investment')
    .reduce((sum, a) => sum + a.balance.amount, 0);
  const debt = active
    .filter(a => ['creditCard', 'loan'].includes(a.type))
    .reduce((sum, a) => sum + (a.debtBalance?.amount ?? 0), 0);
  const position = getSharedFinancialPosition(state);
  const activeExpenseIds = new Set(
    state.expenses.filter(e => e.status === 'active').map(e => e.id),
  );
  const receivableMinor = sumMinor(
    state.participations
      .filter(p => p.active && p.contactId && activeExpenseIds.has(p.expenseId))
      .map(
        p =>
          p.amountMinor -
          allocatedToParticipation(state, p.id) -
          forgivenMinor(state, p.id),
      ),
  );
  const advanceMinor = sumMinor(
    state.receipts
      .filter(r => r.status === 'active')
      .map(r => availableReceipt(state, r.id)),
  );
  const contribution = (t: SharedEffectTransaction) => {
    if ('contribution' in t) return t.contribution;
    if (t.status !== 'posted') return 0;
    const bank =
      t.paymentMethod !== 'credit' &&
      accounts.some(a => a.id === t.accountId && liquid(a));
    return (
      (t.type === 'income' && t.direction === 'inflow'
        ? SHARED_EFFECT_CONTRIBUTIONS.income
        : t.type === 'expense' && t.direction === 'outflow'
        ? SHARED_EFFECT_CONTRIBUTIONS.expense
        : 0) +
      (bank
        ? t.direction === 'inflow'
          ? SHARED_EFFECT_CONTRIBUTIONS.bankInflow
          : t.direction === 'outflow'
          ? SHARED_EFFECT_CONTRIBUTIONS.bankOutflow
          : 0
        : 0)
    );
  };
  const includes = (t: SharedEffectTransaction, flag: number) =>
    Math.floor(contribution(t) / flag) % 2 === 1;
  const personal = getPersonalFinancialEntries(
    transactions.filter(
      t =>
        includes(t, SHARED_EFFECT_CONTRIBUTIONS.income) ||
        includes(t, SHARED_EFFECT_CONTRIBUTIONS.expense),
    ),
    state,
  );
  const income = personal
    .filter(t => includes(t, SHARED_EFFECT_CONTRIBUTIONS.income))
    .reduce((sum, t) => sum + t.amount, 0);
  const expense = personal
    .filter(t => includes(t, SHARED_EFFECT_CONTRIBUTIONS.expense))
    .reduce((sum, t) => sum + t.amount, 0);
  return {
    accounts,
    available,
    assets,
    debt,
    netWorth:
      assets - debt + position.receivables - position.thirdPartyAdvances,
    receivable: position.receivables,
    advance: position.thirdPartyAdvances,
    income,
    expense,
    lossMinor: lossMinor(state.lossEvents),
    receivableMinor,
    advanceMinor,
    bankInflow: transactions
      .filter(t => includes(t, SHARED_EFFECT_CONTRIBUTIONS.bankInflow))
      .reduce((sum, t) => sum + t.amount, 0),
    bankOutflow: transactions
      .filter(t => includes(t, SHARED_EFFECT_CONTRIBUTIONS.bankOutflow))
      .reduce((sum, t) => sum + t.amount, 0),
  };
}

export function sharedFinancialEffects(
  before: ReturnType<typeof sharedFinancialSnapshot>,
  after: ReturnType<typeof sharedFinancialSnapshot>,
): SharedFinancialEffects {
  const accounts = after.accounts
    .map(account => {
      const previous = before.accounts.find(a => a.id === account.id);
      return {
        accountId: account.id,
        balanceDelta: account.balance.amount - (previous?.balance.amount ?? 0),
        debtDelta:
          (account.debtBalance?.amount ?? 0) -
          (previous?.debtBalance?.amount ?? 0),
      };
    })
    .filter(a => a.balanceDelta !== 0 || a.debtDelta !== 0);
  const receivableDeltaMinor = after.receivableMinor - before.receivableMinor;
  const advanceDeltaMinor = after.advanceMinor - before.advanceMinor;
  const positionDelta =
    BigInt(receivableDeltaMinor) - BigInt(advanceDeltaMinor);
  if (
    positionDelta > BigInt(Number.MAX_SAFE_INTEGER) ||
    positionDelta < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error('Efecto financiero fuera del rango seguro.');
  return {
    accounts,
    availableDelta: after.available - before.available,
    debtDelta: after.debt - before.debt,
    netWorthDelta:
      after.assets -
      before.assets -
      (after.debt - before.debt) +
      Number(positionDelta) / 100,
    receivableDelta: receivableDeltaMinor / 100,
    thirdPartyAdvanceDelta: advanceDeltaMinor / 100,
    personalIncomeDelta: after.income - before.income,
    personalExpenseDelta: after.expense - before.expense,
    bankInflowDelta: after.bankInflow - before.bankInflow,
    bankOutflowDelta: after.bankOutflow - before.bankOutflow,
    recognizedLossDelta: (after.lossMinor - before.lossMinor) / 100,
  };
}
