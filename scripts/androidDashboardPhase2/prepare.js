/* Isolated release harness. Never changes production files or installs an APK. */
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const crypto = require('node:crypto');

const repository = path.resolve(__dirname, '../..');
const workspace = path.resolve(process.argv[2] || 'C:/sfphase2');
if (fs.existsSync(workspace))
  throw new Error('Choose a new, empty harness directory.');
if (workspace === repository || workspace.startsWith(repository + path.sep))
  throw new Error('Harness must be outside production.');
fs.mkdirSync(workspace, { recursive: true });
const copy = (from, to) =>
  fs.cpSync(path.join(repository, from), path.join(workspace, to || from), {
    recursive: true,
    filter: candidate =>
      !candidate
        .split(path.sep)
        .some(part => ['build', '.gradle', '.cxx'].includes(part)),
  });
for (const file of [
  'package.json',
  'babel.config.js',
  'metro.config.js',
  'react-native.config.js',
  'tsconfig.json',
])
  copy(file);
copy('src');
copy('android');
// Build outputs may reference the primary checkout. Exclude them from the copy.
for (const relative of [
  'android/.gradle',
  'android/build',
  'android/app/build',
  'android/app/.cxx',
]) {
  const target = path.join(workspace, relative);
  if (!target.startsWith(workspace + path.sep))
    throw new Error('Invalid cleanup target');
  fs.rmSync(target, { recursive: true, force: true });
}
fs.symlinkSync(
  path.join(repository, 'node_modules'),
  path.join(workspace, 'node_modules'),
  'junction',
);
fs.writeFileSync(
  path.join(workspace, '.env'),
  '# Synthetic harness: no production environment values\n',
);
const vendor = path.join(workspace, 'vendor/sqlite');
fs.cpSync(
  path.join(repository, 'node_modules/react-native-sqlite-storage'),
  vendor,
  {
    recursive: true,
    filter: candidate => !candidate.split(path.sep).includes('build'),
  },
);
fs.writeFileSync(
  path.join(workspace, 'metro.config.js'),
  `
const {getDefaultConfig,mergeConfig}=require('@react-native/metro-config');
const path=require('node:path');
module.exports=mergeConfig(getDefaultConfig(__dirname),{
watchFolders:[${JSON.stringify(repository)}],
resolver:{resolveRequest(context,name,platform){
if(name==='react-native-sqlite-storage') return {type:'sourceFile',filePath:path.join(__dirname,'vendor/sqlite/sqlite.js')};
return context.resolveRequest(context,name,platform);
}}});\n`,
);
let settings = fs.readFileSync(
  path.join(workspace, 'android/settings.gradle'),
  'utf8',
);
settings +=
  "\nproject(':react-native-sqlite-storage').projectDir = new File(rootProject.projectDir, '../vendor/sqlite/platforms/android')\n";
fs.writeFileSync(path.join(workspace, 'android/settings.gradle'), settings);
let gradle = fs.readFileSync(
  path.join(workspace, 'android/app/build.gradle'),
  'utf8',
);
gradle = gradle.replace(
  'applicationId "com.smartfin"',
  'applicationId "com.smartfin.dashboardphase2.bench"',
);
if (!gradle.includes('applicationId "com.smartfin.dashboardphase2.bench"'))
  throw new Error('Package isolation failed');
