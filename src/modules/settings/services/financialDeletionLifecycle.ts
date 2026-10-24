import { NativeModules, Platform } from 'react-native';
import { nativeDatabaseToken, type DatabasePermit } from '../../../database/databaseCoordination';
import { parseDeletionIntent, requireDeletionId, type DeletionPlatformInventory } from '../types/financialDeletion';

export type DeletionRecovery = { status: 'none' | 'unknown' | 'cleanupPending' | 'completed'; id?: string };
export type FinancialDeletionLifecycle = {
  begin: () => Promise<{ status: 'admitted' | 'rejected' | 'unknown'; id?: string }>;
  inventory: (id: string, permit: DatabasePermit) => Promise<DeletionPlatformInventory>;
  rollback: (id: string, permit: DatabasePermit) => Promise<void>;
  recover: () => Promise<DeletionRecovery>;
};
type NativeDeletion = {
  beginFinancialDeletion: () => Promise<unknown>;
  financialDeletionInventory: (id: string, token: string) => Promise<unknown>;
  rollbackFinancialDeletion: (id: string, token: string) => Promise<void>;
  recoverFinancialDeletion: () => Promise<unknown>;
  resourceEpoch: (token: string) => Promise<unknown>;
};
function native(): NativeDeletion {
  const module: unknown = NativeModules.SmartFinDatabaseLifecycle;
  if (Platform.OS !== 'android' || !module || typeof module !== 'object' ||
      ['beginFinancialDeletion', 'financialDeletionInventory', 'rollbackFinancialDeletion', 'recoverFinancialDeletion', 'resourceEpoch']
        .some(key => typeof Reflect.get(module, key) !== 'function'))
    throw new Error('El borrado seguro requiere la coordinación Android de fase 5C.');
  return module as NativeDeletion;
}
function token(permit: DatabasePermit): string {
  const value = nativeDatabaseToken(permit);
  if (!value) throw new Error('Falta el permiso Android para el borrado.');
  return value;
}
export function financialDeletionLifecycle(): FinancialDeletionLifecycle {
  const module = native();
  return {
    begin: async () => {
      const json = await module.beginFinancialDeletion();
      const value: unknown = typeof json === 'string' ? JSON.parse(json) : undefined;
      if (!value || typeof value !== 'object' || !('status' in value) ||
          !['admitted', 'rejected', 'unknown'].includes(String(value.status))) throw new Error('Admisión de borrado sin confirmar.');
      const id = 'id' in value ? requireDeletionId(value.id) : undefined;
      if (value.status === 'admitted' && !id) throw new Error('Admisión sin identidad.');
      return { status: value.status as 'admitted' | 'rejected' | 'unknown', id };
    },
    inventory: async (id, permit) => {
      const json = await module.financialDeletionInventory(id, token(permit));
      if (typeof json !== 'string') throw new Error('Inventario Android inválido.');
      const inventory: unknown = JSON.parse(json);
      if (!inventory || typeof inventory !== 'object') throw new Error('Inventario Android inválido.');
      const valid = parseDeletionIntent(JSON.stringify({ ...inventory, version: 1, id, epoch: id,
        previousEpoch: 'legacy', phase: 'cleanupPending' }));
      return { reminderIds: valid.reminderIds, workIds: valid.workIds, backupJobIds: valid.backupJobIds, snapshotIds: valid.snapshotIds };
    },
    rollback: (id, permit) => module.rollbackFinancialDeletion(id, token(permit)),
    recover: async () => {
      const json = await module.recoverFinancialDeletion();
      const value: unknown = typeof json === 'string' ? JSON.parse(json) : undefined;
      if (!value || typeof value !== 'object' || !('status' in value) ||
          !['none', 'unknown', 'cleanupPending', 'completed'].includes(String(value.status)))
        throw new Error('Recuperación de borrado inválida.');
      const id = 'id' in value ? requireDeletionId(value.id) : undefined;
      if (value.status !== 'none' && !id) throw new Error('Recuperación sin identidad.');
      return { status: value.status as DeletionRecovery['status'], id };
    },
  };
}
/** Under the existing JS → native owner, both UI and Headless validate each bounded batch. */
export async function subscriptionResourceEpoch(permit: DatabasePermit): Promise<string> {
  // Older bridges remain supported for ordinary subscription usage only before 5C deployment.
  const module: unknown = NativeModules.SmartFinDatabaseLifecycle;
  if (Platform.OS !== 'android' || !module || typeof module !== 'object' || typeof Reflect.get(module, 'resourceEpoch') !== 'function') return 'legacy';
  const value = await native().resourceEpoch(token(permit));
  return value === 'legacy' ? value : requireDeletionId(value);
}
export async function recoverFinancialDeletion(): Promise<DeletionRecovery> {
  if (Platform.OS !== 'android') return { status: 'none' };
  const module: unknown = NativeModules.SmartFinDatabaseLifecycle;
  if (!module || typeof module !== 'object' || typeof Reflect.get(module, 'recoverFinancialDeletion') !== 'function') return { status: 'none' };
  return financialDeletionLifecycle().recover();
}
