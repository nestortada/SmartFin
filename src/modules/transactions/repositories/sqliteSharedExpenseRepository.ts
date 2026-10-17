import {
  runSQLiteTransaction,
  runSharedSQLiteTransaction,
  SQLiteCommandFailure,
  type SQLiteProgram,
} from '../../../database/atomicSQLite';
import {
  borrowSQLiteDatabase,
  isSQLiteParticipant,
  manageSQLiteDatabase,
  sqliteBorrowedPermit,
} from '../../../database/managedSQLite';
import { withDatabaseMaintenance } from '../../../database/databaseCoordination';
import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import {
  readString,
  readNullableString,
  readNumber,
  resultSetToRows,
  type SQLiteRow,
} from '../../../database/sqliteRows';
import { upsertSQLiteRow } from '../../../database/upsertSQLiteRow';
import { createSqliteAccountRepository } from '../../accounts/repositories/sqliteAccountRepository';
import { createSqliteCreditCardRepository } from '../../creditCards/repositories/sqliteCreditCardRepository';
import { sqliteSharedCommandReads } from './sqliteSharedCommandReads';
import type { SharedExpenseRepository } from './SharedExpenseRepository';
import type { SharedExpense, SharedExpenseState } from '../types/SharedExpense';
import { readSharedCommandResult } from './sharedCommandResultValidation';
import { SHARED_FINANCIAL_TOTALS_SQL } from './sharedFinancialTotalsSql';
import { readSharedFinancialTotals } from '../useCases/readSharedFinancialTotals';
import { SHARED_LOSS_PERIOD_SQL } from './sharedLossPeriodSql';
import { validateCivilDate } from '../../../shared/utils/transactionDate';

function readDistributionSnapshot(
  json: string,
): SharedExpense['distributionSnapshot'] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('Historial de reparto inválido.');
  return parsed.map((part: unknown) => {
    if (
      !part ||
      typeof part !== 'object' ||
      !('id' in part) ||
      typeof part.id !== 'string' ||
      !('amountMinor' in part) ||
      typeof part.amountMinor !== 'number' ||
      !Number.isSafeInteger(part.amountMinor) ||
      part.amountMinor < 0 ||
      ('contactId' in part && typeof part.contactId !== 'string')
    )
      throw new Error('Historial de reparto inválido.');
    return {
      id: part.id,
      amountMinor: part.amountMinor,
      ...('contactId' in part ? { contactId: part.contactId as string } : {}),
    };
  });
}

