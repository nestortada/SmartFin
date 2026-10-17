const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {execFileSync}=require('node:child_process');
const workspace=path.resolve(process.argv[2]);
execFileSync(process.execPath,[path.join(__dirname,'../androidAtomicityPhase3A/prepare.js'),workspace],{stdio:'inherit'});
const reference='baseline/phase3ACreditCardRelations.ts';fs.mkdirSync(path.join(workspace,'baseline'),{recursive:true});fs.writeFileSync(path.join(workspace,reference),fs.readFileSync(path.resolve('__tests__/helpers/phase3ACreditCardRelations.ts'),'utf8').replaceAll("'../../src/","'../src/"));
for(const file of ['SqlProfile.js','ReconciliationFixture.js','ReconciliationCampaign.js'])fs.copyFileSync(path.join(__dirname,file),path.join(workspace,file));
const transform=(file,edit)=>{const p=path.join(workspace,file);let source=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');source=edit(source);fs.writeFileSync(p,source);};
const once=(source,from,to)=>{if(source.split(from).length!==2)throw new Error('Instrumentation target mismatch: '+from);return source.replace(from,to);};
transform('Harness.jsx',source=>{
 source="import { reconciliationCampaign } from './ReconciliationCampaign';\nimport { profileDatabase, wallClockNow } from './SqlProfile';\n"+source;
 source=once(source,'async function fixture() {','async function fixture(deterministic = false) {');
 source=once(source,'${Date.now()}_${sequence++}','${wallClockNow()}_${sequence++}');
 const reopenAt=source.indexOf('async function reopen(');
 source=once(source.slice(0,reopenAt),'const raw = await openConfirmedSQLiteConnection({','const opened = await openConfirmedSQLiteConnection({')+source.slice(reopenAt);
 source=once(source,'  for (const sql of SQLITE_SCHEMA_STATEMENTS)','  const raw = profileDatabase(opened, deterministic);\n  for (const sql of SQLITE_SCHEMA_STATEMENTS)');
 return once(source,"  if (campaign === 'native-probe') {","  if (campaign === 'phase3a1') return reconciliationCampaign({ fixture, config, check });\n  if (campaign === 'native-probe') {");
});
for(const file of ['src/modules/creditCards/useCases/creditCardTransactionRelations.ts',reference])transform(file,source=>{
 const rel=path.relative(path.dirname(file),'SqlProfile').replace(/\\/g,'/');
 source=`import { span } from '${rel.startsWith('.')?rel:'./'+rel}';\n`+source;
 source=once(source,'  const accountUpdates: Account[] = [];','  const calculationStarted = performance.now();\n  const accountUpdates: Account[] = [];');
 return once(source,'  if (accountUpdates.length > 0) {',"  span('financialCalculation', performance.now() - calculationStarted);\n  if (accountUpdates.length > 0) {");
});
transform('src/modules/transactions/repositories/sqliteTransactionRepository.ts',source=>{
 source="import { span } from '../../../../SqlProfile';\n"+source;
 return once(source,'return resultSetToRows(resultSet).map(rowToTransaction);',"const mapStarted = performance.now();\n      const mapped = resultSetToRows(resultSet).map(rowToTransaction);\n      span('fullTransactionMapping', performance.now() - mapStarted);\n      return mapped;");
});
transform('src/modules/creditCards/repositories/readCreditCardReconciliationTransactions.ts',source=>{
 source="import { span } from '../../../../SqlProfile';\n"+source;
 source=once(source,'  return resultSetToRows(result).map(row => {','  const mapStarted = performance.now();\n  const mapped = resultSetToRows(result).map(row => {');
 return once(source,'  });\n}',"  });\n  span('candidateMapping', performance.now() - mapStarted);\n  return mapped;\n}");
});
transform('android/app/src/main/java/com/smartfin/AtomicityPackage.kt',source=>{const offset=source.lastIndexOf('}');return source.slice(0,offset)+fs.readFileSync(path.join(__dirname,'ProfilingMethods.kt'),'utf8')+'\n'+source.slice(offset);});
const reportPath=path.join(workspace,'source-fingerprints.json');const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));report.testOnlyInstrumentation=true;report.originalHashes={};
for(const file of ['Harness.jsx','SqlProfile.js','ReconciliationCampaign.js','ReconciliationFixture.js',reference,'src/modules/creditCards/useCases/creditCardTransactionRelations.ts','src/modules/creditCards/repositories/readCreditCardReconciliationTransactions.ts','src/modules/transactions/repositories/sqliteTransactionRepository.ts','android/app/src/main/java/com/smartfin/AtomicityPackage.kt']){
 report.hashes[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(workspace,file))).digest('hex');
 if(fs.existsSync(path.resolve(file)))report.originalHashes[file]=crypto.createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex');
}
report.referenceOriginalHash=crypto.createHash('sha256').update(fs.readFileSync(path.resolve('__tests__/helpers/phase3ACreditCardRelations.ts'))).digest('hex');
fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
