import { registerSQLiteRepository } from '../../../database/sqliteRepositoryScope';
import { runSQLiteTransaction } from '../../../database/atomicSQLite';
import { saveSQLiteRowPreservingIdentity } from '../../../database/saveSQLiteRowPreservingIdentity';
import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import {
  readNullableNumber,
  readNullableString,
  readNumber,
  readString,
  resultSetToRows,
  type SQLitePrimitive,
  type SQLiteRow,
} from '../../../database/sqliteRows';
import { parseCivilDate, type ClosingDayPurchasePolicy } from '../useCases/installmentPlan';
import {
  INSTALLMENT_PLAN_PENDING_REASONS,
  type CreditCardBillingRules,
  type InstallmentAllocation,
  type InstallmentAllocationMode,
  type InstallmentAllocationStatus,
  type InstallmentFirstCycle,
  type InstallmentPlanPendingReason,
  type InstallmentPlanRevision,
  type InstallmentPlanRevisionSource,
  type InstallmentPlanVerification,
  type NewInstallmentAllocation,
  type NewInstallmentPlanRevision,
} from '../types/InstallmentHistory';

/**
 * Phase 1a.3B persistence only: no screen, hook or payment flow uses it yet, and it has no reversal or
 * amortization logic. Every call runs on the `database` it receives, so inside a shared scope it joins the
 * owner's transaction (never a nested BEGIN); multi-statement writes outside a scope get one local
 * transaction. History is append-only: there is no update or delete of revisions here.
 */
export type SaveInstallmentAllocationsResult = {
  /** `replayed`: the same command was already stored with identical allocations; nothing was written. */
  status: 'inserted' | 'replayed';
  allocations: InstallmentAllocation[];
};

export type InstallmentHistoryRepository = {
  getAllocationsByPurchase: (installmentPurchaseId: string) => Promise<InstallmentAllocation[]>;
  getAllocationsByPayment: (paymentTransactionId: string) => Promise<InstallmentAllocation[]>;
  getAllocationsByCommand: (commandId: string) => Promise<InstallmentAllocation[]>;
  saveAllocations: (commandId: string, allocations: NewInstallmentAllocation[]) => Promise<SaveInstallmentAllocationsResult>;
  getPlanRevisions: (installmentPurchaseId: string) => Promise<InstallmentPlanRevision[]>;
  getLatestPlanRevision: (installmentPurchaseId: string) => Promise<InstallmentPlanRevision | undefined>;
  appendPlanRevision: (revision: NewInstallmentPlanRevision) => Promise<InstallmentPlanRevision>;
  getBillingRules: (accountIds: string[]) => Promise<CreditCardBillingRules[]>;
  saveBillingRules: (rules: CreditCardBillingRules) => Promise<void>;
  getFirstCycles: (installmentPurchaseIds: string[]) => Promise<InstallmentFirstCycle[]>;
  saveFirstCycle: (firstCycle: InstallmentFirstCycle) => Promise<void>;
};

const MODES: readonly InstallmentAllocationMode[] = ['unspecified', 'reduceTerm', 'reduceInstallment'];
const STATUSES: readonly InstallmentAllocationStatus[] = ['active', 'reversed'];
const SOURCES: readonly InstallmentPlanRevisionSource[] = [
  'original', 'allocation', 'allocationReversal', 'statement', 'purchaseEdit', 'purchaseRemoval',
];
const VERIFICATIONS: readonly InstallmentPlanVerification[] = ['confirmed', 'projected', 'pendingVerification', 'estimated'];
const POLICIES: readonly ClosingDayPurchasePolicy[] = ['closingCycle', 'nextCycle'];
// API 24 permits 999 bound parameters per statement.
const MAX_IDS_PER_QUERY = 900;

const ALLOCATION_COLUMNS = `id, payment_transaction_id, installment_purchase_id, amount_cents, mode, status, command_id,
  created_at, reversed_at`;
const REVISION_COLUMNS = `id, installment_purchase_id, revision_number, source, allocation_id, remaining_principal_cents,
  remaining_installments, installment_amount_cents, effective_cycle_end, verification, pending_reasons,
  basis_total_amount, basis_monthly_amount, basis_installment_count, created_at`;

