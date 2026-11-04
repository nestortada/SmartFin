// Phase 1a.3B Node reference for the Android campaigns phase1a3b-upgrade, -startup-seed, -startup-upgrade,
// -upgrade-restart, -migration-atomicity, -integrity and -flows. The probes (scripts/phase1a3b/probes.ts) run the
// production migration, use cases and repositories on a managed node:sqlite connection, in the same order as the APK.
// The run must equal docs/validacion-fase1a3b/node/results.json field by field (the
// reference is never rewritten).
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
// 1a.4B: HISTORICAL REPRODUCIBILITY. The 1a.4B steps (D6 reversal of a payment's allocations and the guard that rejects
// destructive changes to a purchase with active allocations) are neutralized, so the code must still reproduce the
// recorded references exactly (the old contract blocked deleting a payment with an active allocation). The current
// behaviour is covered by __tests__/extraordinaryInstallmentPaymentPhase1a4B.test.ts.
jest.mock('../src/modules/creditCards/useCases/installmentAllocationReversal', () => ({
  ...jest.requireActual('../src/modules/creditCards/useCases/installmentAllocationReversal'),
  reverseActivePaymentAllocations: async () => [],
  requireNoActiveInstallmentAllocations: async () => undefined,
}));
// 1a.4A: this suite now checks HISTORICAL REPRODUCIBILITY only. The single 1a.4A step (revision 0 when a plan is
// created) is neutralized, so the current code must still reproduce the recorded 1a.3B reference exactly. The
// current code, with revision 0, is compared with docs/validacion-fase1a4a/node/results.json and, read only, with this
// reference by __tests__/phase1a4aAndroidEquivalence.test.ts.
jest.mock('../src/modules/creditCards/useCases/initialInstallmentRevision', () => ({
  ...jest.requireActual('../src/modules/creditCards/useCases/initialInstallmentRevision'),
  recordInitialInstallmentRevision: async () => undefined,
}));
import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { manageSQLiteDatabase } from '../src/database/managedSQLite';
import { SHARED_LOSS_SCHEMA } from '../src/modules/transactions/database/sharedLossSchema';
import {
  SHARED_EXPENSE_INDEXES,
  SHARED_EXPENSE_SCHEMA,
  SHARED_EXPENSE_TRIGGERS,
} from '../src/modules/transactions/database/sharedExpenseSchema';
import { INSTALLMENT_HISTORY_SCHEMA } from '../src/modules/creditCards/database/installmentHistorySchema';
import {
  checkPhase1A3BAfterRestart, checkPhase1A3BStartupUpgrade, classifyNumericTextInsert, PHASE1A3B_INTEGRITY_PROBES, PHASE1A3B_MIGRATION_FAULTS,
  runPhase1A3BFlows, runPhase1A3BIntegrityProbe, runPhase1A3BMigrationFault, runPhase1A3BUpgrade, seedPhase1A3BStartupUpgrade,
} from '../scripts/phase1a3b/probes';

const fs = require('node:fs') as {
  readFileSync: (path: string, encoding: 'utf8') => string;
  mkdirSync: (path: string, options: { recursive: boolean }) => void;
  mkdtempSync: (prefix: string) => string;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
  writeFileSync: (path: string, value: string) => void;
};
const { join } = require('node:path') as { join: (...parts: string[]) => string };
const { tmpdir } = require('node:os') as { tmpdir: () => string };
const nodeProcess = require('node:process') as { version: string; env: Record<string, string | undefined> };
const REFERENCE = 'docs/validacion-fase1a3b/node/results.json';
// Same statement filter as applySchema (src/database/sqliteDatabase.ts): what the APK runs at every start.
const DEFERRED = [...SHARED_LOSS_SCHEMA, ...SHARED_EXPENSE_SCHEMA, ...SHARED_EXPENSE_INDEXES, ...SHARED_EXPENSE_TRIGGERS,
  ...INSTALLMENT_HISTORY_SCHEMA];

/** A process start of the app: open the file, apply the schema and the versioned migrations, manage the handle. */
type RowKeyOrder = (keys: string[]) => string[];
async function start(syntheticPath?: string, rowKeyOrder?: RowKeyOrder) {
  // The SQL clock is the host clock on Android too: values written with it are normalized or compared within a run.
  const sql = realSQLite({ syntheticPath, rowKeyOrder });
  sql.native.exec('PRAGMA foreign_keys = ON;');
  for (const statement of SQLITE_SCHEMA_STATEMENTS) if (!DEFERRED.includes(statement)) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  return { sql, database: manageSQLiteDatabase(sql.database) };
}

