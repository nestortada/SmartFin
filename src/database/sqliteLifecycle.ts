import { openDatabase, type DatabaseParams } from 'react-native-sqlite-storage';
import type { SmartFinSQLiteDatabase } from './sqliteDatabase';

export const SQLITE_LIFECYCLE_TIMEOUT_MS = 10000;

/** A missing receipt is a failure, never permission to reuse the connection. */
export async function sqliteLifecycleReceipt<T>(
  operation: Promise<T>,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`SQLite ${label} receipt timed out`)),
          SQLITE_LIFECYCLE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The driver's Promise returns a provisional object before native open succeeds. */
export function openConfirmedSQLiteConnection(
  params: DatabaseParams,
): Promise<SmartFinSQLiteDatabase> {
  const receipt = new Promise<SmartFinSQLiteDatabase>((resolve, reject) => {
    const provisional = openDatabase(params, resolve, reject);
    // In Promise mode callbacks supplied by us still occupy the factory's first slots.
    // Consume rejection, but never accept this provisional resolution as readiness.
    void Promise.resolve(provisional).catch(reject);
  });
  return sqliteLifecycleReceipt(receipt, 'opening');
}
