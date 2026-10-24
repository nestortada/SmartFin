jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { financialIntegrityFixture } from './helpers/financialIntegrityFixture';
import { financialState } from './helpers/financialState';
import { createSqliteFinancialDataRepository } from '../src/modules/settings/repositories/sqliteFinancialDataRepository';
import { createSqliteFinancialDataRepository as previousRepository } from './helpers/phase5cPreviousFinancialDataRepository';
import { deleteFinancialData } from '../src/modules/settings/useCases/deleteFinancialData';
import { FINANCIAL_LIFECYCLE_KEY, parseDeletionIntent } from '../src/modules/settings/types/financialDeletion';
import type { FinancialDeletionLifecycle } from '../src/modules/settings/services/financialDeletionLifecycle';
const { writeFileSync, mkdtempSync, rmSync } = require('node:fs') as {
  writeFileSync: (path: string, value: string) => void;
  mkdtempSync: (prefix: string) => string;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
};
const { tmpdir } = require('node:os') as { tmpdir: () => string };
const { join } = require('node:path') as { join: (...parts: string[]) => string };
import { realSQLite } from './helpers/realSQLite';

const id = '11111111-1111-4111-8111-111111111111';
const inventory = { workIds: [], backupJobIds: [], snapshotIds: [] };
const evidence = { writes: 0, faultCases: 0, unknownCases: 0 };
afterAll(() => writeFileSync('docs/atomicidad-fase5c/node-matrix.json', JSON.stringify(evidence, null, 2)));
async function fixture(syntheticPath?: string) {
  const f = await financialIntegrityFixture({ syntheticPath });
  await f.save();
  // Include the graph most vulnerable to partial deletion: debt, installments, shared loss and audit.
  f.native.exec(`
    INSERT INTO recurring_subscriptions(id,name,amount,currency,account_id,periodicity,status,created_at,updated_at) VALUES ('s','Synthetic',44900,'COP','bank','monthly','active','2026-10-18','2026-10-18');
    INSERT INTO subscription_occurrences(id,subscription_id,expected_date,expected_amount,currency,account_id,status,created_at,updated_at) VALUES ('o','s','2099-10-19',44900,'COP','bank','pending','2026-10-18','2026-10-18');
    INSERT INTO subscription_reminders(id,occurrence_id,offset_days,revision,fire_at,title,message,desired,delivery_status,updated_at) VALUES ('subscription-reminder:r','o',1,1,'2099-10-18T15:00:00.000Z','Synthetic','Synthetic','scheduled','pending','2026-10-18');
    INSERT INTO app_settings VALUES ('theme','dark','2026-01-01');
    INSERT INTO shared_contacts VALUES ('person','Synthetic','2026-01-01','2026-01-01');
    INSERT INTO shared_expenses(id,transaction_id,total_minor,date,description,status,created_at,updated_at) SELECT 'shared',id,25000000,'2026-10-11','Synthetic','active','2026-01-01','2026-01-01' FROM transactions LIMIT 1;
    INSERT INTO transaction_splits(id,transaction_id,split_type,shared_expense_id,contact_id,amount_minor,amount,currency,created_at,updated_at) SELECT 'participation',transaction_id,'person','shared','person',10000000,100000,'COP','2026-01-01','2026-01-01' FROM shared_expenses;
    INSERT INTO shared_loss_events(id,kind,expense_id,participation_key,contact_id,amount_minor,date,created_at) VALUES ('loss','forgiveness','shared','participation','person',10000,'2026-10-18','2026-10-18');
    INSERT INTO ai_command_drafts(id,phase,plan_json,raw_input,messages_json,clarification_history_json,created_at,updated_at) VALUES ('receipt','confirmed','{"version":1}','synthetic','[]','[]','2026-01-01','2026-01-01');
  `);
  const alarms = new Set(['subscription-reminder:r']);
  let pending = false;
  let cleanupFails = false;
  const lifecycle: FinancialDeletionLifecycle = {
    begin: jest.fn(async () => ({ status: 'admitted' as const, id })),
    inventory: jest.fn(async () => inventory),
    rollback: jest.fn(async () => undefined),
    recover: jest.fn(async (): ReturnType<FinancialDeletionLifecycle['recover']> => {
      if (!pending) { pending = true; return { status: 'none' }; }
      const receipt = f.query('SELECT setting_value FROM app_settings WHERE setting_key=?', [FINANCIAL_LIFECYCLE_KEY]).rows.item(0)?.setting_value;
      if (!receipt) return { status: 'unknown', id };
      const intent = parseDeletionIntent(receipt);
      if (cleanupFails) return { status: 'cleanupPending', id };
      for (const resource of intent.reminderIds) alarms.delete(resource);
      return { status: 'completed', id };
    }),
  };
  return { ...f, alarms, lifecycle, failCleanup: () => { cleanupFails = true; } };
}

