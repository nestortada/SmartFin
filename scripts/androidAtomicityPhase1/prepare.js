/* Disposable release harness: separate applicationId, no production Kotlin modules. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repository = path.resolve(__dirname, '../..');
const workspace = path.resolve(process.argv[2] || 'C:/sfatomicity1');
if (
  workspace === repository ||
  workspace.startsWith(repository + path.sep) ||
  fs.existsSync(workspace)
)
  throw new Error('Choose a NEW directory outside production');
if (!process.env.ANDROID_HOME) throw new Error('ANDROID_HOME required');
const packageId = 'com.smartfin.atomicityphase1.tests';
fs.mkdirSync(workspace, { recursive: true });
const copy = relative =>
  fs.cpSync(path.join(repository, relative), path.join(workspace, relative), {
    recursive: true,
    filter: candidate =>
      !candidate
        .split(path.sep)
        .some(part => ['build', '.gradle', '.cxx'].includes(part)) &&
      !candidate.startsWith(path.join(repository, 'android/app/src/main/java')),
  });
for (const file of [
  'package.json',
  'babel.config.js',
  'react-native.config.js',
  'tsconfig.json',
  'src',
  'android',
])
  copy(file);
fs.symlinkSync(
  path.join(repository, 'node_modules'),
  path.join(workspace, 'node_modules'),
  'junction',
);
fs.writeFileSync(
  path.join(workspace, '.env'),
  '# Isolated synthetic test application\n',
);
// Copy the installed driver, including its approved permanent postinstall patch.
fs.cpSync(
  path.join(repository, 'node_modules/react-native-sqlite-storage'),
  path.join(workspace, 'vendor/sqlite'),
  {
    recursive: true,
    filter: candidate => !candidate.split(path.sep).includes('build'),
  },
);
fs.writeFileSync(
  path.join(workspace, 'metro.config.js'),
  `const {getDefaultConfig,mergeConfig}=require('@react-native/metro-config');const path=require('node:path');module.exports=mergeConfig(getDefaultConfig(__dirname),{watchFolders:[${JSON.stringify(
    repository,
  )}],resolver:{resolveRequest(context,name,platform){if(name==='react-native-sqlite-storage')return {type:'sourceFile',filePath:path.join(__dirname,'vendor/sqlite/sqlite.js')};return context.resolveRequest(context,name,platform);}}});`,
);
fs.appendFileSync(
  path.join(workspace, 'android/settings.gradle'),
  "\nproject(':react-native-sqlite-storage').projectDir = new File(rootProject.projectDir, '../vendor/sqlite/platforms/android')\n",
);
const gradleFile = path.join(workspace, 'android/app/build.gradle');
const gradle = fs
  .readFileSync(gradleFile, 'utf8')
  .replace('applicationId "com.smartfin"', `applicationId "${packageId}"`);
if (!gradle.includes(`applicationId "${packageId}"`))
  throw new Error('Package isolation failed');
fs.writeFileSync(gradleFile, gradle);
fs.writeFileSync(
  path.join(workspace, 'android/local.properties'),
  `sdk.dir=${process.env.ANDROID_HOME.replace(/\\/g, '/')}\n`,
);
const native = path.join(workspace, 'android/app/src/main/java/com/smartfin');
fs.mkdirSync(native, { recursive: true });
fs.copyFileSync(
  path.join(
    repository,
    'android/app/src/main/java/com/smartfin/MainActivity.kt',
  ),
  path.join(native, 'MainActivity.kt'),
);
fs.writeFileSync(
  path.join(native, 'MainApplication.kt'),
  `package com.smartfin
import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
class MainApplication: Application(), ReactApplication {
override val reactHost: ReactHost by lazy {getDefaultReactHost(context=applicationContext,packageList=PackageList(this).packages.apply {add(AtomicityPackage())})}
override fun onCreate(){super.onCreate();loadReactNative(this)}
}`,
);
fs.copyFileSync(
  path.join(__dirname, 'AtomicityPackage.kt'),
  path.join(native, 'AtomicityPackage.kt'),
);
fs.writeFileSync(
  path.join(workspace, 'android/app/src/main/AndroidManifest.xml'),
  `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET"/><application android:name="com.smartfin.MainApplication" android:label="SmartFin Atomicity Synthetic Tests" android:allowBackup="false" android:theme="@style/AppTheme"><activity android:name="com.smartfin.MainActivity" android:exported="true" android:configChanges="keyboard|keyboardHidden|orientation|screenLayout|screenSize|smallestScreenSize|uiMode"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>`,
);
fs.copyFileSync(
  path.join(__dirname, 'Harness.jsx'),
  path.join(workspace, 'Harness.jsx'),
);
fs.writeFileSync(
  path.join(workspace, 'index.js'),
  "import {AppRegistry} from 'react-native';import Harness from './Harness';AppRegistry.registerComponent('SmartFin',()=>Harness);\n",
);
const hashes = {};
for (const file of [
  'src/database/atomicSQLite.ts',
  'src/database/managedSQLite.ts',
  'src/database/databaseCoordination.ts',
  'src/database/sqliteDatabase.ts',
  'src/database/sqliteLifecycle.ts',
  'vendor/sqlite/sqlite.js',
  'vendor/sqlite/lib/sqlite.core.js',
  'vendor/sqlite/platforms/android/src/main/java/org/pgsqlite/SQLitePlugin.java',
  'Harness.jsx',
  'android/app/src/main/java/com/smartfin/AtomicityPackage.kt',
])
  hashes[file] = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(workspace, file)))
    .digest('hex');
fs.writeFileSync(
  path.join(workspace, 'source-fingerprints.json'),
  JSON.stringify(
    { packageId, workspace, hashes, productionNativeModulesIncluded: false },
    null,
    2,
  ),
);
process.stdout.write(workspace + '\n');
