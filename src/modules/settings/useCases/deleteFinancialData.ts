import type { FinancialDataRepository } from '../repositories/sqliteFinancialDataRepository';

export async function deleteFinancialData(
  financialDataRepository: FinancialDataRepository,
): Promise<void> {
  await financialDataRepository.deleteFinancialData();
}
