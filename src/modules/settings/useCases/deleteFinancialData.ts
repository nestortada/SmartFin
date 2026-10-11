import { createSubscriptionReminderService } from '../../subscriptions/services/androidSubscriptionReminderService';
import type { FinancialDataRepository } from '../repositories/sqliteFinancialDataRepository';

export async function deleteFinancialData(
  financialDataRepository: FinancialDataRepository,
): Promise<void> {
  await createSubscriptionReminderService().cancelAll();
  await financialDataRepository.deleteFinancialData();
}
