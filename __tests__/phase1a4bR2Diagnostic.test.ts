// Phase 1a.4B r2 — DIAGNOSTIC ONLY. Node reproduction of `phase1a4b-reversal / editAmount` with a statement-level trace
// (raw adapter boundary) and read-only counter probes on the same connection (node:sqlite, not traced). Real production
// code, no jest.mock of any 1a.4B step. Nothing here corrects or accepts a difference: the original reference
// (docs/validacion-fase1a4b/node/results.json) is read only and compared field by field.
//
// Contexts:
// - "apkOrder": ONE fresh database, the same case order as the r2 APK campaign (phase1a4b-r2-editamount):
//   schema facts → editAmount on a fresh database (r1 conditions) → staged editAmount → editAmount again.
// - "referenceSession": the session layout of the original oracle (campaigns1a4b): the six register cases first, then
//   reversal/editAmount on the same database.
// - "freshStaged": the staged reproduction on a fresh database.
// Evidence: docs/validacion-fase1a4b/r2/node/diagnostic.json (explicit SMARTFIN_WRITE_EVIDENCE=1, never overwritten).
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
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
import { PHASE1A4B_REGISTER_CASES, runPhase1A4BRegister, runPhase1A4BReversal, type Phase1A4BWriteCounter } from '../scripts/phase1a4b/probes';
import {
  allDifferences, describeEvents, r2SchemaFacts, runEditAmountStaged, summarizeTrace, type R2RawEvent, type R2Tracer,
} from '../scripts/phase1a4b/r2/editAmountDiagnostic';

const fs = require('node:fs') as {
  readFileSync: (path: string, encoding: 'utf8') => string;
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options: { recursive: boolean }) => void;
  writeFileSync: (path: string, value: string) => void;
};
const nodeProcess = require('node:process') as { version: string; env: Record<string, string | undefined> };
// r2 compared against the original 1a.4B reference (d26e3a53…). r3 promoted the current reference (two backupRevision
// leaves) and archived the original byte for byte, so this r2 diagnostic keeps reading exactly what it compared.
const REFERENCE = 'docs/validacion-fase1a4b/r3/reference-before/results.json';
const REFERENCE_SHA256 = 'd26e3a53f5cb89d673a83886f5fd6af6932956615c42348e2e55c2b287ba675f';
const EVIDENCE = 'docs/validacion-fase1a4b/r2/node/diagnostic.json';
const DEFERRED = [...SHARED_LOSS_SCHEMA, ...SHARED_EXPENSE_SCHEMA, ...SHARED_EXPENSE_INDEXES, ...SHARED_EXPENSE_TRIGGERS,
  ...INSTALLMENT_HISTORY_SCHEMA];
type Row = Record<string, unknown>;
type Sql = ReturnType<typeof realSQLite>;

const reference = JSON.parse(fs.readFileSync(REFERENCE, 'utf8')) as { phase1a4b: { reversal: Record<string, Row> } };
const referenceEditAmount = reference.phase1a4b.reversal.editAmount!;

/** Same start as __tests__/phase1a4bAndroidEquivalence.test.ts. */
async function start() {
  const sql = realSQLite();
  sql.native.exec('PRAGMA foreign_keys = ON;');
  for (const statement of SQLITE_SCHEMA_STATEMENTS) if (!DEFERRED.includes(statement)) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  return { sql, database: manageSQLiteDatabase(sql.database), tracer: nodeTracer(sql) };
}
const countWritesOf = (sql: Sql): Phase1A4BWriteCounter => async run => {
  sql.resetTrace(); await run(); return sql.trace.filter(entry => entry.write !== undefined).length;
};
async function session<T>(run: (current: Awaited<ReturnType<typeof start>>) => Promise<T>): Promise<T> {
  const current = await start();
  try { return await run(current); } finally { current.sql.native.close(); }
}

/** Raw-adapter tracer: every statement the managed database sends, with read-only probes that bypass the trace. */
function nodeTracer(sql: Sql): R2Tracer {
  const probe = () => sql.native.prepare(
    'SELECT (SELECT revision FROM financial_data_revision WHERE id = 1) AS revision, changes() AS changes, total_changes() AS total',
  ).all()[0] as { revision: number | null; changes: number; total: number };
  const original = sql.database.executeSql.bind(sql.database);
  let events: R2RawEvent[] = [];
  let active = false;
  let paused = false;
  let stage = '';
  let inTransaction = false;
  (sql.database as unknown as { executeSql: typeof original }).executeSql = (async (text: string, values?: unknown[]) => {
    if (!active || paused) return original(text, values as never);
    const before = probe();
    const event: R2RawEvent = {
      seq: events.length + 1, stage, sql: text,
      paramTypes: (values ?? []).map(value => value === null ? 'null' : typeof value),
      outcome: 'ok', driverRowsAffected: null, revisionBefore: before.revision ?? null, revisionAfter: null,
      changesAfter: null, totalChangesBefore: before.total, totalChangesAfter: null, inTransactionBefore: inTransaction,
    };
    events.push(event);
    try {
      const result = await original(text, values as never);
      event.driverRowsAffected = (result as unknown as [{ rowsAffected: number }])[0].rowsAffected;
      if (/^\s*BEGIN/i.test(text)) inTransaction = true;
      if (/^\s*(COMMIT|END|ROLLBACK)/i.test(text)) inTransaction = false;
      return result;
    } catch (error) {
      event.outcome = 'error';
      event.error = String(error);
      if (/^\s*(COMMIT|END|ROLLBACK)/i.test(text)) inTransaction = false;
      throw error;
    } finally {
      const after = probe();
      event.revisionAfter = after.revision ?? null;
      event.changesAfter = after.changes;
      event.totalChangesAfter = after.total;
    }
  }) as typeof original;
  return {
    start: label => { events = []; active = true; paused = false; stage = label; },
    stage: label => { stage = label; },
    pause: () => { paused = true; },
    resume: () => { paused = false; },
    stop: () => { active = false; const result = events; events = []; return result; },
  };
}

