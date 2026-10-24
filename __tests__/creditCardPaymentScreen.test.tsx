import React from 'react';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import Toast from 'react-native-toast-message';
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from './helpers/financialIntegrityFixture';
import { CreditCardsScreen } from '../src/modules/creditCards/ui/CreditCardsScreen';
import { CreditCardPaymentAction, CreditCardPaymentModal } from '../src/modules/creditCards/ui/components/CreditCardPayment';
import { getCreditCardsOverview } from '../src/modules/creditCards/useCases/getCreditCardsOverview';
import * as hooks from '../src/modules/creditCards/hooks';
import { financialState, requireIntegralRollback } from './helpers/financialState';
import { CreditCardFormModal } from '../src/modules/creditCards/ui/components/CreditCardFormModal';
import { CreditCardCarousel } from '../src/modules/creditCards/ui/components/CreditCardCarousel';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon');
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('../src/modules/creditCards/hooks', () => ({ useCreditCardsOverview: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
async function setup() {
  const f = await financialIntegrityFixture({ managed: true });
  await f.save({ accountId: 'card', operationType: 'Crédito' });
  const overview = await getCreditCardsOverview(f.creditCardRepository, f.transactionRepository, FINANCIAL_TEST_DATE);
  jest.mocked(hooks.useCreditCardsOverview).mockReturnValue({ loading: false, overview });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<CreditCardsScreen activeTheme="dark" database={f.database} onNavigateToHome={() => {}} onNavigateToTransactions={() => {}} onOpenDebitCards={() => {}} onOpenSettings={() => {}} />); });
  await act(async () => view.root.findByType(CreditCardPaymentAction).props.onPress());
  await act(async () => view.root.findByType(CreditCardPaymentModal).props.onAmountChange('100000'));
  const close = async () => { await act(async () => view.unmount()); consoleError.mockRestore(); f.native.close(); };
  return { ...f, view, alert, close };
}
test('two save calls from the same rendered button debit once; confirmed stale handler cannot resubmit', async () => {
  const f = await setup();
  try {
    const save = f.view.root.findByType(CreditCardPaymentModal).props.onSave as () => Promise<void>;
    const barrier = f.pauseNextExecuteSql('INSERT INTO transactions', 'after');
    let first!: Promise<void>;
    await act(async () => {
      first = save(); await barrier.reached; await save();
      barrier.release(); await first;
    });
    await act(async () => save());
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 900000 }, debt: 150000, expense: 250000, wealth: 750000 });
    expect((await f.transactionRepository.getTransactions()).filter(tx => tx.type === 'creditCardPayment')).toHaveLength(1);
    expect(f.view.root.findByType(CreditCardPaymentModal).props.visible).toBe(false);
  } finally { await f.close(); }
});
test('a toast failure after COMMIT reports saved payment and prevents repeated debit', async () => {
  const f = await setup();
  try {
    jest.mocked(Toast.show).mockImplementationOnce(() => { throw new Error('Toast unavailable'); });
    const save = f.view.root.findByType(CreditCardPaymentModal).props.onSave as () => Promise<void>;
    await act(async () => save()); await act(async () => save());
    expect(f.alert).toHaveBeenCalledWith('SmartFin', 'El pago quedó guardado. No se pudo mostrar su confirmación.');
    expect(f.view.root.findByType(CreditCardPaymentModal).props.visible).toBe(false);
    expect(await f.snapshot()).toMatchObject({ balances: { bank: 900000 }, debt: 150000 });
  } finally { await f.close(); }
});
test('unknown payment displays uncertainty and a second press sends no SQL', async () => {
  const f = await setup();
  try {
    f.injectFault({ sql: 'COMMIT', phase: 'after' });
    await act(async () => f.view.root.findByType(CreditCardPaymentModal).props.onSave());
    expect(f.alert).toHaveBeenLastCalledWith('SmartFin', expect.stringContaining('No se pudo confirmar'));
    const count = f.trace.length;
    await act(async () => f.view.root.findByType(CreditCardPaymentModal).props.onSave());
    expect(f.alert).toHaveBeenLastCalledWith('SmartFin', expect.stringContaining('Verifica su estado'));
    expect(f.trace).toHaveLength(count);
  } finally { await act(async () => f.view.unmount()); }
});

