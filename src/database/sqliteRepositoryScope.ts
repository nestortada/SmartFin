import type { SmartFinSQLiteDatabase } from './sqliteDatabase';

// Private adapter metadata; repository contracts remain domain-only.
const connections = new WeakMap<object, SmartFinSQLiteDatabase>();

export function registerSQLiteRepository<T extends object>(
  database: SmartFinSQLiteDatabase,
  repository: T,
): T {
  connections.set(repository, database);
  return repository;
}

export function repositorySQLiteDatabase(repository: object) {
  return connections.get(repository);
}
