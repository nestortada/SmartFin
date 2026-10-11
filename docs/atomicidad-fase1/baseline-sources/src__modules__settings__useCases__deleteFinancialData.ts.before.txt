import { withExclusiveDatabase } from '../../../database/databaseCoordination';
import { createSubscriptionReminderService } from '../../subscriptions/services/androidSubscriptionReminderService';
import type { FinancialDataRepository } from '../repositories/sqliteFinancialDataRepository';

export async function deleteFinancialData(
  financialDataRepository: FinancialDataRepository,
): Promise<void> {
  await withExclusiveDatabase(async () => {
    await createSubscriptionReminderService().cancelAll();
    await financialDataRepository.deleteFinancialData();
  });
}
