import type { InstallmentPlanRevision } from '../types/InstallmentHistory';
import type { CivilDate } from './installmentPlan';

/**
 * Phase 1a.3B: which stored revision describes a purchase's plan. Pure; no allocation or amortization math.
 *
 * Only the latest incarnation counts: a `purchaseRemoval` ends the history of a deleted purchase, and a
 * purchase recreated with the same id starts again with an `original` revision. Within it, the highest
 * revision whose effective cycle has started applies. A revision without a known effective cycle applies
 * from the moment it was recorded (its verification says how reliable it is); revisions effective in a
 * later cycle are reported as `scheduled`, not applied.
 */
export type EffectivePlanRevision =
  | { status: 'none' }
  | { status: 'removed'; revision: InstallmentPlanRevision }
  | { status: 'current'; revision: InstallmentPlanRevision; scheduled: InstallmentPlanRevision[] };

export function selectEffectivePlanRevision(
  history: readonly InstallmentPlanRevision[],
  cycleEnd?: CivilDate,
): EffectivePlanRevision {
  const ordered = [...history].sort((left, right) => left.revisionNumber - right.revisionNumber);
  ordered.forEach((revision, index) => {
    if (revision.revisionNumber !== index || revision.installmentPurchaseId !== ordered[0]!.installmentPurchaseId)
      throw new Error('Historial de revisiones incompleto o mezclado.');
  });
  let start = -1;
  ordered.forEach((revision, index) => {
    if (revision.source === 'original') start = index;
  });
  if (start === -1) return { status: 'none' };
  const incarnation = ordered.slice(start);
  const latest = incarnation[incarnation.length - 1]!;
  if (latest.source === 'purchaseRemoval') return { status: 'removed', revision: latest };

  const started = (revision: InstallmentPlanRevision) =>
    cycleEnd === undefined || revision.effectiveCycleEnd === null || revision.effectiveCycleEnd <= cycleEnd;
  const applicable = incarnation.filter(started);
  if (applicable.length === 0) return { status: 'none' };
  const revision = applicable[applicable.length - 1]!;
  return {
    status: 'current',
    revision,
    scheduled: incarnation.filter(candidate => candidate.revisionNumber > revision.revisionNumber),
  };
}
