import { isSQLiteParticipant } from '../../../database/managedSQLite';
import { repositorySQLiteDatabase } from '../../../database/sqliteRepositoryScope';
import { toExactCopCents } from '../../../shared/utils/exactCopCents';
import { transactionDateKey } from '../../../shared/utils/transactionDate';
import type { Transaction } from '../../transactions';
import { readCurrentManualTransaction } from '../../transactions/repositories/sqliteTransactionRepository';
import { createSqliteInstallmentHistoryRepository, type InstallmentHistoryRepository } from '../repositories/sqliteInstallmentHistoryRepository';
import type { InstallmentPurchase } from '../types';
import type { InstallmentAllocation, InstallmentAllocationMode, InstallmentPlanRevision } from '../types/InstallmentHistory';
import { withCreditCardPaymentScope } from './creditCardPaymentScope';
import { registerCreditCardPaymentInScope, type RegisterCreditCardPaymentParams } from './creditCardTransactionRelations';
import { ensureInitialInstallmentRevision } from './initialInstallmentRevision';
import { buildAllocationRevision, estimatePendingPrincipal, type PrincipalUndeterminedReason } from './installmentAllocationLedger';

/**
 * Phase 1a.4B: extraordinary payment to one installment purchase, mode `unspecified` («No sé»).
 *
 * The money moves once, through the ordinary card payment (source balance down, debt derived from movements down by
 * the whole payment). The allocation is not a movement: it records which purchase the user meant, limited to the
 * estimated pending principal, and appends a pending revision. Any surplus stays a general payment to the card; it is
 * never assigned to another purchase. Installments, installment amounts, `paid_installments`, purchase status and
 * statements are not changed: only a statement can show how the bank applied the payment.
 *
 * Internal in 1a.4B: not exported from the module index nor wired to any screen, hook or AI command.
 */
type Dependencies = Pick<RegisterCreditCardPaymentParams, 'accountRepository' | 'creditCardRepository' | 'transactionRepository'>;

export type ExtraordinaryInstallmentPaymentParams = Dependencies & {
  cardAccountId: string;
  installmentPurchaseId: string;
  sourceAccountId: string;
  /** Whole pesos, the contract of every partial card payment (3B). Rejected, never rounded, otherwise. */
  paymentAmount: number;
  /** Pesos with at most two decimals that the user wants to apply to the purchase; at most `paymentAmount`. */
  allocatedAmount: number;
  mode: InstallmentAllocationMode;
  /** Durable idempotency key: a repeated command never writes money twice. */
  commandId: string;
  currentDate?: Date;
};

export type AllocateCreditCardPaymentParams = Dependencies & {
  paymentTransactionId: string;
  installmentPurchaseId: string;
  allocatedAmount: number;
  mode: InstallmentAllocationMode;
  commandId: string;
  currentDate?: Date;
};

export type InstallmentAllocationOutcome = {
  status: 'registered';
  payment: Transaction;
  allocation: InstallmentAllocation;
  allocationRevision: InstallmentPlanRevision;
  /** Present when revision 0 had to be written before the allocation (plans of the intermediate 1a.3B code). */
  lazyInitialRevision?: InstallmentPlanRevision;
  paymentCents: number;
  requestedCents: number;
  allocatedCents: number;
  /** Part of the payment that stays a general payment to the card. */
  unallocatedPaymentCents: number;
  estimatedPrincipalBeforeCents: number;
  estimatedPrincipalAfterCents: number;
};

/** The command was already confirmed: nothing was written. A reversed allocation is reported, never reactivated. */
export type ReplayedInstallmentAllocation = {
  status: 'replayed';
  allocation: InstallmentAllocation;
  allocationRevision?: InstallmentPlanRevision;
  /** Current payment row; undefined if it was deleted after the allocation was reversed. */
  payment?: Transaction;
};

export type InstallmentAllocationResult = InstallmentAllocationOutcome | ReplayedInstallmentAllocation;

