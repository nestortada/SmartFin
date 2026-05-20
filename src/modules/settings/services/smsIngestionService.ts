import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import type { SmsPermissionState } from '../types';

import {
  parseFinancialSms,
  type FinancialMessage,
  type ParsedFinancialMessage,
} from './smsParser';

type NativeSmsIngestionModule = {
  requestSmsPermission: () => Promise<SmsPermissionState>;
  requestNotificationListenerPermission?: () => Promise<SmsPermissionState>;
  setSmsReadingEnabled: (enabled: boolean) => Promise<void>;
  getSmsPermissionState: () => Promise<SmsPermissionState>;
  getNotificationListenerPermissionState?: () => Promise<SmsPermissionState>;
};

type SmsIngestionService = {
  requestSmsPermission: () => Promise<SmsPermissionState>;
  setSmsReadingEnabled: (enabled: boolean) => Promise<void>;
  parseFinancialSms: (message: FinancialMessage) => ParsedFinancialMessage;
  subscribeToIncomingSms: (
    listener: (message: FinancialMessage) => void,
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

      const smsState = await nativeModule.requestSmsPermission();
      const notificationState = nativeModule.requestNotificationListenerPermission
        ? await nativeModule.requestNotificationListenerPermission()
        : 'unavailable';

      if (smsState === 'granted' || notificationState === 'granted' || notificationState === 'available') {
        return 'granted';
      }

      return smsState;
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
        'SmartFinIncomingFinancialMessage',
        (message: unknown) => {
          if (!message || typeof message !== 'object') {
            return;
          }

          const maybeMessage = message as Partial<FinancialMessage>;

          if (typeof maybeMessage.body !== 'string') {
            return;
          }

          listener({
            body: maybeMessage.body,
            packageName:
              typeof maybeMessage.packageName === 'string'
                ? maybeMessage.packageName
                : undefined,
            receivedAt:
              typeof maybeMessage.receivedAt === 'string'
                ? maybeMessage.receivedAt
                : new Date().toISOString(),
            sender:
              typeof maybeMessage.sender === 'string'
                ? maybeMessage.sender
                : undefined,
            sourceApp:
              typeof maybeMessage.sourceApp === 'string'
                ? maybeMessage.sourceApp
                : undefined,
            sourceType:
              maybeMessage.sourceType === 'notification'
                ? 'notification'
                : 'sms',
            title:
              typeof maybeMessage.title === 'string'
                ? maybeMessage.title
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
  message: FinancialMessage,
): Promise<void> {
  const parsedMessage = parseFinancialSms(message);
  const createdAt = new Date().toISOString();
  const sourceType = message.sourceType ?? 'sms';
  const sourceApp =
    message.sourceApp ??
    message.packageName ??
    (sourceType === 'notification' ? 'android-notification' : 'android-sms');
  const rawText = [message.title, message.body]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n');
  const messageId = `${sourceType}-${message.receivedAt}-${Math.abs(
    `${sourceApp}:${message.sender ?? ''}:${message.title ?? ''}:${message.body}`.split('').reduce(
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
      sourceType,
      sourceApp,
      message.sender ?? null,
      rawText,
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
