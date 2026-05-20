import type { CurrencyCode, ISODateString } from '../../../shared/types';

export type FinancialMessageSourceType = 'sms' | 'notification';

export type FinancialMessage = {
  sourceType?: FinancialMessageSourceType;
  sourceApp?: string;
  packageName?: string;
  sender?: string;
  title?: string;
  body: string;
  receivedAt: ISODateString;
};

export type FinancialSmsMessage = FinancialMessage;

export type FinancialMessageParserName =
  | 'nu-notification-v1'
  | 'nequi-payment-v1'
  | 'bancolombia-purchase-v1'
  | 'davivienda-purchase-v1'
  | 'daviplata-payment-v1'
  | 'generic-purchase-v1'
  | 'unsupported';

export type SmsParserName = FinancialMessageParserName;

export type ParsedFinancialMessage =
  | {
      status: 'parsed';
      amount: number;
      currency: CurrencyCode;
      merchantName: string;
      parserName: Exclude<FinancialMessageParserName, 'unsupported'>;
      bankName: string;
    }
  | {
      status: 'unsupported';
      errorMessage: string;
      parserName: 'unsupported';
    };

function normalizeMerchantName(value: string): string {
  return value
    .replace(/[.,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function parseColombianAmount(rawAmount: string): number | undefined {
  const normalized = rawAmount.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

type Parser = {
  name: Exclude<FinancialMessageParserName, 'unsupported'>;
  bankName?: string;
  extract: (message: FinancialMessage, text: string) => [string, string] | null;
};

const PARSERS: Parser[] = [
  {
    name: 'nu-notification-v1',
    bankName: 'NU',
    extract: message => {
      const source = `${message.sourceApp ?? ''} ${message.packageName ?? ''}`.toLowerCase();
      const isNuSource =
        source.includes('com.nu.production') ||
        /\bnu\b/.test(source) ||
        source.includes('nubank');

      if (!isNuSource) {
        return null;
      }

      const combined = `${message.title ?? ''} ${message.body}`.replace(/\s+/g, ' ').trim();
      const match = combined.match(
        /tu\s+compra\s+en\s+(.+?)\s+por\s+\$?\s*([\d.]+(?:,\d{1,2})?)/i,
      );

      if (!match?.[1] || !match[2]) {
        return null;
      }

      return [match[2], match[1]];
    },
  },
  {
    name: 'nequi-payment-v1',
    bankName: 'NEQUI',
    extract: (_message, text) => {
      const match = text.match(
        /NEQUI:\s*Pa[sg]{1,2}aste\s+([\d.]+(?:,\d{1,2})?)\s*en\s+(.+)/i,
      );

      if (!match?.[1] || !match[2]) {
        return null;
      }

      return [match[1], match[2]];
    },
  },
  {
    name: 'bancolombia-purchase-v1',
    bankName: 'BANCOLOMBIA',
    extract: (_message, text) => {
      const match = text.match(
        /Bancolombia\s+(?:le\s+)?informa\s+Compra\s+por\s+\$?([\d.,]+)\s+en\s+([^.]+)/i,
      );

      if (!match?.[1] || !match[2]) {
        return null;
      }

      return [match[1], match[2]];
    },
  },
  {
    name: 'davivienda-purchase-v1',
    bankName: 'DAVIVIENDA',
    extract: (_message, text) => {
      const match = text.match(
        /Davivienda[:\s]+Compra\s+por\s+\$?([\d.,]+)\s+en\s+([^.]+)/i,
      );

      if (!match?.[1] || !match[2]) {
        return null;
      }

      return [match[1], match[2]];
    },
  },
  {
    name: 'daviplata-payment-v1',
    bankName: 'DAVIPLATA',
    extract: (_message, text) => {
      const match = text.match(
        /Daviplata[:\s]+Pagaste\s+\$?([\d.,]+)\s+a\s+([^.]+)/i,
      );

      if (!match?.[1] || !match[2]) {
        return null;
      }

      return [match[1], match[2]];
    },
  },
];

function getCombinedText(message: FinancialMessage): string {
  return [message.title, message.body]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferBankName(
  message: FinancialMessage,
  parser: Pick<Parser, 'bankName' | 'name'>,
  text: string,
): string {
  const source = `${message.sourceApp ?? ''} ${message.sender ?? ''} ${message.packageName ?? ''}`.toUpperCase();

  if (source.includes('COM.NU.PRODUCTION') || /\bNU\b/.test(source) || source.includes('NUBANK')) {
    return 'NU';
  }

  const colonIndex = text.indexOf(':');
  if (colonIndex > 0) {
    return text.slice(0, colonIndex).trim().toUpperCase();
  }

  return parser.bankName ?? 'BANCO';
}

function hasFinancialIntent(text: string): boolean {
  return /\b(compra|compraste|pagaste|pago|aprobada|aprobado|transacci[oó]n|debito|d[eé]bito|credito|cr[eé]dito)\b/i.test(
    text,
  );
}

function parseGenericPurchase(message: FinancialMessage, text: string): ParsedFinancialMessage | null {
  if (!hasFinancialIntent(text)) {
    return null;
  }

  const amountThenMerchant = text.match(
    /(?:compra|pagaste|pago|aprobada|aprobado|transacci[oó]n|debito|d[eé]bito|credito|cr[eé]dito)?[^$0-9]{0,40}(?:por|de)?\s*\$?\s*([\d.]+(?:,\d{1,2})?)\s+(?:en|a)\s+(.+?)(?:\s+(?:cod|codigo|c[oó]digo|ref|referencia|con\s+tu\s+tarjeta)\b|$)/i,
  );
  const merchantThenAmount = text.match(
    /(?:en|a)\s+(.+?)\s+(?:por|de)\s+\$?\s*([\d.]+(?:,\d{1,2})?)(?:\s|$)/i,
  );

  const rawAmount = amountThenMerchant?.[1] ?? merchantThenAmount?.[2];
  const rawMerchant = amountThenMerchant?.[2] ?? merchantThenAmount?.[1];

  if (!rawAmount || !rawMerchant) {
    return null;
  }

  const amount = parseColombianAmount(rawAmount);
  if (amount === undefined) {
    return {
      errorMessage: 'El monto del mensaje financiero no se pudo interpretar.',
      parserName: 'unsupported',
      status: 'unsupported',
    };
  }

  return {
    amount,
    bankName: inferBankName(message, { name: 'generic-purchase-v1' }, text),
    currency: 'COP',
    merchantName: normalizeMerchantName(rawMerchant),
    parserName: 'generic-purchase-v1',
    status: 'parsed',
  };
}

export function parseFinancialSms(message: FinancialMessage): ParsedFinancialMessage {
  const text = getCombinedText(message);

  for (const parser of PARSERS) {
    const extracted = parser.extract(message, text);
    if (!extracted) {
      continue;
    }

    const [rawAmount, rawMerchant] = extracted;
    const amount = parseColombianAmount(rawAmount);

    if (amount === undefined) {
      return {
        errorMessage: 'El monto del mensaje financiero no se pudo interpretar.',
        parserName: 'unsupported',
        status: 'unsupported',
      };
    }

    return {
      amount,
      bankName: inferBankName(message, parser, text),
      currency: 'COP',
      merchantName: normalizeMerchantName(rawMerchant),
      parserName: parser.name,
      status: 'parsed',
    };
  }

  const genericParsed = parseGenericPurchase(message, text);
  if (genericParsed) {
    return genericParsed;
  }

  return {
    errorMessage: 'El mensaje no coincide con ningun pago soportado.',
    parserName: 'unsupported',
    status: 'unsupported',
  };
}

export const parseFinancialMessage = parseFinancialSms;
