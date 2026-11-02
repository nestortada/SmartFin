// Phase 1a.2 probes: multi-cycle statements from the installment engine. The same synthetic scenarios run in
// Node (node:sqlite) and in the isolated Android APK (real driver), through the unchanged production use cases.
// Each step pins the JS clock to noon in Bogotá of its civil date. Every statement, debt, balance and wealth
// figure is checked against an independent BigInt oracle over decimal texts (no engine code, no tolerance), and
// Android compares the complete observation with the Node reference field by field.
import type { SmartFinSQLiteDatabase } from '../../src/database/sqliteDatabase';
import { createSqliteAccountRepository } from '../../src/modules/accounts/repositories/sqliteAccountRepository';
import { createSqliteTransactionRepository } from '../../src/modules/transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../../src/modules/creditCards/repositories/sqliteCreditCardRepository';
import { getDashboardSummaryFromDb } from '../../src/modules/dashboard/useCases/getDashboardSummary';
import { saveManualTransaction } from '../../src/modules/transactions/useCases/saveManualTransaction';
import {
  reconcileCreditCardTransactions,
  registerCreditCardPayment,
  type CreditCardReconciliationReport,
} from '../../src/modules/creditCards/useCases/creditCardTransactionRelations';
import { serializeCreditCardVisualMetadata } from '../../src/modules/creditCards/useCases/manageCreditCards';
import { centsText, resetSyntheticData, textCents } from '../phase6b/probes';

export const PHASE1A2_PROBES = [
  'sixInstallments', 'overlappingPlans', 'paymentInLaterCycle', 'centsAndResidue', 'closingDays293031',
  'closingDayPurchase', 'withoutClosingDay', 'yearChange', 'calendarStates', 'historicalProtection',
] as const;
export type Phase1A2Probe = (typeof PHASE1A2_PROBES)[number];

const check = (condition: unknown, message: string) => { if (!condition) throw Error(message); };
const BANK = '1000000';
/** Tables owned by the platform (seeded categories, settings, migrations) or by SQL time: not compared. */
const EXCLUDED_TABLES = new Set(['schema_migrations', 'categories', 'subcategories', 'app_settings', 'financial_data_revision']);

export const bogotaNoon = (date: string) => new Date(`${date}T17:00:00.000Z`);

/** Pins Date() and Date.now() to an instant; the probes never rely on the device clock. */
export async function withPhase1A2Clock<T>(instant: Date, run: () => Promise<T>): Promise<T> {
  const RealDate = globalThis.Date;
  const fixed = instant.getTime();
  const ProbeDate = Object.assign(
    function ProbeDate(...args: unknown[]) { return Reflect.construct(RealDate, args.length ? args : [fixed]) as Date; },
    { now: () => fixed, parse: RealDate.parse, UTC: RealDate.UTC, prototype: RealDate.prototype },
  ) as unknown as DateConstructor;
  globalThis.Date = ProbeDate;
  try { return await run(); } finally { globalThis.Date = RealDate; }
}

type Rows = Record<string, unknown>[];
const rowsOf = (result: { rows: { length: number; item: (index: number) => unknown } }) =>
  Array.from({ length: result.rows.length }, (_, index) => result.rows.item(index) as Record<string, unknown>);

function dependencies(database: SmartFinSQLiteDatabase) {
  return {
    accountRepository: createSqliteAccountRepository(database),
    transactionRepository: createSqliteTransactionRepository(database),
    creditCardRepository: createSqliteCreditCardRepository(database),
  };
}

async function seed(database: SmartFinSQLiteDatabase, closingDay: number | undefined) {
  await resetSyntheticData(database);
  const description = serializeCreditCardVisualMetadata(closingDay === undefined ? { paymentDay: 5 } : { closingDay, paymentDay: 5 });
  await database.executeSql(`INSERT INTO accounts (id,name,type,status,currency,balance_amount,debt_balance_amount,description,created_at,updated_at) VALUES
    ('bank','Banco','bankAccount','active','COP',?,NULL,NULL,'2026-01-01','2026-01-01'),
    ('card','Visa','creditCard','active','COP',0,0,?,'2026-01-01','2026-01-01')`, [Number(BANK), description]);
}

/**
 * Canonical ids: movement ids embed the clock and a per-process sequence, which depends on what ran before in the
 * same runtime. They are renamed T1..Tn in creation order, consistently everywhere (references included).
 */
