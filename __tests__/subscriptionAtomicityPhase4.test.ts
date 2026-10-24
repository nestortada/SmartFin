jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
jest.mock('react-native-config', () => ({}));
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState, requireIntegralRollback } from './helpers/financialState';
import * as sqliteDatabase from '../src/database/sqliteDatabase';
import * as remindersModule from '../src/modules/subscriptions/services/androidSubscriptionReminderService';
import { getSubscriptionApi, runSubscriptionMaintenance } from '../src/modules/subscriptions/services/subscriptionRuntime';
import { createSqliteSubscriptionRepository } from '../src/modules/subscriptions/repositories/sqliteSubscriptionRepository';
import { createSubscriptionApi } from '../src/modules/subscriptions/useCases/createSubscriptionApi';
import { createSubscriptionInCommand } from '../src/modules/subscriptions/useCases/createSubscriptionInCommand';
import { manageSQLiteDatabase } from '../src/database/managedSQLite';
import type { SubscriptionReminderService } from '../src/modules/subscriptions/services/SubscriptionReminderService';
import type { SubscriptionApi } from '../src/modules/subscriptions/useCases/createSubscriptionApi';
const { performance } = require('node:perf_hooks') as { performance: { now: () => number } };
const { writeFileSync } = require('node:fs') as { writeFileSync: (path: string, text: string) => void };
const matrixEvidence: { flow: string; writes: number; verifiedPositions: number }[] = [];
let maintenanceEvidence: { operationMs: number; readerBatch: number; batches: number } | undefined;
afterAll(() => writeFileSync('docs/atomicidad-fase4/node-subscriptions-matrix.json', JSON.stringify({ matrix: matrixEvidence, maintenance: maintenanceEvidence, complete: matrixEvidence.length === 10 && matrixEvidence.every(flow => flow.verifiedPositions === flow.writes * 2) }, null, 2)));

const input = { name: 'Netflix', amount: 44900, anchorDate: '2026-10-15', accountId: 'bank', recurrence: { periodicity: 'monthly' as const }, reminders: { enabled: true } };
const makeService = (): SubscriptionReminderService => ({ getStatus: jest.fn(async () => ({ available: true, permission: 'granted' as const })), requestPermission: jest.fn(async () => ({ available: true, permission: 'granted' as const })), ensureMaintenance: jest.fn(async () => undefined), schedule: jest.fn(async () => undefined), cancel: jest.fn(async () => undefined), cancelAll: jest.fn(async () => undefined) });
beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] }); jest.setSystemTime(FINANCIAL_TEST_DATE); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

async function fixture() {
  const f = await financialIntegrityFixture({ managed: true });
  const service = makeService();
  jest.spyOn(sqliteDatabase, 'openSmartFinDatabase').mockResolvedValue(f.database);
  jest.spyOn(remindersModule, 'createSubscriptionReminderService').mockReturnValue(service);
  const api = await getSubscriptionApi();
  return { ...f, api, service };
}

type Flow = 'create' | 'update' | 'pause' | 'resume' | 'cancel' | 'amount' | 'confirm' | 'skip' | 'category' | 'subcategory';
async function setup(flow: Flow) {
  const f = await fixture();
  let id = ''; let occurrenceId = ''; let transactionId = '';
  if (!['create', 'category', 'subcategory'].includes(flow)) {
    id = (await f.api.createSubscription(input)).value.id;
    occurrenceId = (await f.api.getSubscriptionHistory(id)).find(item => item.expectedDate === input.anchorDate)!.id;
    if (flow === 'resume') await f.api.pauseSubscription(id);
    if (flow === 'confirm') transactionId = (await f.save({ amount: 45900 })).transaction.id;
  }
  if (flow === 'category' || flow === 'subcategory') {
    await f.api.createSubscription(input);
    // Leave real synchronization work after the category write.
    f.native.exec("DELETE FROM cash_flow_events WHERE source_entity_type='subscription_occurrence'");
    f.native.exec("INSERT INTO categories VALUES ('expense','Servicios','expense','other','#000')");
  }
  const run = (api: SubscriptionApi) => {
    switch (flow) {
      case 'create': return api.createSubscription(input);
      case 'update': return api.updateSubscription(id, { amount: 46000 });
      case 'pause': return api.pauseSubscription(id);
      case 'resume': return api.resumeSubscription(id);
      case 'cancel': return api.cancelSubscription(id);
      case 'amount': return api.updateSubscriptionOccurrenceAmount(occurrenceId, 47000);
      case 'confirm': return api.confirmSubscriptionPayment({ occurrenceId, transactionId });
      case 'skip': return api.skipSubscriptionOccurrence(occurrenceId);
      case 'category': return api.createSubscriptionCategory('Streaming');
      case 'subcategory': return api.createSubscriptionSubcategory('expense', 'Video');
    }
  };
  return { ...f, run };
}