const UNDETERMINED_MESSAGES: Record<PrincipalUndeterminedReason, string> = {
  noHistory: 'La compra no tiene historial de cuotas.',
  purchaseRemoved: 'La compra fue eliminada.',
  unknownPrincipal: 'El capital de la compra no se conoce con exactitud; no se puede imputar el abono.',
  statementAdjustmentRequired: 'El plan de la compra debe ajustarse con el extracto bancario antes de imputar otro abono.',
  unconfirmedStatement: 'El plan de la compra tiene un extracto sin confirmar; no se puede estimar el capital pendiente.',
  inconsistentHistory: 'El historial de la compra es inconsistente; no se puede determinar el capital pendiente.',
};

const ZERO_PRINCIPAL_MESSAGE = 'La compra no tiene capital pendiente estimado al que imputar el abono.';

const extraordinaryRequests = new WeakMap<ExtraordinaryInstallmentPaymentParams, Promise<InstallmentAllocationResult>>();
const allocationRequests = new WeakMap<AllocateCreditCardPaymentParams, Promise<InstallmentAllocationResult>>();

export const extraordinaryPaymentTransactionId = (cardAccountId: string, commandId: string) =>
  `tx-credit-card-payment-${cardAccountId}-command-${commandId}`;
const allocationId = (commandId: string) => `installment-allocation-${commandId}`;

function requireCommandId(commandId: unknown): string {
  if (typeof commandId !== 'string' || commandId.trim().length === 0) throw new Error('Falta el identificador del comando.');
  return commandId;
}

function requireAllocatedCents(amount: number): number {
  const cents = typeof amount === 'number' ? toExactCopCents(amount) : undefined;
  if (cents === undefined || cents < 1)
    throw new Error('El importe destinado a la compra debe ser positivo y tener como máximo dos decimales.');
  return cents;
}

function requireMode(mode: InstallmentAllocationMode): 'unspecified' {
  if (mode !== 'unspecified') throw new Error('En esta versión solo se admite la modalidad «No sé».');
  return mode;
}

function isParticipant(dependencies: Dependencies): boolean {
  const database = repositorySQLiteDatabase(dependencies.transactionRepository);
  return Boolean(database && isSQLiteParticipant(database));
}

function requireSQLite(dependencies: Dependencies) {
  if (!repositorySQLiteDatabase(dependencies.creditCardRepository))
    throw new Error('Los abonos extraordinarios requieren la base de datos local.');
}

function historyOf(dependencies: Dependencies): InstallmentHistoryRepository {
  const database = repositorySQLiteDatabase(dependencies.creditCardRepository);
  if (!database || !isSQLiteParticipant(database)) throw new Error('La imputación debe ejecutarse dentro de una transacción.');
  return createSqliteInstallmentHistoryRepository(database);
}

async function findPurchase(dependencies: Dependencies, cardAccountId: string, purchaseId: string): Promise<InstallmentPurchase> {
  const onCard = (await dependencies.creditCardRepository.getInstallmentPurchases([cardAccountId]))
    .find(purchase => purchase.id === purchaseId);
  if (onCard) return onCard;
  const accountIds = (await dependencies.accountRepository.getAccounts()).map(account => account.id);
  const elsewhere = (await dependencies.creditCardRepository.getInstallmentPurchases(accountIds))
    .some(purchase => purchase.id === purchaseId);
  throw new Error(elsewhere ? 'La compra pertenece a otra tarjeta.' : 'La compra a cuotas no existe.');
}

/**
 * Read-only: whether the purchase has a reliable, positive estimated principal to receive an allocation. A plan
 * without current history will get a lazy revision 0 whose principal is the stored amount converted exactly, so it is
 * judged from that amount without writing anything. Every rejection here happens before any write (decision C).
 */
