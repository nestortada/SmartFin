// Same JS runtime is used by the UI and Headless JS worker. Serialize exclusive
// backup/wipe against maintenance without a permanently running timer.
let pending: Promise<unknown> = Promise.resolve();
export type DatabasePermit = { readonly id: symbol };
const permits = new WeakSet<DatabasePermit>();
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
    const permit: DatabasePermit = Object.freeze({
      id: Symbol('database-owner'),
    });
    permits.add(permit);
    try {
      return await operation(permit);
    } finally {
      permits.delete(permit);
    }
  };
  const result = pending.then(execute, execute);
  pending = result.catch(() => undefined);
  return result;
}
export const withExclusiveDatabase = withDatabaseMaintenance;
