const fs=require('node:fs'),crypto=require('node:crypto');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before=JSON.parse(fs.readFileSync('docs/estabilizacion-fase5b3/baseline/scope-audit.json','utf8')).before;
const allowed=[
  'src/navigation/AppNavigator.tsx',
  'src/modules/settings/services/androidDriveBackupService.ts',
  'src/modules/settings/ui/SettingsScreen.tsx',
  ...['DriveBackupSection','SecuritySection','PersonalizationSection','primitives'].map(n=>`src/modules/settings/ui/components/${n}.tsx`),
  ...['SmartFinBackupPublisher','SmartFinDriveBackupModule','SmartFinBackupCsv'].map(n=>`android/app/src/main/java/com/smartfin/${n}.kt`),
  '__tests__/backupPublication.test.ts',
];
const differences=Object.keys(before).filter(file=>hash(file)!==before[file]);
const unexpected=differences.filter(file=>!allowed.includes(file));
const uiFlagFalse=fs.readFileSync('src/modules/settings/services/backupPublicationPolicy.ts','utf8').includes('BACKUP_PUBLICATION_UI_ENABLED = false');
const report={comparedFiles:Object.keys(before).length,differences,unexpected,expectedScopeOnly:unexpected.length===0,uiFlagFalse,
  deletionDriverSchemaDependenciesUnchanged:unexpected.length===0,financialDeltasExpected:0};
fs.writeFileSync('docs/estabilizacion-fase5b3/source-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(unexpected.length||!uiFlagFalse) process.exitCode=1;
