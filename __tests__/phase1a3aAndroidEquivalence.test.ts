// Phase 1a.3A Node reference for the Android campaigns phase1a3a-identity, -atomicity, -unknown and
// -unknown-restart. The probes (scripts/phase1a3a/probes.ts) run the production use cases on a managed node:sqlite
// connection, in the same order as the APK. The run must equal docs/validacion-fase1a3a/node/results.json field by
// field (the reference is never rewritten).
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
// 1a.4A: this suite now checks HISTORICAL REPRODUCIBILITY only. The single 1a.4A step (revision 0 when a plan is
// created) is neutralized, so the current code must still reproduce the recorded 1a.3A reference exactly. The
// current code, with revision 0, is compared with docs/validacion-fase1a4a/node/results.json and, read only, with this
// reference by __tests__/phase1a4aAndroidEquivalence.test.ts.
jest.mock('../src/modules/creditCards/useCases/initialInstallmentRevision', () => ({
  ...jest.requireActual('../src/modules/creditCards/useCases/initialInstallmentRevision'),
  recordInitialInstallmentRevision: async () => undefined,
}));
import { InjectedSQLiteFailure, realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { manageSQLiteDatabase } from '../src/database/managedSQLite';
import {
  checkPhase1A3AAfterRestart, PHASE1A3A_MATRICES, PHASE1A3A_PROBES, runPhase1A3AMatrix, runPhase1A3AProbe,
  runPhase1A3AUnknown, type Phase1A3AFaults,
} from '../scripts/phase1a3a/probes';

const fs = require('node:fs') as {
  readFileSync: (path: string, encoding: 'utf8') => string;
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options: { recursive: boolean }) => void;
  mkdtempSync: (prefix: string) => string;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
  writeFileSync: (path: string, value: string) => void;
};
const { join } = require('node:path') as { join: (...parts: string[]) => string };
const { tmpdir } = require('node:os') as { tmpdir: () => string };
const nodeProcess = require('node:process') as { version: string; env: Record<string, string | undefined> };
const REFERENCE = 'docs/validacion-fase1a3a/node/results.json';

function open(syntheticPath?: string, initialize = true) {
  // The SQL clock is the host clock on Android too: only financial_data_revision.updated_at uses it, never compared.
  const sql = realSQLite({ syntheticPath });
  sql.native.exec('PRAGMA foreign_keys = ON;');
  if (initialize) for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
  return sql;
}
async function managed(sql: ReturnType<typeof open>) {
  await applyVersionedMigrations(sql.database);
  return manageSQLiteDatabase(sql.database);
}
function nodeFaults(sql: ReturnType<typeof open>): Phase1A3AFaults {
  return {
    countWrites: async run => { sql.resetTrace(); await run(); return sql.trace.filter(entry => entry.write !== undefined).length; },
    arm: (write, phase) => {
      sql.resetTrace(); sql.injectFault({ write, phase });
      return {
        fired: () => sql.trace.some(entry => entry.write === write && entry.outcome === `injected-${phase}`),
        isInjected: error => error instanceof InjectedSQLiteFailure && error.phase === phase && error.entry.write === write,
      };
    },
    disarm: () => sql.injectFault(),
  };
}

