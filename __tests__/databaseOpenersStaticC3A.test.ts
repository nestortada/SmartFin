// C3A: inventario estático de aperturas SQLite. Falla si aparece una apertura nueva que salte el resolvedor
// (nombre fijo, getDatabasePath fuera de SmartFinDatabaseLocation, o una apertura no inventariada).
const fs = require('node:fs') as {
  readdirSync: (dir: string, options: { recursive: boolean }) => string[]; readFileSync: (file: string, encoding: 'utf8') => string;
};
const { join } = require('node:path') as { join: (...parts: string[]) => string };

const read = (root: string, extension: RegExp) => fs.readdirSync(root, { recursive: true })
  .filter(name => extension.test(name))
  .map(name => ({ name: name.replace(/\\/g, '/'), text: fs.readFileSync(join(root, name), 'utf8') }));
const kotlin = read('android/app/src/main/java/com/smartfin', /\.kt$/);
const typescript = read('src', /\.tsx?$/);
const occurrences = (files: { name: string; text: string }[], pattern: RegExp) =>
  files.flatMap(file => (file.text.match(new RegExp(pattern.source, 'g')) ?? []).map(() => file.name)).sort();

describe('C3A — todas las aperturas SQLite pasan por el resolvedor o son copias privadas inventariadas', () => {
  test('getDatabasePath y el nombre smartfin.db solo existen en SmartFinDatabaseLocation (Kotlin)', () => {
    expect(occurrences(kotlin, /getDatabasePath\(/)).toEqual(['SmartFinDatabaseLocation.kt']);
    expect(occurrences(kotlin, /"smartfin\.db"/)).toEqual(['SmartFinDatabaseLocation.kt']);
    expect(occurrences(kotlin, /openOrCreateDatabase|SQLiteOpenHelper|Room\./)).toEqual([]);
  });

  test('aperturas nativas inventariadas: activa solo tras resolver; el resto son copias privadas', () => {
    expect(occurrences(kotlin, /SQLiteDatabase\.openDatabase\(/)).toEqual([
      'SmartFinBackupCsv.kt', 'SmartFinBackupCsv.kt', // snapshot privada
      'SmartFinLocalSnapshot.kt', 'SmartFinLocalSnapshot.kt', 'SmartFinLocalSnapshot.kt', // origen resuelto + copia + descarte
      'SmartFinSubscriptionRemindersModule.kt', // withDatabase tras SmartFinDatabaseLocation.resolve
    ]);
    const reminders = kotlin.find(file => file.name === 'SmartFinSubscriptionRemindersModule.kt')!.text;
    expect(reminders.indexOf('SmartFinDatabaseLocation.resolve(')).toBeGreaterThan(-1);
    expect(reminders.indexOf('SmartFinDatabaseLocation.resolve(')).toBeLessThan(reminders.indexOf('SQLiteDatabase.openDatabase('));
    const snapshot = kotlin.find(file => file.name === 'SmartFinLocalSnapshot.kt')!.text;
    expect(snapshot).toContain('val source = SmartFinDatabaseLocation.activeFile(context');
  });

  test('JS: el driver solo se abre en sqliteLifecycle y con el nombre resuelto; ningún abridor usa el nombre fijo', () => {
    expect(occurrences(typescript, /\bopenDatabase\(/)).toEqual(['database/sqliteLifecycle.ts']);
    expect(occurrences(typescript, /openConfirmedSQLiteConnection\(/)).toEqual(['database/sqliteDatabase.ts', 'database/sqliteLifecycle.ts']);
    const open = typescript.find(file => file.name === 'database/sqliteDatabase.ts')!.text;
    expect(open).toContain('name: resolution.binding.fileName');
    expect(open.indexOf('resolveSmartFinDatabase(owner)')).toBeLessThan(open.indexOf('openConfirmedSQLiteConnection('));
    // La constante histórica sigue exportada por compatibilidad, pero ningún abridor la usa.
    expect(occurrences(typescript, /SMARTFIN_DATABASE_NAME/)).toEqual(['database/index.ts', 'database/sqliteSchema.ts']);
  });

  test('el driver no usa rutas que reabran o creen bases por nombre (attach, delete, asset import, lock workaround)', () => {
    const all = typescript.map(file => file.text).join('\n');
    expect(all).not.toMatch(/androidLockWorkaround|createFromLocation|\.attach\(|deleteDatabase\(/);
  });
});
