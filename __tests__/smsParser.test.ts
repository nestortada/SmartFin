import { parseFinancialSms } from '../src/modules/settings/services/smsParser';

test('parses NEQUI payment SMS with Colombian amount format', () => {
  const parsed = parseFinancialSms({
    body: 'NEQUI: Pagaste 352.000,00en UNIVERSIDAD DE LA SABA',
    receivedAt: '2026-05-17T12:00:00.000Z',
    sender: 'NEQUI',
    sourceType: 'sms',
  });

  expect(parsed).toEqual({
    amount: 352000,
    bankName: 'NEQUI',
    currency: 'COP',
    merchantName: 'UNIVERSIDAD DE LA SABA',
    parserName: 'nequi-payment-v1',
    status: 'parsed',
  });
});

test('parses Nu bank app notification purchase', () => {
  const parsed = parseFinancialSms({
    body: 'Tu compra en DOLLARCITY PRADILLA por $1.500,00 con tu tarjeta terminada en 0447 ha sido APROBADA.',
    packageName: 'com.nu.production',
    receivedAt: '2026-05-19T19:33:00.000Z',
    sourceApp: 'Nu',
    sourceType: 'notification',
    title: 'Compra aprobada por $1.500,00',
  });

  expect(parsed).toEqual({
    amount: 1500,
    bankName: 'NU',
    currency: 'COP',
    merchantName: 'DOLLARCITY PRADILLA',
    parserName: 'nu-notification-v1',
    status: 'parsed',
  });
});

test('returns unsupported status for SMS messages outside the financial parser', () => {
  const parsed = parseFinancialSms({
    body: 'Tu codigo de seguridad es 123456',
    receivedAt: '2026-05-17T12:00:00.000Z',
  });

  expect(parsed.status).toBe('unsupported');
});
