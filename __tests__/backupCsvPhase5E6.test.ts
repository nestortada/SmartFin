import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { exactReal, fs, path, parseCsv, printfG, rebuildCsv, sha256File, type Bytes } from '../scripts/phase5e5/verifyGeneration';
import { ORDER_ROWS, PRECISION_VALUES, bitsOf, fromBits, randomDoubles } from '../scripts/phase5e6/probes';

// Phase 5E.6: CSV precision (5E5-002) and annual order (5E5-001). The Node part always runs;
// device evidence is checked when present: the probe of the production exporter on API 24 and
// HONOR, and the re-export of earlier generations' databases with the current and the pre-5E.6
// exporter. SMARTFIN_5E6_REEXPORT=<dir> adds the pulled 10k/100k re-exports, whose inputs are
// found under SMARTFIN_5E5_EVIDENCE=<dir>.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
const process = require('node:process') as { env: Record<string, string | undefined> };
type Native = { prepare: (sql: string) => { all: (...v: unknown[]) => Record<string, unknown>[]; run: (...v: unknown[]) => unknown }; close: () => void };
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (file: string, options?: { readOnly?: boolean }) => Native };

const EVIDENCE = 'docs/correccion-fase5e6/evidencia';
const HISTORICAL = ['docs/recuperabilidad-fase5e5/evidencia', process.env.SMARTFIN_5E5_EVIDENCE].filter((d): d is string => !!d);
const results: Record<string, unknown> = {};
afterAll(() => {
  const target = process.env.SMARTFIN_5E6_RESULTS;
  if (target) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(results, null, 2)); }
});

