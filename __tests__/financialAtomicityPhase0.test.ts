import { FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import {
  financialAtomicityScenarios,
  runFinancialScenario,
} from './helpers/financialAtomicityScenarios';
import {
  financialStateDifferences,
  requireIntegralRollback,
} from './helpers/financialState';
import { InjectedSQLiteFailure, type SQLiteFault } from './helpers/realSQLite';

// Test-only Node boundary; the React Native tsconfig intentionally excludes Node types.
const { createHash } = require('node:crypto') as {
  createHash: (algorithm: string) => {
    update: (value: string) => { digest: (encoding: 'hex') => string };
  };
};

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'],
  });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => jest.useRealTimers());

async function run(
  scenario: (typeof financialAtomicityScenarios)[number],
  fault?: SQLiteFault,
) {
  const result = await runFinancialScenario(scenario, fault);
  expect(result.after.integrity).toEqual({
    foreignKeys: [{ foreign_keys: 1 }],
    foreignKeyViolations: [],
    integrityCheck: [{ integrity_check: 'ok' }],
  });
  return result;
}

describe('Phase 0: current behavior characterization (NO integral rollback guarantee)', () => {
  test.each(financialAtomicityScenarios)(
    '$name: reproduce audited partial state and reject future rollback oracle',
    async scenario => {
      const result = await run(scenario, {
        phase: 'before',
        sql: scenario.faultSQL,
      });
      expect(result.error).toBeInstanceOf(InjectedSQLiteFailure);
      expect(result.before.metrics).toMatchObject(scenario.initial);
      expect(result.after.metrics).toMatchObject(scenario.partial);
      expect(() =>
        requireIntegralRollback(result.before, result.after),
      ).toThrow('Incomplete financial rollback');
      const transactions = result.after.tables.transactions ?? [];
      if (scenario.name === 'taxed transfer') expect(transactions).toEqual([]);
      if (scenario.name === 'card payment')
        expect(transactions.map(tx => tx.type)).toEqual(['expense']);
      if (scenario.name === 'expense deletion')
        expect(transactions).toEqual(result.before.tables.transactions);
      if (scenario.name === 'payment edit') {
        expect(
          transactions.find(tx => tx.type === 'creditCardPayment'),
        ).toMatchObject({
          amount: 50000,
          account_id: 'bank',
          target_account_id: 'card',
        });
        expect(result.after.tables.credit_card_statements).toEqual(
          result.before.tables.credit_card_statements,
        );
        expect(
          result.after.tables.credit_card_statements?.[0]?.total_amount,
        ).toBe(150000);
      }
      // Human-readable complete evidence for the four audited boundaries.
      expect({ before: result.before, after: result.after }).toMatchSnapshot();
      const failure = result.trace.find(
        entry => entry.outcome === 'injected-before',
      );
      expect(failure).toMatchObject({ executed: false });
      expect(
        result.trace
          .slice(0, (failure?.order ?? 1) - 1)
          .some(entry => entry.sql === 'COMMIT;'),
      ).toBe(true);
    },
  );

  test.each(financialAtomicityScenarios)(
    '$name: every write, before and after, repeats exactly from a fresh database',
    async scenario => {
      const success = await run(scenario);
      expect(success.error).toBeUndefined();
      expect(success.after.metrics).toMatchObject(scenario.success);
      const writes = success.trace.filter(entry => entry.write !== undefined);
      expect(writes.length).toBeGreaterThan(0);
      const matrix = [];
      for (const write of writes) {
        for (const phase of ['before', 'after'] as const) {
          const fault = { phase, write: write.write };
          const first = await run(scenario, fault);
          const repeat = await run(scenario, fault);
          expect(first.error).toBeInstanceOf(InjectedSQLiteFailure);
          expect(repeat.error).toBeInstanceOf(InjectedSQLiteFailure);
          expect(first.before).toEqual(success.before);
          expect(repeat.before).toEqual(first.before);
          expect(repeat.after).toEqual(first.after);
          expect(repeat.trace).toEqual(first.trace);
          const injected = first.trace.filter(entry =>
            entry.outcome.startsWith('injected-'),
          );
          expect(injected).toHaveLength(1);
          expect(injected[0]).toMatchObject({
            sql: write.sql,
            values: write.values,
            write: write.write,
            executed: phase === 'after',
            outcome: `injected-${phase}`,
          });
          const differences = financialStateDifferences(
            first.before,
            first.after,
          );
          if (differences.length)
            expect(() =>
              requireIntegralRollback(first.before, first.after),
            ).toThrow();
          else
            expect(() =>
              requireIntegralRollback(first.before, first.after),
            ).not.toThrow();
          matrix.push({
            write: write.write,
            phase,
            sql: write.sql,
            values: write.values,
            metrics: first.after.metrics,
            differences,
            // Pins EVERY table/column, revision and reference without omitting audit fields.
            stateSHA256: createHash('sha256')
              .update(JSON.stringify(first.after))
              .digest('hex'),
          });
        }
      }
      expect(matrix).toHaveLength(writes.length * 2);
      expect(matrix).toMatchSnapshot();
      if (scenario.name === 'taxed transfer') {
        const txs = success.after.tables.transactions ?? [];
        const main = txs.find(
          tx => tx.type === 'internalTransfer' && tx.direction === 'outflow',
        );
        expect(txs).toHaveLength(3);
        expect(txs.find(tx => tx.id === `${main?.id}-in`)).toMatchObject({
          account_id: 'target',
          target_account_id: 'bank',
          amount: 100000,
        });
        expect(txs.find(tx => tx.id === `${main?.id}-4x1000`)).toMatchObject({
          account_id: 'bank',
          amount: 400,
          type: 'expense',
        });
      }
      if (
        scenario.name === 'payment edit' ||
        scenario.name === 'card payment'
      ) {
        expect(
          success.after.tables.credit_card_statements?.[0]?.total_amount,
        ).toBe(scenario.success.debt);
      }
    },
  );
});
