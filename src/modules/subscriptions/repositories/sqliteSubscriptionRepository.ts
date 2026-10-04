import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import {
  runSQLiteTransaction,
  type SQLiteProgram,
} from '../../../database/atomicSQLite';
import {
  readString,
  readNumber,
  readNullableString,
  readNullableNumber,
  resultSetToRows,
  type SQLiteRow,
  type SQLitePrimitive,
} from '../../../database/sqliteRows';
import { rowToTransaction } from '../../transactions/repositories/sqliteTransactionRepository';
import type {
  Subscription,
  SubscriptionOccurrence,
  SubscriptionReminder,
  SubscriptionDiagnostic,
} from '../types';
import {
  parseCivilDate,
  recurrenceInterval,
  roundSubscriptionMoney,
} from '../useCases/recurrence';
import type {
  SubscriptionRepository,
  SubscriptionState,
  SubscriptionProjection,
  SubscriptionAlert,
  SubscriptionScope,
} from './SubscriptionRepository';

function subscription(row: SQLiteRow): Subscription {
  const periodicity = readString(row, 'periodicity');
  const recurrence =
    periodicity === 'custom'
      ? {
          periodicity,
          interval: readNumber(row, 'custom_interval'),
          unit: readString(row, 'custom_unit'),
        }
      : { periodicity };
  if (
    ![
      'weekly',
      'biweekly',
      'monthly',
      'bimonthly',
      'quarterly',
      'semiannual',
      'yearly',
      'custom',
    ].includes(periodicity)
  )
    throw new Error('Periodicidad heredada inválida.');
  const rule = recurrence as Subscription['recurrence'];
  recurrenceInterval(rule);
  const anchorDate = readString(row, 'anchor_date');
  parseCivilDate(anchorDate);
  const cursor = readString(row, 'generation_cursor');
  parseCivilDate(cursor);
  const status = readString(row, 'status');
  if (
    !['active', 'paused', 'cancelled'].includes(status) ||
    row.currency !== 'COP'
  )
    throw new Error('Estado o moneda inválidos.');
  const amount = roundSubscriptionMoney(readNumber(row, 'amount'));
  if (amount <= 0 || !readString(row, 'name').trim())
    throw new Error('Nombre o importe inválidos.');
  const billingDay =
    readNullableNumber(row, 'billing_day') ?? Number(anchorDate.slice(8));
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31)
    throw new Error('Día contractual inválido.');
  const json: unknown = JSON.parse(readString(row, 'reminders_json'));
  if (
    !json ||
    typeof json !== 'object' ||
    !('enabled' in json) ||
    typeof json.enabled !== 'boolean' ||
    !('offsets' in json) ||
    !Array.isArray(json.offsets) ||
    !json.offsets.every(
      (v: unknown) =>
        typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 365,
    ) ||
    !('hour' in json) ||
    typeof json.hour !== 'number' ||
    !Number.isInteger(json.hour) ||
    json.hour < 0 ||
    json.hour > 23 ||
    !('minute' in json) ||
    typeof json.minute !== 'number' ||
    !Number.isInteger(json.minute) ||
    json.minute < 0 ||
    json.minute > 59
  )
    throw new Error('Recordatorios inválidos.');
  return {
    id: readString(row, 'id'),
    name: readString(row, 'name'),
    merchantName: readNullableString(row, 'merchant_name'),
    amount,
    currency: 'COP',
    categoryId: readNullableString(row, 'category_id'),
    subcategoryId: readNullableString(row, 'subcategory_id'),
    accountId: readNullableString(row, 'account_id'),
    recurrence: rule,
    anchorDate,
    generationCursor: cursor,
    billingDay,
    status: status as Subscription['status'],
    nextChargeDate: readNullableString(row, 'next_charge_date')?.slice(0, 10),
    reminders: {
      enabled: json.enabled,
      offsets: json.offsets as number[],
      hour: json.hour,
      minute: json.minute,
    },
    scheduleRevision: readNumber(row, 'schedule_revision'),
    createdAt: readString(row, 'created_at'),
    updatedAt: readString(row, 'updated_at'),
  };
}
function subscriptions(rows: SQLiteRow[]): {
  values: Subscription[];
  diagnostics: SubscriptionDiagnostic[];
} {
  const values: Subscription[] = [];
  const diagnostics: SubscriptionDiagnostic[] = [];
  for (const row of rows) {
    try {
      values.push(subscription(row));
    } catch (error) {
      diagnostics.push({
        subscriptionId: readString(row, 'id'),
        message:
          error instanceof Error ? error.message : 'Configuración inválida.',
      });
    }
  }
  return { values, diagnostics };
}
function camel(key: string): string {
  return key.replace(/_([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}
function snake(key: string): string {
  return key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}
function mapped<T>(row: SQLiteRow): T {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [camel(key), value ?? undefined]),
  ) as T;
}
function record(value: object): SQLiteRow {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]: [string, unknown]) => {
      if (
        item !== undefined &&
        item !== null &&
        typeof item !== 'number' &&
        typeof item !== 'string'
      )
        throw new Error('Registro de persistencia inválido.');
      return [snake(key), item ?? null];
    }),
  ) as SQLiteRow;
}
function subscriptionRecord(value: Subscription): SQLiteRow {
  const { recurrence, reminders, ...rest } = value;
  return {
    ...record(rest),
    periodicity: recurrence.periodicity,
    custom_interval:
      recurrence.periodicity === 'custom' ? recurrence.interval : null,
    custom_unit: recurrence.periodicity === 'custom' ? recurrence.unit : null,
    reminders_json: JSON.stringify(reminders),
  };
}
function* saveChanges(
  table: string,
  before: object[],
  after: object[],
  codec: (value: never) => SQLiteRow,
): SQLiteProgram<void> {
  const old = new Map(
    before.map(value => {
      const row = codec(value as never);
      return [row.id, row];
    }),
  );
  for (const value of after) {
    const row = codec(value as never);
    const previous = old.get(row.id);
    if (
      previous &&
      [...new Set([...Object.keys(previous), ...Object.keys(row)])].every(
        key => (previous[key] ?? null) === (row[key] ?? null),
      )
    )
      continue;
    const keys = Object.keys(row);
    const values = keys.map(key => row[key] ?? null);
    if (previous) {
      const changes = keys.filter(key => key !== 'id');
      yield {
        sql: `UPDATE ${table} SET ${changes
          .map(key => `${key} = ?`)
          .join(',')} WHERE id = ?;`,
        values: [...changes.map(key => row[key] ?? null), row.id ?? null],
      };
    } else {
      yield {
        sql: `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys
          .map(() => '?')
          .join(',')});`,
        values,
      };
    }
  }
  return undefined;
}
export function* loadSubscriptionState(
  scope: SubscriptionScope,
): SQLiteProgram<SubscriptionState> {
  const loaded = subscriptions(
    yield { sql: 'SELECT * FROM recurring_subscriptions;' },
  );
  const occurrences = yield {
    sql: `SELECT * FROM subscription_occurrences WHERE status IN ('pending','overdue') OR expected_date >= ? OR id = ? OR transaction_id = ?;`,
    values: [
      scope.today,
      scope.occurrenceId ?? null,
      scope.transactionId ?? null,
    ],
  };
  const targeted = scope.transactionIds ?? [];
  for (let offset = 0; offset < targeted.length; offset += 900) {
    const ids = targeted.slice(offset, offset + 900);
    const linked = yield {
      sql: `SELECT * FROM subscription_occurrences WHERE transaction_id IN (${ids
        .map(() => '?')
        .join(',')});`,
      values: ids,
    };
    for (const row of linked)
      if (!occurrences.some(value => value.id === row.id))
        occurrences.push(row);
  }
  const reminders = yield {
    sql: "SELECT * FROM subscription_reminders WHERE delivery_status != 'delivered' OR occurrence_id IN (SELECT id FROM subscription_occurrences WHERE expected_date >= ?);",
    values: [scope.today],
  };
  const projections: SQLiteRow[] = [];
  const loadedIds = occurrences.map(row => readString(row, 'id'));
  for (let offset = 0; offset < loadedIds.length; offset += 900) {
    const ids = loadedIds.slice(offset, offset + 900);
    projections.push(
      ...(yield {
        sql: `SELECT * FROM cash_flow_events WHERE source_entity_type = 'subscription_occurrence' AND source_entity_id IN (${ids
          .map(() => '?')
          .join(',')});`,
        values: ids,
      }),
    );
  }
  const alerts = yield {
    sql: "SELECT * FROM smart_alerts WHERE related_entity_type IN ('subscription','subscription_occurrence');",
  };
  const accounts = yield {
    sql: 'SELECT id,type,status,currency FROM accounts;',
  };
  const categories = yield { sql: 'SELECT id,type FROM categories;' };
  const subcategories = yield {
    sql: 'SELECT id,category_id,is_active FROM subcategories;',
  };
  const transactions = yield {
    sql: 'SELECT * FROM transactions WHERE id = ? OR id IN (SELECT transaction_id FROM subscription_occurrences WHERE transaction_id IS NOT NULL);',
    values: [scope.transactionId ?? null],
  };
  return {
    subscriptions: loaded.values,
    diagnostics: loaded.diagnostics,
    occurrences: occurrences.map(row => mapped<SubscriptionOccurrence>(row)),
    reminders: reminders.map(row => mapped<SubscriptionReminder>(row)),
    projections: projections.map(row => mapped<SubscriptionProjection>(row)),
    alerts: alerts.map(row => mapped<SubscriptionAlert>(row)),
    accounts: accounts.map(row => ({
      id: readString(row, 'id'),
      type: readString(row, 'type'),
      status: readString(row, 'status'),
      currency: readString(row, 'currency'),
    })),
    categories: categories.map(row => ({
      id: readString(row, 'id'),
      type: readString(row, 'type'),
    })),
    subcategories: subcategories.map(row => ({
      id: readString(row, 'id'),
      categoryId: readString(row, 'category_id'),
      isActive: row.is_active === 1,
    })),
    transactions: transactions.map(rowToTransaction),
  };
}
export function* persistSubscriptionState(
  before: SubscriptionState,
  after: SubscriptionState,
): SQLiteProgram<void> {
  yield* saveChanges(
    'recurring_subscriptions',
    before.subscriptions,
    after.subscriptions,
    subscriptionRecord,
  );
  yield* saveChanges(
    'subscription_occurrences',
    before.occurrences,
    after.occurrences,
    record,
  );
  yield* saveChanges(
    'cash_flow_events',
    before.projections,
    after.projections,
    record,
  );
  yield* saveChanges('smart_alerts', before.alerts, after.alerts, record);
  yield* saveChanges(
    'subscription_reminders',
    before.reminders,
    after.reminders,
    record,
  );
  return undefined;
}
export function createSqliteSubscriptionRepository(
  database: SmartFinSQLiteDatabase,
): SubscriptionRepository {
  const read = async (sql: string, values: SQLitePrimitive[] = []) => {
    const [result] = await database.executeSql(sql, values);
    return resultSetToRows(result);
  };
  return {
    getFormOptions: () =>
      runSQLiteTransaction(database, function* () {
        const accounts = yield {
          sql: 'SELECT id,name,type,status,currency FROM accounts ORDER BY name,id;',
        };
        const categories = yield {
          sql: 'SELECT id,name,type FROM categories ORDER BY name,id;',
        };
        const subcategories = yield {
          sql: 'SELECT id,name,category_id,is_active FROM subcategories ORDER BY name,id;',
        };
        return {
          accounts: accounts.map(row => ({
            id: readString(row, 'id'),
            name: readString(row, 'name'),
            type: readString(row, 'type'),
            status: readString(row, 'status'),
            currency: readString(row, 'currency'),
          })),
          categories: categories.map(row => ({
            id: readString(row, 'id'),
            name: readString(row, 'name'),
            type: readString(row, 'type'),
          })),
          subcategories: subcategories.map(row => ({
            id: readString(row, 'id'),
            name: readString(row, 'name'),
            categoryId: readString(row, 'category_id'),
            isActive: row.is_active === 1,
          })),
        };
      }),
    getPaymentContext: (occurrenceId, query, suggestedOnly) =>
      runSQLiteTransaction(database, function* () {
        // Read eligibility and links in one snapshot; confirmation revalidates atomically.
        const state = yield* loadSubscriptionState({
          today: '9999-12-31',
          occurrenceId,
        });
        const occurrence = state.occurrences.find(
          value => value.id === occurrenceId,
        );
        if (!occurrence) throw new Error('Cobro inexistente.');
        const rows = yield {
          sql: `SELECT t.* FROM transactions t WHERE t.type='expense' AND t.status='posted' AND t.direction='outflow' AND t.currency='COP' AND t.amount>0
          AND (? IS NULL OR t.account_id=?)
          AND NOT EXISTS (SELECT 1 FROM subscription_occurrences o WHERE o.transaction_id=t.id)
          AND (? = 0 OR date(t.date) BETWEEN date(?,'-8 days') AND date(?,'+8 days'))
          AND (? = '' OR instr(lower(COALESCE(t.merchant_name,'') || ' ' || t.description || ' ' || t.id || ' ' || CAST(t.amount AS TEXT)),lower(?))>0)
          ORDER BY t.date DESC,t.id;`,
          values: [
            occurrence.accountId ?? null,
            occurrence.accountId ?? null,
            suggestedOnly ? 1 : 0,
            occurrence.expectedDate,
            occurrence.expectedDate,
            query,
            query,
          ],
        };
        state.transactions = rows.map(rowToTransaction);
        return state;
      }),

    mutate: async (scope, operation) =>
      runSQLiteTransaction(database, function* () {
        const state = yield* loadSubscriptionState(scope);
        const before: SubscriptionState = JSON.parse(JSON.stringify(state));
        const result = operation(state);
        yield* persistSubscriptionState(before, state);
        return result;
      }),
    getSubscriptions: async () =>
      subscriptions(
        await read('SELECT * FROM recurring_subscriptions ORDER BY name,id;'),
      ).values,
    getDiagnostics: async () =>
      subscriptions(await read('SELECT * FROM recurring_subscriptions;'))
        .diagnostics,
    getCharges: async (from, to, statuses, pagination) => {
      if (!statuses.length) return [];
      return (
        await read(
          `SELECT o.*, s.name AS subscription_name FROM subscription_occurrences o JOIN recurring_subscriptions s ON s.id=o.subscription_id
        WHERE o.expected_date BETWEEN ? AND ? AND o.status IN (${statuses
          .map(() => '?')
          .join(',')}) ORDER BY o.expected_date,o.id${
            pagination ? ' LIMIT ? OFFSET ?' : ''
          };`,
          [
            from,
            to,
            ...statuses,
            ...(pagination ? [pagination.limit, pagination.offset] : []),
          ],
        )
      ).map(row => mapped(row));
    },
    getHistory: async (subscriptionId, limit, offset) => {
      const rows = await read(
        'SELECT * FROM subscription_occurrences WHERE subscription_id = ? ORDER BY expected_date DESC,id LIMIT ? OFFSET ?;',
        [subscriptionId, limit, offset],
      );
      const transactionIds = rows
        .map(row => row.transaction_id)
        .filter((id): id is string => typeof id === 'string');
      const transactions = transactionIds.length
        ? (
            await read(
              `SELECT * FROM transactions WHERE id IN (${transactionIds
                .map(() => '?')
                .join(',')});`,
              transactionIds,
            )
          ).map(rowToTransaction)
        : [];
      return rows.map(row => ({
        ...mapped<SubscriptionOccurrence>(row),
        transaction: transactions.find(tx => tx.id === row.transaction_id),
      }));
    },
    getReminders: async () =>
      (
        await read(
          "SELECT * FROM subscription_reminders WHERE delivery_status != 'delivered';",
        )
      ).map(row => mapped(row)),
    acknowledgeReminder: async (id, revision, status, error) => {
      await database.executeSql(
        `UPDATE subscription_reminders SET applied_revision = ?, delivery_status = ?, error = ?
        WHERE id = ? AND revision = ? AND delivery_status != 'delivered' AND (delivery_status != ? OR COALESCE(error,'') != ? OR applied_revision IS NOT ?);`,
        [
          revision,
          status,
          error ?? null,
          id,
          revision,
          status,
          error ?? '',
          revision,
        ],
      );
    },
  };
}
