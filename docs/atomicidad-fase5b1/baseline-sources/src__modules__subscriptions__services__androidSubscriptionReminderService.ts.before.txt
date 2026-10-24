import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { SubscriptionReminderService } from './SubscriptionReminderService';
import type { ReminderStatus } from '../types';

type NativeReminderModule = {
  getStatus: () => Promise<unknown>;
  schedule: (value: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  cancelAll: () => Promise<void>;
  ensureMaintenance: () => Promise<void>;
  completeMaintenance: (runId: string, success: boolean) => void;
};
export function getNativeSubscriptionReminders():
  | NativeReminderModule
  | undefined {
  const value: unknown = NativeModules.SmartFinSubscriptionReminders;
  if (Platform.OS !== 'android' || !value || typeof value !== 'object')
    return undefined;
  for (const key of [
    'getStatus',
    'schedule',
    'cancel',
    'cancelAll',
    'ensureMaintenance',
    'completeMaintenance',
  ]) {
    if (!(key in value) || typeof Reflect.get(value, key) !== 'function')
      return undefined;
  }
  return value as NativeReminderModule;
}
export function createSubscriptionReminderService(): SubscriptionReminderService {
  const native = getNativeSubscriptionReminders();
  const getStatus = async (): Promise<ReminderStatus> => {
    if (!native) return { available: false, permission: 'unsupported' };
    const value = await native.getStatus();
    if (
      !value ||
      typeof value !== 'object' ||
      !('granted' in value) ||
      typeof value.granted !== 'boolean'
    )
      throw new Error('Respuesta nativa de recordatorios inválida.');
    return {
      available: true,
      permission: value.granted ? 'granted' : 'denied',
    };
  };
  return {
    getStatus,
    requestPermission: async () => {
      if (native && Number(Platform.Version) >= 33)
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
      return getStatus();
    },
    schedule: async reminder => {
      if (native) await native.schedule(JSON.stringify(reminder));
    },
    cancel: async id => {
      if (native) await native.cancel(id);
    },
    cancelAll: async () => {
      if (native) await native.cancelAll();
    },
    ensureMaintenance: async () => {
      if (native) await native.ensureMaintenance();
    },
  };
}