/** The four Android campaigns, with the case names the APK records. */
async function campaigns() {
  const identity: Record<string, unknown> = {};
  let sql = open();
  try {
    const database = await managed(sql);
    for (const name of PHASE1A3A_PROBES) identity[name] = await runPhase1A3AProbe(database, name);
  } finally { sql.native.close(); }

  const atomicity: Record<string, unknown> = {};
  const writes: Record<string, number> = {};
  const writeVerbs: Record<string, string[]> = {};
  sql = open();
  try {
    const database = await managed(sql);
    const record = async (label: string, operation: () => Promise<unknown>) => { atomicity[label] = await operation(); };
    const faults = nodeFaults(sql);
    for (const name of PHASE1A3A_MATRICES) {
      // Also keep the verbs of the counted writes: Node evidence of which statements are the fault points.
      const counting: Phase1A3AFaults = { ...faults, countWrites: async run => {
        const count = await faults.countWrites(run);
        writeVerbs[name] = sql.trace.filter(entry => entry.write !== undefined).map(entry => entry.sql.trim().split(/\s+/).slice(0, 3).join(' '));
        return count;
      } };
      writes[name] = await runPhase1A3AMatrix(database, name, counting, record);
    }
  } finally { sql.native.close(); }

  const directory = fs.mkdtempSync(join(tmpdir(), 'smartfin-1a3a-'));
  const path = join(directory, 'synthetic.db');
  try {
    sql = open(path);
    const database = await managed(sql);
    const unknown = await runPhase1A3AUnknown(database, lost => { if (lost) sql.resetTrace(); sql.injectFault(lost ? { sql: 'COMMIT', phase: 'after' } : undefined); });
    const begins = sql.trace.filter(entry => entry.sql.startsWith('BEGIN')).length;
    try { sql.native.close(); } catch { /* the runner already retired the connection */ }
    const reopened = open(path, false);
    try {
      const restart = await checkPhase1A3AAfterRestart(await managed(reopened));
      return { identity, atomicity, writes, writeVerbs, unknown, restart, begins };
    } finally { reopened.native.close(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

let first: Awaited<ReturnType<typeof campaigns>>;
beforeAll(async () => { first = await campaigns(); }, 120000);

test('identity probes pass their checks on node:sqlite', () => {
  expect(Object.keys(first.identity)).toEqual([...PHASE1A3A_PROBES]);
});

test('matrices keep one write per changed row: the plan edit and the in-place statement payment', () => {
  expect(first.writes).toEqual({ planEdit: 6, statementPayment: 10 });
  // Plan and statement are written with UPDATE in place; the REPLACE verb never appears.
  expect(first.writeVerbs.planEdit).toEqual(['UPDATE transactions SET', 'INSERT INTO transactions', 'UPDATE installment_purchases SET',
    'UPDATE accounts SET', 'INSERT INTO accounts', 'UPDATE credit_card_statements SET']);
  expect(first.writeVerbs.statementPayment!.filter(verb => verb.includes('credit_card_statements'))).toEqual([
    'UPDATE credit_card_statements SET', 'UPDATE credit_card_statements SET']);
  expect(first.writeVerbs.statementPayment!.indexOf('UPDATE credit_card_statements SET')).toBe(2);
  expect([...Object.values(first.writeVerbs)].flat().some(verb => /REPLACE/i.test(verb))).toBe(false);
  const points = Object.keys(first.atomicity).filter(label => label.includes('-rollback-'));
  expect(points).toHaveLength(2 * (6 + 10));
});

test('unknown is never retried and the restart finds the edit once with identity and dependents', () => {
  expect(first.unknown).toEqual({ status: 'unknown', sameFailure: true, connectionRetired: true });
  expect(first.begins).toBe(1);
  expect(first.restart).toMatchObject({ marker: { plan_rowid: 1 } });
});

test('the campaigns are deterministic and equal the recorded Node reference', async () => {
  const second = await campaigns();
  expect(second).toEqual(first);
  const reference = { probes: first.identity, atomicity: first.atomicity, writes: first.writes, unknown: first.unknown, restart: first.restart };
  // Historical evidence (1a.3A) is immutable: never rewritten from this suite.
  if (nodeProcess.env.SMARTFIN_WRITE_EVIDENCE === '1') throw Error('The 1a.3A Node reference is historical evidence');
  const recorded = JSON.parse(fs.readFileSync(REFERENCE, 'utf8')) as Record<string, unknown>;
  expect({ ...recorded, runtime: undefined }).toEqual(JSON.parse(JSON.stringify({ ...reference, runtime: undefined })));
}, 120000);

test('the probes reject the previous INSERT OR REPLACE repository', async () => {
  let failure: unknown;
  await jest.isolateModulesAsync(async () => {
    jest.doMock('../src/modules/creditCards/repositories/sqliteCreditCardRepository', () =>
      jest.requireActual('./helpers/post3BCreditCardRepositoryBaseline'));
    const isolated = require('../scripts/phase1a3a/probes') as typeof import('../scripts/phase1a3a/probes');
    // The managed connection must come from the same isolated registry as the probes' transaction runner.
    const isolatedManaged = require('../src/database/managedSQLite') as typeof import('../src/database/managedSQLite');
    const isolatedMigrations = require('../src/database/migrations') as typeof import('../src/database/migrations');
    const sql = open();
    try {
      await isolatedMigrations.applyVersionedMigrations(sql.database);
      await isolated.runPhase1A3AProbe(isolatedManaged.manageSQLiteDatabase(sql.database), 'statementPaymentInPlace');
    }
    catch (error) { failure = error; } finally { sql.native.close(); }
  });
  expect(String(failure)).toMatch(/identity changed|Dependents lost/);
});
