import type { CurrencyCode, ISODateString } from '../../../shared/types';

export type FinancialSmsMessage = {
  sender?: string;
  body: string;
  receivedAt: ISODateString;
};

export type SmsParserName =
  | 'nequi-payment-v1'
  | 'bancolombia-purchase-v1'
  | 'davivienda-purchase-v1'
  | 'daviplata-payment-v1'
  | 'unsupported';

export type ParsedFinancialMessage =
  | {
      status: 'parsed';
      amount: number;
      currency: CurrencyCode;
      merchantName: string;
      parserName: Exclude<SmsParserName, 'unsupported'>;
      bankName: string;
    }
  | {
      status: 'unsupported';
      errorMessage: string;
      parserName: 'unsupported';
    };

function normalizeMerchantName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toUpperCase();
}

function parseColombianAmount(rawAmount: string): number | undefined {
  // Handles formats: 1.500.000,50 → 1500000.50 | 15000 → 15000 | 15,000 → 15000
  const normalized = rawAmount.replace(/\./g, '').replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

type Parser = {
  name: Exclude<SmsParserName, 'unsupported'>;
  /** Returns [rawAmount, rawMerchant] or null if pattern does not match */
  extract: (body: string) => [string, string] | null;
};

const PARSERS: Parser[] = [
  {
    // NEQUI: Pagaste 15.000 en MERCHANT (supports 'Pasgaste' typo)
    name: 'nequi-payment-v1',
    extract: body => {
      const match = body.match(
        /NEQUI:\s*Pa[sg]{1,2}aste\s+([\d.]+(?:,\d{1,2})?)\s*en\s+(.+)/i,
      );
      if (!match || !match[1] || !match[2]) {
        return null;
      }
      return [match[1], match[2]];
    },
  },
  {
    // Bancolombia le informa Compra por $15.000,00 en MERCHANT cod 123
    name: 'bancolombia-purchase-v1',
    extract: body => {
      const match = body.match(
        /Bancolombia\s+(?:le\s+)?informa\s+Compra\s+por\s+\$?([\d.,]+)\s+en\s+([^.]+)/i,
      );
      if (!match || !match[1] || !match[2]) {
        return null;
      }
      return [match[1], match[2]];
    },
  },
  {
    // Davivienda: Compra por $15.000 en MERCHANT
    name: 'davivienda-purchase-v1',
    extract: body => {
      const match = body.match(
        /Davivienda[:\s]+Compra\s+por\s+\$?([\d.,]+)\s+en\s+([^.]+)/i,
      );
      if (!match || !match[1] || !match[2]) {
        return null;
      }
      return [match[1], match[2]];
    },
  },
  {
    // Daviplata: Pagaste $15.000 a MERCHANT
    name: 'daviplata-payment-v1',
    extract: body => {
      const match = body.match(
        /Daviplata[:\s]+Pagaste\s+\$?([\d.,]+)\s+a\s+([^.]+)/i,
      );
      if (!match || !match[1] || !match[2]) {
        return null;
      }
      return [match[1], match[2]];
    },
  },
];

export function parseFinancialSms(
  message: FinancialSmsMessage,
): ParsedFinancialMessage {
  const body = message.body.trim();

  for (const parser of PARSERS) {
    const extracted = parser.extract(body);
    if (!extracted) {
      continue;
    }

    const [rawAmount, rawMerchant] = extracted;
    const amount = parseColombianAmount(rawAmount);

    if (amount === undefined) {
      return {
        errorMessage: 'El monto del SMS no se pudo interpretar.',
        parserName: 'unsupported',
        status: 'unsupported',
      };
    }

    // Determine bank name intelligently: look before colon ":" or use parser name fallback
    const colonIndex = body.indexOf(':');
    let bankName = 'NEQUI';
    if (colonIndex > 0) {
      bankName = body.slice(0, colonIndex).trim().toUpperCase();
    } else {
      if (parser.name === 'nequi-payment-v1') bankName = 'NEQUI';
      else if (parser.name === 'bancolombia-purchase-v1') bankName = 'BANCOLOMBIA';
      else if (parser.name === 'davivienda-purchase-v1') bankName = 'DAVIVIENDA';
      else if (parser.name === 'daviplata-payment-v1') bankName = 'DAVIPLATA';
    }

    return {
      amount,
      currency: 'COP',
      merchantName: normalizeMerchantName(rawMerchant),
      parserName: parser.name,
      status: 'parsed',
      bankName,
    };
  }

  // Generic fallback parser for any bank format containing a colon ":" and the keyword " en " or " a "
  const colonIndex = body.indexOf(':');
  if (colonIndex > 0) {
    const beforeColon = body.slice(0, colonIndex).trim();
    const afterColon = body.slice(colonIndex + 1).trim();

    // Look for " en " or " a " (case-insensitive) to find the merchant/store
    const enMatch = afterColon.match(/\b(?:en|a)\b\s+(.+)$/i);
    // Find amount digits
    const amountMatch = afterColon.match(/(?:por\s+\$?|a\s+\$?|[\s$])([\d.]{3,}(?:,\d{1,2})?)\b/i) || 
                        afterColon.match(/([\d.]{3,}(?:,\d{1,2})?)/);

    if (enMatch && amountMatch && enMatch[1] && amountMatch[1]) {
      const rawAmount = amountMatch[1];
      const rawMerchant = enMatch[1];
      const amount = parseColombianAmount(rawAmount);

      if (amount !== undefined && amount > 0) {
        return {
          status: 'parsed',
          amount,
          currency: 'COP',
          merchantName: normalizeMerchantName(rawMerchant),
          parserName: 'nequi-payment-v1', // standard fallback parser
          bankName: beforeColon,
        };
      }
    }
  }

  return {
    errorMessage: 'El SMS no coincide con ningún banco soportado (Nequi, Bancolombia, Davivienda, Daviplata).',
    parserName: 'unsupported',
    status: 'unsupported',
  };
}