test.each<Flow>(['create', 'update', 'pause', 'resume', 'cancel', 'amount', 'confirm', 'skip', 'category', 'subcategory'])('%s: all financial writes before/after failure preserve exact initial snapshot; OS effects only follow success', async flow => {
  const evidence = { flow, writes: 0, verifiedPositions: 0 }; matrixEvidence.push(evidence);
  const discovery = await setup(flow);
  let writes: number;
  try {
    discovery.resetTrace(); await discovery.run(discovery.api);
    const firstCommit = discovery.trace.findIndex(entry => /^COMMIT/.test(entry.sql));
    writes = discovery.trace.slice(0, firstCommit).filter(entry => entry.write).length;
    evidence.writes = writes;
    expect(writes).toBeGreaterThan(0);
    expect(discovery.trace.filter(entry => /^BEGIN/.test(entry.sql))).toHaveLength(1);
  } finally { discovery.native.close(); }
  for (let write = 1; write <= writes; write += 1) for (const phase of ['before', 'after'] as const) {
    const f = await setup(flow);
    try {
      const before = await financialState(f); f.resetTrace(); f.injectFault({ write, phase });
      jest.mocked(f.service.schedule).mockClear(); jest.mocked(f.service.cancel).mockClear();
      await expect(f.run(f.api)).rejects.toThrow();
      expect(f.trace.some(entry => entry.outcome === `injected-${phase}`)).toBe(true);
      requireIntegralRollback(before, await financialState(f));
      expect(f.service.schedule).not.toHaveBeenCalled(); expect(f.service.cancel).not.toHaveBeenCalled();
      evidence.verifiedPositions += 1;
    } finally { f.native.close(); }
  }
});

