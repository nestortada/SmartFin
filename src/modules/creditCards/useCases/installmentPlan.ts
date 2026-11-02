import { toExactCopCents } from '../../../shared/utils/exactCopCents';

/**
 * Phase 1a.1: deterministic installment engine. Pure functions only: no SQLite, no clock, no
 * device time zone (no `Date` at all), no global settings and no mutation of the inputs.
 * Money is integer cents; dates are civil `YYYY-MM-DD` strings in America/Bogota.
 *
 * Scheduled, billed and paid installments are different things. This engine computes the first
 * two from the calendar; it never infers payments, and it never reads the legacy
 * `paid_installments` column.
 */

export const INSTALLMENT_PLAN_TIME_ZONE = 'America/Bogota' as const;
/** Technical guard (30 years of monthly cycles); SmartFin has no business limit. */
export const MAX_INSTALLMENT_COUNT = 360;

/** Civil date `YYYY-MM-DD`. A billing cycle is identified by its closing date (inclusive end). */
export type CivilDate = string;

/** Where a purchase made exactly on the closing date is billed. Bank-specific: never assumed. */
export type ClosingDayPurchasePolicy = 'closingCycle' | 'nextCycle';
/** Closing day beyond the month length (29–31). Replaceable if a card contract says otherwise. */
export type ShortMonthClosingPolicy = 'lastDayOfMonth';

export type InstallmentBillingRules = {
  closingDay?: number;
  closingDayPurchasePolicy?: ClosingDayPurchasePolicy;
  shortMonthPolicy?: ShortMonthClosingPolicy;
};

/** Exact cents, or a stored REAL amount that is accepted only if it converts exactly. */
export type InstallmentPrincipal =
  | { kind: 'cents'; cents: number }
  | { kind: 'storedAmount'; amount: number };

export type ConfirmedFirstCycle = {
  cycleEnd: CivilDate;
  source: 'user' | 'statement';
};

export type InstallmentPlanInput = {
  purchaseId: string;
  principal: InstallmentPrincipal;
  installmentCount: number;
  purchaseDate: CivilDate;
  timeZone: typeof INSTALLMENT_PLAN_TIME_ZONE;
  billing: InstallmentBillingRules;
  /** Explicit per-purchase correction of the cycle that bills installment 1 (D1 exception). */
  confirmedFirstCycle?: ConfirmedFirstCycle;
};

/**
 * - confirmed: complete calendar whose first cycle was explicitly confirmed.
 * - projected: complete calendar built with the default D1 rule (purchase cycle); usable for
 *   projections, never presented as confirmed.
 * - pendingVerification: information is missing or inexact; nothing is inferred.
 * - requiresDecision: the D2 distribution yields zero-cent installments (product decision).
 * - invalid: the inputs cannot describe a plan (bad count, non-positive amount, bad date...).
 */
export type InstallmentPlanStatus = 'confirmed' | 'projected' | 'pendingVerification' | 'requiresDecision' | 'invalid';

export type InstallmentPlanIssueCode =
  | 'invalidPurchaseId'
  | 'invalidTimeZone'
  | 'invalidInstallmentCount'
  | 'invalidPrincipal'
  | 'inexactHistoricalAmount'
  | 'invalidPurchaseDate'
  | 'missingClosingDay'
  | 'invalidClosingDay'
  | 'unsupportedShortMonthPolicy'
  | 'missingClosingDayPurchasePolicy'
  | 'invalidConfirmedFirstCycle'
  | 'firstCycleNotAClosingDate'
  | 'firstCycleBeforePurchase'
  | 'zeroCentInstallments';

export type InstallmentPlanIssue = { code: InstallmentPlanIssueCode; message: string };

export type ScheduledInstallment = {
  /** Deterministic: `${purchaseId}:installment:${position}`. */
  id: string;
  /** 1-based position in the original plan. */
  position: number;
  /** Closing date of the cycle that bills it; null when it cannot be determined. */
  cycleEnd: CivilDate | null;
  /** Exact cents; null when the principal is not exact. */
  amountCents: number | null;
};

