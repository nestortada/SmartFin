import { dashboardFixture } from './helpers/dashboardFixture';
import {
  REPRESENTATIVE_REFERENCE_DAY,
  REPRESENTATIVE_VOLUMES,
  representativeSeedStatements,
  type RepresentativeSize,
} from './helpers/representativeHistory';

// The default performance fixtures must span exactly the declared calendar range,
// be reproducible and keep realistic diversity (AGENTS.md "Performance Volumes").
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));

async function seeded(size: RepresentativeSize) {
  const fixture = await dashboardFixture([]);
  for (const statement of representativeSeedStatements(size)) fixture.native.exec(statement);
  return fixture;
}
type Row = Record<string, number | string | null>;

test.each([
  [1000, 1, '2026-04-26'],
  [10000, 5, '2022-01-01'],
  [100000, 50, '1977-01-01'],
] as const)('%i movements: calendar span, diversity and integrity', async (size, years, start) => {
  const fixture = await seeded(size);
  try {
    const one = (sql: string) => fixture.native.prepare(sql).all()[0] as Row;
    const span = one(`SELECT count(*) AS n, min(civil_date) AS first, max(civil_date) AS last,
      count(DISTINCT substr(civil_date, 1, 4)) AS years, count(DISTINCT civil_date) AS days,
      sum(civil_date IS NULL) AS legacy FROM transactions`);
    expect(span).toEqual(expect.objectContaining({ n: size, years, legacy: 0 }));
    expect(String(span.first) >= start).toBe(true);
    expect(span.last).toBe(REPRESENTATIVE_REFERENCE_DAY);
    expect(REPRESENTATIVE_VOLUMES[size].start).toBe(start);
    // Every civil instant is consistent with its UTC date (Bogotá is UTC-5, no DST).
    expect(one(`SELECT count(*) AS bad FROM transactions
      WHERE date <> strftime('%Y-%m-%dT%H:%M:00.000Z', civil_date || ' ' || local_time, '+5 hours')`).bad).toBe(0);
    const kinds = fixture.native.prepare('SELECT type, count(*) AS n FROM transactions GROUP BY type ORDER BY type').all() as Row[];
    expect(kinds.map(k => k.type)).toEqual(['creditCardPayment', 'expense', 'income', 'internalTransfer']);
    for (const k of kinds) expect(Number(k.n)).toBeGreaterThan(size * 0.02);
    expect(Number(one('SELECT count(DISTINCT account_id) AS n FROM transactions').n)).toBe(6);
    expect(Number(one('SELECT count(DISTINCT category_id) AS n FROM transactions').n)).toBe(8);
    expect(fixture.native.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(one('PRAGMA integrity_check').integrity_check).toBe('ok');
    if (size === 100000) {
      // ~5-6 movements per day: no day concentrates an unrealistic load.
      expect(Number(one('SELECT max(c) AS m FROM (SELECT count(*) AS c FROM transactions GROUP BY civil_date)').m)).toBeLessThan(60);
      expect(Number(one("SELECT count(*) AS n FROM transactions WHERE substr(civil_date, 1, 7) = '2026-10'").n)).toBeGreaterThan(100);
    }
  } finally { fixture.native.close(); }
}, 120000);

test('the seed is reproducible', async () => {
  const digest = async () => {
    const fixture = await seeded(1000);
    try {
      return JSON.stringify(fixture.native.prepare('SELECT * FROM transactions ORDER BY id').all());
    } finally { fixture.native.close(); }
  };
  expect(await digest()).toBe(await digest());
});