/** The exact case list and order of the r2 APK campaign. */
async function apkOrder() {
  return session(async ({ sql, database, tracer }) => {
    const countWrites = countWritesOf(sql);
    const schema = await r2SchemaFacts(database);
    tracer.start('fresh:originalProbe');
    const fresh = await runPhase1A4BReversal(database, 'editAmount', countWrites);
    const freshTrace = describeEvents(tracer.stop());
    const staged = await runEditAmountStaged(database, tracer, 'warm');
    tracer.start('warm:originalProbe');
    const warm = await runPhase1A4BReversal(database, 'editAmount', countWrites);
    const warmTrace = describeEvents(tracer.stop());
    return {
      schema,
      freshTraced: { result: fresh, trace: freshTrace, traceSummary: summarizeTrace(freshTrace),
        differencesFromReference: allDifferences(fresh, referenceEditAmount) },
      stagedWarm: staged,
      warmTraced: { result: warm, trace: warmTrace, traceSummary: summarizeTrace(warmTrace),
        differencesFromReference: allDifferences(warm, referenceEditAmount) },
    };
  });
}

/** Layout of the original oracle: register cases first, then editAmount on the same database. */
async function referenceSession(traced: boolean) {
  return session(async ({ sql, database, tracer }) => {
    const countWrites = countWritesOf(sql);
    for (const name of PHASE1A4B_REGISTER_CASES) await runPhase1A4BRegister(database, name, countWrites);
    if (traced) tracer.start('referenceSession:originalProbe');
    const result = await runPhase1A4BReversal(database, 'editAmount', countWrites);
    const trace = traced ? describeEvents(tracer.stop()) : [];
    return { result, ...(traced ? { trace, traceSummary: summarizeTrace(trace) } : {}),
      differencesFromReference: allDifferences(result, referenceEditAmount) };
  });
}

describe('phase 1a.4B r2 — editAmount backup counter diagnostic (Node)', () => {
  let first: Awaited<ReturnType<typeof run>>;
  async function run() {
    return {
      apkOrder: await apkOrder(),
      referenceSession: await referenceSession(true),
      referenceSessionUntraced: await referenceSession(false),
      freshUntraced: await session(async ({ sql, database }) => {
        const result = await runPhase1A4BReversal(database, 'editAmount', countWritesOf(sql));
        return { result, differencesFromReference: allDifferences(result, referenceEditAmount) };
      }),
      freshStaged: await session(({ database, tracer }) => runEditAmountStaged(database, tracer, 'fresh')),
    };
  }
  beforeAll(async () => { first = await run(); }, 600000);

  test('the original reference is the reviewed one (read only)', () => {
    const { createHash } = require('node:crypto') as { createHash: (name: string) => { update: (data: string) => { digest: (encoding: 'hex') => string } } };
    expect(createHash('sha256').update(fs.readFileSync(REFERENCE, 'utf8')).digest('hex')).toBe(REFERENCE_SHA256);
  });

  test('instrumentation is neutral: traced and untraced runs give the same results', () => {
    expect(first.referenceSession.result).toEqual(first.referenceSessionUntraced.result);
    expect(first.apkOrder.freshTraced.result).toEqual(first.freshUntraced.result);
  });

  test('the oracle layout reproduces the reference exactly (31)', () => {
    expect(first.referenceSession.differencesFromReference).toEqual([]);
    expect(first.referenceSession.result).toEqual(referenceEditAmount);
  });

  test('records every difference of a fresh database against the reference (reported, never accepted)', () => {
    // Recorded as evidence; this test only checks that the enumeration is complete and consistent.
    const differences = first.apkOrder.freshTraced.differencesFromReference;
    expect(differences).toEqual(first.freshUntraced.differencesFromReference);
    expect(first.apkOrder.warmTraced.differencesFromReference).toEqual([]);
  });

  test('deterministic: a second run is identical', async () => {
    expect(JSON.parse(JSON.stringify(await run()))).toEqual(JSON.parse(JSON.stringify(first)));
  }, 600000);

  test('evidence (explicit, non-overwriting)', () => {
    const evidence = { runtime: nodeProcess.version, referenceSha256: REFERENCE_SHA256, ...first };
    if (nodeProcess.env.SMARTFIN_WRITE_EVIDENCE === '1') {
      if (fs.existsSync(EVIDENCE)) throw Error(`${EVIDENCE} exists: review and delete it explicitly before regenerating`);
      fs.mkdirSync('docs/validacion-fase1a4b/r2/node', { recursive: true });
      fs.writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
    } else {
      fs.mkdirSync('docs/validacion-fase1a4b/r2/node', { recursive: true });
      fs.writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n'); // redirected to artifacts/ by the Jest setup
    }
  });
});
