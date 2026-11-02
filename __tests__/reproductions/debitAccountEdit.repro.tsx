// Phase 0 · 4.5 Editing a debit account from DebitCardsScreen. Synthetic in-memory SQLite only.
import React from 'react';
import { Alert, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { financialIntegrityFixture, FINANCIAL_TEST_DATE } from '../helpers/financialIntegrityFixture';
import { DebitCardsScreen } from '../../src/modules/accounts/ui/DebitCardsScreen';
import { DebitCardManageActions } from '../../src/modules/accounts/ui/components/DebitCardActions';
import { DebitCardFormModal } from '../../src/modules/accounts/ui/components/DebitCardFormModal';
import { phase0Evidence } from './phase0Evidence';

jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn() }));
jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon');
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));

const evidence = phase0Evidence('debitAccountEdit');
// The first render transforms the whole screen tree; a cold cache (CI) exceeds Jest's 5 s default.
jest.setTimeout(30000);
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(FINANCIAL_TEST_DATE);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

/** Opens «Modificar» on «Banco» (balance given as SQL text, stored as REAL), applies `edit` and saves. */
async function editBank(balance: string, edit: (inputs: { name: TextInput['props']; balance: TextInput['props'] }) => void) {
  const f = await financialIntegrityFixture();
  f.native.exec(`UPDATE accounts SET balance_amount = ${balance} WHERE id = 'bank';`);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const before = await f.snapshot();
  const transactionsBefore = f.query('SELECT count(*) AS n FROM transactions;').rows.item(0);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<DebitCardsScreen activeTheme="dark" database={f.database} onNavigateToHome={() => {}}
      onNavigateToTransactions={() => {}} onOpenCreditCards={() => {}} onOpenSettings={() => {}} onOpenTransactionsDraft={() => {}} />);
  });
  await act(async () => view.root.findByType(DebitCardManageActions).props.onEdit());
  const modal = () => view.root.findByType(DebitCardFormModal);
  const field = (placeholder: string) => modal().findAllByType(TextInput).find(input => input.props.placeholder === placeholder)!;
  const shownBalance = field('0').props.value as string;
  await act(async () => edit({ name: field('Ej: Debito principal').props, balance: field('0').props }));
  await act(async () => modal().props.onSave());
  const after = await f.snapshot();
  const row = f.query("SELECT name, balance_amount, typeof(balance_amount) AS kind FROM accounts WHERE id = 'bank';").rows.item(0);
  const result = { shownBalance, before, after, row, alerts: alert.mock.calls.map(call => call[1]),
    transactionsBefore, transactionsAfter: f.query('SELECT count(*) AS n FROM transactions;').rows.item(0) };
  await act(async () => view.unmount());
  f.native.close();
  return result;
}

test('renaming «Banco» keeps 123.456,78 exactly, creates no movement and leaves wealth unchanged', async () => {
  const result = await editBank('123456.78', inputs => inputs.name.onChangeText?.('Banco nómina'));
  expect(result.alerts).toEqual([]);
  expect(result.row).toEqual({ name: 'Banco nómina', balance_amount: 123456.78, kind: 'real' });
  expect(Object.is(result.after.balances.bank, 123456.78)).toBe(true);
  expect(result.transactionsAfter).toEqual(result.transactionsBefore);
  expect(result.after).toEqual(result.before);
  evidence.renameOnly = { status: 'discarded', observed: result,
    note: 'The form keeps the stored balance in state; the field only displays Math.round (shownBalance).' };
});

test('ambiguous: the balance field shows a rounded value; confirming what is shown rewrites the balance without a movement', async () => {
  const result = await editBank('123456.78', inputs => {
    inputs.name.onChangeText?.('Banco nómina');
    inputs.balance.onChangeText?.('123457');
  });
  expect(result.shownBalance).toBe('123457');
  expect(result.row).toMatchObject({ balance_amount: 123457 });
  expect(result.transactionsAfter).toEqual(result.transactionsBefore);
  expect(result.after.wealth - result.before.wealth).toBeCloseTo(0.22, 10);
  evidence.balanceFieldRounding = { status: 'ambiguous', observed: result,
    note: '«Saldo actual» overwrites the balance (also a direct balance edit by design); it cannot show or keep cents. Needs a rule: adjustment movement, read-only balance or cents input.' };
});

test('characterization: renaming an account with a negative balance silently resets it to 0', async () => {
  const result = await editBank('-50000.25', inputs => inputs.name.onChangeText?.('Banco nómina'));
  expect(result.before.balances.bank).toBe(-50000.25);
  expect(result.row).toMatchObject({ name: 'Banco nómina', balance_amount: 0 });
  expect(result.transactionsAfter).toEqual(result.transactionsBefore);
  evidence.negativeBalanceRename = { status: 'confirmed', observed: result,
    note: 'saveDebitCardFromForm stores Math.max(0, currentBalance): a name-only edit changes balance and wealth by +50.000,25 without a movement.' };
});

test.failing('acceptance: renaming never changes a negative balance', async () => {
  const result = await editBank('-50000.25', inputs => inputs.name.onChangeText?.('Banco nómina'));
  expect(result.after).toEqual(result.before);
});
