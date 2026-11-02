'use strict';
// Prepares an independent React Native visual-test workspace.
// Deliberately DOES NOT build, install, launch, or run any Android command.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const source = path.resolve(__dirname, '../..');
const targetArg = process.argv[2];
if (!targetArg || !path.isAbsolute(targetArg))
  throw new Error('Provide a NEW absolute path outside SmartFin as the only argument.');
const target = path.resolve(targetArg);
const normalize = value => path.normalize(value).toLowerCase();
if (normalize(target) === normalize(source) ||
    normalize(target).startsWith(normalize(source) + path.sep.toLowerCase()))
  throw new Error('Refusing to prepare inside the production repository.');
if (fs.existsSync(target))
  throw new Error('The target exists. Never overwrite an existing workspace.');
if (!fs.existsSync(path.join(source, 'node_modules')))
  throw new Error('Install existing project dependencies before preparing; no automatic npm install.');
if (!process.env.ANDROID_HOME || !path.isAbsolute(process.env.ANDROID_HOME))
  throw new Error('ANDROID_HOME must point to an existing absolute Android SDK location.');
if (!fs.existsSync(process.env.ANDROID_HOME))
  throw new Error('ANDROID_HOME location does not exist.');

const packageId = 'com.smartfin.visualtests';
const dbName = 'smartfin_visual_synthetic.db';
const manifestPath = 'android/app/src/main/AndroidManifest.xml';
const gradlePath = 'android/app/build.gradle';
const schemaPath = 'src/database/sqliteSchema.ts';
const appPath = 'src/app/App.tsx';
const sourceFiles = [
  'App.tsx','index.js','app.json','package.json','babel.config.js',
  'metro.config.js','react-native.config.js','tsconfig.json','src','android',
];
const optionalFiles = ['assets'];
const excludedDirs = new Set(['build','.gradle','.cxx','.idea','.git']);
function copyRelative(relative) {
  const from = path.join(source, relative);
  if (!fs.existsSync(from)) throw new Error('Required source missing: ' + relative);
  const to = path.join(target, relative);
  fs.cpSync(from, to, {
    recursive: true,
    filter: candidate => !path.relative(from, candidate).split(path.sep)
      .some(part => excludedDirs.has(part)),
  });
}
function replaceFile(relative, transform) {
  const file = path.join(target, relative);
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error('Safety-critical transform was not applied: ' + relative);
  fs.writeFileSync(file, after);
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function walk(root) {
  return fs.readdirSync(root, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
// Fail closed on source-layout drift before making the target.
for (const relative of [gradlePath,manifestPath,schemaPath,appPath,'index.js']) {
  if (!fs.existsSync(path.join(source,relative)))
    throw new Error('Required source missing: '+relative);
}
const srcGradle=fs.readFileSync(path.join(source,gradlePath),'utf8');
const srcSchema=fs.readFileSync(path.join(source,schemaPath),'utf8');
const srcApp=fs.readFileSync(path.join(source,appPath),'utf8');
if ((srcGradle.match(/applicationId\s+"com\.smartfin"/g)||[]).length!==1)
  throw new Error('Unexpected production applicationId; inspect before proceeding.');
if (!srcSchema.includes("SMARTFIN_DATABASE_NAME = 'smartfin.db'"))
  throw new Error('Production DB constant changed; inspect before proceeding.');
if (!srcApp.includes('void runSubscriptionMaintenance().catch(() => undefined);'))
  throw new Error('App startup maintenance changed; inspect before proceeding.');

fs.mkdirSync(target, {recursive: false});
for (const relative of sourceFiles) copyRelative(relative);
for (const relative of optionalFiles)
  if (fs.existsSync(path.join(source, relative))) copyRelative(relative);
fs.symlinkSync(path.join(source,'node_modules'), path.join(target,'node_modules'),'junction');
fs.writeFileSync(path.join(target,'.env'),'# Synthetic visual test environment; intentionally no secrets\n');
replaceFile(gradlePath, content =>
  content.replace(/applicationId\s+"com\.smartfin"/, 'applicationId "'+packageId+'"'));
replaceFile(schemaPath, content =>
  content.replace("SMARTFIN_DATABASE_NAME = 'smartfin.db'",
    "SMARTFIN_DATABASE_NAME = '"+dbName+"'"));
// Real UI, but no automatic subscription maintenance on visual-test startup.
replaceFile(appPath, content =>
  content.replace('void runSubscriptionMaintenance().catch(() => undefined);',
    '// Disabled only in isolated visual-test copy; never in production.'));
replaceFile(manifestPath, content => {
  let next=content.replace('android:label="@string/app_name"', 'android:label="SmartFin Visual Synthetic"');
  next=next.replace(/\s*<receiver android:name="\.SmartFinSubscriptionReminderReceiver"[^>]*\/>/,'');
  next=next.replace(/\s*<receiver android:name="\.SmartFinSubscriptionRecoveryReceiver"[\s\S]*?<\/receiver>/,'');
  next=next.replace(/\s*<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"\s*\/>/,'');
  if (next.includes('SmartFinSubscriptionRecoveryReceiver') ||
      next.includes('SmartFinSubscriptionReminderReceiver'))
    throw new Error('Receiver isolation incomplete.');
  return next;
});
// Android native components own the SQLite file independently from React Native.
const nativeRoot=path.join(target,'android/app/src/main');
let nativeDbNames=0;
for(const file of walk(nativeRoot).filter(f=>/\.(kt|java)$/.test(f))) {
  const before=fs.readFileSync(file,'utf8');
  const after=before.replace(/(["'])smartfin\.db\1/g, (_,quote)=>{nativeDbNames++;return quote+dbName+quote;});
  if(before!==after) fs.writeFileSync(file,after);
}
if(!nativeDbNames) throw new Error('Expected native database references were not found.');
const sourceBootstrap=path.join(source,'scripts/maestro-visual/VisualBootstrap.jsx');
fs.copyFileSync(sourceBootstrap,path.join(target,'VisualBootstrap.jsx'));
fs.writeFileSync(path.join(target,'index.js'),
  "import {AppRegistry} from 'react-native';\n"+
  "import VisualBootstrap from './VisualBootstrap';\n"+
  "import {name as appName} from './app.json';\n"+
  "AppRegistry.registerComponent(appName,()=>VisualBootstrap);\n");
const sdk=process.env.ANDROID_HOME.replace(/\\/g,'/');
fs.writeFileSync(path.join(target,'android/local.properties'),'sdk.dir='+sdk+'\n');
const audit={
  source, target, packageId, dbName, nativeDbNames,
  noProductionBackupImported: true,
  noAutomaticSubscriptionMaintenance: true,
  noAutomaticFinancialCampaigns: true,
  buildsOrInstallationsPerformed: false,
  files: Object.fromEntries([
    gradlePath,schemaPath,appPath,manifestPath,'index.js','VisualBootstrap.jsx',
  ].map(relative=>[relative,sha256(path.join(target,relative))])),
};
fs.writeFileSync(path.join(target,'visual-isolation-audit.json'),JSON.stringify(audit,null,2)+'\n');
console.log('Prepared '+target+' ('+packageId+').');
console.log('Preparation ONLY; build/install must follow the existing audited security boundary.');
