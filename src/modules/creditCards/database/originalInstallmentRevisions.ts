import type { SQLitePrimitive, SQLiteRow } from '../../../database/sqliteRows';
import { toExactCopCents } from '../../../shared/utils/exactCopCents';
import { MAX_INSTALLMENT_COUNT } from '../useCases/installmentPlan';
import type { InstallmentPlanPendingReason } from '../types/InstallmentHistory';

/**
 * Migration 5: revision 0 of an existing purchase = the plan terms known when migrating, not a reconstruction
 * of its history. Amounts are converted with `toExactCopCents` and stored as NULL when inexact (never
 * rounded); the raw legacy values are kept in `basis_*`. The purchase row, its movement and every balance
 * are left untouched. The first cycle was never confirmed before migration 5, so no revision is confirmed
 * or projected and `effective_cycle_end` stays NULL. `paid_installments` is legacy and is not read.
 */
export type OriginalInstallmentRevision = {
  id: string;
  installmentPurchaseId: string;
  remainingPrincipalCents: number | null;
  remainingInstallments: number | null;
  installmentAmountCents: number | null;
  pendingReasons: InstallmentPlanPendingReason[];
  basis: { totalAmount: SQLitePrimitive; monthlyAmount: SQLitePrimitive; installmentCount: SQLitePrimitive };
};

function exactCents(value: SQLitePrimitive): number | undefined {
  return typeof value === 'number' ? toExactCopCents(value) : undefined;
}

export function buildOriginalInstallmentRevision(row: SQLiteRow): OriginalInstallmentRevision {
  const id = row.id;
  if (typeof id !== 'string' || id.length === 0) throw new Error('Compra a cuotas sin identificador válido.');
  const reasons = new Set<InstallmentPlanPendingReason>(['firstCycleUnconfirmed']);

  const principal = exactCents(row.total_amount ?? null);
  if (principal === undefined) reasons.add('inexactHistoricalAmount');
  else if (principal <= 0) reasons.add('invalidPrincipal');

  const installment = exactCents(row.monthly_amount ?? null);
  if (installment === undefined || installment < 0) reasons.add('inexactInstallmentAmount');

  const count = row.installment_count;
  const validCount =
    typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= MAX_INSTALLMENT_COUNT ? count : undefined;
  if (validCount === undefined) reasons.add('invalidInstallmentCount');

  return {
    id: `${id}:revision:0`,
    installmentPurchaseId: id,
    remainingPrincipalCents: principal !== undefined && principal > 0 ? principal : null,
    remainingInstallments: validCount ?? null,
    installmentAmountCents: installment !== undefined && installment >= 0 ? installment : null,
    pendingReasons: [...reasons].sort(),
    basis: {
      totalAmount: row.total_amount ?? null,
      monthlyAmount: row.monthly_amount ?? null,
      installmentCount: row.installment_count ?? null,
    },
  };
}

export function originalInstallmentRevisionValues(revision: OriginalInstallmentRevision): SQLitePrimitive[] {
  return [
    revision.id,
    revision.installmentPurchaseId,
    revision.remainingPrincipalCents,
    revision.remainingInstallments,
    revision.installmentAmountCents,
    revision.pendingReasons.join(','),
    revision.basis.totalAmount,
    revision.basis.monthlyAmount,
    revision.basis.installmentCount,
  ];
}
