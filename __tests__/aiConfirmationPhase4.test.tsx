jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
jest.mock('react-native-config', () => ({}));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { useAiAssistantController } from '../src/modules/transactions/hooks/useAiAssistantController';
import { createSqliteAiDraftRepository } from '../src/modules/transactions/repositories/sqliteAiDraftRepository';
import * as executor from '../src/modules/transactions/useCases/executeAiCommandPlan';
import { SQLiteCommandFailure } from '../src/database/atomicSQLite';
import type { AiCommandDraft } from '../src/modules/transactions/types';

beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] }); jest.setSystemTime(FINANCIAL_TEST_DATE); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

async function setup(onCommitted = jest.fn()) {
  const f = await financialIntegrityFixture({ managed: true });
  f.native.exec("INSERT INTO categories VALUES ('entertainment','Entretenimiento','expense','entertainment','#000')");
  const draft: AiCommandDraft = {
    id: 'review', rawInput: 'Netflix', phase: 'review', messages: [], clarificationHistory: [], createdAt: FINANCIAL_TEST_DATE.toISOString(), updatedAt: FINANCIAL_TEST_DATE.toISOString(),
    plan: { version: 1, summary: 'Netflix', answeredFields: ['netflix.subcategoryId'], actions: [{ id: 'netflix', entity: 'subscription', operation: 'create', fields: {
      name: 'Netflix', merchantName: 'Netflix', amount: 44900, accountId: 'bank', categoryId: 'entertainment', subcategoryId: null,
      anchorDate: '2026-10-31', billingDay: 31, periodicity: 'monthly', remindersEnabled: false,
    } }] },
  };
  await createSqliteAiDraftRepository(f.database).saveActiveDraft(draft);
  let controller!: ReturnType<typeof useAiAssistantController>;
  function Probe() { controller = useAiAssistantController(f.database, onCommitted); return null; }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Probe />); });
  expect(controller.questions).toHaveLength(0);
  return { ...f, current: () => controller, renderer, onCommitted };
}

test('postcommit callback failure keeps financial success and consumed receipt, never offers another financial application', async () => {
  const f = await setup(jest.fn(() => { throw new Error('view failed'); }));
  try {
    await act(async () => { await f.current().confirm(); });
    expect(f.current().draft).toBeUndefined();
    expect(f.current().resultMessages.join(' ')).toContain('Suscripción creada');
    expect(f.current().errorMessage).toContain('Operaciones guardadas');
    expect(f.query("SELECT phase FROM ai_command_drafts WHERE id='review'").rows.item(0)?.phase).toBe('confirmed');
    await act(async () => { await f.current().confirm(); });
    expect(f.query('SELECT * FROM recurring_subscriptions').rows.length).toBe(1);
  } finally { await act(async () => f.renderer.unmount()); f.native.close(); }
});

test('unknown blocks confirmation, correction and cancellation in the same controller instance', async () => {
  const f = await setup();
  const execute = jest.spyOn(executor, 'executeAiCommandPlan').mockRejectedValue(new SQLiteCommandFailure({ status: 'unknown', error: new Error('lost receipt') }));
  try {
    await act(async () => { await f.current().confirm(); });
    expect(f.current().errorMessage).toContain('No se pudo confirmar');
    await act(async () => { await f.current().confirm(); await f.current().cancelDraft(); f.current().correctDraft(); });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(f.current().draft?.id).toBe('review');
    expect(f.current().isCorrectionComposerOpen).toBe(false);
  } finally { await act(async () => f.renderer.unmount()); f.native.close(); }
});

test('confirmed rollback keeps draft and permits only an explicit next confirmation', async () => {
  const f = await setup();
  const execute = jest.spyOn(executor, 'executeAiCommandPlan').mockRejectedValueOnce(new Error('rolled back domain error'));
  try {
    await act(async () => { await f.current().confirm(); });
    expect(f.current().draft?.id).toBe('review');
    expect(execute).toHaveBeenCalledTimes(1);
    await act(async () => { await f.current().confirm(); });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(f.current().draft).toBeUndefined();
  } finally { await act(async () => f.renderer.unmount()); f.native.close(); }
});