function oneOf<T extends string>(values: readonly T[], value: string, label: string): T {
  if (!(values as readonly string[]).includes(value)) throw new Error(`SQLite devolvió un valor inválido para ${label}.`);
  return value as T;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} inválido.`);
  return value;
}

function isCents(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function requireCivilDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !parseCivilDate(value)) throw new Error(`${label} no es una fecha civil válida.`);
  return value;
}

function nullableInteger(row: SQLiteRow, key: string): number | null {
  return readNullableNumber(row, key) ?? null;
}

function rawBasis(row: SQLiteRow, key: string): number | string {
  const value = row[key];
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`SQLite devolvió una base inválida para ${key}.`);
  return value;
}

function parseReasons(value: string | undefined): InstallmentPlanPendingReason[] {
  if (value === undefined) return [];
  return value.split(',').map(reason => oneOf(INSTALLMENT_PLAN_PENDING_REASONS, reason, 'pending_reasons'));
}

function allocationFromRow(row: SQLiteRow): InstallmentAllocation {
  const reversedAt = readNullableString(row, 'reversed_at');
  return {
    id: readString(row, 'id'),
    paymentTransactionId: readString(row, 'payment_transaction_id'),
    installmentPurchaseId: readString(row, 'installment_purchase_id'),
    amountCents: readNumber(row, 'amount_cents'),
    mode: oneOf(MODES, readString(row, 'mode'), 'mode'),
    status: oneOf(STATUSES, readString(row, 'status'), 'status'),
    commandId: readString(row, 'command_id'),
    createdAt: readString(row, 'created_at'),
    ...(reversedAt !== undefined ? { reversedAt } : {}),
  };
}

function revisionFromRow(row: SQLiteRow): InstallmentPlanRevision {
  const source = oneOf(SOURCES, readString(row, 'source'), 'source');
  const allocationId = readNullableString(row, 'allocation_id');
  const hasBasis = source === 'original' || source === 'purchaseEdit';
  return {
    id: readString(row, 'id'),
    installmentPurchaseId: readString(row, 'installment_purchase_id'),
    revisionNumber: readNumber(row, 'revision_number'),
    source,
    ...(allocationId !== undefined ? { allocationId } : {}),
    remainingPrincipalCents: nullableInteger(row, 'remaining_principal_cents'),
    remainingInstallments: nullableInteger(row, 'remaining_installments'),
    installmentAmountCents: nullableInteger(row, 'installment_amount_cents'),
    effectiveCycleEnd: readNullableString(row, 'effective_cycle_end') ?? null,
    verification: oneOf(VERIFICATIONS, readString(row, 'verification'), 'verification'),
    pendingReasons: parseReasons(readNullableString(row, 'pending_reasons')),
    ...(hasBasis
      ? {
          basis: {
            totalAmount: rawBasis(row, 'basis_total_amount'),
            monthlyAmount: rawBasis(row, 'basis_monthly_amount'),
            installmentCount: rawBasis(row, 'basis_installment_count'),
          },
        }
      : {}),
    createdAt: readString(row, 'created_at'),
  };
}

function billingRulesFromRow(row: SQLiteRow): CreditCardBillingRules {
  const policy = readNullableString(row, 'closing_day_purchase_policy');
  return {
    accountId: readString(row, 'account_id'),
    ...(policy !== undefined ? { closingDayPurchasePolicy: oneOf(POLICIES, policy, 'closing_day_purchase_policy') } : {}),
    createdAt: readString(row, 'created_at'),
    updatedAt: readString(row, 'updated_at'),
  };
}

function firstCycleFromRow(row: SQLiteRow): InstallmentFirstCycle {
  return {
    installmentPurchaseId: readString(row, 'installment_purchase_id'),
    cycleEnd: readString(row, 'cycle_end'),
    source: oneOf(['user', 'statement'] as const, readString(row, 'source'), 'source'),
    createdAt: readString(row, 'created_at'),
    updatedAt: readString(row, 'updated_at'),
  };
}

function validateAllocation(allocation: NewInstallmentAllocation): void {
  requireText(allocation.id, 'Identificador de imputación');
  requireText(allocation.paymentTransactionId, 'Pago de la imputación');
  requireText(allocation.installmentPurchaseId, 'Compra de la imputación');
  requireText(allocation.createdAt, 'Fecha de la imputación');
  if (!isCents(allocation.amountCents, 1)) throw new Error('El importe imputado debe ser un entero positivo de centavos.');
  if (!MODES.includes(allocation.mode)) throw new Error('Modalidad de imputación inválida.');
}

function sameAllocation(stored: InstallmentAllocation, requested: NewInstallmentAllocation): boolean {
  return stored.id === requested.id && stored.paymentTransactionId === requested.paymentTransactionId &&
    stored.installmentPurchaseId === requested.installmentPurchaseId && stored.amountCents === requested.amountCents &&
    stored.mode === requested.mode;
}

function validateRevision(revision: NewInstallmentPlanRevision): void {
  requireText(revision.installmentPurchaseId, 'Compra de la revisión');
  requireText(revision.createdAt, 'Fecha de la revisión');
  // purchaseEdit and purchaseRemoval are appended only by SQLite triggers.
  if (!(['original', 'allocation', 'allocationReversal', 'statement'] as readonly string[]).includes(revision.source))
    throw new Error('Origen de revisión no admitido.');
  if (!VERIFICATIONS.includes(revision.verification)) throw new Error('Verificación de revisión inválida.');
  for (const [value, minimum] of [[revision.remainingPrincipalCents, 0], [revision.installmentAmountCents, 0]] as const)
    if (value !== null && !isCents(value, minimum)) throw new Error('Los importes de la revisión deben ser centavos enteros.');
  if (revision.remainingInstallments !== null &&
      !(Number.isInteger(revision.remainingInstallments) && revision.remainingInstallments >= 0 && revision.remainingInstallments <= 360))
    throw new Error('Número de cuotas restantes inválido.');
  if (revision.effectiveCycleEnd !== null) requireCivilDate(revision.effectiveCycleEnd, 'Ciclo de entrada en vigor');
  for (const reason of revision.pendingReasons)
    if (!INSTALLMENT_PLAN_PENDING_REASONS.includes(reason)) throw new Error('Motivo de verificación inválido.');
  if ((revision.verification === 'pendingVerification') !== (revision.pendingReasons.length > 0))
    throw new Error('Solo una revisión pendiente de verificar lleva motivos, y siempre al menos uno.');
}

function chunks(ids: string[]): string[][] {
  const unique = [...new Set(ids)];
  const result: string[][] = [];
  for (let offset = 0; offset < unique.length; offset += MAX_IDS_PER_QUERY) result.push(unique.slice(offset, offset + MAX_IDS_PER_QUERY));
  return result;
}

export function createSqliteInstallmentHistoryRepository(
  database: SmartFinSQLiteDatabase,
): InstallmentHistoryRepository {
  const select = async (sql: string, values: SQLitePrimitive[]) => {
    const [resultSet] = await database.executeSql(sql, values);
    return resultSetToRows(resultSet);
  };
  const selectByIds = async (sql: (placeholders: string) => string, ids: string[]) => {
    const rows: SQLiteRow[] = [];
    for (const group of chunks(ids)) rows.push(...await select(sql(group.map(() => '?').join(', ')), group));
    return rows;
  };
  const allocationsWhere = (column: string) => async (value: string) =>
    (await select(`SELECT ${ALLOCATION_COLUMNS} FROM installment_allocations WHERE ${column} = ?
      ORDER BY created_at, id;`, [requireText(value, 'Identificador')])).map(allocationFromRow);

  return registerSQLiteRepository<InstallmentHistoryRepository>(database, {
    getAllocationsByPurchase: allocationsWhere('installment_purchase_id'),
    getAllocationsByPayment: allocationsWhere('payment_transaction_id'),
    getAllocationsByCommand: allocationsWhere('command_id'),
    saveAllocations: async (commandId, allocations) => {
      requireText(commandId, 'Comando de imputación');
      if (allocations.length === 0) throw new Error('El comando no contiene imputaciones.');
      allocations.forEach(validateAllocation);
      if (new Set(allocations.map(allocation => allocation.installmentPurchaseId)).size !== allocations.length)
        throw new Error('Un comando imputa cada compra una sola vez.');
      // Read and write in one program: on the caller's participant when inside a scope.
      return runSQLiteTransaction(database, function* () {
        const stored = (yield {
          sql: `SELECT ${ALLOCATION_COLUMNS} FROM installment_allocations WHERE command_id = ? ORDER BY created_at, id;`,
          values: [commandId],
        }).map(allocationFromRow);
        if (stored.length > 0) {
          const identical = stored.length === allocations.length &&
            allocations.every(requested => stored.some(row => sameAllocation(row, requested)));
          if (!identical) throw new Error('El comando ya se registró con imputaciones distintas.');
          return { status: 'replayed' as const, allocations: stored };
        }
        for (const allocation of allocations) {
          yield {
            sql: `INSERT INTO installment_allocations (${ALLOCATION_COLUMNS}) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL);`,
            values: [allocation.id, allocation.paymentTransactionId, allocation.installmentPurchaseId,
              allocation.amountCents, allocation.mode, commandId, allocation.createdAt],
          };
        }
        const inserted = (yield {
          sql: `SELECT ${ALLOCATION_COLUMNS} FROM installment_allocations WHERE command_id = ? ORDER BY created_at, id;`,
          values: [commandId],
        }).map(allocationFromRow);
        return { status: 'inserted' as const, allocations: inserted };
      });
    },
    getPlanRevisions: async installmentPurchaseId =>
      (await select(`SELECT ${REVISION_COLUMNS} FROM installment_plan_revisions WHERE installment_purchase_id = ?
        ORDER BY revision_number;`, [requireText(installmentPurchaseId, 'Compra')])).map(revisionFromRow),
    getLatestPlanRevision: async installmentPurchaseId => {
      const rows = await select(`SELECT ${REVISION_COLUMNS} FROM installment_plan_revisions WHERE installment_purchase_id = ?
        ORDER BY revision_number DESC LIMIT 1;`, [requireText(installmentPurchaseId, 'Compra')]);
      return rows[0] ? revisionFromRow(rows[0]) : undefined;
    },
    appendPlanRevision: async revision => {
      validateRevision(revision);
      return runSQLiteTransaction(database, function* () {
        const [latest] = yield {
          sql: 'SELECT MAX(revision_number) AS latest FROM installment_plan_revisions WHERE installment_purchase_id = ?;',
          values: [revision.installmentPurchaseId],
        };
        const previous = latest?.latest;
        const revisionNumber = typeof previous === 'number' ? previous + 1 : 0;
        const id = `${revision.installmentPurchaseId}:revision:${revisionNumber}`;
        // Plain INSERT: never REPLACE. Sequence, purchase existence and incarnation are enforced by SQLite.
        yield {
          sql: `INSERT INTO installment_plan_revisions (${REVISION_COLUMNS})
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          values: [id, revision.installmentPurchaseId, revisionNumber, revision.source, revision.allocationId ?? null,
            revision.remainingPrincipalCents, revision.remainingInstallments, revision.installmentAmountCents,
            revision.effectiveCycleEnd, revision.verification,
            revision.pendingReasons.length > 0 ? [...new Set(revision.pendingReasons)].sort().join(',') : null,
            revision.basis?.totalAmount ?? null, revision.basis?.monthlyAmount ?? null,
            revision.basis?.installmentCount ?? null, revision.createdAt],
        };
        const [row] = yield {
          sql: `SELECT ${REVISION_COLUMNS} FROM installment_plan_revisions WHERE id = ?;`,
          values: [id],
        };
        if (!row) throw new Error('No se pudo leer la revisión guardada.');
        return revisionFromRow(row);
      });
    },
    getBillingRules: async accountIds =>
      (await selectByIds(placeholders => `SELECT account_id, closing_day_purchase_policy, created_at, updated_at
        FROM credit_card_billing_rules WHERE account_id IN (${placeholders}) ORDER BY account_id;`, accountIds))
        .map(billingRulesFromRow),
    saveBillingRules: async rules => {
      requireText(rules.accountId, 'Tarjeta');
      if (rules.closingDayPurchasePolicy !== undefined && !POLICIES.includes(rules.closingDayPurchasePolicy))
        throw new Error('Política de compras en el día de corte inválida.');
      await saveSQLiteRowPreservingIdentity(database, 'credit_card_billing_rules', 'account_id', {
        account_id: rules.accountId,
        closing_day_purchase_policy: rules.closingDayPurchasePolicy ?? null,
        created_at: rules.createdAt,
        updated_at: rules.updatedAt,
      });
    },
    getFirstCycles: async installmentPurchaseIds =>
      (await selectByIds(placeholders => `SELECT installment_purchase_id, cycle_end, source, created_at, updated_at
        FROM installment_first_cycles WHERE installment_purchase_id IN (${placeholders}) ORDER BY installment_purchase_id;`,
      installmentPurchaseIds)).map(firstCycleFromRow),
    saveFirstCycle: async firstCycle => {
      requireText(firstCycle.installmentPurchaseId, 'Compra');
      requireCivilDate(firstCycle.cycleEnd, 'Ciclo de la primera cuota');
      if (firstCycle.source !== 'user' && firstCycle.source !== 'statement') throw new Error('Origen de confirmación inválido.');
      await saveSQLiteRowPreservingIdentity(database, 'installment_first_cycles', 'installment_purchase_id', {
        installment_purchase_id: firstCycle.installmentPurchaseId,
        cycle_end: firstCycle.cycleEnd,
        source: firstCycle.source,
        created_at: firstCycle.createdAt,
        updated_at: firstCycle.updatedAt,
      });
    },
  });
}
