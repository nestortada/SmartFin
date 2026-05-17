import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import {
  readString,
  resultSetToRows,
  type SQLiteRow,
} from '../../../database/sqliteRows';
import type { Category, CategoryType, MacroCategory } from '../types';

export type SqliteCategoryRepository = {
  getCategories: () => Promise<Category[]>;
  saveCategories: (categories: Category[]) => Promise<void>;
};

function rowToCategory(row: SQLiteRow): Category {
  return {
    id: readString(row, 'id'),
    name: readString(row, 'name'),
    type: readString(row, 'type') as CategoryType,
    macroCategory: readString(row, 'macro_category') as MacroCategory,
    color: readString(row, 'color'),
  };
}

export function createSqliteCategoryRepository(
  database: SmartFinSQLiteDatabase,
): SqliteCategoryRepository {
  return {
    getCategories: async () => {
      const [resultSet] = await database.executeSql(
        `SELECT
          id,
          name,
          type,
          macro_category,
          color
        FROM categories
        ORDER BY name ASC;`,
      );

      return resultSetToRows(resultSet).map(rowToCategory);
    },
    saveCategories: async categories => {
      for (const category of categories) {
        await database.executeSql(
          `INSERT OR REPLACE INTO categories (
            id,
            name,
            type,
            macro_category,
            color
          ) VALUES (?, ?, ?, ?, ?);`,
          [
            category.id,
            category.name,
            category.type,
            category.macroCategory,
            category.color,
          ],
        );
      }
    },
  };
}
