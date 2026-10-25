// Summarizes 5E.2 Android campaign reports into Markdown. Reports min/median/max
// and n per version; never p95 (n <= 4). Warmups are excluded from statistics.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2] || 'docs/rendimiento-fase5e2/android');
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const f = x => x === undefined || Number.isNaN(x) ? '-' : x < 10 ? x.toFixed(2) : x.toFixed(0);
const stat = v => v.length ? `${f(med(v))} (${f(Math.min(...v))}–${f(Math.max(...v))}) n=${v.length}` : '-';
const out = [];
for (const api of ['api24', 'api35']) {
  const dir = path.join(root, api);
  if (!fs.existsSync(dir)) continue;
  out.push(`\n## ${api.toUpperCase()}\n`);
  const runs = fs.readdirSync(dir).filter(d => fs.existsSync(path.join(dir, d, 'result.json')) && !d.startsWith('smoke'));
  const failed = fs.readdirSync(dir).filter(d => fs.existsSync(path.join(dir, d, 'runner-error.txt')));
  if (failed.length) out.push(`Campañas con error del runner: ${failed.join(', ')}\n`);
  const conditions = [];
  out.push('| Campaña | Caso | 5E.1 ms mediana (mín–máx) | Sent./filas | 5E.2 ms mediana (mín–máx) | Sent./filas | Cursor 5E.1→5E.2 | Pág. 2 5E.1 / 5E.2 ms | Heap Hermes Δ 5E.1 / 5E.2 KB |');
  out.push('|---|---|---:|---:|---:|---:|---|---:|---:|');
  const dashboards = [], traversals = [], probes = [], decompositions = [];
  for (const run of runs.sort()) {
    const report = JSON.parse(fs.readFileSync(path.join(dir, run, 'result.json'), 'utf8'));
    const cond = path.join(dir, run, 'device-conditions.json');
    if (fs.existsSync(cond)) conditions.push({ run, entries: JSON.parse(fs.readFileSync(cond, 'utf8')) });
    for (const c of report.cases) {
      if (c.name.endsWith('-samples') && c.evidence?.samples?.[0]?.firstMs !== undefined) {
        const s = c.evidence.samples.filter(x => !x.warmup);
        const a = s.filter(x => x.version === '5E.1'), b = s.filter(x => x.version === '5E.2');
        const kind = v => [...new Set(v.map(x => x.cursorKind))].join('/');
        const kb = v => { const d = v.map(x => x.heapAllocatedDelta).filter(x => typeof x === 'number'); return d.length ? f(med(d) / 1024) : '-'; };
        out.push(`| ${run} | ${c.name.split('-').slice(2, -1).join('-')} | ${stat(a.map(x => x.firstMs))} | ${a[0] ? `${a[0].firstStatements}/${a[0].firstRows}` : '-'} | ${stat(b.map(x => x.firstMs))} | ${b[0] ? `${b[0].firstStatements}/${b[0].firstRows}` : '-'} | ${kind(a)}→${kind(b)} | ${f(med(a.map(x => x.secondMs ?? 0)))} / ${f(med(b.map(x => x.secondMs ?? 0)))} | ${kb(a)} / ${kb(b)} |`);
      }
      if (c.name.endsWith('-exact-traversal')) {
        const t = c.evidence?.complete !== undefined && typeof c.evidence.complete === 'object' ? c.evidence : { single: c.evidence };
        traversals.push(`| ${run} | ${c.name.split('-').slice(2, -2).join('-')} | ${c.passed ? 'sí' : 'NO'} | ${JSON.stringify(t)} |`);
      }
      if (c.name.startsWith('order-')) probes.push(`| ${run} | ${c.name.slice(6)} | ${c.evidence?.listingExact} | ${c.evidence?.pagedExact} | ${c.evidence?.pagedRows}/${c.evidence?.distinctPaged}/${c.evidence?.expectedRows} | ${(c.evidence?.plan ?? []).join('; ').slice(0, 90)} |`);
      if (c.name.startsWith('dashboard-') && c.evidence?.samples) dashboards.push({ run, evidence: c.evidence });
      if (c.name.endsWith('-decomposition')) decompositions.push({ run, rows: c.evidence });
      if (c.name.startsWith('integrated-performance-')) dashboards.push({ run, integrated: c.name, times: c.evidence.times, outcome: c.evidence.historyOutcome });
      if (!c.passed) out.push(`\n**FALLO** ${run} ${c.name}: ${c.error}\n`);
    }
    if (!report.passed) out.push(`\n**Campaña fallida** ${run}: ${report.failure}\n`);
  }
  if (probes.length) out.push('\n| Sonda | Variante | Listado exacto | Páginas exactas | Filas/distintas/esperadas | Plan |\n|---|---|---|---|---|---|\n' + probes.join('\n'));
  if (traversals.length) out.push('\n| Campaña | Caso | 5E.2 = oráculo | Detalle (5E.1 coincide = frozenAgrees) |\n|---|---|---|---|\n' + traversals.join('\n'));
  if (dashboards.length) {
    out.push('\n| Dashboard | Versión | Frío ms | Caliente mediana (mín–máx) | Igualdad exacta actual/baseline |');
    out.push('|---|---|---:|---:|---|');
    for (const d of dashboards) {
      if (d.integrated) { out.push(`| ${d.integrated} | integrado 5E | - | historial ${f(d.times.historyPageMs)} ms; dashboard ${f(d.times.dashboardMs)} ms | ${d.outcome?.status ?? '-'} |`); continue; }
      for (const version of ['current', 'baseline']) {
        const v = d.evidence.samples.filter(x => x.version === version);
        const cold = v.find(x => x.sample === 'cold');
        const warm = v.filter(x => typeof x.sample === 'number').map(x => x.totalMs);
        out.push(`| ${d.run} | ${version} | ${cold ? f(cold.totalMs) : '-'} | ${stat(warm)} | ${d.evidence.exactEqual ? 'sí' : 'NO: ' + JSON.stringify(d.evidence.differences)} |`);
      }
    }
  }
  if (decompositions.length) {
    const steps = ['accounts', 'monthlyAmounts', 'recentDayCounts', 'sharedPosition', 'lossPeriod'];
    out.push('\n| Dashboard (lecturas secuenciales) | ' + steps.map(x => x + ' ms (filas)').join(' | ') + ' | Suma JS ms |');
    out.push('|---|' + steps.map(() => '---:').join('|') + '|---:|');
    for (const d of decompositions) out.push(`| ${d.run} | ${steps.map(x => `${f(med(d.rows.map(r => r[x].ms)))} (${d.rows[0][x].rows})`).join(' | ')} | ${f(med(d.rows.map(r => r.jsSumMs)))} |`);
  }
  const states = new Set(), levels = [], temps = [];
  for (const c of conditions) for (const e of c.entries) {
    for (const p of e.power ?? []) if (p.startsWith('mWakefulness=')) states.add(p);
    for (const b of e.battery ?? []) { if (b.startsWith('level:')) levels.push(Number(b.split(':')[1])); if (b.startsWith('temperature:')) temps.push(Number(b.split(':')[1]) / 10); }
  }
  out.push(`\nCondiciones observadas (${conditions.reduce((n, c) => n + c.entries.length, 0)} lecturas): ${[...states].join(', ')}; batería ${Math.min(...levels)}–${Math.max(...levels)} %; temperatura batería ${Math.min(...temps)}–${Math.max(...temps)} °C.`);
  const asleep = conditions.filter(c => c.entries.some(e => (e.power ?? []).some(p => p.startsWith('mWakefulness=') && !p.endsWith('Awake'))));
  if (asleep.length) out.push(`Campañas con lectura distinta de Awake: ${asleep.map(c => c.run).join(', ')}.`);
}
const text = out.join('\n') + '\n';
fs.writeFileSync(path.join(root, 'summary.md'), text);
console.log(text);
