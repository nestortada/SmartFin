import { sharedExpenseFixture } from './helpers/sharedExpenseFixture';
import { createSharedExpenseApi } from '../src/modules/transactions/useCases/createSharedExpenseApi';
import { createSqliteSharedExpenseRepository } from '../src/modules/transactions/repositories/sqliteSharedExpenseRepository';
import { getDashboardSummaryFromDb } from '../src/modules/dashboard/useCases/getDashboardSummary';
import type { SQLitePrimitive } from '../src/database/sqliteRows';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const { performance } = require('node:perf_hooks') as {
  performance: { now: () => number };
};
const { version } = require('node:process') as { version: string };

test('a dashboard reader queued during a real shared command observes only committed financial state', async () => {
  const f = await sharedExpenseFixture();
  try {
    const purchase = await f.purchase();
    let signal!: () => void;
    const begun = new Promise<void>(resolve => {
      signal = resolve;
    });
    const execute = f.database.executeSql.bind(f.database);
    let readerStarted: number | undefined;
    let firstReaderSql: number | undefined;
    let committed = false;
    const database = new Proxy(f.database, {
      get(target, key) {
        if (key !== 'executeSql') return Reflect.get(target, key);
        return async (sql: string, values: SQLitePrimitive[] = []) => {
          if (
            committed &&
            readerStarted !== undefined &&
            firstReaderSql === undefined
          )
            firstReaderSql = performance.now();
          const result = await execute(sql, values);
          if (sql === 'BEGIN IMMEDIATE;') signal();
          if (sql === 'COMMIT;') committed = true;
          return result;
        };
      },
    });
    const api = createSharedExpenseApi(
      createSqliteSharedExpenseRepository(database),
    );
    const pending = api.forgiveParticipation('reader-loss', {
      participationId: purchase.participationId,
      amount: 5000,
      date: '2026-10-10',
    });
    await begun;
    const readStart = performance.now();
    readerStarted = readStart;
    const reader = getDashboardSummaryFromDb(
      database,
      new Date('2026-10-12T12:00:00Z'),
    );
    const result = await pending;
    const summary = await reader;
    expect(summary).toEqual(await f.summary(new Date('2026-10-12T12:00:00Z')));
    expect(result.effects!.receivableDelta).toBe(-5000);
    expect(firstReaderSql).toBeDefined();
    expect(firstReaderSql! >= readStart).toBe(true);
    const fs = require('node:fs') as {
      writeFileSync: (file: string, text: string) => void;
    };
    fs.writeFileSync(
      'docs/performance/shared-commands/node-reader-wait.json',
      JSON.stringify(
        {
          runtime: version,
          operation: 'forgiveParticipation',
          readerWaitMs: firstReaderSql! - readStart,
          scope: 'application maintenance queue; no injected sleep',
          summary,
        },
        null,
        2,
      ),
    );
  } finally {
    f.native.close();
  }
});
