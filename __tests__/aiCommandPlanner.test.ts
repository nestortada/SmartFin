import type { Account } from '../src/modules/accounts';
import type { Category, Subcategory } from '../src/modules/categories';
import {
  applyClarificationAnswer,
  buildClarificationQuestions,
  normalizeAiCommandPlan,
  parseAiCommandPlan,
  type AiPlanningContext,
} from '../src/modules/transactions';

const account: Account = {
  id: 'card-visa',
  balance: { amount: 0, currency: 'COP' },
  createdAt: '2026-09-01T00:00:00.000Z',
  creditLimit: { amount: 5000000, currency: 'COP' },
  currency: 'COP',
  debtBalance: { amount: 0, currency: 'COP' },
  institutionName: 'Banco Uno',
  name: 'Visa personal',
  status: 'active',
  type: 'creditCard',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const category: Category = {
  color: '#123456',
  id: 'category-food',
  macroCategory: 'food',
  name: 'Comida',
  type: 'expense',
};

const subcategory: Subcategory = {
  categoryId: category.id,
  color: '#654321',
  createdAt: '2026-09-01T00:00:00.000Z',
  id: 'subcategory-market',
  isActive: true,
  name: 'Mercado',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const context: AiPlanningContext = {
  accounts: [account],
  categories: [category],
  subcategories: [subcategory],
  transactions: [],
};

describe('AI command planner', () => {
  it('parses a typed multi-action plan and rejects batches over the safe limit', () => {
    const plan = parseAiCommandPlan({
      actions: [
        { id: 'one', operation: 'create', entity: 'category', fields: { name: 'Mascotas' } },
        { id: 'two', operation: 'create', entity: 'transaction', fields: { amount: 50000 } },
      ],
      summary: 'Dos operaciones',
    });
    expect(plan.actions).toHaveLength(2);
    expect(() => parseAiCommandPlan({
      actions: Array.from({ length: 21 }, (_, index) => ({
        entity: 'category', fields: {}, id: `action-${index}`, operation: 'create',
      })),
      summary: 'Demasiadas',
    })).toThrow('entre 1 y 20');
  });

  it('resolves catalog names locally and asks credit-card details without another model call', () => {
    const normalized = normalizeAiCommandPlan(parseAiCommandPlan({
      actions: [{
        entity: 'transaction',
        fields: {
          accountName: 'Visa personal',
          amount: 120000,
          categoryName: 'Comida',
          date: '2026-09-26T00:00:00.000Z',
          description: 'Supermercado',
          subcategoryName: 'Mercado',
          transactionType: 'expense',
        },
        id: 'purchase',
        operation: 'create',
      }],
      summary: 'Compra',
    }), context);

    const action = normalized.actions[0];
    expect(action?.entity === 'transaction' ? action.fields.accountId : undefined).toBe(account.id);
    const questions = buildClarificationQuestions(normalized, context);
    expect(questions.map(question => question.field)).toEqual(
      expect.arrayContaining(['notes', 'installmentCount', 'interestFreeInstallmentCount']),
    );

    const installmentQuestion = questions.find(question => question.field === 'installmentCount');
    expect(installmentQuestion).toBeDefined();
    const answered = applyClarificationAnswer(normalized, installmentQuestion!, '3');
    expect(answered.actions[0]?.entity === 'transaction'
      ? answered.actions[0].fields.installmentCount
      : undefined).toBe(3);
  });
});
