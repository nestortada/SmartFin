import type { ISODateString } from '../../../shared/types';
import { transactionDateKey } from '../../../shared/utils/transactionDate';
import type { InstallmentPurchase } from '../types';
import {
  buildInstallmentPlan,
  installmentBilledInCycle,
  INSTALLMENT_PLAN_TIME_ZONE,
  type InstallmentPlanIssueCode,
  type InstallmentPlanStatus,
} from './installmentPlan';

/**
 * Phase 1a.2: charges of one billing cycle. Pure: the caller supplies the card's purchases, its
 * installment records, the closing day and the cycle. Debt is never derived from these charges.
 *
 * - singleCharge: purchase without an active multi-installment plan, dated inside the cycle (unchanged).
 * - installmentConfirmed / installmentProjected: the installment the engine assigns to this cycle, in
 *   exact cents; earlier purchases appear in later cycles.
 * - legacyUnverified: the plan cannot be built (no closing day, inexact amount, closing-day purchase
 *   without card policy, zero-cent installments...). The previous rule is kept so that no charge already
 *   recognized disappears: the stored `monthly_amount`, only in the cycle containing the purchase date.
 */
export type StatementChargeSource = 'singleCharge' | 'installmentConfirmed' | 'installmentProjected' | 'legacyUnverified';

export type StatementCharge = {
  transactionId: string;
  amount: number;
  source: StatementChargeSource;
  installmentPosition?: number;
  installmentCount?: number;
};

export type StatementPlanNotice = {
  transactionId: string;
  planStatus: InstallmentPlanStatus;
  reasons: InstallmentPlanIssueCode[];
};

export type StatementChargePurchase = {
  id: string;
  amount: number;
  date: string;
  civilDate?: string;
};

export type StatementChargesParams = {
  closingDay?: number;
  cycleEnd: ISODateString;
  cycleStart: ISODateString;
  installmentsByTransactionId: ReadonlyMap<string, InstallmentPurchase>;
  /** Posted card purchases (expense/outflow, not cancelled), the same candidates as the debt. */
  purchases: readonly StatementChargePurchase[];
};

export type StatementCharges = {
  charges: StatementCharge[];
  /** Plans that cannot be scheduled (purchases up to the cycle end); diagnostic, never a charge. */
  notices: StatementPlanNotice[];
};

function isDateInRange(value: string, start: string, end: string): boolean {
  const date = value.slice(0, 10);
  return date >= start && date <= end;
}

export function statementChargesForCycle({
  closingDay,
  cycleEnd,
  cycleStart,
  installmentsByTransactionId,
  purchases,
}: StatementChargesParams): StatementCharges {
  const charges: StatementCharge[] = [];
  const notices: StatementPlanNotice[] = [];

  for (const purchase of purchases) {
    const date = transactionDateKey(purchase);
    const inCycle = isDateInRange(date, cycleStart, cycleEnd);
    const installment = installmentsByTransactionId.get(purchase.id);
    if (!installment || installment.installmentCount <= 1 || installment.status !== 'active') {
      if (inCycle) charges.push({ transactionId: purchase.id, amount: purchase.amount, source: 'singleCharge' });
      continue;
    }

    // The principal is the purchase itself (the amount the debt counts), never the rounded monthly amount.
    const plan = buildInstallmentPlan({
      purchaseId: purchase.id,
      principal: { kind: 'storedAmount', amount: purchase.amount },
      installmentCount: installment.installmentCount,
      purchaseDate: date,
      timeZone: INSTALLMENT_PLAN_TIME_ZONE,
      billing: { closingDay },
    });
    if (plan.isComplete) {
      const item = installmentBilledInCycle(plan, cycleEnd);
      if (item) {
        charges.push({
          transactionId: purchase.id,
          amount: item.amountCents! / 100 + 0,
          source: plan.isConfirmed ? 'installmentConfirmed' : 'installmentProjected',
          installmentPosition: item.position,
          installmentCount: plan.installmentCount,
        });
      }
      continue;
    }

    if (date <= cycleEnd) {
      notices.push({ transactionId: purchase.id, planStatus: plan.status, reasons: plan.issues.map(entry => entry.code) });
    }
    if (inCycle) {
      charges.push({ transactionId: purchase.id, amount: installment.monthlyAmount, source: 'legacyUnverified' });
    }
  }

  return { charges, notices };
}