export function* loadSharedExpenseState(): SQLiteProgram<SharedExpenseState> {
  const contacts = yield { sql: 'SELECT * FROM shared_contacts ORDER BY id;' };
  const expenses = yield { sql: 'SELECT * FROM shared_expenses ORDER BY id;' };
  const splits = yield {
    sql: 'SELECT * FROM transaction_splits WHERE shared_expense_id IS NOT NULL ORDER BY id;',
  };
  const receipts = yield { sql: 'SELECT * FROM shared_receipts ORDER BY id;' };
  const allocations = yield {
    sql: 'SELECT * FROM shared_allocations ORDER BY id;',
  };
  const returns = yield { sql: 'SELECT * FROM shared_returns ORDER BY id;' };
  const losses = yield {
    sql: 'SELECT * FROM shared_loss_events ORDER BY created_at, id;',
  };
  const audit = (row: (typeof contacts)[number]) => ({
    id: readString(row, 'id'),
    createdAt: readString(row, 'created_at'),
    updatedAt: readString(row, 'updated_at'),
  });
  return {
    lossEvents: losses.map(r => ({
      id: readString(r, 'id'),
      kind: readString(
        r,
        'kind',
      ) as SharedExpenseState['lossEvents'][number]['kind'],
      expenseId: readString(r, 'expense_id'),
      participationId: readString(r, 'participation_key'),
      contactId: readString(r, 'contact_id'),
      amountMinor: readNumber(r, 'amount_minor'),
      date: readString(r, 'date'),
      reason: readNullableString(r, 'reason'),
      relatedEventId: readNullableString(r, 'related_event_id'),
      receiptId: readNullableString(r, 'receipt_id'),
      createdAt: readString(r, 'created_at'),
    })),
    contacts: contacts.map(r => ({ ...audit(r), name: readString(r, 'name') })),
    expenses: expenses.map(r => ({
      ...audit(r),
      transactionId: readNullableString(r, 'transaction_id'),
      totalMinor: readNumber(r, 'total_minor'),
      date: readString(r, 'date'),
      description: readString(r, 'description'),
      distributionSnapshot: readDistributionSnapshot(
        readString(r, 'distribution_snapshot'),
      ),
      status: readString(
        r,
        'status',
      ) as SharedExpenseState['expenses'][number]['status'],
    })),
    participations: splits.map(r => ({
      ...audit(r),
      expenseId: readString(r, 'shared_expense_id'),
      transactionId: readString(r, 'transaction_id'),
      contactId: readNullableString(r, 'contact_id'),
      amountMinor: readNumber(r, 'amount_minor'),
      active: readNumber(r, 'shared_active') === 1,
    })),
    receipts: receipts.map(r => ({
      ...audit(r),
      transactionId: readNullableString(r, 'transaction_id'),
      contactId: readString(r, 'contact_id'),
      amountMinor: readNumber(r, 'amount_minor'),
      date: readString(r, 'date'),
      status: readString(
        r,
        'status',
      ) as SharedExpenseState['receipts'][number]['status'],
    })),
    allocations: allocations.map(r => ({
      ...audit(r),
      receiptId: readString(r, 'receipt_id'),
      participationId: readString(r, 'participation_key'),
      amountMinor: readNumber(r, 'amount_minor'),
      active: readNumber(r, 'active') === 1,
    })),
    returns: returns.map(r => ({
      ...audit(r),
      transactionId: readNullableString(r, 'transaction_id'),
      receiptId: readString(r, 'receipt_id'),
      amountMinor: readNumber(r, 'amount_minor'),
      date: readString(r, 'date'),
      status: readString(
        r,
        'status',
      ) as SharedExpenseState['returns'][number]['status'],
    })),
  };
}