fs.writeFileSync(path.join(workspace, 'android/app/build.gradle'), gradle);
fs.writeFileSync(
  path.join(workspace, 'android/local.properties'),
  `sdk.dir=${process.env.ANDROID_HOME.replace(/\\/g, '/')}\n`,
);
const nativeDir = path.join(
  workspace,
  'android/app/src/main/java/com/smartfin',
);
// Only the copied harness native tree is replaced. No production receivers/jobs.
fs.rmSync(nativeDir, { recursive: true, force: true });
fs.mkdirSync(nativeDir, { recursive: true });
fs.writeFileSync(
  path.join(nativeDir, 'MainApplication.kt'),
  `package com.smartfin
import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
class MainApplication: Application(), ReactApplication {
override val reactHost: ReactHost by lazy { getDefaultReactHost(context=applicationContext,packageList=PackageList(this).packages.apply {add(BenchmarkPackage())}) }
override fun onCreate(){ super.onCreate(); loadReactNative(this) }
}\n`,
);
copy('android/app/src/main/java/com/smartfin/MainActivity.kt');
const activityPath = path.join(nativeDir, 'MainActivity.kt');
let activitySource = fs.readFileSync(activityPath, 'utf8');
activitySource = activitySource.replace(
  'class MainActivity : ReactActivity() {',
  `class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }`,
);
fs.writeFileSync(activityPath, activitySource);
fs.copyFileSync(
  path.join(__dirname, 'BenchmarkPackage.kt'),
  path.join(nativeDir, 'BenchmarkPackage.kt'),
);
fs.writeFileSync(
  path.join(workspace, 'android/app/src/main/AndroidManifest.xml'),
  `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
<uses-permission android:name="android.permission.INTERNET"/>
<application android:name="com.smartfin.MainApplication" android:label="SmartFin Phase 2 Synthetic" android:allowBackup="false" android:theme="@style/AppTheme">
<profileable android:shell="true"/>
<activity android:name="com.smartfin.MainActivity" android:exported="true" android:configChanges="keyboard|keyboardHidden|orientation|screenLayout|screenSize|smallestScreenSize|uiMode">
<intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>
</activity></application></manifest>\n`,
);
fs.copyFileSync(
  path.join(__dirname, 'BenchmarkApp.jsx'),
  path.join(workspace, 'BenchmarkApp.jsx'),
);
fs.writeFileSync(
  path.join(workspace, 'index.js'),
  "import {AppRegistry} from 'react-native';import BenchmarkApp from './BenchmarkApp';AppRegistry.registerComponent('SmartFin',()=>BenchmarkApp);\n",
);
const baseline = child.execFileSync(
  'git',
  [
    'show',
    'a9dd112859e51c099905d1806f992c2628b7b41c:src/modules/dashboard/useCases/getDashboardSummary.ts',
  ],
  { cwd: repository, encoding: 'utf8' },
);
fs.writeFileSync(
  path.join(
    workspace,
    'src/modules/dashboard/useCases/getDashboardSummaryBaseline.ts',
  ),
  baseline,
);
// Timers wrap unchanged synchronous expressions only in the disposable source copy.
const timer = `\nfunction __measure<T>(kind: 'computeMs' | 'mappingMs', operation: () => T): T {
const clock=(globalThis as unknown as {performance:{now:()=>number}}).performance;
const started=clock.now();const value=operation();
const trace=(globalThis as unknown as {__phase2Trace?: {active:boolean;computeMs:number;mappingMs:number}}).__phase2Trace;
if(trace?.active) trace[kind]+=clock.now()-started;
return value;
}\n`;
for (const [file, functionName] of [
  [
    'src/modules/dashboard/useCases/getDashboardSummaryBaseline.ts',
    'computeSummary',
  ],
  ['src/modules/dashboard/useCases/getDashboardSummary.ts', 'buildSummary'],
]) {
  const target = path.join(workspace, file);
  let source = fs.readFileSync(target, 'utf8');
  source = source.replace(
    `function ${functionName}(`,
    `function ${functionName}Unmeasured(`,
  );
  source +=
    timer +
    `\nfunction ${functionName}(...args: Parameters<typeof ${functionName}Unmeasured>): ReturnType<typeof ${functionName}Unmeasured> {return __measure('computeMs',()=>${functionName}Unmeasured(...args));}\n`;
  if (functionName === 'buildSummary')
    source = source.replace(
      /const recentTransactionCount = recentDayCounts([\s\S]*?)\.reduce\((.*?)\);/,
      "const recentTransactionCount = __measure('computeMs', () => recentDayCounts$1.reduce($2));",
    );
  fs.writeFileSync(target, source);
}
for (const file of [
  'src/modules/transactions/repositories/sqliteTransactionRepository.ts',
  'src/modules/accounts/repositories/sqliteAccountRepository.ts',
]) {
  const target = path.join(workspace, file);
  let source = fs.readFileSync(target, 'utf8');
  source = source.replace(
    /return (resultSetToRows\(resultSet\)\.map\(rowTo\w+\));/g,
    "return __measure('mappingMs', () => $1);",
  );
  source = source.replace(
    /return (resultSetToRows\(resultSet\)\.map\(row => \(\{[\s\S]*?\}\)\));/g,
    "return __measure('mappingMs', () => $1);",
  );
  fs.writeFileSync(target, source + timer);
}
// Reuse production screen and hook. The copied hook chooses the reference/optimized
// reader and signals layout completion; the production UI remains untouched.
const hook = path.join(
  workspace,
  'src/modules/dashboard/hooks/useDashboardSummary.ts',
);
let hookSource = fs
  .readFileSync(hook, 'utf8')
  .replace(
    "from '../useCases/getDashboardSummary';",
    "from '../useCases/benchmarkSummary';",
  );
