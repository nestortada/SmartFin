const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const workspace = path.resolve(process.argv[2]);
execFileSync(process.execPath, [path.join(__dirname, '../androidAtomicityPhase3B/prepare.js'), workspace], { stdio: 'inherit' });
fs.cpSync(path.join(workspace, 'src'), path.join(workspace, 'referenceSrc'), { recursive: true });
// Freeze the actual pre-correction repository; current src already contains the fix.
fs.copyFileSync(
  path.join(__dirname, '../../docs/performance/post3b/baseline/src__modules__creditCards__repositories__sqliteCreditCardRepository.ts.txt'),
  path.join(workspace, 'referenceSrc/modules/creditCards/repositories/sqliteCreditCardRepository.ts'),
);
for (const file of ['Profile.js', 'Fixture.js', 'Campaign.js']) fs.copyFileSync(path.join(__dirname, file), path.join(workspace, 'Post' + file));
const edit = (file, transform) => { const p = path.join(workspace, file); fs.writeFileSync(p, transform(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'))); };
const once = (source, from, to) => { if (source.split(from).length !== 2) throw new Error('Instrumentation mismatch: ' + from); return source.replace(from, to); };
edit('Harness.jsx', source => {
  source = "import { postCampaign } from './PostCampaign';\nimport { profileDatabase as profileWork } from './PostProfile';\n" + source;
  source = once(source, 'const raw = profileDatabase(opened, deterministic);', 'const raw = profileWork(profileDatabase(opened, deterministic));');
  return once(source, "  if (campaign === 'native-probe') {", "  if (campaign.startsWith('post-')) return postCampaign({ fixture: () => fixture(true), config, check, campaign });\n  if (campaign === 'native-probe') {");
});
for (const tree of ['src', 'referenceSrc']) {
  const prefix = file => {
    const relative = path.relative(path.dirname(file), 'PostProfile').replace(/\\/g, '/');
    return `import { span, timed, queueWait } from '${relative.startsWith('.') ? relative : './' + relative}';\n`;
  };
  const change = (relative, transform) => {
    const file = tree + '/' + relative;
    edit(file, source => prefix(file) + transform(source));
  };
  change('database/databaseCoordination.ts', source => {
    source = once(source, '  if (borrowed) {', '  const queuedAt = performance.now();\n  if (borrowed) {');
    return once(source, '  const execute = async () => {', '  const execute = async () => {\n    queueWait(performance.now() - queuedAt);');
  });
  change('modules/creditCards/useCases/creditCardTransactionRelations.ts', source => {
    source = once(source, 'export async function reconcileCreditCardTransactions(', 'async function rawReconcileCreditCardTransactions(');
    source += '\nexport async function reconcileCreditCardTransactions(params: ReconcileCreditCardTransactionsParams): Promise<void> { return timed("reconciliation", () => rawReconcileCreditCardTransactions(params)); }\n';
    source = once(source, '  const accountUpdates: Account[] = [];', '  const calculationStarted = performance.now();\n  const accountUpdates: Account[] = [];');
    source = once(source, '  if (accountUpdates.length > 0) {', '  span("reconciliationJs", performance.now() - calculationStarted);\n  if (accountUpdates.length > 0) {');
    source = once(source, '  const pendingTransactions = transactions.filter(', '  const filterStarted = performance.now();\n  const pendingTransactions = transactions.filter(');
    return once(source, '  if (pendingTransactions.length === 0) {', '  span("associationFilterJs", performance.now() - filterStarted);\n  if (pendingTransactions.length === 0) {');
  });
  change('modules/creditCards/useCases/manageCreditCards.ts', source => {
    source = once(source, 'export async function deleteCreditCard(', 'async function rawDeleteCreditCard(');
    source += '\nexport async function deleteCreditCard(repository: CreditCardRepository, accountId: string): Promise<void> { return timed("closureValidationAndWrite", () => rawDeleteCreditCard(repository, accountId)); }\n';
    source = once(source, '  const overview = buildCreditCardsOverview({', '  const validationStarted = performance.now();\n  const overview = buildCreditCardsOverview({');
    return once(source, '  await repository.closeCreditCardAccount(accountId);', '  span("closureValidationJs", performance.now() - validationStarted);\n  await repository.closeCreditCardAccount(accountId);');
  });
  for (const adapter of ['readUnclassifiedCreditTransactions', 'readCreditCardReconciliationTransactions']) {
    change(`modules/creditCards/repositories/${adapter}.ts`, source => {
      if (adapter === 'readUnclassifiedCreditTransactions') return once(source, '  return resultSetToRows(result).map(rowToTransaction);', '  const mappingStarted = performance.now();\n  const mapped = resultSetToRows(result).map(rowToTransaction);\n  span("unclassifiedMappingJs", performance.now() - mappingStarted);\n  return mapped;');
      source = once(source, '  return resultSetToRows(result).map(row => {', '  const mappingStarted = performance.now();\n  const mapped = resultSetToRows(result).map(row => {');
      return once(source, '  });\n}', '  });\n  span("candidateMappingJs", performance.now() - mappingStarted);\n  return mapped;\n}');
    });
  }
  change('modules/transactions/repositories/sqliteTransactionRepository.ts', source => {
    source = once(source, '    saveTransactions: async transactions => {', '    saveTransactions: async transactions => {\n      const saveStarted = performance.now();\n      try {');
    return once(source, '    deleteTransaction: async id => {', '      } finally { span("saveTransactionsTotal", performance.now() - saveStarted); }\n    },\n    deleteTransaction: async id => {').replace('      });\n    },\n      } finally', '      });\n      } finally');
  });
  // Read/map durations are synchronous spans; no query or financial formula changes.
  for (const repository of ['modules/accounts/repositories/sqliteAccountRepository.ts', 'modules/creditCards/repositories/sqliteCreditCardRepository.ts']) {
    change(repository, source => source.replace(/return resultSetToRows\(resultSet\)\.map\((\w+)\);/g,
      (_match, mapper) => `const mappingStarted = performance.now();\n      const mapped = resultSetToRows(resultSet).map(${mapper});\n      span('${mapper}Js', performance.now() - mappingStarted);\n      return mapped;`));
  }
}
// A separately labelled synthetic oracle bypasses only the old binding limit.
// It is never used for baseline performance or shipped to production.
edit('referenceSrc/modules/creditCards/repositories/sqliteCreditCardRepository.ts', source => {
  source = "export let syntheticLiteralOracle = false;\nexport function setSyntheticLiteralOracle(enabled: boolean) { syntheticLiteralOracle = enabled; }\n" + source;
  source = once(source, 'WHERE transaction_id IN (${placeholders(transactionIds)});', 'WHERE transaction_id IN (${syntheticLiteralOracle ? transactionIds.map(id => "\'" + id.replace(/\'/g, "\'\'") + "\'").join(",") : placeholders(transactionIds)});');
  return once(source, '[accountId, new Date().toISOString(), ...transactionIds],', '[accountId, new Date().toISOString(), ...(syntheticLiteralOracle ? [] : transactionIds)],');
});
edit('android/app/src/main/java/com/smartfin/AtomicityPackage.kt', source => {
  const offset = source.lastIndexOf('}');
  return source.slice(0, offset) + fs.readFileSync(path.join(__dirname, '../androidAtomicityPhase3A1/ProfilingMethods.kt'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'MemoryMethods.kt'), 'utf8') + '\n' + source.slice(offset);
});
const report = JSON.parse(fs.readFileSync(path.join(workspace, 'source-fingerprints.json'), 'utf8'));
report.testOnlyInstrumentation = true;
report.originalSourceHashes = {};
function record(folder) {
  for (const entry of fs.readdirSync(path.join(workspace, folder), { withFileTypes: true })) {
    const file = folder + '/' + entry.name;
    if (entry.isDirectory()) record(file);
    else {
      report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(workspace, file))).digest('hex');
      if (folder.startsWith('src') && fs.existsSync(file)) report.originalSourceHashes[file] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }
}
record('src'); record('referenceSrc');
for (const file of ['Harness.jsx', 'PostProfile.js', 'PostCampaign.js', 'PostFixture.js', 'android/app/src/main/java/com/smartfin/AtomicityPackage.kt']) report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(workspace, file))).digest('hex');
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), JSON.stringify(report, null, 2));
