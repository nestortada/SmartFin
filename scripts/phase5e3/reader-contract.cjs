// Phase 5E.3: executable reference of the weekly external reader v2 contract,
// validated against synthetic generations only (never Drive or real backups).
// Mirrors SmartFinBackupPublisher.validate/discover and adds the temporal and
// dataset-currency policy that an external analyst must apply.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'docs/aceptacion-fase5e3/reader');
const FIXED = ['cuentas', 'categorias', 'subcategorias', 'tarjetas-credito', 'compras-cuotas', 'personas', 'gastos-compartidos',
  'participaciones', 'reembolsos', 'abonos-compartidos', 'devoluciones-anticipos'].map(n => n + '.csv');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const HOUR = 3600000;
const NOW = Date.parse('2026-10-25T03:00:00.000Z'); // fixed evaluation instant (22:00 Bogotá, 24 Oct)

function uuid(i) { const h = i.toString(16); return `${h.repeat(8)}-${h.repeat(4)}-4${h.repeat(3)}-8${h.repeat(3)}-${h.repeat(12)}`.slice(0, 36); }
function writeGeneration(folder, {id, generatedAt, revision = 40, years = ['2026'], damage, omit, cloudSync = 'unconfirmed', formatVersion = 2}) {
  const template = path.join(folder, `template-${id}.sqlite`);
  const db = new DatabaseSync(template);
  db.exec(`CREATE TABLE financial_data_revision(id INTEGER PRIMARY KEY, revision INTEGER); INSERT INTO financial_data_revision VALUES(1, ${revision});
    CREATE TABLE transactions(id TEXT PRIMARY KEY, civil_date TEXT, date TEXT);`);
  for (const year of years) db.exec(`INSERT INTO transactions VALUES('t-${year}', '${year}-10-18', '${year}-10-18');`);
  db.close();
  const entries = [];
  for (const logical of ['smartfin-backup.db', ...FIXED, ...years.map(y => `movimientos-${y}.csv`)]) {
    const name = `smartfin-${id}--${logical}`;
    const bytes = logical.endsWith('.db') ? fs.readFileSync(template) : Buffer.from('﻿id,descripcion\nsynthetic,"Ejemplo, con ""comillas"" y ñ"\n');
    entries.push({name, logicalName: logical, bytes: bytes.length, sha256: sha(bytes)});
    if (logical !== omit) fs.writeFileSync(path.join(folder, name), bytes);
  }
  fs.unlinkSync(template);
  if (damage) { const file = path.join(folder, `smartfin-${id}--${damage}`); const data = fs.readFileSync(file); data[data.length - 2] ^= 1; fs.writeFileSync(file, data); }
  const manifest = {formatVersion, generationId: id, generatedAt, revision, financialRevision: revision, encrypted: false,
    database: entries[0].name, files: entries.map(e => e.name), csvFiles: entries.slice(1).map(e => e.name), components: entries,
    state: 'complete', validation: 'provider-readback-sha256', cloudSync};
  fs.writeFileSync(path.join(folder, `smartfin-generation-${id}.json`), JSON.stringify(manifest, null, 2));
}

