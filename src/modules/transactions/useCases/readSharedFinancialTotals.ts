import type { SharedFinancialPosition } from '../types/SharedExpense';

export type SharedFinancialTotals = Pick<
  SharedFinancialPosition,
  'receivables' | 'thirdPartyAdvances'
>;

/** Validate exact decimal INTEGER results before crossing into JS numbers. */
export function readSharedFinancialTotals(aggregate: {
  receivableMinor: string;
  advanceMinor: string;
  invalid: number;
}): SharedFinancialTotals {
  const readMinor = (value: string): number => {
    if (!/^\d+$/.test(value)) throw new Error('Importe en centavos inválido.');
    const minor = BigInt(value);
    if (minor > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('Saldo de terceros fuera del rango seguro.');
    return Number(minor) / 100;
  };
  if (aggregate.invalid !== 0)
    throw new Error('Saldo de terceros fuera del rango seguro.');
  return {
    receivables: readMinor(aggregate.receivableMinor),
    thirdPartyAdvances: readMinor(aggregate.advanceMinor),
  };
}
