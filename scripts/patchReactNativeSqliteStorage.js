const fs = require('fs');
const path = require('path');

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
  console.log('react-native-sqlite-storage no esta instalado; se omite parche.');
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
  process.exit(0);
}

fs.writeFileSync(buildGradlePath, patchedContent);
console.log('react-native-sqlite-storage parcheado para Gradle moderno.');
