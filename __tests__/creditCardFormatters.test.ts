import {
  formatPercentageInput,
  monthlyInterestRateToAnnualEffective,
  parsePercentageInput,
} from '../src/modules/creditCards/ui/creditCardFormatters';

test('credit card percentage input keeps comma decimals while typing', () => {
  expect(formatPercentageInput('34,')).toBe('34,');
  expect(formatPercentageInput('34.')).toBe('34,');
  expect(formatPercentageInput('34.4')).toBe('34,4');
  expect(formatPercentageInput(',5')).toBe('0,5');
  expect(formatPercentageInput('34,401')).toBe('34,40');
});

test('credit card percentage parser accepts comma and dot decimals', () => {
  expect(parsePercentageInput('34,40')).toBeCloseTo(0.344);
  expect(parsePercentageInput('34.40')).toBeCloseTo(0.344);
});

test('annual effective interest rate is displayed with comma decimal separator', () => {
  expect(monthlyInterestRateToAnnualEffective(0.028)).toMatch(/,/);
});
