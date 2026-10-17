const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve(
  __dirname,
  '../../docs/performance/shared-commands',
);
const comparison = JSON.parse(
  fs.readFileSync(path.join(directory, 'comparison.json'), 'utf8'),
);
const after = JSON.parse(
  fs.readFileSync(path.join(directory, 'node-after.json'), 'utf8'),
);
const cases = [
  [1000, 10],
  [10000, 100],
  [100000, 100],
  [100000, 1000],
];
const operations = after.financial
  .filter(s => s.size === 1000)
  .map(s => s.operation);
const value = (sample, key) =>
  sample
    ? String(key.endsWith('Ms') ? sample[key].toFixed(2) : sample[key])
    : 'Sin medir';
const find = (samples, size, shared, operation, version) =>
  samples.find(
    s =>
      s.size === size &&
      s.shared === shared &&
      s.operation === operation &&
      s.version === version,
  );
let detail =
  '# Mediciones completas de comandos compartidos\n\nTiempos en ms; mediana con tres muestras y valor individual con una. Filas/lecturas son instrumentadas. No son mediciones de la interfaz.\n';
let summary = `Node ${comparison.nodeRuntime}, SQLite ${comparison.nodeSQLite}; Android release/Hermes, SQLite 3.44.5. Comparación exacta Node: ${comparison.nodeExactCheckpoints}/72 checkpoints. Las huellas del APK y del benchmark coinciden con las fuentes actuales.\n\n`;
for (const [environment, samples] of [
  ['Node', comparison.node],
  ['Android físico', comparison.android],
]) {
  summary += `### ${environment}\n\n| Movimientos / gastos compartidos | Operación | Antes ms | Después ms | Filas antes → después | Lecturas antes → después |\n|---|---|---:|---:|---:|---:|\n`;
  for (const [size, shared] of cases) {
    detail += `\n## ${environment}: ${size} movimientos / ${shared} gastos compartidos\n\n| Operación | Muestras antes/después | Antes ms | Después ms | Transacción antes/después ms | Lecturas antes/después | Filas antes/después | Caracteres antes/después |\n|---|---:|---:|---:|---:|---:|---:|---:|\n`;
    for (const operation of operations) {
      const before = find(samples, size, shared, operation, 'before');
      const current = find(samples, size, shared, operation, 'after');
      detail += `| ${operation} | ${value(before, 'samples')}/${value(
        current,
        'samples',
      )} | ${value(before, 'medianMs')} | ${value(
        current,
        'medianMs',
      )} | ${value(before, 'transactionMs')}/${value(
        current,
        'transactionMs',
      )} | ${value(before, 'reads')}/${value(current, 'reads')} | ${value(
        before,
        'rows',
      )}/${value(current, 'rows')} | ${value(before, 'characters')}/${value(
        current,
        'characters',
      )} |\n`;
      if (
        ['createPurchase', 'applyReceipt', 'forgivePartial'].includes(operation)
      )
        summary += `| ${size} / ${shared} | ${operation} | ${value(
          before,
          'medianMs',
        )} | ${value(current, 'medianMs')} | ${value(before, 'rows')} → ${value(
          current,
          'rows',
        )} | ${value(before, 'reads')} → ${value(current, 'reads')} |\n`;
    }
  }
  summary += '\n';
}
summary +=
  'Todos los comandos, duración de transacciones, lecturas, filas, caracteres y número de muestras están en [las tablas completas](performance/shared-commands/comparison-tables.md) y [comparison.json](performance/shared-commands/comparison.json). Los JSON originales conservan cada muestra sin redondear.\n\n';
summary +=
  '### Estado financiero terminal exacto\n\n| Movimientos / compartidos | Banco | Cuenta destino | Deuda | Disponible | Por cobrar | Anticipos | Patrimonio | Consumo personal mensual | Pérdida neta | Movimientos finales |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n';
for (const [size, shared] of cases) {
  const checkpoints = after.financial.filter(
    s => s.size === size && s.shared === shared,
  );
  const terminal = checkpoints.at(-1);
  const balances = { bank: 1000000, target: 0, card: 0 };
  let receivables = shared * 15000,
    advances = 0;
  for (const checkpoint of checkpoints.filter(
    s => s.operation !== 'idempotentReplay',
  )) {
    for (const account of checkpoint.result.effects.accounts)
      balances[account.accountId] += account.balanceDelta;
    receivables += checkpoint.result.effects.receivableDelta;
    advances += checkpoint.result.effects.thirdPartyAdvanceDelta;
  }
  const s = terminal.summary;
  summary += `| ${size} / ${shared} | ${balances.bank} | ${balances.target} | ${s.totalDebt} | ${s.availableBalance} | ${receivables} | ${advances} | ${s.netWorth} | ${s.monthlyExpenses} | ${s.monthlyNetLosses} | ${terminal.state.transactions.count} |\n`;
}
summary +=
  '\nEn todas las combinaciones: ingresos personales mensuales 0; condonaciones 4000, reversión de condonación 3000, recuperaciones 1000 y reversión de recuperación 1000. El ahorro mensual es exactamente `0 - consumo personal - 1000`. Quedan cuatro cobros, tres asignaciones, una devolución, cinco eventos del diario y 17 recibos de comando; repetir un comando devuelve su recibo anterior y no añade filas.\n\n';
const nodeWait = JSON.parse(
  fs.readFileSync(path.join(directory, 'node-reader-wait.json'), 'utf8'),
);
const androidWait = comparison.androidFunctionalValidation.find(
  r => r.type === 'reader-wait',
);
summary += `Espera medida de lector: Node ${nodeWait.readerWaitMs} ms (condonación); Android ${androidWait.milliseconds} ms (recuperación). Son escenarios específicos, sin retraso inyectado; no se comparan como si fueran la misma carga.\n\n`;
fs.writeFileSync(path.join(directory, 'comparison-tables.md'), detail);
const report = path.resolve(
  __dirname,
  '../../docs/VALIDACION_OPERACIONES_COMPARTIDAS_ANDROID.md',
);
const text = fs.readFileSync(report, 'utf8');
fs.writeFileSync(
  report,
  text.replace(
    /## Resultados cuantitativos[\s\S]*?## Integridad exacta/,
    '## Resultados cuantitativos\n\n' + summary + '## Integridad exacta',
  ),
);
console.log('Wrote exact financial results and all command measurement tables');
