import type { SmartFinSQLiteDatabase } from '../../../database';
import { readString, resultSetToRows } from '../../../database';
import { parseAiCommandPlan } from '../useCases/aiCommandPlanner';
import type { AiCommandDraft } from '../types';

export type AiDraftRepository = {
  clearActiveDraft: () => Promise<void>;
  loadActiveDraft: () => Promise<AiCommandDraft | undefined>;
  saveActiveDraft: (draft: AiCommandDraft) => Promise<void>;
};

export function createSqliteAiDraftRepository(
  database: SmartFinSQLiteDatabase,
): AiDraftRepository {
  return {
    clearActiveDraft: async () => {
      await database.executeSql('DELETE FROM ai_command_drafts;');
    },
    loadActiveDraft: async () => {
      const [resultSet] = await database.executeSql(
        `SELECT id, raw_input, plan_json, phase, created_at, updated_at
         FROM ai_command_drafts ORDER BY updated_at DESC LIMIT 1;`,
      );
      const row = resultSetToRows(resultSet)[0];
      if (!row) {
        return undefined;
      }
      return {
        id: readString(row, 'id'),
        rawInput: readString(row, 'raw_input'),
        plan: parseAiCommandPlan(JSON.parse(readString(row, 'plan_json')) as unknown),
        phase: readString(row, 'phase') === 'review' ? 'review' : 'clarifying',
        createdAt: readString(row, 'created_at'),
        updatedAt: readString(row, 'updated_at'),
      };
    },
    saveActiveDraft: async draft => {
      await database.executeSql('DELETE FROM ai_command_drafts WHERE id <> ?;', [draft.id]);
      await database.executeSql(
        `INSERT OR REPLACE INTO ai_command_drafts (
          id, raw_input, plan_json, phase, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?);`,
        [
          draft.id,
          draft.rawInput,
          JSON.stringify(draft.plan),
          draft.phase,
          draft.createdAt,
          draft.updatedAt,
        ],
      );
    },
  };
}
