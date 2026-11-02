// Phase 1a.2 Node reference for the Android campaign `phase1a2-statements`. The probes (scripts/phase1a2/probes.ts)
// run the production use cases on node:sqlite with a pinned JS clock and check every figure against an independent
// BigInt oracle; this file also cross-checks them with the jest scenarios and writes the reference the Android
// harness compares field by field (docs/validacion-fase1a2/node/results.json, SMARTFIN_WRITE_EVIDENCE=1).
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { PHASE1A2_PROBES, runPhase1A2Probe, type Phase1A2Probe } from '../scripts/phase1a2/probes';

const fs = require('node:fs') as {
  readFileSync: (path: string, encoding: 'utf8') => string;
  mkdirSync: (path: string, options: { recursive: boolean }) => void;
  writeFileSync: (path: string, value: string) => void;
};
const nodeProcess = require('node:process') as { version: string; env: Record<string, string | undefined> };

const results: Record<string, unknown> = {};
afterAll(() => {
  fs.mkdirSync('docs/validacion-fase1a2/node', { recursive: true });
  fs.writeFileSync('docs/validacion-fase1a2/node/results.json', JSON.stringify({ runtime: nodeProcess.version, probes: results }, null, 2) + '\n');
});

async function probe(name: Phase1A2Probe) {
  // The SQL clock is the host clock on Android: no table compared here depends on it.
  const sql = realSQLite({});
  try {
    sql.native.exec('PRAGMA foreign_keys = ON;');
    for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
    await applyVersionedMigrations(sql.database);
    return await runPhase1A2Probe(sql.database, name);
  } finally { sql.native.close(); }
}

test.each([...PHASE1A2_PROBES])('%s: production use cases satisfy the BigInt oracle', async name => {
  results[name] = await probe(name);
  expect(results[name]).toBeDefined();
});

test('the probes are deterministic: a second run is identical', async () => {
  for (const name of PHASE1A2_PROBES) expect(await probe(name)).toEqual(results[name]);
});

test('the probes agree with the jest scenarios of creditCardStatementsPhase1a2', async () => {
  const after = JSON.parse(fs.readFileSync('docs/correccion-fase1a2/node/after.json', 'utf8')) as {
    A: { statements: { end: string; total: number; minimum: number; status: string }[] }[];
  };
  type Step = { tables: { credit_card_statements: Record<string, unknown>[] } };
  const steps = (results.sixInstallments as { steps: Step[] }).steps;
  const view = (rows: Record<string, unknown>[]) => rows.map(r => [r.statement_end_date, r.total_amount, r.minimum_payment_amount, r.status]);
  expect(view(steps[6]!.tables.credit_card_statements)).toEqual(after.A[6]!.statements.map(s => [s.end, s.total, s.minimum, s.status]));
});

test('the oracle rejects the statements of the reconciliation before 1a.2', async () => {
  let failure: unknown;
  await jest.isolateModulesAsync(async () => {
    // Every importer (saveManualTransaction included) gets the frozen pre-6B.3 reconciliation (pre-1a.2 statements).
    jest.doMock('../src/modules/creditCards/useCases/creditCardTransactionRelations', () => {
      const actual = jest.requireActual('../src/modules/creditCards/useCases/creditCardTransactionRelations');
      const previous = jest.requireActual('./helpers/pre6B3CreditCardRelations');
      return { ...actual, reconcileCreditCardTransactions: previous.reconcileCreditCardTransactions };
    });
    const isolated = require('../scripts/phase1a2/probes') as typeof import('../scripts/phase1a2/probes');
    const sql = realSQLite({});
    try {
      sql.native.exec('PRAGMA foreign_keys = ON;');
      for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
      await applyVersionedMigrations(sql.database);
      await isolated.runPhase1A2Probe(sql.database, 'sixInstallments');
    } catch (error) { failure = error; } finally { sql.native.close(); }
  });
  expect(String(failure)).toContain('Statement 2026-11-20: 0 != 100000');
});
