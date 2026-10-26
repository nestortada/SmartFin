// Phase 5E.5: isolated recoverability verifier for SmartFin v2 backup generations.
// Runs on the workstation (Node + node:sqlite) over a directory of pulled documents.
// It never opens a published component with SQLite: it opens an independent copy,
// read-only, and checks that the published bytes are unchanged afterwards.
// This verifies recoverability of the file; it is not an in-app restore.
import type { SmartFinSQLiteDatabase } from '../../src/database/sqliteDatabase';

// The project has no Node type declarations: minimal structural types for what is used.
export type Bytes = Uint8Array & { equals: (other: Uint8Array) => boolean; toString: (encoding: 'utf8') => string };
type Dirent = { name: string; isDirectory: () => boolean };
export type NodeFs = {
  readFileSync: ((file: string) => Bytes) & ((file: string, encoding: 'utf8') => string);
  writeFileSync: (file: string, data: string | Uint8Array) => void;
  existsSync: (file: string) => boolean;
  statSync: (file: string) => { size: number };
  readdirSync: ((directory: string) => string[]) & ((directory: string, options: { withFileTypes: true }) => Dirent[]);
  mkdirSync: (directory: string, options: { recursive: boolean }) => void;
  mkdtempSync: (prefix: string) => string;
  copyFileSync: (from: string, to: string) => void;
  cpSync: (from: string, to: string, options: { recursive: boolean }) => void;
  rmSync: (target: string, options?: { recursive?: boolean; force?: boolean }) => void;
  truncateSync: (file: string, length: number) => void;
};
export type NodeHash = { update: (data: string | Uint8Array) => NodeHash; digest: (encoding: 'hex') => string };
export const fs = require('node:fs') as NodeFs;
export const path = require('node:path') as { join: (...parts: string[]) => string; dirname: (file: string) => string };
export const crypto = require('node:crypto') as { createHash: (algorithm: 'sha256') => NodeHash };
export const { Buffer } = require('node:buffer') as { Buffer: { from: ((text: string, encoding: 'utf8') => Bytes) & ((bytes: number[]) => Bytes); concat: (list: Uint8Array[]) => Bytes } };
type Statement = { all: (...v: unknown[]) => Record<string, unknown>[] };
type NativeDb = { prepare: (sql: string) => Statement; close: () => void };
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (file: string, options?: { readOnly?: boolean }) => NativeDb };

