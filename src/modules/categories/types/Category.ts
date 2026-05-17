export type CategoryType =
  | 'income'
  | 'expense'
  | 'debt'
  | 'investment'
  | 'transfer'
  | 'adjustment';

export type MacroCategory =
  | 'income'
  | 'food'
  | 'transport'
  | 'housing'
  | 'entertainment'
  | 'health'
  | 'utilities'
  | 'debts'
  | 'investments'
  | 'other';

export type Category = {
  id: string;
  name: string;
  type: CategoryType;
  macroCategory: MacroCategory;
  color: string;
};