async function requireAllocatablePrincipal(history: InstallmentHistoryRepository, purchase: InstallmentPurchase) {
  const revisions = await history.getPlanRevisions(purchase.id);
  const latest = revisions[revisions.length - 1];
  if (!latest || latest.source === 'purchaseRemoval') {
    if (!(purchase.totalAmount > 0) || toExactCopCents(purchase.totalAmount) === undefined)
      throw new Error(UNDETERMINED_MESSAGES.unknownPrincipal);
    return;
  }
  const estimate = estimatePendingPrincipal(revisions, await history.getAllocationsByPurchase(purchase.id));
  if (estimate.status !== 'determined') throw new Error(UNDETERMINED_MESSAGES[estimate.reason]);
  if (estimate.principalCents === 0) throw new Error(ZERO_PRINCIPAL_MESSAGE);
}

/** Checks that do not depend on the payment; run before any write. */
async function requireEligiblePurchase(
  dependencies: Dependencies,
  history: InstallmentHistoryRepository,
  cardAccountId: string,
  purchaseId: string,
  currency: string,
) {
  const purchase = await findPurchase(dependencies, cardAccountId, purchaseId);
  if (purchase.status === 'paid') throw new Error('La compra ya figura como pagada.');
  if (purchase.status === 'cancelled') throw new Error('La compra está cancelada.');
  if (purchase.currency !== currency) throw new Error('La moneda de la compra no coincide con la del pago.');
  const original = await readCurrentManualTransaction(dependencies.transactionRepository, purchase.transactionId);
  if (!original || original.paymentMethod !== 'credit' || original.accountId !== cardAccountId)
    throw new Error('El movimiento original de la compra no existe o ya no es una compra con esta tarjeta.');
  await requireAllocatablePrincipal(history, purchase);
  return { purchase, original };
}

async function replayOf(
  history: InstallmentHistoryRepository,
  dependencies: Dependencies,
  commandId: string,
  expected: { paymentTransactionId: string; installmentPurchaseId: string; requestedCents: number;
    payment?: { amount: number; sourceAccountId: string; cardAccountId: string } },
): Promise<ReplayedInstallmentAllocation | undefined> {
  const stored = await history.getAllocationsByCommand(commandId);
  if (stored.length === 0) return undefined;
  const [allocation] = stored;
  const revisions = await history.getPlanRevisions(allocation!.installmentPurchaseId);
  const allocationRevision = revisions.find(revision => revision.source === 'allocation' && revision.allocationId === allocation!.id);
  // A smaller stored amount is the same request only if it was capped by the estimate reaching zero.
  const sameAmount = allocation!.amountCents === expected.requestedCents ||
    (allocation!.amountCents < expected.requestedCents && allocationRevision?.remainingPrincipalCents === 0);
  const payment = await readCurrentManualTransaction(dependencies.transactionRepository, allocation!.paymentTransactionId);
  // While active, the payment's amount and accounts are immutable (SQLite guard); once reversed they may have changed.
  const samePayment = !expected.payment || allocation!.status !== 'active' || (payment !== undefined &&
    payment.amount === expected.payment.amount && payment.accountId === expected.payment.sourceAccountId &&
    payment.targetAccountId === expected.payment.cardAccountId);
  if (stored.length !== 1 || allocation!.paymentTransactionId !== expected.paymentTransactionId ||
      allocation!.installmentPurchaseId !== expected.installmentPurchaseId || allocation!.mode !== 'unspecified' ||
      !sameAmount || !samePayment)
    throw new Error('El comando ya se registró con datos distintos. Usa un comando nuevo.');
  return { status: 'replayed', allocation: allocation!, ...(allocationRevision ? { allocationRevision } : {}), ...(payment ? { payment } : {}) };
}

