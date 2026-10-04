import type { ResultSet } from 'react-native-sqlite-storage';

import type { SmartFinSQLiteDatabase } from '../src/database';
import { createSqliteAiDraftRepository, type AiCommandDraft } from '../src/modules/transactions';

function createResultSet(rows: Record<string, string>[]): ResultSet {
  return {
    insertId: 0,
    rows: {
      item: (index: number) => rows[index],
      length: rows.length,
      raw: () => rows,
    },
    rowsAffected: 0,
  };
}

test('AI draft repository restores migrated drafts with empty conversation history', async () => {
  const row = {
    clarification_history_json: '[]',
    created_at: '2026-09-27T12:00:00.000Z',
    id: 'draft-1',
    messages_json: '[]',
    phase: 'review',
    plan_json: JSON.stringify({
      actions: [{ entity: 'transaction', fields: { amount: 900000 }, id: 'income', operation: 'create' }],
      summary: 'Ingreso',
    }),
    raw_input: 'Recibí 900 mil',
    updated_at: '2026-09-27T12:01:00.000Z',
  };
  const executeSql = jest.fn(async (statement: string) => [
    createResultSet(statement.includes('SELECT id') ? [row] : []),
  ] as const);
  const repository = createSqliteAiDraftRepository({ executeSql } as unknown as SmartFinSQLiteDatabase);

  await expect(repository.loadActiveDraft()).resolves.toEqual(expect.objectContaining({
    clarificationHistory: [],
    id: 'draft-1',
    messages: [],
  }));
});

test('AI draft repository persists messages and question answers in local JSON', async () => {
  const executeSql = jest.fn(async (_statement: string, _values?: unknown[]) => [createResultSet([])] as const);
  const repository = createSqliteAiDraftRepository({ executeSql } as unknown as SmartFinSQLiteDatabase);
  const draft: AiCommandDraft = {
    clarificationHistory: [{
      actionId: 'income', answerLabel: 'No, ocurre solo esta vez', answerValue: 'false',
      answeredAt: '2026-09-27T12:01:00.000Z', contextLabel: 'Cuenta Davivienda',
      field: 'recurringIncomeEnabled', id: 'answer-1', prompt: '¿Se repetirá?',
    }],
    createdAt: '2026-09-27T12:00:00.000Z',
    id: 'draft-1',
    messages: [{ createdAt: '2026-09-27T12:00:00.000Z', id: 'message-1', role: 'user', text: 'Recibí 900 mil' }],
    phase: 'review',
    plan: {
      actions: [{ entity: 'transaction', fields: { amount: 900000 }, id: 'income', operation: 'create' }],
      answeredFields: [], summary: 'Ingreso', version: 1,
    },
    rawInput: 'Recibí 900 mil',
    updatedAt: '2026-09-27T12:01:00.000Z',
  };

  await repository.saveActiveDraft(draft);

  const insertCall = executeSql.mock.calls.find(call => String(call[0]).includes('INSERT OR REPLACE'));
  expect(insertCall?.[1]?.[3]).toContain('Recibí 900 mil');
  expect(insertCall?.[1]?.[4]).toContain('No, ocurre solo esta vez');
});
