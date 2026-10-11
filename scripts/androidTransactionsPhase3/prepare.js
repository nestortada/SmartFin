/* Reuse the phase 2 device protocol in a NEW disposable package and database. */
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const crypto = require('node:crypto');
const repository = path.resolve(__dirname, '../..');
const workspace = path.resolve(process.argv[2] || 'C:/sfphase3');
if (fs.existsSync(workspace)) throw new Error('Choose a new harness directory.');
child.execFileSync(process.execPath, [path.join(repository, 'scripts/androidDashboardPhase2/prepare.js'), workspace], { stdio: 'pipe' });
const rewrite = (relative, operation) => {
  const target = path.join(workspace, relative);
  fs.writeFileSync(target, operation(fs.readFileSync(target, 'utf8')));
};
for (const relative of ['android/app/build.gradle', 'android/app/src/main/java/com/smartfin/BenchmarkPackage.kt',
  'vendor/sqlite/platforms/android/src/main/java/org/pgsqlite/SQLitePlugin.java']) {
  rewrite(relative, source => source.replaceAll('dashboardphase2', 'transactionsphase3')
    .replaceAll('dashboard_phase2_', 'transactions_phase3_').replaceAll('phase2-results', 'phase3-results')
    .replaceAll('SFPhase2', 'SFPhase3'));
}
// The phase 2 COUNT diagnostics cannot bind LIMIT/keyset params. Omit them; all
// real query traces still record returned rows/native SQL timings.
rewrite('android/app/src/main/java/com/smartfin/BenchmarkPackage.kt', source => {
  source = source.replace('  @ReactMethod fun seed(', `  @ReactMethod fun readConfig(promise: Promise) {
    guard()
    Handler(Looper.getMainLooper()).post {
      if(context.currentActivity == null) promise.reject("CONFIG", "Activity is not attached")
      else promise.resolve(Arguments.makeNativeMap(getConstants()))
    }
  }
  @ReactMethod fun seed(`);
  const start = source.indexOf('      val db=SQLiteDatabase.openDatabase', source.indexOf('@ReactMethod fun finishSample'));
  const end = source.indexOf('      synchronized(pss)', start);
  if (start < 0 || end < 0) throw new Error('Native probe changed');
  return source.slice(0, start) + source.slice(end);
});
const baselinePath = 'src/modules/transactions/hooks/useTransactionsListBefore.ts';
fs.copyFileSync(path.join(repository, 'docs/performance/transactions-phase3/useTransactionsList.before.txt'), path.join(workspace, baselinePath));
for (const relative of [baselinePath, 'src/modules/transactions/hooks/useTransactionsList.ts']) {
  rewrite(relative, source => {
    source = source.replace('useEffect, useState', 'useLayoutEffect, useEffect, useState');
    const index = source.lastIndexOf('  return {');
    const list = relative === baselinePath ? 'filteredTransactions' : 'transactions';
    const extra = relative === baselinePath ? 'false' : 'loadingMore';
    const page = relative === baselinePath ? 'undefined' : 'loadMore: () => more.current()';
    const observer = `
  useLayoutEffect(() => {
    const observer = (globalThis as unknown as {__historyProbe?: (data: unknown) => void}).__historyProbe;
    observer?.({loading, loadingMore: ${extra}, error, transactions: ${list},
      setSearchQuery, setSelectedMonth, setSelectedAccount, setSelectedCategory, setSortOrder,
      ${page === 'undefined' ? '' : page + ','} });
  });
`;
    if (index < 0) throw new Error('Hook probe changed');
    return source.slice(0, index) + observer + source.slice(index);
  });
}
fs.writeFileSync(path.join(workspace, 'src/modules/transactions/hooks/benchmarkHook.ts'), `
import {useTransactionsList as before} from './useTransactionsListBefore';
import {useTransactionsList as after} from './useTransactionsList';
export {formatYearMonth} from './useTransactionsList';
const config=(globalThis as unknown as {__historyConfig:{version:string}}).__historyConfig;
export const useTransactionsList=config.version==='before'?before:after;
`);
rewrite('src/modules/transactions/ui/TransactionsScreen.tsx', source => source
  .replace("from '../hooks/useTransactionsList';", "from '../hooks/benchmarkHook';")
  .replace('function TransactionSeparator()', `function __historyObserve({viewableItems}: {viewableItems: {item?: {id?: string}}[]}) {
    const scope=(globalThis as unknown as {__historyViewable?: (ids:string[])=>void});
    scope.__historyViewable?.(viewableItems.flatMap(item => item.item?.id ? [item.item.id] : []));
  }
function TransactionSeparator()`)
  .replace('        onEndReached={loadMore}', '        onViewableItemsChanged={__historyObserve}\n        onEndReached={loadMore}'));
fs.copyFileSync(path.join(__dirname, 'BenchmarkApp.jsx'), path.join(workspace, 'BenchmarkApp.jsx'));
const files = ['src/modules/transactions/hooks/useTransactionsList.ts', 'src/modules/transactions/ui/TransactionsScreen.tsx',
  'src/modules/transactions/repositories/sqliteTransactionHistory.ts', 'src/modules/transactions/repositories/sqliteTransactionRepository.ts',
  'docs/performance/transactions-phase3/useTransactionsList.before.txt'];
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), JSON.stringify({ repository, workspace,
  fingerprints: Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repository, file))).digest('hex')])) }, null, 2));
console.log(JSON.stringify({ workspace, applicationId: 'com.smartfin.transactionsphase3.bench' }));
