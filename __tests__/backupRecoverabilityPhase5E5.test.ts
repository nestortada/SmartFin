import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { canonicalTables, recoverabilityFigures, type TableDigestSink } from '../scripts/phase5e5/recoverability';
import { Buffer, crypto, firstDifference, fs, listGenerations, path, openIndependentCopy, parseCsv, printfG, rebuildCsv, selectLatestIntegral,
  sha256File, verifyGeneration, type NodeHash } from '../scripts/phase5e5/verifyGeneration';

// Phase 5E.5: recoverability of generations published by the real v2 protocol on the
// synthetic APK, verified in an isolated workstation environment. The committed
// 1k evidence always runs; SMARTFIN_5E5_EVIDENCE=<dir> adds every pulled campaign
// (10k/100k, both devices). File recoverability only: no in-app restore exists.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
const os = require('node:os') as { tmpdir: () => string };
const process = require('node:process') as { env: Record<string, string | undefined> };

const COMMITTED = 'docs/recuperabilidad-fase5e5/evidencia';
function campaigns(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string) => {
    if (fs.existsSync(path.join(dir, 'summary.json')) && fs.existsSync(path.join(dir, 'generations'))) found.push(dir);
    else for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) walk(path.join(dir, entry.name));
  };
  walk(root);
  return found.sort();
}
const roots = [COMMITTED, ...(process.env.SMARTFIN_5E5_EVIDENCE ? [process.env.SMARTFIN_5E5_EVIDENCE] : [])];
const dirs = [...new Set(roots.flatMap(campaigns))];
const results: Record<string, unknown> = {};

