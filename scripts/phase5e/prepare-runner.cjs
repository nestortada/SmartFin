const fs = require('node:fs');
let source = fs.readFileSync('scripts/phase5d/run-android.ps1', 'utf8');
source = source.replaceAll('C:/sf-5d-20261024', 'C:/sf-5e-20261024')
  .replaceAll('docs/atomicidad-fase5d/android/api24/matrix', 'docs/atomicidad-fase5e/android/api24/integrated')
  .replace("$Campaign='phase5d-matrix'", "$Campaign='phase5e-integrated'")
  .replace("'phase5c-main'", "'phase5e-integrated','phase5e-performance','phase5c-matrix','phase5c-main'");
fs.writeFileSync('scripts/phase5e/run-android.ps1', source);
