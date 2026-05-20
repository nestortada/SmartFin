import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import {
  readString,
  resultSetToRows,
  type SQLiteRow,
} from '../../../database/sqliteRows';
import type { Category, CategoryType, MacroCategory } from '../types';

export type SqliteCategoryRepository = {
  deleteCategoryAndReassign: (
    categoryId: string,
    fallbackCategoryId: string,
  ) => Promise<void>;
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
    deleteCategoryAndReassign: async (categoryId, fallbackCategoryId) => {
      const updatedAt = new Date().toISOString();

      await database.executeSql(
        `UPDATE transactions
        SET subcategory_id = NULL, updated_at = ?
        WHERE subcategory_id IN (
          SELECT id FROM subcategories WHERE category_id = ?
        );`,
        [updatedAt, categoryId],
      );
      await database.executeSql(
        `UPDATE transaction_splits
        SET subcategory_id = NULL, updated_at = ?
        WHERE subcategory_id IN (
          SELECT id FROM subcategories WHERE category_id = ?
        );`,
        [updatedAt, categoryId],
      );
      await database.executeSql(
        `UPDATE merchant_mappings
        SET subcategory_id = NULL, updated_at = ?
        WHERE subcategory_id IN (
          SELECT id FROM subcategories WHERE category_id = ?
        );`,
        [updatedAt, categoryId],
      );
      await database.executeSql(
        `UPDATE recurring_subscriptions
        SET subcategory_id = NULL, updated_at = ?
        WHERE subcategory_id IN (
          SELECT id FROM subcategories WHERE category_id = ?
        );`,
        [updatedAt, categoryId],
      );

      await database.executeSql(
        'UPDATE transactions SET category_id = ?, updated_at = ? WHERE category_id = ?;',
        [fallbackCategoryId, updatedAt, categoryId],
      );
      await database.executeSql(
        'UPDATE transaction_splits SET category_id = ?, updated_at = ? WHERE category_id = ?;',
        [fallbackCategoryId, updatedAt, categoryId],
      );
      await database.executeSql(
        'UPDATE merchant_mappings SET category_id = ?, updated_at = ? WHERE category_id = ?;',
        [fallbackCategoryId, updatedAt, categoryId],
      );
      await database.executeSql(
        'UPDATE envelopes SET category_id = ?, updated_at = ? WHERE category_id = ?;',
        [fallbackCategoryId, updatedAt, categoryId],
      );
      await database.executeSql(
        'UPDATE recurring_subscriptions SET category_id = ?, updated_at = ? WHERE category_id = ?;',
        [fallbackCategoryId, updatedAt, categoryId],
      );

      await database.executeSql(
        'DELETE FROM subcategories WHERE category_id = ?;',
        [categoryId],
      );
      await database.executeSql(
        'DELETE FROM categories WHERE id = ?;',
        [categoryId],
      );
    },
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
