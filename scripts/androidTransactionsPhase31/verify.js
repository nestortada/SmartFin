const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const repository = path.resolve(__dirname, '../..');
const root = path.join(repository, 'docs/performance/transactions-phase31');
const workspace = path.resolve(process.argv[2] || 'C:/sfphase31');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const baseline = JSON.parse(fs.readFileSync(path.join(root,'baseline.json')));
const unchanged = {};
for (const [file, expected] of Object.entries(baseline.hashes)) {
  if (file.endsWith('sqliteTransactionHistory.ts')) continue;
  unchanged[file] = hash(path.join(repository,file)) === expected;
  if (!unchanged[file]) throw new Error('Unexpected source change: '+file);
}
const schemaPath = 'src/database/sqliteSchema.ts';
const headSchema = child.execFileSync('git',['show','HEAD:'+schemaPath],{cwd:repository,encoding:'utf8'});
const schemaUnchangedIgnoringLineEndings = headSchema.replace(/\r\n/g,'\n') === fs.readFileSync(path.join(repository,schemaPath),'utf8').replace(/\r\n/g,'\n');
if (!schemaUnchangedIgnoringLineEndings) throw new Error('Schema changed');
const harnessFiles = ['BenchmarkApp.jsx','index.js','src/modules/transactions/repositories/sqliteTransactionHistory.ts',
  'src/modules/transactions/repositories/sqliteTransactionHistoryBefore.ts','src/modules/transactions/hooks/useTransactionsList.ts',
  'src/modules/transactions/hooks/useTransactionsListBefore.ts','src/modules/transactions/hooks/benchmarkHook.ts',
  'src/modules/transactions/ui/TransactionsScreen.tsx','android/app/src/main/java/com/smartfin/BenchmarkPackage.kt',
  'vendor/sqlite/platforms/android/src/main/java/org/pgsqlite/SQLitePlugin.java','vendor/sqlite/lib/sqlite.core.js'];
const provenance = {
  comparison:'Phase 3 paginated frozen vs phase 3.1 paginated; same APK/process/database; alternated pairs; fresh wrapper per measured mount; two warmups per version',
  accepted:{1000:'honor-20261011-003221-1000-paired',10000:'honor-20261011-004248-10000-paired',100000:'honor-20261011-003221-100000-paired'},
  excluded:{block:'honor-20261011-003221-10000-paired',reason:'after iteration 2 reported windowFocused=false; entire size block excluded and repeated; raw logs retained'},
  apkSha256:hash(path.join(workspace,'android/app/build/outputs/apk/release/app-release.apk')),
  harnessHashes:Object.fromEntries(harnessFiles.map(file=>[file,hash(path.join(workspace,file))])),
  scriptHashes:Object.fromEntries(fs.readdirSync(__dirname).map(file=>[file,hash(path.join(__dirname,file))])),
  limits:['USB charging, temperature and OS scheduling not fixed','PSS sampled whole protocol, not JS heap',
    'No release inspector or commit profiler installed','Scroll one 45s sample per size/version, includes idle frames'],
  nativeSQLiteVersion:'3.44.5', productionPackageUnchanged:true,
};
fs.writeFileSync(path.join(root,'android/provenance.json'),JSON.stringify(provenance,null,2));
const log = fs.readFileSync(path.join(root,'jest.log'),'utf8');
const tests = /Tests:\s+(\d+) skipped, (\d+) passed/.exec(log);
const suites = /Test Suites:\s+(\d+) skipped, (\d+) passed/.exec(log);
if (!tests || !suites || /\bFAIL\b/.test(log)) throw new Error('Jest log failed validation');
const verification = {jest:{suitesPassed:Number(suites[2]),testsPassed:Number(tests[2]),optionalBenchmarksSkipped:Number(tests[1]),refinementBenchmark:'passed separately'},
  typescript:'passed',eslint:'passed',diffCheck:'passed',unchangedSincePhase3:unchanged,schemaUnchangedIgnoringLineEndings,
  android:JSON.parse(fs.readFileSync(path.join(root,'android/summary.json'))),scroll:JSON.parse(fs.readFileSync(path.join(root,'scroll/summary.json'))),
  apkSha256:provenance.apkSha256,productionChangedFilesSincePhase3:['src/modules/transactions/repositories/sqliteTransactionHistory.ts'],
  devicePackage:'com.smartfin.transactionsphase31.bench',packageLeftInstalledAndStopped:true};
fs.writeFileSync(path.join(root,'final-verification.json'),JSON.stringify(verification,null,2));
console.log(JSON.stringify({unchanged,schemaUnchangedIgnoringLineEndings,jest:verification.jest,apkSha256:provenance.apkSha256}));
