import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import type { SmsPermissionState } from '../types';

import {
  parseFinancialSms,
  type FinancialSmsMessage,
  type ParsedFinancialMessage,
} from './smsParser';

type NativeSmsIngestionModule = {
  requestSmsPermission: () => Promise<SmsPermissionState>;
  setSmsReadingEnabled: (enabled: boolean) => Promise<void>;
  getSmsPermissionState: () => Promise<SmsPermissionState>;
};

type SmsIngestionService = {
  requestSmsPermission: () => Promise<SmsPermissionState>;
  setSmsReadingEnabled: (enabled: boolean) => Promise<void>;
  parseFinancialSms: (message: FinancialSmsMessage) => ParsedFinancialMessage;
  subscribeToIncomingSms: (
    listener: (message: FinancialSmsMessage) => void,
  ) => () => void;
};

const { SmartFinSmsIngestion } = NativeModules as {
  SmartFinSmsIngestion?: NativeSmsIngestionModule;
};

function getNativeSmsModule(): NativeSmsIngestionModule | undefined {
  if (Platform.OS !== 'android') {
    return undefined;
  }

  return SmartFinSmsIngestion;
}

export function createSmsIngestionService(): SmsIngestionService {
  return {
    requestSmsPermission: async () => {
      const nativeModule = getNativeSmsModule();

      if (!nativeModule) {
        return 'unavailable';
      }

      return nativeModule.requestSmsPermission();
    },
    setSmsReadingEnabled: async enabled => {
      const nativeModule = getNativeSmsModule();

      if (!nativeModule) {
        return;
      }

      await nativeModule.setSmsReadingEnabled(enabled);
    },
    parseFinancialSms,
    subscribeToIncomingSms: listener => {
      const nativeModule = getNativeSmsModule();

      if (!nativeModule) {
        return () => undefined;
      }

      const emitter = new NativeEventEmitter(
        NativeModules.SmartFinSmsIngestion,
      );
      const subscription = emitter.addListener(
        'SmartFinIncomingSms',
        (message: unknown) => {
          if (!message || typeof message !== 'object') {
            return;
          }

          const maybeMessage = message as Partial<FinancialSmsMessage>;

          if (typeof maybeMessage.body !== 'string') {
            return;
          }

          listener({
            body: maybeMessage.body,
            receivedAt:
              typeof maybeMessage.receivedAt === 'string'
                ? maybeMessage.receivedAt
                : new Date().toISOString(),
            sender:
              typeof maybeMessage.sender === 'string'
                ? maybeMessage.sender
                : undefined,
          });
        },
      );

      return () => subscription.remove();
    },
  };
}

export async function saveRawFinancialSms(
  database: SmartFinSQLiteDatabase,
  message: FinancialSmsMessage,
): Promise<void> {
  const parsedMessage = parseFinancialSms(message);
  const createdAt = new Date().toISOString();
  const messageId = `sms-${message.receivedAt}-${Math.abs(
    `${message.sender ?? ''}:${message.body}`.split('').reduce(
      (hash, char) => (hash * 31 + char.charCodeAt(0)) | 0,
      0,
    ),
  )}`;

  await database.executeSql(
    `INSERT OR REPLACE INTO raw_financial_messages (
      id,
      source_type,
      source_app,
      sender,
      raw_text,
      received_at,
      parsed_status,
      parsed_amount,
      parsed_currency,
      parsed_merchant_name,
      parsed_account_hint,
      parser_name,
      error_message,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      messageId,
      'sms',
      'android-sms',
      message.sender ?? null,
      message.body,
      message.receivedAt,
      parsedMessage.status,
      parsedMessage.status === 'parsed' ? parsedMessage.amount : null,
      parsedMessage.status === 'parsed' ? parsedMessage.currency : null,
      parsedMessage.status === 'parsed' ? parsedMessage.merchantName : null,
      null,
      parsedMessage.parserName,
      parsedMessage.status === 'unsupported'
        ? parsedMessage.errorMessage
        : null,
      createdAt,
      createdAt,
    ],
  );
}
