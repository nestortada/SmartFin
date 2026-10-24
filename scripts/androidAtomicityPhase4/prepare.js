const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const workspace = path.resolve(process.argv[2]);
execFileSync(process.execPath, [path.join(__dirname, '../androidAtomicityPhase3B/prepare.js'), workspace], { stdio: 'inherit' });
fs.copyFileSync(path.join(__dirname, 'AiSubscriptionCampaign.js'), path.join(workspace, 'AiSubscriptionCampaign.js'));
fs.copyFileSync(path.resolve('__tests__/helpers/phase4ExecuteAiCommandPlan.ts'), path.join(workspace, 'baseline/phase4ExecuteAiCommandPlan.ts'));
const baselinePath = path.join(workspace, 'baseline/phase4ExecuteAiCommandPlan.ts');
fs.writeFileSync(baselinePath, fs.readFileSync(baselinePath, 'utf8').replaceAll("'../../src/", "'../src/"));
// Test-only dependency injection. Never calls the production singleton/file name.
const runtimePath = path.join(workspace, 'src/modules/subscriptions/services/subscriptionRuntime.ts');
fs.writeFileSync(runtimePath, fs.readFileSync(runtimePath, 'utf8').replace("from '../../../database/sqliteDatabase'", "from '../../../database/phase4RuntimeDatabase'"));
fs.writeFileSync(path.join(workspace, 'src/database/phase4RuntimeDatabase.ts'), `
import type { SmartFinSQLiteDatabase } from './sqliteDatabase';
let synthetic: SmartFinSQLiteDatabase | undefined;
export function setSyntheticRuntimeDatabase(database: SmartFinSQLiteDatabase) { synthetic = database; }
export async function openSmartFinDatabase() { if (!synthetic) throw new Error('Synthetic DB not selected'); return synthetic; }
`);
const harnessPath = path.join(workspace, 'Harness.jsx');
let harness = fs.readFileSync(harnessPath, 'utf8');
harness = "import { aiSubscriptionCampaign } from './AiSubscriptionCampaign';\n" + harness;
// Callback-driver fault injection for local subscription mutations. No async callback.
harness = harness.replace("      if (key === 'executeSql')", `      if (key === 'transaction') return async callback => target.transaction(tx => {
        let guarded;
        guarded = new Proxy(tx, { get(t, k) {
          if (k === 'executeSql') return (sql, values, success, failure) => {
            trace.push(sql);
            const hit = fault && sql.includes(fault.sql) && --fault.remaining === 0;
            const current = hit ? fault : undefined;
            if (hit) fault = undefined;
            if (current?.phase === 'before') return t.executeSql('SELECT * FROM phase4_injected_failure');
            return t.executeSql(sql, values, (_tx, result) => {
              if (current?.phase === 'after') t.executeSql('SELECT * FROM phase4_injected_failure');
              else success?.(guarded, result);
            }, failure);
          };
          const value = Reflect.get(t, k); return typeof value === 'function' ? value.bind(t) : value;
        } });
        callback(guarded);
      });
      if (key === 'executeSql')`);
harness = harness.replace("  if (campaign === 'native-probe') {", "  if (campaign === 'phase4') return aiSubscriptionCampaign({ fixture: () => fixture(true), reopen, config, check });\n  if (campaign === 'native-probe') {");
harness = harness.replace("import { aiSubscriptionCampaign }", "import { aiSubscriptionCampaign, receiptRestartCampaign }");
harness = harness.replace("const campaign = launch?.split('/').pop() || 'core';", "const campaign = (launch?.split('/').pop() || 'core').split('?')[0];");
harness = harness.replace("  if (campaign === 'native-probe') {", "  if (campaign.startsWith('phase4-restart-')) return receiptRestartCampaign({ fixture: () => fixture(true), reopen, config, check, campaign, launch });\n  if (campaign === 'native-probe') {");
fs.writeFileSync(harnessPath, harness);
const reportPath = path.join(workspace, 'source-fingerprints.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const files = ['Harness.jsx', 'AiSubscriptionCampaign.js', 'baseline/phase4ExecuteAiCommandPlan.ts',
  'src/database/phase4RuntimeDatabase.ts', 'src/shared/utils/stableJson.ts',
  'src/modules/transactions/useCases/executeAiCommandPlan.ts',
  'src/modules/transactions/repositories/aiCommandReceipt.ts', 'src/modules/transactions/repositories/sqliteAiDraftRepository.ts',
  'src/modules/transactions/hooks/useAiAssistantController.ts',
  'src/modules/subscriptions/services/subscriptionRuntime.ts', 'src/modules/subscriptions/useCases/createSubscriptionApi.ts',
  'src/modules/subscriptions/useCases/createSubscriptionInCommand.ts', 'src/modules/subscriptions/hooks/useSubscriptionsController.ts',
  'src/modules/subscriptions/repositories/sqliteSubscriptionRepository.ts', 'src/modules/subscriptions/useCases/subscriptionLifecycle.ts'];
for (const file of files) {
  report.hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(workspace, file))).digest('hex');
  if (fs.existsSync(path.resolve(file))) report.originalHashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex');
}
report.phase4RuntimeInjection = 'Only copied runtime opens the explicitly selected synthetic fixture; original source hash recorded separately.';
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
execFileSync(process.execPath, [path.join(__dirname, 'refresh.js'), workspace], { stdio: 'inherit' });