function nodeSink(): TableDigestSink {
  const hashes = new Map<string, { hash: NodeHash; bytes: number }>();
  return {
    begin: async table => { hashes.set(table, { hash: crypto.createHash('sha256'), bytes: 0 }); },
    append: async (table, text) => { const h = hashes.get(table)!; const b = Buffer.from(text, 'utf8'); h.hash.update(b); h.bytes += b.length; },
    finish: async table => { const h = hashes.get(table)!; hashes.delete(table); return { sha256: h.hash.digest('hex'), bytes: h.bytes }; },
  };
}
/** Schema the current code creates on an empty database (Node SQLite). */
async function freshSchema() {
  const sql = realSQLite();
  try {
    for (const statement of SQLITE_SCHEMA_STATEMENTS) sql.native.exec(statement);
    await applyVersionedMigrations(sql.database);
    return sql.native.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
  } finally { sql.native.close(); }
}
/** Drivers return row objects with different key orders: compare values with sorted keys. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical((value as Record<string, unknown>)[k])]));
  return value;
}
/** Every differing leaf path (values compared with sorted keys). */
function differences(a: unknown, b: unknown, at = '$', out: string[] = []): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) differences((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${at}.${key}`, out);
  } else out.push(`${at}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
  return out;
}
// 5E5-003: Colombia observed DST from May 1992 to early 1993. Hermes on API 24 resolves
// those local days without it, Node/V8 and HONOR with it, so the 30-day local-day window
// count of those months may differ for identical data. Only that field and period.
const PLATFORM_TIMEZONE_DIFFERENCE = /^\$\.dashboard\.(1992-(0[5-9]|1[0-2])|1993-0[1-4])\.recentTransactionCount: \d+ ≠ \d+$/;
/** First differing JSON path, to report instead of dumping whole objects. */
function difference(a: unknown, b: unknown, at = '$'): string | undefined {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = difference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${at}.${key}`);
      if (found) return found;
    }
  }
  return `${at}: ${JSON.stringify(a)?.slice(0, 200)} ≠ ${JSON.stringify(b)?.slice(0, 200)}`;
}

async function recover(dir: string, label: 'g1' | 'g2', generationId: string, work: string) {
  const generations = path.join(dir, 'generations');
  const original = JSON.parse(fs.readFileSync(path.join(dir, label, 'original.json'), 'utf8'));
  const check = verifyGeneration(generations, generationId);
  expect(check.errors).toEqual([]);
  const manifest = check.manifest!;
  const copy = openIndependentCopy(generations, manifest, work);
  try {
    copy.native.prepare('PRAGMA foreign_keys=ON').all();
    const integrity = copy.all('PRAGMA integrity_check');
    const foreignKeys = copy.all('PRAGMA foreign_key_check');
    expect(integrity).toEqual([{ integrity_check: 'ok' }]);
    expect(foreignKeys).toEqual([]);
    const schema = copy.all('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name');
    expect(canonical(schema)).toEqual(canonical(original.schema));
    const tables = await canonicalTables(copy.database, nodeSink());
    // Declared relations (checked by foreign_key_check) and the documented polymorphic
    // reference without FK: cash_flow_events.source_entity_* -> subscription_occurrences.
    const declaredForeignKeys = tables.reduce((n, t) => n + copy.all(`PRAGMA foreign_key_list("${t.table.replace(/"/g, '""')}")`).length, 0);
    const polymorphic = copy.all(`SELECT source_entity_type AS type, count(*) AS n,
      sum(source_entity_id NOT IN (SELECT id FROM subscription_occurrences)) AS orphans FROM cash_flow_events GROUP BY 1`);
    expect(polymorphic.every(r => r.type === 'subscription_occurrence' && r.orphans === 0)).toBe(true);
    expect(difference(tables, original.tables)).toBeUndefined();
    const figures = await recoverabilityFigures(copy.database);
    const figureDifferences = differences(canonical(JSON.parse(JSON.stringify(figures))), canonical(original.figures));
    expect(figureDifferences.filter(d => !PLATFORM_TIMEZONE_DIFFERENCE.test(d))).toEqual([]);
    // Every CSV component: rebuilt independently from the recovered SQLite, byte for byte.
    const rebuilt = rebuildCsv(copy.all);
    const csvComponents = manifest.components.filter(c => c.logicalName !== 'smartfin-backup.db');
    expect([...rebuilt.keys()].sort()).toEqual(csvComponents.map(c => c.logicalName).sort());
    const csv: Record<string, { rows: number; identical: boolean; sameRowsOtherOrder: boolean; orderMatchesIndex?: boolean; difference?: unknown;
      realCells: number; lossyRealCells: number; lossyExamples: unknown[] }> = {};
    const indexKey = new Map(copy.all(`SELECT id, COALESCE(civil_date, substr(date,1,10)) || '|' || status || '|' || substr('000000000' || rowid, -9) AS k FROM transactions`)
      .map(r => [String(r.id), String(r.k)]));
    const csvIds = new Set<string>();
    for (const component of csvComponents) {
      const published = fs.readFileSync(path.join(generations, component.name));
      const expected = rebuilt.get(component.logicalName)!;
      const rows = parseCsv(published);
      const identical = published.equals(expected.bytes);
      // Same header and the same multiset of exact rows, whatever the order.
      const sorted = (r: string[][]) => [JSON.stringify(r[0]), ...r.slice(1).map(x => JSON.stringify(x)).sort()].join('\n');
      const sameRowsOtherOrder = !identical && sorted(rows) === sorted(parseCsv(expected.bytes));
      // 5E5-001: SQLite 3.9.2 returns annual rows in idx_transactions_civil_day order (day, status, rowid).
      const keys = component.logicalName.startsWith('movimientos-') ? rows.slice(1).map(r => indexKey.get(r[0]!)!) : undefined;
      csv[component.logicalName] = { rows: rows.length - 1, identical, sameRowsOtherOrder,
        orderMatchesIndex: keys && !identical ? keys.every((k, i) => i === 0 || keys[i - 1]! <= k) : undefined,
        difference: identical ? undefined : firstDifference(published, expected.bytes),
        realCells: expected.realCells, lossyRealCells: expected.lossyRealCells, lossyExamples: expected.lossyExamples };
      expect(rows.length - 1).toBe(expected.rows);
      if (component.logicalName.startsWith('movimientos-')) for (const row of rows.slice(1)) { expect(csvIds.has(row[0]!)).toBe(false); csvIds.add(row[0]!); }
    }
    // Content must always be exact; a different row order is reported, never hidden.
    expect(Object.entries(csv).filter(([, v]) => !v.identical && !v.sameRowsOtherOrder)).toEqual([]);
    const reordered = Object.entries(csv).filter(([, v]) => !v.identical).map(([k, v]) => ({ file: k, orderMatchesIndex: v.orderMatchesIndex, first: v.difference }));
    const dated = copy.all("SELECT id FROM transactions WHERE date GLOB '[0-9][0-9][0-9][0-9]-*'").map(r => String(r.id));
    const undated = copy.all("SELECT count(*) AS n FROM transactions WHERE NOT date GLOB '[0-9][0-9][0-9][0-9]-*'")[0]!.n;
    expect(csvIds.size).toBe(dated.length);
    expect(dated.every(id => csvIds.has(id))).toBe(true);
    expect(copy.sourceUnchanged()).toBe(true);
    return {
      id: generationId, revision: manifest.financialRevision, components: manifest.components.length, databaseBytes: manifest.components[0]!.bytes,
      integrity, foreignKeys, declaredForeignKeys, polymorphic, tables: tables.length, rows: Object.fromEntries(tables.map(t => [t.table, t.rows])),
      months: figures.months, platformTimezoneDifferences: figureDifferences, current: figures.current, csv: Object.fromEntries(Object.entries(csv).map(([k, v]) => [k, v.rows])),
      csvByteIdentical: Object.values(csv).filter(v => v.identical).length, csvSameRowsOtherOrder: reordered,
      csvFidelity: { realCells: Object.values(csv).reduce((t, v) => t + v.realCells, 0), lossyRealCells: Object.values(csv).reduce((t, v) => t + v.lossyRealCells, 0),
        lossyExamples: Object.entries(csv).flatMap(([file, v]) => v.lossyExamples.map(e => ({ file, ...(e as object) }))).slice(0, 20) },
      csvTransactionRows: csvIds.size, transactionsWithoutCanonicalDate: undated, sourceUnchanged: true,
    };
  } finally { copy.close(); }
}