hookSource = hookSource.replace(
  'useEffect, useState',
  'useEffect, useState, useLayoutEffect',
);
hookSource = hookSource.replace(
  '  return { summary, loading, error };',
  `
  useLayoutEffect(() => {
    const probe=(globalThis as unknown as {__phase2Layout?: (loading:boolean,summary:DashboardSummary,error:string|undefined)=>void}).__phase2Layout;
    probe?.(loading,summary,error);
  }, [summary, loading, error]);
  return { summary, loading, error };`,
);
fs.writeFileSync(hook, hookSource);
fs.writeFileSync(
  path.join(workspace, 'src/modules/dashboard/useCases/benchmarkSummary.ts'),
  `
import {getEmptyDashboardSummary,getDashboardSummaryFromDb as after} from './getDashboardSummary';
import {getDashboardSummaryFromDb as before} from './getDashboardSummaryBaseline';
import type {SmartFinSQLiteDatabase} from '../../../database/sqliteDatabase';
export {getEmptyDashboardSummary};
export async function getDashboardSummaryFromDb(database:SmartFinSQLiteDatabase){
const scope=(globalThis as unknown as {__phase2Config: {version:string; date:string};__phase2InitialResolved?:boolean;__phase2Trace?: {resolved:boolean;dataReadyMs:number;started:number}});
const currentDate=new Date(scope.__phase2Config.date);
const result=await (scope.__phase2Config.version==='before'?before:after)(database,currentDate);
if(scope.__phase2Trace){scope.__phase2Trace.resolved=true;scope.__phase2Trace.dataReadyMs=(globalThis as unknown as {performance:{now:()=>number}}).performance.now()-scope.__phase2Trace.started;}
else {scope.__phase2InitialResolved=true;}
return result;
}\n`,
);
// Instrument the copied SQLite plugin: cursor execution versus native row encoding.
const javaFile = path.join(
  vendor,
  'platforms/android/src/main/java/org/pgsqlite/SQLitePlugin.java',
);
let java = fs.readFileSync(javaFile, 'utf8');
const start = java.indexOf('    private WritableMap executeSqlStatementQuery(');
const end = java.indexOf('    @SuppressLint("NewApi")', start);
let method = java.slice(start, end);
method = method.replace(
  'WritableMap rowsResult = Arguments.createMap();',
  'long benchStarted=System.nanoTime();\n        WritableMap rowsResult = Arguments.createMap();',
);
method = method.replace(
  'cur = mydb.rawQuery(query, params);',
  'long benchRawStart=System.nanoTime();\n                cur = new BenchCursor(mydb.rawQuery(query, params), System.nanoTime()-benchRawStart);',
);
method = method.replace(
  '        return rowsResult;',
  `        if(mydb.getPath().contains("dashboard_phase2_")) {
            rowsResult.putDouble("__nativeQueryMs",(System.nanoTime()-benchStarted)/1000000.0);
            rowsResult.putDouble("__sqlCursorMs",cur instanceof BenchCursor ? ((BenchCursor)cur).sqlNs/1000000.0 : 0);
        }
        return rowsResult;`,
);
java =
  java.slice(0, start) +
  method +
  `
    private static class BenchCursor extends android.database.CursorWrapper {
        long sqlNs;
        BenchCursor(Cursor cursor,long initial){super(cursor);sqlNs=initial;}
        @Override public boolean moveToFirst(){long t=System.nanoTime();boolean value=super.moveToFirst();sqlNs+=System.nanoTime()-t;return value;}
        @Override public boolean moveToNext(){long t=System.nanoTime();boolean value=super.moveToNext();sqlNs+=System.nanoTime()-t;return value;}
    }
` +
  java.slice(end);
fs.writeFileSync(javaFile, java);
const sqliteJs = path.join(vendor, 'lib/sqlite.core.js');
let sqliteSource = fs.readFileSync(sqliteJs, 'utf8');
sqliteSource = sqliteSource.replace(
  'rowsAffected: response.rowsAffected || 0,',
  '__nativeQueryMs: response.__nativeQueryMs || 0,\n    __sqlCursorMs: response.__sqlCursorMs || 0,\n    rowsAffected: response.rowsAffected || 0,',
);
fs.writeFileSync(sqliteJs, sqliteSource);
const fingerprints = {};
for (const file of [
  'src/modules/dashboard/useCases/getDashboardSummary.ts',
  'src/modules/transactions/repositories/sqliteTransactionRepository.ts',
  'src/modules/dashboard/ui/DashboardScreen.tsx',
  'src/modules/dashboard/hooks/useDashboardSummary.ts',
]) {
  fingerprints[file] = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(repository, file)))
    .digest('hex');
}
fs.writeFileSync(
  path.join(workspace, 'source-fingerprints.json'),
  JSON.stringify(
    {
      repository,
      workspace,
      baselineRevision: 'a9dd112859e51c099905d1806f992c2628b7b41c',
      fingerprints,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      workspace,
      applicationId: 'com.smartfin.dashboardphase2.bench',
      fingerprints,
    },
    null,
    2,
  ),
);
