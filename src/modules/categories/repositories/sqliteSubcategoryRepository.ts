import type { SmartFinSQLiteDatabase } from '../../../database';
import {
  readNullableString,
  readNumber,
  readString,
  resultSetToRows,
  type SQLiteRow,
} from '../../../database';
import type { Subcategory } from '../types';

export type SubcategoryRepository = {
  getSubcategories: (includeInactive?: boolean) => Promise<Subcategory[]>;
  saveSubcategories: (subcategories: Subcategory[]) => Promise<void>;
};

function rowToSubcategory(row: SQLiteRow): Subcategory {
  return {
    id: readString(row, 'id'),
    categoryId: readString(row, 'category_id'),
    name: readString(row, 'name'),
    color: readNullableString(row, 'color'),
    isActive: readNumber(row, 'is_active') === 1,
    createdAt: readString(row, 'created_at'),
    updatedAt: readString(row, 'updated_at'),
  };
}

export function createSqliteSubcategoryRepository(
  database: SmartFinSQLiteDatabase,
): SubcategoryRepository {
  return {
    getSubcategories: async (includeInactive = false) => {
      const [resultSet] = await database.executeSql(
        `SELECT id, category_id, name, color, is_active, created_at, updated_at
         FROM subcategories
         ${includeInactive ? '' : 'WHERE is_active = 1'}
         ORDER BY name ASC;`,
      );
      return resultSetToRows(resultSet).map(rowToSubcategory);
    },
    saveSubcategories: async subcategories => {
      for (const subcategory of subcategories) {
        await database.executeSql(
          `INSERT OR REPLACE INTO subcategories (
            id, category_id, name, color, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
          [
            subcategory.id,
            subcategory.categoryId,
            subcategory.name,
            subcategory.color ?? null,
            subcategory.isActive ? 1 : 0,
            subcategory.createdAt,
            subcategory.updatedAt,
          ],
        );
      }
    },
  };
}