type Damage = { name: string; apply: (dir: string, g1: string, g2: string) => void };
const component = (id: string, logical: string) => `smartfin-${id}--${logical}`;
const manifestFile = (id: string) => `smartfin-generation-${id}.json`;
const editManifest = (dir: string, id: string, edit: (m: Record<string, unknown>) => void) => {
  const file = path.join(dir, manifestFile(id));
  const value = JSON.parse(fs.readFileSync(file, 'utf8')); edit(value); fs.writeFileSync(file, JSON.stringify(value));
};
const DAMAGES: Damage[] = [
  { name: 'generación incompleta (CSV anual ausente)', apply: (d, _a, b) => fs.rmSync(path.join(d, fs.readdirSync(d).find(n => n.startsWith(component(b, 'movimientos-')))!)) },
  { name: 'SQLite truncado', apply: (d, _a, b) => { const f = path.join(d, component(b, 'smartfin-backup.db')); fs.truncateSync(f, Math.floor(fs.statSync(f).size / 2)); } },
  { name: 'SQLite corrupto (byte alterado, mismo tamaño)', apply: (d, _a, b) => { const f = path.join(d, component(b, 'smartfin-backup.db')); const x = fs.readFileSync(f); const i = Math.floor(x.length / 2); x[i] = 255 - x[i]!; fs.writeFileSync(f, x); } },
  { name: 'componente ausente (SQLite)', apply: (d, _a, b) => fs.rmSync(path.join(d, component(b, 'smartfin-backup.db'))) },
  { name: 'componente ausente (CSV fijo)', apply: (d, _a, b) => fs.rmSync(path.join(d, component(b, 'cuentas.csv'))) },
  { name: 'hash incorrecto en manifiesto', apply: (d, _a, b) => editManifest(d, b, m => { (m.components as { sha256: string }[])[1]!.sha256 = '0'.repeat(64); }) },
  { name: 'tamaño incorrecto en manifiesto', apply: (d, _a, b) => editManifest(d, b, m => { (m.components as { bytes: number }[])[0]!.bytes += 1; }) },
  { name: 'manifiesto JSON inválido', apply: (d, _a, b) => fs.writeFileSync(path.join(d, manifestFile(b)), '{"formatVersion":2,') },
  { name: 'manifiesto con versión no soportada', apply: (d, _a, b) => editManifest(d, b, m => { m.formatVersion = 3; }) },
  { name: 'manifiesto con revisión inconsistente', apply: (d, _a, b) => editManifest(d, b, m => { m.financialRevision = Number(m.revision) + 1; }) },
  { name: 'manifiesto ausente', apply: (d, _a, b) => fs.rmSync(path.join(d, manifestFile(b))) },
  { name: 'archivos mezclados (SQLite de G1 con nombre de G2)', apply: (d, a, b) => fs.copyFileSync(path.join(d, component(a, 'smartfin-backup.db')), path.join(d, component(b, 'smartfin-backup.db'))) },
  { name: 'archivos mezclados (CSV de G1 con nombre de G2)', apply: (d, a, b) => fs.copyFileSync(path.join(d, component(a, 'cuentas.csv')), path.join(d, component(b, 'cuentas.csv'))) },
  { name: 'manifiesto de G2 apuntando a componentes de G1', apply: (d, a, b) => editManifest(d, b, m => {
    for (const c of m.components as { name: string }[]) c.name = c.name.replace(b, a);
  }) },
];