const same = (a: number, b: number) => bitsOf(a) === bitsOf(b);
const significant = (text: string) => text.replace('-', '').replace(/e.*$/, '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length;

describe('5E5-002 exact REAL serialization', () => {
  test('probe values read back with the same binary double, without exponent', () => {
    const rows = PRECISION_VALUES.map(({ label, value }) => {
      const text = exactReal(value);
      expect(same(Number(text), value)).toBe(true);
      expect(text).toMatch(/^-?\d+(\.\d+)?$/);
      return { label, bits: bitsOf(value), exact: text, previous: printfG(value), previousLossless: same(Number(printfG(value)), value) };
    });
    // 5E5-002 reproduction on the documented amounts: "%g" keeps six significant digits.
    const shown = Object.fromEntries(rows.map(r => [r.label, r]));
    expect(shown['1.234.567 COP']).toMatchObject({ exact: '1234567', previous: '1.23457e+06', previousLossless: false });
    expect(shown['123.456,50 COP']).toMatchObject({ exact: '123456.5', previous: '123456', previousLossless: false });
    expect(shown['525.357.500 COP']).toMatchObject({ exact: '525357500', previous: '5.25358e+08', previousLossless: false });
    expect(shown['8.296.299,60 COP (saldo 5E.5)']).toMatchObject({ exact: '8296299.6', previous: '8.2963e+06' });
    expect(shown['0,40 COP']!.exact).toBe('0.4');
    expect(shown['menor subnormal']!.exact).toBe('0.' + '0'.repeat(323) + '5');
    results.precisionValues = rows;
  });

  test('round trip and shortest length on 200.000 deterministic doubles', () => {
    let count = 0, longer = 0;
    for (const value of randomDoubles(200000)) {
      const text = exactReal(value);
      if (!same(Number(text), value)) throw new Error(`No round trip: ${bitsOf(value)} -> ${text}`);
      // JS Number#toString is the shortest round trip: the same number of significant digits.
      if (significant(text) !== significant(String(value))) longer++;
      count++;
    }
    expect(longer).toBe(0);
    results.randomRoundTrip = { count, longer };
  });

  test('non-finite and zero keep the cursor text', () => {
    expect([Infinity, -Infinity, 0, -0].map(exactReal)).toEqual(['inf', '-inf', '0', '-0']);
  });
});

/** The production annual query (SmartFinBackupCsv) with the previous and the corrected ORDER BY. */
const DAY = 'COALESCE(t.civil_date, substr(t.date,1,10))';
const annual = (order: string) => `SELECT t.id FROM transactions t WHERE ${DAY} >= ?1 AND ${DAY} < ?2
  AND substr(COALESCE(t.civil_date, t.date), 1, 4) = ?1 ORDER BY ${order}${DAY}, t.local_time, t.created_at`;
/** Declared order computed in JS: civil day, local time (NULL first, as SQLite), created_at. */
function declared(year: string) {
  const day = (r: typeof ORDER_ROWS[number]) => r.civilDate ?? r.date.slice(0, 10);
  const key = (r: typeof ORDER_ROWS[number]) => [day(r), r.localTime === null ? '' : '~' + r.localTime, r.createdAt].join('|');
  return ORDER_ROWS.filter(r => day(r).startsWith(year) && !r.id.startsWith('tie-')).sort((a, b) => key(a) < key(b) ? -1 : 1).map(r => r.id);
}
const withoutTies = (ids: string[]) => ids.filter(id => !id.startsWith('tie-') && !id.startsWith('probe-'));

describe('5E5-001 annual order', () => {
  test('both ORDER BY forms give the declared order and exact year membership on Node SQLite', async () => {
    const sql = realSQLite();
    try {
      for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
      await applyVersionedMigrations(sql.database);
      sql.native.exec("INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES('probe-a-000','Probe','bankAccount','active','COP',0,'1901-01-01','1901-01-01')");
      const insert = sql.native.prepare(`INSERT INTO transactions(id,amount,currency,description,date,civil_date,local_time,account_id,type,direction,status,created_at,updated_at)
        VALUES(?,1000,'COP','Order probe',?,?,?,'probe-a-000','expense','outflow',?,?,?)`);
      for (const r of ORDER_ROWS) insert.run(r.id, r.date, r.civilDate, r.localTime, r.status, r.createdAt, r.createdAt);
      const run = (order: string, year: string) => sql.native.prepare(annual(order)).all(year, String(Number(year) + 1)).map(r => String(r.id));
      const version = String(sql.native.prepare('SELECT sqlite_version() AS v').all()[0]!.v);
      const node: Record<string, Record<string, string[]>> = { previousOrder: {}, fixedOrder: {} };
      for (const year of ['1902', '1903']) {
        node.previousOrder![year] = run('', year);
        node.fixedOrder![year] = run('+', year);
        expect(withoutTies(node.fixedOrder![year]!)).toEqual(declared(year));
        expect(withoutTies(node.previousOrder![year]!)).toEqual(declared(year));
      }
      expect(node.fixedOrder!['1903']).toEqual(['order-10']);
      expect(node.fixedOrder!['1902']).toContain('order-11');
      results.nodeOrder = { sqlite: version, ...node };
    } finally { sql.native.close(); }
  });
});

/** Rows of a CSV keyed by its first column (id), with the header. */
function byId(bytes: Bytes) {
  const [header, ...rows] = parseCsv(bytes);
  return { header: header!, ids: rows.map(r => r[0]!), rows: new Map(rows.map(r => [r[0]!, r])) };
}
/**
 * Differences between an earlier published CSV and the current exporter's CSV of the same
 * database. Only two kinds are accepted: row order, and REAL cells whose earlier text is
 * exactly "%g" of the new exact value. Anything else fails.
 */
function classify(previous: Bytes, current: Bytes) {
  const a = byId(previous), b = byId(current);
  expect(b.header).toEqual(a.header);
  expect([...b.ids].sort()).toEqual([...a.ids].sort());
  let realCells = 0, lossy = 0, notationOnly = 0;
  const examples: unknown[] = [];
  for (const [id, row] of b.rows) {
    const old = a.rows.get(id)!;
    row.forEach((text, i) => {
      if (text === old[i]) return;
      const value = Number(text);
      if (!Number.isFinite(value) || printfG(value) !== old[i] || exactReal(value) !== text)
        throw new Error(`Unexpected CSV difference ${id}.${b.header[i]}: ${old[i]} -> ${text}`);
      realCells++;
      if (same(Number(old[i]), value)) notationOnly++; else lossy++;
      if (examples.length < 5) examples.push({ id, column: b.header[i], previous: old[i], current: text });
    });
  }
  return { rows: b.ids.length, reordered: JSON.stringify(a.ids) !== JSON.stringify(b.ids), realCells, lossy, notationOnly, examples };
}

/** Device evidence folders: <root>/<api>-<kind> (committed) or <root>/<api>/<kind> (pulled). */
function devices(root: string, kind: string) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).flatMap(n => n.endsWith('-' + kind) ? [path.join(root, n)]
    : /^api[0-9]+$/.test(n) && fs.existsSync(path.join(root, n, kind)) ? [path.join(root, n, kind)] : []);
}
const probes = devices(EVIDENCE, 'probe');
const describeProbe = probes.length ? describe : describe.skip;
describeProbe('5E.6 probe of the production exporter on the device', () => {
  test.each(probes)('%s: stored doubles, exported text and order', dir => {
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'phase5e6-probe/result.json'), 'utf8'));
    const csv = (folder: string, name: string) => byId(fs.readFileSync(path.join(dir, folder, name)));
    const current = { accounts: csv('phase5e6-probe', 'cuentas.csv'), transactions: csv('phase5e6-probe', 'movimientos-1901.csv') };
    const previous = { accounts: csv('phase5e6-probe-previous', 'cuentas.csv'), transactions: csv('phase5e6-probe-previous', 'movimientos-1901.csv') };
    const cells = result.stored.map((s: { table: 'transactions' | 'accounts'; id: string; type: string; bits: string; cursorString: string; castText: string; doubleToString: string; exactReal: string }) => {
      const stored = fromBits(s.bits);
      const column = s.table === 'transactions' ? 'monto' : 'balance_amount';
      const pick = (table: ReturnType<typeof byId>) => table.rows.get(s.id)![table.header.indexOf(column)]!;
      const text = pick(current[s.table]);
      expect(s.type).toBe('real');
      expect(s.exactReal).toBe(exactReal(stored));         // Kotlin and the Node verifier agree
      expect(text).toBe(s.exactReal);                      // the production CSV carries it
      expect(same(Number(text), stored)).toBe(true);       // and reads back as the stored double
      expect(pick(previous[s.table])).toBe(s.cursorString); // pre-5E.6 CSV: cursor "%g"
      return { table: s.table, id: s.id, bits: s.bits, csv: text, previousCsv: s.cursorString, previousLossless: same(Number(s.cursorString), stored),
        castText: s.castText, castRoundTrip: same(Number(s.castText), stored), doubleToString: s.doubleToString, doubleToStringRoundTrip: same(Number(s.doubleToString), stored) };
    });
    // Every probe value was stored (index i of PRECISION_VALUES is probe-*-<i>), as SQLite keeps it.
    const intended = (id: string) => PRECISION_VALUES[Number(id.slice(-3))]!.value;
    const changedByStorage = cells.filter((c: { id: string; bits: string }) => c.bits !== bitsOf(intended(c.id)));
    expect(changedByStorage.every((c: { id: string; bits: string }) => Object.is(intended(c.id), -0) && c.bits === bitsOf(0))).toBe(true);
    expect(cells.every((c: { doubleToStringRoundTrip: boolean }) => c.doubleToStringRoundTrip)).toBe(true);
    // Kotlin exactReal equals the Node verifier on the same deterministic random doubles.
    const random = randomDoubles(5000);
    expect(result.random.length).toBe(random.length);
    expect(result.random.filter((text: string, i: number) => text !== exactReal(random[i]!))).toEqual([]);
    for (const year of ['1902', '1903']) expect(withoutTies(result.fixedOrder[year])).toEqual(declared(year));
    const exportedOrder = withoutTies(csv('phase5e6-probe', 'movimientos-1902.csv').ids);
    expect(exportedOrder).toEqual(declared('1902'));
    expect(csv('phase5e6-probe', 'movimientos-1903.csv').ids.filter(id => id.startsWith('order'))).toEqual(['order-10']);
    const summary = {
      sqlite: result.sqlite, cells: cells.length, randomAgreement: result.random.length, previousLossy: cells.filter((c: { previousLossless: boolean }) => !c.previousLossless).length,
      castNotRoundTrip: cells.filter((c: { castRoundTrip: boolean }) => !c.castRoundTrip).map((c: { id: string; castText: string; csv: string }) => ({ id: c.id, castText: c.castText, csv: c.csv })),
      storedDifferentFromIntended: changedByStorage.map((c: { id: string }) => c.id),
      previousOrderDeclared: ['1902', '1903'].every(y => JSON.stringify(withoutTies(result.previousOrder[y])) === JSON.stringify(declared(y))),
      previousOrder1902: result.previousOrder['1902'], fixedOrder1902: result.fixedOrder['1902'], exportedOrder1902: csv('phase5e6-probe', 'movimientos-1902.csv').ids,
      ties: result.fixedOrder['1902'].filter((id: string) => id.startsWith('tie-')),
    };
    if (result.sqlite === '3.9.2') expect(summary.previousOrderDeclared).toBe(false); // 5E5-001 reproduced
    results[dir] = { ...summary, rows: cells };
  });
});

