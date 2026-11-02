// Phase 1a.1: deterministic installment engine. Pure functions; no SQLite, no clock.
import {
  buildInstallmentPlan,
  buildRevisedInstallmentSchedule,
  closingDateOfMonth,
  compareInstallmentSchedules,
  cycleEndContaining,
  distributeInstallmentCents,
  evaluateInstallmentProgress,
  installmentBilledInCycle,
  type InstallmentPlan,
  type InstallmentPlanInput,
} from '../src/modules/creditCards/useCases/installmentPlan';

// Jest runs on Node; the app tsconfig does not include Node types.
declare const process: { env: Record<string, string | undefined> };

/** Decimal COP text → exact cents, independent of the engine (BigInt oracle). */
function oracleCents(text: string): bigint {
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

function plan(overrides: Partial<InstallmentPlanInput> = {}): InstallmentPlan {
  return buildInstallmentPlan({
    purchaseId: 'p1',
    principal: { kind: 'cents', cents: 10_000_000 },
    installmentCount: 3,
    purchaseDate: '2026-10-11',
    timeZone: 'America/Bogota',
    billing: { closingDay: 20 },
    ...overrides,
  });
}

const sumCents = (p: InstallmentPlan) => p.schedule.reduce((total, item) => total + BigInt(item.amountCents!), 0n);
const cycles = (p: InstallmentPlan) => p.schedule.map(item => item.cycleEnd);

describe('exact cents (D2)', () => {
  test('100.000 COP in 3: 33.333,33 + 33.333,33 + 33.333,34', () => {
    const p = plan();
    expect(p.status).toBe('projected');
    expect(p.schedule.map(item => item.amountCents)).toEqual([3_333_333, 3_333_333, 3_333_334]);
    expect(p.amounts).toEqual({ baseCents: 3_333_333, lastCents: 3_333_334, residueCents: 1 });
    expect(sumCents(p)).toBe(10_000_000n);
  });

  test('one installment keeps the whole principal', () => {
    const p = plan({ installmentCount: 1, principal: { kind: 'cents', cents: 12_345 } });
    expect(p.schedule).toEqual([{ id: 'p1:installment:1', position: 1, cycleEnd: '2026-10-20', amountCents: 12_345 }]);
  });

  test.each([
    ['100000.50', 3, [3_333_350, 3_333_350, 3_333_350]],
    ['600000', 6, Array(6).fill(10_000_000)],
    ['100000.01', 3, [3_333_333, 3_333_333, 3_333_335]],
    ['10', 3, [333, 333, 334]],
    ['1', 3, [33, 33, 34]],
  ] as const)('%s COP in %i installments', (text, count, expected) => {
    const p = plan({ principal: { kind: 'storedAmount', amount: Number(text) }, installmentCount: count });
    expect(p.status).toBe('projected');
    expect(p.schedule.map(item => item.amountCents)).toEqual(expected);
    expect(sumCents(p)).toBe(oracleCents(text));
  });

  test.each([
    ['0.40', 2, [20, 20], 'projected'],
    ['0.01', 2, [0, 1], 'requiresDecision'],
    ['0.02', 3, [0, 0, 2], 'requiresDecision'],
    ['0.03', 3, [1, 1, 1], 'projected'],
  ] as const)('small amount %s COP in %i installments', (text, count, expected, status) => {
    const p = plan({ principal: { kind: 'storedAmount', amount: Number(text) }, installmentCount: count });
    // Zero-cent installments are visible, never hidden nor adjusted, and the plan is not billable.
    expect(p.schedule.map(item => item.amountCents)).toEqual(expected);
    expect(p.status).toBe(status);
    expect(p.isComplete).toBe(status === 'projected');
    expect(sumCents(p)).toBe(oracleCents(text));
    if (status === 'requiresDecision') {
      expect(p.issues.map(item => item.code)).toEqual(['zeroCentInstallments']);
      expect(evaluateInstallmentProgress(p, { cycleEnd: '2027-06-20' })).toMatchObject({ determined: false, billedCount: null });
    }
  });

  test('every amount 1..3.000 cents and every count 2..24 matches the BigInt oracle', () => {
    for (let count = 2; count <= 24; count++) {
      for (let cents = 1; cents <= 3_000; cents++) {
        const amounts = distributeInstallmentCents(cents, count);
        const total = BigInt(amounts.baseCents) * BigInt(count - 1) + BigInt(amounts.lastCents);
        expect(total).toBe(BigInt(cents));
        expect(BigInt(amounts.baseCents)).toBe(BigInt(cents) / BigInt(count));
        expect(BigInt(amounts.residueCents)).toBe(BigInt(cents) % BigInt(count));
      }
    }
  });

  test('large safe principals are split exactly', () => {
    for (const cents of [Number.MAX_SAFE_INTEGER, 2 ** 52 + 7, 999_999_999_999_99]) {
      for (const count of [3, 7, 24, 360]) {
        const amounts = distributeInstallmentCents(cents, count);
        expect(BigInt(amounts.baseCents) * BigInt(count - 1) + BigInt(amounts.lastCents)).toBe(BigInt(cents));
      }
    }
  });

  test.each([
    [{ kind: 'cents', cents: 0 }],
    [{ kind: 'cents', cents: -5 }],
    [{ kind: 'cents', cents: 10.5 }],
    [{ kind: 'cents', cents: Number.NaN }],
    [{ kind: 'cents', cents: Infinity }],
    [{ kind: 'cents', cents: Number.MAX_SAFE_INTEGER + 1 }],
    [{ kind: 'storedAmount', amount: 0 }],
    [{ kind: 'storedAmount', amount: -1 }],
    [{ kind: 'storedAmount', amount: Number.NaN }],
    [{ kind: 'storedAmount', amount: -Infinity }],
  ] as const)('invalid principal %p', principal => {
    const p = plan({ principal });
    expect(p.status).toBe('invalid');
    expect(p.issues.map(item => item.code)).toContain('invalidPrincipal');
    expect(p.isComplete).toBe(false);
  });

  test.each([0, -1, 2.5, Number.NaN, Infinity, 361])('invalid installment count %p', count => {
    const p = plan({ installmentCount: count });
    expect(p.status).toBe('invalid');
    expect(p.schedule).toEqual([]);
  });

  test.each([0.004, 10.005, 1e-7, 100000.123])('inexact historical REAL %p is reported, never rounded', amount => {
    const p = plan({ principal: { kind: 'storedAmount', amount } });
    expect(p.status).toBe('pendingVerification');
    expect(p.issues.map(item => item.code)).toEqual(['inexactHistoricalAmount']);
    expect(p.principalCents).toBeNull();
    expect(p.schedule.every(item => item.amountCents === null)).toBe(true);
    // Cycles are still known; only the money is pending.
    expect(cycles(p)).toEqual(['2026-10-20', '2026-11-20', '2026-12-20']);
  });

  test('a legacy Math.round monthly amount is irrelevant: the engine starts from the principal', () => {
    // 100.000/3 stored as monthly_amount 33.333 loses 1 COP; the engine bills the exact principal.
    expect(sumCents(plan())).toBe(oracleCents('100000'));
  });
});

describe('billing cycles (D1)', () => {
  test('purchase before the closing day bills in the cycle that closes this month', () => {
    expect(cycles(plan({ purchaseDate: '2026-10-11' }))).toEqual(['2026-10-20', '2026-11-20', '2026-12-20']);
  });

  test('purchase after the closing day bills in next month\'s cycle', () => {
    expect(cycles(plan({ purchaseDate: '2026-10-21' }))).toEqual(['2026-11-20', '2026-12-20', '2027-01-20']);
  });

  test('purchase on the closing day without a policy is pending, never guessed', () => {
    const p = plan({ purchaseDate: '2026-10-20' });
    expect(p.status).toBe('pendingVerification');
    expect(p.issues.map(item => item.code)).toEqual(['missingClosingDayPurchasePolicy']);
    expect(cycles(p)).toEqual([null, null, null]);
    expect(p.schedule.map(item => item.amountCents)).toEqual([3_333_333, 3_333_333, 3_333_334]);
  });

  test.each([
    ['closingCycle', ['2026-10-20', '2026-11-20', '2026-12-20']],
    ['nextCycle', ['2026-11-20', '2026-12-20', '2027-01-20']],
  ] as const)('purchase on the closing day with policy %s', (policy, expected) => {
    const p = plan({ purchaseDate: '2026-10-20', billing: { closingDay: 20, closingDayPurchasePolicy: policy } });
    expect(p.status).toBe('projected');
    expect(cycles(p)).toEqual(expected);
  });

  test('the policy is not needed (and not applied) away from the closing day', () => {
    const p = plan({ purchaseDate: '2026-10-11', billing: { closingDay: 20, closingDayPurchasePolicy: 'nextCycle' } });
    expect(cycles(p)[0]).toBe('2026-10-20');
  });

  test.each([
    [28, ['2027-01-28', '2027-02-28', '2027-03-28', '2027-04-28']],
    [29, ['2027-01-29', '2027-02-28', '2027-03-29', '2027-04-29']],
    [30, ['2027-01-30', '2027-02-28', '2027-03-30', '2027-04-30']],
    [31, ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']],
  ] as const)('closing day %i across February of a normal year uses the last day of short months', (closingDay, expected) => {
    const p = plan({ purchaseDate: '2027-01-05', installmentCount: 4, billing: { closingDay } });
    expect(cycles(p)).toEqual(expected);
  });

  test.each([
    [29, '2028-02-29'],
    [30, '2028-02-29'],
    [31, '2028-02-29'],
    [28, '2028-02-28'],
  ] as const)('leap February with closing day %i closes on %s', (closingDay, february) => {
    expect(cycles(plan({ purchaseDate: '2028-01-31', installmentCount: 2, billing: { closingDay, closingDayPurchasePolicy: 'closingCycle' } }))
      .includes(february)).toBe(true);
  });

  test('closing day 31 short month: a purchase on February 28 is the closing date and needs a policy', () => {
    expect(plan({ purchaseDate: '2027-02-28', billing: { closingDay: 31 } }).issues.map(item => item.code))
      .toEqual(['missingClosingDayPurchasePolicy']);
    expect(cycles(plan({ purchaseDate: '2027-03-01', billing: { closingDay: 31 } }))[0]).toBe('2027-03-31');
  });

  test('year change', () => {
    expect(cycles(plan({ purchaseDate: '2026-12-21', billing: { closingDay: 20 } })))
      .toEqual(['2027-01-20', '2027-02-20', '2027-03-20']);
    expect(cycles(plan({ purchaseDate: '2026-12-31', installmentCount: 2, billing: { closingDay: 31, closingDayPurchasePolicy: 'nextCycle' } })))
      .toEqual(['2027-01-31', '2027-02-28']);
  });

  test('24 installments advance one closing date per month without drift', () => {
    const p = plan({ installmentCount: 24, purchaseDate: '2027-01-15', billing: { closingDay: 31 } });
    expect(new Set(cycles(p)).size).toBe(24);
    expect(cycles(p)[23]).toBe('2028-12-31');
    expect(cycles(p)[13]).toBe('2028-02-29');
  });

  test('card without closingDay: pending, no invented cycle', () => {
    const p = plan({ billing: {} });
    expect(p.status).toBe('pendingVerification');
    expect(p.issues.map(item => item.code)).toEqual(['missingClosingDay']);
    expect(cycles(p)).toEqual([null, null, null]);
    expect(evaluateInstallmentProgress(p, { date: '2027-01-01' })).toMatchObject({ determined: false, issues: [{ code: 'missingClosingDay' }] });
  });

  test('card without closingDay keeps a confirmed first cycle but infers nothing after it', () => {
    const p = plan({ billing: {}, confirmedFirstCycle: { cycleEnd: '2026-10-25', source: 'user' } });
    expect(p.status).toBe('pendingVerification');
    expect(p.firstCycle).toEqual({ cycleEnd: '2026-10-25', source: 'confirmed' });
    expect(cycles(p)).toEqual(['2026-10-25', null, null]);
    expect(p.isConfirmed).toBe(false);
  });

  test.each([0, 32, 2.5, Number.NaN])('invalid closing day %p is pending', closingDay => {
    const p = plan({ billing: { closingDay } });
    expect(p.status).toBe('pendingVerification');
    expect(p.issues.map(item => item.code)).toEqual(['invalidClosingDay']);
  });

  test('explicit first-cycle correction recomputes the calendar deterministically', () => {
    const corrected = plan({ confirmedFirstCycle: { cycleEnd: '2026-11-20', source: 'statement' } });
    expect(corrected.status).toBe('confirmed');
    expect(corrected.isConfirmed).toBe(true);
    expect(cycles(corrected)).toEqual(['2026-11-20', '2026-12-20', '2027-01-20']);
    // It also resolves a closing-day purchase without a card policy.
    expect(plan({ purchaseDate: '2026-10-20', confirmedFirstCycle: { cycleEnd: '2026-10-20', source: 'user' } }).status).toBe('confirmed');
  });

  test.each([
    [{ cycleEnd: '2026-11-19', source: 'user' }, 'firstCycleNotAClosingDate'],
    [{ cycleEnd: '2026-09-20', source: 'user' }, 'firstCycleBeforePurchase'],
    [{ cycleEnd: '2026-02-30', source: 'user' }, 'invalidConfirmedFirstCycle'],
  ] as const)('invalid confirmed first cycle %p', (confirmedFirstCycle, code) => {
    const p = plan({ confirmedFirstCycle });
    expect(p.status).toBe('pendingVerification');
    expect(p.issues.map(item => item.code)).toEqual([code]);
  });

  test.each(['2026-02-29', '2026-13-01', '26-10-11', '2026-10-11T10:00:00Z', '0000-01-01'])('invalid purchase date %p', purchaseDate => {
    expect(plan({ purchaseDate }).status).toBe('invalid');
  });

  test('only America/Bogota is accepted as financial time zone', () => {
    expect(plan({ timeZone: 'UTC' as unknown as 'America/Bogota' }).issues.map(item => item.code)).toEqual(['invalidTimeZone']);
  });

  test('cycle helpers', () => {
    expect(closingDateOfMonth(2027, 2, 31)).toBe('2027-02-28');
    expect(cycleEndContaining('2026-10-20', 20)).toBe('2026-10-20');
    expect(cycleEndContaining('2026-10-21', 20)).toBe('2026-11-20');
    expect(cycleEndContaining('2027-02-28', 31)).toBe('2027-02-28');
    expect(cycleEndContaining('2027-03-01', 30)).toBe('2027-03-30');
  });
});

describe('progress: scheduled versus billed (D4, D7)', () => {
  const six = () => plan({ principal: { kind: 'cents', cents: 60_000_000 }, installmentCount: 6 });

  test('billed installments come from the calendar, cycle by cycle', () => {
    const p = six();
    const progress = ['2026-09-20', '2026-10-20', '2026-11-20', '2027-03-20', '2027-04-20'].map(cycleEnd => {
      const r = evaluateInstallmentProgress(p, { cycleEnd });
      return [r.billedCount, r.billedCents, r.unbilledCents, r.unbilledCount];
    });
    expect(progress).toEqual([
      [0, 0, 60_000_000, 6],
      [1, 10_000_000, 50_000_000, 5],
      [2, 20_000_000, 40_000_000, 4],
      [6, 60_000_000, 0, 0],
      [6, 60_000_000, 0, 0],
    ]);
  });

  test('a date maps to the cycle that contains it, closing date included', () => {
    const p = six();
    expect(evaluateInstallmentProgress(p, { date: '2026-10-20' })).toMatchObject({ evaluatedCycleEnd: '2026-10-20', billedCount: 1 });
    expect(evaluateInstallmentProgress(p, { date: '2026-10-21' })).toMatchObject({ evaluatedCycleEnd: '2026-11-20', billedCount: 2 });
  });

  test('evaluation errors are explicit', () => {
    const p = six();
    expect(evaluateInstallmentProgress(p, { cycleEnd: '2026-10-19' }).issues[0]!.code).toBe('evaluationNotAClosingDate');
    expect(evaluateInstallmentProgress(p, { date: 'mañana' }).issues[0]!.code).toBe('invalidEvaluation');
  });

  test('the engine never infers payments nor reads paid_installments', () => {
    const progress = evaluateInstallmentProgress(six(), { cycleEnd: '2027-03-20' });
    expect(Object.keys(progress).some(key => /paid/i.test(key))).toBe(false);
    // A legacy-shaped object with paidInstallments has no effect on the result.
    const input = { purchaseId: 'p1', principal: { kind: 'cents', cents: 60_000_000 }, installmentCount: 6, purchaseDate: '2026-10-11',
      timeZone: 'America/Bogota', billing: { closingDay: 20 }, paidInstallments: 5 } as InstallmentPlanInput;
    expect(buildInstallmentPlan(input)).toEqual(six());
  });

  test('installment billed in a given cycle (statement contract for 1a.2)', () => {
    const p = six();
    expect(installmentBilledInCycle(p, '2026-12-20')).toMatchObject({ position: 3, amountCents: 10_000_000 });
    expect(installmentBilledInCycle(p, '2027-04-20')).toBeNull();
    expect(installmentBilledInCycle(plan({ billing: {} }), '2026-10-20')).toBeNull();
  });
});

describe('contracts for later phases', () => {
  test('a revision takes effect after its cycle and keeps billed installments', () => {
    const p = plan({ principal: { kind: 'cents', cents: 60_000_000 }, installmentCount: 6 });
    const revised = buildRevisedInstallmentSchedule(p, {
      effectiveCycleEnd: '2026-11-20', remainingPrincipalCents: 25_000_000, remainingInstallments: 3, revisionNumber: 1,
    });
    expect(revised.ok).toBe(true);
    expect(revised.kept.map(item => item.position)).toEqual([1, 2]);
    expect(revised.revised).toEqual([
      { id: 'p1:revision:1:installment:3', position: 3, cycleEnd: '2026-12-20', amountCents: 8_333_333 },
      { id: 'p1:revision:1:installment:4', position: 4, cycleEnd: '2027-01-20', amountCents: 8_333_333 },
      { id: 'p1:revision:1:installment:5', position: 5, cycleEnd: '2027-02-20', amountCents: 8_333_334 },
    ]);
    const diff = compareInstallmentSchedules(p.schedule, [...revised.kept, ...revised.revised]);
    expect(diff.map(row => row.deltaCents)).toEqual([0, 0, -1_666_667, -1_666_667, -1_666_666, -10_000_000]);
    expect(diff.reduce((total, row) => total + row.deltaCents, 0)).toBe(25_000_000 - 40_000_000);
  });

  test('invalid revisions are rejected with reasons', () => {
    const p = plan();
    expect(buildRevisedInstallmentSchedule(p, { effectiveCycleEnd: '2026-11-19', remainingPrincipalCents: 1, remainingInstallments: 1, revisionNumber: 1 }).ok).toBe(false);
    expect(buildRevisedInstallmentSchedule(p, { effectiveCycleEnd: '2026-11-20', remainingPrincipalCents: 0, remainingInstallments: 2, revisionNumber: 1 }).ok).toBe(false);
    expect(buildRevisedInstallmentSchedule(p, { effectiveCycleEnd: '2026-11-20', remainingPrincipalCents: 1, remainingInstallments: 2, revisionNumber: 1 }).ok).toBe(false);
    expect(buildRevisedInstallmentSchedule(plan({ billing: {} }), { effectiveCycleEnd: '2026-11-20', remainingPrincipalCents: 2, remainingInstallments: 2, revisionNumber: 1 }).ok).toBe(false);
    expect(buildRevisedInstallmentSchedule(p, { effectiveCycleEnd: '2026-11-20', remainingPrincipalCents: 0, remainingInstallments: 0, revisionNumber: 1 }))
      .toMatchObject({ ok: true, revised: [] });
  });
});

describe('determinism and invariants', () => {
  const CASES: InstallmentPlanInput[] = [];
  const amounts = ['0.03', '1', '0.40', '100000', '100000.50', '100000.01', '600000', '1234567.89', '9999999999.99'];
  const dates = ['2026-01-31', '2026-02-28', '2028-02-29', '2026-10-20', '2026-12-31', '2027-03-15'];
  for (const amount of amounts) {
    for (const count of [1, 2, 3, 6, 12, 18, 24]) {
      for (const purchaseDate of dates) {
        for (const closingDay of [1, 15, 28, 29, 30, 31]) {
          CASES.push({
            purchaseId: `p-${amount}-${count}-${purchaseDate}-${closingDay}`,
            principal: { kind: 'storedAmount', amount: Number(amount) }, installmentCount: count, purchaseDate,
            timeZone: 'America/Bogota', billing: { closingDay, closingDayPurchasePolicy: closingDay % 2 ? 'nextCycle' : 'closingCycle' },
          });
        }
      }
    }
  }

  const run = () => JSON.stringify(CASES.map(input => {
    const p = buildInstallmentPlan(input);
    return [p, evaluateInstallmentProgress(p, { date: '2027-06-15' })];
  }));

  test('identical results under different host time zones and system clocks', () => {
    const originalTz = process.env.TZ;
    jest.useFakeTimers();
    try {
      const results = new Set<string>();
      for (const [tz, now] of [['UTC', '2026-11-01T12:00:00Z'], ['America/Bogota', '2030-01-01T04:59:00Z'],
        ['Pacific/Kiritimati', '2026-12-31T23:30:00Z'], ['America/Los_Angeles', '1999-06-01T00:00:00Z'], ['Asia/Kolkata', '2028-02-29T18:00:00Z']]) {
        process.env.TZ = tz;
        jest.setSystemTime(new Date(now!));
        results.add(run());
      }
      expect(results.size).toBe(1);
    } finally {
      jest.useRealTimers();
      // Assigning undefined would store the string "undefined" (UTC) for every later suite in this process.
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  test('every complete calendar satisfies the invariants', () => {
    let complete = 0;
    for (const input of CASES) {
      const p = buildInstallmentPlan(input);
      if (!p.isComplete) {
        expect(p.isConfirmed).toBe(false);
        continue;
      }
      complete += 1;
      // 1. exact sum; 4. as many installments as the plan.
      expect(sumCents(p)).toBe(BigInt(p.principalCents!));
      expect(p.schedule).toHaveLength(input.installmentCount);
      // 2. one cycle per installment, strictly increasing; 3. deterministic ids and positions.
      const ends = cycles(p) as string[];
      expect(new Set(ends).size).toBe(ends.length);
      expect([...ends].sort()).toEqual(ends);
      p.schedule.forEach((item, index) => {
        expect(item.position).toBe(index + 1);
        expect(item.id).toBe(`${input.purchaseId}:installment:${index + 1}`);
      });
      // 5. remaining scheduled principal never negative; 6. billed never above the total.
      for (const date of ['2025-01-01', ends[0]!, ends[ends.length - 1]!, '2040-01-01']) {
        const r = evaluateInstallmentProgress(p, { date });
        expect(r.unbilledCents!).toBeGreaterThanOrEqual(0);
        expect(r.billedCount!).toBeLessThanOrEqual(p.installmentCount);
        expect(BigInt(r.billedCents!) + BigInt(r.unbilledCents!)).toBe(BigInt(p.principalCents!));
      }
    }
    expect(complete).toBeGreaterThan(2_000);
  });

  test('inputs are never mutated', () => {
    const input = Object.freeze({
      purchaseId: 'p1', principal: Object.freeze({ kind: 'cents', cents: 100 }), installmentCount: 3, purchaseDate: '2026-10-11',
      timeZone: 'America/Bogota', billing: Object.freeze({ closingDay: 20 }),
      confirmedFirstCycle: Object.freeze({ cycleEnd: '2026-10-20', source: 'user' }),
    }) as InstallmentPlanInput;
    const before = JSON.stringify(input);
    const p = buildInstallmentPlan(input);
    evaluateInstallmentProgress(Object.freeze(p), { cycleEnd: '2026-11-20' });
    expect(JSON.stringify(input)).toBe(before);
  });

  test('pending calendars are never presented as confirmed', () => {
    for (const p of [plan({ billing: {} }), plan({ purchaseDate: '2026-10-20' }), plan({ principal: { kind: 'storedAmount', amount: 0.004 } }),
      plan({ principal: { kind: 'cents', cents: 1 } }), plan({ billing: {}, confirmedFirstCycle: { cycleEnd: '2026-10-20', source: 'user' } })]) {
      expect(p.isConfirmed).toBe(false);
      expect(p.isComplete).toBe(false);
      expect(['pendingVerification', 'requiresDecision']).toContain(p.status);
    }
  });
});