export const FIXED_CSV = ['cuentas.csv', 'categorias.csv', 'subcategorias.csv', 'tarjetas-credito.csv', 'compras-cuotas.csv',
  'personas.csv', 'gastos-compartidos.csv', 'participaciones.csv', 'reembolsos.csv', 'abonos-compartidos.csv', 'devoluciones-anticipos.csv'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_SAFE = 9007199254740991;

export type Component = { name: string; logicalName: string; bytes: number; sha256: string };
export type Manifest = { formatVersion: number; generationId: string; generatedAt: string; revision: number; financialRevision: number;
  encrypted: boolean; database: string; files: string[]; csvFiles: string[]; components: Component[]; state: string; validation: string; cloudSync: string };
export type GenerationCheck = { id: string; valid: boolean; errors: string[]; manifest?: Manifest };

export function sha256File(file: string) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Same acceptance rules as the v2 contract (SmartFinBackupPublisher.validate), reimplemented independently. */
export function verifyGeneration(directory: string, id: string): GenerationCheck {
  const errors: string[] = [];
  const fail = (message: string) => { errors.push(message); return { id, valid: false, errors }; };
  if (!UUID.test(id)) return fail('identidad inválida');
  let manifest: Manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(directory, `smartfin-generation-${id}.json`), 'utf8')); }
  catch (error) { return fail('manifiesto ilegible: ' + String(error)); }
  const integer = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_SAFE;
  if (manifest.formatVersion !== 2) errors.push('formatVersion distinto de 2');
  if (manifest.generationId !== id) errors.push('generationId no coincide con el nombre');
  if (manifest.state !== 'complete' || manifest.validation !== 'provider-readback-sha256') errors.push('estado/validación inválidos');
  if (manifest.encrypted !== false || manifest.cloudSync !== 'unconfirmed') errors.push('cifrado/cloudSync inesperados');
  if (typeof manifest.generatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(manifest.generatedAt)) errors.push('generatedAt inválido');
  if (!integer(manifest.revision) || manifest.revision !== manifest.financialRevision) errors.push('revisión inválida');
  const components = Array.isArray(manifest.components) ? manifest.components : [];
  if (components.length < FIXED_CSV.length + 1) errors.push('componentes insuficientes');
  const names = new Set<string>(), logical = new Set<string>();
  for (const entry of components) {
    const ok = entry && (entry.logicalName === 'smartfin-backup.db' || FIXED_CSV.includes(entry.logicalName) || /^movimientos-\d{4}\.csv$/.test(entry.logicalName));
    if (!ok) { errors.push('componente no permitido: ' + entry?.logicalName); continue; }
    if (entry.name !== `smartfin-${id}--${entry.logicalName}` || names.has(entry.name) || logical.has(entry.logicalName)) errors.push('nombre de componente inválido o repetido: ' + entry.name);
    names.add(entry.name); logical.add(entry.logicalName);
    if (!integer(entry.bytes) || entry.bytes <= 0 || !/^[0-9a-f]{64}$/.test(entry.sha256)) { errors.push('tamaño/hash declarados inválidos: ' + entry.name); continue; }
    const file = path.join(directory, entry.name);
    if (!fs.existsSync(file)) { errors.push('componente ausente: ' + entry.name); continue; }
    if (fs.statSync(file).size !== entry.bytes) { errors.push('tamaño distinto: ' + entry.name); continue; }
    if (sha256File(file) !== entry.sha256) errors.push('SHA-256 distinto: ' + entry.name);
  }
  for (const required of [...FIXED_CSV, 'smartfin-backup.db']) if (!logical.has(required)) errors.push('falta componente obligatorio: ' + required);
  if (manifest.database !== `smartfin-${id}--smartfin-backup.db`) errors.push('database no apunta al SQLite de la generación');
  const listed = new Set(Array.isArray(manifest.files) ? manifest.files : []);
  if (listed.size !== names.size || [...names].some(n => !listed.has(n))) errors.push('files no coincide con components');
  const csv = new Set(Array.isArray(manifest.csvFiles) ? manifest.csvFiles : []);
  if (csv.size !== names.size - 1 || [...names].some(n => n !== manifest.database && !csv.has(n))) errors.push('csvFiles no coincide con components');
  return { id, valid: errors.length === 0, errors, manifest };
}

export function listGenerations(directory: string) {
  return fs.readdirSync(directory).map(name => /^smartfin-generation-(.+)\.json$/.exec(name)?.[1]).filter((id): id is string => !!id).sort();
}

/** Latest integral generation by (generatedAt, generationId), as the production discovery does. */
export function selectLatestIntegral(directory: string) {
  const checks = listGenerations(directory).map(id => verifyGeneration(directory, id));
  const valid = checks.filter(c => c.valid).sort((a, b) =>
    a.manifest!.generatedAt === b.manifest!.generatedAt ? a.id.localeCompare(b.id) : a.manifest!.generatedAt.localeCompare(b.manifest!.generatedAt));
  return { checks, selected: valid.at(-1) };
}

/** Read-only adapter for the production read paths. Any write is refused. */
function readOnlyAdapter(native: NativeDb): SmartFinSQLiteDatabase {
  const query = (sql: string, values: unknown[] = []) => {
    if (!/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)) throw new Error('Verifier is read-only: ' + sql.slice(0, 60));
    const rows = native.prepare(sql).all(...values);
    return { rows: { length: rows.length, item: (i: number) => rows[i], raw: () => rows }, rowsAffected: 0, insertId: 0 };
  };
  return {
    executeSql: async (sql: string, values?: unknown[]) => [query(sql, values)],
    transaction: async () => { throw new Error('Verifier is read-only: transaction'); },
    readTransaction: async () => { throw new Error('Verifier is read-only: readTransaction'); },
    close: async () => undefined,
  } as unknown as SmartFinSQLiteDatabase;
}