export type InstallmentAmounts = {
  /** floor(principal / n): installments 1..n-1. */
  baseCents: number;
  /** base + residue: installment n. */
  lastCents: number;
  /** principal mod n, absorbed by the last installment (D2). */
  residueCents: number;
};

export type InstallmentPlan = {
  purchaseId: string;
  status: InstallmentPlanStatus;
  isConfirmed: boolean;
  /** Confirmed or projected: every installment has an exact amount and a cycle, with no pending decision. */
  isComplete: boolean;
  installmentCount: number;
  principalCents: number | null;
  amounts: InstallmentAmounts | null;
  firstCycle: { cycleEnd: CivilDate; source: 'confirmed' | 'purchaseCycleDefault' } | null;
  closingDay: number | null;
  schedule: ScheduledInstallment[];
  issues: InstallmentPlanIssue[];
};

export type InstallmentEvaluation = { cycleEnd: CivilDate } | { date: CivilDate };

export type InstallmentProgressIssueCode = 'planIncomplete' | 'missingClosingDay' | 'invalidEvaluation' | 'evaluationNotAClosingDate';

export type InstallmentProgress = {
  purchaseId: string;
  /** True only when the plan is complete and the evaluation could be resolved. */
  determined: boolean;
  planStatus: InstallmentPlanStatus;
  evaluatedCycleEnd: CivilDate | null;
  scheduledCount: number;
  /** Installments assigned to a cycle up to and including the evaluated one (including the open cycle). */
  billedCount: number | null;
  billedCents: number | null;
  /** Scheduled principal not billed yet. Never a payment figure. */
  unbilledCents: number | null;
  unbilledCount: number | null;
  issues: { code: InstallmentProgressIssueCode; message: string }[];
};

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type YearMonth = { year: number; month: number };

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

/** Strict civil date: real calendar day, years 0001–9999. No `Date`, no time zone. */
export function parseCivilDate(value: unknown): { year: number; month: number; day: number } | undefined {
  if (typeof value !== 'string') return undefined;
  const match = CIVIL_DATE.exec(value);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  return { year, month, day };
}