test('one commit preserves the exact historical DELETE outcome, with only internal metadata added', async () => {
  const f = await fixture(), old = await fixture();
  try {
    f.resetTrace();
    expect(await deleteFinancialData(createSqliteFinancialDataRepository(f.database), f.lifecycle)).toEqual({ status: 'confirmed', id, cleanup: 'completed' });
    await previousRepository(old.database).deleteFinancialData();
    const actual = await financialState(f), expected = await financialState(old);
    actual.tables.app_settings = actual.tables.app_settings!.filter(row => row.setting_key === 'theme');
    expect(actual).toEqual(expected);
    expect(f.alarms.size).toBe(0);
    expect(f.trace.filter(entry => /^BEGIN/.test(entry.sql))).toHaveLength(1);
    expect(f.trace.filter(entry => /^COMMIT/.test(entry.sql))).toHaveLength(1);
    evidence.writes = f.trace.filter(entry => entry.write).length;
    expect(evidence.writes).toBe(38);
  } finally { f.native.close(); old.native.close(); }
});

test('before/after every financial and intent write: integral rollback and no OS cancellation', async () => {
  for (let write = 1; write <= 38; write++) for (const phase of ['before', 'after'] as const) {
    const f = await fixture();
    try {
      const before = await financialState(f);
      f.resetTrace(); f.injectFault({ write, phase });
      const result = await deleteFinancialData(createSqliteFinancialDataRepository(f.database), f.lifecycle);
      expect(result.status).toBe('rolledBack');
      expect(await financialState(f)).toEqual(before);
      expect([...f.alarms]).toEqual(['subscription-reminder:r']);
      expect(f.lifecycle.rollback).toHaveBeenCalledTimes(1);
      expect(f.lifecycle.recover).toHaveBeenCalledTimes(1);
      expect(f.trace.filter(entry => /^ROLLBACK/.test(entry.sql))).toHaveLength(1);
      evidence.faultCases++;
    } finally { f.native.close(); }
  }
});

test.each(['before', 'after'] as const)('lost COMMIT response %s: unknown, no cancellation or financial retry', async phase => {
  const directory = mkdtempSync(join(tmpdir(), 'smartfin-5c-'));
  const path = join(directory, 'synthetic.db');
  const f = await fixture(path);
  try {
    f.resetTrace(); f.injectFault({ sql: 'COMMIT;', phase });
    expect((await deleteFinancialData(createSqliteFinancialDataRepository(f.database), f.lifecycle)).status).toBe('unknown');
    expect(f.alarms.size).toBe(1);
    expect(f.lifecycle.rollback).not.toHaveBeenCalled();
    expect(f.lifecycle.recover).toHaveBeenCalledTimes(1);
    expect(f.trace.filter(entry => /^BEGIN/.test(entry.sql))).toHaveLength(1);
    const recovered = realSQLite({ syntheticPath: path });
    try {
      expect(recovered.query('SELECT count(*) AS count FROM accounts').rows.item(0)?.count).toBe(phase === 'before' ? 3 : 0);
      expect(recovered.query('SELECT * FROM app_settings WHERE setting_key=?', [FINANCIAL_LIFECYCLE_KEY]).rows.length).toBe(phase === 'before' ? 0 : 1);
    } finally { recovered.native.close(); }
    evidence.unknownCases++;
  } finally { try { f.native.close(); } catch { /* Runner discards uncertain connection. */ } rmSync(directory, { recursive: true, force: true }); }
});