/** Core, inside the caller's participant: validations, lazy revision 0, estimate, allocation and its revision. */
async function allocateInScope(
  dependencies: Dependencies,
  history: InstallmentHistoryRepository,
  { paymentTransactionId, installmentPurchaseId, requestedCents, commandId, createdAt }: {
    paymentTransactionId: string; installmentPurchaseId: string; requestedCents: number; commandId: string; createdAt: string;
  },
): Promise<InstallmentAllocationOutcome> {
  const payment = await readCurrentManualTransaction(dependencies.transactionRepository, paymentTransactionId);
  if (!payment || payment.type !== 'creditCardPayment' || payment.status !== 'posted' || payment.direction !== 'outflow' ||
      !payment.targetAccountId)
    throw new Error('El pago no existe o no es un pago de tarjeta registrado.');
  const paymentCents = toExactCopCents(payment.amount);
  if (paymentCents === undefined || paymentCents < 1) throw new Error('El importe del pago no es un valor exacto en centavos.');
  if (requestedCents > paymentCents) throw new Error('El importe destinado a la compra no puede superar el pago.');
  const paymentAllocations = await history.getAllocationsByPayment(paymentTransactionId);
  const active = paymentAllocations.filter(allocation => allocation.status === 'active');
  // 1a.4B cardinality: at most one active allocation per payment (the schema admits more; this phase does not).
  if (active.length > 0) throw new Error('Este pago ya está imputado a una compra. Revierte esa imputación antes de imputarlo de nuevo.');

  const { purchase, original } = await requireEligiblePurchase(dependencies, history, payment.targetAccountId, installmentPurchaseId, payment.currency);
  const ensured = await ensureInitialInstallmentRevision({
    creditCardRepository: dependencies.creditCardRepository, purchase, purchaseDate: transactionDateKey(original), createdAt,
  });
  const estimate = estimatePendingPrincipal(
    await history.getPlanRevisions(purchase.id), await history.getAllocationsByPurchase(purchase.id));
  if (estimate.status !== 'determined') throw new Error(UNDETERMINED_MESSAGES[estimate.reason]);
  if (estimate.principalCents === 0) throw new Error(ZERO_PRINCIPAL_MESSAGE);

  const allocatedCents = Math.min(requestedCents, estimate.principalCents);
  // General limit kept for later phases: active allocations of a payment never exceed it.
  if (active.reduce((sum, allocation) => sum + allocation.amountCents, allocatedCents) > paymentCents)
    throw new Error('Las imputaciones del pago superarían su importe.');
  const saved = await history.saveAllocations(commandId, [{
    id: allocationId(commandId), paymentTransactionId, installmentPurchaseId: purchase.id,
    amountCents: allocatedCents, mode: 'unspecified', createdAt,
  }]);
  if (saved.status !== 'inserted' || saved.allocations.length !== 1) throw new Error('El comando ya se registró. Usa un comando nuevo.');
  const [allocation] = saved.allocations;
  const estimatedPrincipalAfterCents = estimate.principalCents - allocatedCents;
  const allocationRevision = await history.appendPlanRevision(buildAllocationRevision({
    allocation: allocation!, estimateAfter: estimatedPrincipalAfterCents, anchor: estimate.anchor, createdAt,
  }));
  return {
    status: 'registered',
    payment,
    allocation: allocation!,
    allocationRevision,
    ...(ensured.status === 'createdLazily' ? { lazyInitialRevision: ensured.revision } : {}),
    paymentCents,
    requestedCents,
    allocatedCents,
    unallocatedPaymentCents: paymentCents - allocatedCents,
    estimatedPrincipalBeforeCents: estimate.principalCents,
    estimatedPrincipalAfterCents,
  };
}

