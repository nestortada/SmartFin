import { isSQLiteParticipant } from '../../../database/managedSQLite';
import { repositorySQLiteDatabase } from '../../../database/sqliteRepositoryScope';
import type { CreditCardRepository } from '../repositories';
import { createSqliteInstallmentHistoryRepository } from '../repositories/sqliteInstallmentHistoryRepository';
import type { InstallmentAllocation, InstallmentPlanRevision } from '../types/InstallmentHistory';
import { buildAllocationReversalRevision, estimatePendingPrincipal } from './installmentAllocationLedger';

/**
 * Phase 1a.4B, D6. Editing or deleting a card payment that has active allocations first reverses all of them, in the
 * payment's own participant: `active → reversed` plus one `allocationReversal` revision each, then the edit or
 * deletion, then one COMMIT. Nothing is re-imputed afterwards; a new allocation needs a new explicit command.
 * Confirmed revisions are never rewritten (history is append-only).
 */
export type ReversedInstallmentAllocation = { allocation: InstallmentAllocation; revision: InstallmentPlanRevision };

export class ActiveInstallmentAllocationError extends Error {
  constructor() {
    super('La compra tiene abonos extraordinarios imputados. Revierte la imputación (editando o eliminando el pago) ' +
      'antes de eliminar la compra o cambiar su importe, tarjeta, cuotas, fecha o forma de pago.');
  }
}

export async function reverseActivePaymentAllocations({
  creditCardRepository,
  paymentTransactionId,
  reversedAt,
}: {
  creditCardRepository: Pick<CreditCardRepository, 'getCreditCardAccounts'>;
  paymentTransactionId: string;
  reversedAt: string;
}): Promise<ReversedInstallmentAllocation[]> {
  const database = repositorySQLiteDatabase(creditCardRepository);
  // In-memory domain doubles have no allocations.
  if (!database) return [];
  if (!isSQLiteParticipant(database))
    throw new Error('Las imputaciones deben revertirse en la misma transacción que la edición del pago.');
  const history = createSqliteInstallmentHistoryRepository(database);
  const active = (await history.getAllocationsByPayment(paymentTransactionId)).filter(allocation => allocation.status === 'active');
  const reversed: ReversedInstallmentAllocation[] = [];
  for (const allocation of active) {
    const revisions = await history.getPlanRevisions(allocation.installmentPurchaseId);
    const allocationRevision = revisions.find(revision => revision.source === 'allocation' && revision.allocationId === allocation.id);
    const updated = await history.reverseAllocation(allocation.id, reversedAt);
    const estimateAfter = estimatePendingPrincipal(revisions, await history.getAllocationsByPurchase(allocation.installmentPurchaseId));
    const revision = await history.appendPlanRevision(buildAllocationReversalRevision({
      allocation, allocationRevision, history: revisions, estimateAfter, createdAt: reversedAt,
    }));
    reversed.push({ allocation: updated, revision });
  }
  return reversed;
}

/**
 * Policy for purchases: a destructive change (deletion, conversion to debit or one installment, new amount, card,
 * count, currency or date) of a purchase with active allocations is rejected before any write. Allocations are never
 * reversed implicitly from the purchase side; the SQLite guards stay as the last line of defence.
 */
export async function requireNoActiveInstallmentAllocations({
  creditCardRepository,
  purchaseTransactionIds,
}: {
  creditCardRepository: Pick<CreditCardRepository, 'getCreditCardAccounts'>;
  /** Original movements of the purchases about to change. */
  purchaseTransactionIds: string[];
}): Promise<void> {
  const database = repositorySQLiteDatabase(creditCardRepository);
  if (!database) return;
  const history = createSqliteInstallmentHistoryRepository(database);
  for (const id of new Set(purchaseTransactionIds)) {
    if (await history.hasActiveAllocationsForPurchaseTransaction(id)) throw new ActiveInstallmentAllocationError();
  }
}