function formatCivilDate(year: number, month: number, day: number): CivilDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addMonths({ year, month }: YearMonth, offset: number): YearMonth {
  const index = year * 12 + (month - 1) + offset;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function isValidClosingDay(day: unknown): day is number {
  return typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 31;
}

/** Closing date of a month; with `lastDayOfMonth`, day 29–31 becomes the month's last day. */
export function closingDateOfMonth(year: number, month: number, closingDay: number): CivilDate {
  return formatCivilDate(year, month, Math.min(closingDay, daysInMonth(year, month)));
}

/**
 * Cycle that contains a civil date: the cycle whose closing date is the first one on or after it
 * (the closing date belongs to the cycle it closes). Purchases on the closing date are resolved by
 * `purchaseCycleEnd`, which applies the card's explicit policy.
 */
export function cycleEndContaining(date: CivilDate, closingDay: number): CivilDate | undefined {
  const parsed = parseCivilDate(date);
  if (!parsed || !isValidClosingDay(closingDay)) return undefined;
  const sameMonth = closingDateOfMonth(parsed.year, parsed.month, closingDay);
  if (date <= sameMonth) return sameMonth;
  const next = addMonths(parsed, 1);
  return closingDateOfMonth(next.year, next.month, closingDay);
}

/** Closing date `offset` cycles after `cycleEnd` (which must be a closing date of the card). */
export function shiftCycleEnd(cycleEnd: CivilDate, offset: number, closingDay: number): CivilDate {
  const parsed = parseCivilDate(cycleEnd)!;
  const target = addMonths(parsed, offset);
  return closingDateOfMonth(target.year, target.month, closingDay);
}

/** D2: integer division in cents; the last installment absorbs the residue. Exact for safe integers. */
export function distributeInstallmentCents(principalCents: number, installmentCount: number): InstallmentAmounts {
  const residueCents = principalCents % installmentCount;
  const baseCents = (principalCents - residueCents) / installmentCount;
  return { baseCents, lastCents: baseCents + residueCents, residueCents };
}

function issue(code: InstallmentPlanIssueCode): InstallmentPlanIssue {
  return { code, message: ISSUE_MESSAGES[code] };
}

const ISSUE_MESSAGES: Record<InstallmentPlanIssueCode, string> = {
  invalidPurchaseId: 'La compra no tiene un identificador válido.',
  invalidTimeZone: 'El calendario de cuotas solo admite la zona financiera America/Bogota.',
  invalidInstallmentCount: `El número de cuotas debe ser un entero entre 1 y ${MAX_INSTALLMENT_COUNT}.`,
  invalidPrincipal: 'El capital debe ser un importe positivo, finito y en centavos enteros seguros.',
  inexactHistoricalAmount: 'El importe guardado no equivale exactamente a un valor con dos decimales; no se redondea.',
  invalidPurchaseDate: 'La fecha de compra no es una fecha civil válida (YYYY-MM-DD).',
  missingClosingDay: 'La tarjeta no tiene día de corte; los ciclos de las cuotas no pueden determinarse.',
  invalidClosingDay: 'El día de corte debe ser un entero entre 1 y 31.',
  unsupportedShortMonthPolicy: 'La regla para cortes en meses más cortos no es compatible.',
  missingClosingDayPurchasePolicy: 'La compra se hizo el día del corte y la tarjeta no indica a qué ciclo pertenece.',
  invalidConfirmedFirstCycle: 'El ciclo confirmado de la primera cuota no es una fecha civil válida.',
  firstCycleNotAClosingDate: 'El ciclo confirmado de la primera cuota no coincide con una fecha de corte de la tarjeta.',
  firstCycleBeforePurchase: 'El ciclo confirmado de la primera cuota cierra antes de la fecha de compra.',
  zeroCentInstallments: 'El capital en centavos es menor que el número de cuotas: habría cuotas de $0. Requiere una decisión.',
};

function resolvePrincipal(principal: InstallmentPrincipal): { cents?: number; issue?: InstallmentPlanIssue } {
  if (principal?.kind === 'cents') {
    return Number.isSafeInteger(principal.cents) && principal.cents > 0
      ? { cents: principal.cents } : { issue: issue('invalidPrincipal') };
  }
  if (principal?.kind === 'storedAmount') {
    if (!Number.isFinite(principal.amount) || principal.amount <= 0) return { issue: issue('invalidPrincipal') };
    const cents = toExactCopCents(principal.amount);
    return cents === undefined ? { issue: issue('inexactHistoricalAmount') } : { cents };
  }
  return { issue: issue('invalidPrincipal') };
}

const INVALID_CODES = new Set<InstallmentPlanIssueCode>([
  'invalidPurchaseId', 'invalidTimeZone', 'invalidInstallmentCount', 'invalidPrincipal', 'invalidPurchaseDate',
]);

function statusOf(issues: InstallmentPlanIssue[], confirmed: boolean): InstallmentPlanStatus {
  if (issues.some(candidate => INVALID_CODES.has(candidate.code))) return 'invalid';
  if (issues.some(candidate => candidate.code !== 'zeroCentInstallments')) return 'pendingVerification';
  if (issues.length > 0) return 'requiresDecision';
  return confirmed ? 'confirmed' : 'projected';
}

/** Builds the scheduled calendar of a purchase. Never throws for data problems: it reports them. */
export function buildInstallmentPlan(input: InstallmentPlanInput): InstallmentPlan {
  const issues: InstallmentPlanIssue[] = [];
  const purchaseId = typeof input.purchaseId === 'string' ? input.purchaseId : '';
  if (purchaseId.trim().length === 0) issues.push(issue('invalidPurchaseId'));
  if (input.timeZone !== INSTALLMENT_PLAN_TIME_ZONE) issues.push(issue('invalidTimeZone'));

  const count = input.installmentCount;
  const validCount = Number.isInteger(count) && count >= 1 && count <= MAX_INSTALLMENT_COUNT;
  if (!validCount) issues.push(issue('invalidInstallmentCount'));

  const principal = resolvePrincipal(input.principal);
  if (principal.issue) issues.push(principal.issue);

  const purchaseDate = parseCivilDate(input.purchaseDate) ? input.purchaseDate : undefined;
  if (!purchaseDate) issues.push(issue('invalidPurchaseDate'));

  const { closingDay, closingDayPurchasePolicy, shortMonthPolicy = 'lastDayOfMonth' } = input.billing ?? {};
  if (shortMonthPolicy !== 'lastDayOfMonth') issues.push(issue('unsupportedShortMonthPolicy'));
  let validClosingDay: number | undefined;
  if (closingDay === undefined || closingDay === null) {
    issues.push(issue('missingClosingDay'));
  } else if (isValidClosingDay(closingDay)) {
    validClosingDay = closingDay;
  } else {
    issues.push(issue('invalidClosingDay'));
  }

  let firstCycle: InstallmentPlan['firstCycle'] = null;
  const confirmed = input.confirmedFirstCycle;
  if (confirmed !== undefined) {
    if (!parseCivilDate(confirmed?.cycleEnd)) {
      issues.push(issue('invalidConfirmedFirstCycle'));
    } else if (validClosingDay !== undefined && shiftCycleEnd(confirmed.cycleEnd, 0, validClosingDay) !== confirmed.cycleEnd) {
      issues.push(issue('firstCycleNotAClosingDate'));
    } else if (purchaseDate && confirmed.cycleEnd < purchaseDate) {
      issues.push(issue('firstCycleBeforePurchase'));
    } else {
      firstCycle = { cycleEnd: confirmed.cycleEnd, source: 'confirmed' };
    }
  } else if (purchaseDate && validClosingDay !== undefined) {
    // D1 default: the cycle of the purchase; the closing date needs the card's explicit policy.
    const containing = cycleEndContaining(purchaseDate, validClosingDay)!;
    if (containing !== purchaseDate) {
      firstCycle = { cycleEnd: containing, source: 'purchaseCycleDefault' };
    } else if (closingDayPurchasePolicy === 'closingCycle' || closingDayPurchasePolicy === 'nextCycle') {
      firstCycle = {
        cycleEnd: closingDayPurchasePolicy === 'closingCycle' ? containing : shiftCycleEnd(containing, 1, validClosingDay),
        source: 'purchaseCycleDefault',
      };
    } else {
      issues.push(issue('missingClosingDayPurchasePolicy'));
    }
  }

  const amounts = validCount && principal.cents !== undefined
    ? distributeInstallmentCents(principal.cents, count) : null;
  if (amounts && amounts.baseCents === 0) issues.push(issue('zeroCentInstallments'));

  const schedule: ScheduledInstallment[] = [];
  if (validCount && purchaseId.trim().length > 0) {
    for (let position = 1; position <= count; position++) {
      const cycleEnd = firstCycle === null ? null
        : position === 1 ? firstCycle.cycleEnd
          // A confirmed first cycle is kept, but later cycles are not inferred without a closing day.
          : validClosingDay === undefined ? null : shiftCycleEnd(firstCycle.cycleEnd, position - 1, validClosingDay);
      schedule.push({
        id: `${purchaseId}:installment:${position}`,
        position,
        cycleEnd,
        amountCents: amounts === null ? null : position === count ? amounts.lastCents : amounts.baseCents,
      });
    }
  }

  const status = statusOf(issues, firstCycle?.source === 'confirmed');
  // Zero-cent installments stay visible in the schedule but are never billable without a decision.
  const isComplete = (status === 'confirmed' || status === 'projected') &&
    schedule.every(item => item.cycleEnd !== null && item.amountCents !== null);
  return {
    purchaseId,
    status,
    isConfirmed: status === 'confirmed',
    isComplete,
    installmentCount: validCount ? count : 0,
    principalCents: principal.cents ?? null,
    amounts,
    firstCycle,
    closingDay: validClosingDay ?? null,
    schedule,
    issues,
  };
}

/**
 * Scheduled versus billed at a cycle. "Billed" means assigned to a cycle up to and including the
 * evaluated one (the open cycle bills its installment on the statement it will close). A date is
 * mapped to the cycle that contains it, the closing date included.
 */
export function evaluateInstallmentProgress(plan: InstallmentPlan, evaluation: InstallmentEvaluation): InstallmentProgress {
  const base = {
    purchaseId: plan.purchaseId,
    planStatus: plan.status,
    scheduledCount: plan.installmentCount,
  };
  const undetermined = (code: InstallmentProgressIssueCode, message: string, evaluatedCycleEnd: CivilDate | null = null): InstallmentProgress => ({
    ...base, determined: false, evaluatedCycleEnd, billedCount: null, billedCents: null,
    unbilledCents: null, unbilledCount: null, issues: [{ code, message }],
  });

  let evaluatedCycleEnd: CivilDate;
  if ('cycleEnd' in evaluation) {
    if (!parseCivilDate(evaluation.cycleEnd)) return undetermined('invalidEvaluation', 'El ciclo evaluado no es una fecha civil válida.');
    if (plan.closingDay !== null && shiftCycleEnd(evaluation.cycleEnd, 0, plan.closingDay) !== evaluation.cycleEnd) {
      return undetermined('evaluationNotAClosingDate', 'El ciclo evaluado no coincide con una fecha de corte de la tarjeta.');
    }
    evaluatedCycleEnd = evaluation.cycleEnd;
  } else {
    if (!parseCivilDate(evaluation.date)) return undetermined('invalidEvaluation', 'La fecha evaluada no es una fecha civil válida.');
    if (plan.closingDay === null) return undetermined('missingClosingDay', 'Sin día de corte no se puede saber a qué ciclo pertenece la fecha.');
    evaluatedCycleEnd = cycleEndContaining(evaluation.date, plan.closingDay)!;
  }
  if (!plan.isComplete) {
    return undetermined('planIncomplete', 'El calendario no está completo; no se cuentan cuotas facturadas.', evaluatedCycleEnd);
  }

  let billedCount = 0;
  let billedCents = 0;
  let unbilledCents = 0;
  for (const item of plan.schedule) {
    if (item.cycleEnd! <= evaluatedCycleEnd) {
      billedCount += 1;
      billedCents += item.amountCents!;
    } else {
      unbilledCents += item.amountCents!;
    }
  }
  return {
    ...base, determined: true, evaluatedCycleEnd, billedCount, billedCents, unbilledCents,
    unbilledCount: plan.installmentCount - billedCount, issues: [],
  };
}

/** Installment a complete plan bills in a given cycle (at most one; null if none). For 1a.2 statements. */
export function installmentBilledInCycle(plan: InstallmentPlan, cycleEnd: CivilDate): ScheduledInstallment | null {
  if (!plan.isComplete) return null;
  return plan.schedule.find(item => item.cycleEnd === cycleEnd) ?? null;
}

export type InstallmentRevisionInput = {
  /** Revisions take effect after this cycle: installments billed up to it are kept. */
  effectiveCycleEnd: CivilDate;
  remainingPrincipalCents: number;
  remainingInstallments: number;
  revisionNumber: number;
};

export type RevisedInstallmentSchedule = {
  ok: boolean;
  issues: string[];
  /** Installments of the base plan billed up to `effectiveCycleEnd`, unchanged. */
  kept: ScheduledInstallment[];
  /** New installments from the cycle after `effectiveCycleEnd`, with D2 amounts. */
  revised: ScheduledInstallment[];
};

/**
 * Contract for later phases (extraordinary payments, statement adjustments): a deterministic
 * schedule for a revision with an entry-into-force cycle. Nothing is persisted here.
 */
export function buildRevisedInstallmentSchedule(plan: InstallmentPlan, revision: InstallmentRevisionInput): RevisedInstallmentSchedule {
  const issues: string[] = [];
  if (!plan.isComplete || plan.closingDay === null) issues.push('El calendario base no está completo.');
  if (!parseCivilDate(revision.effectiveCycleEnd) ||
      (plan.closingDay !== null && shiftCycleEnd(revision.effectiveCycleEnd, 0, plan.closingDay) !== revision.effectiveCycleEnd)) {
    issues.push('El ciclo de entrada en vigor no es una fecha de corte de la tarjeta.');
  }
  if (!Number.isSafeInteger(revision.remainingPrincipalCents) || revision.remainingPrincipalCents < 0) {
    issues.push('El capital restante debe ser un entero de centavos no negativo.');
  }
  if (!Number.isInteger(revision.remainingInstallments) || revision.remainingInstallments < 0 ||
      revision.remainingInstallments > MAX_INSTALLMENT_COUNT) {
    issues.push('El número de cuotas restantes no es válido.');
  }
  if ((revision.remainingPrincipalCents === 0) !== (revision.remainingInstallments === 0)) {
    issues.push('Un capital restante de cero implica cero cuotas, y viceversa.');
  }
  if (!Number.isInteger(revision.revisionNumber) || revision.revisionNumber < 1) {
    issues.push('El número de revisión debe ser un entero positivo.');
  }
  if (issues.length === 0 && revision.remainingInstallments > 0 &&
      distributeInstallmentCents(revision.remainingPrincipalCents, revision.remainingInstallments).baseCents === 0) {
    issues.push(ISSUE_MESSAGES.zeroCentInstallments);
  }
  if (issues.length > 0) return { ok: false, issues, kept: [], revised: [] };

  const kept = plan.schedule.filter(item => item.cycleEnd! <= revision.effectiveCycleEnd);
  const amounts = revision.remainingInstallments > 0
    ? distributeInstallmentCents(revision.remainingPrincipalCents, revision.remainingInstallments) : null;
  const revised: ScheduledInstallment[] = [];
  for (let index = 1; index <= revision.remainingInstallments; index++) {
    const position = kept.length + index;
    revised.push({
      id: `${plan.purchaseId}:revision:${revision.revisionNumber}:installment:${position}`,
      position,
      cycleEnd: shiftCycleEnd(revision.effectiveCycleEnd, index, plan.closingDay!),
      amountCents: index === revision.remainingInstallments ? amounts!.lastCents : amounts!.baseCents,
    });
  }
  return { ok: true, issues: [], kept, revised };
}

export type InstallmentScheduleDifference = {
  cycleEnd: CivilDate;
  previousCents: number;
  nextCents: number;
  deltaCents: number;
};

/** Per-cycle comparison of two complete schedules (cycles missing on one side count as 0). */
export function compareInstallmentSchedules(
  previous: readonly ScheduledInstallment[],
  next: readonly ScheduledInstallment[],
): InstallmentScheduleDifference[] {
  const totals = new Map<CivilDate, { previousCents: number; nextCents: number }>();
  const add = (items: readonly ScheduledInstallment[], key: 'previousCents' | 'nextCents') => {
    for (const item of items) {
      if (item.cycleEnd === null || item.amountCents === null) continue;
      const entry = totals.get(item.cycleEnd) ?? { previousCents: 0, nextCents: 0 };
      entry[key] += item.amountCents;
      totals.set(item.cycleEnd, entry);
    }
  };
  add(previous, 'previousCents');
  add(next, 'nextCents');
  return [...totals.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([cycleEnd, entry]) => ({ cycleEnd, ...entry, deltaCents: entry.nextCents - entry.previousCents }));
}
