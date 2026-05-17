export type DatabaseStatus = 'configured' | 'not-configured';

export const databaseStatus: DatabaseStatus = 'configured';

export {
  closeSmartFinDatabase,
  openSmartFinDatabase,
  type SmartFinSQLiteDatabase,
} from './sqliteDatabase';
export { seedSmartFinDatabase } from './seedSmartFinDatabase';
export {
  readNullableNumber,
  readNullableString,
  readNumber,
  readString,
  resultSetToRows,
  type SQLitePrimitive,
  type SQLiteRow,
} from './sqliteRows';
export { SMARTFIN_DATABASE_NAME, SQLITE_SCHEMA_STATEMENTS } from './sqliteSchema';