test.each(['0,01', '0,40', '0,49'])('payment UI preserves decimal %s and explains minimum without financial effects', async draft => {
  const f = await setup();
  try {
    const before = await financialState(f);
    await act(async () => f.view.root.findByType(CreditCardPaymentModal).props.onAmountChange(draft));
    expect(f.view.root.findByType(CreditCardPaymentModal).props.amount).toBe(draft);
    f.resetTrace();
    await act(async () => f.view.root.findByType(CreditCardPaymentModal).props.onSave());
    expect(f.alert).toHaveBeenLastCalledWith('SmartFin', 'El importe del pago debe ser de al menos $1 COP.');
    expect(f.trace.some(entry => entry.write !== undefined)).toBe(false);
    requireIntegralRollback(before, await financialState(f));
  } finally { await f.close(); }
});

test('card edit double press shares one commit and the confirmed old handler cannot repeat writes', async () => {
  const f = await setup();
  try {
    const card = jest.mocked(hooks.useCreditCardsOverview).mock.results[0]!.value.overview.cards[0];
    await act(async () => f.view.root.findByType(CreditCardCarousel).props.onCardPress(card));
    const save = f.view.root.findByType(CreditCardFormModal).props.onSave as () => Promise<void>;
    f.resetTrace();
    const barrier = f.pauseNextExecuteSql('UPDATE accounts', 'after');
    await act(async () => {
      const first = save(); await barrier.reached; await save(); barrier.release(); await first;
    });
    await act(async () => save());
    expect(f.trace.filter(entry => entry.sql.startsWith('COMMIT'))).toHaveLength(1);
    expect(f.view.root.findByType(CreditCardFormModal).props.visible).toBe(false);
  } finally { await f.close(); }
});

test('card edit unknown blocks another save even through the old rendered handler', async () => {
  const f = await setup();
  try {
    const card = jest.mocked(hooks.useCreditCardsOverview).mock.results[0]!.value.overview.cards[0];
    await act(async () => f.view.root.findByType(CreditCardCarousel).props.onCardPress(card));
    const save = f.view.root.findByType(CreditCardFormModal).props.onSave as () => Promise<void>;
    f.injectFault({ sql: 'COMMIT', phase: 'after' });
    await act(async () => save());
    expect(f.alert).toHaveBeenLastCalledWith('SmartFin', expect.stringContaining('No se pudo confirmar'));
    const count = f.trace.length;
    await act(async () => save());
    expect(f.trace).toHaveLength(count);
    expect(f.alert).toHaveBeenLastCalledWith('SmartFin', expect.stringContaining('Verifica la tarjeta'));
  } finally { await act(async () => f.view.unmount()); }
});

test('card creation and association remain confirmed if the success toast fails', async () => {
  const f = await setup();
  try {
    await f.save({ accountId: 'account-credit-card-unclassified', operationType: 'Crédito', creditCardHint: 'Ghost', merchantName: 'Ghost' });
    await act(async () => f.view.root.findByType(CreditCardPaymentModal).props.onClose());
    await act(async () => f.view.root.findByType(CreditCardCarousel).props.onAddCard());
    await act(async () => {
      const form = f.view.root.findByType(CreditCardFormModal);
      form.props.onChange({ ...form.props.form, name: 'Ghost', creditLimit: '1000000' });
    });
    jest.mocked(Toast.show).mockImplementationOnce(() => { throw new Error('Toast unavailable'); });
    const save = f.view.root.findByType(CreditCardFormModal).props.onSave as () => Promise<void>;
    f.resetTrace(); await act(async () => save());
    expect(f.alert).toHaveBeenLastCalledWith('SmartFin', 'La tarjeta quedó guardada. No se pudo mostrar su confirmación.');
    expect(f.view.root.findByType(CreditCardFormModal).props.visible).toBe(false);
    await act(async () => save());
    expect(f.trace.filter(entry => entry.sql.startsWith('COMMIT'))).toHaveLength(1);
    const cards = (await f.accountRepository.getAccounts()).filter(account => account.name === 'Ghost');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.debtBalance?.amount).toBe(250000);
    expect((await f.transactionRepository.getTransactions()).filter(tx => tx.accountId === cards[0]?.id)).toHaveLength(1);
  } finally { await f.close(); }
});