/** Earlier generation databases by id, from the 5E.5 evidence roots. */
function historicalDatabases() {
  const found = new Map<string, string>();
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      const id = /^smartfin-([0-9a-f-]{36})--smartfin-backup\.db$/.exec(entry.name)?.[1];
      if (id && !found.has(id)) found.set(id, dir);
    }
  };
  HISTORICAL.forEach(walk);
  return found;
}
const reexports = [...devices(EVIDENCE, 'reexport'), ...(process.env.SMARTFIN_5E6_REEXPORT ? devices(process.env.SMARTFIN_5E6_REEXPORT, 'reexport') : [])];
const describeReexport = reexports.length ? describe : describe.skip;
describeReexport('5E.6 re-export of earlier generations (published bytes untouched)', () => {
  const known = historicalDatabases();
  test.each(reexports)('%s: previous exporter reproduces, current differs only by order and exact REAL', dir => {
    const report: Record<string, unknown> = {};
    for (const label of fs.readdirSync(path.join(dir, 'reexport'))) {
      const result = JSON.parse(fs.readFileSync(path.join(dir, 'reexport', label, 'result.json'), 'utf8'));
      for (const [name, entry] of Object.entries(result) as [string, { sha256: string; current: { files: Record<string, { sha256: string }> }; previous: { files: Record<string, { sha256: string }> } }][]) {
        const id = /([0-9a-f-]{36})\.db$/.exec(name)![1]!;
        const generations = known.get(id);
        // Input not on this workstation, or outputs not versioned (committed evidence keeps 1k only).
        if (!generations || !fs.existsSync(path.join(dir, 'reexport', label, 'current', name.replace(/.db$/, '')))) continue;
        const manifest = JSON.parse(fs.readFileSync(path.join(generations, `smartfin-generation-${id}.json`), 'utf8'));
        const database = path.join(generations, `smartfin-${id}--smartfin-backup.db`);
        // Inputs: the published database of that generation, unchanged since publication.
        expect(entry.sha256).toBe(manifest.components[0].sha256);
        expect(sha256File(database)).toBe(manifest.components[0].sha256);
        const native = new DatabaseSync(database, { readOnly: true });
        try {
          const all = (sql: string) => native.prepare(sql).all();
          const exact = rebuildCsv(all, 'exact');
          const files: Record<string, unknown> = {};
          for (const component of manifest.components.filter((c: { logicalName: string }) => c.logicalName !== 'smartfin-backup.db')) {
            const published = path.join(generations, component.name);
            expect(sha256File(published)).toBe(component.sha256); // historical CSV intact
            const out = (exporter: string) => path.join(dir, 'reexport', label, exporter, name.replace(/\.db$/, ''), component.logicalName);
            const current = fs.readFileSync(out('current')), previous = fs.readFileSync(out('previous'));
            expect(current.equals(exact.get(component.logicalName)!.bytes)).toBe(true); // exact, declared order
            const old = classify(fs.readFileSync(published), current);
            // On the engine that published it, the pre-5E.6 exporter rebuilds the published bytes exactly.
            if (/api[0-9]+/.exec(dir)?.[0] === label) expect(previous.equals(fs.readFileSync(published))).toBe(true);
            files[component.logicalName] = { ...old, previousExporterReproducesPublished: previous.equals(fs.readFileSync(published)),
              previousExporterSameRows: JSON.stringify([...byId(previous).ids].sort()) === JSON.stringify([...byId(current).ids].sort()) };
          }
          report[`${label}/${name}`] = files;
        } finally { native.close(); }
      }
    }
    results[dir] = report;
  }, 1800000);
});
