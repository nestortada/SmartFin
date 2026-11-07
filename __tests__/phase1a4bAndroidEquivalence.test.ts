// Phase 1a.4B Node reference for the Android validation of the CURRENT code, with the REAL 1a.4B logic (no jest.mock,
// no neutralization anywhere in this suite):
// - the new campaigns phase1a4b-* (scripts/phase1a4b/probes.ts);
// - the regressions the APK runs on the same code: 1a.4A (probes unchanged), 1a.3A (unchanged), 1a.3B (probes derived by
//   scripts/phase1a4b/derive-probes.cjs: D6 guard outcome and version 4 flows) and 1a.2 statements.
// Every regression part must equal the 1a.4A r2 reference field by field, except the two approved D6/version 4 changes,
// checked by explicit comparators. The run must equal docs/validacion-fase1a4b/node/results.json; regenerating it is an
// explicit operation (SMARTFIN_WRITE_EVIDENCE=1) that refuses to overwrite an existing file. Historical references are read only.
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
  checkPhase1A4BAfterRestart, PHASE1A4B_GUARD_CASES, PHASE1A4B_MATRICES, PHASE1A4B_REGISTER_CASES, PHASE1A4B_REVERSAL_CASES,
  runPhase1A4BGuard, runPhase1A4BIdempotency, runPhase1A4BMatrix, runPhase1A4BRegister, runPhase1A4BReversal, runPhase1A4BUnknown,
  type Phase1A4BFaults,
} from '../scripts/phase1a4b/probes';
import {
  checkPhase1A4AAfterRestart, PHASE1A4A_CREATION_CASES, PHASE1A4A_MATRICES, runPhase1A4ACompatibility, runPhase1A4ACreation,
  runPhase1A4AInvariants, runPhase1A4ALifecycle, runPhase1A4AMatrix, runPhase1A4AUnknown,
} from '../scripts/phase1a4a/probes';
import {
  checkPhase1A3AAfterRestart, PHASE1A3A_MATRICES, PHASE1A3A_PROBES, runPhase1A3AMatrix, runPhase1A3AProbe, runPhase1A3AUnknown,
} from '../scripts/phase1a3a/probes';
import {
  checkPhase1A3BAfterRestart, checkPhase1A3BStartupUpgrade, PHASE1A3B_INTEGRITY_PROBES, PHASE1A3B_MIGRATION_FAULTS,
  runPhase1A3BFlows, runPhase1A3BIntegrityProbe, runPhase1A3BMigrationFault, runPhase1A3BUpgrade, seedPhase1A3BStartupUpgrade,
} from '../scripts/phase1a4b/phase1a3bProbes';
import { PHASE1A2_PROBES, runPhase1A2Probe } from '../scripts/phase1a2/probes';

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
const REFERENCE = 'docs/validacion-fase1a4b/node/results.json';
const R2_REFERENCE = 'docs/validacion-fase1a4a/r2/node/results.json';
const DEFERRED = [...SHARED_LOSS_SCHEMA, ...SHARED_EXPENSE_SCHEMA, ...SHARED_EXPENSE_INDEXES, ...SHARED_EXPENSE_TRIGGERS,
  ...INSTALLMENT_HISTORY_SCHEMA];

