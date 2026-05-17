import type { Category } from '../types';

export type CategoryRepository = {
  getCategories: () => Category[];
};

const mockCategories: Category[] = [
  {
    id: 'category-income',
    name: 'Ingresos',
    type: 'income',
    macroCategory: 'income',
    color: '#00e475',
  },
  {
    id: 'category-food',
    name: 'Alimentación',
    type: 'expense',
    macroCategory: 'food',
    color: '#bbc3ff',
  },
  {
    id: 'category-transport',
    name: 'Transporte',
    type: 'expense',
    macroCategory: 'transport',
    color: '#cdbdff',
  },
  {
    id: 'category-housing',
    name: 'Vivienda',
    type: 'expense',
    macroCategory: 'housing',
    color: '#8ea2ff',
  },
  {
    id: 'category-entertainment',
    name: 'Entretenimiento',
    type: 'expense',
    macroCategory: 'entertainment',
    color: '#d7b7ff',
  },
  {
    id: 'category-health',
    name: 'Salud',
    type: 'expense',
    macroCategory: 'health',
    color: '#ffb4ab',
  },
  {
    id: 'category-utilities',
    name: 'Servicios',
    type: 'expense',
    macroCategory: 'utilities',
    color: '#8fd8ff',
  },
  {
    id: 'category-debts',
    name: 'Deudas',
    type: 'debt',
    macroCategory: 'debts',
    color: '#c0acff',
  },
  {
    id: 'category-investments',
    name: 'Inversiones',
    type: 'investment',
    macroCategory: 'investments',
    color: '#62ff96',
  },
  {
    id: 'category-other',
    name: 'Otros',
    type: 'expense',
    macroCategory: 'other',
    color: '#c5c5d9',
  },
];

export const mockCategoryRepository: CategoryRepository = {
  getCategories: () => mockCategories.map(category => ({ ...category })),
};
