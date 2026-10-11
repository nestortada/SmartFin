import type { SQLitePrimitive } from '../../src/database/sqliteRows';
import type { financialIntegrityFixture } from './financialIntegrityFixture';

type Fixture = Awaited<ReturnType<typeof financialIntegrityFixture>>;
type Rows = Record<string, SQLitePrimitive>[];

/** All installed tables, all columns, including revision, children and empty tables.
 * No audit fields or monetary differences are normalized away. */
export async function financialState(f: Fixture) {
  const metrics = await f.snapshot();
  const tables: Record<string, Rows> = {};
  const names = f
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
    )
    .rows.raw();
  for (const { name } of names) {
    if (typeof name !== 'string') throw new Error('Invalid table name');
    const escaped = name.replace(/"/g, '""');
    const columns = f.query(`PRAGMA table_info("${escaped}");`).rows.raw();
    const order = columns
      .map(column => {
        if (typeof column.name !== 'string')
          throw new Error('Invalid column name');
        return `"${column.name.replace(/"/g, '""')}"`;
      })
      .join(',');
    tables[name] = f
      .query(`SELECT * FROM "${escaped}" ORDER BY ${order};`)
      .rows.raw();
  }
  return {
    metrics,
    tables,
    integrity: {
      foreignKeys: f.query('PRAGMA foreign_keys;').rows.raw(),
      foreignKeyViolations: f.query('PRAGMA foreign_key_check;').rows.raw(),
      integrityCheck: f.query('PRAGMA integrity_check;').rows.raw(),
    },
  };
}
export type FinancialState = Awaited<ReturnType<typeof financialState>>;

/** Useful in characterization today and as an exact rollback oracle in phases 1/2. */
export function financialStateDifferences(
  before: FinancialState,
  after: FinancialState,
) {
  const changes: string[] = [];
  for (const key of Object.keys(
    before.metrics,
  ) as (keyof FinancialState['metrics'])[]) {
    if (
      JSON.stringify(before.metrics[key]) !== JSON.stringify(after.metrics[key])
    )
      changes.push(`metrics.${key}`);
  }
  for (const name of new Set([
    ...Object.keys(before.tables),
    ...Object.keys(after.tables),
  ])) {
    if (
      JSON.stringify(before.tables[name]) !== JSON.stringify(after.tables[name])
    )
      changes.push(`tables.${name}`);
  }
  if (JSON.stringify(before.integrity) !== JSON.stringify(after.integrity))
    changes.push('integrity');
  return changes;
}

/** Future acceptance: call only when the operation reports a confirmed rollback.
 * Phase 0 checks that this oracle REJECTS the four known partial states. */
export function requireIntegralRollback(
  before: FinancialState,
  after: FinancialState,
) {
  const differences = financialStateDifferences(before, after);
  if (differences.length)
    throw new Error(`Incomplete financial rollback: ${differences.join(', ')}`);
}
