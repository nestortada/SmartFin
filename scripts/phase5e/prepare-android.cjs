const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const workspace = path.resolve(process.argv[2] || 'C:/sf-5e-20261024');
execFileSync(process.execPath, [path.join(root, 'scripts/phase5d/prepare-android.cjs'), workspace], { stdio: 'inherit' });
const record = JSON.parse(fs.readFileSync(path.join(workspace, 'source-fingerprints.json'), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function write(file, value, reason) {
  fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
  fs.writeFileSync(path.join(workspace, file), value);
  record.hashes[file] = hash(value); record.adaptations[file] = reason;
}
for (const [from, to] of [['integration.ts', 'scripts/phase5e/integration.ts'], ['androidHarness.js', 'integratedHarness.js']]) {
  const original = 'scripts/phase5e/' + from;
  const source = fs.readFileSync(path.join(root, original), 'utf8');
  record.originalHashes[original] = hash(source);
  write(to, source, 'Synthetic integrated acceptance; real financial use cases');
}
const native = 'android/app/src/main/java/com/smartfin/';
// 5D copied the current deletion object after 5C hooks; add those fault hooks again,
// always on the current production source with only the synthetic DB name changed.
let file = native + 'SmartFinFinancialDeletion.kt';
let source = fs.readFileSync(path.join(root, file), 'utf8').replaceAll('"smartfin.db"', '"phase5b2_synthetic.db"')
  .replace('val resource = array.getString(index)', 'val resource = array.getString(index); Phase5B2Probe.hit("cleanup.before:" + key)')
  .replace('write(context, id) { remove(it, key, resource) }', 'Phase5B2Probe.hit("cleanup.after:" + key); write(context, id) { remove(it, key, resource) }')
  .replace('write(context, id) { it.put("phase", "completed") }', 'Phase5B2Probe.hit("cleanup.beforeCompleted"); write(context, id) { it.put("phase", "completed") }')
  .replaceAll('return JSONObject().put("status", "completed").put("id", id)', 'Phase5B2Probe.hit("cleanup.response"); return JSONObject().put("status", "completed").put("id", id)');
write(file, source, 'Synthetic DB and fault hooks around cleanup, without protocol changes');
file = native + 'Phase5B2Package.kt';
source = fs.readFileSync(path.join(workspace, file), 'utf8').replace('  @ReactMethod fun inspect(', `
  @ReactMethod fun historyCompatibility(promise: Promise) = run(promise) {
    SmartFinSubscriptionRemindersModule.withDatabase(context) { db ->
      val result=JSONObject()
      db.rawQuery("SELECT sqlite_version()",null).use {it.moveToFirst();result.put("sqlite",it.getString(0))}
      db.rawQuery("SELECT sql FROM sqlite_master WHERE name='idx_transactions_civil_sort'",null).use {it.moveToFirst();result.put("indexDdl",it.getString(0))}
      val expression="COALESCE(civil_date || 'T' || COALESCE(local_time, '00:00') || ':00.000Z', date)"
      val original="SELECT $expression AS date FROM transactions INDEXED BY idx_transactions_civil_sort WHERE 1 = 1 LIMIT 1"
      val distinct="SELECT DISTINCT $expression AS date FROM transactions INDEXED BY idx_transactions_civil_sort WHERE 1 = 1 LIMIT -1"
      val variants=listOf("original" to original,"withoutHint" to original.replace(" INDEXED BY idx_transactions_civil_sort",""),
        "orderedProbe" to original.replace(" LIMIT 1"," ORDER BY $expression LIMIT 1"),
        "distinctOriginal" to distinct,"distinctWithoutHint" to distinct.replace(" INDEXED BY idx_transactions_civil_sort",""))
      for((name,sql) in variants) {
        val value=JSONObject().put("sql",sql)
        try {db.rawQuery(sql,null).use {value.put("rows",it.count).put("status","passed")}}
        catch(e:Exception){value.put("status","failed").put("error",e.toString())}
        result.put(name,value)
      }
      result.toString()
    } ?: error("Synthetic database unavailable")
  }
  @ReactMethod fun liveEvidence(promise: Promise) = run(promise) {
    SmartFinDatabaseCoordinator.withParticipant { permit ->
      SmartFinSubscriptionRemindersModule.withDatabase(context, permit) { db ->
        val result = SmartFinLocalSnapshot.describe(db)
        val tables = JSONObject()
        db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",null).use { names ->
          while(names.moveToNext()) {
            val name=names.getString(0); check(name.matches(Regex("[a-zA-Z0-9_]+")))
            val digest=java.security.MessageDigest.getInstance("SHA-256")
            db.rawQuery("SELECT * FROM "+name+" ORDER BY rowid",null).use { rows ->
              while(rows.moveToNext()) for(i in 0 until rows.columnCount) {
                val value=if(rows.isNull(i)) "null:" else rows.getString(i).let { it.length.toString()+":"+it }
                digest.update(value.toByteArray(Charsets.UTF_8))
              }
              tables.put(name,JSONObject().put("count",rows.count).put("columns",JSONArray(rows.columnNames.toList()))
                .put("sha256",digest.digest().joinToString(""){"%02x".format(it)}))
            }
          }
        }; result.put("allTables",tables).toString()
      }
    }
  }
  @ReactMethod fun inspect(`);
write(file, source, 'Instrumented streaming full-table/column fingerprints for large synthetic campaigns');
if (process.argv.includes('--financial-contender')) {
  const target = 'reminderHarness.js';
  let contender = fs.readFileSync(path.join(workspace, target), 'utf8');
  contender = `import {registerCreditCardPayment} from './src/modules/creditCards/useCases/creditCardTransactionRelations';
import {createSqliteAccountRepository} from './src/modules/accounts/repositories/sqliteAccountRepository';
import {createSqliteTransactionRepository} from './src/modules/transactions/repositories/sqliteTransactionRepository';
import {createSqliteCreditCardRepository} from './src/modules/creditCards/repositories/sqliteCreditCardRepository';\n` + contender;
  const previous = `await reset();await control.arm('receiver.active',false);`;
  if (!contender.includes(previous)) throw Error('Receiver barrier source changed');
  contender = contender.replace(previous, `await reset();const financialBefore=await snapshot();await control.arm('receiver.active',false);`);
  const readOnly = `const writer=owned(db=>db.executeSql("SELECT revision FROM subscription_reminders WHERE id='subscription-reminder:r'")).then(()=>{completed=true;});`;
  if (!contender.includes(readOnly)) throw Error('Contender source changed');
  contender = contender.replace(readOnly, `const writer=openSmartFinDatabase().then(db=>registerCreditCardPayment({
      accountRepository:createSqliteAccountRepository(db),transactionRepository:createSqliteTransactionRepository(db),
      creditCardRepository:createSqliteCreditCardRepository(db),accountId:'card',sourceAccountId:'bank',amount:1,currentDate:new Date()
    })).then(value=>{completed=true;return value;});`);
  const end = `await control.resume();const result=JSON.parse(await effect);await writer;check(completed,'Gate was not released');return result;`;
  if (!contender.includes(end)) throw Error('Contender assertion source changed');
  contender = contender.replace(end, `await control.resume();const result=JSON.parse(await effect);const payment=await writer;check(completed,'Gate was not released');
    const financialAfter=await snapshot();
    const account=(state,id)=>state.accounts.find(a=>a.id===id);
    check(account(financialAfter,'bank').balance_amount===account(financialBefore,'bank').balance_amount-1,'Payment did not debit exactly one peso');
    check(account(financialAfter,'card').debt_balance_amount===account(financialBefore,'card').debt_balance_amount-1,'Payment did not reduce exactly one peso debt');
    check(financialAfter.transactions.length===financialBefore.transactions.length+1,'Payment movement count');
    check(financialAfter.transactions.filter(t=>t.type==='expense').length===financialBefore.transactions.filter(t=>t.type==='expense').length,'Concurrent payment created second expense');
    return {native:result,payment,financialBefore,financialAfter};`);
  write(target, contender, 'Supplemental acceptance: replace read-only contender by a real one-peso card payment, preserving actual receiver and gate');
}
file = 'Harness.jsx'; source = fs.readFileSync(path.join(workspace, file), 'utf8');
source = "import {runIntegrated} from './integratedHarness';\n" + source.replace('async function run(campaign) {', `async function run(campaign) {
  if(campaign.startsWith('phase5e-')) { await runIntegrated(campaign,{owned,record,control,backup}); return; }`);
source = source.replace('async function record(name, operation) {', "async function record(name, operation) {\n  console.log('ACCEPTANCE_START:' + name);")
  .replace('cases.push({ name, passed: true, evidence });', "cases.push({ name, passed: true, evidence }); console.log('ACCEPTANCE_END:' + name);");
source = source.replace('await control.report(JSON.stringify(report));', `try { await control.report(JSON.stringify(report)); }
      catch (error) { await control.report(JSON.stringify({config,campaign,passed:false,failure:'Harness report serialization: '+String(error),cases:cases.map(c=>({name:c.name,passed:c.passed}))})); }`);
write(file, source, '5E integrated dispatcher; prior native regressions retained');
const encoded = JSON.stringify(record, null, 2);
fs.writeFileSync(path.join(workspace, 'source-fingerprints.json'), encoded);
fs.writeFileSync(path.join(workspace, 'android/app/src/main/assets/phase5b2-source-fingerprints.json'), encoded);
console.log(workspace);
