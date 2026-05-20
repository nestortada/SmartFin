import { processSmsAndCreateTransaction } from '../src/modules/transactions';
import type { Transaction } from '../src/modules/transactions';

function createEmptyResultSet() {
  return {
    rows: {
      item: () => null,
      length: 0,
    },
  };
}

function createHarness() {
  let transactions: Transaction[] = [];

  const transactionRepository = {
    getTransactions: async () => transactions,
    saveTransactions: async (nextTransactions: Transaction[]) => {
      transactions = nextTransactions;
    },
  };

  const database = {
    executeSql: jest.fn(async () => [createEmptyResultSet()]),
  };

  return {
    database,
    getTransactions: () => transactions,
    transactionRepository,
  };
}

function isoMinutesFrom(base: Date, minutes: number): string {
  return new Date(base.getTime() + minutes * 60 * 1000).toISOString();
}

describe('financial message transaction dedupe', () => {
  it('does not create a second transaction when SMS and app notification report the same purchase', async () => {
    const base = new Date();
    const harness = createHarness();

    await processSmsAndCreateTransaction({
      accountId: 'account-nequi',
      categoryId: 'category-other',
      database: harness.database as never,
      paymentMethod: 'debit',
      smsMessage: {
        body: 'NEQUI: Pagaste 15.000 en TIENDA UNO',
        receivedAt: isoMinutesFrom(base, 0),
        sender: 'NEQUI',
        sourceType: 'sms',
      },
      transactionRepository: harness.transactionRepository,
    });

    await processSmsAndCreateTransaction({
      accountId: 'account-nequi',
      categoryId: 'category-other',
      database: harness.database as never,
      paymentMethod: 'debit',
      smsMessage: {
        body: 'Pagaste 15.000 en TIENDA UNO',
        receivedAt: isoMinutesFrom(base, 2),
        sourceApp: 'Nequi',
        sourceType: 'notification',
        title: 'Pago aprobado',
      },
      transactionRepository: harness.transactionRepository,
    });

    expect(harness.getTransactions()).toHaveLength(1);
  });

  it('keeps two equal purchases when they are outside the cross-source dedupe window', async () => {
    const base = new Date();
    const harness = createHarness();

    await processSmsAndCreateTransaction({
      accountId: 'account-nequi',
      categoryId: 'category-other',
      database: harness.database as never,
      paymentMethod: 'debit',
      smsMessage: {
        body: 'NEQUI: Pagaste 15.000 en TIENDA UNO',
        receivedAt: isoMinutesFrom(base, 0),
        sender: 'NEQUI',
        sourceType: 'sms',
      },
      transactionRepository: harness.transactionRepository,
    });

    await processSmsAndCreateTransaction({
      accountId: 'account-nequi',
      categoryId: 'category-other',
      database: harness.database as never,
      paymentMethod: 'debit',
      smsMessage: {
        body: 'Pagaste 15.000 en TIENDA UNO',
        receivedAt: isoMinutesFrom(base, 31),
        sourceApp: 'Nequi',
        sourceType: 'notification',
        title: 'Pago aprobado',
      },
      transactionRepository: harness.transactionRepository,
    });

    expect(harness.getTransactions()).toHaveLength(2);
  });

  it('does not duplicate a reposted notification from the same source', async () => {
    const base = new Date();
    const harness = createHarness();
    const smsMessage = {
      body: 'Tu compra en DOLLARCITY PRADILLA por $1.500,00 con tu tarjeta terminada en 0447 ha sido APROBADA.',
      packageName: 'com.nu.production',
      receivedAt: isoMinutesFrom(base, 0),
      sourceApp: 'Nu',
      sourceType: 'notification' as const,
      title: 'Compra aprobada por $1.500,00',
    };

    await processSmsAndCreateTransaction({
      accountId: 'account-nu-credit',
      categoryId: 'category-other',
      database: harness.database as never,
      paymentMethod: 'debit',
      smsMessage,
      transactionRepository: harness.transactionRepository,
    });

    await processSmsAndCreateTransaction({
      accountId: 'account-nu-credit',
      categoryId: 'category-other',
      database: harness.database as never,
      paymentMethod: 'debit',
      smsMessage: {
        ...smsMessage,
        receivedAt: isoMinutesFrom(base, 4),
      },
      transactionRepository: harness.transactionRepository,
    });

    expect(harness.getTransactions()).toHaveLength(1);
  });
});
