import { nativeDatabaseLifecycle } from './nativeDatabaseLifecycle';

// Same JS runtime is used by UI and Headless. Always acquire JS before native.
let pending: Promise<unknown> = Promise.resolve();
export type DatabasePermit = { readonly id: symbol };
const permits = new WeakSet<DatabasePermit>();
const nativeTokens = new WeakMap<DatabasePermit, string>();
export function nativeDatabaseToken(permit: DatabasePermit): string | undefined {
  assertDatabasePermit(permit);
  return nativeTokens.get(permit);
}
export async function verifyNativeDatabaseOwner(permit: DatabasePermit): Promise<void> {
  const token = nativeDatabaseToken(permit);
  if (token !== undefined) await nativeDatabaseLifecycle()!.checkOwner(token);
}
export function assertDatabasePermit(permit: DatabasePermit): void {
  if (!permits.has(permit))
    throw new Error('Database permit is expired or invalid');
}
export function withDatabaseMaintenance<T>(
  operation: (permit: DatabasePermit) => Promise<T>,
  borrowed?: DatabasePermit,
): Promise<T> {
  if (borrowed) {
    assertDatabasePermit(borrowed);
    return operation(borrowed);
  }
  const execute = async () => {
    const native = nativeDatabaseLifecycle();
    // No JS timeout: a lost acquisition response must not grant another owner.
    const token = await native?.acquire();
    if (native && (typeof token !== 'string' || !token)) {
      await native.quarantine();
      throw new Error('Android devolvió un permiso SQLite inválido.');
    }
    const permit: DatabasePermit = Object.freeze({
      id: Symbol('database-owner'),
    });
    permits.add(permit);
    if (token !== undefined) nativeTokens.set(permit, token);
    try {
      return await operation(permit);
    } finally {
      permits.delete(permit);
      nativeTokens.delete(permit);
      if (token !== undefined) await native!.release(token);
    }
  };
  const result = pending.then(execute, execute);
  pending = result.catch(() => undefined);
  return result;
}
export const withExclusiveDatabase = withDatabaseMaintenance;