function canonical<T>(value: T, ids: Map<string, string>): T {
  const rename = (text: string) => {
    let result = text;
    // Longest first, so that an id is never replaced inside a longer one (`…_1` within `…_10`).
    for (const [id, label] of [...ids].sort((a, b) => b[0].length - a[0].length)) result = result.split(id).join(label);
    return result;
  };
  const walk = (input: unknown): unknown => {
    if (typeof input === 'string') return rename(input);
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, walk(item)]));
    return input;
  };
  return walk(value) as T;
}

class Session {
  readonly ids = new Map<string, string>();
  readonly steps: unknown[] = [];
  constructor(readonly database: SmartFinSQLiteDatabase) {}

  private async remember() {
    const [result] = await this.database.executeSql('SELECT id FROM transactions ORDER BY created_at, rowid');
    for (const row of rowsOf(result)) {
      const id = String(row.id);
      if (!this.ids.has(id)) this.ids.set(id, `T${this.ids.size + 1}`);
    }
  }

  purchase(date: string, amount: string, installments: number) {
    return withPhase1A2Clock(bogotaNoon(date), async () => {
      const deps = dependencies(this.database);
      await saveManualTransaction({
        ...deps, accounts: await deps.accountRepository.getAccounts(), accountId: 'card', amount: Number(amount),
        merchantName: 'Sintetico 1a.2', operationType: 'Crédito', transactionType: 'expense', hasInterestFreeInstallments: false,
        installmentCountInput: String(installments), interestFreeInstallmentCountInput: '', occurrence: { kind: 'date', date },
        currentDate: bogotaNoon(date), now: bogotaNoon(date),
      });
      await this.remember();
    });
  }

  pay(date: string, amount: string, settlement: 'partial' | 'fullDebt' = 'partial') {
    return withPhase1A2Clock(bogotaNoon(date), async () => {
      const result = await registerCreditCardPayment({
        ...dependencies(this.database), accountId: 'card', sourceAccountId: 'bank', amount: Number(amount),
        currentDate: bogotaNoon(date), settlement,
      });
      await this.remember();
      return { paidAmount: result.paidAmount, remainingDebt: result.remainingDebt };
    });
  }

  /** Reconciles the cycle that contains `date` and records the complete observable state. */
  reconcile(date: string, label = date) {
    return withPhase1A2Clock(bogotaNoon(date), async () => {
      const report = await reconcileCreditCardTransactions({ ...dependencies(this.database), currentDate: bogotaNoon(date) });
      const observation = await observe(this.database, date, report);
      this.steps.push(canonical({ label, ...observation }, this.ids));
      return observation;
    });
  }

  result(extra: Record<string, unknown> = {}) {
    return canonical({ steps: this.steps, ...extra }, this.ids);
  }
}

async function observe(database: SmartFinSQLiteDatabase, date: string, report?: CreditCardReconciliationReport) {
  const [names] = await database.executeSql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const tables: Record<string, Rows> = {};
  for (const { name } of rowsOf(names) as { name: string }[]) {
    check(/^[a-z0-9_]+$/.test(name), 'Unexpected table name');
    if (EXCLUDED_TABLES.has(name)) continue;
    const [result] = await database.executeSql(`SELECT * FROM "${name}" ORDER BY rowid`);
    const rows = rowsOf(result);
    if (rows.length) tables[name] = rows;
  }
  const [integrity] = await database.executeSql('PRAGMA integrity_check');
  const [foreignKeys] = await database.executeSql('PRAGMA foreign_key_check');
  const summary = await getDashboardSummaryFromDb(database, bogotaNoon(date));
  return {
    tables,
    metrics: { available: summary.availableBalance, debt: summary.totalDebt, wealth: summary.netWorth,
      income: summary.monthlyIncome, expense: summary.monthlyExpenses, savings: summary.monthlySavings },
    report: report?.statements.map(s => ({ write: s.write, charges: s.charges, notices: s.notices })),
    sqlite: { integrity: rowsOf(integrity).map(row => row.integrity_check), foreignKeyViolations: rowsOf(foreignKeys).length },
  };
}

type Observation = Awaited<ReturnType<typeof observe>>;
const statements = (o: Observation) => [...(o.tables.credit_card_statements ?? [])]
  .sort((a, b) => String(a.statement_end_date).localeCompare(String(b.statement_end_date)));
const statementOf = (o: Observation, end: string) => statements(o).find(s => s.statement_end_date === end);
const amountText = (value: unknown) => {
  check(typeof value === 'number' && Number.isFinite(value), `Not a finite amount: ${String(value)}`);
  return String(value);
};

