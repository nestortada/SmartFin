import { parseFinancialSms } from '../src/modules/settings/services/smsParser';

test('parses NEQUI payment SMS with Colombian amount format', () => {
  const parsed = parseFinancialSms({
    body: 'NEQUI: Pagaste 352.000,00en UNIVERSIDAD DE LA SABA',
    receivedAt: '2026-05-17T12:00:00.000Z',
    sender: 'NEQUI',
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

test('returns unsupported status for SMS messages outside the financial parser', () => {
  const parsed = parseFinancialSms({
    body: 'Tu codigo de seguridad es 123456',
    receivedAt: '2026-05-17T12:00:00.000Z',
  });

  expect(parsed.status).toBe('unsupported');
});
