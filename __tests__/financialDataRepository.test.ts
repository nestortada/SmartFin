jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
import { financialIntegrityFixture } from './helpers/financialIntegrityFixture';
import { createSqliteFinancialDataRepository } from '../src/modules/settings/repositories/sqliteFinancialDataRepository';
test('financial wipe uses one shared commit and preserves public app settings', async () => {
  const f = await financialIntegrityFixture();
  try {
    f.query("INSERT INTO app_settings VALUES ('theme','dark','2026-01-01')");
    f.resetTrace();
    const result = await createSqliteFinancialDataRepository(f.database).deleteFinancialData(
      '11111111-1111-4111-8111-111111111111', { workIds: [], backupJobIds: [], snapshotIds: [] });
    expect(result.status).toBe('confirmed');
    expect(f.trace.filter(entry => /^DELETE/.test(entry.sql))).toHaveLength(36);
    expect(f.trace.filter(entry => /^BEGIN/.test(entry.sql))).toHaveLength(1);
    expect(f.trace.filter(entry => /^COMMIT/.test(entry.sql))).toHaveLength(1);
    expect(f.query("SELECT setting_value FROM app_settings WHERE setting_key='theme'").rows.item(0)).toEqual({ setting_value: 'dark' });
  } finally { f.native.close(); }
});
