const fs = require('node:fs');
const { patchSQLiteAndroidRecovery } =
  require('../scripts/sqliteAndroidRecoveryPatch') as {
    patchSQLiteAndroidRecovery: (source: string) => string;
  };
const installed = fs.readFileSync(
  'node_modules/react-native-sqlite-storage/platforms/android/src/main/java/org/pgsqlite/SQLitePlugin.java',
  'utf8',
);
const approvedLines = `                    // SmartFin: release this DBRunner thread's abandoned sessions.
                    // Native commit flags are preserved; JS command outcome stays unknown.
                    while (this.mydb.inTransaction()) {
                        this.mydb.endTransaction();
                    }
`;
test('installed recovery patch is idempotent and changes only the approved closing branch', () => {
  const normalized = installed.replace(/\r\n/g, '\n');
  expect(normalized.split(approvedLines)).toHaveLength(2);
  const original = normalized.replace(approvedLines, '');
  expect(patchSQLiteAndroidRecovery(original)).toBe(normalized);
  expect(patchSQLiteAndroidRecovery(installed)).toBe(installed);
  expect(patchSQLiteAndroidRecovery(original.replace(/\n/g, '\r\n'))).toBe(
    normalized.replace(/\n/g, '\r\n'),
  );
});
test('unreviewed, duplicated and partially patched driver layouts fail instead of accepting recovery', () => {
  const original = installed.replace(/\r\n/g, '\n').replace(approvedLines, '');
  expect(() =>
    patchSQLiteAndroidRecovery(
      original.replace('if (dbq != null && dbq.close)', 'if (dbq.close)'),
    ),
  ).toThrow('Unsupported');
  expect(() => patchSQLiteAndroidRecovery(original + original)).toThrow(
    'Unsupported',
  );
  expect(() =>
    patchSQLiteAndroidRecovery(
      installed.replace(/\r\n/g, '\n').replace(
        approvedLines,
        approvedLines.replace(
          'this.mydb.endTransaction();',
          'this.mydb.close();',
        ),
      ),
    ),
  ).toThrow('Unsupported');
});

export {};
