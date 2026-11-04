import { toExactCopCents } from '../../../shared/utils/exactCopCents';
import type {
  InstallmentAllocation,
  InstallmentPlanPendingReason,
  InstallmentPlanRevision,
  NewInstallmentPlanRevision,
} from '../types/InstallmentHistory';

/**
 * Phase 1a.4B: estimated pending principal of an installment purchase and the revisions an `unspecified` allocation
 * and its reversal append. Pure; integer cents only; no clock, SQLite or legacy `monthly_amount`.
 *
 * The estimate starts at the anchor, the latest revision of the current incarnation that states the principal on its
 * own: `original`, `purchaseEdit` (its principal is the new legacy total, converted exactly) or any `confirmed`
 * revision (a statement or the user). An unconfirmed statement after the anchor leaves the estimate undetermined. Active allocations recorded after the anchor are subtracted; those recorded before a confirmed
 * anchor are already reflected by it. It is an estimate, never a bank figure: the bank may apply a payment
 * differently, and a card's total debt is not the sum of its purchases' principals (no R9).
 */
export type PrincipalUndeterminedReason =
  | 'noHistory'
  | 'purchaseRemoved'
  | 'unknownPrincipal'
  | 'statementAdjustmentRequired'
  /** A statement revision that is not confirmed: its figures cannot anchor an estimate. */
  | 'unconfirmedStatement'
  | 'inconsistentHistory';

export type PrincipalEstimate =
  | {
      status: 'determined';
      principalCents: number;
      anchor: InstallmentPlanRevision;
      /** Active allocations subtracted from the anchor, with the revision that recorded each. */
      appliedAllocations: { allocation: InstallmentAllocation; revision: InstallmentPlanRevision }[];
    }
  | { status: 'undetermined'; reason: PrincipalUndeterminedReason };

function currentIncarnation(history: readonly InstallmentPlanRevision[]): InstallmentPlanRevision[] | undefined {
  const ordered = [...history].sort((left, right) => left.revisionNumber - right.revisionNumber);
  if (ordered.some((revision, index) => revision.revisionNumber !== index ||
      revision.installmentPurchaseId !== ordered[0]!.installmentPurchaseId)) return undefined;
  let start = -1;
  ordered.forEach((revision, index) => {
    if (revision.source === 'original') start = index;
  });
  return start === -1 ? [] : ordered.slice(start);
}

const isAnchor = (revision: InstallmentPlanRevision) => revision.verification === 'confirmed' ||
  revision.source === 'original' || revision.source === 'purchaseEdit';

function anchorPrincipal(anchor: InstallmentPlanRevision): number | null {
  if (anchor.source !== 'purchaseEdit') return anchor.remainingPrincipalCents;
  // The trigger stores no principal for an edit; the new terms are its raw legacy basis.
  const total = anchor.basis?.totalAmount;
  if (typeof total !== 'number' || !(total > 0)) return null;
  return toExactCopCents(total) ?? null;
}

export function estimatePendingPrincipal(
  history: readonly InstallmentPlanRevision[],
  allocations: readonly InstallmentAllocation[],
): PrincipalEstimate {
  const incarnation = currentIncarnation(history);
  if (!incarnation) return { status: 'undetermined', reason: 'inconsistentHistory' };
  if (incarnation.length === 0) return { status: 'undetermined', reason: 'noHistory' };
  if (incarnation[incarnation.length - 1]!.source === 'purchaseRemoval') return { status: 'undetermined', reason: 'purchaseRemoved' };
  const anchor = [...incarnation].reverse().find(isAnchor)!;
  const afterAnchor = incarnation.filter(revision => revision.revisionNumber > anchor.revisionNumber);
  if (afterAnchor.some(revision => revision.pendingReasons.includes('statementAdjustmentRequired')))
    return { status: 'undetermined', reason: 'statementAdjustmentRequired' };
  if (afterAnchor.some(revision => revision.source === 'statement')) return { status: 'undetermined', reason: 'unconfirmedStatement' };
  const base = anchorPrincipal(anchor);
  if (base === null) return { status: 'undetermined', reason: 'unknownPrincipal' };
  const appliedAllocations: { allocation: InstallmentAllocation; revision: InstallmentPlanRevision }[] = [];
  let principalCents = base;
  for (const allocation of allocations) {
    if (allocation.status !== 'active') continue;
    if (allocation.installmentPurchaseId !== anchor.installmentPurchaseId)
      return { status: 'undetermined', reason: 'inconsistentHistory' };
    const revision = incarnation.find(candidate => candidate.source === 'allocation' && candidate.allocationId === allocation.id);
    // An active allocation without its revision in the current plan cannot be placed: never guessed.
    if (!revision) return { status: 'undetermined', reason: 'inconsistentHistory' };
    if (revision.revisionNumber < anchor.revisionNumber) continue;
    principalCents -= allocation.amountCents;
    appliedAllocations.push({ allocation, revision });
  }
  if (!Number.isSafeInteger(principalCents) || principalCents < 0) return { status: 'undetermined', reason: 'inconsistentHistory' };
  return { status: 'determined', principalCents, anchor, appliedAllocations };
}

