import type { ISODateString } from '../../../shared/types';
import type { CivilDate, ClosingDayPurchasePolicy, ConfirmedFirstCycle } from '../useCases/installmentPlan';

/** Phase 1a.3B persistence types. Money is exact integer cents; no calculation is implied. */

/** `unspecified`: extraordinary payment «No sé». `reduceTerm` / `reduceInstallment`: phase 1b. */
export type InstallmentAllocationMode = 'unspecified' | 'reduceTerm' | 'reduceInstallment';
export type InstallmentAllocationStatus = 'active' | 'reversed';

export type InstallmentAllocation = {
  id: string;
  paymentTransactionId: string;
  installmentPurchaseId: string;
  amountCents: number;
  mode: InstallmentAllocationMode;
  status: InstallmentAllocationStatus;
  /** Idempotency key: one command imputes one payment, at most once per purchase. */
  commandId: string;
  createdAt: ISODateString;
  reversedAt?: ISODateString;
};

export type NewInstallmentAllocation = Omit<InstallmentAllocation, 'status' | 'reversedAt' | 'commandId'>;

export type InstallmentPlanRevisionSource =
  | 'original'
  | 'allocation'
  | 'allocationReversal'
  | 'statement'
  | 'purchaseEdit'
  /** Appended by SQLite when a purchase with history is deleted; ends that purchase's current plan. */
  | 'purchaseRemoval';

/**
 * - confirmed: complete and backed by the bank (statement) or the user.
 * - projected: complete, computed with the default rules; never presented as confirmed.
 * - pendingVerification: information is missing, inexact or invalidated (see `pendingReasons`).
 * - estimated: future simulation, for example with interest; not a bank figure.
 */
export type InstallmentPlanVerification = 'confirmed' | 'projected' | 'pendingVerification' | 'estimated';

export type InstallmentPlanPendingReason =
  | 'firstCycleUnconfirmed'
  | 'inexactHistoricalAmount'
  | 'inexactInstallmentAmount'
  | 'invalidPrincipal'
  | 'invalidInstallmentCount'
  | 'termsChanged'
  | 'purchaseRemoved'
  | 'allocationReversed'
  | 'manualReview';

export const INSTALLMENT_PLAN_PENDING_REASONS: readonly InstallmentPlanPendingReason[] = [
  'firstCycleUnconfirmed',
  'inexactHistoricalAmount',
  'inexactInstallmentAmount',
  'invalidPrincipal',
  'invalidInstallmentCount',
  'termsChanged',
  'purchaseRemoved',
  'allocationReversed',
  'manualReview',
];

/** Raw legacy values of the purchase row the revision was taken from (original and purchaseEdit only). */
export type InstallmentPlanRevisionBasis = {
  totalAmount: number | string;
  monthlyAmount: number | string;
  installmentCount: number | string;
};

export type InstallmentPlanRevision = {
  /** Deterministic: `${installmentPurchaseId}:revision:${revisionNumber}`. */
  id: string;
  installmentPurchaseId: string;
  revisionNumber: number;
  source: InstallmentPlanRevisionSource;
  allocationId?: string;
  /** Null when the amount cannot be represented exactly or is unknown. */
  remainingPrincipalCents: number | null;
  remainingInstallments: number | null;
  installmentAmountCents: number | null;
  /** Closing date of the first cycle the revision applies to; null when it is not known. */
  effectiveCycleEnd: CivilDate | null;
  verification: InstallmentPlanVerification;
  pendingReasons: InstallmentPlanPendingReason[];
  basis?: InstallmentPlanRevisionBasis;
  createdAt: ISODateString;
};

/** Revisions appended by the application. Removal and edit revisions are appended by SQLite triggers. */
export type NewInstallmentPlanRevision = {
  installmentPurchaseId: string;
  source: Exclude<InstallmentPlanRevisionSource, 'purchaseRemoval' | 'purchaseEdit'>;
  allocationId?: string;
  remainingPrincipalCents: number | null;
  remainingInstallments: number | null;
  installmentAmountCents: number | null;
  effectiveCycleEnd: CivilDate | null;
  verification: InstallmentPlanVerification;
  pendingReasons: InstallmentPlanPendingReason[];
  basis?: InstallmentPlanRevisionBasis;
  createdAt: ISODateString;
};

export type CreditCardBillingRules = {
  accountId: string;
  /** Undefined: not defined for this card. Never assumed universally. */
  closingDayPurchasePolicy?: ClosingDayPurchasePolicy;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

export type InstallmentFirstCycle = ConfirmedFirstCycle & {
  installmentPurchaseId: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};
