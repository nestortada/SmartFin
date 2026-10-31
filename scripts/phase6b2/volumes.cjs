// Phase 6B.2: prints the dashboard medians (frozen pre-6B.2 → production) of the representative volumes,
// Node and Android. Usage: node scripts/phase6b2/volumes.cjs [api...]
const fs = require('node:fs'), path = require('node:path');
const docs = path.resolve(__dirname, '../../docs/correccion-fase6b2');
const ms = value => value.toFixed(2);
const line = (label, v) => console.log(label.padEnd(26), ['pesos', 'cents'].map(k => `${k} ${ms(v[k].medianMs.previous)} → ${ms(v[k].medianMs.next)}`).join(' | '));
const node = JSON.parse(fs.readFileSync(path.join(docs, 'node/results.json'), 'utf8'));
for (const [size, v] of Object.entries(node.volume ?? {})) line(`node ${size}`, v);
for (const api of process.argv.slice(2)) for (const size of ['1000', '10000', '100000']) {
  const file = path.join(docs, `android/api${api}/volume-${size}/result.json`);
  if (!fs.existsSync(file)) continue;
  const evidence = JSON.parse(fs.readFileSync(file, 'utf8')).cases.find(c => c.name === `volume-${size}`).evidence;
  line(`api${api} ${size} (${evidence.rows.n})`, evidence);
}