// Android CursorWindow.getString(REAL) is C "%g": six significant digits.
test('printf %g emulation used to rebuild the Android CSV cells', () => {
  expect([0, 1, 59000, 2300000, 12000000, 1234567, 2345678.9, 0.1, 1.9, 12345.5, 123456.5, 123457.5, 1234565, 1234575, 0.00001, -44900.25]
    .map(printfG)).toEqual(['0', '1', '59000', '2.3e+06', '1.2e+07', '1.23457e+06', '2.34568e+06', '0.1', '1.9', '12345.5', '123456', '123458',
    '1.23456e+06', '1.23458e+06', '1e-05', '-44900.2']);
});

const describeEvidence = dirs.length ? describe : describe.skip;
describeEvidence('5E.5 recoverability of real v2 generations', () => {
  afterAll(() => {
    const target = process.env.SMARTFIN_5E5_RESULTS;
    if (target) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(results, null, 2)); }
  });
  test.each(dirs)('%s: latest integral v2 generation, exact SQLite, figures and CSV', async dir => {
    const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
    const generations = path.join(dir, 'generations');
    const before = Object.fromEntries(fs.readdirSync(generations).map(n => [n, sha256File(path.join(generations, n))]));
    const { checks, selected } = selectLatestIntegral(generations);
    expect(listGenerations(generations)).toEqual([summary.g1, summary.g2].sort());
    expect(checks.every(c => c.valid)).toBe(true);
    expect(selected?.id).toBe(summary.g2);
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'smartfin-5e5-'));
    try {
      const g1 = await recover(dir, 'g1', summary.g1, work);
      const g2 = await recover(dir, 'g2', summary.g2, work);
      expect(g2.revision).toBeGreaterThan(g1.revision);
      const probeFile = path.join(dir, 'csv-order-probe.json');
      let orderProbe: unknown;
      if (fs.existsSync(probeFile)) {
        // Declared order computed independently from the recovered G2 copy.
        const probe = JSON.parse(fs.readFileSync(probeFile, 'utf8'));
        const copy = openIndependentCopy(generations, verifyGeneration(generations, summary.g2).manifest!, work);
        try {
          const declared = copy.all(`SELECT id FROM transactions WHERE substr(COALESCE(civil_date, date), 1, 4) = '2026'
            ORDER BY COALESCE(civil_date, substr(date,1,10)), local_time, created_at`).map(r => String(r.id));
          orderProbe = { sqlite: probe.sqlite, ...Object.fromEntries(['pre5E4', 'current', 'forcedSort'].map(k =>
            [k, { plan: probe[k].plan, declaredOrder: JSON.stringify(probe[k].ids) === JSON.stringify(declared), sameRows: [...probe[k].ids].sort().join() === [...declared].sort().join() }])) };
        } finally { copy.close(); }
        const value = orderProbe as Record<string, { declaredOrder: boolean; sameRows: boolean }>;
        // Every variant returns the same rows; the "+" variant (proposed 5E5-001 fix) keeps the declared order.
        for (const k of ['pre5E4', 'current', 'forcedSort']) expect(value[k]!.sameRows).toBe(true);
        expect(value.forcedSort!.declaredOrder).toBe(true);
        expect(value.current!.declaredOrder).toBe(g2.csvSameRowsOtherOrder.length === 0);
      }
      // 5E5-001 characterization: a reordered annual CSV follows exactly the index order.
      for (const g of [g1, g2]) expect(g.csvSameRowsOtherOrder.every(r => r.file.startsWith('movimientos-') && r.orderMatchesIndex)).toBe(true);
      const fresh = await freshSchema();
      // android_metadata is created by the Android framework, not by SmartFin migrations.
      const recoveredSchema = JSON.parse(fs.readFileSync(path.join(dir, 'g2', 'original.json'), 'utf8')).schema
        .filter((row: { name: string }) => row.name !== 'android_metadata');
      // Published files never change during verification.
      expect(Object.fromEntries(fs.readdirSync(generations).map(n => [n, sha256File(path.join(generations, n))]))).toEqual(before);
      results[dir] = { ...results[dir] as object, summary, selected: selected?.id, g1, g2, orderProbe,
        schemaEqualsCurrentCodeOnEmptyDatabase: JSON.stringify(canonical(fresh)) === JSON.stringify(canonical(recoveredSchema)),
        schemaDifference: difference(canonical(fresh), canonical(recoveredSchema)) };
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
  }, 1800000);

  test.each(dirs)('%s: failure matrix keeps the last integral generation selectable and recoverable', dir => {
    const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
    const matrix: unknown[] = [];
    for (const damage of DAMAGES) {
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'smartfin-5e5-damage-'));
      try {
        fs.cpSync(path.join(dir, 'generations'), work, { recursive: true });
        const g1Before = fs.readdirSync(work).filter(n => n.includes(summary.g1)).map(n => sha256File(path.join(work, n)));
        damage.apply(work, summary.g1, summary.g2);
        const damaged = verifyGeneration(work, summary.g2);
        const { selected } = selectLatestIntegral(work);
        expect(damaged.valid).toBe(false);
        expect(selected?.id).toBe(summary.g1);
        expect(fs.readdirSync(work).filter(n => n.includes(summary.g1)).map(n => sha256File(path.join(work, n)))).toEqual(g1Before);
        const copy = openIndependentCopy(work, selected!.manifest!, path.join(work, 'recovery'));
        try { expect(copy.all('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]); expect(copy.sourceUnchanged()).toBe(true); }
        finally { copy.close(); }
        matrix.push({ case: damage.name, g2Rejected: damaged.errors, selected: 'G1', g1Unchanged: true, g1Recoverable: true });
      } finally { fs.rmSync(work, { recursive: true, force: true }); }
    }
    results[dir] = { ...results[dir] as object, failureMatrix: matrix };
  }, 600000);
});
