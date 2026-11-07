// Phase 1a.4B r3: isolation of the Node 1a.4B campaigns. Every campaign (register, reversal, guards) runs on its own NEW
// database, as the Android runner does (pm clear of the synthetic package before every phase1a4b- campaign). Real
// production code, no jest.mock of any 1a.4B step; the seed, its categories and the backup triggers are untouched.
// A. independent database   B. order independence   C. repetition   D. backup counter   E. financial equality
// F. reference protection.
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
import {
  PHASE1A4B_GUARD_CASES, PHASE1A4B_REGISTER_CASES, PHASE1A4B_REVERSAL_CASES, runPhase1A4BGuard, runPhase1A4BRegister,
  runPhase1A4BReversal, type Phase1A4BWriteCounter,
} from '../scripts/phase1a4b/probes';
import { allDifferences, runEditAmountStaged, type R2Tracer } from '../scripts/phase1a4b/r2/editAmountDiagnostic';

const fs = require('node:fs') as {
  readFileSync: (path: string, encoding?: 'utf8') => string & Uint8Array;
  writeFileSync: (path: string, value: string) => void;
  existsSync: (path: string) => boolean;
};
const { createHash } = require('node:crypto') as { createHash: (name: string) => { update: (data: Uint8Array) => { digest: (encoding: 'hex') => string } } };
const { spawnSync } = require('node:child_process') as {
  spawnSync: (command: string, args: string[], options: { encoding: 'utf8' }) => { status: number | null; stderr: string };
};
const nodeProcess = require('node:process') as { execPath: string };
const REFERENCE = 'docs/validacion-fase1a4b/node/results.json';
const REFERENCE_SHA256 = '1faa219207d86d95f7b55f3e3446243d3d6194bbd974e7018089e7acce41bd1b';
const ORIGINAL = 'docs/validacion-fase1a4b/r3/reference-before/results.json';
const DEFERRED = [...SHARED_LOSS_SCHEMA, ...SHARED_EXPENSE_SCHEMA, ...SHARED_EXPENSE_INDEXES, ...SHARED_EXPENSE_TRIGGERS,
  ...INSTALLMENT_HISTORY_SCHEMA];
type Row = Record<string, unknown>;
type Part = 'register' | 'reversal' | 'guards';
const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Row;
const referenceSha256AtStart = sha256(REFERENCE);

/** Same start as __tests__/phase1a4bAndroidEquivalence.test.ts. */
async function start() {
  const sql = realSQLite();
  sql.native.exec('PRAGMA foreign_keys = ON;');
  for (const statement of SQLITE_SCHEMA_STATEMENTS) if (!DEFERRED.includes(statement)) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  return { sql, database: manageSQLiteDatabase(sql.database) };
}
type Session = Awaited<ReturnType<typeof start>>;
async function runPart(part: Part, { sql, database }: Session) {
  const countWrites: Phase1A4BWriteCounter = async run => {
    sql.resetTrace(); await run(); return sql.trace.filter(entry => entry.write !== undefined).length;
  };
  const results: Row = {};
  if (part === 'register') for (const name of PHASE1A4B_REGISTER_CASES) results[name] = await runPhase1A4BRegister(database, name, countWrites);
  if (part === 'reversal') for (const name of PHASE1A4B_REVERSAL_CASES) results[name] = await runPhase1A4BReversal(database, name, countWrites);
  if (part === 'guards') for (const name of PHASE1A4B_GUARD_CASES) results[name] = await runPhase1A4BGuard(database, name);
  return json(results);
}
async function withSession<T>(run: (session: Session) => Promise<T>) {
  const session = await start();
  try { return await run(session); } finally { session.sql.native.close(); }
}
/** r3 layout: one new database per campaign, closed before the next one. */
async function isolated(order: Part[]) {
  const results: Partial<Record<Part, Row>> = {};
  for (const part of order) results[part] = await withSession(session => runPart(part, session));
  return results as Record<Part, Row>;
}
/** Original oracle layout (r1/r2): one database shared by the campaigns, in order. */
async function shared(order: Part[]) {
  return withSession(async session => {
    const results: Partial<Record<Part, Row>> = {};
    for (const part of order) results[part] = await runPart(part, session);
    return results as Record<Part, Row>;
  });
}
const NOOP_TRACER: R2Tracer = { start: () => undefined, stage: () => undefined, pause: () => undefined, resume: () => undefined, stop: () => [] };
const ORDER: Part[] = ['register', 'reversal', 'guards'];

let normal: Record<Part, Row>;
beforeAll(async () => { normal = await isolated(ORDER); }, 600000);

