import type { Account } from '../../accounts';
import type { CreditCardRepository } from '../repositories/sqliteCreditCardRepository';
import type { CreditCardFormInput } from '../types';
import { repositorySQLiteDatabase } from '../../../database/sqliteRepositoryScope';
import { isSQLiteParticipant } from '../../../database/managedSQLite';
import { withCreditCardManagementScope } from './creditCardManagementScope';
import { associatePendingTransactionsForCreditCard, reconcileCreditCardTransactions } from './creditCardTransactionRelations';
import { deleteCreditCard, requireCurrentCreditCard, saveCreditCardFromForm } from './manageCreditCards';
import { DEFAULT_MONTHLY_INTEREST_RATE } from './getCreditCardsOverview';

type SaveCardCommand = {
  repository: CreditCardRepository;
  input: CreditCardFormInput;
  existingAccount?: Account;
  expectedMonthlyInterestRate?: number;
  pendingAlertName?: string;
};
type SaveCardResult = { account: Account; associatedCount: number };
type CloseCardCommand = { repository: CreditCardRepository; accountId: string; expectedAccount?: Account };
const saves = new WeakMap<SaveCardCommand, Promise<SaveCardResult>>();
const closes = new WeakMap<CloseCardCommand, Promise<void>>();
function isParticipant(repository: CreditCardRepository) {
  const database = repositorySQLiteDatabase(repository);
  return database && isSQLiteParticipant(database);
}

/** One user action: account/profile, matching history, installments, reconciliation and alert. */
export async function saveCreditCardWithAssociations(command: SaveCardCommand): Promise<SaveCardResult> {
  const participant = isParticipant(command.repository);
  const previous = participant ? undefined : saves.get(command);
  if (previous) return previous;
  const input = { ...command.input };
  const expected = command.existingAccount ? JSON.parse(JSON.stringify(command.existingAccount)) as Account : undefined;
  const alertName = command.pendingAlertName;
  const expectedRate = command.expectedMonthlyInterestRate;
  const result = withCreditCardManagementScope(command.repository, async (repository, dependencies) => {
    if (!dependencies) throw new Error('La gestión compuesta de tarjetas requiere repositorios SQLite.');
    if (expected && expectedRate !== undefined) {
      const [profile] = await repository.getProfiles([expected.id]);
      if ((profile?.monthlyInterestRate ?? DEFAULT_MONTHLY_INTEREST_RATE) !== expectedRate) {
        throw new Error('La tasa de la tarjeta cambió. Actualiza las tarjetas antes de volver a editarla.');
      }
    }
    const account = await saveCreditCardFromForm(repository, input, expected);
    const associatedCount = await associatePendingTransactionsForCreditCard({ ...dependencies, account });
    if (associatedCount > 0 || alertName) {
      await dependencies.alertRepository.resolveMissingCreditCardAlert(alertName ?? account.name);
    }
    return { account, associatedCount };
  });
  // A participant value remains provisional until its owner confirms; never retain it as a receipt.
  if (!participant) saves.set(command, result);
  return result;
}

/** Preserve the screen's reconciliation-before-close policy under the same commit. */
export async function closeCreditCardWithReconciliation(command: CloseCardCommand): Promise<void> {
  const participant = isParticipant(command.repository);
  const previous = participant ? undefined : closes.get(command);
  if (previous) return previous;
  const accountId = command.accountId;
  const expected = command.expectedAccount ? JSON.parse(JSON.stringify(command.expectedAccount)) as Account : undefined;
  const result = withCreditCardManagementScope(command.repository, async (repository, dependencies) => {
    if (!dependencies) throw new Error('La gestión compuesta de tarjetas requiere repositorios SQLite.');
    if (expected) {
      const current = (await dependencies.accountRepository.getAccounts()).find(account => account.id === accountId);
      if (expected.id !== accountId) throw new Error('La identidad de la tarjeta cambió. Actualiza las tarjetas.');
      requireCurrentCreditCard(expected, current);
    }
    await reconcileCreditCardTransactions(dependencies);
    await deleteCreditCard(repository, accountId);
  });
  if (!participant) closes.set(command, result);
  return result;
}
