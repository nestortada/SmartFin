import { createSubscriptionReminderService } from '../../src/modules/subscriptions/services/androidSubscriptionReminderService';
import type { FinancialDataRepository } from './phase5cPreviousFinancialDataRepository';
import type { DatabasePermit } from '../../src/database/databaseCoordination';

export async function deleteFinancialData(
  financialDataRepository: FinancialDataRepository,
  permit?: DatabasePermit,
): Promise<void> {
  await createSubscriptionReminderService(permit).cancelAll();
  await financialDataRepository.deleteFinancialData();
}