export function* persistSharedExpenseState(
  before: SharedExpenseState,
  state: SharedExpenseState,
): SQLiteProgram<void> {
  const changed = <T extends { id: string }>(rows: T[], previous: T[]) => {
    const byId = new Map(previous.map(row => [row.id, row]));
    return rows.filter(
      row =>
        JSON.stringify(row) !==
        JSON.stringify(byId.get(row.id)),
    );
  };
  const audit = (r: { id: string; createdAt: string; updatedAt: string }) => ({
    id: r.id,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  });
  for (const r of changed(state.contacts, before.contacts))
    yield* upsertSQLiteRow('shared_contacts', { ...audit(r), name: r.name });
  for (const r of changed(state.expenses, before.expenses))
    yield* upsertSQLiteRow('shared_expenses', {
      ...audit(r),
      transaction_id: r.transactionId ?? null,
      total_minor: r.totalMinor,
      date: r.date,
      description: r.description,
      distribution_snapshot: JSON.stringify(r.distributionSnapshot),
      status: r.status,
    });
  // Deactivate removed people first so the unique active-person index is preserved.
  for (const r of changed(state.participations, before.participations).sort(
    (a, b) => Number(a.active) - Number(b.active),
  )) {
    yield* upsertSQLiteRow('transaction_splits', {
      ...audit(r),
      transaction_id: r.transactionId,
      split_type: r.contactId ? 'shared_third_party' : 'shared_personal',
      shared_expense_id: r.expenseId,
      contact_id: r.contactId ?? null,
      amount_minor: r.amountMinor,
      shared_active: Number(r.active),
      amount: r.amountMinor / 100,
      currency: 'COP',
    });
  }
  for (const r of changed(state.receipts, before.receipts))
    yield* upsertSQLiteRow('shared_receipts', {
      ...audit(r),
      transaction_id: r.transactionId ?? null,
      contact_id: r.contactId,
      amount_minor: r.amountMinor,
      date: r.date,
      status: r.status,
    });
  for (const r of changed(state.allocations, before.allocations))
    yield* upsertSQLiteRow('shared_allocations', {
      ...audit(r),
      receipt_id: r.receiptId,
      participation_id: state.participations.some(
        p => p.id === r.participationId,
      )
        ? r.participationId
        : null,
      participation_key: r.participationId,
      amount_minor: r.amountMinor,
      active: Number(r.active),
    });
  for (const r of changed(state.returns, before.returns))
    yield* upsertSQLiteRow('shared_returns', {
      ...audit(r),
      receipt_id: r.receiptId,
      transaction_id: r.transactionId ?? null,
      amount_minor: r.amountMinor,
      date: r.date,
      status: r.status,
    });
  const lossesById = new Map(state.lossEvents.map(e => [e.id, e]));
  const previousLosses = new Map(before.lossEvents.map(e => [e.id, e]));
  if (before.lossEvents.some(previous => !lossesById.has(previous.id)))
    throw new Error('No se puede eliminar el historial de pérdidas.');
  for (const r of state.lossEvents) {
    const previous = previousLosses.get(r.id);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(r))
        throw new Error('El historial de pérdidas es inmutable.');
      continue;
    }
    yield {
      sql: `INSERT INTO shared_loss_events(id,kind,expense_id,participation_key,contact_id,amount_minor,date,reason,related_event_id,receipt_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?);`,
      values: [
        r.id,
        r.kind,
        r.expenseId,
        r.participationId,
        r.contactId,
        r.amountMinor,
        r.date,
        r.reason ?? null,
        r.relatedEventId ?? null,
        r.receiptId ?? null,
        r.createdAt,
      ],
    };
  }
  return undefined;
}

function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