const sortedReasons = (reasons: InstallmentPlanPendingReason[]) => [...new Set(reasons)].sort();

/**
 * Revision appended with an `unspecified` allocation: the estimated principal after it, the scheduled count unchanged
 * (nothing is inferred about which installments the bank settled), no installment amount and no cycle, pending until a
 * statement shows the result. A zero estimate is recorded as such; the purchase status is never changed.
 */
export function buildAllocationRevision({
  allocation,
  estimateAfter,
  anchor,
  createdAt,
}: {
  allocation: Pick<InstallmentAllocation, 'id' | 'installmentPurchaseId'>;
  estimateAfter: number;
  anchor: InstallmentPlanRevision;
  createdAt: string;
}): NewInstallmentPlanRevision {
  return {
    installmentPurchaseId: allocation.installmentPurchaseId,
    source: 'allocation',
    allocationId: allocation.id,
    remainingPrincipalCents: estimateAfter,
    remainingInstallments: anchor.remainingInstallments,
    installmentAmountCents: null,
    effectiveCycleEnd: null,
    verification: 'pendingVerification',
    pendingReasons: sortedReasons(['allocationUnconfirmed', ...(estimateAfter === 0 ? ['estimatedPrincipalZero' as const] : [])]),
    createdAt,
  };
}

/**
 * D6 corrective revision for a reversed allocation. Always pending: a reversal is never a bank confirmation.
 * - A confirmed revision recorded after the allocation: start from the latest one, never restore the plan from before
 *   the allocation, and flag the adjustment that only a statement can make.
 * - Otherwise the estimate without the allocation; when no other allocation stays applied, the projection of the
 *   anchor (installments, installment amount and cycle) is restored as well.
 */
export function buildAllocationReversalRevision({
  allocation,
  allocationRevision,
  history,
  estimateAfter,
  createdAt,
}: {
  allocation: Pick<InstallmentAllocation, 'id' | 'installmentPurchaseId'>;
  allocationRevision: InstallmentPlanRevision | undefined;
  history: readonly InstallmentPlanRevision[];
  estimateAfter: PrincipalEstimate;
  createdAt: string;
}): NewInstallmentPlanRevision {
  const laterConfirmed = allocationRevision ? [...history]
    .filter(revision => revision.revisionNumber > allocationRevision.revisionNumber && revision.verification === 'confirmed')
    .sort((left, right) => left.revisionNumber - right.revisionNumber)
    .pop() : undefined;
  const common = {
    installmentPurchaseId: allocation.installmentPurchaseId,
    source: 'allocationReversal' as const,
    allocationId: allocation.id,
    verification: 'pendingVerification' as const,
    createdAt,
  };
  if (laterConfirmed) {
    return {
      ...common,
      remainingPrincipalCents: estimateAfter.status === 'determined' ? estimateAfter.principalCents : laterConfirmed.remainingPrincipalCents,
      remainingInstallments: laterConfirmed.remainingInstallments,
      installmentAmountCents: laterConfirmed.installmentAmountCents,
      effectiveCycleEnd: laterConfirmed.effectiveCycleEnd,
      pendingReasons: sortedReasons(['allocationReversed', 'statementAdjustmentRequired']),
    };
  }
  if (estimateAfter.status !== 'determined') {
    return {
      ...common,
      remainingPrincipalCents: null,
      remainingInstallments: null,
      installmentAmountCents: null,
      effectiveCycleEnd: null,
      pendingReasons: sortedReasons(['allocationReversed',
        estimateAfter.reason === 'statementAdjustmentRequired' ? 'statementAdjustmentRequired' : 'manualReview']),
    };
  }
  const { anchor, principalCents, appliedAllocations } = estimateAfter;
  const restored = appliedAllocations.length === 0;
  return {
    ...common,
    remainingPrincipalCents: principalCents,
    remainingInstallments: anchor.remainingInstallments,
    installmentAmountCents: restored ? anchor.installmentAmountCents : null,
    effectiveCycleEnd: restored ? anchor.effectiveCycleEnd : null,
    pendingReasons: sortedReasons([
      'allocationReversed',
      ...(allocationRevision ? [] : ['manualReview' as const]),
      ...(restored ? anchor.pendingReasons : ['allocationUnconfirmed' as const]),
      ...(!restored && principalCents === 0 ? ['estimatedPrincipalZero' as const] : []),
    ]),
  };
}
