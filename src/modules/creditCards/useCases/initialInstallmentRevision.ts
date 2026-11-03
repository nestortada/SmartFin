import { isSQLiteParticipant } from '../../../database/managedSQLite';
import { repositorySQLiteDatabase } from '../../../database/sqliteRepositoryScope';
import type { CreditCardRepository } from '../repositories';
import { createSqliteInstallmentHistoryRepository } from '../repositories/sqliteInstallmentHistoryRepository';
import type { InstallmentPurchase } from '../types';
import type {
  InstallmentPlanPendingReason,
  InstallmentPlanRevision,
  InstallmentPlanVerification,
  NewInstallmentPlanRevision,
} from '../types/InstallmentHistory';
import {
  buildInstallmentPlan,
  INSTALLMENT_PLAN_TIME_ZONE,
  type CivilDate,
  type ConfirmedFirstCycle,
  type InstallmentBillingRules,
  type InstallmentPlanIssueCode,
} from './installmentPlan';
import { parseCreditCardVisualMetadata } from './manageCreditCards';

/**
 * Phase 1a.4A: revision 0 of a purchase registered after migration 5. It records the plan known when the purchase
 * is created (or recreated with the same id after a `purchaseRemoval`); it is history, not a movement, and changes no
 * balance, debt, statement or purchase column. The 1a.1 engine decides everything: exact cents or NULL (never
 * rounded), the D2 base installment, and the first cycle only from the card's closing day, its closing-day policy or
 * an explicit confirmation. `paid_installments` is legacy and is never read.
 */
export type InitialInstallmentRevisionInput = {
  purchase: InstallmentPurchase;
  purchaseDate: CivilDate;
  billing: InstallmentBillingRules;
  confirmedFirstCycle?: ConfirmedFirstCycle;
  createdAt: string;
};

const ISSUE_REASONS: Record<InstallmentPlanIssueCode, InstallmentPlanPendingReason> = {
  invalidPurchaseId: 'manualReview',
  invalidTimeZone: 'manualReview',
  invalidPurchaseDate: 'manualReview',
  invalidInstallmentCount: 'invalidInstallmentCount',
  invalidPrincipal: 'invalidPrincipal',
  inexactHistoricalAmount: 'inexactHistoricalAmount',
  missingClosingDay: 'firstCycleUnconfirmed',
  invalidClosingDay: 'firstCycleUnconfirmed',
  unsupportedShortMonthPolicy: 'firstCycleUnconfirmed',
  missingClosingDayPurchasePolicy: 'firstCycleUnconfirmed',
  invalidConfirmedFirstCycle: 'firstCycleUnconfirmed',
  firstCycleNotAClosingDate: 'firstCycleUnconfirmed',
  firstCycleBeforePurchase: 'firstCycleUnconfirmed',
  // `requiresDecision` has no verification of its own in the schema: it stays pending with its own reason.
  zeroCentInstallments: 'zeroCentInstallments',
};

/** Pure: the revision 0 the engine yields for these terms. */
export function buildInitialInstallmentRevision({
  purchase,
  purchaseDate,
  billing,
  confirmedFirstCycle,
  createdAt,
}: InitialInstallmentRevisionInput): NewInstallmentPlanRevision {
  const plan = buildInstallmentPlan({
    purchaseId: purchase.id,
    // The stored amount is the principal the debt counts; it is accepted only if it converts exactly.
    principal: { kind: 'storedAmount', amount: purchase.totalAmount },
    installmentCount: purchase.installmentCount,
    purchaseDate,
    timeZone: INSTALLMENT_PLAN_TIME_ZONE,
    billing,
    ...(confirmedFirstCycle ? { confirmedFirstCycle } : {}),
  });
  const verification: InstallmentPlanVerification =
    plan.status === 'confirmed' || plan.status === 'projected' ? plan.status : 'pendingVerification';
  const pendingReasons = verification === 'pendingVerification'
    ? [...new Set(plan.issues.map(entry => ISSUE_REASONS[entry.code]))].sort()
    : [];
  return {
    installmentPurchaseId: purchase.id,
    source: 'original',
    remainingPrincipalCents: plan.principalCents,
    remainingInstallments: plan.installmentCount > 0 ? plan.installmentCount : null,
    // D2 base installment (1..n-1); the last one absorbs principal mod n. Not the legacy rounded monthly amount.
    installmentAmountCents: plan.amounts?.baseCents ?? null,
    effectiveCycleEnd: plan.firstCycle?.cycleEnd ?? null,
    verification,
    pendingReasons,
    basis: {
      totalAmount: purchase.totalAmount,
      monthlyAmount: purchase.monthlyAmount,
      installmentCount: purchase.installmentCount,
    },
    createdAt,
  };
}

/**
 * Appends revision 0 when the purchase has no current plan history: none at all, or a previous incarnation ended by
 * `purchaseRemoval`. Otherwise it returns the latest revision unchanged, so repeating it writes nothing. Must run in
 * the participant that saved the purchase: the purchase and its revision commit or roll back together.
 */
export async function recordInitialInstallmentRevision({
  creditCardRepository,
  purchase,
  purchaseDate,
  createdAt,
}: {
  creditCardRepository: Pick<CreditCardRepository, 'getCreditCardAccounts'>;
  purchase: InstallmentPurchase;
  purchaseDate: CivilDate;
  createdAt: string;
}): Promise<InstallmentPlanRevision | undefined> {
  const database = repositorySQLiteDatabase(creditCardRepository);
  // In-memory domain doubles have no SQLite history.
  if (!database) return undefined;
  if (!isSQLiteParticipant(database))
    throw new Error('La revisión inicial debe registrarse en la misma transacción que la compra.');
  const history = createSqliteInstallmentHistoryRepository(database);
  const latest = await history.getLatestPlanRevision(purchase.id);
  if (latest && latest.source !== 'purchaseRemoval') return latest;
  const card = (await creditCardRepository.getCreditCardAccounts()).find(account => account.id === purchase.accountId);
  const [rules] = await history.getBillingRules([purchase.accountId]);
  const [firstCycle] = await history.getFirstCycles([purchase.id]);
  return history.appendPlanRevision(buildInitialInstallmentRevision({
    purchase,
    purchaseDate,
    billing: {
      closingDay: parseCreditCardVisualMetadata(card?.description).closingDay,
      closingDayPurchasePolicy: rules?.closingDayPurchasePolicy,
    },
    ...(firstCycle ? { confirmedFirstCycle: { cycleEnd: firstCycle.cycleEnd, source: firstCycle.source } } : {}),
    createdAt,
  }));
}
