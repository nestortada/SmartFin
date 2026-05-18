import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { PRIMARY_CURRENCY, type ISODateString } from '../../../shared/types';
import { createSqliteTransactionRepository, type Transaction } from '../../transactions';
import { createSqliteCreditCardRepository } from '../repositories';
import type { CreditCardStatement, InstallmentPurchase } from '../types';

function toDateString(date: Date): ISODateString {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function dateInMonth(referenceDate: Date, monthOffset: number, day: number): ISODateString {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth() + monthOffset;
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const safeDay = Math.max(1, Math.min(day, lastDayOfMonth));

  return toDateString(new Date(year, month, safeDay));
}

function buildInstallmentTransaction(
  cardId: string,
  id: string,
  amount: number,
  description: string,
  date: ISODateString,
): Transaction {
  return {
    id,
    accountId: cardId,
    amount,
    categoryId: 'category-other',
    createdAt: date,
    currency: PRIMARY_CURRENCY,
    date,
    description,
    direction: 'outflow',
    merchantName: description,
    status: 'posted',
    type: 'expense',
    updatedAt: date,
  };
}

export async function seedCreditCardDemoData(
  database: SmartFinSQLiteDatabase,
  referenceDate = new Date(),
): Promise<void> {
  const repository = createSqliteCreditCardRepository(database);
  const transactionRepository = createSqliteTransactionRepository(database);
  const cards = await repository.getCreditCardAccounts();

  for (const card of cards) {
    const cardId = card.id;
    const now = referenceDate.toISOString();
    const currentStatements = await repository.getStatements([cardId]);
    const currentProfiles = await repository.getProfiles([cardId]);
    const currentInstallments = await repository.getInstallmentPurchases([cardId]);

    if (currentProfiles.length === 0) {
      await repository.saveProfiles([
        {
          accountId: cardId,
          createdAt: now,
          monthlyInterestRate: cardId.includes('amex') ? 0.031 : 0.028,
          updatedAt: now,
        },
      ]);
    }

    if (currentStatements.length === 0) {
      const totalAmount = card.debtBalance?.amount ?? (cardId.includes('amex') ? 3500000 : 7750000);
      const statement: CreditCardStatement = {
        id: `statement-demo-${cardId}`,
        accountId: cardId,
        createdAt: now,
        currency: card.currency,
        minimumPaymentAmount: Math.round(totalAmount * 0.1),
        paymentDueDate: dateInMonth(referenceDate, 0, 25),
        statementEndDate: dateInMonth(referenceDate, 0, 15),
        statementStartDate: dateInMonth(referenceDate, -1, 16),
        status: 'pending',
        totalAmount,
        updatedAt: now,
      };

      await repository.saveStatements([statement]);
    }

    if (currentInstallments.length === 0) {
      if (cardId.includes('nu') || cardId.includes('visa')) {
        const macbookDate = dateInMonth(referenceDate, -12, 10);
        const flightDate = dateInMonth(referenceDate, -3, 6);
        const macbookTransactionId = `txn-demo-installment-macbook-${cardId}`;
        const flightTransactionId = `txn-demo-installment-flight-${cardId}`;

        await transactionRepository.saveTransactions([
          buildInstallmentTransaction(
            cardId,
            macbookTransactionId,
            4800000,
            'MacBook Pro 14',
            macbookDate,
          ),
          buildInstallmentTransaction(
            cardId,
            flightTransactionId,
            1800000,
            'Vuelo a Madrid',
            flightDate,
          ),
        ]);

        const purchases: InstallmentPurchase[] = [
          {
            id: `installment-demo-macbook-${cardId}`,
            accountId: cardId,
            createdAt: macbookDate,
            currency: PRIMARY_CURRENCY,
            firstDueDate: dateInMonth(referenceDate, -11, 10),
            installmentCount: 24,
            merchantName: 'MacBook Pro 14',
            monthlyAmount: 200000,
            paidInstallments: 12,
            status: 'active',
            totalAmount: 4800000,
            transactionId: macbookTransactionId,
            updatedAt: now,
          },
          {
            id: `installment-demo-flight-${cardId}`,
            accountId: cardId,
            createdAt: flightDate,
            currency: PRIMARY_CURRENCY,
            firstDueDate: dateInMonth(referenceDate, -2, 6),
            installmentCount: 6,
            merchantName: 'Vuelo a Madrid',
            monthlyAmount: 300000,
            paidInstallments: 3,
            status: 'active',
            totalAmount: 1800000,
            transactionId: flightTransactionId,
            updatedAt: now,
          },
        ];

        await repository.saveInstallmentPurchases(purchases);
      } else if (cardId.includes('amex')) {
        const courseDate = dateInMonth(referenceDate, -5, 12);
        const fridgeDate = dateInMonth(referenceDate, -2, 15);
        const courseTransactionId = `txn-demo-installment-course-${cardId}`;
        const fridgeTransactionId = `txn-demo-installment-fridge-${cardId}`;

        await transactionRepository.saveTransactions([
          buildInstallmentTransaction(
            cardId,
            courseTransactionId,
            600000,
            'Curso Online IA',
            courseDate,
          ),
          buildInstallmentTransaction(
            cardId,
            fridgeTransactionId,
            1200000,
            'Nevera Samsung',
            fridgeDate,
          ),
        ]);

        const purchases: InstallmentPurchase[] = [
          {
            id: `installment-demo-course-${cardId}`,
            accountId: cardId,
            createdAt: courseDate,
            currency: PRIMARY_CURRENCY,
            firstDueDate: dateInMonth(referenceDate, -4, 12),
            installmentCount: 12,
            merchantName: 'Curso Online IA',
            monthlyAmount: 50000,
            paidInstallments: 5,
            status: 'active',
            totalAmount: 600000,
            transactionId: courseTransactionId,
            updatedAt: now,
          },
          {
            id: `installment-demo-fridge-${cardId}`,
            accountId: cardId,
            createdAt: fridgeDate,
            currency: PRIMARY_CURRENCY,
            firstDueDate: dateInMonth(referenceDate, -1, 15),
            installmentCount: 6,
            merchantName: 'Nevera Samsung',
            monthlyAmount: 200000,
            paidInstallments: 2,
            status: 'active',
            totalAmount: 1200000,
            transactionId: fridgeTransactionId,
            updatedAt: now,
          },
        ];

        await repository.saveInstallmentPurchases(purchases);
      }
    }
  }
}
