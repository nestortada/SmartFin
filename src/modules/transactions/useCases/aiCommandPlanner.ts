import type { Account } from '../../accounts';
import type { Category, Subcategory } from '../../categories';
import type {
  AiActionEntity,
  AiActionOperation,
  AiClarificationOption,
  AiClarificationQuestion,
  AiCommandAction,
  AiCommandPlan,
  AiPlanningContext,
  Transaction,
  TransactionType,
} from '../types';

const OPERATIONS: AiActionOperation[] = ['create', 'update', 'delete'];
const ENTITIES: AiActionEntity[] = [
  'transaction', 'debitAccount', 'creditCard', 'category', 'subcategory',
];
const TRANSACTION_TYPES: TransactionType[] = ['income', 'expense', 'internalTransfer'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === 'string' ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | null | undefined {
  return value === null ? null : typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | null | undefined {
  return value === null ? null : typeof value === 'boolean' ? value : undefined;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null | undefined {
  return value === null ? null : typeof value === 'string' && allowed.includes(value as T)
    ? value as T
    : undefined;
}

function parseBaseAction(value: Record<string, unknown>, index: number) {
  const operation = optionalEnum(value.operation, OPERATIONS);
  const entity = optionalEnum(value.entity, ENTITIES);
  if (!operation || !entity) {
    throw new Error(`La operacion ${index + 1} no tiene un tipo valido.`);
  }
  return {
    clientRef: optionalString(value.clientRef) || undefined,
    entity,
    id: optionalString(value.id) || `action-${index + 1}`,
    operation,
    targetId: optionalString(value.targetId),
    targetName: optionalString(value.targetName),
  };
}

function parseAction(value: unknown, index: number): AiCommandAction {
  if (!isRecord(value)) {
    throw new Error(`La operacion ${index + 1} no tiene un formato valido.`);
  }
  const base = parseBaseAction(value, index);
  const sourceFields = isRecord(value.fields) ? value.fields : {};

  if (base.entity === 'transaction') {
    return {
      ...base,
      entity: 'transaction',
      fields: {
        accountId: optionalString(sourceFields.accountId),
        accountName: optionalString(sourceFields.accountName),
        accountRef: optionalString(sourceFields.accountRef),
        amount: optionalNumber(sourceFields.amount),
        categoryId: optionalString(sourceFields.categoryId),
        categoryName: optionalString(sourceFields.categoryName),
        categoryRef: optionalString(sourceFields.categoryRef),
        date: optionalString(sourceFields.date),
        description: optionalString(sourceFields.description),
        installmentCount: optionalNumber(sourceFields.installmentCount),
        interestFreeInstallmentCount: optionalNumber(sourceFields.interestFreeInstallmentCount),
        notes: optionalString(sourceFields.notes),
        subcategoryId: optionalString(sourceFields.subcategoryId),
        subcategoryName: optionalString(sourceFields.subcategoryName),
        subcategoryRef: optionalString(sourceFields.subcategoryRef),
        targetAccountId: optionalString(sourceFields.targetAccountId),
        targetAccountName: optionalString(sourceFields.targetAccountName),
        targetAccountRef: optionalString(sourceFields.targetAccountRef),
        transactionType: optionalEnum(sourceFields.transactionType, TRANSACTION_TYPES),
        transferTaxCharged: optionalBoolean(sourceFields.transferTaxCharged),
      },
    };
  }

  if (base.entity === 'debitAccount') {
    return {
      ...base,
      entity: 'debitAccount',
      fields: {
        initialBalance: optionalNumber(sourceFields.initialBalance),
        institutionName: optionalString(sourceFields.institutionName),
        name: optionalString(sourceFields.name),
        recurringIncomeAmount: optionalNumber(sourceFields.recurringIncomeAmount),
        recurringIncomeDay: optionalNumber(sourceFields.recurringIncomeDay),
        recurringIncomeEnabled: optionalBoolean(sourceFields.recurringIncomeEnabled),
        recurringIncomeFrequency: optionalEnum(sourceFields.recurringIncomeFrequency, ['biweekly', 'monthly', 'specificDay']),
        recurringIncomeType: optionalEnum(sourceFields.recurringIncomeType, ['salary', 'allowance', 'business', 'other']),
      },
    };
  }

  if (base.entity === 'creditCard') {
    return {
      ...base,
      entity: 'creditCard',
      fields: {
        annualEffectiveInterestRate: optionalNumber(sourceFields.annualEffectiveInterestRate),
        bankName: optionalString(sourceFields.bankName),
        closingDay: optionalNumber(sourceFields.closingDay),
        creditLimit: optionalNumber(sourceFields.creditLimit),
        lastFourDigits: optionalString(sourceFields.lastFourDigits),
        managementFee: optionalNumber(sourceFields.managementFee),
        name: optionalString(sourceFields.name),
        paymentDay: optionalNumber(sourceFields.paymentDay),
      },
    };
  }

  if (base.entity === 'category') {
    return {
      ...base,
      entity: 'category',
      fields: {
        color: optionalString(sourceFields.color),
        name: optionalString(sourceFields.name),
        type: optionalEnum(sourceFields.type, ['expense', 'income']),
      },
    };
  }

  return {
    ...base,
    entity: 'subcategory',
    fields: {
      categoryId: optionalString(sourceFields.categoryId),
      categoryName: optionalString(sourceFields.categoryName),
      categoryRef: optionalString(sourceFields.categoryRef),
      color: optionalString(sourceFields.color),
      name: optionalString(sourceFields.name),
    },
  };
}

export function parseAiCommandPlan(value: unknown): AiCommandPlan {
  if (!isRecord(value) || !Array.isArray(value.actions)) {
    throw new Error('Gemini no devolvio un plan estructurado valido.');
  }
  if (value.actions.length === 0 || value.actions.length > 20) {
    throw new Error('El plan debe contener entre 1 y 20 operaciones.');
  }
  const actions = value.actions.map(parseAction);
  if (new Set(actions.map(action => action.id)).size !== actions.length) {
    throw new Error('Gemini devolvio identificadores de operacion duplicados.');
  }
  return {
    actions,
    answeredFields: Array.isArray(value.answeredFields)
      ? value.answeredFields.filter((item): item is string => typeof item === 'string')
      : [],
    summary: optionalString(value.summary) || 'Operaciones financieras solicitadas',
    version: 1,
  };
}

function normalized(value?: string | null): string {
  return (value ?? '').trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function findUnique<T extends { id: string }>(
  candidates: T[],
  id?: string | null,
  name?: string | null,
  getName: (candidate: T) => string = candidate => candidate.id,
): T | undefined {
  const byId = id ? candidates.find(candidate => candidate.id === id) : undefined;
  if (byId) return byId;
  const expected = normalized(name ?? id);
  if (!expected) return undefined;
  const matches = candidates.filter(candidate => normalized(getName(candidate)) === expected);
  return matches.length === 1 ? matches[0] : undefined;
}

function resolveTarget(action: AiCommandAction, context: AiPlanningContext): string | undefined {
  if (action.entity === 'transaction') {
    const supported = context.transactions.filter(transaction =>
      TRANSACTION_TYPES.includes(transaction.type),
    );
    const byId = action.targetId
      ? supported.find(transaction => transaction.id === action.targetId)
      : undefined;
    if (byId) return byId.id;
    const expected = normalized(action.targetName ?? action.targetId);
    if (!expected) return undefined;
    const matches = supported.filter(transaction =>
      normalized(transaction.description) === expected ||
      normalized(transaction.merchantName) === expected ||
      normalized(`${transaction.description} ${transaction.amount} ${transaction.date.slice(0, 10)}`) === expected,
    );
    return matches.length === 1 ? matches[0]?.id : undefined;
  }
  if (action.entity === 'debitAccount') {
    return findUnique(
      context.accounts.filter(account => account.type !== 'creditCard' && account.status === 'active'),
      action.targetId,
      action.targetName,
      account => account.name,
    )?.id;
  }
  if (action.entity === 'creditCard') {
    return findUnique(
      context.accounts.filter(account => account.type === 'creditCard' && account.status === 'active'),
      action.targetId,
      action.targetName,
      account => account.name,
    )?.id;
  }
  if (action.entity === 'category') {
    return findUnique(context.categories, action.targetId, action.targetName, category => category.name)?.id;
  }
  return findUnique(context.subcategories, action.targetId, action.targetName, item => item.name)?.id;
}

export function normalizeAiCommandPlan(
  plan: AiCommandPlan,
  context: AiPlanningContext,
): AiCommandPlan {
  const clone = parseAiCommandPlan(JSON.parse(JSON.stringify(plan)) as unknown);
  for (const action of clone.actions) {
    if (action.operation !== 'create') {
      action.targetId = resolveTarget(action, context) ?? action.targetId;
    }
    if (action.entity === 'transaction') {
      const account = findUnique(context.accounts, action.fields.accountId, action.fields.accountName, item => item.name);
      const target = findUnique(context.accounts, action.fields.targetAccountId, action.fields.targetAccountName, item => item.name);
      const category = findUnique(context.categories, action.fields.categoryId, action.fields.categoryName, item => item.name);
      const subcategory = findUnique(context.subcategories, action.fields.subcategoryId, action.fields.subcategoryName, item => item.name);
      if (account) action.fields.accountId = account.id;
      else if (action.fields.accountId && !action.fields.accountRef) action.fields.accountId = undefined;
      if (target) action.fields.targetAccountId = target.id;
      else if (action.fields.targetAccountId && !action.fields.targetAccountRef) action.fields.targetAccountId = undefined;
      if (category) action.fields.categoryId = category.id;
      else if (action.fields.categoryId && !action.fields.categoryRef) action.fields.categoryId = undefined;
      if (subcategory) action.fields.subcategoryId = subcategory.id;
      else if (action.fields.subcategoryId && !action.fields.subcategoryRef) action.fields.subcategoryId = undefined;
      if (action.fields.date && Number.isNaN(new Date(action.fields.date).getTime())) action.fields.date = undefined;
      if (action.fields.amount !== undefined && action.fields.amount !== null && action.fields.amount <= 0) action.fields.amount = undefined;
    } else if (action.entity === 'subcategory') {
      const category = findUnique(context.categories, action.fields.categoryId, action.fields.categoryName, item => item.name);
      if (category) action.fields.categoryId = category.id;
      else if (action.fields.categoryId && !action.fields.categoryRef) action.fields.categoryId = undefined;
    }
  }
  return clone;
}

function option(label: string, value: string): AiClarificationOption {
  return { label, value };
}

function accountOptions(accounts: Account[]): AiClarificationOption[] {
  return accounts.filter(account => account.status === 'active').map(account =>
    option(`${account.name}${account.institutionName ? ` · ${account.institutionName}` : ''}`, account.id),
  );
}

function categoryOptions(categories: Category[]): AiClarificationOption[] {
  return categories.map(category => option(`${category.name} · ${category.type === 'income' ? 'Ingreso' : 'Gasto'}`, category.id));
}

function subcategoryOptions(subcategories: Subcategory[], categoryId?: string | null): AiClarificationOption[] {
  return subcategories
    .filter(item => item.isActive && (!categoryId || item.categoryId === categoryId))
    .map(item => option(item.name, item.id));
}

function transactionOptions(transactions: Transaction[]): AiClarificationOption[] {
  return transactions.filter(transaction => TRANSACTION_TYPES.includes(transaction.type)).slice(0, 20).map(transaction =>
    option(`${transaction.description} · $${transaction.amount.toLocaleString('es-CO')} · ${transaction.date.slice(0, 10)}`, transaction.id),
  );
}

function hasValue(action: AiCommandAction, field: string, plan: AiCommandPlan): boolean {
  const fields = action.fields as Record<string, unknown>;
  if (plan.answeredFields.includes(`${action.id}.${field}`) && fields[field] === null) return true;
  const aliases: Record<string, string[]> = {
    accountId: ['accountRef'],
    categoryId: ['categoryRef'],
    subcategoryId: ['subcategoryRef'],
    targetAccountId: ['targetAccountRef'],
  };
  const value = fields[field];
  if (aliases[field]?.some(alias => {
    const candidate = fields[alias];
    return candidate !== undefined && candidate !== null && candidate !== '';
  })) return true;
  return value !== undefined && value !== null && value !== '';
}

function addQuestion(
  questions: AiClarificationQuestion[],
  plan: AiCommandPlan,
  action: AiCommandAction,
  field: string,
  prompt: string,
  valueType: AiClarificationQuestion['valueType'],
  options: AiClarificationOption[] = [],
  optional = false,
  force = false,
): void {
  if (!force && hasValue(action, field, plan)) return;
  questions.push({
    actionId: action.id,
    allowCustom: true,
    field,
    id: `${action.id}.${field}`,
    optional,
    options,
    prompt,
    valueType,
  });
}

function targetOptions(action: AiCommandAction, context: AiPlanningContext): AiClarificationOption[] {
  if (action.entity === 'transaction') return transactionOptions(context.transactions);
  if (action.entity === 'debitAccount') return accountOptions(context.accounts.filter(item => item.type !== 'creditCard'));
  if (action.entity === 'creditCard') return accountOptions(context.accounts.filter(item => item.type === 'creditCard'));
  if (action.entity === 'category') return categoryOptions(context.categories);
  return subcategoryOptions(context.subcategories);
}

export function buildClarificationQuestions(
  plan: AiCommandPlan,
  context: AiPlanningContext,
): AiClarificationQuestion[] {
  const questions: AiClarificationQuestion[] = [];
  for (const action of plan.actions) {
    if (action.operation !== 'create' && !resolveTarget(action, context)) {
      addQuestion(questions, plan, action, 'targetId', '¿Qué registro quieres modificar o eliminar?', 'string', targetOptions(action, context), false, true);
      continue;
    }
    if (action.operation !== 'create') continue;

    if (action.entity === 'transaction') {
      addQuestion(questions, plan, action, 'transactionType', '¿Qué tipo de movimiento es?', 'string', [
        option('Gasto', 'expense'), option('Ingreso', 'income'), option('Transferencia', 'internalTransfer'),
      ]);
      addQuestion(questions, plan, action, 'amount', '¿Cuál es el valor en COP?', 'number');
      addQuestion(questions, plan, action, 'date', '¿En qué fecha ocurrió?', 'date');
      addQuestion(questions, plan, action, 'description', '¿Cómo quieres describir el movimiento?', 'string');
      addQuestion(questions, plan, action, 'accountId', '¿Qué cuenta o tarjeta se usó?', 'string', accountOptions(context.accounts));
      if (action.fields.transactionType === 'internalTransfer') {
        addQuestion(questions, plan, action, 'targetAccountId', '¿Cuál es la cuenta de destino?', 'string', accountOptions(context.accounts));
        addQuestion(questions, plan, action, 'transferTaxCharged', '¿Se cobró el 4x1000?', 'boolean', [option('Sí', 'true'), option('No', 'false')]);
      } else {
        addQuestion(questions, plan, action, 'categoryId', '¿Qué categoría corresponde?', 'string', [
          ...categoryOptions(context.categories), option('Sin categoría', '__none__'),
        ]);
        addQuestion(questions, plan, action, 'subcategoryId', '¿Qué subcategoría corresponde?', 'string', [
          ...subcategoryOptions(context.subcategories, action.fields.categoryId), option('Sin subcategoría', '__none__'),
        ], true);
      }
      addQuestion(questions, plan, action, 'notes', '¿Quieres agregar notas?', 'string', [option('No aplica', '__none__')], true);
      const account = context.accounts.find(item => item.id === action.fields.accountId);
      if (account?.type === 'creditCard' && action.fields.transactionType === 'expense') {
        addQuestion(questions, plan, action, 'installmentCount', '¿A cuántas cuotas se difiere?', 'number', ['1', '3', '6', '12', '18', '24', '36'].map(value => option(value, value)));
        addQuestion(questions, plan, action, 'interestFreeInstallmentCount', '¿Cuántas cuotas son sin interés?', 'number', [option('Ninguna', '0')]);
      }
    } else if (action.entity === 'debitAccount') {
      addQuestion(questions, plan, action, 'name', '¿Qué nombre tendrá la cuenta o tarjeta débito?', 'string');
      addQuestion(questions, plan, action, 'institutionName', '¿Cuál es el banco o institución?', 'string');
      addQuestion(questions, plan, action, 'initialBalance', '¿Cuál es el saldo inicial en COP?', 'number');
      addQuestion(questions, plan, action, 'recurringIncomeEnabled', '¿Recibe un ingreso recurrente?', 'boolean', [option('Sí', 'true'), option('No', 'false')]);
      if (action.fields.recurringIncomeEnabled) {
        addQuestion(questions, plan, action, 'recurringIncomeAmount', '¿Cuál es el valor del ingreso recurrente?', 'number');
        addQuestion(questions, plan, action, 'recurringIncomeFrequency', '¿Con qué frecuencia llega?', 'string', [option('Quincenal', 'biweekly'), option('Mensual', 'monthly'), option('Día específico', 'specificDay')]);
        addQuestion(questions, plan, action, 'recurringIncomeType', '¿Qué tipo de ingreso es?', 'string', [option('Salario', 'salary'), option('Mesada', 'allowance'), option('Negocio', 'business'), option('Otro', 'other')]);
        if (action.fields.recurringIncomeFrequency === 'specificDay') {
          addQuestion(questions, plan, action, 'recurringIncomeDay', '¿Qué día del mes llega?', 'number');
        }
      }
    } else if (action.entity === 'creditCard') {
      addQuestion(questions, plan, action, 'name', '¿Qué nombre tendrá la tarjeta?', 'string');
      addQuestion(questions, plan, action, 'bankName', '¿Cuál es el banco emisor?', 'string');
      addQuestion(questions, plan, action, 'creditLimit', '¿Cuál es el cupo total en COP?', 'number');
      addQuestion(questions, plan, action, 'lastFourDigits', '¿Cuáles son los últimos cuatro dígitos?', 'string', [option('No aplica', '__none__')], true);
      addQuestion(questions, plan, action, 'closingDay', '¿Cuál es el día de corte?', 'number', [option('No aplica', '__none__')], true);
      addQuestion(questions, plan, action, 'paymentDay', '¿Cuál es el día límite de pago?', 'number', [option('No aplica', '__none__')], true);
      addQuestion(questions, plan, action, 'annualEffectiveInterestRate', '¿Cuál es la tasa efectiva anual? Usa decimal, por ejemplo 0.24.', 'number', [option('No aplica', '__none__')], true);
      addQuestion(questions, plan, action, 'managementFee', '¿Cuál es la cuota de manejo en COP?', 'number', [option('No aplica', '__none__')], true);
    } else if (action.entity === 'category') {
      addQuestion(questions, plan, action, 'name', '¿Cómo se llamará la categoría?', 'string');
      addQuestion(questions, plan, action, 'type', '¿Es de gasto o ingreso?', 'string', [option('Gasto', 'expense'), option('Ingreso', 'income')]);
      addQuestion(questions, plan, action, 'color', '¿Qué color tendrá? Usa un valor hexadecimal.', 'string');
    } else {
      addQuestion(questions, plan, action, 'name', '¿Cómo se llamará la subcategoría?', 'string');
      addQuestion(questions, plan, action, 'categoryId', '¿A qué categoría pertenece?', 'string', categoryOptions(context.categories));
      addQuestion(questions, plan, action, 'color', '¿Qué color tendrá?', 'string', [option('No aplica', '__none__')], true);
    }
  }
  return questions;
}

export function applyClarificationAnswer(
  plan: AiCommandPlan,
  question: AiClarificationQuestion,
  rawValue: string,
): AiCommandPlan {
  const clone = parseAiCommandPlan(JSON.parse(JSON.stringify(plan)) as unknown);
  const action = clone.actions.find(candidate => candidate.id === question.actionId);
  if (!action) throw new Error('La pregunta ya no pertenece al borrador activo.');
  let value: string | number | boolean | null = rawValue.trim();
  if (value === '__none__') value = null;
  else if (question.valueType === 'number') {
    const compact = String(value).replace(/\s/g, '');
    const hasComma = compact.includes(',');
    const hasDot = compact.includes('.');
    let normalizedNumber = compact;
    if (hasComma && hasDot) {
      normalizedNumber = compact.lastIndexOf(',') > compact.lastIndexOf('.')
        ? compact.replace(/\./g, '').replace(',', '.')
        : compact.replace(/,/g, '');
    } else if (hasComma) {
      normalizedNumber = compact.replace(',', '.');
    } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(compact)) {
      normalizedNumber = compact.replace(/\./g, '');
    }
    const parsed = Number(normalizedNumber);
    if (!Number.isFinite(parsed)) throw new Error('Escribe un numero valido.');
    value = parsed;
  } else if (question.valueType === 'boolean') {
    value = value === 'true' || normalized(String(value)) === 'si';
  } else if (question.valueType === 'date') {
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) throw new Error('Escribe una fecha valida.');
    value = parsed.toISOString();
  }

  if (question.field === 'targetId') {
    action.targetId = value === null ? null : String(value);
  } else {
    (action.fields as Record<string, unknown>)[question.field] = value;
  }
  if (!clone.answeredFields.includes(question.id)) clone.answeredFields.push(question.id);
  return clone;
}

export function describeAiAction(action: AiCommandAction): string {
  const verbs: Record<AiActionOperation, string> = { create: 'Crear', update: 'Actualizar', delete: 'Eliminar' };
  const entities: Record<AiActionEntity, string> = {
    transaction: 'movimiento', debitAccount: 'cuenta débito', creditCard: 'tarjeta de crédito', category: 'categoría', subcategory: 'subcategoría',
  };
  const fields = action.fields as Record<string, unknown>;
  const detail = typeof fields.description === 'string' ? fields.description
    : typeof fields.name === 'string' ? fields.name
    : action.targetName ?? action.targetId ?? '';
  return `${verbs[action.operation]} ${entities[action.entity]}${detail ? `: ${detail}` : ''}`;
}
