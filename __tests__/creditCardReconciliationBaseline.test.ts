import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { registerCreditCardPayment } from './helpers/phase3ACreditCardRelations';
import { rowToTransaction } from '../src/modules/transactions/repositories/sqliteTransactionRepository';
import { resultSetToRows } from '../src/database/sqliteRows';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
const { performance: monotonic } = require('node:perf_hooks') as { performance: { now: () => number } };
test('phase 3A.1: frozen reference baseline', async () => {
  const results = [];
  for (const rows of [1000,10000,100000]) {
    const f = await financialIntegrityFixture({ managed:true });
    try {
      await f.save({ accountId:'card', operationType:'Crédito' });
      f.native.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<${rows})
        INSERT INTO transactions(id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at)
        SELECT 'noise-'||n,1,'COP','Synthetic','2026-01-10T12:00:00.000Z','bank','expense','outflow','posted','2026-01-10','2026-01-10' FROM seq`);
      const start=monotonic.now(); const [r]=await f.database.executeSql('SELECT * FROM transactions ORDER BY date DESC, created_at DESC;'); const readMs=monotonic.now()-start;
      const mapStart=monotonic.now(); const transactions=resultSetToRows(r).map(rowToTransaction); const mapMs=monotonic.now()-mapStart;
      const [plan]=await f.database.executeSql('EXPLAIN QUERY PLAN SELECT * FROM transactions ORDER BY date DESC, created_at DESC;');
      f.resetTrace(); const paymentStart=monotonic.now();
      const payment=registerCreditCardPayment({...f,accountId:'card',sourceAccountId:'bank',amount:100000,currentDate:FINANCIAL_TEST_DATE});
      const readerStart=monotonic.now(); const reader=f.accountRepository.getAccounts(); await payment; const paymentMs=monotonic.now()-paymentStart; await reader; const readerMs=monotonic.now()-readerStart;
      results.push({ rows, readMs, transferredRows:transactions.length, mapMs, paymentMs, readerMs, plan:plan.rows.raw() });
    } finally { f.native.close(); }
  }
  const fs=require('node:fs') as {writeFileSync:(path:string,value:string)=>void; existsSync:(path:string)=>boolean};
  const report='docs/atomicidad-fase3a1/baseline/node-baseline.json';
  if (!fs.existsSync(report)) fs.writeFileSync(report,JSON.stringify(results,null,2));
},60000);
