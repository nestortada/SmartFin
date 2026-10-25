// Consolidates phase 5E.3 Android evidence into summary.json and summary.md.
// Only folders with a passed result.json count; runner errors are listed apart.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../docs/aceptacion-fase5e3/android');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
const med = values => { const s = values.filter(v => v !== undefined).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : undefined; };
const fmt = v => v === undefined ? '—' : v >= 100 ? Math.round(v).toLocaleString('es-CO') : v.toFixed(1);
const summary = {platforms: {}, failures: []};
const lines = ['# Resumen Android 5E.3', ''];
for (const api of ['api24', 'api35']) {
  const dir = path.join(root, api);
  if (!fs.existsSync(dir)) continue;
  const platform = summary.platforms[api] = {campaigns: 0, controls: 0, history: [], sqlite: undefined};
  for (const name of fs.readdirSync(dir).sort()) {
    const folder = path.join(dir, name);
    const result = path.join(folder, 'result.json');
    if (fs.existsSync(path.join(folder, 'runner-error.txt')) && !fs.existsSync(result)) {
      summary.failures.push({api, name, error: fs.readFileSync(path.join(folder, 'runner-error.txt'), 'utf8').slice(0, 300)}); continue;
    }
    if (!fs.existsSync(result)) continue;
    const r = read(result);
    if (!r.passed) { summary.failures.push({api, name, error: String(r.failure).slice(0, 300)}); continue; }
    platform.campaigns++; platform.controls += r.cases.length;
    if (!name.startsWith('history-')) continue;
    const seed = r.cases.find(c => c.name === 'seed').evidence;
    platform.sqlite = seed.sqlite;
    const row = {distribution: seed.distribution, variant: seed.variant, size: seed.size, cases: {}};
    for (const c of r.cases) {
      const m = /-(\w+)-(first-page-samples|exhaustive-traversal)$/.exec(c.name);
      if (!m) continue;
      const entry = row.cases[m[1]] ??= {};
      if (m[2] === 'first-page-samples') {
        entry.firstMs = med(c.evidence.samples.map(s => s.firstMs));
        entry.secondMs = med(c.evidence.samples.map(s => s.secondMs));
        entry.firstStatements = med(c.evidence.samples.map(s => s.firstStatements));
        entry.cursor = c.evidence.samples[0].cursorKind;
        entry.matches = c.evidence.matches;
      } else Object.assign(entry, {pages: c.evidence.pages, total: c.evidence.total, laterMedian: c.evidence.laterPages.median,
        laterP90: c.evidence.laterPages.p90, laterMax: c.evidence.laterPages.max, traversalMs: c.evidence.traversalMs});
    }
    row.concurrency = r.cases.find(c => c.name === 'concurrent-mutations-invalidate-cursors')?.evidence;
    platform.history.push(row);
  }
  lines.push(`## ${api} — SQLite ${platform.sqlite ?? '?'}: ${platform.campaigns} campañas aprobadas, ${platform.controls} controles`, '');
  lines.push('| Historial | Caso | Coincid. | Págs. | 1ª pág. ms | 2ª pág. ms | Posteriores mediana / p90 / máx ms | Recorrido total ms | Ruta |', '|---|---|---:|---:|---:|---:|---:|---:|---|');
  for (const row of platform.history.sort((a, b) => a.size - b.size || a.distribution.localeCompare(b.distribution) || a.variant.localeCompare(b.variant)))
    for (const [name, c] of Object.entries(row.cases))
      lines.push(`| ${row.distribution}/${row.variant}/${row.size} | ${name} | ${c.total} | ${c.pages} | ${fmt(c.firstMs)} | ${fmt(c.secondMs)} | ${fmt(c.laterMedian)} / ${fmt(c.laterP90)} / ${fmt(c.laterMax)} | ${fmt(c.traversalMs)} | ${c.cursor} |`);
  lines.push('');
}
if (summary.failures.length) { lines.push('## Intentos no aprobados (excluidos)', ''); for (const f of summary.failures) lines.push(`- ${f.api}/${f.name}: ${f.error.replace(/\s+/g, ' ').slice(0, 200)}`); }
fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(root, 'summary.md'), lines.join('\n') + '\n');
for (const [api, p] of Object.entries(summary.platforms)) console.log(api, p.campaigns, 'campaigns', p.controls, 'controls', p.history.length, 'history');
console.log('failures', summary.failures.length);
