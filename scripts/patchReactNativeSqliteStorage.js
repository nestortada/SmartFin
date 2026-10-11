const fs = require('fs');
const path = require('path');
const { patchSQLiteAndroidRecovery } = require('./sqliteAndroidRecoveryPatch');

const buildGradlePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-sqlite-storage',
  'platforms',
  'android',
  'build.gradle',
);

if (!fs.existsSync(buildGradlePath)) {
  console.log(
    'react-native-sqlite-storage no esta instalado; se omite parche.',
  );
  process.exit(0);
}

const originalContent = fs.readFileSync(buildGradlePath, 'utf8');
let patchedContent = originalContent.replace(
  /(\s+)jcenter\(\)/g,
  '$1mavenCentral()',
);

patchedContent = patchedContent.replace(
  /classpath 'com\.android\.tools\.build:gradle:3\.1\.4'/g,
  "classpath 'com.android.tools.build:gradle:8.9.2'",
);

if (patchedContent === originalContent) {
  console.log('react-native-sqlite-storage ya estaba parcheado.');
} else {
  fs.writeFileSync(buildGradlePath, patchedContent);
  console.log('react-native-sqlite-storage parcheado para Gradle moderno.');
}

const driverRoot = path.resolve(path.dirname(buildGradlePath), '../..');
const version = JSON.parse(
  fs.readFileSync(path.join(driverRoot, 'package.json'), 'utf8'),
).version;
if (version !== '6.0.1')
  throw new Error(`Unreviewed SQLite driver version: ${version}`);
const javaFile = path.join(
  path.dirname(buildGradlePath),
  'src/main/java/org/pgsqlite/SQLitePlugin.java',
);
const javaSource = fs.readFileSync(javaFile, 'utf8');
const recoveredSource = patchSQLiteAndroidRecovery(javaSource);
if (javaSource !== recoveredSource) fs.writeFileSync(javaFile, recoveredSource);
console.log('SQLite Android: parche de recuperacion de sesiones verificado.');