// Reference reader: same structural checks as the app, then temporal/currency classification.
function verify(folder, file) {
  const m = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const id = m.generationId;
  check(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id) && file === `smartfin-generation-${id}.json`, 'identity');
  check(m.formatVersion === 2 && m.state === 'complete' && m.validation === 'provider-readback-sha256' && m.encrypted === false && m.cloudSync === 'unconfirmed', 'v2 state');
  check(Number.isSafeInteger(m.revision) && m.revision >= 0 && m.financialRevision === m.revision, 'revision');
  check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(m.generatedAt) && new Date(m.generatedAt).toISOString() === m.generatedAt, 'timestamp');
  check(Array.isArray(m.components) && m.components.length >= FIXED.length + 1, 'inventory');
  const logical = new Set(), physical = new Set();
  for (const c of m.components) {
    check(c.logicalName === 'smartfin-backup.db' || FIXED.includes(c.logicalName) || /^movimientos-\d{4}\.csv$/.test(c.logicalName), 'logical name');
    check(c.name === `smartfin-${id}--${c.logicalName}` && !logical.has(c.logicalName) && !physical.has(c.name), 'component identity');
    logical.add(c.logicalName); physical.add(c.name);
    check(Number.isSafeInteger(c.bytes) && c.bytes > 0 && /^[0-9a-f]{64}$/.test(c.sha256), 'hash metadata');
    const target = path.join(folder, c.name);
    check(fs.existsSync(target), `missing component: ${c.logicalName}`);
    const bytes = fs.readFileSync(target);
    check(bytes.length === c.bytes && sha(bytes) === c.sha256, `size/hash mismatch: ${c.logicalName}`);
  }
  const same = (a, b) => Array.isArray(a) && a.length === b.length && new Set(a).size === a.length && a.every(v => b.includes(v));
  check(['smartfin-backup.db', ...FIXED].every(n => logical.has(n)), 'missing required component');
  check(m.database === `smartfin-${id}--smartfin-backup.db` && same(m.files, [...physical]) && same(m.csvFiles, [...physical].filter(n => n !== m.database)), 'references');
  const db = new DatabaseSync(path.join(folder, m.database), {readOnly: true});
  try {
    check(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'integrity');
    check(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'FK');
    check(db.prepare('SELECT revision FROM financial_data_revision WHERE id=1').get().revision === m.revision, 'SQLite revision');
    const years = db.prepare('SELECT DISTINCT substr(COALESCE(civil_date,date),1,4) AS year FROM transactions ORDER BY year').all().map(r => `movimientos-${r.year}.csv`);
    check(same([...logical].filter(n => n.startsWith('movimientos-')), years), 'annual inventory');
  } finally { db.close(); }
  return m;
}
const bogota = iso => new Intl.DateTimeFormat('sv-SE', {timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'}).format(new Date(iso));

// epochContext: optional authorized statement exported by the app for this read,
// {currentGenerationId, issuedAt}. Without it currency stays unknown.
function read(folder, now, epochContext) {
  const names = fs.readdirSync(folder);
  const valid = [], rejected = [];
  for (const file of names.filter(n => /^smartfin-generation-[0-9a-f-]{36}\.json$/.test(n))) {
    try { valid.push(verify(folder, file)); } catch (error) { rejected.push({file, reason: error.message}); }
  }
  valid.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt) || b.generationId.localeCompare(a.generationId));
  const legacy = names.includes('smartfin-manifest.json');
  if (!valid.length) return {status: legacy ? 'legacyUnverified' : 'noVerifiedGeneration', rejected, cloudSync: 'unconfirmed', datasetCurrency: 'unknown', usableForWeeklyAnalysis: false};
  const m = valid[0], age = now - Date.parse(m.generatedAt);
  const freshness = age < 0 ? 'clockAnomaly' : age <= 168 * HOUR ? 'withinSevenDays' : 'olderThanSevenDays';
  let datasetCurrency = 'unknown';
  if (epochContext) {
    const contextAge = now - Date.parse(epochContext.issuedAt);
    // Context must be fresh (same 168 h window) and refer to an enumerated generation.
    if (contextAge >= 0 && contextAge <= 168 * HOUR) datasetCurrency = epochContext.currentGenerationId === m.generationId ? 'current' : 'historical';
  }
  return {status: 'verified', generationId: m.generationId, generatedAt: m.generatedAt, generatedAtBogota: bogota(m.generatedAt), revision: m.revision,
    ageHours: age / HOUR, freshness, fileIntegrity: 'verified', cloudSync: 'unconfirmed', datasetCurrency, rejected,
    usableForWeeklyAnalysis: freshness === 'withinSevenDays' && datasetCurrency === 'current'};
}