/**
 * Independent oracle for one step: the statement of `end` must total `total` (decimal text), the minimum must be
 * round(10 %) in whole pesos, debt = Σ purchases − Σ payments and bank = 1.000.000 − Σ payments, in BigInt cents.
 */
function expectStep(o: Observation, end: string, total: string, status: string, purchases: string[], payments: string[] = []) {
  const statement = statementOf(o, end);
  check(statement, `Missing statement ${end}`);
  check(textCents(amountText(statement!.total_amount)) === textCents(total), `Statement ${end}: ${String(statement!.total_amount)} != ${total}`);
  // Production: Math.round(total × 0.1) in whole pesos. For c cents that is floor((c + 500) / 1000) pesos.
  const minimumCents = ((textCents(total) + 500n) / 1000n) * 100n;
  check(textCents(amountText(statement!.minimum_payment_amount)) === minimumCents,
    `Minimum ${end}: ${String(statement!.minimum_payment_amount)} != ${centsText(minimumCents)}`);
  check(statement!.status === status, `Status ${end}: ${String(statement!.status)} != ${status}`);
  const purchased = purchases.reduce((sum, value) => sum + textCents(value), 0n);
  const paid = payments.reduce((sum, value) => sum + textCents(value), 0n);
  const debt = purchased - paid > 0n ? purchased - paid : 0n;
  const accounts = o.tables.accounts ?? [];
  const card = accounts.find(a => a.id === 'card');
  const bank = accounts.find(a => a.id === 'bank');
  check(textCents(amountText(card?.debt_balance_amount)) === debt, `Debt ${String(card?.debt_balance_amount)} != ${centsText(debt)}`);
  check(textCents(amountText(bank?.balance_amount)) === textCents(BANK) - paid, `Bank ${String(bank?.balance_amount)}`);
  check(textCents(amountText(o.metrics.wealth)) === textCents(BANK) - paid - debt, `Wealth ${String(o.metrics.wealth)}`);
  check(o.sqlite.integrity.join() === 'ok' && o.sqlite.foreignKeyViolations === 0, 'SQLite integrity / foreign keys');
}

function sumStatements(o: Observation): bigint {
  return statements(o).reduce((sum, s) => sum + textCents(amountText(s.total_amount)), 0n);
}

export function runPhase1A2Probe(database: SmartFinSQLiteDatabase, probe: Phase1A2Probe) {
  return runProbe(database, probe);
}

