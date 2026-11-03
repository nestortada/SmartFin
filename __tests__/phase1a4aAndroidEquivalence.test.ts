// Phase 1a.4A Node reference for the Android validation of the CURRENT code (revision 0 of new installment purchases):
// - the new campaigns phase1a4a-* (scripts/phase1a4a/probes.ts);
// - the 1a.3A campaigns with their unchanged probes, and the 1a.3B campaigns with the probes derived by
//   scripts/phase1a4a/derive-probes.cjs (only the integrity preparation differs).
// - r2: the 1a.2 statement probes (phase1a2-statements) on the current code, compared with the historical 1a.2 reference
//   by a strict comparator that only admits correct revision 0 rows; the 6B.3 probes must equal their reference exactly.
// The run must equal docs/validacion-fase1a4a/r2/node/results.json field by field. Regenerating it is an explicit
// operation (SMARTFIN_WRITE_EVIDENCE=1) that refuses to overwrite an existing file; the r1 reference and the 1a.2, 1a.3A,
// 1a.3B and 6B.3 references are only read, to prove that every difference of the current code is an approved effect of
// revision 0 (backup counter and revision rows), never money.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { InjectedSQLiteFailure, realSQLite } from './helpers/realSQLite';
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
  checkPhase1A3AAfterRestart, PHASE1A3A_MATRICES, PHASE1A3A_PROBES, runPhase1A3AMatrix, runPhase1A3AProbe,
  runPhase1A3AUnknown, type Phase1A3AFaults,
} from '../scripts/phase1a3a/probes';
import {
  checkPhase1A3BAfterRestart, checkPhase1A3BStartupUpgrade, PHASE1A3B_INTEGRITY_PROBES, PHASE1A3B_MIGRATION_FAULTS,
  runPhase1A3BFlows, runPhase1A3BIntegrityProbe, runPhase1A3BMigrationFault, runPhase1A3BUpgrade, seedPhase1A3BStartupUpgrade,
} from '../scripts/phase1a4a/phase1a3bProbes';
import {
  checkPhase1A4AAfterRestart, PHASE1A4A_CREATION_CASES, PHASE1A4A_MATRICES, runPhase1A4ACompatibility, runPhase1A4ACreation,
  runPhase1A4AInvariants, runPhase1A4ALifecycle, runPhase1A4AMatrix, runPhase1A4AUnknown, type Phase1A4AFaults,
} from '../scripts/phase1a4a/probes';
import { PHASE1A2_PROBES, runPhase1A2Probe } from '../scripts/phase1a2/probes';
import { PHASE6B3_DATE, PHASE6B3_PROBES, runPhase6B3Probe } from '../scripts/phase6b3/probes';
import * as previousCards from './helpers/pre6B3CreditCardRelations';
import { buildInitialInstallmentRevision } from '../src/modules/creditCards/useCases/initialInstallmentRevision';
import { parseCreditCardVisualMetadata } from '../src/modules/creditCards/useCases/manageCreditCards';
import { transactionDateKey } from '../src/shared/utils/transactionDate';
import type { InstallmentPurchase } from '../src/modules/creditCards/types';

const fs = require('node:fs') as {
  readFileSync: (path: string, encoding?: 'utf8') => string & Uint8Array;
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options: { recursive: boolean }) => void;
  mkdtempSync: (prefix: string) => string;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
  writeFileSync: (path: string, value: string) => void;
};
const { join } = require('node:path') as { join: (...parts: string[]) => string };
const { tmpdir } = require('node:os') as { tmpdir: () => string };
const { createHash } = require('node:crypto') as { createHash: (name: string) => { update: (data: Uint8Array) => { digest: (encoding: 'hex') => string } } };
const nodeProcess = require('node:process') as { version: string; env: Record<string, string | undefined> };
const REFERENCE = 'docs/validacion-fase1a4a/r2/node/results.json';
const R1_REFERENCE = 'docs/validacion-fase1a4a/node/results.json';
const HISTORICAL = {
  phase1a3a: 'docs/validacion-fase1a3a/node/results.json',
  phase1a3b: 'docs/validacion-fase1a3b/node/results.json',
  phase1a2: 'docs/validacion-fase1a2/node/results.json',
  phase6b3: 'docs/correccion-fase6b3/node/results.json',
} as const;
// Same statement filter as applySchema (src/database/sqliteDatabase.ts): what the APK runs at every start.
const DEFERRED = [...SHARED_LOSS_SCHEMA, ...SHARED_EXPENSE_SCHEMA, ...SHARED_EXPENSE_INDEXES, ...SHARED_EXPENSE_TRIGGERS,
  ...INSTALLMENT_HISTORY_SCHEMA];