fs.rmSync(path.join(out, 'fixtures'), {recursive: true, force: true});
const cases = [];
function scenario(name, generations, {now = NOW, epochContext, legacy} = {}, expect) {
  const folder = path.join(out, 'fixtures', name);
  fs.mkdirSync(folder, {recursive: true});
  for (const g of generations) writeGeneration(folder, g);
  if (legacy) fs.writeFileSync(path.join(folder, 'smartfin-manifest.json'), JSON.stringify({formatVersion: 1, generatedAt: '2026-10-24T20:00:00.000Z', revision: 99}));
  const result = read(folder, now, epochContext);
  for (const [key, value] of Object.entries(expect)) assert.deepEqual(result[key], value, `${name}: ${key}`);
  cases.push({name, expect, result});
}
const t = h => new Date(NOW - h * HOUR).toISOString();
// 1. Enumeration and selection: newest corrupted (same size), next missing a component, oldest intact.
scenario('select-latest-intact', [
  {id: uuid(1), generatedAt: t(30)}, {id: uuid(2), generatedAt: t(20), omit: 'cuentas.csv'}, {id: uuid(3), generatedAt: t(10), damage: 'categorias.csv'},
], {}, {status: 'verified', generationId: uuid(1), freshness: 'withinSevenDays', datasetCurrency: 'unknown', usableForWeeklyAnalysis: false});
assert.equal(cases[0].result.rejected.length, 2);
// 2. Seven-day rule: inclusive 168 h, +1 ms is stale, future instant is an anomaly.
scenario('age-168h-inclusive', [{id: uuid(4), generatedAt: t(168)}], {}, {freshness: 'withinSevenDays'});
scenario('age-168h-plus-1ms', [{id: uuid(5), generatedAt: new Date(NOW - 168 * HOUR - 1).toISOString()}], {}, {freshness: 'olderThanSevenDays'});
scenario('future-generatedAt', [{id: uuid(6), generatedAt: new Date(NOW + 60000).toISOString()}], {}, {freshness: 'clockAnomaly'});
// 3. Bogotá civil day: 02:30Z on the 25th is still the 24th in Bogotá.
scenario('bogota-civil-day', [{id: uuid(7), generatedAt: '2026-10-25T02:30:00.000Z'}], {}, {generatedAtBogota: '2026-10-24 21:30:00'});
// 4. v1 only: legacyUnverified, never usable. v1 beside a valid v2 does not override v2.
scenario('v1-only', [], {legacy: true}, {status: 'legacyUnverified', usableForWeeklyAnalysis: false, datasetCurrency: 'unknown'});
scenario('v1-beside-v2', [{id: uuid(8), generatedAt: t(5)}], {legacy: true}, {status: 'verified', generationId: uuid(8)});
// 5. cloudSync claims are not trusted: a manifest asserting confirmation is rejected.
scenario('cloud-sync-claim-rejected', [{id: uuid(9), generatedAt: t(5), cloudSync: 'confirmed'}], {}, {status: 'noVerifiedGeneration'});
// 6. Pre-deletion generation: intact, recent and with the highest revision, but the
// authorized context names another (post-deletion) generation, or none exists.
const preDeletion = [{id: uuid(10), generatedAt: t(2), revision: 900}];
scenario('pre-deletion-no-context', preDeletion, {}, {fileIntegrity: 'verified', freshness: 'withinSevenDays', datasetCurrency: 'unknown', usableForWeeklyAnalysis: false});
scenario('pre-deletion-with-context', preDeletion, {epochContext: {currentGenerationId: null, issuedAt: t(1)}}, {datasetCurrency: 'historical', usableForWeeklyAnalysis: false});
scenario('post-deletion-older-but-current', [{id: uuid(11), generatedAt: t(48), revision: 3}, {id: uuid(12), generatedAt: t(2), revision: 900}],
  {epochContext: {currentGenerationId: uuid(11), issuedAt: t(1)}}, {generationId: uuid(12), datasetCurrency: 'historical', usableForWeeklyAnalysis: false});
scenario('current-with-fresh-context', [{id: uuid(13), generatedAt: t(2)}], {epochContext: {currentGenerationId: uuid(13), issuedAt: t(1)}}, {datasetCurrency: 'current', usableForWeeklyAnalysis: true});
scenario('stale-context-ignored', [{id: uuid(14), generatedAt: t(2)}], {epochContext: {currentGenerationId: uuid(14), issuedAt: t(200)}}, {datasetCurrency: 'unknown', usableForWeeklyAnalysis: false});
fs.writeFileSync(path.join(out, 'contract-results.json'), JSON.stringify({evaluatedAt: new Date(NOW).toISOString(), node: process.version, cases,
  externalAnalystUpdated: false, readerSourceSha256: sha(fs.readFileSync(__filename))}, null, 2));
console.log(`Reader contract: ${cases.length} scenarios passed`);
