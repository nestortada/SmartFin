import type { Account } from '../../accounts';
import type { Category, Subcategory } from '../../categories';
import { parseCivilDate, roundSubscriptionMoney } from '../../subscriptions/useCases/recurrence';
import { parseTransactionDate, transactionDateKey } from '../../../shared/utils/transactionDate';
import type {
  AiActionEntity,
  AiActionOperation,
  AiClarificationOption,
  AiClarificationQuestion,
  AiCommandAction,
  AiCommandPlan,
  AiEditableField,
  AiPlanningContext,
  Transaction,
  TransactionType,
} from '../types';

const OPERATIONS: AiActionOperation[] = ['create', 'update', 'delete'];
const ENTITIES: AiActionEntity[] = [
  'transaction', 'debitAccount', 'creditCard', 'category', 'subcategory', 'subscription',
];
const SUBSCRIPTION_PERIODS = ['weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly', 'custom'] as const;
const subscriptionPeriodOptions = () => SUBSCRIPTION_PERIODS.map((value, index) => ({ value, label: ['Semanal', 'Cada 14 días', 'Mensual', 'Bimestral', 'Trimestral', 'Semestral', 'Anual', 'Personalizada'][index]! }));
const TRANSACTION_TYPES: TransactionType[] = ['income', 'expense', 'internalTransfer'];

const NAMED_COLORS: Record<string, string> = {
  amarillo: '#facc15', azul: '#3b82f6', blanco: '#ffffff', cafe: '#92400e',
  celeste: '#38bdf8', gris: '#9ca3af', marron: '#92400e', morado: '#8b5cf6',
  naranja: '#f97316', negro: '#111827', purpura: '#8b5cf6', rojo: '#ef4444',
  rosa: '#ec4899', rosado: '#ec4899', turquesa: '#14b8a6', verde: '#22c55e',
  violeta: '#8b5cf6',
};

const INSTITUTIONS = [
  { aliases: ['davivienda'], name: 'Davivienda' },
  { aliases: ['nu', 'nu bank', 'nubank', 'nu colombia'], name: 'Nu Bank' },
  { aliases: ['bancolombia'], name: 'Bancolombia' },
  { aliases: ['nequi'], name: 'Nequi' },
  { aliases: ['daviplata'], name: 'Daviplata' },
  { aliases: ['banco de bogota'], name: 'Banco de Bogotá' },
  { aliases: ['bbva'], name: 'BBVA' },
  { aliases: ['banco caja social', 'caja social'], name: 'Banco Caja Social' },
] as const;

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

function normalizeReference(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  const normalizedValue = value.trim().replace(/^(?:__ref__|ref:)/i, '');
  return normalizedValue || undefined;
}

function referenceFromId(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && /^(?:__ref__|ref:)/i.test(value.trim())
    ? normalizeReference(value) ?? undefined
    : undefined;
}

