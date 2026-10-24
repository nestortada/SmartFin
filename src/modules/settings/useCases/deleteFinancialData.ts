import type { FinancialDataRepository } from '../repositories/sqliteFinancialDataRepository';
import { withExclusiveDatabase } from '../../../database/databaseCoordination';
import { financialDeletionLifecycle, type FinancialDeletionLifecycle } from '../services/financialDeletionLifecycle';
import { isDriveBackupInProgress } from '../services/androidDriveBackupService';

export type FinancialDeletionResult =
  | { status: 'confirmed'; id: string; cleanup: 'completed' | 'pending' }
  | { status: 'rolledBack'; id: string; error: unknown; admissionPending?: boolean }
  | { status: 'unknown'; id?: string; error?: unknown }
  | { status: 'rejected'; error: unknown };
let deleting = false;

export async function deleteFinancialData(
  financialDataRepository: FinancialDataRepository,
  lifecycle: FinancialDeletionLifecycle = financialDeletionLifecycle(),
): Promise<FinancialDeletionResult> {
  if (deleting || isDriveBackupInProgress()) return { status: 'rejected', error: new Error('Otro trabajo no ha terminado.') };
  deleting = true;
  let id: string | undefined;
  let confirmed = false;
  let rolledBack: { error: unknown } | undefined;
  try {
    const recovered = await lifecycle.recover();
    if (recovered.status === 'unknown') return { status: 'unknown', id: recovered.id };
    if (recovered.status === 'cleanupPending') return { status: 'rejected', error: new Error('El borrado anterior está confirmado y su limpieza Android sigue pendiente. No se inició un nuevo borrado.') };
    const admitted = await lifecycle.begin();
    if (admitted.status === 'rejected') return { status: 'rejected', error: new Error('Borrado rechazado: otro trabajo de respaldo no ha terminado.') };
    if (admitted.status === 'unknown') return { status: 'unknown', id: admitted.id };
    id = admitted.id!;
    const deletionId = id;
    const result = await withExclusiveDatabase(async permit => {
      const inventory = await lifecycle.inventory(deletionId, permit);
      const outcome = await financialDataRepository.deleteFinancialData(deletionId, inventory, permit);
      confirmed = outcome.status === 'confirmed';
      if (outcome.status === 'rolledBack') {
        rolledBack = { error: outcome.error };
        await lifecycle.rollback(deletionId, permit);
      }
      return outcome;
    });
    if (result.status !== 'confirmed') return { ...result, id };
    // SQLite and both permits are released before WorkManager or private resource cleanup.
    try {
      const cleaned = await lifecycle.recover();
      return { status: 'confirmed', id, cleanup: cleaned.status === 'completed' && cleaned.id === id ? 'completed' : 'pending' };
    } catch { return { status: 'confirmed', id, cleanup: 'pending' }; }
  } catch (error) {
    if (rolledBack) return { status: 'rolledBack', id: id!, error: rolledBack.error, admissionPending: true };
    return confirmed ? { status: 'confirmed', id: id!, cleanup: 'pending' } : { status: 'unknown', id, error };
  } finally { deleting = false; }
}
