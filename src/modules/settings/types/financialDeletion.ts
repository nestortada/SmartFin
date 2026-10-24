/** Internal metadata only. The epoch is independent of the financial revision. */
export const FINANCIAL_LIFECYCLE_KEY = '__smartfin_financial_lifecycle_v1';
export const DELETION_RECEIPT_PREFIX = '__smartfin_deletion_receipt_v1:';
export type DeletionInventory = {
  reminderIds: string[];
  workIds: string[];
  backupJobIds: string[];
  snapshotIds: string[];
};
export type DeletionPlatformInventory = Omit<DeletionInventory, 'reminderIds'> & { reminderIds?: string[] };
export type FinancialDeletionIntent = DeletionInventory & {
  version: 1;
  id: string;
  epoch: string;
  previousEpoch: string;
  phase: 'cleanupPending' | 'completed';
};
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export function requireDeletionId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Identidad de borrado inválida.');
  return value;
}
export function parseDeletionIntent(value: unknown): FinancialDeletionIntent {
  if (typeof value !== 'string') throw new Error('Intención de borrado inválida.');
  const row: unknown = JSON.parse(value);
  if (!row || typeof row !== 'object') throw new Error('Intención de borrado inválida.');
  const record = row as Record<string, unknown>;
  requireDeletionId(record.id);
  if (record.version !== 1 || record.epoch !== record.id ||
      (record.previousEpoch !== 'legacy' && (typeof record.previousEpoch !== 'string' || !uuid.test(record.previousEpoch))) ||
      !['cleanupPending', 'completed'].includes(String(record.phase))) throw new Error('Intención de borrado incompatible.');
  for (const key of ['reminderIds', 'workIds', 'backupJobIds', 'snapshotIds']) {
    const ids = record[key];
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length)
      throw new Error('Inventario de borrado inválido.');
    if (key !== 'reminderIds') ids.forEach(requireDeletionId);
  }
  return record as FinancialDeletionIntent;
}
