import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { dashboardFixture, dashboardTransaction, insertSyntheticHistory } from './helpers/dashboardFixture';
import { useTransactionsList } from '../src/modules/transactions/hooks/useTransactionsList';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';
import type { SQLitePrimitive } from '../src/database/sqliteRows';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
type History = ReturnType<typeof useTransactionsList>;
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function mount(database: SmartFinSQLiteDatabase) {
  let history: History | undefined;
  const latest = () => { if (!history) throw new Error('Hook missing'); return history; };
  function Probe({ refresh = 0 }: { refresh?: number }) {
    history = useTransactionsList(database, refresh);
    return null;
  }
  let view: ReactTestRenderer | undefined;
  await act(async () => { view = create(<Probe />); });
  if (!view) throw new Error('Renderer missing');
  return { latest, view, refresh: async (refresh: number) => {
    await act(async () => view?.update(<Probe refresh={refresh} />));
  }, close: () => act(() => view?.unmount()) };
}
beforeEach(() => { Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true }); });

test('limited initial data, repeated end events, refresh depth and a transaction inserted while loading', async () => {
  const f = await dashboardFixture();
  insertSyntheticHistory(f, 215);
  const gate = deferred();
  let block = false;
  let blocked = false;
  const database = new Proxy(f.database, { get(target, key) {
    if (key !== 'executeSql') return Reflect.get(target, key);
    return async (sql: string, values: SQLitePrimitive[] = []) => {
      const result = await target.executeSql(sql, values);
      if (block && sql.includes('history_rowid') && !blocked) { blocked = true; await gate.promise; }
      return result;
    };
  } });
  const probe = await mount(database);
  try {
    expect(probe.latest().transactions).toHaveLength(50);
    expect(probe.latest().months.length).toBeGreaterThan(1);
    await act(async () => { probe.latest().loadMore(); probe.latest().loadMore(); probe.latest().loadMore(); });
    expect(probe.latest().transactions).toHaveLength(100);
    const id = probe.latest().transactions[20]?.id ?? '';
    f.native.prepare('UPDATE transactions SET description = ? WHERE id = ?').run('edited', id);
    await probe.refresh(1);
    expect(probe.latest().transactions).toHaveLength(100);
    expect(probe.latest().transactions.find(tx => tx.id === id)?.description).toBe('edited');
    block = true;
    await act(async () => probe.latest().loadMore());
    expect(probe.latest().loadingMore).toBe(true);
    f.insertTransaction(dashboardTransaction({ id: 'new', date: '2027-01-01T00:00:00.000Z' }));
    await act(async () => gate.resolve());
    expect(probe.latest().transactions).toHaveLength(100);
    expect(probe.latest().transactions[0]?.id).toBe('new');
    expect(new Set(probe.latest().transactions.map(tx => tx.id)).size).toBe(100);
    f.native.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    await probe.refresh(2);
    expect(probe.latest().transactions.find(tx => tx.id === id)).toBeUndefined();
    while (probe.latest().hasMore) await act(async () => probe.latest().loadMore());
    expect(probe.latest().transactions).toHaveLength(215);
  } finally { gate.resolve(); probe.close(); f.native.close(); }
});

test('changing search/account/sort during an outstanding page discards the old response', async () => {
  const f = await dashboardFixture();
  insertSyntheticHistory(f, 1000);
  const gate = deferred();
  let blocked = false;
  const database = new Proxy(f.database, { get(target, key) {
    if (key !== 'executeSql') return Reflect.get(target, key);
    return async (sql: string, values: SQLitePrimitive[] = []) => {
      const result = await target.executeSql(sql, values);
      if (sql.includes('history_rowid') && values.length > 2 && !blocked) { blocked = true; await gate.promise; }
      return result;
    };
  } });
  const probe = await mount(database);
  try {
    await act(async () => probe.latest().loadMore());
    expect(blocked).toBe(true);
    await act(async () => {
      probe.latest().setSearchQuery('merchant 49');
      probe.latest().setSelectedAccount('bank');
      probe.latest().setSortOrder('oldest');
    });
    const expected = probe.latest().transactions;
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.every(tx => tx.description.includes('merchant 49'))).toBe(true);
    await act(async () => gate.resolve());
    expect(probe.latest().transactions).toEqual(expected);
    expect(probe.latest().loadingMore).toBe(false);
  } finally { gate.resolve(); probe.close(); f.native.close(); }
});

test('page errors keep the loaded rows and allow retry', async () => {
  const f = await dashboardFixture();
  insertSyntheticHistory(f, 101);
  const probe = await mount(f.database);
  try {
    f.failOn('history_rowid');
    await act(async () => probe.latest().loadMore());
    expect(probe.latest().transactions).toHaveLength(50);
    expect(probe.latest().error).toBeDefined();
    f.failOn();
    await act(async () => probe.latest().loadMore());
    expect(probe.latest().transactions).toHaveLength(100);
    expect(probe.latest().error).toBeUndefined();
  } finally { probe.close(); f.native.close(); }
});
