const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root=path.resolve(__dirname,'../..'), workspace=path.resolve(process.argv[2] || 'C:/sf-5b3-20261023');
execFileSync(process.execPath,[path.join(root,'scripts/phase5b2Acceptance/prepare.cjs'),workspace],{stdio:'inherit'});
const record=JSON.parse(fs.readFileSync(path.join(workspace,'source-fingerprints.json'),'utf8'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function write(file,text,reason) {
  fs.writeFileSync(path.join(workspace,file),text);
  record.hashes[file]=hash(text); record.adaptations[file]=reason;
}
const native='android/app/src/main/java/com/smartfin/';
const baselineSource='scripts/phase5b3/SmartFinBackupCsvBaseline.kt';
const original=fs.readFileSync(path.join(root,baselineSource),'utf8');
record.originalHashes[baselineSource]=hash(original);
const loop='while (cursor.moveToNext()) writer.appendLine((0 until cursor.columnCount).joinToString(",") { csvEscape(cursorValue(cursor, it)) })';
const replacement=`val row = StringBuilder(512)
          val columns = cursor.columnCount
          while (cursor.moveToNext()) {
            row.setLength(0)
            for (column in 0 until columns) {
              if (column > 0) row.append(',')
              row.append(csvEscape(cursorValue(cursor, column)))
            }
            writer.appendLine(row)
          }`;
if(!original.includes(loop)) throw Error('Diagnostic baseline changed; inspect candidate');
write(native+'CsvBaseline.kt',original.replace('object SmartFinBackupCsv','object CsvBaseline'),'Exact baseline CSV queries/writer, object renamed for paired diagnostics');
write(native+'CsvCandidate.kt',original.replace('object SmartFinBackupCsv','object CsvCandidate').replace(loop,replacement),'Diagnostic only: reuse row buffer, cache columnCount; exact SQL/escaping unchanged');
for(const name of ['CsvDiagnostics.kt','UIHarness.jsx']) {
  const source='scripts/phase5b3/'+name, bytes=fs.readFileSync(path.join(root,source),'utf8');
  record.originalHashes[source]=hash(bytes);
  write(name.endsWith('.kt')?native+name:name,bytes,'Isolated diagnostic/UI harness');
}
const control=native+'Phase5B2Package.kt';
write(control,fs.readFileSync(path.join(workspace,control),'utf8').replace('  @ReactMethod fun inspect(',`  @ReactMethod fun csvBenchmark(id: String, promise: Promise) = run(promise) { CsvDiagnostics.run(context, id).toString() }
  @ReactMethod fun inspect(`),'Adds test-only paired export benchmark');
let harness=fs.readFileSync(path.join(workspace,'Harness.jsx'),'utf8');
harness=harness.replace('async function run(campaign) {',`async function run(campaign) {
  if(campaign === 'ui-prepare') { await seed(); await control.configureSaf(); await record('synthetic-ui-ready', async()=>config); return; }
  if(campaign === 'csv-diagnostic') {
    await record('paired-csv-diagnostic', async()=>{ const captured=await captureLocalDatabaseSnapshot(); return JSON.parse(await control.csvBenchmark(captured.snapshot.id)); }); return;
  }`);
write('Harness.jsx',harness,'Adds fixture initialization and paired native CSV diagnostic');
const flag='src/modules/settings/services/backupPublicationPolicy.ts';
write(flag,fs.readFileSync(path.join(workspace,flag),'utf8').replace('= false','= true'),'USER AUTHORIZED: enables UI only in isolated synthetic APK');
write('index.js',fs.readFileSync(path.join(workspace,'index.js'),'utf8').replace("import Harness from './Harness';","import Harness from './UIHarness';"),'Routes test UI URLs to production navigator and test campaigns to instrument');
const encoded=JSON.stringify(record,null,2);
fs.writeFileSync(path.join(workspace,'source-fingerprints.json'),encoded);
fs.writeFileSync(path.join(workspace,'android/app/src/main/assets/phase5b2-source-fingerprints.json'),encoded);
console.log(workspace);