/** Registers the payment and its allocation in one transaction, exactly once per `commandId`. */
export async function registerExtraordinaryInstallmentPayment(
  params: ExtraordinaryInstallmentPaymentParams,
): Promise<InstallmentAllocationResult> {
  const participant = isParticipant(params);
  const previous = participant ? undefined : extraordinaryRequests.get(params);
  if (previous) return previous;
  requireSQLite(params);
  const commandId = requireCommandId(params.commandId);
  requireMode(params.mode);
  if (!Number.isSafeInteger(params.paymentAmount) || params.paymentAmount < 1)
    throw new Error('El abono extraordinario debe ser un importe positivo en pesos enteros.');
  const paymentCents = params.paymentAmount * 100;
  const requestedCents = requireAllocatedCents(params.allocatedAmount);
  if (requestedCents > paymentCents) throw new Error('El importe destinado a la compra no puede superar el pago.');
  const intention = { ...params, commandId, currentDate: new Date(params.currentDate?.getTime() ?? Date.now()) };
  const result = withCreditCardPaymentScope(intention, async dependencies => {
    const history = historyOf(dependencies);
    const paymentTransactionId = extraordinaryPaymentTransactionId(intention.cardAccountId, commandId);
    const replay = await replayOf(history, dependencies, commandId, {
      paymentTransactionId, installmentPurchaseId: intention.installmentPurchaseId, requestedCents,
      payment: { amount: intention.paymentAmount, sourceAccountId: intention.sourceAccountId, cardAccountId: intention.cardAccountId },
    });
    if (replay) return replay;
    if (await readCurrentManualTransaction(dependencies.transactionRepository, paymentTransactionId))
      throw new Error('El pago de este comando existe sin imputación. Revisa el historial antes de continuar.');
    const card = (await dependencies.accountRepository.getAccounts()).find(account => account.id === intention.cardAccountId);
    if (!card || card.type !== 'creditCard' || card.status !== 'active') throw new Error('Selecciona una tarjeta de credito activa.');
    // Rejections that do not depend on the payment happen before any write.
    await requireEligiblePurchase(dependencies, history, card.id, intention.installmentPurchaseId, card.currency);
    const registered = await registerCreditCardPaymentInScope({
      ...dependencies, accountId: card.id, amount: intention.paymentAmount, currentDate: intention.currentDate,
      settlement: 'partial', sourceAccountId: intention.sourceAccountId, transactionId: paymentTransactionId,
    });
    // The ordinary payment caps the amount at the debt; an extraordinary payment is never silently reduced.
    if (registered.paidAmount !== intention.paymentAmount)
      throw new Error('El abono supera la deuda actual de la tarjeta. No se registró el pago.');
    return allocateInScope(dependencies, history, {
      paymentTransactionId, installmentPurchaseId: intention.installmentPurchaseId, requestedCents, commandId,
      createdAt: intention.currentDate.toISOString(),
    });
  });
  // Runtime protection for the same request object, including unknown results; the durable key is `commandId`.
  // A participant result stays provisional until its owner commits: never cached.
  if (!participant) extraordinaryRequests.set(params, result);
  return result;
}

/**
 * Allocates an existing card payment to one purchase, with its own command. It never moves money. A payment whose
 * allocation was reversed (for example by editing it) can be allocated again only through a new explicit command.
 */
export async function allocateCreditCardPaymentToPurchase(
  params: AllocateCreditCardPaymentParams,
): Promise<InstallmentAllocationResult> {
  const participant = isParticipant(params);
  const previous = participant ? undefined : allocationRequests.get(params);
  if (previous) return previous;
  requireSQLite(params);
  const commandId = requireCommandId(params.commandId);
  requireMode(params.mode);
  const requestedCents = requireAllocatedCents(params.allocatedAmount);
  const intention = { ...params, commandId, currentDate: new Date(params.currentDate?.getTime() ?? Date.now()) };
  const result = withCreditCardPaymentScope(intention, async dependencies => {
    const history = historyOf(dependencies);
    const replay = await replayOf(history, dependencies, commandId, {
      paymentTransactionId: intention.paymentTransactionId, installmentPurchaseId: intention.installmentPurchaseId, requestedCents,
    });
    if (replay) return replay;
    return allocateInScope(dependencies, history, {
      paymentTransactionId: intention.paymentTransactionId, installmentPurchaseId: intention.installmentPurchaseId,
      requestedCents, commandId, createdAt: intention.currentDate.toISOString(),
    });
  });
  if (!participant) allocationRequests.set(params, result);
  return result;
}
