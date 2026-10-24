jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { financialState } from './helpers/financialState';
import { runSubscriptionMaintenance } from '../src/modules/subscriptions/services/subscriptionRuntime';
import { runSubscriptionMaintenance as previousMaintenance } from './helpers/phase4SubscriptionRuntime';
import { createSubscriptionApi } from '../src/modules/subscriptions/useCases/createSubscriptionApi';
import { createSqliteSubscriptionRepository } from '../src/modules/subscriptions/repositories/sqliteSubscriptionRepository';
import * as sqliteDatabase from '../src/database/sqliteDatabase';
import * as platform from '../src/modules/subscriptions/services/androidSubscriptionReminderService';
import { manageSQLiteDatabase } from '../src/database/managedSQLite';
import type { SubscriptionReminderService } from '../src/modules/subscriptions/services/SubscriptionReminderService';
const { performance } = require('node:perf_hooks') as { performance: { now: () => number } };
const { writeFileSync } = require('node:fs') as { writeFileSync: (path: string, text: string) => void };

test('same concurrent requests before/after: exact persisted equivalence, fewer OS passes and bounded reader wait', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] }); jest.setSystemTime(FINANCIAL_TEST_DATE);
  const samples = [];
  let baselineState;
  try {
    for (const version of ['before', 'after'] as const) {
      const f = await financialIntegrityFixture();
      let platformPasses = 0;
      const service: SubscriptionReminderService = { getStatus: async () => ({ available: true, permission: 'granted' }), requestPermission: async () => ({ available: true, permission: 'granted' }), ensureMaintenance: async () => { platformPasses += 1; }, schedule: async () => {}, cancel: async () => {}, cancelAll: async () => {} };
      await createSubscriptionApi({ repository: createSqliteSubscriptionRepository(f.database), reminderService: service, createId: () => 'contract' }).createSubscription({ name: 'Mensual', amount: 1000, accountId: 'bank', anchorDate: '2026-10-15', recurrence: { periodicity: 'monthly' }, reminders: { enabled: false } });
      platformPasses = 0;
      let reached!: () => void; let release!: () => void;
      const arrived = new Promise<void>(resolve => { reached = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
      let batches = 0;
      const database = manageSQLiteDatabase(new Proxy(f.database, { get(target, key) {
        if (key === 'transaction') return async (...args: Parameters<typeof target.transaction>) => {
          const result = await target.transaction(...args); batches += 1;
          if (batches === 1) { reached(); await gate; } return result;
        };
        return Reflect.get(target, key);
      } }));
      jest.spyOn(sqliteDatabase, 'openSmartFinDatabase').mockResolvedValue(database);
      jest.spyOn(platform, 'createSubscriptionReminderService').mockReturnValue(service);
      try {
        const started = performance.now(); const maintenance = (version === 'before' ? previousMaintenance : runSubscriptionMaintenance)();
        await arrived;
        const duplicate = (version === 'before' ? previousMaintenance : runSubscriptionMaintenance)();
        let readerBatch = 0; let readerMs = 0;
        const reader = database.executeSql('SELECT balance_amount FROM accounts').then(() => { readerBatch = batches; readerMs = performance.now() - started; });
        release();
        const outcomes = await Promise.allSettled([maintenance, reader, duplicate]);
        expect(outcomes[0]).toEqual({ status: 'fulfilled', value: true });
        expect(outcomes[1]?.status).toBe('fulfilled');
        expect(outcomes[2]).toEqual({ status: 'fulfilled', value: true });
        const operationMs = performance.now() - started;
        const state = await financialState(f);
        if (version === 'before') { baselineState = state; expect(readerBatch).toBe(batches); expect(platformPasses).toBe(batches); }
        else { expect(state).toEqual(baselineState); expect(readerBatch).toBe(1); expect(platformPasses).toBe(1); }
        samples.push({ version, batches, platformPasses, operationMs, readerMs, readerBatch });
      } finally { f.native.close(); jest.restoreAllMocks(); }
    }
    writeFileSync('docs/atomicidad-fase4/node-maintenance-comparison.json', JSON.stringify({ exactStateEquivalence: true, samples, scope: 'One synthetic sample each, Node SQLite in memory; no FPS claim' }, null, 2));
  } finally { jest.useRealTimers(); }
});
