import {
  formatCopAmountInput,
  parseCopAmountDraft,
} from '../src/shared/utils/copAmountInput';

test.each([
  ['44900', '44.900', 44900],
  ['38900,50', '38.900,50', 38900.5],
  ['1000000,01', '1.000.000,01', 1000000.01],
])('draft %s keeps its amount when grouped', (draft, formatted, amount) => {
  expect(formatCopAmountInput(String(draft))).toBe(formatted);
  expect(parseCopAmountDraft(String(formatted))).toBe(amount);
});
test('incomplete decimals stay editable and unsafe values never become a financial amount', () => {
  expect(formatCopAmountInput('38.900,')).toBe('38.900,');
  expect(parseCopAmountDraft('38.900,')).toBe(38900);
  expect(parseCopAmountDraft('1,00,00')).toBe(0);
  expect(parseCopAmountDraft('9007199254740992')).toBe(0);
  expect(parseCopAmountDraft('')).toBe(0);
});
