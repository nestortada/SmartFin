/* Phase 3 and 3.1 coexist only in this disposable release harness. */
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const crypto = require('node:crypto');
const repository = path.resolve(__dirname, '../..');
const workspace = path.resolve(process.argv[2] || 'C:/sfphase31');
child.execFileSync(process.execPath, [path.join(repository, 'scripts/androidTransactionsPhase3/prepare.js'), workspace], { stdio: 'pipe' });
const rewrite = (relative, operation) => {
  const file = path.join(workspace, relative);
  fs.writeFileSync(file, operation(fs.readFileSync(file, 'utf8')));
};
for (const relative of ['android/app/build.gradle', 'android/app/src/main/java/com/smartfin/BenchmarkPackage.kt',
  'vendor/sqlite/platforms/android/src/main/java/org/pgsqlite/SQLitePlugin.java']) rewrite(relative, s => s
    .replaceAll('transactionsphase3', 'transactionsphase31').replaceAll('transactions_phase3_', 'transactions_phase31_')
    .replaceAll('phase3-results', 'phase31-results'));
const snapshots = 'docs/performance/transactions-phase31/';
for (const [file, target] of [
  ['sqliteTransactionRepository.ts', 'src/modules/transactions/repositories/sqliteTransactionRepositoryBefore.ts'],
  ['sqliteTransactionHistory.ts', 'src/modules/transactions/repositories/sqliteTransactionHistoryBefore.ts'],
  ['useTransactionsList.ts', 'src/modules/transactions/hooks/useTransactionsListBefore.ts'],
]) fs.copyFileSync(path.join(repository, snapshots + file + '.before.txt'), path.join(workspace, target));
rewrite('src/modules/transactions/repositories/sqliteTransactionRepositoryBefore.ts', s => s.replace("from './sqliteTransactionHistory'", "from './sqliteTransactionHistoryBefore'"));
rewrite('src/modules/transactions/hooks/useTransactionsListBefore.ts', s => s
  .replace("from '../repositories/sqliteTransactionHistory'", "from '../repositories/sqliteTransactionHistoryBefore'")
  .replace("from '../repositories/sqliteTransactionRepository'", "from '../repositories/sqliteTransactionRepositoryBefore'")
  .replace('useEffect, useState', 'useLayoutEffect, useEffect, useState')
  .replace('  return { transactions,', `  useLayoutEffect(() => {
    (globalThis as unknown as {__historyProbe?: (value: unknown) => void}).__historyProbe?.({loading, loadingMore, error, transactions,
      setSearchQuery, setSelectedMonth, setSelectedAccount, setSelectedCategory, setSortOrder, loadMore: () => more.current()});
  });
  return { transactions,`));
fs.writeFileSync(path.join(workspace, 'src/modules/transactions/hooks/benchmarkHook.ts'), `
import {useTransactionsList as useBefore} from './useTransactionsListBefore';
import {useTransactionsList as useAfter} from './useTransactionsList';
export {formatYearMonth} from './useTransactionsList';
export function useTransactionsList(...args: Parameters<typeof useAfter>) {
  const config=(globalThis as unknown as {__historyConfig:{version:string}}).__historyConfig;
  return config.version === 'before' || config.version === 'scrollBefore' ? useBefore(...args) : useAfter(...args);
}
`);
// Synchronous stage timings are diagnostic boundaries, not a React profiler.
const probe = `const __historyStage = (name: string, ms: number) =>
  (globalThis as unknown as {__historyStage?: (name: string, ms: number) => void}).__historyStage?.(name, ms);\n`;
for (const suffix of ['', 'Before']) {
  rewrite(`src/modules/transactions/repositories/sqliteTransactionRepository${suffix}.ts`, s => {
    const start = s.indexOf('export function rowToTransaction(');
    const end = s.indexOf('export function createSqliteTransactionRepository(', start);
    let method = s.slice(start, end).replace('  return {', '  const started = performance.now();\n  try {\n  return {');
    method = method.replace(/\n}\s*$/, "\n  } finally { __historyStage('map', performance.now() - started); }\n}\n\n");
    return s.slice(0, start) + probe + method + s.slice(end);
  });
  rewrite(`src/modules/transactions/repositories/sqliteTransactionHistory${suffix}.ts`, s => {
    const start = s.indexOf('function matchesSearch('); const end = s.indexOf('function filters(', start);
    let method = s.slice(start, end).replace('  if (!search.trim())', '  const started = performance.now();\n  try {\n  if (!search.trim())');
    method = method.replace(/\n}\s*$/, "\n  } finally { __historyStage('searchPredicate', performance.now() - started); }\n}\n\n");
    return s.slice(0, start) + probe + method + s.slice(end);
  });
  rewrite(`src/modules/transactions/hooks/useTransactionsList${suffix}.ts`, s => s
    .replace('          const seen = new Set', '          const appendStarted = performance.now();\n          const seen = new Set')
    .replace('          cursor = page.nextCursor;', "          (globalThis as unknown as {__historyStage?: (name:string, ms:number) => void}).__historyStage?.('append', performance.now() - appendStarted);\n          cursor = page.nextCursor;"));
}
rewrite('src/modules/transactions/ui/TransactionsScreen.tsx', s => s
  .replace('  const transactionSections =', '  const groupingStarted = performance.now();\n  const transactionSections =')
  .replace('  const themeColors =', "  (globalThis as unknown as {__historyStage?: (name:string, ms:number) => void}).__historyStage?.('grouping', performance.now() - groupingStarted);\n  const themeColors ="));
fs.copyFileSync(path.join(__dirname, 'BenchmarkApp.jsx'), path.join(workspace, 'BenchmarkApp.jsx'));
const files = ['src/modules/transactions/repositories/sqliteTransactionHistory.ts',
  'src/modules/transactions/repositories/sqliteTransactionRepository.ts', 'src/modules/transactions/hooks/useTransactionsList.ts',
  'src/modules/transactions/ui/TransactionsScreen.tsx', ...['sqliteTransactionHistory.ts','sqliteTransactionRepository.ts','useTransactionsList.ts','TransactionsScreen.tsx'].map(f => snapshots + f + '.before.txt')];
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), JSON.stringify({ repository, workspace,
  fingerprints: Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repository, file))).digest('hex')])) }, null, 2));
console.log(JSON.stringify({ workspace, applicationId: 'com.smartfin.transactionsphase31.bench' }));
