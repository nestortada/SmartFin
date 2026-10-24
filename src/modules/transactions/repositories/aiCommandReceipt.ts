import type { SmartFinSQLiteDatabase } from '../../../database';
import { getFinancialDataRevision } from '../../../database/sqliteDatabase';
import { readString, resultSetToRows } from '../../../database/sqliteRows';
import type { AiCommandPlan } from '../types';
import { stableJson as aiPlanIdentity } from '../../../shared/utils/stableJson';
export { stableJson as aiPlanIdentity } from '../../../shared/utils/stableJson';

export function decodeStoredAiPlan(json: string): Record<string, unknown> {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('El borrador guardado no es válido.');
  return value as Record<string, unknown>;
}

export function storedAiPlanIdentity(stored: Record<string, unknown>): string {
  const plan = Object.fromEntries(
    Object.entries(stored).filter(
      ([key]) => !['_localReviewRevision', '_localCompleted'].includes(key),
    ),
  );
  return aiPlanIdentity(plan);
}

/** Only called with an owned participant. A receipt is committed with its effects. */
export async function readAiCommandReceipt(
  database: SmartFinSQLiteDatabase,
  draftId: string,
  plan: AiCommandPlan,
): Promise<string[] | undefined> {
  const [result] = await database.executeSql(
    'SELECT phase, plan_json FROM ai_command_drafts WHERE id = ?;',
    [draftId],
  );
  const row = resultSetToRows(result)[0];
  if (!row) return undefined; // Immediate internal caller, no historical review snapshot.
  const stored = decodeStoredAiPlan(readString(row, 'plan_json'));
  if (storedAiPlanIdentity(stored) !== aiPlanIdentity(plan))
    throw new Error(
      'El ID del borrador corresponde a otro contenido. Genera una nueva solicitud.',
    );
  if (row.phase === 'confirmed') {
    const completed = stored._localCompleted;
    if (
      !Array.isArray(completed) ||
      !completed.every((value: unknown) => typeof value === 'string')
    )
      throw new Error(
        'El comprobante requiere verificación. No repitas la operación.',
      );
    return completed as string[];
  }
  if (!['review', 'clarifying'].includes(readString(row, 'phase')))
    throw new Error(
      'El borrador requiere verificación. No repitas la operación.',
    );
  if (
    stored._localReviewRevision !== (await getFinancialDataRevision(database))
  )
    throw new Error(
      'Los datos cambiaron desde la generación del borrador. Genera una nueva solicitud y revísala.',
    );
  return undefined;
}

export async function confirmAiCommandReceipt(
  database: SmartFinSQLiteDatabase,
  draftId: string,
  plan: AiCommandPlan,
  completed: string[],
): Promise<void> {
  const now = new Date().toISOString();
  const json = JSON.stringify({ ...plan, _localCompleted: completed });
  await database.executeSql(
    "UPDATE ai_command_drafts SET phase = 'confirmed', plan_json = ?, updated_at = ? WHERE id = ?;",
    [json, now, draftId],
  );
  await database.executeSql(
    `INSERT INTO ai_command_drafts
    (id,raw_input,plan_json,messages_json,clarification_history_json,phase,created_at,updated_at)
    SELECT ?,?,?, '[]','[]','confirmed',?,? WHERE NOT EXISTS (SELECT 1 FROM ai_command_drafts WHERE id = ?);`,
    [draftId, plan.summary, json, now, now, draftId],
  );
}