export function openIndependentCopy(directory: string, manifest: Manifest, workDirectory: string) {
  const source = path.join(directory, manifest.database);
  const before = sha256File(source);
  fs.mkdirSync(workDirectory, { recursive: true });
  const copy = path.join(workDirectory, `recovered-${manifest.generationId}.db`);
  fs.copyFileSync(source, copy);
  if (sha256File(copy) !== manifest.components[0]!.sha256 || before !== manifest.components[0]!.sha256) throw new Error('Copia independiente distinta del componente publicado');
  const native = new DatabaseSync(copy, { readOnly: true });
  const all = (sql: string) => native.prepare(sql).all();
  return {
    native, copy, all, database: readOnlyAdapter(native),
    /** The published file must keep its bytes after every verification step. */
    sourceUnchanged: () => sha256File(source) === before,
    close: () => native.close(),
  };
}

const quoteId = (name: string) => '"' + name.replace(/"/g, '""') + '"';
const escapeCsv = (value: string) => /[,"\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;

/**
 * C printf "%g" (precision 6), as Android's CursorWindow.getString converts REAL cells.
 * Exact binary ties round half-to-even, as bionic does.
 */
export function printfG(value: number): string {
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  if (!Number.isFinite(value)) return Number.isNaN(value) ? 'nan' : value > 0 ? 'inf' : '-inf';
  let exponential = value.toExponential(5);
  // toExponential rounds exact ties away from zero; detect an exact tie and apply half-even.
  const exact = value.toExponential(100);
  const digits = exact.replace(/e.*$/, '').replace('-', '').replace('.', '');
  if (/^50*$/.test(digits.slice(6)) && Number(digits[5]) % 2 === 0) {
    exponential = (value < 0 ? '-' : '') + digits[0] + '.' + digits.slice(1, 6) + exact.slice(exact.indexOf('e'));
  }
  const [mantissa, exp] = exponential.split('e') as [string, string];
  const e = Number(exp);
  const strip = (text: string) => text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  if (e < -4 || e >= 6) return `${strip(mantissa)}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  return strip(Number(exponential).toFixed(5 - e));
}

type Column = { alias: string; expression: string };
type Cell = { text: string; real: boolean; value: unknown };
/** Android cursor text: INTEGER and TEXT verbatim, REAL through "%g", NULL empty. */
function cells(all: (sql: string) => Record<string, unknown>[], columns: Column[], from: string): Cell[][] {
  const select = columns.map((c, i) => `${c.expression} AS v${i}, typeof(${c.expression}) AS t${i}`).join(',');
  return all(`SELECT ${select} ${from}`).map(row => columns.map((_, i) => {
    const value = row['v' + i], type = row['t' + i];
    if (type === 'null') return { text: '', real: false, value };
    if (type === 'real') return { text: printfG(Number(value)), real: true, value };
    if (type === 'blob') throw new Error('BLOB inesperado en CSV');
    return { text: String(value), real: false, value };
  }));
}

export type RebuiltCsv = { bytes: Bytes; rows: number; realCells: number; lossyRealCells: number;
  lossyExamples: { column: string; stored: number; csv: string }[] };
function writeCsv(columns: Column[], rows: Cell[][]): RebuiltCsv {
  const lines = [columns.map(c => escapeCsv(c.alias)).join(',')];
  let realCells = 0, lossyRealCells = 0;
  const lossyExamples: RebuiltCsv['lossyExamples'] = [];
  for (const row of rows) {
    lines.push(row.map(c => escapeCsv(c.text)).join(','));
    row.forEach((c, i) => {
      if (!c.real) return;
      realCells++;
      // Fidelity of the human export: does the CSV text read back as the stored double?
      if (Number(c.text) !== c.value) {
        lossyRealCells++;
        if (lossyExamples.length < 10) lossyExamples.push({ column: columns[i]!.alias, stored: Number(c.value), csv: c.text });
      }
    });
  }
  return { bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join('\n') + '\n', 'utf8')]),
    rows: rows.length, realCells, lossyRealCells, lossyExamples };
}

/** Rebuilds every CSV of the contract from the recovered SQLite with explicit column lists. */
export function rebuildCsv(all: (sql: string) => Record<string, unknown>[]) {
  const columnsOf = (table: string, prefix = '') => all(`PRAGMA table_info(${quoteId(table)})`)
    .map(c => ({ alias: String(c.name), expression: prefix + quoteId(String(c.name)) }));
  const plain = (table: string, order: string, where = '') => ({ columns: columnsOf(table), from: `FROM ${quoteId(table)} ${where} ORDER BY ${order}` });
  const definitions: Record<string, { columns: Column[]; from: string }> = {
    'cuentas.csv': plain('accounts', 'name'),
    'categorias.csv': plain('categories', 'name'),
    'subcategorias.csv': plain('subcategories', 'name'),
    'tarjetas-credito.csv': { columns: [...columnsOf('accounts', 'a.'), { alias: 'monthly_interest_rate', expression: 'p.monthly_interest_rate' }],
      from: "FROM accounts a LEFT JOIN credit_card_profiles p ON p.account_id = a.id WHERE a.type = 'creditCard' ORDER BY a.name" },
    'compras-cuotas.csv': plain('installment_purchases', 'created_at'),
    'personas.csv': plain('shared_contacts', 'name'),
    'gastos-compartidos.csv': plain('shared_expenses', 'date'),
    'participaciones.csv': plain('transaction_splits', 'created_at', 'WHERE shared_expense_id IS NOT NULL'),
    'reembolsos.csv': plain('shared_receipts', 'date'),
    'abonos-compartidos.csv': plain('shared_allocations', 'created_at'),
    'devoluciones-anticipos.csv': plain('shared_returns', 'date'),
  };
  const result = new Map<string, RebuiltCsv>();
  for (const [name, d] of Object.entries(definitions)) result.set(name, writeCsv(d.columns, cells(all, d.columns, d.from)));
  const yearly: Column[] = ([['id', 't.id'], ['fecha', 'COALESCE(t.civil_date, substr(t.date,1,10))'], ['hora', 't.local_time'],
    ['zona_horaria', 't.time_zone'], ['precision_fecha', 't.date_precision'], ['fecha_original', 't.date'], ['descripcion', 't.description'],
    ['monto', 't.amount'], ['moneda', 't.currency'], ['tipo', 't.type'], ['direccion', 't.direction'], ['estado', 't.status'],
    ['cuenta', 'a.name'], ['cuenta_destino', 'ta.name'], ['categoria', 'c.name'], ['subcategoria', 's.name'], ['comercio', 't.merchant_name'],
    ['medio_pago', 't.payment_method'], ['tarjeta', 't.credit_card_hint'], ['notas', 't.notes'], ['creado_en', 't.created_at'],
    ['actualizado_en', 't.updated_at']] as const).map(([alias, expression]) => ({ alias, expression }));
  const years = all("SELECT DISTINCT substr(COALESCE(civil_date, date), 1, 4) AS y FROM transactions WHERE date GLOB '[0-9][0-9][0-9][0-9]-*' ORDER BY y")
    .map(r => String(r.y));
  for (const year of years) {
    if (!/^\d{4}$/.test(year)) throw new Error('Año inválido');
    const from = `FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN accounts ta ON ta.id = t.target_account_id
      LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN subcategories s ON s.id = t.subcategory_id
      WHERE substr(COALESCE(t.civil_date, t.date), 1, 4) = '${year}'
      ORDER BY COALESCE(t.civil_date, substr(t.date,1,10)), t.local_time, t.created_at`;
    result.set(`movimientos-${year}.csv`, writeCsv(yearly, cells(all, yearly, from)));
  }
  return result;
}

/** Minimal RFC 4180 reader (BOM, quoted commas/quotes/newlines). */
export function parseCsv(buffer: Bytes) {
  const source = buffer.toString('utf8').replace(/^﻿/, '');
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (quoted || field || row.length) throw new Error('CSV mal formado');
  return rows;
}

export function firstDifference(a: Bytes, b: Bytes) {
  const x = a.toString('utf8').split('\n'), y = b.toString('utf8').split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return { line: i + 1, published: x[i], rebuilt: y[i] };
  return undefined;
}
