import type { Category, CategoryType, MacroCategory } from '../types';

export const FALLBACK_CATEGORY_ID = 'category-other';

export type ManageableCategoryType = Extract<CategoryType, 'expense' | 'income'>;

export type CategoryManagementRepository = {
  deleteCategoryAndReassign: (
    categoryId: string,
    fallbackCategoryId: string,
  ) => Promise<void>;
  getCategories: () => Promise<Category[]>;
  saveCategories: (categories: Category[]) => Promise<void>;
};

type CategoryInput = {
  color: string;
  name: string;
  type: ManageableCategoryType;
};

const manageableTypes: ManageableCategoryType[] = ['expense', 'income'];

function isManageableCategory(category: Category): boolean {
  return manageableTypes.includes(category.type as ManageableCategoryType);
}

function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function buildCategoryId(name: string, type: ManageableCategoryType): string {
  const slug = normalizeCategoryName(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `category-${type}-${slug || 'custom'}-${Date.now()}`;
}

function getMacroCategoryForType(
  type: ManageableCategoryType,
  current?: Category,
): MacroCategory {
  if (type === 'income') {
    return 'income';
  }

  if (current?.type === 'expense' && current.macroCategory !== 'income') {
    return current.macroCategory;
  }

  return 'other';
}

function assertValidCategoryInput(input: CategoryInput) {
  if (!normalizeCategoryName(input.name)) {
    throw new Error('El nombre de la categoria es obligatorio.');
  }

  if (!input.color.trim()) {
    throw new Error('El color de la categoria es obligatorio.');
  }
}

function assertNoDuplicateName(
  categories: Category[],
  input: CategoryInput,
  currentCategoryId?: string,
) {
  const normalizedName = normalizeCategoryName(input.name).toLocaleLowerCase();
  const duplicate = categories.some(category => (
    category.id !== currentCategoryId &&
    category.type === input.type &&
    category.name.toLocaleLowerCase() === normalizedName
  ));

  if (duplicate) {
    throw new Error('Ya existe una categoria con ese nombre.');
  }
}

export async function listManageableCategories(
  repository: CategoryManagementRepository,
): Promise<Category[]> {
  const categories = await repository.getCategories();

  return categories.filter(isManageableCategory);
}

export async function createCategory(
  repository: CategoryManagementRepository,
  input: CategoryInput,
): Promise<Category> {
  assertValidCategoryInput(input);

  const categories = await repository.getCategories();
  assertNoDuplicateName(categories, input);

  const category: Category = {
    id: buildCategoryId(input.name, input.type),
    name: normalizeCategoryName(input.name),
    type: input.type,
    macroCategory: getMacroCategoryForType(input.type),
    color: input.color.trim(),
  };

  await repository.saveCategories([category]);

  return category;
}

export async function updateCategory(
  repository: CategoryManagementRepository,
  categoryId: string,
  input: CategoryInput,
): Promise<Category> {
  assertValidCategoryInput(input);

  const categories = await repository.getCategories();
  const current = categories.find(category => category.id === categoryId);

  if (!current || !isManageableCategory(current)) {
    throw new Error('No se encontro la categoria para modificar.');
  }

  assertNoDuplicateName(categories, input, categoryId);

  const updatedCategory: Category = {
    ...current,
    name: normalizeCategoryName(input.name),
    type: input.type,
    macroCategory: getMacroCategoryForType(input.type, current),
    color: input.color.trim(),
  };

  await repository.saveCategories([updatedCategory]);

  return updatedCategory;
}

export async function deleteCategory(
  repository: CategoryManagementRepository,
  categoryId: string,
): Promise<void> {
  if (categoryId === FALLBACK_CATEGORY_ID) {
    throw new Error('No puedes eliminar la categoria Otros.');
  }

  const categories = await repository.getCategories();
  const category = categories.find(item => item.id === categoryId);
  const fallback = categories.find(item => item.id === FALLBACK_CATEGORY_ID);

  if (!category || !isManageableCategory(category)) {
    throw new Error('No se encontro la categoria para eliminar.');
  }

  if (!fallback) {
    throw new Error('No existe la categoria Otros para reasignar movimientos.');
  }

  await repository.deleteCategoryAndReassign(categoryId, FALLBACK_CATEGORY_ID);
}