export function createSqliteSharedExpenseRepository(
  database: SmartFinSQLiteDatabase,
): SharedExpenseRepository {
  return {
    getLossPeriodTotals: async (startDate, endDateExclusive) => {
      validateCivilDate(startDate);
      validateCivilDate(endDateExclusive);
      if (endDateExclusive <= startDate) throw new Error('Periodo inválido.');
      const [result] = await manageSQLiteDatabase(database).executeSql(
        SHARED_LOSS_PERIOD_SQL,
        [startDate, endDateExclusive],
      );
      const rows = resultSetToRows(result);
      if (rows.length !== 1 || !rows[0])
        throw new Error('Periodo de pérdidas inválido.');
      const minor = (key: string) => {
        const raw = readString(rows[0]!, key);
        if (!/^\d+$/.test(raw) || BigInt(raw) > BigInt(Number.MAX_SAFE_INTEGER))
          throw new Error('Pérdida fuera del rango seguro.');
        return BigInt(raw);
      };
      const losses = minor('losses'),
        reversals = minor('reversals'),
        recoveries = minor('recoveries'),
        recoveryReversals = minor('recovery_reversals');
      const net = losses - reversals - recoveries + recoveryReversals;
      if (
        net > BigInt(Number.MAX_SAFE_INTEGER) ||
        net < -BigInt(Number.MAX_SAFE_INTEGER)
      )
        throw new Error('Pérdida fuera del rango seguro.');
      return {
        losses: Number(losses) / 100,
        reversals: Number(reversals) / 100,
        recoveries: Number(recoveries) / 100,
        recoveryReversals: Number(recoveryReversals) / 100,
        netLoss: Number(net) / 100,
      };
    },
    getFinancialTotals: async () => {
      const [result] = await manageSQLiteDatabase(database).executeSql(
        SHARED_FINANCIAL_TOTALS_SQL,
      );
      const rows = resultSetToRows(result);
      if (rows.length !== 1 || !rows[0])
        throw new Error('SQLite devolvió una posición financiera inválida.');
      return readSharedFinancialTotals({
        receivableMinor: readString(rows[0], 'receivable_minor'),
        advanceMinor: readString(rows[0], 'advance_minor'),
        invalid: readNumber(rows[0], 'invalid'),
      });
    },
    getState: async () => {
      const read = async (owned: SmartFinSQLiteDatabase) => {
        const iterator = loadSharedExpenseState();
        let rows: SQLiteRow[] = [];
        for (;;) {
          const step = iterator.next(rows);
          if (step.done) return step.value;
          const [result] = await owned.executeSql(
            step.value.sql,
            step.value.values ?? [],
          );
          rows = resultSetToRows(result);
        }
      };
      if (isSQLiteParticipant(database)) return read(database);
      // Hold the existing maintenance lease for the entire read, without a new BEGIN.
      return withDatabaseMaintenance(
        owner =>
          read(borrowSQLiteDatabase(manageSQLiteDatabase(database), owner)),
        sqliteBorrowedPermit(database),
      );
    },
    execute: async (commandId, payload, operation) => {
      if (!commandId.trim())
        throw new Error(
          'Indica una identidad de comando estable para evitar duplicados.',
        );
      const request = canonical(payload);
      const execute = async (participant: SmartFinSQLiteDatabase) => {
        const existing = await runSQLiteTransaction(
          participant,
          function* (): SQLiteProgram<SQLiteRow[]> {
            const rows = yield {
              sql: 'SELECT * FROM shared_commands WHERE id = ?;',
              values: [commandId],
            };
            return rows;
          },
        );
        if (existing[0]) {
          if (readString(existing[0], 'request_json') !== request)
            throw new Error('El comando ya se utilizó con otros datos.');
          return readSharedCommandResult(
            readString(existing[0], 'result_json'),
          );
        }
        const state = await runSQLiteTransaction(
          participant,
          loadSharedExpenseState,
        );
        const before = structuredCloneState(state);
        const now = new Date().toISOString();
        const result = await operation({
          state,
          now,
          id: suffix => `shared:${commandId}:${suffix}`,
          ...sqliteSharedCommandReads(participant),
          accountRepository: createSqliteAccountRepository(participant),
          creditCardRepository: createSqliteCreditCardRepository(participant),
          reloadState: () =>
            runSQLiteTransaction(participant, loadSharedExpenseState),
          flushState: () =>
            runSQLiteTransaction(participant, function* () {
              yield* persistSharedExpenseState(before, state);
              return undefined;
            }),
        });
        await runSQLiteTransaction(participant, function* () {
          yield* persistSharedExpenseState(before, state);
          yield {
            sql: 'INSERT INTO shared_commands(id,request_json,result_json,created_at) VALUES(?,?,?,?);',
            values: [commandId, request, JSON.stringify(result), now],
          };
          return undefined;
        });
        return result;
      };
      if (isSQLiteParticipant(database)) return execute(database);
      const result = await runSharedSQLiteTransaction(database, execute);
      if (result.status === 'confirmed') return result.value;
      if (result.status === 'rolledBack') throw result.error;
      throw new SQLiteCommandFailure(result);
    },
  };
}

function structuredCloneState(state: SharedExpenseState): SharedExpenseState {
  return {
    contacts: state.contacts.map(r => ({ ...r })),
    expenses: state.expenses.map(r => ({ ...r })),
    participations: state.participations.map(r => ({ ...r })),
    receipts: state.receipts.map(r => ({ ...r })),
    allocations: state.allocations.map(r => ({ ...r })),
    returns: state.returns.map(r => ({ ...r })),
    lossEvents: state.lossEvents.map(r => ({ ...r })),
  };
}