async function campaigns(rowKeyOrder?: RowKeyOrder) {
  let session = await start(undefined, rowKeyOrder);
  let upgrade: unknown;
  try { upgrade = await runPhase1A3BUpgrade(session.database); } finally { session.sql.native.close(); }

  const directory = fs.mkdtempSync(join(tmpdir(), 'smartfin-1a3b-'));
  const path = join(directory, 'synthetic.db');
  const startup: Record<string, unknown> = {};
  try {
    session = await start(path, rowKeyOrder);
    try { startup.seed = await seedPhase1A3BStartupUpgrade(session.database); } finally { session.sql.native.close(); }
    session = await start(path, rowKeyOrder);
    try { startup.upgrade = await checkPhase1A3BStartupUpgrade(session.database); } finally { session.sql.native.close(); }
    session = await start(path, rowKeyOrder);
    try { startup.restart = await checkPhase1A3BAfterRestart(session.database); } finally { session.sql.native.close(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }

  const atomicity: Record<string, unknown> = {};
  session = await start(undefined, rowKeyOrder);
  try {
    for (const target of PHASE1A3B_MIGRATION_FAULTS) for (const phase of ['before', 'after'] as const)
      atomicity[`${target} (${phase})`] = await runPhase1A3BMigrationFault(session.database, target, phase);
  } finally { session.sql.native.close(); }

  const integrity: Record<string, unknown> = {};
  session = await start(undefined, rowKeyOrder);
  try {
    for (const name of PHASE1A3B_INTEGRITY_PROBES) integrity[name] = await runPhase1A3BIntegrityProbe(session.database, name);
  } finally { session.sql.native.close(); }

  session = await start(undefined, rowKeyOrder);
  let flows: unknown;
  try {
    const sql = session.sql;
    flows = await runPhase1A3BFlows(session.database, async run => {
      sql.resetTrace(); await run(); return sql.trace.filter(entry => entry.write !== undefined).length;
    });
  } finally { session.sql.native.close(); }
  return { upgrade, startup, atomicity, integrity, flows };
}

let first: Awaited<ReturnType<typeof campaigns>>;
beforeAll(async () => { first = await campaigns(); }, 300000);

test('upgrade creates revision 0 per purchase and keeps every financial value', () => {
  const upgrade = first.upgrade as { after: { history: { revisions: Record<string, unknown>[] } }; migration5Objects: string[];
    repeated: unknown };
  expect(upgrade.after.history.revisions).toHaveLength(6);
  expect(upgrade.after.history.revisions.every(row => row.verification === 'pendingVerification')).toBe(true);
  expect(upgrade.migration5Objects).toEqual(expect.arrayContaining(['installment_allocations', 'installment_plan_revisions',
    'credit_card_billing_rules', 'installment_first_cycles']));
  expect(upgrade.repeated).toEqual({ unchanged: true, runs: 2 });
});

test('the start-up path migrates once across two restarts', () => {
  expect(first.startup.restart).toMatchObject({ migrationRepeated: false, duplicateRevisions: 0, stateIdentical: true });
});

test('all 30 migration fault points roll back to version 4 and recover', () => {
  expect(Object.keys(first.atomicity)).toHaveLength(30);
  for (const point of Object.values(first.atomicity))
    expect(point).toMatchObject({ rolledBack: true, exactVersion4Restored: true, nextOwnerConfirmed: true });
});

test('integrity probes and v4/v5 flows', () => {
  expect(Object.keys(first.integrity)).toEqual([...PHASE1A3B_INTEGRITY_PROBES]);
  const flows = first.flows as { structuralDifferences: Record<string, { backupRevisionDelta: number }> };
  expect(Object.fromEntries(Object.entries(flows.structuralDifferences).map(([step, value]) => [step, value.backupRevisionDelta])))
    .toEqual({ editTerms: 1, payment: 1, deletePayment: 1, deletePurchase: 2 });
});

test('numeric text in amount_cents: only a CHECK rejection or the exact INTEGER 100 is safe', () => {
  // r2 on API 24 (SQLite 3.9.2): CHECK rejection, no row. Node (SQLite 3.53): stored as the INTEGER 100.
  expect(classifyNumericTextInsert({ errorClass: 'check', rows: [] })).toBe('rejected');
  expect(classifyNumericTextInsert({ errorClass: 'accepted', rows: [{ type: 'integer', value: 100 }] })).toBe('acceptedExactInteger');
  for (const unsafe of [
    { errorClass: 'accepted', rows: [{ type: 'text', value: '100' }] },
    { errorClass: 'accepted', rows: [{ type: 'real', value: 100 }] },
    { errorClass: 'accepted', rows: [{ type: 'integer', value: 99 }] },
    { errorClass: 'accepted', rows: [{ type: 'integer', value: 1 }, { type: 'integer', value: 100 }] },
    { errorClass: 'accepted', rows: [] },
    { errorClass: 'check', rows: [{ type: 'text', value: '100' }] },
    { errorClass: 'foreignKey', rows: [] },
    { errorClass: 'other: no such table', rows: [] },
  ]) expect(() => classifyNumericTextInsert(unsafe)).toThrow(/Unsafe numeric text/);
  const constraints = first.integrity.constraints as { result: { numericText: unknown }; engineObserved: { numericText: { outcome: string } } };
  expect(constraints.result.numericText).toEqual({ input: '100', criterion: 'rejectedOrExactInteger', safe: true });
  expect(constraints.engineObserved.numericText.outcome).toBe('acceptedExactInteger');
  // Engine evidence exists only in this probe: nothing else is excluded from the comparison.
  const withEvidence = JSON.stringify(first).match(/"engineObserved"/g) ?? [];
  expect(withEvidence).toHaveLength(1);
});

test('the campaigns are deterministic and equal the recorded Node reference', async () => {
  const second = await campaigns();
  expect(second).toEqual(first);
  // Historical evidence (1a.3B) is immutable: never rewritten from this suite.
  if (nodeProcess.env.SMARTFIN_WRITE_EVIDENCE === '1') throw Error('The 1a.3B Node reference is historical evidence');
  const recorded = JSON.parse(fs.readFileSync(REFERENCE, 'utf8')) as Record<string, unknown>;
  expect({ ...recorded, runtime: undefined }).toEqual(JSON.parse(JSON.stringify({ ...first, runtime: undefined })));
}, 300000);

test('the probes do not depend on the key order of the rows returned by the driver', async () => {
  // r4: the Android driver returned the integer-100 row with another key order and a serialization comparison failed.
  // Same campaigns with two other deterministic orders (the native maps keep one order per key set); every value and
  // every row order must stay identical.
  for (const order of [(keys: string[]) => [...keys].reverse(), (keys: string[]) => [...keys].sort()])
    expect(await campaigns(order)).toEqual(first);
}, 600000);