async function runProbe(database: SmartFinSQLiteDatabase, probe: Phase1A2Probe): Promise<unknown> {
  const cycles20 = ['2026-10-11', '2026-11-11', '2026-12-11', '2027-01-11', '2027-02-11', '2027-03-11', '2027-04-11'];
  const ends20 = ['2026-10-20', '2026-11-20', '2026-12-20', '2027-01-20', '2027-02-20', '2027-03-20', '2027-04-20'];
  switch (probe) {
    // 600.000 in 6 installments on 11 Oct 2026, closing day 20: one installment of 100.000 per cycle.
    case 'sixInstallments': {
      await seed(database, 20);
      const s = new Session(database);
      await s.purchase('2026-10-11', '600000', 6);
      for (const [index, date] of cycles20.entries()) {
        const o = await s.reconcile(date);
        expectStep(o, ends20[index]!, index < 6 ? '100000' : '0', index < 6 ? 'pending' : 'open', ['600000']);
        check(o.metrics.expense === (index === 0 ? 600000 : 0), 'Expense counted once, in October');
      }
      return s.result();
    }
    // 600.000 × 6 in October plus 300.000 × 3 on 11 Nov: both calendars in the overlapping cycles; 900.000 in total.
    case 'overlappingPlans': {
      await seed(database, 20);
      const s = new Session(database);
      await s.purchase('2026-10-11', '600000', 6);
      const totals = ['100000', '200000', '200000', '200000', '100000', '100000', '0'];
      let last: Observation | undefined;
      for (const [index, date] of cycles20.entries()) {
        if (index === 1) await s.purchase('2026-11-11', '300000', 3);
        last = await s.reconcile(date);
        expectStep(last, ends20[index]!, totals[index]!, index < 6 ? 'pending' : 'open', index === 0 ? ['600000'] : ['600000', '300000']);
      }
      check(sumStatements(last!) === textCents('900000'), 'Plans add up to 900.000');
      return s.result();
    }
    // Legacy rule kept (limitation): a November payment for October offsets November's new charges.
    case 'paymentInLaterCycle': {
      await seed(database, 20);
      const s = new Session(database);
      await s.purchase('2026-10-11', '300000', 1);
      await s.purchase('2026-10-12', '600000', 6);
      expectStep(await s.reconcile('2026-10-20'), '2026-10-20', '400000', 'pending', ['300000', '600000']);
      const payment = await s.pay('2026-11-12', '400000');
      await s.purchase('2026-11-13', '50000', 1);
      const november = await s.reconcile('2026-11-20');
      // New charges 150.000 (50.000 + installment 2) − payments dated in the cycle 400.000 → 0, 'paid'.
      expectStep(november, '2026-11-20', '0', 'paid', ['300000', '600000', '50000'], ['400000']);
      return s.result({ payment, legacyLimitation: 'in-cycle payments offset new charges; payments are not linked to statements' });
    }
    // Exact cents and residue on the last installment; whole-peso minimum.
    case 'centsAndResidue': {
      const plans = [['100000', 3, ['33333.33', '33333.33', '33333.34']], ['100000.50', 3, ['33333.50', '33333.50', '33333.50']],
        ['0.40', 2, ['0.20', '0.20']], ['1', 3, ['0.33', '0.33', '0.34']]] as const;
      const results: Record<string, unknown> = {};
      for (const [amount, count, expected] of plans) {
        await seed(database, 20);
        const s = new Session(database);
        await s.purchase('2026-10-11', amount, count);
        let last: Observation | undefined;
        for (const [index, value] of expected.entries()) {
          last = await s.reconcile(cycles20[index]!);
          expectStep(last, ends20[index]!, value, 'pending', [amount]);
        }
        check(sumStatements(last!) === textCents(amount), `Billed ${amount} exactly`);
        results[`${amount}x${count}`] = s.result();
      }
      return results;
    }
    // Closing days 31 (short months), 30 (leap February 2028) and 29 (normal February 2027).
    case 'closingDays293031': {
      const cases = [
        [31, '2027-01-05', '300000', 4, ['2027-01-05', '2027-02-10', '2027-03-10', '2027-04-10'], ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'], '75000'],
        [30, '2028-01-31', '300000', 3, ['2028-01-31', '2028-03-10', '2028-04-10'], ['2028-02-29', '2028-03-30', '2028-04-30'], '100000'],
        [29, '2027-01-30', '300000', 2, ['2027-01-30', '2027-02-28', '2027-03-10'], ['2027-02-28', '2027-02-28', '2027-03-29'], '150000'],
      ] as const;
      const results: Record<string, unknown> = {};
      for (const [closingDay, date, amount, count, dates, ends, installment] of cases) {
        await seed(database, closingDay);
        const s = new Session(database);
        await s.purchase(date, amount, count);
        for (const [index, day] of dates.entries()) expectStep(await s.reconcile(day), ends[index]!, installment, 'pending', [amount]);
        results[`closing${closingDay}`] = s.result();
      }
      return results;
    }
    // Purchase on the closing day, without a card policy: pendingVerification, legacy charge kept and flagged.
    case 'closingDayPurchase': {
      await seed(database, 20);
      const s = new Session(database);
      await s.purchase('2026-10-20', '300000', 3);
      const october = await s.reconcile('2026-10-20');
      expectStep(october, '2026-10-20', '100000', 'pending', ['300000']);
      check(october.report?.[0]?.charges[0]?.source === 'legacyUnverified', 'Legacy charge flagged');
      check(october.report?.[0]?.notices[0]?.reasons.join() === 'missingClosingDayPurchasePolicy', 'Reason reported');
      expectStep(await s.reconcile('2026-11-19'), '2026-11-20', '0', 'open', ['300000']);
      return s.result();
    }
    // Card without closingDay: calendar months, previous rule, pendingVerification.
    case 'withoutClosingDay': {
      await seed(database, undefined);
      const s = new Session(database);
      await s.purchase('2026-10-11', '300000', 3);
      const october = await s.reconcile('2026-10-11');
      expectStep(october, '2026-10-31', '100000', 'pending', ['300000']);
      check(october.report?.[0]?.notices[0]?.reasons.join() === 'missingClosingDay', 'Reason reported');
      expectStep(await s.reconcile('2026-11-11'), '2026-11-30', '0', 'open', ['300000']);
      return s.result();
    }
    case 'yearChange': {
      await seed(database, 20);
      const s = new Session(database);
      await s.purchase('2026-12-21', '300000', 3);
      for (const [day, end] of [['2027-01-15', '2027-01-20'], ['2027-02-15', '2027-02-20'], ['2027-03-15', '2027-03-20']] as const) {
        expectStep(await s.reconcile(day), end, '100000', 'pending', ['300000']);
      }
      return s.result();
    }
    // Calendar states reproducible with the current schema. 'confirmed' needs a stored confirmed first cycle (migration 5).
    case 'calendarStates': {
      const results: Record<string, unknown> = { confirmed: 'notReproducibleWithCurrentSchema' };
      await seed(database, 20);
      let s = new Session(database);
      await s.purchase('2026-10-11', '300000', 3);
      const projected = await s.reconcile('2026-10-11');
      check(projected.report?.[0]?.charges[0]?.source === 'installmentProjected', 'Projected');
      results.projected = s.result();
      await seed(database, 20);
      s = new Session(database);
      await s.purchase('2026-10-11', '0.01', 2);
      const decision = await s.reconcile('2026-10-11');
      expectStep(decision, '2026-10-20', '0', 'open', ['0.01']);
      check(decision.report?.[0]?.notices[0]?.planStatus === 'requiresDecision', 'Requires decision');
      results.requiresDecision = s.result();
      // Inexact historical REAL written by older code: never rounded, previous charge kept.
      await seed(database, 20);
      s = new Session(database);
      await withPhase1A2Clock(bogotaNoon('2026-10-11'), async () => {
        await database.executeSql(`INSERT INTO transactions (id,amount,currency,description,date,civil_date,date_precision,account_id,type,direction,status,payment_method,created_at,updated_at)
          VALUES ('legacy-inexact',300000.005,'COP','Legacy','2026-10-11','2026-10-11','date','card','expense','outflow','posted','credit','2026-10-11','2026-10-11')`);
        await database.executeSql(`INSERT INTO installment_purchases (id,transaction_id,account_id,total_amount,currency,installment_count,paid_installments,monthly_amount,status,created_at,updated_at)
          VALUES ('installment-legacy-inexact','legacy-inexact','card',300000.005,'COP',3,0,100000,'active','2026-10-11','2026-10-11')`);
      });
      const inexact = await s.reconcile('2026-10-11');
      check(inexact.report?.[0]?.notices[0]?.reasons.join() === 'inexactHistoricalAmount', 'Inexact reported');
      check(statementOf(inexact, '2026-10-20')?.total_amount === 100000, 'Legacy monthly amount kept');
      results.pendingVerificationInexact = s.result();
      return results;
    }
    // Closed, paid and old open statements are never rewritten; clock moving back writes nothing; repetition is idempotent.
    case 'historicalProtection': {
      await seed(database, 20);
      const s = new Session(database);
      await s.purchase('2026-08-11', '600000', 6);
      await database.executeSql('DELETE FROM credit_card_statements');
      for (const [start, end, total, status] of [['2026-07-21', '2026-08-20', 100000, 'closed'], ['2026-08-21', '2026-09-20', 0, 'paid'],
        ['2026-09-21', '2026-10-20', 0, 'open']] as const) {
        await database.executeSql(`INSERT INTO credit_card_statements (id,account_id,statement_start_date,statement_end_date,payment_due_date,total_amount,
          minimum_payment_amount,currency,status,created_at,updated_at) VALUES (?, 'card', ?, ?, '2026-12-05', ?, 0, 'COP', ?, 'history', 'history')`,
          [`statement-auto-card-${start}-${end}`, start, end, total, status]);
      }
      const history = statements(await observe(database, '2026-11-11')).slice();
      const november = await s.reconcile('2026-11-11', 'november');
      check(JSON.stringify(statements(november).slice(0, 3)) === JSON.stringify(history), 'History rewritten');
      expectStep(november, '2026-11-20', '100000', 'pending', ['600000']);
      const back = await s.reconcile('2026-10-15', 'clock moved back');
      check(back.report?.[0]?.write === 'supersededByLaterCycle', 'Superseded cycle not protected');
      check(JSON.stringify(statements(back)) === JSON.stringify(statements(november)), 'Clock-back write');
      const again = await s.reconcile('2026-11-15', 'repeated');
      check(statements(again).find(x => x.statement_end_date === '2026-11-20')?.created_at ===
        statements(november).find(x => x.statement_end_date === '2026-11-20')?.created_at, 'created_at preserved');
      return s.result();
    }
  }
}
