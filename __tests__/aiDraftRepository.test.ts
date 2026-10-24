import type { ResultSet } from 'react-native-sqlite-storage';

import type { SmartFinSQLiteDatabase } from '../src/database';
import { createSqliteAiDraftRepository, type AiCommandDraft } from '../src/modules/transactions';
import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';

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
  const sql = realSQLite();
  for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
  await applyVersionedMigrations(sql.database);
  const repository = createSqliteAiDraftRepository(sql.database);
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

  try {
    await repository.saveActiveDraft(draft);
    const row = sql.query('SELECT * FROM ai_command_drafts').rows.item(0);
    expect(row?.messages_json).toContain('Recibí 900 mil');
    expect(row?.clarification_history_json).toContain('No, ocurre solo esta vez');
    expect(await repository.loadActiveDraft()).toEqual(draft);
  } finally { sql.native.close(); }
});

test('replacing the active draft is atomic at every write and preserves the original createdAt', async () => {
  const original: AiCommandDraft = { id: 'previous', rawInput: 'Anterior', phase: 'review', clarificationHistory: [], messages: [],
    createdAt: '2026-10-01', updatedAt: '2026-10-01', plan: { version: 1, summary: 'Anterior', actions: [{ id: 'category', entity: 'category', operation: 'create', fields: { name: 'Servicios' } }], answeredFields: [] } };
  for (const write of [1, 2, 3]) for (const phase of ['before', 'after'] as const) {
    const sql = realSQLite();
    try {
      for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
      await applyVersionedMigrations(sql.database);
      const repository = createSqliteAiDraftRepository(sql.database);
      await repository.saveActiveDraft(original);
      const before = sql.query('SELECT * FROM ai_command_drafts').rows.raw();
      sql.resetTrace(); sql.injectFault({ write, phase });
      await expect(repository.saveActiveDraft({ ...original, id: 'new' })).rejects.toThrow('Injected');
      expect(sql.query('SELECT * FROM ai_command_drafts').rows.raw()).toEqual(before);
      await repository.saveActiveDraft({ ...original, rawInput: 'Editado', createdAt: 'wrong', updatedAt: '2026-10-02' });
      expect((await repository.loadActiveDraft())?.createdAt).toBe(original.createdAt);
    } finally { sql.native.close(); }
  }
});