test('maintenance requests share one run, yields between bounded batches, repairs alarms once at end and permits later fresh runs', async () => {
  const f = await financialIntegrityFixture();
  const service = makeService();
  const direct = createSubscriptionApi({ repository: createSqliteSubscriptionRepository(f.database), reminderService: service });
  await direct.createSubscription({ ...input, recurrence: { periodicity: 'custom', interval: 1, unit: 'days' }, anchorDate: '2022-01-01', reminders: { enabled: false } });
  let reached!: () => void; let release!: () => void;
  const arrived = new Promise<void>(resolve => { reached = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let batches = 0;
  const adapter = new Proxy(f.database, { get(target, key) {
    if (key === 'transaction') return async (...args: Parameters<typeof target.transaction>) => {
      const result = await target.transaction(...args);
      batches += 1;
      if (batches === 1) { reached(); await gate; }
      return result;
    };
    return Reflect.get(target, key);
  } });
  const database = manageSQLiteDatabase(adapter);
  jest.spyOn(sqliteDatabase, 'openSmartFinDatabase').mockResolvedValue(database);
  jest.spyOn(remindersModule, 'createSubscriptionReminderService').mockReturnValue(service);
  const api = await getSubscriptionApi();
  f.resetTrace(); jest.mocked(service.ensureMaintenance).mockClear();
  const start = performance.now();
  const first = runSubscriptionMaintenance();
  await arrived;
  const second = runSubscriptionMaintenance(); const screen = api.syncSubscriptions();
  let readerBatch = -1;
  const reader = database.executeSql("SELECT balance_amount FROM accounts WHERE id='bank'").then(() => { readerBatch = batches; });
  release();
  try {
    expect(await first).toBe(true); expect(await second).toBe(true); await screen; await reader;
    expect(batches).toBeGreaterThan(1); expect(batches).toBeLessThanOrEqual(20);
    expect(readerBatch).toBe(1);
    expect(service.ensureMaintenance).toHaveBeenCalledTimes(1);
    const totals = f.query('SELECT subscription_id,expected_date,count(*) AS n FROM subscription_occurrences GROUP BY subscription_id,expected_date').rows.raw();
    expect(totals.every(row => row.n === 1)).toBe(true);
    expect((await f.snapshot()).balances.bank).toBe(1000000);
    expect(f.query('PRAGMA integrity_check').rows.item(0)).toMatchObject({ integrity_check: 'ok' });
    // Evidence is a synthetic sample of the complete request, not a device/FPS benchmark.
    expect(performance.now() - start).toBeLessThan(30000);
    maintenanceEvidence = { operationMs: performance.now() - start, readerBatch, batches };
    await api.syncSubscriptions();
    expect(service.ensureMaintenance).toHaveBeenCalledTimes(2);
  } finally { f.native.close(); }
});

test('confirmed reminder cancellation is not repeated and scheduling still recovers after reboot', async () => {
  const f = await fixture();
  try {
    const id = (await f.api.createSubscription(input)).value.id;
    jest.mocked(f.service.schedule).mockClear();
    await f.api.syncSubscriptionReminders();
    expect(f.service.schedule).toHaveBeenCalled(); // applied_revision alone does not prove an OS alarm survived reboot.
    await f.api.cancelSubscription(id);
    const before = await financialState(f);
    jest.mocked(f.service.cancel).mockClear();
    await f.api.syncSubscriptionReminders();
    expect(await financialState(f)).toEqual(before);
    expect(f.service.cancel).not.toHaveBeenCalled();
  } finally { f.native.close(); }
});

test('a writer between the last batch and platform sync invalidates coalescing and cannot omit new obligations', async () => {
  const f = await financialIntegrityFixture(); const service = makeService();
  const direct = createSubscriptionApi({ repository: createSqliteSubscriptionRepository(f.database), reminderService: service, createId: () => 'paused' });
  await direct.createSubscription({ ...input, status: 'paused' });
  expect(f.query('SELECT * FROM subscription_occurrences').rows.length).toBe(0);
  let reached!: () => void; let release!: () => void;
  const arrived = new Promise<void>(resolve => { reached = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  let transactions = 0;
  const database = manageSQLiteDatabase(new Proxy(f.database, { get(target, key) {
    if (key === 'transaction') return async (...args: Parameters<typeof target.transaction>) => {
      const result = await target.transaction(...args); transactions += 1;
      if (transactions === 1) { reached(); await gate; } return result;
    };
    return Reflect.get(target, key);
  } }));
  jest.spyOn(sqliteDatabase, 'openSmartFinDatabase').mockResolvedValue(database);
  jest.spyOn(remindersModule, 'createSubscriptionReminderService').mockReturnValue(service);
  const maintenance = runSubscriptionMaintenance(); await arrived;
  const writer = database.executeSql("UPDATE recurring_subscriptions SET status='active' WHERE id='paused'");
  const duplicate = runSubscriptionMaintenance(); release();
  try {
    await writer; expect(await maintenance).toBe(true); expect(await duplicate).toBe(true);
    expect(transactions).toBe(2);
    expect(f.query('SELECT * FROM subscription_occurrences').rows.length).toBeGreaterThan(0);
    expect((await f.snapshot()).balances.bank).toBe(1000000);
  } finally { f.native.close(); }
});

test('legacy deterministic subscription ID cannot silently accept different contract terms', async () => {
  const f = await fixture();
  try {
    await createSubscriptionInCommand(f.database, input, 'same');
    const before = await financialState(f);
    await expect(createSubscriptionInCommand(f.database, { ...input, amount: 1 }, 'same')).rejects.toThrow('otro contenido');
    requireIntegralRollback(before, await financialState(f));
  } finally { f.native.close(); }
});
