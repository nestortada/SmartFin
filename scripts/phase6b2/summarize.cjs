// Phase 6B.2: prints a 6B.2 result file as a table (Node results or an Android probes evidence).
// Usage: node scripts/phase6b2/summarize.cjs <file> [previous|next]
const fs = require('node:fs');
const [file, side = 'next'] = process.argv.slice(2);
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
const FIELDS = ['availableBalance', 'totalDebt', 'netWorth'];
const show = (name, e) => {
  for (const f of FIELDS) {
    const x = e.figures[f];
    console.log(name.padEnd(30), f.padEnd(17), x[side].padEnd(24), x.expected.padEnd(18), x[`${side}Display`].padEnd(14), x.expectedDisplay.padEnd(14),
      x[`${side}EqualsOracle`] ? 'ok' : 'MISMATCH', e.databaseUnchanged ? '' : 'DB-CHANGED', e.bitIdentical === undefined ? '' : `bitIdentical=${e.bitIdentical}`);
  }
};
for (const p of ['aggregateBalances', 'debtAggregate', 'netWorthMixed', 'sharedPosition', 'zeroThroughAggregation']) show(p, r.probes[p]);
for (const group of ['smallAmounts', 'outOfContract'])
  for (const [k, v] of Object.entries(r.probes[group])) if (v && v.figures) show(`${group}.${k}`, v);
console.log(JSON.stringify(r.probes.economicSequence.counts));
for (const s of r.probes.economicSequence.steps)
  console.log(s.name.padEnd(20), s.netWorthDelta.padEnd(12), s.ruleHolds,
    FIELDS.map(f => `${s.figures[f][side]}${s.figures[f][`${side}EqualsOracle`] ? '' : '*'}`).join(' | '), 'inc', s.monthlyIncome[side], 'loss', s.monthlyNetLosses[side]);
console.log('intl', JSON.stringify(r.intl));
if (r.sweeps) console.log('sweeps', JSON.stringify(r.sweeps));
for (const [k, v] of Object.entries(r.volume ?? {})) console.log('volume', k, JSON.stringify(v));
if (r.screens) console.log('screens', JSON.stringify(r.screens));