describe('phase 1a.4B r3 — one new database per Node campaign', () => {
  test('the isolated campaigns equal the promoted reference exactly', () => {
    const reference = JSON.parse(fs.readFileSync(REFERENCE, 'utf8')) as { phase1a4b: Record<Part, Row> };
    for (const part of ORDER) expect([part, normal[part]]).toEqual([part, reference.phase1a4b[part]]);
  });

  test('A. reversal after register equals reversal alone on a new database', async () => {
    const alone = await isolated(['reversal']);
    expect(normal.reversal).toEqual(alone.reversal);
  }, 300000);

  test('B. the order of the campaigns does not change their results', async () => {
    const reversed = await isolated(['guards', 'reversal', 'register']);
    for (const part of ORDER) expect([part, reversed[part]]).toEqual([part, normal[part]]);
  }, 300000);

  test('C. repeating a campaign on a new database gives the same complete result', async () => {
    for (const part of ORDER) expect([part, (await isolated([part]))[part]]).toEqual([part, normal[part]]);
  }, 300000);

  test('D. two new categories add exactly 2 to the counter; the D6 edit keeps its +8', async () => {
    const counters = (staged: Awaited<ReturnType<typeof runEditAmountStaged>>) => Object.fromEntries(
      Object.entries(staged.stages as Record<string, Row>).map(([stage, state]) => [stage, state.financialDataRevision]));
    const { fresh, warm } = await withSession(async ({ database }) => ({
      fresh: await runEditAmountStaged(database, NOOP_TRACER, 'fresh'),
      warm: await runEditAmountStaged(database, NOOP_TRACER, 'warm'),
    }));
    // Fresh database: 4 seed accounts + 2 new categories. Same database again: the categories already exist.
    expect(counters(fresh)).toEqual({ '1-initial': 6, '2-afterPurchase': 13, '3-afterPaymentAndAllocation': 25, '4-beforeEdit': 25, '5-final': 33 });
    expect(counters(warm)).toEqual({ '1-initial': 4, '2-afterPurchase': 11, '3-afterPaymentAndAllocation': 23, '4-beforeEdit': 23, '5-final': 31 });
    for (const staged of [fresh, warm]) expect(((staged.stages as Record<string, Row>)['1-initial']!.categories as Row[]).map(row => row.id))
      .toEqual(['cat-label', 'cat-other']);
    const edit = (staged: typeof fresh) => Number((staged.stages as Record<string, Row>)['5-final']!.financialDataRevision) -
      Number((staged.stages as Record<string, Row>)['4-beforeEdit']!.financialDataRevision);
    expect([edit(fresh), edit(warm)]).toEqual([8, 8]);
    // Everything except the counter and the rowids of the re-inserted rows is identical between both runs.
    const strip = (staged: typeof fresh) => JSON.parse(JSON.stringify((staged.stages as Record<string, Row>)['5-final'],
      (key, value) => (key === 'financialDataRevision' || key === 'categories' ? undefined : value))) as Row;
    expect(strip(fresh)).toEqual(strip(warm));
  }, 300000);

  test('E. isolation changes only the two backup counters; money, rows, revisions and allocations are equal', async () => {
    const before = await shared(ORDER);
    const differences = ORDER.flatMap(part => allDifferences(normal[part], before[part], `$.${part}`));
    expect(differences.map(({ path, node, android }) => ({ path, shared: node, isolated: android }))).toEqual([
      { path: '$.reversal.editAmount.observation.backupRevision', shared: 31, isolated: 33 },
      { path: '$.guards.deletePurchase.observation.backupRevision', shared: 23, isolated: 25 },
    ]);
    // The shared layout reproduces the archived original reference exactly.
    const original = JSON.parse(fs.readFileSync(ORIGINAL, 'utf8')) as { phase1a4b: Record<Part, Row> };
    for (const part of ORDER) expect([part, before[part]]).toEqual([part, original.phase1a4b[part]]);
  }, 300000);

  test('F. an ordinary run never rewrites the reference; an unauthorized regeneration fails without changes', () => {
    expect(referenceSha256AtStart).toBe(REFERENCE_SHA256);
    // The Jest setup redirects every write aimed at docs/ to artifacts/.
    fs.writeFileSync(REFERENCE, '{}');
    expect(sha256(REFERENCE)).toBe(REFERENCE_SHA256);
    for (const args of [[], ['--candidate', 'artifacts/phase1a4b-r3/candidate-results.json'],
      ['--candidate', 'artifacts/phase1a4b-r3/candidate-results.json', '--authorize-r3-two-leaves']]) {
      const result = spawnSync(nodeProcess.execPath, ['scripts/phase1a4b/r3/promote-reference.cjs', ...args], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(sha256(REFERENCE)).toBe(REFERENCE_SHA256);
    }
    expect(sha256(ORIGINAL)).toBe('d26e3a53f5cb89d673a83886f5fd6af6932956615c42348e2e55c2b287ba675f');
  });
});
