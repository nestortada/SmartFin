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

  it('asks for category and subcategory when the model lacks enough context', () => {
    const plan = parseAiCommandPlan({
      actions: [{
        entity: 'transaction',
        fields: {
          accountId: account.id,
          amount: 30000,
          date: '2026-09-27T12:00:00.000Z',
          description: 'Ingreso recibido',
          transactionType: 'income',
        },
        id: 'income',
        operation: 'create',
      }],
      summary: 'Ingreso sin clasificar',
    });
    const fields = buildClarificationQuestions(plan, context).map(question => question.field);
    expect(fields).toEqual(expect.arrayContaining(['categoryId', 'subcategoryId']));
  });

  it('uses an existing subcategory when its name is written manually', () => {
    const plan = parseAiCommandPlan({
      actions: [{
        entity: 'transaction',
        fields: { categoryId: category.id, transactionType: 'expense' },
        id: 'purchase',
        operation: 'create',
      }],
      summary: 'Compra',
    });
    const question = buildClarificationQuestions(plan, context)
      .find(candidate => candidate.field === 'subcategoryId');
    const answered = applyClarificationAnswer(plan, question!, 'Mercado', context);
    const transaction = answered.actions.find(action => action.id === 'purchase');
    expect(transaction?.entity === 'transaction' ? transaction.fields.subcategoryId : undefined)
      .toBe(subcategory.id);
    expect(answered.actions).toHaveLength(1);
  });

  it('adds and links a new subcategory when a custom name does not exist', () => {
    const plan = parseAiCommandPlan({
      actions: [{
        entity: 'transaction',
        fields: { categoryId: category.id, transactionType: 'expense' },
        id: 'purchase',
        operation: 'create',
      }],
      summary: 'Compra',
    });
    const question = buildClarificationQuestions(plan, context)
      .find(candidate => candidate.field === 'subcategoryId');
    const answered = applyClarificationAnswer(plan, question!, 'Restaurantes', context);
    expect(answered.actions[0]).toEqual(expect.objectContaining({
      clientRef: 'purchase-subcategory-ref',
      entity: 'subcategory',
      operation: 'create',
    }));
    const transaction = answered.actions.find(action => action.id === 'purchase');
    expect(transaction?.entity === 'transaction' ? transaction.fields.subcategoryRef : undefined)
      .toBe('purchase-subcategory-ref');
  });

  it('adds a compatible category when the user writes a new category name', () => {
    const plan = parseAiCommandPlan({
      actions: [{
        entity: 'transaction',
        fields: { transactionType: 'income' },
        id: 'income',
        operation: 'create',
      }],
      summary: 'Ingreso',
    });
    const question = buildClarificationQuestions(plan, context)
      .find(candidate => candidate.field === 'categoryId');
    const answered = applyClarificationAnswer(plan, question!, 'Bonificaciones', context);
    expect(answered.actions[0]).toEqual(expect.objectContaining({
      clientRef: 'income-category-ref',
      entity: 'category',
      fields: expect.objectContaining({ name: 'Bonificaciones', type: 'income' }),
      operation: 'create',
    }));
    const transaction = answered.actions.find(action => action.id === 'income');
    expect(transaction?.entity === 'transaction' ? transaction.fields.categoryRef : undefined)
      .toBe('income-category-ref');
  });

  it('creates and links a new credit card after a custom bank answer', () => {
    const plan = parseAiCommandPlan({
      actions: [{
        entity: 'transaction',
        fields: {
          amount: 90000,
          categoryId: category.id,
          date: '2026-09-27T12:00:00.000Z',
          description: 'Compra',
          transactionType: 'expense',
        },
        id: 'purchase',
        operation: 'create',
      }],
      summary: 'Compra con una tarjeta nueva',
    });
    const accountQuestion = buildClarificationQuestions(plan, context)
      .find(candidate => candidate.field === 'accountId');
    const withBankName = applyClarificationAnswer(plan, accountQuestion!, 'Banco Nuevo', context);
    const kindQuestion = buildClarificationQuestions(withBankName, context)
      .find(candidate => candidate.field === 'pendingAccountKind');
    expect(kindQuestion?.options.map(optionItem => optionItem.value)).toEqual([
      'debitAccount', 'creditCard',
    ]);

    const answered = applyClarificationAnswer(withBankName, kindQuestion!, 'creditCard', context);
    expect(answered.actions[0]).toEqual(expect.objectContaining({
      clientRef: 'purchase-account-ref',
      entity: 'creditCard',
      fields: expect.objectContaining({ bankName: 'Banco Nuevo' }),
      operation: 'create',
    }));
    const transaction = answered.actions.find(action => action.id === 'purchase');
    expect(transaction?.entity === 'transaction' ? transaction.fields.accountRef : undefined)
      .toBe('purchase-account-ref');
    const remainingFields = buildClarificationQuestions(answered, context)
      .map(question => question.field);
    expect(remainingFields).toEqual(expect.arrayContaining([
      'name', 'creditLimit', 'installmentCount', 'interestFreeInstallmentCount',
    ]));
  });
});
