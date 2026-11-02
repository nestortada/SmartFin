'use strict';
// Read repository source; run SQLite only in memory. Writes are confined to this delivery.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const yaml = require('js-yaml');
const { DatabaseSync } = require('node:sqlite');
const delivery = path.resolve(__dirname, '..');
const root = path.resolve(delivery, '../..');
const skill = path.join(delivery, 'smartfin-sqlite-architecture');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function files(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? files(file) : [file];
  });
}
function protectedState() {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'src', '__tests__', 'scripts', 'android/app/src/main',
    '.agents', '.codex', '.claude', 'AGENTS.md', 'CLAUDE.md', '.gitignore', 'package.json', 'package-lock.json',
    'jest.config.js', 'jest.reproductions.config.js', 'docs/ARQUITECTURA.md', 'docs/BASE_DE_DATOS.md'],
  { cwd: root, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }).toString().split('\0').filter(Boolean);
  const additional = ['.agents', '.codex', '.claude', 'src', 'android/app/src/main'].flatMap(dir => files(path.join(root, dir)));
  const all = [...new Set([...tracked.map(file => path.join(root, file)), ...additional])].sort();
  return Object.fromEntries(all.filter(file => !/\.(db|sqlite|sqlite3)(-(wal|shm|journal))?$/i.test(file) && fs.existsSync(file) && fs.statSync(file).isFile())
    .map(file => [path.relative(root, file).replaceAll('\\', '/'), sha(file)]));
}
if (process.argv[2] === 'baseline') {
  fs.writeFileSync(path.join(__dirname, 'protected-before.json'), JSON.stringify(protectedState(), null, 2) + '\n');
  console.log('Read-only source/hook baseline recorded.');
  process.exit(0);
}
const cache = new Map();
// Evaluate current pure DDL modules; intercept only the migration runner dependency.
// This harness checks SQL/migrations, not RN callback or native driver behavior.
async function runProgram(db, program) {
  db.exec('BEGIN');
  try {
    const iterator = program();
    let rows = [];
    for (;;) {
      const next = iterator.next(rows);
      if (next.done) { db.exec('COMMIT'); return next.value; }
      const { sql, values = [] } = next.value;
      if (db.failSQL && sql.includes(db.failSQL)) throw new Error('synthetic migration interruption');
      const statement = db.prepare(sql);
      rows = /^(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql.trim()) ? statement.all(...values) : (statement.run(...values), []);
      if (/SELECT version FROM schema_migrations/.test(sql) && db.skipVersions) rows.push(...db.skipVersions.map(version => ({ version })));
    }
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  }).outputText;
  const localRequire = specifier => {
    if (specifier.endsWith('/atomicSQLite') || specifier === './atomicSQLite')
      return { runSQLiteTransaction: (db, program) => runProgram(db, program) };
    assert.ok(specifier.startsWith('.'), 'Only local pure source imports are permitted: ' + specifier);
    return load(path.relative(root, path.resolve(path.dirname(file), specifier + '.ts')));
  };
  vm.runInThisContext('(function(require,module,exports){' + source + '\n})', { filename: file })(localRequire, module, module.exports);
  return module.exports;
}
const { SQLITE_SCHEMA_STATEMENTS } = load('src/database/sqliteSchema.ts');
const shared = load('src/modules/transactions/database/sharedExpenseSchema.ts');
const { SHARED_LOSS_SCHEMA } = load('src/modules/transactions/database/sharedLossSchema.ts');
const { applyVersionedMigrations } = load('src/database/migrations.ts');
const skipDDL = [...shared.SHARED_EXPENSE_SCHEMA, ...shared.SHARED_EXPENSE_INDEXES, ...shared.SHARED_EXPENSE_TRIGGERS, ...SHARED_LOSS_SCHEMA];
const core = SQLITE_SCHEMA_STATEMENTS.filter(sql => !skipDDL.includes(sql));
function adapter(db) {
  // applyVersionedMigrations expects executeSql for creating its version table.
  db.executeSql = async sql => { db.exec(sql); return []; };
  return db;
}
const quote = name => '"' + name.replaceAll('"', '""') + '"';
function inventory(db) {
  const objects = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
  const tables = objects.filter(o => o.type === 'table').map(o => ({
    name: o.name, sql: o.sql,
    columns: db.prepare('PRAGMA table_info(' + quote(o.name) + ')').all(),
    foreignKeys: db.prepare('PRAGMA foreign_key_list(' + quote(o.name) + ')').all(),
    indexes: db.prepare('PRAGMA index_list(' + quote(o.name) + ')').all().map(index => ({
      ...index, columns: db.prepare('PRAGMA index_xinfo(' + quote(index.name) + ')').all(),
      sql: objects.find(obj => obj.name === index.name)?.sql ?? null,
    })),
  }));
  return { tables, triggers: objects.filter(o => o.type === 'trigger'), objects };
}
function snapshot(db) {
  const objects = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
  return JSON.stringify({ objects, rows: objects.filter(o => o.type === 'table').map(o => [o.name, db.prepare('SELECT * FROM ' + quote(o.name) + ' ORDER BY rowid').all()]) });
}
function check(db) {
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
}
const legacyColumns = new Set(['payment_method','credit_card_hint','dedupe_key','messages_json','clarification_history_json',
  'civil_date','local_time','time_zone','date_precision','shared_expense_id','contact_id','amount_minor','shared_active']);
