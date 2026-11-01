// 6B.3: compact view of a probes JSON (Node or Android): each step's result, debt, bank, net worth,
// statement and closure. Usage: node scripts/phase6b3/summarize.cjs <file.json>
const fs = require('node:fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const line = (name, run) => {
  if (!run || typeof run !== 'object') return;
  if (run.steps) {
    console.log(`${name}: purchases ${run.purchases.join(' + ')}; initial debt ${run.initial.debt} (${run.initial.display.debt}), bank ${run.initial.bank}, netWorth ${run.initial.netWorth}`);
    for (const step of run.steps) {
      const outcome = step.rejected ? `REJECTED «${step.rejected}»` : `paid ${step.paid}, remaining ${step.remainingDebt}`;
      const a = step.after;
      console.log(`  ${step.label}: ${outcome} -> debt ${a.debt} (${a.display.debt}), bank ${a.bank}, netWorth ${a.netWorth}, expenses ${a.monthlyExpenses}, statement ${a.statement ? `${a.statement.total_amount}/${a.statement.status}` : '-'}, oracle ${step.oracle.ok}`);
    }
    console.log(`  closure: ${run.closure}; sqlite ${run.sqlite.integrity}/${run.sqlite.foreignKeyViolations}`);
  } else if (run.result) {
    const outcome = run.result.rejected ? `REJECTED «${run.result.rejected}»` : `paid ${run.result.paid}, remaining ${run.result.remainingDebt}`;
    console.log(`${name}: ${outcome} -> debt ${run.after.debt}, bank ${run.after.bank}, statement ${run.after.statement?.total_amount}/${run.after.statement?.status}, oracle ${run.oracle.ok}; closure: ${run.closure}`);
  } else for (const [key, value] of Object.entries(run)) line(`${name}.${key}`, value);
};

for (const [name, run] of Object.entries(data.probes ?? data)) line(name, run);
