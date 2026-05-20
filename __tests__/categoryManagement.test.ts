import type { ResultSet } from 'react-native-sqlite-storage';

import type { SmartFinSQLiteDatabase } from '../src/database';
import type { Category } from '../src/modules/categories';
import {
  createCategory,
  deleteCategory,
  updateCategory,
  type CategoryManagementRepository,
} from '../src/modules/categories';
import { createSqliteCategoryRepository } from '../src/modules/categories/repositories/sqliteCategoryRepository';

const baseCategories: Category[] = [
  {
    id: 'category-income',
    name: 'Ingresos',
    type: 'income',
    macroCategory: 'income',
    color: '#00e475',
  },
  {
    id: 'category-food',
    name: 'Alimentacion',
    type: 'expense',
    macroCategory: 'food',
    color: '#bbc3ff',
  },
  {
    id: 'category-other',
    name: 'Otros',
    type: 'expense',
    macroCategory: 'other',
    color: '#c5c5d9',
  },
];

function createCategoryRepository(initialCategories = baseCategories) {
  let categories = initialCategories.map(category => ({ ...category }));
  const deletedPairs: Array<{ categoryId: string; fallbackCategoryId: string }> = [];

  const repository: CategoryManagementRepository = {
    deleteCategoryAndReassign: async (categoryId, fallbackCategoryId) => {
      deletedPairs.push({ categoryId, fallbackCategoryId });
      categories = categories.filter(category => category.id !== categoryId);
    },
    getCategories: async () => categories.map(category => ({ ...category })),
    saveCategories: async savedCategories => {
      for (const savedCategory of savedCategories) {
        const index = categories.findIndex(category => category.id === savedCategory.id);

        if (index >= 0) {
          categories[index] = { ...savedCategory };
        } else {
          categories.push({ ...savedCategory });
        }
      }
    },
  };

  return {
    deletedPairs,
    repository,
    readCategories: () => categories.map(category => ({ ...category })),
  };
}

test('creates income and expense categories through the category use case', async () => {
  const { repository, readCategories } = createCategoryRepository();

  const created = await createCategory(repository, {
    color: '#62ff96',
    name: '  Universidad  ',
    type: 'expense',
  });

  expect(created.id).toMatch(/^category-expense-universidad-/);
  expect(created.name).toBe('Universidad');
  expect(created.macroCategory).toBe('other');
  expect(readCategories()).toContainEqual(created);
});

test('updates a category without changing its existing expense macro category', async () => {
  const { repository, readCategories } = createCategoryRepository();

  const updated = await updateCategory(repository, 'category-food', {
    color: '#cdbdff',
    name: 'Restaurantes',
    type: 'expense',
  });

  expect(updated).toMatchObject({
    id: 'category-food',
    name: 'Restaurantes',
    macroCategory: 'food',
    color: '#cdbdff',
  });
  expect(readCategories().find(category => category.id === 'category-food')).toEqual(updated);
});

test('blocks deletion of the fallback Otros category', async () => {
  const { deletedPairs, repository } = createCategoryRepository();

  await expect(deleteCategory(repository, 'category-other')).rejects.toThrow(
    'No puedes eliminar la categoria Otros.',
  );
  expect(deletedPairs).toEqual([]);
});

test('deletes a category by reassigning its references to Otros', async () => {
  const { deletedPairs, repository, readCategories } = createCategoryRepository();

  await deleteCategory(repository, 'category-food');

  expect(deletedPairs).toEqual([
    {
      categoryId: 'category-food',
      fallbackCategoryId: 'category-other',
    },
  ]);
  expect(readCategories().some(category => category.id === 'category-food')).toBe(false);
});

test('sqlite category repository clears related subcategory references before deleting a category', async () => {
  const statements: string[] = [];
  const values: unknown[][] = [];
  const database = {
    executeSql: jest.fn(async (statement: string, params?: unknown[]) => {
      statements.push(statement.replace(/\s+/g, ' ').trim());
      values.push(params ?? []);

      return [{ rows: { item: () => undefined, length: 0, raw: () => [] } } as unknown as ResultSet];
    }),
  } as unknown as SmartFinSQLiteDatabase;
  const repository = createSqliteCategoryRepository(database);

  await repository.deleteCategoryAndReassign('category-food', 'category-other');

  expect(statements[0]).toContain('UPDATE transactions SET subcategory_id = NULL');
  expect(statements[1]).toContain('UPDATE transaction_splits SET subcategory_id = NULL');
  expect(statements[2]).toContain('UPDATE merchant_mappings SET subcategory_id = NULL');
  expect(statements[3]).toContain('UPDATE recurring_subscriptions SET subcategory_id = NULL');
  expect(statements[4]).toBe('UPDATE transactions SET category_id = ?, updated_at = ? WHERE category_id = ?;');
  expect(statements[5]).toBe('UPDATE transaction_splits SET category_id = ?, updated_at = ? WHERE category_id = ?;');
  expect(statements[8]).toBe('UPDATE recurring_subscriptions SET category_id = ?, updated_at = ? WHERE category_id = ?;');
  expect(statements[9]).toBe('DELETE FROM subcategories WHERE category_id = ?;');
  expect(statements[10]).toBe('DELETE FROM categories WHERE id = ?;');
  const transactionReassignValues = values[4];

  expect(transactionReassignValues).toBeDefined();
  expect(transactionReassignValues?.[0]).toBe('category-other');
  expect(transactionReassignValues?.[2]).toBe('category-food');
});