test('confirmed commit followed by cleanup failure remains confirmed and does not run DELETE again', async () => {
  const f = await fixture();
  try {
    f.failCleanup();
    const result = await deleteFinancialData(createSqliteFinancialDataRepository(f.database), f.lifecycle);
    expect(result).toEqual({ status: 'confirmed', id, cleanup: 'pending' });
    expect(f.alarms.size).toBe(1);
    expect(f.query('SELECT count(*) AS count FROM accounts').rows.item(0)?.count).toBe(0);
    f.native.exec("INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('after','New synthetic','bankAccount','active','COP',100,'2026-01-01','2026-01-01')");
    f.resetTrace();
    expect((await deleteFinancialData(createSqliteFinancialDataRepository(f.database), f.lifecycle)).status).toBe('rejected');
    expect(f.trace.filter(entry => /^DELETE/.test(entry.sql))).toHaveLength(0);
    expect(f.lifecycle.begin).toHaveBeenCalledTimes(1);
    expect(f.query('SELECT id FROM accounts').rows.item(0)?.id).toBe('after');
  } finally { f.native.close(); }
});

test('a lost admission-release response preserves a confirmed financial rollback', async () => {
  const f = await fixture();
  try {
    const before = await financialState(f);
    f.lifecycle.rollback = async () => { throw new Error('Lost admission release'); };
    f.resetTrace(); f.injectFault({ write: 1, phase: 'after' });
    expect(await deleteFinancialData(createSqliteFinancialDataRepository(f.database), f.lifecycle)).toMatchObject({ status: 'rolledBack', admissionPending: true });
    expect(await financialState(f)).toEqual(before);
    expect(f.alarms.size).toBe(1);
  } finally { f.native.close(); }
});

test('admission rejection, unknown prior result, and lost admission response never start SQL', async () => {
  for (const kind of ['rejected', 'unknown', 'lost'] as const) {
    const f = await fixture();
    try {
      f.lifecycle.begin = async () => { if (kind === 'lost') throw new Error('Lost receipt'); return { status: kind }; };
      f.resetTrace();
      expect((await deleteFinancialData(createSqliteFinancialDataRepository(f.database), f.lifecycle)).status).toBe(kind === 'lost' ? 'unknown' : kind);
      expect(f.trace.filter(entry => entry.write)).toHaveLength(0);
      expect(f.alarms.size).toBe(1);
    } finally { f.native.close(); }
  }
});

test('same deletion ID cannot eliminate a second financial history even after completed cleanup', async () => {
  const f = await fixture();
  try {
    const repository = createSqliteFinancialDataRepository(f.database);
    expect((await repository.deleteFinancialData(id, inventory)).status).toBe('confirmed');
    const current = parseDeletionIntent(f.query('SELECT setting_value FROM app_settings WHERE setting_key=?', [FINANCIAL_LIFECYCLE_KEY]).rows.item(0)?.setting_value);
    f.query('UPDATE app_settings SET setting_value=? WHERE setting_key=?', [JSON.stringify({ ...current, phase: 'completed', reminderIds: [] }), FINANCIAL_LIFECYCLE_KEY]);
    f.native.exec("INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('new','Synthetic','bankAccount','active','COP',100,'2026-01-01','2026-01-01')");
    f.resetTrace();
    expect((await repository.deleteFinancialData(id, inventory)).status).toBe('rolledBack');
    expect(f.trace.filter(entry => /^DELETE/.test(entry.sql))).toHaveLength(0);
    expect(f.query('SELECT id FROM accounts').rows.item(0)?.id).toBe('new');
  } finally { f.native.close(); }
});