type Sql = ReturnType<typeof realSQLite>;
type Row = Record<string, unknown>;
type RowKeyOrder = (keys: string[]) => string[];
let rowKeyOrder: RowKeyOrder | undefined;
/** A process start of the app: open the file, apply the schema and the versioned migrations, manage the handle. */
async function start(syntheticPath?: string) {
  const sql = realSQLite({ syntheticPath, rowKeyOrder });
  sql.native.exec('PRAGMA foreign_keys = ON;');
  for (const statement of SQLITE_SCHEMA_STATEMENTS) if (!DEFERRED.includes(statement)) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  return { sql, database: manageSQLiteDatabase(sql.database) };
}
function nodeFaults(sql: Sql): Phase1A4BFaults {
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
async function session<T>(run: (current: Awaited<ReturnType<typeof start>>) => Promise<T>): Promise<T> {
  const current = await start();
  try { return await run(current); } finally { current.sql.native.close(); }
}

/** phase1a4b-register, -reversal, -guards, -idempotency, -atomicity, -unknown, -unknown-restart. */
async function campaigns1a4b() {
  // r3: one NEW database per campaign, as the Android runner (pm clear before every phase1a4b- campaign). r1/r2 showed that
  // a shared session leaves the seed categories in place, so the backup counter of the next campaign's first case differed.
  const register: Row = {};
  const reversal: Row = {};
  const guards: Row = {};
  await session(async ({ sql, database }) => {
    const { countWrites } = nodeFaults(sql);
    for (const name of PHASE1A4B_REGISTER_CASES) register[name] = await runPhase1A4BRegister(database, name, countWrites);
  });
  await session(async ({ sql, database }) => {
    const { countWrites } = nodeFaults(sql);
    for (const name of PHASE1A4B_REVERSAL_CASES) reversal[name] = await runPhase1A4BReversal(database, name, countWrites);
  });
  await session(async ({ database }) => {
    for (const name of PHASE1A4B_GUARD_CASES) guards[name] = await runPhase1A4BGuard(database, name);
  });
  const idempotency = await session(({ sql, database }) => runPhase1A4BIdempotency(database, nodeFaults(sql).countWrites));
  const atomicity: Row = {};
  const writes: Record<string, number> = {};
  const writeVerbs: Record<string, string[]> = {};
  await session(async ({ sql, database }) => {
    const faults = nodeFaults(sql);
    const record = async (label: string, operation: () => Promise<unknown>) => { atomicity[label] = await operation(); };
    for (const name of PHASE1A4B_MATRICES)
      writes[name] = await runPhase1A4BMatrix(database, name, { ...faults, countWrites: async run => {
        const count = await faults.countWrites(run); writeVerbs[name] = verbs(sql); return count;
      } }, record);
  });
  const recovery = await withFile('smartfin-1a4b-', async path => {
    const first = await start(path);
    const unknown = await runPhase1A4BUnknown(first.database, lost => {
      if (lost) first.sql.resetTrace();
      first.sql.injectFault(lost ? { sql: 'COMMIT', phase: 'after' } : undefined);
    });
    const trace = first.sql.trace;
    try { first.sql.native.close(); } catch { /* the runner already retired the connection */ }
    const reopened = await start(path);
    try {
      return { unknown, restart: await checkPhase1A4BAfterRestart(reopened.database, nodeFaults(reopened.sql).countWrites),
        begins: trace.filter(entry => entry.sql.startsWith('BEGIN')).length,
        commits: trace.filter(entry => entry.sql.startsWith('COMMIT')).length,
        allocationInserts: trace.filter(entry => entry.sql.trim().startsWith('INSERT INTO installment_allocations')).length };
    } finally { reopened.sql.native.close(); }
  });
  return { register, reversal, guards, idempotency, atomicity, writes, writeVerbs, ...recovery };
}

/** The 1a.4A campaigns with their unchanged probes, on the real 1a.4B code. */
async function campaigns1a4a() {
  const creation: Row = {};
  await session(async ({ database }) => { for (const name of PHASE1A4A_CREATION_CASES) creation[name] = await runPhase1A4ACreation(database, name); });
  const lifecycle = await session(({ sql, database }) => runPhase1A4ALifecycle(database, nodeFaults(sql).countWrites));
  const compatibility = await session(({ database }) => runPhase1A4ACompatibility(database));
  const invariants = await session(({ database }) => runPhase1A4AInvariants(database));
  const atomicity: Row = {};
  const writes: Record<string, number> = {};
  const writeVerbs: Record<string, string[]> = {};
  await session(async ({ sql, database }) => {
    const faults = nodeFaults(sql);
    const record = async (label: string, operation: () => Promise<unknown>) => { atomicity[label] = await operation(); };
    for (const name of PHASE1A4A_MATRICES)
      writes[name] = await runPhase1A4AMatrix(database, name, { ...faults, countWrites: async run => {
        const count = await faults.countWrites(run); writeVerbs[name] = verbs(sql); return count;
      } }, record);
  });
  const recovery = await withFile('smartfin-1a4b-1a4a-', async path => {
    const first = await start(path);
    const unknown = await runPhase1A4AUnknown(first.database, lost => {
      if (lost) first.sql.resetTrace();
      first.sql.injectFault(lost ? { sql: 'COMMIT', phase: 'after' } : undefined);
    });
    const trace = first.sql.trace;
    try { first.sql.native.close(); } catch { /* retired */ }
    const reopened = await start(path);
    try {
      return { unknown, restart: await checkPhase1A4AAfterRestart(reopened.database),
        begins: trace.filter(entry => entry.sql.startsWith('BEGIN')).length,
        revisionInserts: trace.filter(entry => entry.sql.trim().startsWith('INSERT INTO installment_plan_revisions')).length };
    } finally { reopened.sql.native.close(); }
  });
  return { creation, lifecycle, compatibility, invariants, atomicity, writes, writeVerbs, ...recovery };
}

async function campaigns1a3a() {
  const identity: Row = {};
  await session(async ({ database }) => { for (const name of PHASE1A3A_PROBES) identity[name] = await runPhase1A3AProbe(database, name); });
  const atomicity: Row = {};
  const writes: Record<string, number> = {};
  const writeVerbs: Record<string, string[]> = {};
  await session(async ({ sql, database }) => {
    const faults = nodeFaults(sql);
    const record = async (label: string, operation: () => Promise<unknown>) => { atomicity[label] = await operation(); };
    for (const name of PHASE1A3A_MATRICES)
      writes[name] = await runPhase1A3AMatrix(database, name, { ...faults, countWrites: async run => {
        const count = await faults.countWrites(run); writeVerbs[name] = verbs(sql); return count;
      } }, record);
  });
  return withFile('smartfin-1a4b-1a3a-', async path => {
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

async function campaigns1a3b() {
  const upgrade = await session(({ database }) => runPhase1A3BUpgrade(database));
  const startup = await withFile('smartfin-1a4b-1a3b-', async path => {
    const result: Row = {};
    let current = await start(path);
    try { result.seed = await seedPhase1A3BStartupUpgrade(current.database); } finally { current.sql.native.close(); }
    current = await start(path);
    try { result.upgrade = await checkPhase1A3BStartupUpgrade(current.database); } finally { current.sql.native.close(); }
    current = await start(path);
    try { result.restart = await checkPhase1A3BAfterRestart(current.database); } finally { current.sql.native.close(); }
    return result;
  });
  const atomicity: Row = {};
  await session(async ({ database }) => {
    for (const target of PHASE1A3B_MIGRATION_FAULTS) for (const phase of ['before', 'after'] as const)
      atomicity[`${target} (${phase})`] = await runPhase1A3BMigrationFault(database, target, phase);
  });
  const integrity: Row = {};
  await session(async ({ database }) => { for (const name of PHASE1A3B_INTEGRITY_PROBES) integrity[name] = await runPhase1A3BIntegrityProbe(database, name); });
  const flows = await session(({ sql, database }) => runPhase1A3BFlows(database, nodeFaults(sql).countWrites));
  return { upgrade, startup, atomicity, integrity, flows };
}

async function campaigns1a2() {
  const probes: Row = {};
  for (const name of PHASE1A2_PROBES) probes[name] = await session(({ database }) => runPhase1A2Probe(database, name));
  return { probes };
}

async function campaigns() {
  return JSON.parse(JSON.stringify({ phase1a4b: await campaigns1a4b(), phase1a4a: await campaigns1a4a(),
    phase1a3a: await campaigns1a3a(), phase1a3b: await campaigns1a3b(), phase1a2: await campaigns1a2() })) as Campaigns;
}

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const r2 = () => JSON.parse(fs.readFileSync(R2_REFERENCE, 'utf8')) as Record<string, Row>;
/** Labels M<n>/P<n> renumbered by first appearance: the same canonical form for a subset of a canonical result. */
function relabel(value: unknown): unknown {
  const text = JSON.stringify(value);
  const labels = new Map<string, string>();
  const counters: Record<string, number> = { M: 0, P: 0 };
  return JSON.parse(text.replace(/(?<![A-Za-z0-9])(M|P)(\d+)(?![0-9])/g, (match: string, kind: string) => {
    if (!labels.has(match)) labels.set(match, kind + String(++counters[kind]!));
    return labels.get(match)!;
  }));
}

type Campaigns = Record<'phase1a4b' | 'phase1a4a' | 'phase1a3a' | 'phase1a3b' | 'phase1a2', Row>;
let first: Campaigns;
beforeAll(async () => { first = await campaigns(); }, 900000);

describe('phase1a4b campaigns (real 1a.4B logic)', () => {
  test('write counts and failure points of the four operations', () => {
    const writes = first.phase1a4b.writes as Record<string, number>;
    expect(writes).toEqual({ register: 18, registerLazy: 19, editReversal: 13, deleteReversal: 29 });
    const verbsOf = first.phase1a4b.writeVerbs as Record<string, string[]>;
    expect(verbsOf.register!.slice(-2)).toEqual(['INSERT INTO installment_allocations', 'INSERT INTO installment_plan_revisions']);
    expect(verbsOf.registerLazy!.slice(-3)).toEqual(['INSERT INTO installment_plan_revisions', 'INSERT INTO installment_allocations',
      'INSERT INTO installment_plan_revisions']);
    for (const name of ['editReversal', 'deleteReversal'])
      expect(verbsOf[name]!.slice(0, 2)).toEqual(['UPDATE installment_allocations SET', 'INSERT INTO installment_plan_revisions']);
    const atomicity = first.phase1a4b.atomicity as Record<string, Row>;
    const rollbacks = Object.entries(atomicity).filter(([label]) => label.includes('-rollback-'));
    expect(rollbacks).toHaveLength(2 * (18 + 19 + 13 + 29));
    expect(rollbacks.every(([, value]) => value.status === 'rolledBack' && value.exactStateRestored && value.nextOwnerConfirmed)).toBe(true);
  });

  test('unknown is never retried and never counted as a rollback; after reopening the command replays without writes', () => {
    expect(first.phase1a4b.unknown).toEqual({ status: 'unknown', sameFailure: true, connectionRetired: true });
    expect([first.phase1a4b.begins, first.phase1a4b.commits, first.phase1a4b.allocationInserts]).toEqual([1, 1, 1]);
    expect(first.phase1a4b.restart).toMatchObject({ replay: 'replayed', replayWrites: 0, differentWrites: 0 });
  });

  test('idempotency: repetitions after edit and deletion write nothing and recreate nothing', () => {
    const idempotency = first.phase1a4b.idempotency as { steps: Record<string, Row>; rejected: Record<string, Row>; unverifiable: Record<string, Row> };
    expect(Object.fromEntries(Object.entries(idempotency.steps).map(([label, step]) => [label, [step.writes === 0, step.status, step.allocationStatus]])))
      .toEqual({ create: [false, 'registered', 'active'], repeat: [true, 'replayed', 'active'], editPayment: [false, null, null],
        repeatAfterEdit: [true, 'replayed', 'reversed'], deletePayment: [false, null, null], repeatAfterDeletion: [true, 'replayed', 'reversed'] });
    expect(Object.values(idempotency.rejected).every(value => value.writes === 0)).toBe(true);
    expect(Object.values(idempotency.unverifiable)).toEqual([{ status: 'replayed', writes: 0 }, { status: 'replayed', writes: 0 }]);
  });

  test('every 1a.4B observation is complete: allocations, revisions with reasons, references and money rows', () => {
    const simple = (first.phase1a4b.register as Record<string, { observation: Row }>).simple!.observation;
    for (const key of ['accounts', 'transactions', 'installmentPurchases', 'statements', 'allocations', 'revisions', 'summary', 'backupRevision'])
      expect(simple).toHaveProperty(key);
    expect((simple.allocations as Row[])[0]).toMatchObject({ id: 'installment-allocation-cmd-1', mode: 'unspecified', status: 'active',
      command_id: 'cmd-1', payment_transaction_id: 'tx-credit-card-payment-card-command-cmd-1', amount_cents: 10000000 });
  });
});

describe('regressions on the real 1a.4B code against the 1a.4A r2 reference', () => {
  test('1a.4A, 1a.3A and 1a.2 parts are identical', () => {
    const reference = r2();
    for (const part of ['phase1a4a', 'phase1a3a', 'phase1a2'] as const) expect([part, first[part]]).toEqual([part, reference[part]]);
  });

  test('1a.3B: identical except the two approved changes (D6 guard outcome, version 4 flows)', () => {
    const reference = r2().phase1a3b as Record<string, Row>;
    const current = first.phase1a3b as Record<string, Row>;
    for (const part of ['upgrade', 'startup', 'atomicity'] as const) expect([part, current[part]]).toEqual([part, reference[part]]);
    const { activeAllocationGuards: guards, ...integrity } = current.integrity as Record<string, Row>;
    const { activeAllocationGuards: previousGuards, ...previousIntegrity } = reference.integrity as Record<string, Row>;
    expect(integrity).toEqual(previousIntegrity);
    // D6: every raw guard keeps its outcome; deleting the payment is accepted (reversal), the purchase is rejected earlier.
    const { deletePaymentUseCase, deletePurchaseUseCase, ...rawOutcomes } = (previousGuards!.result as Row).outcomes as Row;
    expect([deletePaymentUseCase, deletePurchaseUseCase]).toEqual(['raise:antes de eliminarlo', 'raise:antes de eliminarla']);
    const result = guards!.result as Row;
    expect(result.outcomes).toEqual({ ...rawOutcomes, deletePurchaseUseCase: expect.stringContaining('abonos extraordinarios imputados') });
    expect(result.deletePaymentUseCase).toBe('accepted');
    expect(result.description).toBe((previousGuards!.result as Row).description);
    expect(((result.afterReversal as Row).purchaseHistory as Row[]).map(row => row.source))
      .toEqual(['original', 'allocationReversal', 'purchaseRemoval']);
    // Version 4: the 1a.4B code refuses the first guarded step without changes; version 5 equals the reference exactly.
    const flows = current.flows as Row;
    expect(flows.version4Incompatible).toEqual({ firstGuardedStep: 'editTerms', outcome: 'other: no such table: installment_allocations',
      stateUnchanged: true });
    expect(relabel(flows.version5)).toEqual(relabel((reference.flows as Row).version5));
  });

  test('the historical references keep the hashes pinned by the 1a.4A r2 inventory', () => {
    const inventory = JSON.parse(fs.readFileSync('docs/validacion-fase1a4a/r2/authorization/inputs.sha256.json', 'utf8')) as { sources: Record<string, string> };
    for (const file of [R2_REFERENCE, 'docs/validacion-fase1a4a/node/results.json', 'docs/validacion-fase1a3b/node/results.json',
      'docs/validacion-fase1a3a/node/results.json', 'docs/validacion-fase1a2/node/results.json', 'docs/correccion-fase6b3/node/results.json'])
      expect([file, sha256(file)]).toEqual([file, inventory.sources[file]]);
  });
});

describe('evidence reference', () => {
  test('the campaigns are deterministic and equal the recorded Node reference (explicit, non-overwriting regeneration)', async () => {
    expect(await campaigns()).toEqual(first);
    // r3 candidate: written outside docs/ to a new path, never over the reference; promoted only by
    // scripts/phase1a4b/r3/promote-reference.cjs after the structural comparison.
    const candidate = nodeProcess.env.SMARTFIN_1A4B_CANDIDATE;
    if (candidate) {
      if (/(^|[\\/])docs[\\/]/.test(candidate) || fs.existsSync(candidate)) throw Error('Candidate path must be new and outside docs/');
      fs.writeFileSync(candidate, JSON.stringify({ runtime: nodeProcess.version, ...first }, null, 2) + '\n');
    }
    if (nodeProcess.env.SMARTFIN_WRITE_EVIDENCE === '1') {
      if (fs.existsSync(REFERENCE)) throw Error(`${REFERENCE} exists: review and delete it explicitly before regenerating`);
      fs.mkdirSync('docs/validacion-fase1a4b/node', { recursive: true });
      fs.writeFileSync(REFERENCE, JSON.stringify({ runtime: nodeProcess.version, ...first }, null, 2) + '\n');
    }
    const recorded = JSON.parse(fs.readFileSync(REFERENCE, 'utf8')) as Record<string, unknown>;
    expect({ ...recorded, runtime: undefined }).toEqual({ ...first, runtime: undefined });
  }, 900000);

  test('the 1a.4B probes do not depend on the key order of the rows returned by the driver', async () => {
    try {
      for (const order of [(keys: string[]) => [...keys].reverse(), (keys: string[]) => [...keys].sort()]) {
        rowKeyOrder = order;
        expect(JSON.parse(JSON.stringify(await campaigns1a4b()))).toEqual(first.phase1a4b);
      }
    } finally { rowKeyOrder = undefined; }
  }, 900000);

  test('no neutralization: this suite and the probes the APK runs never mock the 1a.4B steps', () => {
    for (const file of ['__tests__/phase1a4bAndroidEquivalence.test.ts', 'scripts/phase1a4b/probes.ts', 'scripts/phase1a4b/phase1a3bProbes.ts']) {
      const text = fs.readFileSync(file, 'utf8');
      // Built from parts so that this file does not match its own pattern.
      const neutralization = new RegExp(['jest\\.(mock|doMock|spyOn)\\([^)]*installmentAllocation', 'Reversal|reverseActivePaymentAllocations', ': async'].join(''));
      expect([file, neutralization.test(text)]).toEqual([file, false]);
    }
  });
});