function parseBaseAction(value: Record<string, unknown>, index: number) {
  const operation = optionalEnum(value.operation, OPERATIONS);
  const entity = optionalEnum(value.entity, ENTITIES);
  if (!operation || !entity) {
    throw new Error(`La operacion ${index + 1} no tiene un tipo valido.`);
  }
  return {
    clientRef: normalizeReference(optionalString(value.clientRef)) || undefined,
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

  if (base.entity === 'subscription') {
    if (base.operation !== 'create') throw new Error('El asistente solo permite crear suscripciones.');
    const references = Object.fromEntries(['account', 'category', 'subcategory'].flatMap(prefix => {
      const id = optionalString(sourceFields[`${prefix}Id`]);
      return [[`${prefix}Id`, referenceFromId(id) ? undefined : id],
        [`${prefix}Name`, optionalString(sourceFields[`${prefix}Name`])],
        [`${prefix}Ref`, normalizeReference(optionalString(sourceFields[`${prefix}Ref`])) ?? referenceFromId(id)]];
    }));
    return { ...base, entity: 'subscription', fields: {
      ...references,
      name: optionalString(sourceFields.name), merchantName: optionalString(sourceFields.merchantName),
      amount: optionalNumber(sourceFields.amount), anchorDate: optionalString(sourceFields.anchorDate),
      billingDay: optionalNumber(sourceFields.billingDay), periodicity: optionalEnum(sourceFields.periodicity, SUBSCRIPTION_PERIODS),
      customInterval: optionalNumber(sourceFields.customInterval), customUnit: optionalEnum(sourceFields.customUnit, ['days', 'weeks', 'months']),
      remindersEnabled: optionalBoolean(sourceFields.remindersEnabled),
      reminderOffsets: Array.isArray(sourceFields.reminderOffsets) && sourceFields.reminderOffsets.every(item => typeof item === 'number')
        ? sourceFields.reminderOffsets.join(',') : optionalString(sourceFields.reminderOffsets),
      reminderHour: optionalNumber(sourceFields.reminderHour), reminderMinute: optionalNumber(sourceFields.reminderMinute),
    } };
  }

  if (base.entity === 'transaction') {
    const accountId = optionalString(sourceFields.accountId);
    const targetAccountId = optionalString(sourceFields.targetAccountId);
    const categoryId = optionalString(sourceFields.categoryId);
    const subcategoryId = optionalString(sourceFields.subcategoryId);
    return {
      ...base,
      entity: 'transaction',
      fields: {
        accountId: referenceFromId(accountId) ? undefined : accountId,
        accountName: optionalString(sourceFields.accountName),
        accountRef: normalizeReference(optionalString(sourceFields.accountRef)) ?? referenceFromId(accountId),
        amount: optionalNumber(sourceFields.amount),
        categoryId: referenceFromId(categoryId) ? undefined : categoryId,
        categoryName: optionalString(sourceFields.categoryName),
        categoryRef: normalizeReference(optionalString(sourceFields.categoryRef)) ?? referenceFromId(categoryId),
        date: optionalString(sourceFields.date),
        description: optionalString(sourceFields.description),
        installmentCount: optionalNumber(sourceFields.installmentCount),
        interestFreeInstallmentCount: optionalNumber(sourceFields.interestFreeInstallmentCount),
        notes: optionalString(sourceFields.notes),
        pendingAccountKind: optionalEnum(sourceFields.pendingAccountKind, ['debitAccount', 'creditCard']),
        pendingAccountName: optionalString(sourceFields.pendingAccountName),
        subcategoryId: referenceFromId(subcategoryId) ? undefined : subcategoryId,
        subcategoryName: optionalString(sourceFields.subcategoryName),
        subcategoryRef: normalizeReference(optionalString(sourceFields.subcategoryRef)) ?? referenceFromId(subcategoryId),
        targetAccountId: referenceFromId(targetAccountId) ? undefined : targetAccountId,
        targetAccountName: optionalString(sourceFields.targetAccountName),
        targetAccountRef: normalizeReference(optionalString(sourceFields.targetAccountRef)) ?? referenceFromId(targetAccountId),
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

  const categoryId = optionalString(sourceFields.categoryId);
  return {
    ...base,
    entity: 'subcategory',
    fields: {
      categoryId: referenceFromId(categoryId) ? undefined : categoryId,
      categoryName: optionalString(sourceFields.categoryName),
      categoryRef: normalizeReference(optionalString(sourceFields.categoryRef)) ?? referenceFromId(categoryId),
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

export function resolveNamedColor(value: string): string | undefined {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed.slice(1).split('').map(character => `${character}${character}`).join('')}`.toLowerCase();
  }
  return NAMED_COLORS[normalized(trimmed)];
}

function canonicalInstitution(value: string): string {
  const expected = normalized(value);
  return INSTITUTIONS.find(institution =>
    institution.aliases.some(alias => normalized(alias) === expected),
  )?.name ?? value.trim();
}

function formatCop(value?: number | null): string | undefined {
  return typeof value === 'number' ? `$${value.toLocaleString('es-CO')} COP` : undefined;
}

function findLinkedTransaction(
  action: AiCommandAction,
  plan: AiCommandPlan,
): Extract<AiCommandAction, { entity: 'transaction' }> | undefined {
  if (!action.clientRef) return undefined;
  const transactions = plan.actions.filter(
    (candidate): candidate is Extract<AiCommandAction, { entity: 'transaction' }> => candidate.entity === 'transaction',
  );
  return transactions.find(candidate =>
    candidate.fields.accountRef === action.clientRef && candidate.fields.transactionType === 'income',
  ) ?? transactions.find(candidate => candidate.fields.targetAccountRef === action.clientRef)
    ?? transactions.find(candidate => candidate.fields.accountRef === action.clientRef);
}

function actionContextLabel(action: AiCommandAction, plan: AiCommandPlan): string {
  const fields = action.fields as Record<string, unknown>;
  const name = typeof fields.name === 'string' && fields.name
    ? fields.name
    : typeof fields.institutionName === 'string' && fields.institutionName
      ? fields.institutionName
      : typeof fields.bankName === 'string' && fields.bankName
        ? fields.bankName
        : typeof fields.description === 'string' && fields.description
          ? fields.description
          : undefined;
  const linkedTransaction = findLinkedTransaction(action, plan);
  const linkedType = linkedTransaction?.fields.transactionType === 'internalTransfer'
    ? 'transferencia'
    : linkedTransaction?.fields.transactionType === 'income'
      ? 'ingreso'
      : linkedTransaction?.fields.transactionType === 'expense'
        ? 'gasto'
        : undefined;
  const related = linkedType && formatCop(linkedTransaction?.fields.amount)
    ? `${linkedType} de ${formatCop(linkedTransaction?.fields.amount)}`
    : undefined;
  const entity = action.entity === 'transaction' ? 'Movimiento'
    : action.entity === 'subscription' ? 'Suscripción'
    : action.entity === 'debitAccount' ? 'Cuenta'
      : action.entity === 'creditCard' ? 'Tarjeta de crédito'
        : action.entity === 'category' ? 'Categoría'
          : 'Subcategoría';
  const siblings = plan.actions.filter(candidate => candidate.entity === action.entity);
  const position = siblings.findIndex(candidate => candidate.id === action.id);
  const numberedEntity = siblings.length > 1 && position >= 0 ? `${entity} ${position + 1} de ${siblings.length}` : entity;
  const amount = action.entity === 'transaction' ? formatCop(action.fields.amount) : undefined;
  return [numberedEntity, name, related ?? amount].filter(Boolean).join(' · ');
}

function institutionOptions(
  plan: AiCommandPlan,
  context: AiPlanningContext,
  sourceText: string,
): AiClarificationOption[] {
  const source = normalized(sourceText);
  const mentionsAlias = (alias: string) => {
    const expected = normalized(alias);
    return expected.length <= 3
      ? source.split(/[^a-z0-9]+/).includes(expected)
      : source.includes(expected);
  };
  const detected = INSTITUTIONS.filter(institution =>
    institution.aliases.some(mentionsAlias),
  ).map(institution => institution.name);
  const planned = plan.actions.flatMap(action => {
    if (action.entity === 'debitAccount') return action.fields.institutionName ? [action.fields.institutionName] : [];
    if (action.entity === 'creditCard') return action.fields.bankName ? [action.fields.bankName] : [];
    return [];
  });
  const existing = context.accounts.flatMap(account => account.institutionName ? [account.institutionName] : []);
  const names = [...detected, ...planned, ...existing, ...INSTITUTIONS.map(item => item.name)];
  return [...new Map(names.map(name => [normalized(name), canonicalInstitution(name)])).values()]
    .slice(0, 10)
    .map(name => option(name, name));
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
      normalized(`${transaction.description} ${transaction.amount} ${transactionDateKey(transaction)}`) === expected,
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

function referenceSuffix(value: string): string | undefined {
  return value.match(/(?:^|[-_])(\d+)$/)?.[1];
}

function ensureClientReference(
  plan: AiCommandPlan,
  reference: string | null | undefined,
  entities: AiActionEntity[],
): void {
  if (!reference || plan.actions.some(action => action.clientRef === reference)) return;
  const candidates = plan.actions.filter(action =>
    action.operation === 'create' && entities.includes(action.entity) && !action.clientRef,
  );
  const exact = candidates.find(action => action.id === reference || normalizeReference(action.id) === reference);
  const suffix = referenceSuffix(reference);
  const suffixMatches = suffix ? candidates.filter(action => referenceSuffix(action.id) === suffix) : [];
  const target = exact ?? (suffixMatches.length === 1 ? suffixMatches[0] : undefined);
  if (target) target.clientRef = reference;
}

function repairPlanReferences(plan: AiCommandPlan): void {
  for (const action of plan.actions) {
    if (action.entity === 'subscription') {
      ensureClientReference(plan, action.fields.accountRef, ['debitAccount', 'creditCard']);
      ensureClientReference(plan, action.fields.categoryRef, ['category']);
      ensureClientReference(plan, action.fields.subcategoryRef, ['subcategory']);
    }
    if (action.entity === 'transaction') {
      ensureClientReference(plan, action.fields.accountRef, ['debitAccount', 'creditCard']);
      ensureClientReference(plan, action.fields.targetAccountRef, ['debitAccount', 'creditCard']);
      ensureClientReference(plan, action.fields.categoryRef, ['category']);
      ensureClientReference(plan, action.fields.subcategoryRef, ['subcategory']);
    } else if (action.entity === 'subcategory') {
      ensureClientReference(plan, action.fields.categoryRef, ['category']);
    }
  }
}

export function normalizeAiCommandPlan(
  plan: AiCommandPlan,
  context: AiPlanningContext,
): AiCommandPlan {
  const clone = parseAiCommandPlan(JSON.parse(JSON.stringify(plan)) as unknown);
  repairPlanReferences(clone);
  for (const action of clone.actions) {
    if (action.entity === 'subscription') {
      const fields = action.fields;
      const account = findUnique(context.accounts.filter(item => item.status === 'active' && item.currency === 'COP' && ['cash', 'bankAccount', 'savingsAccount', 'creditCard'].includes(item.type)), fields.accountId, fields.accountName, item => item.name);
      const category = findUnique(context.categories.filter(item => item.type === 'expense'), fields.categoryId, fields.categoryName, item => item.name);
      const subcategory = findUnique(context.subcategories.filter(item => item.isActive && (!category || item.categoryId === category.id)), fields.subcategoryId, fields.subcategoryName, item => item.name);
      fields.accountId = account?.id ?? (fields.accountId === null ? null : undefined);
      fields.categoryId = category?.id ?? subcategory?.categoryId ?? (fields.categoryId === null ? null : undefined);
      fields.subcategoryId = subcategory?.id ?? (fields.subcategoryId === null ? null : undefined);
      try { if (fields.anchorDate) parseCivilDate(fields.anchorDate); } catch { fields.anchorDate = undefined; }
      try { if (fields.amount != null && roundSubscriptionMoney(fields.amount) <= 0) fields.amount = undefined; } catch { fields.amount = undefined; }
      if (fields.customInterval != null && (!Number.isSafeInteger(fields.customInterval) || fields.customInterval <= 0)) fields.customInterval = undefined;
      if (fields.billingDay != null && (!Number.isInteger(fields.billingDay) || fields.billingDay < 1 || fields.billingDay > 31)) fields.billingDay = undefined;
      if (fields.reminderHour != null && (!Number.isInteger(fields.reminderHour) || fields.reminderHour < 0 || fields.reminderHour > 23)) fields.reminderHour = undefined;
      if (fields.reminderMinute != null && (!Number.isInteger(fields.reminderMinute) || fields.reminderMinute < 0 || fields.reminderMinute > 59)) fields.reminderMinute = undefined;
      if (fields.reminderOffsets != null && (!/^\d+(?:\s*,\s*\d+)*$/.test(fields.reminderOffsets) || fields.reminderOffsets.split(',').length > 16 || fields.reminderOffsets.split(',').some(value => Number(value) > 365))) fields.reminderOffsets = undefined;
      continue;
    }
    if (action.operation !== 'create') {
      action.targetId = resolveTarget(action, context) ?? action.targetId;
    }
    if (action.entity === 'transaction') {
      const account = findUnique(context.accounts, action.fields.accountId, action.fields.accountName, item => item.name);
      const target = findUnique(context.accounts, action.fields.targetAccountId, action.fields.targetAccountName, item => item.name);
      const compatibleCategories = context.categories.filter(category =>
        !action.fields.transactionType ||
        action.fields.transactionType === 'internalTransfer' ||
        category.type === action.fields.transactionType,
      );
      const category = findUnique(compatibleCategories, action.fields.categoryId, action.fields.categoryName, item => item.name);
      const subcategory = findUnique(context.subcategories, action.fields.subcategoryId, action.fields.subcategoryName, item => item.name);
      if (account) action.fields.accountId = account.id;
      else if (action.fields.accountId && !action.fields.accountRef) action.fields.accountId = undefined;
      if (target) action.fields.targetAccountId = target.id;
      else if (action.fields.targetAccountId && !action.fields.targetAccountRef) action.fields.targetAccountId = undefined;
      if (category) action.fields.categoryId = category.id;
      else if (action.fields.categoryId && !action.fields.categoryRef) action.fields.categoryId = undefined;
      if (subcategory && (!category || subcategory.categoryId === category.id)) {
        action.fields.subcategoryId = subcategory.id;
        if (!action.fields.categoryId && !action.fields.categoryRef) action.fields.categoryId = subcategory.categoryId;
      }
      else if (action.fields.subcategoryId && !action.fields.subcategoryRef) action.fields.subcategoryId = undefined;
      // Keep invalid supplied dates so clarification cannot silently erase an edit.
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

function colorOptions(limit?: number): AiClarificationOption[] {
  const seen = new Set<string>();
  const options: AiClarificationOption[] = [];
  for (const [name, color] of Object.entries(NAMED_COLORS)) {
    if (seen.has(color)) continue;
    seen.add(color);
    options.push(option(name.charAt(0).toUpperCase() + name.slice(1), color));
    if (limit && options.length >= limit) break;
  }
  return options;
}

function accountOptions(accounts: Account[]): AiClarificationOption[] {
  return accounts.filter(account => account.status === 'active').map(account =>
    option(`${account.name}${account.institutionName ? ` · ${account.institutionName}` : ''}`, account.id),
  );
}

function categoryOptions(categories: Category[], transactionType?: TransactionType | null): AiClarificationOption[] {
  return categories
    .filter(category => !transactionType || transactionType === 'internalTransfer' || category.type === transactionType)
    .map(category => option(`${category.name} · ${category.type === 'income' ? 'Ingreso' : 'Gasto'}`, category.id));
}

function subcategoryOptions(subcategories: Subcategory[], categoryId?: string | null): AiClarificationOption[] {
  return subcategories
    .filter(item => item.isActive && (!categoryId || item.categoryId === categoryId))
    .map(item => option(item.name, item.id));
}

function transactionOptions(transactions: Transaction[]): AiClarificationOption[] {
  return transactions.filter(transaction => TRANSACTION_TYPES.includes(transaction.type)).slice(0, 20).map(transaction =>
    option(`${transaction.description} · $${transaction.amount.toLocaleString('es-CO')} · ${transactionDateKey(transaction)}`, transaction.id),
  );
}

function hasValue(action: AiCommandAction, field: string, plan: AiCommandPlan): boolean {
  const fields = action.fields as Record<string, unknown>;
  if (plan.answeredFields.includes(`${action.id}.${field}`) && fields[field] === null) return true;
  const aliases: Record<string, string[]> = {
    accountId: ['accountRef', 'pendingAccountName'],
    categoryId: ['categoryRef'],
    subcategoryId: ['subcategoryRef'],
    targetAccountId: ['targetAccountRef'],
  };
  const value = fields[field];
  if (aliases[field]?.some(alias => {
    const candidate = fields[alias];
    if (candidate === undefined || candidate === null || candidate === '') return false;
    return alias.endsWith('Ref') && typeof candidate === 'string'
      ? plan.actions.some(planAction => planAction.clientRef === candidate)
      : true;
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
  allowCustom = true,
): void {
  if (!force && hasValue(action, field, plan)) return;
  questions.push({
    actionId: action.id,
    allowCustom,
    contextLabel: actionContextLabel(action, plan),
    field,
    helpText: field === 'recurringIncomeEnabled'
      ? 'Un movimiento recibido una sola vez no es un ingreso recurrente.'
      : field === 'color'
        ? 'Puedes escribir el nombre del color; SmartFin lo convertirá localmente.'
        : undefined,
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
  sourceText = '',
): AiClarificationQuestion[] {
  const questions: AiClarificationQuestion[] = [];
  for (const action of plan.actions) {
    if (action.operation !== 'create' && !resolveTarget(action, context)) {
      addQuestion(questions, plan, action, 'targetId', '¿Qué registro quieres modificar o eliminar?', 'string', targetOptions(action, context), false, true);
      continue;
    }
    if (action.entity === 'transaction' && action.operation !== 'delete' && action.fields.date) {
      try { parseTransactionDate(action.fields.date); }
      catch { addQuestion(questions, plan, action, 'date', 'Indica una fecha válida YYYY-MM-DD y una hora opcional HH:mm.', 'date', [], false, true); }
    }
    if (action.operation !== 'create') continue;

    if (action.entity === 'subscription') {
      addQuestion(questions, plan, action, 'name', '¿Cómo se llama la suscripción?', 'string');
      addQuestion(questions, plan, action, 'merchantName', '¿Cuál es el comercio o proveedor?', 'string', [option('Sin comercio adicional', '__none__')], true);
      addQuestion(questions, plan, action, 'amount', '¿Cuál es el importe del cobro en COP?', 'number');
      addQuestion(questions, plan, action, 'anchorDate', '¿Cuál es la fecha contractual del primer cobro? Usa YYYY-MM-DD.', 'string');
      addQuestion(questions, plan, action, 'billingDay', '¿Qué día contractual de facturación tiene (1–31)?', 'number', [option('Usar el día de la fecha contractual', '__none__')], true);
      addQuestion(questions, plan, action, 'periodicity', '¿Cada cuánto se cobra?', 'string', subscriptionPeriodOptions(), false, false, false);
      if (action.fields.periodicity === 'custom') {
        addQuestion(questions, plan, action, 'customInterval', '¿Cada cuántas unidades se repite?', 'number');
        addQuestion(questions, plan, action, 'customUnit', '¿Días, semanas o meses?', 'string', [option('Días', 'days'), option('Semanas', 'weeks'), option('Meses', 'months')], false, false, false);
      }
      addQuestion(questions, plan, action, 'accountId', '¿Qué cuenta se espera usar? También puedes dejarla sin cuenta.', 'string', [...editableOptions(action, 'accountId', plan, context, sourceText), option('Sin cuenta asignada', '__none__')], true, false, false);
      addQuestion(questions, plan, action, 'categoryId', '¿Qué categoría de gasto corresponde? Puedes escribir una nueva.', 'string', editableOptions(action, 'categoryId', plan, context, sourceText), true);
      if (action.fields.categoryId || action.fields.categoryRef) addQuestion(questions, plan, action, 'subcategoryId', '¿Qué subcategoría corresponde? Puedes escribir una nueva.', 'string', editableOptions(action, 'subcategoryId', plan, context, sourceText), true);
      addQuestion(questions, plan, action, 'remindersEnabled', '¿Quieres recordatorios de estos cobros?', 'boolean', [option('Sí', 'true'), option('No', 'false')], false, false, false);
      if (action.fields.remindersEnabled) {
        addQuestion(questions, plan, action, 'reminderOffsets', '¿Cuántos días antes quieres los recordatorios? Separa con comas.', 'string', [option('3 días, 1 día y el día del cobro', '3,1,0')]);
        addQuestion(questions, plan, action, 'reminderHour', '¿A qué hora (0–23) del dispositivo?', 'number', [option('09:00', '9')]);
        addQuestion(questions, plan, action, 'reminderMinute', '¿En qué minuto (0–59)?', 'number', [option('En punto', '0')]);
      }
      continue;
    }

    if (action.entity === 'transaction') {
      addQuestion(questions, plan, action, 'transactionType', '¿Qué tipo de movimiento es?', 'string', [
        option('Gasto', 'expense'), option('Ingreso', 'income'), option('Transferencia', 'internalTransfer'),
      ]);
      addQuestion(questions, plan, action, 'amount', '¿Cuál es el valor en COP?', 'number');
      addQuestion(questions, plan, action, 'date', '¿En qué fecha ocurrió?', 'date');
      addQuestion(questions, plan, action, 'description', '¿Cómo quieres describir el movimiento?', 'string');
      addQuestion(questions, plan, action, 'accountId', '¿Qué cuenta o tarjeta se usó? Si no aparece, escribe el banco o institución.', 'string', accountOptions(context.accounts));
      if (action.fields.pendingAccountName && !action.fields.accountRef) {
        addQuestion(questions, plan, action, 'pendingAccountKind', `¿Qué quieres crear en ${action.fields.pendingAccountName}?`, 'string', [
          option('Cuenta bancaria o débito', 'debitAccount'),
          option('Tarjeta de crédito', 'creditCard'),
        ], false, false, false);
      }
      if (action.fields.transactionType === 'internalTransfer') {
        addQuestion(questions, plan, action, 'targetAccountId', '¿Cuál es la cuenta de destino?', 'string', accountOptions(context.accounts));
        addQuestion(questions, plan, action, 'transferTaxCharged', '¿Se cobró el 4x1000?', 'boolean', [option('Sí', 'true'), option('No', 'false')]);
      } else {
        addQuestion(questions, plan, action, 'categoryId', '¿Qué categoría corresponde? Si no aparece, escribe un nombre para crearla.', 'string', [
          ...categoryOptions(context.categories, action.fields.transactionType), option('Sin categoría', '__none__'),
        ]);
        addQuestion(questions, plan, action, 'subcategoryId', '¿Qué subcategoría corresponde? Si no aparece, escribe un nombre para crearla.', 'string', [
          ...subcategoryOptions(context.subcategories, action.fields.categoryId), option('Sin subcategoría', '__none__'),
        ], true);
      }
      addQuestion(questions, plan, action, 'notes', '¿Quieres agregar notas?', 'string', [option('No aplica', '__none__')], true);
      const account = context.accounts.find(item => item.id === action.fields.accountId);
      const referencedAccount = plan.actions.find(candidate =>
        candidate.clientRef && candidate.clientRef === action.fields.accountRef,
      );
      const usesCreditCard = account?.type === 'creditCard' || referencedAccount?.entity === 'creditCard';
      if (usesCreditCard && action.fields.transactionType === 'expense') {
        addQuestion(questions, plan, action, 'installmentCount', '¿A cuántas cuotas se difiere?', 'number', ['1', '3', '6', '12', '18', '24', '36'].map(value => option(value, value)));
        addQuestion(questions, plan, action, 'interestFreeInstallmentCount', '¿Cuántas cuotas son sin interés?', 'number', [option('Ninguna', '0')]);
      }
    } else if (action.entity === 'debitAccount') {
      addQuestion(questions, plan, action, 'name', '¿Qué nombre tendrá la cuenta o tarjeta débito?', 'string');
      addQuestion(questions, plan, action, 'institutionName', '¿Cuál es el banco o institución de esta cuenta?', 'string', institutionOptions(plan, context, sourceText));
      addQuestion(questions, plan, action, 'initialBalance', '¿Cuál es el saldo inicial en COP?', 'number');
      const linkedIncome = findLinkedTransaction(action, plan);
      const recurringSubject = linkedIncome?.entity === 'transaction' && linkedIncome.fields.amount
        ? `${linkedIncome.fields.transactionType === 'internalTransfer' ? 'esta transferencia' : 'este ingreso'} de ${formatCop(linkedIncome.fields.amount)}`
        : 'algún ingreso';
      addQuestion(questions, plan, action, 'recurringIncomeEnabled', `¿${recurringSubject} se repetirá automáticamente en esta cuenta?`, 'boolean', [
        option('Sí, se repetirá', 'true'), option('No, ocurre solo esta vez', 'false'),
      ]);
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
      addQuestion(questions, plan, action, 'bankName', '¿Cuál es el banco emisor de esta tarjeta?', 'string', institutionOptions(plan, context, sourceText));
      addQuestion(questions, plan, action, 'creditLimit', '¿Cuál es el cupo total en COP?', 'number');
      addQuestion(questions, plan, action, 'lastFourDigits', '¿Cuáles son los últimos cuatro dígitos?', 'string', [option('No aplica', '__none__')], true);
      addQuestion(questions, plan, action, 'closingDay', '¿Cuál es el día de corte?', 'number', [option('No aplica', '__none__')], true);
      addQuestion(questions, plan, action, 'paymentDay', '¿Cuál es el día límite de pago?', 'number', [option('No aplica', '__none__')], true);
      addQuestion(questions, plan, action, 'annualEffectiveInterestRate', '¿Cuál es la tasa efectiva anual? Usa decimal, por ejemplo 0.24.', 'number', [option('No aplica', '__none__')], true);
      addQuestion(questions, plan, action, 'managementFee', '¿Cuál es la cuota de manejo en COP?', 'number', [option('No aplica', '__none__')], true);
    } else if (action.entity === 'category') {
      addQuestion(questions, plan, action, 'name', '¿Cómo se llamará la categoría?', 'string');
      addQuestion(questions, plan, action, 'type', '¿Es de gasto o ingreso?', 'string', [option('Gasto', 'expense'), option('Ingreso', 'income')]);
      addQuestion(questions, plan, action, 'color', '¿Qué color tendrá?', 'string', colorOptions(8));
    } else {
      addQuestion(questions, plan, action, 'name', '¿Cómo se llamará la subcategoría?', 'string');
      addQuestion(questions, plan, action, 'categoryId', '¿A qué categoría pertenece?', 'string', categoryOptions(context.categories));
      addQuestion(questions, plan, action, 'color', '¿Qué color tendrá?', 'string', [
        ...colorOptions(8),
        option('No aplica', '__none__'),
      ], true);
    }
  }
  return questions;
}

export function applyClarificationAnswer(
  plan: AiCommandPlan,
  question: AiClarificationQuestion,
  rawValue: string,
  context?: AiPlanningContext,
): AiCommandPlan {
  const clone = parseAiCommandPlan(JSON.parse(JSON.stringify(plan)) as unknown);
  const action = clone.actions.find(candidate => candidate.id === question.actionId);
  if (!action) throw new Error('La pregunta ya no pertenece al borrador activo.');
  const trimmedValue = rawValue.trim();
  const selectedOption = question.options.some(optionItem => optionItem.value === trimmedValue);

  if (
    context &&
    action.entity === 'transaction' &&
    !selectedOption &&
    trimmedValue &&
    question.field === 'accountId'
  ) {
    const normalizedAccount = normalized(trimmedValue);
    const matches = context.accounts.filter(account =>
      account.status === 'active' && (
        normalized(account.name) === normalizedAccount ||
        normalized(account.institutionName) === normalizedAccount
      ),
    );
    if (matches.length === 1) {
      action.fields.accountId = matches[0]?.id;
      action.fields.accountName = matches[0]?.name;
    } else {
      action.fields.accountId = undefined;
      action.fields.accountName = undefined;
      action.fields.pendingAccountName = trimmedValue;
      action.fields.pendingAccountKind = undefined;
    }
    if (!clone.answeredFields.includes(question.id)) clone.answeredFields.push(question.id);
    return clone;
  }

  if (
    action.entity === 'transaction' &&
    question.field === 'pendingAccountKind' &&
    action.fields.pendingAccountName
  ) {
    if (trimmedValue !== 'debitAccount' && trimmedValue !== 'creditCard') {
      throw new Error('Selecciona si deseas crear una cuenta o una tarjeta de credito.');
    }
    if (clone.actions.length >= 20) {
      throw new Error('El lote ya alcanzo el limite de 20 operaciones.');
    }
    const actionIndex = clone.actions.findIndex(candidate => candidate.id === action.id);
    const reference = `${action.id}-account-ref`;
    const createId = `${action.id}-create-account`;
    clone.actions.splice(actionIndex, 0, trimmedValue === 'creditCard' ? {
      clientRef: reference,
      entity: 'creditCard',
      fields: { bankName: action.fields.pendingAccountName },
      id: createId,
      operation: 'create',
    } : {
      clientRef: reference,
      entity: 'debitAccount',
      fields: { institutionName: action.fields.pendingAccountName },
      id: createId,
      operation: 'create',
    });
    action.fields.accountRef = reference;
    action.fields.pendingAccountKind = undefined;
    action.fields.pendingAccountName = undefined;
    if (!clone.answeredFields.includes(question.id)) clone.answeredFields.push(question.id);
    return clone;
  }

  if (
    context &&
    (action.entity === 'transaction' || action.entity === 'subscription') &&
    !selectedOption &&
    trimmedValue &&
    (question.field === 'categoryId' || question.field === 'subcategoryId')
  ) {
    const actionIndex = clone.actions.findIndex(candidate => candidate.id === action.id);
    const normalizedName = normalized(trimmedValue);
    if (question.field === 'categoryId') {
      const expectedType = action.entity === 'transaction' && action.fields.transactionType === 'income' ? 'income' : 'expense';
      const matches = context.categories.filter(category =>
        category.type === expectedType && normalized(category.name) === normalizedName,
      );
      if (matches.length === 1) {
        action.fields.categoryId = matches[0]?.id;
        action.fields.categoryName = matches[0]?.name;
      } else {
        if (clone.actions.length >= 20) {
          throw new Error('El lote ya alcanzo el limite de 20 operaciones.');
        }
        const reference = `${action.id}-category-ref`;
        const createId = `${action.id}-create-category`;
        clone.actions.splice(actionIndex, 0, {
          clientRef: reference,
          entity: 'category',
          fields: { name: trimmedValue, type: expectedType },
          id: createId,
          operation: 'create',
        });
        action.fields.categoryId = undefined;
        action.fields.categoryName = trimmedValue;
        action.fields.categoryRef = reference;
      }
    } else {
      const categoryId = action.fields.categoryId;
      const matches = context.subcategories.filter(subcategory =>
        subcategory.isActive &&
        normalized(subcategory.name) === normalizedName &&
        (!categoryId || subcategory.categoryId === categoryId),
      );
      if (matches.length === 1) {
        action.fields.subcategoryId = matches[0]?.id;
        action.fields.subcategoryName = matches[0]?.name;
      } else {
        if (!action.fields.categoryId && !action.fields.categoryRef) {
          throw new Error('Selecciona primero la categoria de la nueva subcategoria.');
        }
        if (clone.actions.length >= 20) {
          throw new Error('El lote ya alcanzo el limite de 20 operaciones.');
        }
        const reference = `${action.id}-subcategory-ref`;
        const createId = `${action.id}-create-subcategory`;
        clone.actions.splice(actionIndex, 0, {
          clientRef: reference,
          entity: 'subcategory',
          fields: {
            categoryId: action.fields.categoryId,
            categoryRef: action.fields.categoryRef,
            name: trimmedValue,
          },
          id: createId,
          operation: 'create',
        });
        action.fields.subcategoryId = undefined;
        action.fields.subcategoryName = trimmedValue;
        action.fields.subcategoryRef = reference;
      }
    }
    if (!clone.answeredFields.includes(question.id)) clone.answeredFields.push(question.id);
    return clone;
  }
  let value: string | number | boolean | null = trimmedValue;
  if (value === '__none__') value = null;
  else if (question.field === 'color') {
    const resolvedColor = resolveNamedColor(String(value));
    if (!resolvedColor) {
      throw new Error('No reconozco ese color. Escribe, por ejemplo, azul, verde, morado o #3b82f6.');
    }
    value = resolvedColor;
  } else if (question.field === 'institutionName' || question.field === 'bankName') {
    value = canonicalInstitution(String(value));
  }
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
    const parsed = parseTransactionDate(String(value));
    value = parsed.kind === 'date' ? parsed.date : `${parsed.date}T${parsed.time}:00-05:00`;
  }

  if (question.field === 'targetId') {
    action.targetId = value === null ? null : String(value);
  } else {
    (action.fields as Record<string, unknown>)[question.field] = value;
  }
  if (action.entity === 'debitAccount' && question.field === 'recurringIncomeEnabled' && value === false) {
    action.fields.recurringIncomeAmount = undefined;
    action.fields.recurringIncomeDay = undefined;
    action.fields.recurringIncomeFrequency = undefined;
    action.fields.recurringIncomeType = undefined;
  }
  if (!clone.answeredFields.includes(question.id)) clone.answeredFields.push(question.id);
  return clone;
}

const FIELD_LABELS: Record<string, string> = {
  anchorDate: 'Fecha contractual', billingDay: 'Día de facturación', merchantName: 'Comercio', periodicity: 'Periodicidad',
  customInterval: 'Intervalo personalizado', customUnit: 'Unidad personalizada', remindersEnabled: 'Recordatorios',
  reminderOffsets: 'Días de anticipación', reminderHour: 'Hora del dispositivo', reminderMinute: 'Minuto',
  accountId: 'Cuenta origen', amount: 'Valor', annualEffectiveInterestRate: 'Tasa E.A.',
  bankName: 'Banco', categoryId: 'Categoría', closingDay: 'Día de corte', color: 'Color',
  creditLimit: 'Cupo', date: 'Fecha', description: 'Descripción', initialBalance: 'Saldo inicial',
  installmentCount: 'Cuotas', institutionName: 'Institución', interestFreeInstallmentCount: 'Cuotas sin interés',
  lastFourDigits: 'Últimos dígitos', managementFee: 'Cuota de manejo', name: 'Nombre', notes: 'Notas',
  paymentDay: 'Día de pago', recurringIncomeAmount: 'Ingreso recurrente', recurringIncomeDay: 'Día del ingreso',
  recurringIncomeEnabled: 'Ingreso recurrente', recurringIncomeFrequency: 'Frecuencia',
  recurringIncomeType: 'Tipo de ingreso', subcategoryId: 'Subcategoría', targetAccountId: 'Cuenta destino',
  transactionType: 'Tipo de movimiento', transferTaxCharged: '4x1000', type: 'Tipo',
};

function editableFieldNames(action: AiCommandAction, plan: AiCommandPlan, context: AiPlanningContext): string[] {
  if (action.operation === 'delete') return [];
  if (action.entity === 'subscription') return [
    'name', 'merchantName', 'amount', 'anchorDate', 'billingDay', 'periodicity',
    ...(action.fields.periodicity === 'custom' ? ['customInterval', 'customUnit'] : []),
    'accountId', 'categoryId', 'subcategoryId', 'remindersEnabled',
    ...(action.fields.remindersEnabled ? ['reminderOffsets', 'reminderHour', 'reminderMinute'] : []),
  ];
  if (action.entity === 'transaction') {
    const fields = ['transactionType', 'amount', 'date', 'description', 'accountId'];
    if (action.fields.transactionType === 'internalTransfer') {
      fields.push('targetAccountId', 'transferTaxCharged');
    } else {
      fields.push('categoryId', 'subcategoryId', 'notes');
      const account = context.accounts.find(item => item.id === action.fields.accountId);
      const referenced = plan.actions.find(candidate => candidate.clientRef === action.fields.accountRef);
      if (action.fields.transactionType === 'expense' && (account?.type === 'creditCard' || referenced?.entity === 'creditCard')) {
        fields.push('installmentCount', 'interestFreeInstallmentCount');
      }
    }
    return fields;
  }
  if (action.entity === 'debitAccount') {
    const fields = ['name', 'institutionName', 'initialBalance', 'recurringIncomeEnabled'];
    if (action.fields.recurringIncomeEnabled) {
      fields.push('recurringIncomeAmount', 'recurringIncomeFrequency', 'recurringIncomeType');
      if (action.fields.recurringIncomeFrequency === 'specificDay') fields.push('recurringIncomeDay');
    }
    return fields;
  }
  if (action.entity === 'creditCard') {
    return ['name', 'bankName', 'creditLimit', 'lastFourDigits', 'closingDay', 'paymentDay', 'annualEffectiveInterestRate', 'managementFee'];
  }
  if (action.entity === 'category') return ['name', 'type', 'color'];
  return ['name', 'categoryId', 'color'];
}

function editableOptions(
  action: AiCommandAction,
  field: string,
  plan: AiCommandPlan,
  context: AiPlanningContext,
  sourceText: string,
): AiClarificationOption[] {
  if (action.entity === 'subscription') {
    if (field === 'periodicity') return subscriptionPeriodOptions();
    if (field === 'customUnit') return [option('Días', 'days'), option('Semanas', 'weeks'), option('Meses', 'months')];
    if (field === 'remindersEnabled') return [option('Sí', 'true'), option('No', 'false')];
    if (field === 'accountId') return [
      ...accountOptions(context.accounts.filter(item => item.currency === 'COP' && ['cash', 'bankAccount', 'savingsAccount', 'creditCard'].includes(item.type))),
      ...plan.actions.flatMap(candidate => candidate.clientRef && (candidate.entity === 'debitAccount' || candidate.entity === 'creditCard') ? [option(`${candidate.fields.name ?? 'Cuenta nueva'} · se creará con este lote`, `__ref__${candidate.clientRef}`)] : []),
      option('Sin cuenta asignada', '__none__'),
    ];
    if (field === 'billingDay' || field === 'merchantName') return [option('No aplica', '__none__')];
  }
  if (field === 'transactionType') return [option('Gasto', 'expense'), option('Ingreso', 'income'), option('Transferencia', 'internalTransfer')];
  if (field === 'accountId' || field === 'targetAccountId') return [
    ...accountOptions(context.accounts),
    ...plan.actions.flatMap(candidate => {
      if (!candidate.clientRef || (candidate.entity !== 'debitAccount' && candidate.entity !== 'creditCard')) return [];
      const label = candidate.fields.name ?? (candidate.entity === 'debitAccount' ? candidate.fields.institutionName : candidate.fields.bankName) ?? 'Cuenta nueva';
      return [option(`${label} · se creará con este lote`, `__ref__${candidate.clientRef}`)];
    }),
  ];
  if (field === 'categoryId') return [
    ...categoryOptions(context.categories, action.entity === 'subscription' ? 'expense' : action.entity === 'transaction' ? action.fields.transactionType : undefined),
    ...plan.actions.flatMap(candidate => candidate.entity === 'category' && candidate.clientRef
      ? [option(`${candidate.fields.name ?? 'Categoría nueva'} · se creará con este lote`, `__ref__${candidate.clientRef}`)]
      : []),
    ...(action.entity === 'transaction' || action.entity === 'subscription' ? [option('Sin categoría', '__none__')] : []),
  ];
  if (field === 'subcategoryId') return [
    ...subcategoryOptions(context.subcategories, action.entity === 'transaction' || action.entity === 'subscription' ? action.fields.categoryId : undefined),
    ...plan.actions.flatMap(candidate => candidate.entity === 'subcategory' && candidate.clientRef
      ? [option(`${candidate.fields.name ?? 'Subcategoría nueva'} · se creará con este lote`, `__ref__${candidate.clientRef}`)]
      : []),
    option('Sin subcategoría', '__none__'),
  ];
  if (field === 'transferTaxCharged' || field === 'recurringIncomeEnabled') return [option('Sí', 'true'), option('No', 'false')];
  if (field === 'recurringIncomeFrequency') return [option('Quincenal', 'biweekly'), option('Mensual', 'monthly'), option('Día específico', 'specificDay')];
  if (field === 'recurringIncomeType') return [option('Salario', 'salary'), option('Mesada', 'allowance'), option('Negocio', 'business'), option('Otro', 'other')];
  if (field === 'type') return [option('Gasto', 'expense'), option('Ingreso', 'income')];
  if (field === 'institutionName' || field === 'bankName') return institutionOptions(plan, context, sourceText);
  if (field === 'color') return colorOptions();
  if (field === 'installmentCount') return ['1', '3', '6', '12', '18', '24', '36'].map(value => option(value, value));
  if (field === 'interestFreeInstallmentCount') return [option('Ninguna', '0')];
  if (['lastFourDigits', 'closingDay', 'paymentDay', 'annualEffectiveInterestRate', 'managementFee'].includes(field)) return [option('No aplica', '__none__')];
  return [];
}

function editableValueType(field: string): AiClarificationQuestion['valueType'] {
  if (field === 'date') return 'date';
  if (field === 'transferTaxCharged' || field === 'recurringIncomeEnabled' || field === 'remindersEnabled') return 'boolean';
  if ([
    'amount', 'annualEffectiveInterestRate', 'closingDay', 'creditLimit', 'initialBalance',
    'installmentCount', 'interestFreeInstallmentCount', 'managementFee', 'paymentDay',
    'recurringIncomeAmount', 'recurringIncomeDay', 'billingDay', 'customInterval', 'reminderHour', 'reminderMinute',
  ].includes(field)) return 'number';
  return 'string';
}

export function buildEditableFields(
  action: AiCommandAction,
  plan: AiCommandPlan,
  context: AiPlanningContext,
  sourceText = '',
): AiEditableField[] {
  const fields = action.fields as Record<string, unknown>;
  return editableFieldNames(action, plan, context).map(field => {
    const referenceAliases: Record<string, string> = {
      accountId: 'accountRef', categoryId: 'categoryRef', subcategoryId: 'subcategoryRef', targetAccountId: 'targetAccountRef',
    };
    const reference = referenceAliases[field] ? fields[referenceAliases[field] as string] : undefined;
    const rawValue = fields[field] ?? (typeof reference === 'string' ? `__ref__${reference}` : undefined);
    return {
      actionId: action.id,
      allowCustom: ![
        'transactionType', 'transferTaxCharged', 'recurringIncomeEnabled', 'recurringIncomeFrequency',
        'recurringIncomeType', 'type',
        'periodicity', 'customUnit', 'remindersEnabled',
      ].includes(field),
      field,
      label: FIELD_LABELS[field] ?? field,
      options: editableOptions(action, field, plan, context, sourceText),
      value: rawValue === undefined || rawValue === null ? '__none__' : String(rawValue),
      valueType: editableValueType(field),
    };
  });
}

export function updateAiActionField(
  plan: AiCommandPlan,
  editableField: AiEditableField,
  rawValue: string,
  context: AiPlanningContext,
): AiCommandPlan {
  const action = plan.actions.find(candidate => candidate.id === editableField.actionId);
  if (!action) throw new Error('La operación que quieres editar ya no existe.');
  if (rawValue.startsWith('__ref__')) {
    const clone = parseAiCommandPlan(JSON.parse(JSON.stringify(plan)) as unknown);
    const clonedAction = clone.actions.find(candidate => candidate.id === editableField.actionId);
    if (!clonedAction) return clone;
    const fields = clonedAction.fields as Record<string, unknown>;
    const referenceFields: Record<string, string> = {
      accountId: 'accountRef', categoryId: 'categoryRef', subcategoryId: 'subcategoryRef', targetAccountId: 'targetAccountRef',
    };
    const referenceField = referenceFields[editableField.field];
    if (!referenceField) throw new Error('Esta referencia no se puede usar en el campo seleccionado.');
    fields[editableField.field] = undefined;
    fields[referenceField] = rawValue.slice('__ref__'.length);
    return clone;
  }
  const updated = applyClarificationAnswer(plan, {
    actionId: editableField.actionId,
    allowCustom: editableField.allowCustom,
    contextLabel: actionContextLabel(action, plan),
    field: editableField.field,
    id: `${editableField.actionId}.${editableField.field}`,
    options: editableField.options,
    prompt: `Editar ${editableField.label}`,
    valueType: editableField.valueType,
  }, rawValue, context);
  const updatedAction = updated.actions.find(candidate => candidate.id === editableField.actionId);
  if (!updatedAction) return updated;
  const referenceFields: Record<string, string> = {
    accountId: 'accountRef', categoryId: 'categoryRef', subcategoryId: 'subcategoryRef', targetAccountId: 'targetAccountRef',
  };
  const referenceField = referenceFields[editableField.field];
  if (referenceField) (updatedAction.fields as Record<string, unknown>)[referenceField] = undefined;
  if (updatedAction.entity === 'debitAccount' && editableField.field === 'recurringIncomeEnabled' && !updatedAction.fields.recurringIncomeEnabled) {
    updatedAction.fields.recurringIncomeAmount = undefined;
    updatedAction.fields.recurringIncomeDay = undefined;
    updatedAction.fields.recurringIncomeFrequency = undefined;
    updatedAction.fields.recurringIncomeType = undefined;
  }
  if (updatedAction.entity === 'transaction' && editableField.field === 'transactionType') {
    if (updatedAction.fields.transactionType === 'internalTransfer') {
      updatedAction.fields.categoryId = undefined;
      updatedAction.fields.categoryRef = undefined;
      updatedAction.fields.subcategoryId = undefined;
      updatedAction.fields.subcategoryRef = undefined;
      updatedAction.fields.installmentCount = undefined;
      updatedAction.fields.interestFreeInstallmentCount = undefined;
    } else {
      updatedAction.fields.targetAccountId = undefined;
      updatedAction.fields.targetAccountRef = undefined;
      updatedAction.fields.transferTaxCharged = undefined;
    }
  }
  return updated;
}

export function describeAiAction(action: AiCommandAction): string {
  const verbs: Record<AiActionOperation, string> = { create: 'Crear', update: 'Actualizar', delete: 'Eliminar' };
  const entities: Record<AiActionEntity, string> = {
    transaction: 'movimiento', debitAccount: 'cuenta débito', creditCard: 'tarjeta de crédito', category: 'categoría', subcategory: 'subcategoría',
    subscription: 'suscripción (cobro esperado)',
  };
  const fields = action.fields as Record<string, unknown>;
  const detail = typeof fields.description === 'string' ? fields.description
    : typeof fields.name === 'string' ? fields.name
    : action.targetName ?? action.targetId ?? '';
  return `${verbs[action.operation]} ${entities[action.entity]}${detail ? `: ${detail}` : ''}`;
}
