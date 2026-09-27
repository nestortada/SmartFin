import type { SmartFinSQLiteDatabase } from '../../../database';
import {
  createSqliteAccountRepository,
  deleteDebitCard,
  parseDebitCardMetadata,
  saveDebitCardFromForm,
  type DebitCardRecurringIncome,
} from '../../accounts';
import {
  createCategory,
  createSqliteCategoryRepository,
  createSqliteSubcategoryRepository,
  createSubcategory,
  deactivateSubcategory,
  deleteCategory,
  updateCategory,
  updateSubcategory,
} from '../../categories';
import {
  createSqliteCreditCardRepository,
  deleteCreditCard,
  parseCreditCardVisualMetadata,
  saveCreditCardFromForm,
} from '../../creditCards';
import { createSqliteTransactionRepository } from '../repositories';
import type { AiCommandAction, AiCommandPlan, Transaction } from '../types';
import { deleteManualTransactionSafely, saveManualTransaction } from './saveManualTransaction';

export type ExecuteAiCommandPlanResult = {
  completed: string[];
};

function requiredString(value: string | null | undefined, message: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

function requiredNumber(value: number | null | undefined, message: string): number {
  if (value === undefined || value === null || !Number.isFinite(value)) throw new Error(message);
  return value;
}

function resolveId(
  direct: string | null | undefined,
  reference: string | null | undefined,
  references: Map<string, string>,
): string | undefined {
  return direct ?? (reference ? references.get(reference) : undefined);
}

async function resolveTarget<T extends { id: string }>(
  action: AiCommandAction,
  candidates: Promise<T[]> | T[],
): Promise<T> {
  const targetId = requiredString(action.targetId, 'Selecciona el registro que quieres modificar.');
  const resolved = (await candidates).find(candidate => candidate.id === targetId);
  if (!resolved) throw new Error('El registro seleccionado ya no existe.');
  return resolved;
}

function buildRecurringIncome(
  action: Extract<AiCommandAction, { entity: 'debitAccount' }>,
  existing?: DebitCardRecurringIncome,
): DebitCardRecurringIncome | undefined {
  if (action.fields.recurringIncomeEnabled === false) return { amount: 0, frequency: 'none', incomeType: 'other' };
  if (action.fields.recurringIncomeEnabled !== true && !existing) return undefined;
  const frequency = action.fields.recurringIncomeFrequency ?? existing?.frequency;
  const incomeType = action.fields.recurringIncomeType ?? existing?.incomeType;
  const amount = action.fields.recurringIncomeAmount ?? existing?.amount;
  if (!frequency || frequency === 'none' || !incomeType || amount === undefined) return undefined;
  return {
    amount,
    dayOfMonth: action.fields.recurringIncomeDay ?? existing?.dayOfMonth,
    frequency,
    incomeType,
  };
}

async function executeAction(
  database: SmartFinSQLiteDatabase,
  action: AiCommandAction,
  draftId: string,
  references: Map<string, string>,
): Promise<string> {
  const accountRepository = createSqliteAccountRepository(database);
  const categoryRepository = createSqliteCategoryRepository(database);
  const subcategoryRepository = createSqliteSubcategoryRepository(database);
  const creditCardRepository = createSqliteCreditCardRepository(database);
  const transactionRepository = createSqliteTransactionRepository(database);

  if (action.entity === 'category') {
    if (action.operation === 'delete') {
      const target = await resolveTarget(action, categoryRepository.getCategories());
      await deleteCategory(categoryRepository, target.id);
      return `Categoria ${target.name} eliminada y reasignada a Otros`;
    }
    const existing = action.operation === 'update'
      ? await resolveTarget(action, categoryRepository.getCategories())
      : undefined;
    const input = {
      color: action.fields.color ?? existing?.color ?? '#bbc3ff',
      name: action.fields.name ?? existing?.name ?? '',
      type: action.fields.type ?? (existing?.type === 'income' ? 'income' : 'expense'),
    } as const;
    const saved = existing
      ? await updateCategory(categoryRepository, existing.id, input)
      : await createCategory(categoryRepository, input);
    if (action.clientRef) references.set(action.clientRef, saved.id);
    return `${existing ? 'Categoria actualizada' : 'Categoria creada'}: ${saved.name}`;
  }

  if (action.entity === 'subcategory') {
    if (action.operation === 'delete') {
      const target = await resolveTarget(action, subcategoryRepository.getSubcategories(true));
      await deactivateSubcategory(subcategoryRepository, target.id);
      return `Subcategoria desactivada: ${target.name}`;
    }
    const existing = action.operation === 'update'
      ? await resolveTarget(action, subcategoryRepository.getSubcategories(true))
      : undefined;
    const categoryId = resolveId(action.fields.categoryId, action.fields.categoryRef, references)
      ?? existing?.categoryId;
    const input = {
      categoryId: requiredString(categoryId, 'Falta la categoria padre de la subcategoria.'),
      color: action.fields.color ?? existing?.color,
      name: requiredString(action.fields.name ?? existing?.name, 'Falta el nombre de la subcategoria.'),
    };
    const saved = existing
      ? await updateSubcategory(subcategoryRepository, existing.id, input)
      : await createSubcategory(subcategoryRepository, input);
    if (action.clientRef) references.set(action.clientRef, saved.id);
    return `${existing ? 'Subcategoria actualizada' : 'Subcategoria creada'}: ${saved.name}`;
  }

  if (action.entity === 'debitAccount') {
    const allAccounts = await accountRepository.getAccounts();
    if (action.operation === 'delete') {
      const target = await resolveTarget(action, allAccounts.filter(account => account.type !== 'creditCard'));
      await deleteDebitCard(accountRepository, target.id);
      return `Cuenta cerrada: ${target.name}`;
    }
    const existing = action.operation === 'update'
      ? await resolveTarget(action, allAccounts.filter(account => account.type !== 'creditCard'))
      : undefined;
    const metadata = existing ? parseDebitCardMetadata(existing) : undefined;
    const saved = await saveDebitCardFromForm(accountRepository, {
      accountId: existing?.id,
      bankName: action.fields.institutionName ?? metadata?.bankName,
      currentBalance: action.fields.initialBalance ?? existing?.balance.amount ?? 0,
      name: requiredString(action.fields.name ?? existing?.name, 'Falta el nombre de la cuenta.'),
      recurringIncome: buildRecurringIncome(action, metadata?.recurringIncome),
    });
    if (action.clientRef) references.set(action.clientRef, saved.id);
    return `${existing ? 'Cuenta actualizada' : 'Cuenta creada'}: ${saved.name}`;
  }

  if (action.entity === 'creditCard') {
    const cards = await creditCardRepository.getCreditCardAccounts();
    if (action.operation === 'delete') {
      const target = await resolveTarget(action, cards);
      await deleteCreditCard(creditCardRepository, target.id);
      return `Tarjeta cerrada: ${target.name}`;
    }
    const existing = action.operation === 'update' ? await resolveTarget(action, cards) : undefined;
    const metadata = parseCreditCardVisualMetadata(existing?.description);
    const saved = await saveCreditCardFromForm(creditCardRepository, {
      accountId: existing?.id,
      annualEffectiveInterestRate: action.fields.annualEffectiveInterestRate ?? undefined,
      bankName: action.fields.bankName ?? existing?.institutionName,
      closingDay: action.fields.closingDay ?? metadata.closingDay,
      creditLimit: action.fields.creditLimit ?? existing?.creditLimit?.amount ?? 0,
      lastFourDigits: action.fields.lastFourDigits ?? metadata.lastFourDigits,
      managementFee: action.fields.managementFee ?? metadata.managementFee,
      name: requiredString(action.fields.name ?? existing?.name, 'Falta el nombre de la tarjeta.'),
      paymentDay: action.fields.paymentDay ?? metadata.paymentDay,
    }, existing);
    if (action.clientRef) references.set(action.clientRef, saved.id);
    return `${existing ? 'Tarjeta actualizada' : 'Tarjeta creada'}: ${saved.name}`;
  }

  const accounts = await accountRepository.getAccounts();
  const transactions = await transactionRepository.getTransactions();
  const supportedTransactions = transactions.filter(transaction =>
    ['income', 'expense', 'internalTransfer'].includes(transaction.type),
  );
  if (action.operation === 'delete') {
    const target = await resolveTarget(action, supportedTransactions);
    await deleteManualTransactionSafely({
      accountRepository,
      accounts,
      creditCardRepository,
      transaction: target,
      transactionRepository,
    });
    return `Movimiento eliminado: ${target.description}`;
  }

  const existing: Transaction | undefined = action.operation === 'update'
    ? await resolveTarget(action, supportedTransactions)
    : undefined;
  const accountId = resolveId(action.fields.accountId, action.fields.accountRef, references)
    ?? existing?.accountId;
  const targetAccountId = resolveId(action.fields.targetAccountId, action.fields.targetAccountRef, references)
    ?? existing?.targetAccountId;
  const categoryId = resolveId(action.fields.categoryId, action.fields.categoryRef, references)
    ?? existing?.categoryId;
  const subcategoryId = resolveId(action.fields.subcategoryId, action.fields.subcategoryRef, references)
    ?? existing?.subcategoryId;
  const transactionType = action.fields.transactionType ?? existing?.type;
  if (!transactionType || !['income', 'expense', 'internalTransfer'].includes(transactionType)) {
    throw new Error('Falta un tipo de movimiento compatible.');
  }
  const selectedAccount = accounts.find(account => account.id === accountId);
  const installmentCount = action.fields.installmentCount ?? 1;
  const interestFreeCount = action.fields.interestFreeInstallmentCount ?? 0;
  const result = await saveManualTransaction({
    accountId,
    accountRepository,
    accounts,
    amount: requiredNumber(action.fields.amount ?? existing?.amount, 'Falta el valor del movimiento.'),
    categoryId: categoryId ?? undefined,
    subcategoryId: subcategoryId ?? undefined,
    creditCardHint: selectedAccount?.name,
    creditCardRepository,
    dedupeKey: existing?.dedupeKey ?? `${draftId}:${action.id}`,
    editingTransaction: existing ?? null,
    hasInterestFreeInstallments: interestFreeCount > 0,
    installmentCountInput: String(installmentCount),
    interestFreeInstallmentCountInput: String(interestFreeCount),
    merchantName: requiredString(action.fields.description ?? existing?.description, 'Falta la descripcion del movimiento.'),
    notes: action.fields.notes ?? existing?.notes,
    now: new Date(),
    operationType: selectedAccount?.type === 'creditCard' ? 'Crédito' : 'Débito',
    targetAccountId,
    transactionDate: action.fields.date ?? existing?.date,
    transactionRepository,
    transactionType,
    transferTaxCharged: action.fields.transferTaxCharged ?? false,
  });
  if (action.clientRef) references.set(action.clientRef, result.transaction.id);
  return `${existing ? 'Movimiento actualizado' : 'Movimiento creado'}: ${result.transaction.description}`;
}

export async function executeAiCommandPlan(
  database: SmartFinSQLiteDatabase,
  draftId: string,
  plan: AiCommandPlan,
): Promise<ExecuteAiCommandPlanResult> {
  const completed: string[] = [];
  const references = new Map<string, string>();
  await database.executeSql('BEGIN IMMEDIATE;');
  try {
    for (const action of plan.actions) {
      completed.push(await executeAction(database, action, draftId, references));
    }
    await database.executeSql('COMMIT;');
    return { completed };
  } catch (error) {
    try {
      await database.executeSql('ROLLBACK;');
    } catch {
      // Preserve the original domain or persistence error.
    }
    throw error;
  }
}
