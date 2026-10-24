import type { SmartFinSQLiteDatabase } from '../../../database';
import { readString, resultSetToRows } from '../../../database';
import { parseAiCommandPlan } from '../useCases/aiCommandPlanner';
import type {
  AiAssistantMessage,
  AiClarificationExchange,
  AiCommandDraft,
} from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseMessages(value: string): AiAssistantMessage[] {
  try {
    const decoded: unknown = JSON.parse(value);
    if (!Array.isArray(decoded)) return [];
    return decoded.flatMap(item => {
      if (!isRecord(item) || (item.role !== 'user' && item.role !== 'assistant')) return [];
      if (typeof item.id !== 'string' || typeof item.text !== 'string' || typeof item.createdAt !== 'string') return [];
      return [{ createdAt: item.createdAt, id: item.id, role: item.role, text: item.text }];
    });
  } catch {
    return [];
  }
}

function parseClarificationHistory(value: string): AiClarificationExchange[] {
  try {
    const decoded: unknown = JSON.parse(value);
    if (!Array.isArray(decoded)) return [];
    return decoded.flatMap(item => {
      if (!isRecord(item)) return [];
      const keys = ['actionId', 'answerLabel', 'answerValue', 'answeredAt', 'contextLabel', 'field', 'id', 'prompt'] as const;
      if (keys.some(key => typeof item[key] !== 'string')) return [];
      return [{
        actionId: item.actionId as string,
        answerLabel: item.answerLabel as string,
        answerValue: item.answerValue as string,
        answeredAt: item.answeredAt as string,
        contextLabel: item.contextLabel as string,
        field: item.field as string,
        id: item.id as string,
        prompt: item.prompt as string,
      }];
    });
  } catch {
    return [];
  }
}

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
        `SELECT id, raw_input, plan_json, messages_json, clarification_history_json,
                phase, created_at, updated_at
         FROM ai_command_drafts ORDER BY updated_at DESC LIMIT 1;`,
      );
      const row = resultSetToRows(resultSet)[0];
      if (!row) {
        return undefined;
      }
      return {
        id: readString(row, 'id'),
        clarificationHistory: parseClarificationHistory(readString(row, 'clarification_history_json')),
        messages: parseMessages(readString(row, 'messages_json')),
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
          id, raw_input, plan_json, messages_json, clarification_history_json,
          phase, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          draft.id,
          draft.rawInput,
          JSON.stringify(draft.plan),
          JSON.stringify(draft.messages),
          JSON.stringify(draft.clarificationHistory),
          draft.phase,
          draft.createdAt,
          draft.updatedAt,
        ],
      );
    },
  };
}
