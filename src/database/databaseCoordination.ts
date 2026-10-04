// Same JS runtime is used by the UI and Headless JS worker. Serialize exclusive
// backup/wipe against maintenance without a permanently running timer.
let pending: Promise<unknown> = Promise.resolve();
export function withDatabaseMaintenance<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = pending.then(operation, operation);
  pending = result.catch(() => undefined);
  return result;
}
export const withExclusiveDatabase = withDatabaseMaintenance;