async function legacy(version) {
  const db = adapter(new DatabaseSync(':memory:'));
  for (const sql of core) {
    const legacySQL = sql.split('\n').filter(line => !legacyColumns.has(line.trim().split(/\s/)[0])).join('\n');
    db.exec(legacySQL);
  }
  db.exec("INSERT INTO accounts(id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES('legacy','Sintética','bankAccount','active','COP',12345.67,'2000-01-01','2000-01-01')");
  db.exec("INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at) VALUES('legacy-tx',45.67,'COP','Sintética','2000-01-01','legacy','expense','outflow','posted','2000-01-01','2000-01-01')");
  db.exec("INSERT INTO recurring_subscriptions(id,name,amount,currency,periodicity,next_charge_date,status,created_at,updated_at) VALUES('legacy-sub','Sintética',10,'COP','monthly','2000-02-01','active','2000-01-01','2000-01-01')");
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  if (version) {
    db.skipVersions = [1,2,3,4].filter(v => v > version);
    await applyVersionedMigrations(db);
    delete db.skipVersions;
  }
  return db;
}
async function main() {
  const db = adapter(new DatabaseSync(':memory:'));
  try {
    for (const sql of core) db.exec(sql);
    await applyVersionedMigrations(db);
    check(db);
    const schema = inventory(db);
    assert.equal(schema.tables.length, 39);
    const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version;
    fs.writeFileSync(path.join(skill, 'references/schema-inventory.json'), JSON.stringify({
      generatedFrom: 'Current repository DDL and migration generator, synthetic in-memory database',
      node: process.version, sqliteVersion, ...schema,
    }, null, 2) + '\n');
    const summary = ['# Inventario SQLite derivado', '',
      'Generado desde el DDL y el generador de migraciones vigentes con SQLite de Node, en memoria. No se abrió ninguna base real.', '',
      `39 tablas; ${schema.objects.filter(o => o.type === 'index' && o.sql).length} índices explícitos; ${schema.triggers.length} triggers.`, '',
      'El JSON adjunto conserva columnas, restricciones en DDL, FK, acciones de borrado, índices explícitos/automáticos y SQL de cada trigger.', '',
      '| Tabla | Clave primaria | FK salientes (acción de borrado) |', '|---|---|---|',
      ...schema.tables.map(t => '| `' + t.name + '` | ' + t.columns.filter(c => c.pk).sort((a,b) => a.pk-b.pk).map(c => '`'+c.name+'`').join(', ') + ' | ' + (t.foreignKeys.map(f => '`'+f.from+' → '+f.table+'.'+f.to+'` ('+f.on_delete+')').join('; ') || '—') + ' |'),
      '', '## Índices explícitos', '', ...schema.objects.filter(o => o.type === 'index' && o.sql).map(o => '- `' + o.sql.replace(/\s+/g,' ').trim() + '`'),
      '', '## Triggers', '', ...schema.triggers.map(o => '- `' + o.name + '` en `' + o.tbl_name + '`.'), '',
      'Detalle completo: [schema-inventory.json](schema-inventory.json). Regenerar tras cambios de esquema; no usar este inventario como sustituto de introspección vigente.', ''];
    fs.writeFileSync(path.join(skill, 'references/schema-inventory.md'), summary.join('\n'));
    const migrations = [];
    for (const version of [0,1,2,3,4]) {
      const old = await legacy(version);
      try {
        const balance = old.prepare('SELECT balance_amount FROM accounts').get().balance_amount;
        const tx = old.prepare('SELECT id,amount,date,account_id FROM transactions').all();
        const subscriptions = old.prepare('SELECT id,name,amount,currency,next_charge_date FROM recurring_subscriptions').all();
        await applyVersionedMigrations(old);
        check(old);
        assert.equal(old.prepare('SELECT balance_amount FROM accounts').get().balance_amount, balance);
        assert.deepEqual(old.prepare('SELECT id,amount,date,account_id FROM transactions').all(), tx);
        assert.deepEqual(old.prepare('SELECT id,name,amount,currency,next_charge_date FROM recurring_subscriptions').all(), subscriptions);
        assert.equal(old.prepare('SELECT anchor_date FROM recurring_subscriptions').get().anchor_date, '2000-02-01');
        assert.deepEqual(old.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r => r.version), [1,2,3,4]);
        const before = snapshot(old);
        await applyVersionedMigrations(old);
        assert.equal(snapshot(old), before);
        migrations.push({ from: version, preservation: true, repeatability: true, integrity: true });
      } finally { old.close(); }
    }
    const interrupted = await legacy(1);
    try {
      const before = snapshot(interrupted);
      interrupted.failSQL = 'ALTER TABLE transactions ADD COLUMN civil_date';
      await assert.rejects(applyVersionedMigrations(interrupted), /synthetic migration interruption/);
      assert.equal(snapshot(interrupted), before);
      delete interrupted.failSQL;
      await applyVersionedMigrations(interrupted);
      check(interrupted);
    } finally { interrupted.close(); }
    // Query scenario: indexed civil-day range vs scan, with representative histories.
    const { representativeSeedStatements } = load('__tests__/helpers/representativeHistory.ts');
    const day = load('src/shared/utils/transactionDate.ts').TRANSACTION_DAY_SQL;
    const queries = [];
    for (const size of [1000,10000,100000]) {
      db.exec('DELETE FROM transactions');
      db.exec('BEGIN');
      for (const sql of representativeSeedStatements(size)) db.exec(sql);
      db.exec('COMMIT');
      const dates = db.prepare('SELECT count(*) AS n, count(DISTINCT substr(civil_date,1,4)) AS years, min(civil_date) AS first, max(civil_date) AS last FROM transactions').get();
      assert.equal(dates.n, size);
      if (size === 100000) assert.equal(dates.years, 50);
      const query = `SELECT id,amount FROM transactions INDEXED BY idx_transactions_civil_day WHERE ${day} >= ? AND ${day} < ? ORDER BY id`;
      const scan = query.replace('INDEXED BY idx_transactions_civil_day', 'NOT INDEXED');
      const values = ['2026-10-01','2026-11-01'];
      const measure = sql => {
        const durations = []; let rows;
        for (let i=0; i<7; i++) { const start=performance.now(); rows=db.prepare(sql).all(...values); durations.push(performance.now()-start); }
        return { rows, durationsMs: durations };
      };
      const indexed = measure(query), scanned = measure(scan);
      assert.deepEqual(indexed.rows, scanned.rows);
      queries.push({ size, dates, rows: indexed.rows.length,
        indexedPlan: db.prepare('EXPLAIN QUERY PLAN ' + query).all(...values),
        scanPlan: db.prepare('EXPLAIN QUERY PLAN ' + scan).all(...values),
        indexedMs: indexed.durationsMs, scanMs: scanned.durationsMs, equivalent: true });
    }
    fs.writeFileSync(path.join(__dirname,'package-sha256.json'),JSON.stringify(Object.fromEntries(
      files(skill).sort().map(file => [path.relative(skill,file).replaceAll('\\','/'),sha(file)])),null,2)+'\n');
    // Structural validation: shared frontmatter and every local Markdown/code reference.
    const md = fs.readFileSync(path.join(skill,'SKILL.md'),'utf8');
    const front = yaml.load(/^---\r?\n([\s\S]*?)\r?\n---/.exec(md)[1]);
    assert.deepEqual(Object.keys(front).sort(), ['description','name']);
    assert.equal(front.name, 'smartfin-sqlite-architecture');
    assert.ok(front.description.length > 20 && front.description.length <= 1024);
    let localLinks=0, codePaths=0;
    for (const file of files(delivery).filter(f => f.endsWith('.md'))) {
      const text = fs.readFileSync(file,'utf8');
      for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
        if (/^https?:/.test(match[1])) continue;
        assert.ok(fs.existsSync(path.resolve(path.dirname(file),match[1])), file+' missing link '+match[1]); localLinks++;
      }
      for (const match of text.matchAll(/`((?:src|__tests__|scripts|android|docs)\/[A-Za-z0-9_./-]+\.(?:tsx?|jsx?|cjs|kt|md|json))`/g)) {
        assert.ok(fs.existsSync(path.join(root,match[1])), file+' missing code '+match[1]); codePaths++;
      }
    }
    const baseline = JSON.parse(fs.readFileSync(path.join(__dirname,'protected-before.json'),'utf8'));
    const after = protectedState();
    assert.deepEqual(after, baseline, 'Enumerated source, hooks, instructions and tracked configuration must remain unchanged');
    const report = { node: process.version, sqliteVersion, tables: schema.tables.length,
      explicitIndexes: schema.objects.filter(o => o.type==='index' && o.sql).length, triggers: schema.triggers.length,
      migrations, migrationInterruptionRollback: true, queries, localLinks, codePaths,
      protectedFilesUnchanged: Object.keys(baseline).length,
      limitations: ['Migration runner is isolated; callback/managed semantics tested separately with existing Jest suites.',
        'Versions 0–4 are reconstructed synthetic fixtures, not an exhaustive set of released databases.',
        'No Android campaign, installed skill discovery, native power-loss durability or in-app restoration is certified.'] };
    fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({ ...report, queries: queries.map(q=>({ size:q.size, years:q.dates.years, equivalent:q.equivalent })) },null,2));
  } finally { db.close(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