type Sql = ReturnType<typeof realSQLite>;
/** A process start of the app: open the file, apply the schema and the versioned migrations, manage the handle. */
type RowKeyOrder = (keys: string[]) => string[];
let rowKeyOrder: RowKeyOrder | undefined;
async function start(syntheticPath?: string) {
  const sql = realSQLite({ syntheticPath, rowKeyOrder });
  sql.native.exec('PRAGMA foreign_keys = ON;');
  for (const statement of SQLITE_SCHEMA_STATEMENTS) if (!DEFERRED.includes(statement)) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  return { sql, database: manageSQLiteDatabase(sql.database) };
}
function nodeFaults(sql: Sql): Phase1A3AFaults & Phase1A4AFaults {
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
const verbs = (sql: Sql) => sql.trace.filter(entry => entry.write !== undefined).map(entry => entry.sql.trim().split(/\s+/).slice(0, 3).join(' '));
async function withFile<T>(prefix: string, run: (path: string) => Promise<T>): Promise<T> {
  const directory = fs.mkdtempSync(join(tmpdir(), prefix));
  try { return await run(join(directory, 'synthetic.db')); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

/** phase1a4a-creation, -lifecycle, -compatibility, -invariants, -atomicity, -unknown, -unknown-restart. */
async function campaigns1a4a() {
  const creation: Record<string, unknown> = {};
  let session = await start();
  try { for (const name of PHASE1A4A_CREATION_CASES) creation[name] = await runPhase1A4ACreation(session.database, name); }
  finally { session.sql.native.close(); }

  session = await start();
  let lifecycle: unknown;
  try { lifecycle = await runPhase1A4ALifecycle(session.database, nodeFaults(session.sql).countWrites); } finally { session.sql.native.close(); }

  session = await start();
  let compatibility: unknown;
  try { compatibility = await runPhase1A4ACompatibility(session.database); } finally { session.sql.native.close(); }

  session = await start();
  let invariants: unknown;
  try { invariants = await runPhase1A4AInvariants(session.database); } finally { session.sql.native.close(); }

  const atomicity: Record<string, unknown> = {};
  const writes: Record<string, number> = {};
  const writeVerbs: Record<string, string[]> = {};
  session = await start();
  try {
    const sql = session.sql;
    const faults = nodeFaults(sql);
    const record = async (label: string, operation: () => Promise<unknown>) => { atomicity[label] = await operation(); };
    for (const name of PHASE1A4A_MATRICES)
      writes[name] = await runPhase1A4AMatrix(session.database, name, { ...faults, countWrites: async run => {
        const count = await faults.countWrites(run); writeVerbs[name] = verbs(sql); return count;
      } }, record);
  } finally { session.sql.native.close(); }

  const { unknown, restart, begins, revisionInserts } = await withFile('smartfin-1a4a-', async path => {
    const first = await start(path);
    const result = await runPhase1A4AUnknown(first.database, lost => {
      if (lost) first.sql.resetTrace();
      first.sql.injectFault(lost ? { sql: 'COMMIT', phase: 'after' } : undefined);
    });
    const trace = first.sql.trace;
    try { first.sql.native.close(); } catch { /* the runner already retired the connection */ }
    const reopened = await start(path);
    try {
      return { unknown: result, restart: await checkPhase1A4AAfterRestart(reopened.database),
        begins: trace.filter(entry => entry.sql.startsWith('BEGIN')).length,
        revisionInserts: trace.filter(entry => entry.sql.trim().startsWith('INSERT INTO installment_plan_revisions')).length };
    } finally { reopened.sql.native.close(); }
  });
  return { creation, lifecycle, compatibility, invariants, atomicity, writes, writeVerbs, unknown, restart, begins, revisionInserts };
}

/** The four 1a.3A campaigns with their unchanged probes, as in __tests__/phase1a3aAndroidEquivalence.test.ts. */
async function campaigns1a3a() {
  const identity: Record<string, unknown> = {};
  let session = await start();
  try { for (const name of PHASE1A3A_PROBES) identity[name] = await runPhase1A3AProbe(session.database, name); }
  finally { session.sql.native.close(); }
  const atomicity: Record<string, unknown> = {};
  const writes: Record<string, number> = {};
  const writeVerbs: Record<string, string[]> = {};
  session = await start();
  try {
    const sql = session.sql;
    const faults = nodeFaults(sql);
    const record = async (label: string, operation: () => Promise<unknown>) => { atomicity[label] = await operation(); };
    for (const name of PHASE1A3A_MATRICES)
      writes[name] = await runPhase1A3AMatrix(session.database, name, { ...faults, countWrites: async run => {
        const count = await faults.countWrites(run); writeVerbs[name] = verbs(sql); return count;
      } }, record);
  } finally { session.sql.native.close(); }
  return withFile('smartfin-1a4a-1a3a-', async path => {
    const first = await start(path);
    const unknown = await runPhase1A3AUnknown(first.database, lost => {
      if (lost) first.sql.resetTrace();
      first.sql.injectFault(lost ? { sql: 'COMMIT', phase: 'after' } : undefined);
    });
    const begins = first.sql.trace.filter(entry => entry.sql.startsWith('BEGIN')).length;
    try { first.sql.native.close(); } catch { /* retired */ }
    const reopened = await start(path);
    try {
      return { probes: identity, atomicity, writes, writeVerbs, unknown, restart: await checkPhase1A3AAfterRestart(reopened.database), begins };
    } finally { reopened.sql.native.close(); }
  });
}

/** The seven 1a.3B campaigns with the derived probes, as in __tests__/phase1a3bAndroidEquivalence.test.ts. */
async function campaigns1a3b() {
  let session = await start();
  let upgrade: unknown;
  try { upgrade = await runPhase1A3BUpgrade(session.database); } finally { session.sql.native.close(); }
  const startup = await withFile('smartfin-1a4a-1a3b-', async path => {
    const result: Record<string, unknown> = {};
    let current = await start(path);
    try { result.seed = await seedPhase1A3BStartupUpgrade(current.database); } finally { current.sql.native.close(); }
    current = await start(path);
    try { result.upgrade = await checkPhase1A3BStartupUpgrade(current.database); } finally { current.sql.native.close(); }
    current = await start(path);
    try { result.restart = await checkPhase1A3BAfterRestart(current.database); } finally { current.sql.native.close(); }
    return result;
  });
  const atomicity: Record<string, unknown> = {};
  session = await start();
  try {
    for (const target of PHASE1A3B_MIGRATION_FAULTS) for (const phase of ['before', 'after'] as const)
      atomicity[`${target} (${phase})`] = await runPhase1A3BMigrationFault(session.database, target, phase);
  } finally { session.sql.native.close(); }
  const integrity: Record<string, unknown> = {};
  session = await start();
  try { for (const name of PHASE1A3B_INTEGRITY_PROBES) integrity[name] = await runPhase1A3BIntegrityProbe(session.database, name); }
  finally { session.sql.native.close(); }
  session = await start();
  let flows: unknown;
  try { flows = await runPhase1A3BFlows(session.database, nodeFaults(session.sql).countWrites); } finally { session.sql.native.close(); }
  return { upgrade, startup, atomicity, integrity, flows };
}

/** phase1a2-statements on the current code: every probe on a fresh database opened as the APK does. */
async function campaigns1a2(raw = false) {
  const probes: Record<string, unknown> = {};
  for (const name of PHASE1A2_PROBES) {
    const session = await start();
    try { probes[name] = await runPhase1A2Probe(raw ? session.sql.database : session.database, name); }
    finally { session.sql.native.close(); }
  }
  return { probes };
}

async function campaigns() {
  return { phase1a4a: await campaigns1a4a(), phase1a3a: await campaigns1a3a(), phase1a3b: await campaigns1a3b(),
    phase1a2: await campaigns1a2() };
}

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
/**
 * Strict comparator of the 1a.2 probes against the historical reference. Outside the step tables everything must be
 * identical. In every step, all tables but installment_plan_revisions must be identical, and that table, absent from
 * the reference, must hold exactly the history the use case writes for the plans of that step: an original revision 0
 * per plan (or a new original after a removal), contiguous numbers and deterministic ids, no orphan, and each current
 * original equal, field by field, to the 1a.1 engine result for the plan row, its movement date and the card rules.
 */
function compare1a2(current: unknown, reference: unknown, path = '$', errors: string[] = []): string[] {
  if (Array.isArray(current) && Array.isArray(reference)) {
    if (current.length !== reference.length) errors.push(`${path}: length ${current.length} != ${reference.length}`);
    current.forEach((item, index) => compare1a2(item, reference[index], `${path}.${index}`, errors));
  } else if (current && reference && typeof current === 'object' && typeof reference === 'object'
    && !Array.isArray(current) && !Array.isArray(reference)) {
    for (const key of new Set([...Object.keys(current), ...Object.keys(reference)])) {
      const value = (current as Row)[key];
      const before = (reference as Row)[key];
      if (key === 'tables' && value && before && typeof value === 'object' && typeof before === 'object')
        compareTables(value as Tables, before as Tables, `${path}.tables`, errors);
      else compare1a2(value, before, `${path}.${key}`, errors);
    }
  } else if (JSON.stringify(current) !== JSON.stringify(reference)) {
    errors.push(`${path}: ${JSON.stringify(reference)} -> ${JSON.stringify(current)}`);
  }
  return errors;
}
const sortedHistory = (rows: Row[]) => [...rows].sort((a, b) => Number(a.revision_number) - Number(b.revision_number));
/** Plans the 1a.2 probes insert by SQL, not through the use case (scripts/phase1a2/probes.ts, calendarStates): no history. */
const PLANS_OUTSIDE_USE_CASE = new Set(['installment-legacy-inexact']);
function compareTables(current: Tables, reference: Tables, path: string, errors: string[]) {
  if ('installment_plan_revisions' in reference) errors.push(`${path}: the historical reference already has revisions`);
  for (const name of new Set([...Object.keys(current), ...Object.keys(reference)])) {
    if (name !== 'installment_plan_revisions' && JSON.stringify(current[name]) !== JSON.stringify(reference[name]))
      errors.push(`${path}.${name}: table differs`);
  }
  const plans = current.installment_purchases ?? [];
  const byPlan = new Map<string, Row[]>();
  for (const row of current.installment_plan_revisions ?? [])
    byPlan.set(String(row.installment_purchase_id), [...(byPlan.get(String(row.installment_purchase_id)) ?? []), row]);
  for (const [planId, rows] of byPlan) {
    const history = sortedHistory(rows);
    history.forEach((row, index) => {
      if (row.revision_number !== index || row.id !== `${planId}:revision:${index}`) errors.push(`${path}: ${planId} numbering or id at ${index}`);
      if (index === 0 && row.source !== 'original') errors.push(`${path}: ${planId} does not start with an original revision`);
      if (index > 0 && row.source === 'original' && history[index - 1]!.source !== 'purchaseRemoval') errors.push(`${path}: ${planId} duplicate original`);
      if (row.allocation_id !== null) errors.push(`${path}: ${planId} allocation reference`);
    });
    if (!plans.some(plan => plan.id === planId) && history[history.length - 1]!.source !== 'purchaseRemoval')
      errors.push(`${path}: orphan revision history ${planId}`);
  }
  for (const plan of plans) {
    if (PLANS_OUTSIDE_USE_CASE.has(String(plan.id))) {
      if (byPlan.has(String(plan.id))) errors.push(`${path}: history invented for ${String(plan.id)}`);
      continue;
    }
    const originals = sortedHistory(byPlan.get(String(plan.id)) ?? []).filter(row => row.source === 'original');
    const original = originals[originals.length - 1];
    const movement = (current.transactions ?? []).find(row => row.id === plan.transaction_id);
    if (!original || !movement) { errors.push(`${path}: plan ${String(plan.id)} without revision 0 or movement`); continue; }
    const account = (current.accounts ?? []).find(row => row.id === plan.account_id);
    const rules = (current.credit_card_billing_rules ?? []).find(row => row.account_id === plan.account_id);
    const firstCycle = (current.installment_first_cycles ?? []).find(row => row.installment_purchase_id === plan.id);
    const purchase: InstallmentPurchase = {
      id: String(plan.id), transactionId: String(plan.transaction_id), accountId: String(plan.account_id),
      totalAmount: Number(plan.total_amount), currency: 'COP', installmentCount: Number(plan.installment_count),
      paidInstallments: Number(plan.paid_installments), monthlyAmount: Number(plan.monthly_amount), status: 'active',
      createdAt: String(plan.created_at), updatedAt: String(plan.updated_at),
    };
    const expected = buildInitialInstallmentRevision({
      purchase,
      purchaseDate: transactionDateKey({ date: String(movement.date),
        civilDate: typeof movement.civil_date === 'string' ? movement.civil_date : undefined }),
      billing: {
        closingDay: parseCreditCardVisualMetadata(typeof account?.description === 'string' ? account.description : undefined).closingDay,
        closingDayPurchasePolicy: rules?.closing_day_purchase_policy === 'closingCycle' || rules?.closing_day_purchase_policy === 'nextCycle'
          ? rules.closing_day_purchase_policy : undefined,
      },
      ...(firstCycle ? { confirmedFirstCycle: { cycleEnd: String(firstCycle.cycle_end),
        source: firstCycle.source === 'statement' ? 'statement' as const : 'user' as const } } : {}),
      createdAt: String(original.created_at),
    });
    const stored = [original.remaining_principal_cents, original.remaining_installments, original.installment_amount_cents,
      original.effective_cycle_end, original.verification, original.pending_reasons,
      original.basis_total_amount, original.basis_monthly_amount, original.basis_installment_count];
    const engine = [expected.remainingPrincipalCents, expected.remainingInstallments, expected.installmentAmountCents,
      expected.effectiveCycleEnd, expected.verification, expected.pendingReasons.length ? expected.pendingReasons.join(',') : null,
      plan.total_amount, plan.monthly_amount, plan.installment_count];
    if (JSON.stringify(stored) !== JSON.stringify(engine))
      errors.push(`${path}: revision 0 of ${String(plan.id)} ${JSON.stringify(stored)} != ${JSON.stringify(engine)}`);
  }
}

type Difference = { path: string; historical: unknown; current: unknown };
function differences(current: unknown, historical: unknown, path = '$', out: Difference[] = []): Difference[] {
  if (current && historical && typeof current === 'object' && typeof historical === 'object') {
    for (const key of new Set([...Object.keys(current), ...Object.keys(historical)]))
      differences((current as Record<string, unknown>)[key], (historical as Record<string, unknown>)[key], `${path}.${key}`, out);
  } else if (JSON.stringify(current) !== JSON.stringify(historical)) out.push({ path, historical, current });
  return out;
}
const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const historical = (name: keyof typeof HISTORICAL) => {
  const recorded = JSON.parse(fs.readFileSync(HISTORICAL[name], 'utf8')) as Record<string, unknown>;
  delete recorded.runtime;
  return recorded;
};

let first: Awaited<ReturnType<typeof campaigns>>;
beforeAll(async () => { first = JSON.parse(JSON.stringify(await campaigns())); }, 600000);

describe('phase1a4a campaigns', () => {
  test('creation and recreation write 7 times each: 28 failure points, revision 0 right after the plan row', () => {
    const { writes, writeVerbs, atomicity } = first.phase1a4a;
    expect(writes).toEqual({ creation: 7, recreation: 7 });
    const expected = ['UPDATE transactions SET', 'INSERT INTO transactions', 'INSERT INTO installment_purchases',
      'INSERT INTO installment_plan_revisions', 'UPDATE accounts SET', 'INSERT INTO accounts', 'INSERT INTO credit_card_statements'];
    expect(writeVerbs.creation).toEqual(expected);
    // The recreation updates the movement and the existing statement; the plan row and its revision are new again.
    expect(writeVerbs.recreation!.slice(2, 4)).toEqual(['INSERT INTO installment_purchases', 'INSERT INTO installment_plan_revisions']);
    const points = Object.entries(atomicity as Record<string, { exactStateRestored?: boolean }>).filter(([label]) => label.includes('-rollback-'));
    expect(points).toHaveLength(28);
    expect(points.every(([, value]) => value.exactStateRestored === true)).toBe(true);
  });

  test('lifecycle: only creating a plan adds a write; ordinary edits, term changes and removals keep their count', () => {
    const steps = first.phase1a4a.lifecycle as Record<string, { writes: number; history: unknown[][] }>;
    expect(Object.fromEntries(Object.entries(steps).map(([label, step]) => [label, step.writes]))).toEqual({
      // Debit conversions also write the bank account: 8 without a plan, 8 + 1 (revision 0) when the plan is recreated.
      create: 7, renameOnly: 6, renameAgain: 6, threeToSix: 6, toSingle: 6, recreateFour: 7, toDebit: 8, backToCredit: 9,
      quickSameTerms: 6, quickToSingle: 6, quickToThree: 7, delete: 22,
    });
    expect(steps.delete!.history.map(row => row[1])).toEqual(['original', 'purchaseEdit', 'purchaseRemoval', 'original',
      'purchaseRemoval', 'original', 'purchaseRemoval', 'original', 'purchaseRemoval']);
  });

  test('creation cases keep exact cents, D2 base, legacy basis and the 1a.1 verification meaning', () => {
    const revision = (name: string) => (first.phase1a4a.creation as Record<string, { revision: unknown[] }>)[name]!.revision;
    expect(revision('exact')).toEqual([0, 'original', 'projected', null, 30000000, 3, 10000000, '2026-10-20']);
    expect(revision('cents')).toEqual([0, 'original', 'projected', null, 123457, 6, 20576, '2026-10-20']);
    expect(revision('noClosingDay')).toEqual([0, 'original', 'pendingVerification', 'firstCycleUnconfirmed', 30000000, 3, 10000000, null]);
    expect(revision('closingDayWithoutPolicy')).toEqual([0, 'original', 'pendingVerification', 'firstCycleUnconfirmed', 30000000, 3, 10000000, null]);
    expect(revision('closingDayClosingCycle')).toEqual([0, 'original', 'projected', null, 30000000, 3, 10000000, '2026-10-11']);
    expect(revision('closingDayNextCycle')).toEqual([0, 'original', 'projected', null, 30000000, 3, 10000000, '2026-11-11']);
    expect(revision('inexactAmount')).toEqual([0, 'original', 'pendingVerification', 'inexactHistoricalAmount', null, 3, null, '2026-10-20']);
    expect(revision('zeroCentInstallments')).toEqual([0, 'original', 'pendingVerification', 'zeroCentInstallments', 2, 3, 0, '2026-10-20']);
    expect(revision('tooManyInstallments')).toEqual([0, 'original', 'pendingVerification', 'invalidInstallmentCount', 40000000, null, null, '2026-10-20']);
    expect((first.phase1a4a.creation as Record<string, { gapRevision: { verification: string; effectiveCycleEnd: string } }>)
      .confirmedFirstCycle!.gapRevision).toMatchObject({ verification: 'confirmed', effectiveCycleEnd: '2026-11-20' });
    for (const value of Object.values(first.phase1a4a.creation as Record<string, { backupRevisionDelta: number }>))
      expect(value.backupRevisionDelta).toBeGreaterThan(0);
  });

  test('compatibility: migrated and new purchases keep one revision 0; the intermediate plan is listed for lazy initialization', () => {
    const compatibility = first.phase1a4a.compatibility as { pendingLazyInitialization: string[]; gapEditRevisionDelta: number };
    expect(compatibility.pendingLazyInitialization).toHaveLength(1);
    expect(compatibility.gapEditRevisionDelta).toBe(0);
  });

  test('unknown is never retried; after reopening there is one purchase with exactly one revision 0', () => {
    expect(first.phase1a4a.unknown).toEqual({ status: 'unknown', sameFailure: true, connectionRetired: true });
    expect(first.phase1a4a.begins).toBe(1);
    expect(first.phase1a4a.revisionInserts).toBe(1);
  });
});

describe('write count before and after 1a.4A (same flow, revision 0 step neutralized in an isolated registry)', () => {
  test('only creating or recreating a plan adds exactly one write, the revision 0 INSERT; nothing else changes', async () => {
    let previous: Record<string, { writes: number; observation: Record<string, unknown> }> = {};
    const path = '../src/modules/creditCards/useCases/initialInstallmentRevision';
    await jest.isolateModulesAsync(async () => {
      jest.doMock(path, () => ({ ...jest.requireActual(path), recordInitialInstallmentRevision: async () => undefined }));
      const probes = require('../scripts/phase1a4a/probes') as typeof import('../scripts/phase1a4a/probes');
      // The managed connection must come from the same isolated registry as the probes' transaction runner.
      const managed = require('../src/database/managedSQLite') as typeof import('../src/database/managedSQLite');
      const migrations = require('../src/database/migrations') as typeof import('../src/database/migrations');
      const sql = realSQLite();
      try {
        sql.native.exec('PRAGMA foreign_keys = ON;');
        for (const statement of SQLITE_SCHEMA_STATEMENTS) if (!DEFERRED.includes(statement)) sql.native.exec(statement);
        await migrations.applyVersionedMigrations(sql.database);
        previous = JSON.parse(JSON.stringify(await probes.runPhase1A4ALifecycle(managed.manageSQLiteDatabase(sql.database),
          nodeFaults(sql).countWrites, false)));
      } finally { sql.native.close(); }
    });
    jest.dontMock(path);
    const current = first.phase1a4a.lifecycle as Record<string, { writes: number; observation: Record<string, unknown> }>;
    const delta = Object.fromEntries(Object.entries(current).map(([label, step]) => [label, step.writes - previous[label]!.writes]));
    expect(delta).toEqual({ create: 1, renameOnly: 0, renameAgain: 0, threeToSix: 0, toSingle: 0, recreateFour: 1, toDebit: 0,
      backToCredit: 1, quickSameTerms: 0, quickToSingle: 0, quickToThree: 1, delete: 0 });
    // Same money, movements, plans and statements after every step; only history rows and the backup counter differ.
    for (const [label, step] of Object.entries(current)) {
      const { revisions, backupRevision, ...money } = step.observation;
      const { revisions: previousRevisions, backupRevision: previousCounter, ...previousMoney } = previous[label]!.observation;
      expect([label, money]).toEqual([label, previousMoney]);
      expect(previousRevisions).toEqual([]);
      expect(Number(backupRevision) - Number(previousCounter)).toBe((revisions as unknown[]).length);
    }
  });
});

describe('regressions on the current code', () => {
  test('1a.3A: same matrices, verbs, failure points and unknown behaviour as validated', () => {
    const current = first.phase1a3a;
    expect(Object.keys(current.probes)).toEqual([...PHASE1A3A_PROBES]);
    expect(current.writes).toEqual({ planEdit: 6, statementPayment: 10 });
    expect(current.writeVerbs.planEdit).toEqual(['UPDATE transactions SET', 'INSERT INTO transactions', 'UPDATE installment_purchases SET',
      'UPDATE accounts SET', 'INSERT INTO accounts', 'UPDATE credit_card_statements SET']);
    expect(Object.keys(current.atomicity).filter(label => label.includes('-rollback-'))).toHaveLength(2 * (6 + 10));
    expect(current.unknown).toEqual({ status: 'unknown', sameFailure: true, connectionRetired: true });
    expect(current.begins).toBe(1);
  });

  test('1a.3B: 30 migration points, revision 0 per migrated plan, the same v4/v5 flow deltas', () => {
    const current = first.phase1a3b;
    expect(Object.keys(current.atomicity)).toHaveLength(30);
    for (const point of Object.values(current.atomicity))
      expect(point).toMatchObject({ rolledBack: true, exactVersion4Restored: true, nextOwnerConfirmed: true });
    expect((current.upgrade as { after: { history: { revisions: unknown[] } } }).after.history.revisions).toHaveLength(6);
    expect(current.startup.restart).toMatchObject({ migrationRepeated: false, duplicateRevisions: 0, stateIdentical: true });
    expect(Object.keys(current.integrity)).toEqual([...PHASE1A3B_INTEGRITY_PROBES]);
    const flows = current.flows as { structuralDifferences: Record<string, { backupRevisionDelta: number }> };
    expect(Object.fromEntries(Object.entries(flows.structuralDifferences).map(([step, value]) => [step, value.backupRevisionDelta])))
      .toEqual({ editTerms: 1, payment: 1, deletePayment: 1, deletePurchase: 2 });
  });
});

describe('approved differences against the historical references (read only)', () => {
  test('the historical 1a.2, 1a.3A, 1a.3B and 6B.3 references keep the hashes pinned by the 1a.3B r5 inventory', () => {
    const inventory = JSON.parse(fs.readFileSync('docs/validacion-fase1a3b/r5/authorization/inputs.sha256.json', 'utf8')) as
      { sources: Record<string, string> };
    for (const file of Object.values(HISTORICAL)) expect(sha256(file)).toBe(inventory.sources[file]);
  });

  test('1a.3A: only the backup counter moves, upwards, by the revision rows of the purchases', () => {
    // The historical reference recorded these five parts (verbs and BEGIN count were asserted, not recorded).
    const { probes, atomicity, writes, unknown, restart } = first.phase1a3a;
    const found = differences({ probes, atomicity, writes, unknown, restart }, historical('phase1a3a'));
    expect(found.length).toBeGreaterThan(0);
    for (const { path, historical: before, current } of found) {
      expect(path).toMatch(/\.(revision|revisionDelta)$/);
      expect(typeof before === 'number' && typeof current === 'number' && current - before >= 1 && current - before <= 2).toBe(true);
    }
  });

  test('1a.3B: migration, start-up and flows differ only in the backup counter; the 30 migration points are identical', () => {
    const current = first.phase1a3b;
    const reference = historical('phase1a3b') as typeof current;
    expect(current.atomicity).toEqual(reference.atomicity);
    for (const part of ['upgrade', 'startup', 'flows'] as const) {
      const found = differences(current[part], reference[part]);
      expect(found.length).toBeGreaterThan(0);
      for (const { path, historical: before, current: value } of found) {
        expect(path).toMatch(/\.backupRevision$/);
        expect(typeof before === 'number' && typeof value === 'number' && value > before).toBe(true);
      }
    }
  });

  test('1a.3B integrity: only the verification fields of the two revisions 0 differ (projected by the use case)', () => {
    const current = first.phase1a3b.integrity as Record<string, unknown>;
    const reference = (historical('phase1a3b') as { integrity: Record<string, unknown> }).integrity;
    const { purchaseRecreation, ...others } = current;
    const { purchaseRecreation: historicalRecreation, ...historicalOthers } = reference;
    const found = differences(others, historicalOthers);
    const allowed = /\.(backupRevision|effective_cycle_end|effectiveCycleEnd|verification|pending_reasons|pendingReasons(\.\d+)?|created_at|createdAt)$/;
    for (const { path } of found) expect(path).toMatch(allowed);
    // Each difference is a revision 0 that the 1a.3B probes appended by hand as pending and the use case now projects.
    for (const { path, historical: before, current: value } of found.filter(entry => /verification$/.test(entry.path)))
      expect([path, before, value]).toEqual([path, 'pendingVerification', 'projected']);
    // Money, movements, plans, statements and every error class of the probes are unchanged.
    expect(found.filter(({ path }) => /balance_amount|debt_balance|availableCredit|summary|amount_cents|total_amount|statements|errorClass/.test(path)))
      .toEqual([]);
    console.log('PHASE1A4A_INTEGRITY_DIFFERENCES ' + JSON.stringify(found.map(({ path }) => path)));
    // purchaseRecreation changed its scenario (derive-probes.cjs): the recreation by the use case brings revision 2
    // (original); the trigger rule keeps rejecting a non-original after the out-of-band removal, exactly as before.
    const recreation = (purchaseRecreation as { result: Record<string, unknown> }).result;
    const before = (historicalRecreation as { result: Record<string, unknown> }).result;
    expect(recreation.afterRecreation).toBe(before.afterRecreation);
    expect(recreation.nonOriginal).toEqual(before.nonOriginal);
    expect(recreation.secondOriginal).toBe('other: La compra ya tiene una revisión original vigente.');
    expect(recreation.sources).toEqual(['original', 'purchaseRemoval', 'original', 'purchaseRemoval', 'original']);
    expect(before.sources).toEqual(['original', 'purchaseRemoval', 'original']);
  });
});

describe('phase1a2-statements on the current code (r2)', () => {
  const historical1a2 = () => (historical('phase1a2') as { probes: Record<string, unknown> }).probes;

  test('the comparator admits only correct revision 0 rows: every other table and field equals the 1a.2 reference', () => {
    expect(Object.keys(first.phase1a2.probes)).toEqual([...PHASE1A2_PROBES]);
    expect(compare1a2(first.phase1a2.probes, historical1a2())).toEqual([]);
    // Each probe really adds revision rows (the comparator is not vacuous) and only original revisions.
    for (const name of PHASE1A2_PROBES) {
      const text = JSON.stringify(first.phase1a2.probes[name]);
      expect([name, text.includes('"installment_plan_revisions"')]).toEqual([name, true]);
      expect([...new Set([...text.matchAll(/"source":"(original|purchaseEdit|purchaseRemoval|allocation|statement)"/g)].map(m => m[1]))])
        .toEqual(['original']);
    }
  });

  test('the comparator fails on a deliberate difference in a synthetic copy (money, history, tables)', () => {
    const mutate = (change: (probes: Record<string, any>) => void) => {
      const copy = JSON.parse(JSON.stringify(first.phase1a2.probes)) as Record<string, any>;
      change(copy);
      return compare1a2(copy, historical1a2());
    };
    const step = (probes: Record<string, any>) => probes.sixInstallments.steps[1].tables;
    const cases: [string, (probes: Record<string, any>) => void][] = [
      ['bank balance + 0.01', probes => { const bank = step(probes).accounts.find((row: Row) => row.id === 'bank'); bank.balance_amount += 0.01; }],
      ['statement total', probes => { step(probes).credit_card_statements[0].total_amount += 1; }],
      ['movement amount', probes => { step(probes).transactions[0].amount += 1; }],
      ['revision 0 removed', probes => { step(probes).installment_plan_revisions = []; }],
      ['duplicate original', probes => { const rows = step(probes).installment_plan_revisions;
        rows.push({ ...rows[0], revision_number: 1, id: `${rows[0].installment_purchase_id}:revision:1` }); }],
      ['principal - 1 cent', probes => { step(probes).installment_plan_revisions[0].remaining_principal_cents -= 1; }],
      ['verification upgraded', probes => { const row = step(probes).installment_plan_revisions[0];
        row.verification = row.verification === 'projected' ? 'confirmed' : 'projected'; }],
      ['first cycle moved', probes => { step(probes).installment_plan_revisions[0].effective_cycle_end = '2026-12-20'; }],
      ['unknown table', probes => { step(probes).synthetic_unknown = [{ id: 1 }]; }],
      ['history invented for a plan saved outside the use case', probes => {
        const tables = probes.calendarStates.pendingVerificationInexact.steps[0].tables;
        tables.installment_plan_revisions = [...(tables.installment_plan_revisions ?? []), { id: 'installment-legacy-inexact:revision:0',
          installment_purchase_id: 'installment-legacy-inexact', revision_number: 0, source: 'original', allocation_id: null }];
      }],
      ['dashboard figure', probes => { probes.sixInstallments.steps[1].summary = { ...probes.sixInstallments.steps[1].summary, monthlyExpenses: -1 }; }],
    ];
    for (const [label, change] of cases) expect([label, mutate(change).length > 0]).toEqual([label, true]);
  });

  test('a raw connection (as the historical Node suite opened it) gives the same results as the managed APK path', async () => {
    expect(JSON.parse(JSON.stringify(await campaigns1a2(true)))).toEqual(first.phase1a2);
  }, 300000);
});

describe('6B.3 probes on the current code', () => {
  test('previous and current implementations equal the 6B.3 reference read by the APK exactly', async () => {
    const reference = (historical('phase6b3') as { probes: Record<string, unknown> }).probes;
    const run = async (name: (typeof PHASE6B3_PROBES)[number], previous: boolean) => {
      const sql = realSQLite({ fixedSqlDate: PHASE6B3_DATE });
      try {
        sql.native.exec('PRAGMA foreign_keys = ON;');
        for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
        await applyVersionedMigrations(sql.database);
        return await (previous
          ? runPhase6B3Probe(sql.database, name, { name: 'previous', registerCreditCardPayment: previousCards.registerCreditCardPayment })
          : runPhase6B3Probe(sql.database, name));
      } finally { sql.native.close(); }
    };
    for (const name of PHASE6B3_PROBES)
      expect([name, JSON.parse(JSON.stringify({ previous: await run(name, true), next: await run(name, false) }))])
        .toEqual([name, reference[name]]);
  }, 300000);
});

describe('evidence references', () => {
  test('r2 keeps every r1 part identical; it only adds phase1a2', () => {
    const r1 = JSON.parse(fs.readFileSync(R1_REFERENCE, 'utf8')) as Record<string, unknown>;
    const inventory = JSON.parse(fs.readFileSync('docs/validacion-fase1a4a/authorization/inputs.sha256.json', 'utf8')) as
      { sources: Record<string, string> };
    expect(sha256(R1_REFERENCE)).toBe(inventory.sources[R1_REFERENCE]);
    for (const part of ['phase1a4a', 'phase1a3a', 'phase1a3b'] as const) expect([part, first[part]]).toEqual([part, r1[part]]);
    expect(Object.keys(r1).sort()).toEqual(['phase1a3a', 'phase1a3b', 'phase1a4a', 'runtime']);
  });

  test('the campaigns are deterministic and equal the recorded r2 Node reference (explicit, non-overwriting regeneration)', async () => {
    const second = JSON.parse(JSON.stringify(await campaigns()));
    expect(second).toEqual(first);
    if (nodeProcess.env.SMARTFIN_WRITE_EVIDENCE === '1') {
      if (fs.existsSync(REFERENCE)) throw Error(`${REFERENCE} exists: review and delete it explicitly before regenerating`);
      fs.mkdirSync('docs/validacion-fase1a4a/r2/node', { recursive: true });
      fs.writeFileSync(REFERENCE, JSON.stringify({ runtime: nodeProcess.version, ...first }, null, 2) + '\n');
      // Field report of the approved 1a.2 differences: revision rows per probe step, nothing else.
      const report = Object.fromEntries(PHASE1A2_PROBES.map(name => [name, {
        comparatorErrors: compare1a2(first.phase1a2.probes[name], historical1a2Probe(name)),
        revisionRows: JSON.stringify(first.phase1a2.probes[name]).match(/"installment_plan_revisions":\[[^\]]*\]/g) ?? [],
      }]));
      fs.writeFileSync('docs/validacion-fase1a4a/r2/node/phase1a2-differences.json', JSON.stringify(report, null, 2) + '\n');
    }
    const recorded = JSON.parse(fs.readFileSync(REFERENCE, 'utf8')) as Record<string, unknown>;
    expect({ ...recorded, runtime: undefined }).toEqual({ ...first, runtime: undefined });
  }, 600000);
});
const historical1a2Probe = (name: string) => (historical('phase1a2') as { probes: Record<string, unknown> }).probes[name];

test('the 1a.4A probes do not depend on the key order of the rows returned by the driver', async () => {
  // r4 of 1a.3B: the Android driver returns native maps whose key order is not guaranteed.
  try {
    for (const order of [(keys: string[]) => [...keys].reverse(), (keys: string[]) => [...keys].sort()]) {
      rowKeyOrder = order;
      expect(JSON.parse(JSON.stringify(await campaigns1a4a()))).toEqual(first.phase1a4a);
    }
  } finally { rowKeyOrder = undefined; }
}, 600000);
