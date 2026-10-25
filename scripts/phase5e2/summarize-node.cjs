// Summarizes a 5E.2 Node history benchmark JSON: min/median/max (no p95: n <= 5).
const file = process.argv[2] || 'docs/rendimiento-fase5e2/node/history-benchmark.json';
const data = require(require('node:path').resolve(file));
const groups = {};
for (const r of data.results) ((groups[[r.size, r.distribution, r.name].join('|')] ??= {})[r.version] ??= []).push(r);
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const f = x => x === undefined ? '-' : x < 10 ? x.toFixed(2) : x.toFixed(0);
const stat = (rows, key) => { const v = rows.map(x => x[key] ?? 0); return `${f(med(v))} (${f(Math.min(...v))}–${f(Math.max(...v))})`; };
console.log('| Tamaño | Distribución | Caso | 5E.1 mediana (mín–máx) ms | Sent./filas | 5E.2 mediana (mín–máx) ms | Sent./filas | Factor | Pág. 2 5E.1 / 5E.2 ms |');
console.log('|---:|---|---|---:|---:|---:|---:|---:|---:|');
for (const [key, v] of Object.entries(groups)) {
  const [size, dist, name] = key.split('|'); const a = v['5E.1'], b = v['5E.2'];
  console.log(`| ${size} | ${dist} | ${name} | ${stat(a, 'firstMs')} | ${a[0].firstStatements}/${a[0].firstRows} | ${stat(b, 'firstMs')} | ${b[0].firstStatements}/${b[0].firstRows} | ${(med(a.map(x => x.firstMs)) / med(b.map(x => x.firstMs))).toFixed(1)}× | ${f(med(a.map(x => x.secondMs ?? 0)))} / ${f(med(b.map(x => x.secondMs ?? 0)))} |`);
}
