export type CurrencyCode = 'COP';

export type ISODateString = string;

export type Money = {
  amount: number;
  currency: CurrencyCode;
};

export const PRIMARY_CURRENCY: CurrencyCode = 'COP';
