import { NativeModules, Platform } from 'react-native';

type NativeDatabaseLifecycle = {
  acquire: () => Promise<string>;
  checkOwner: (token: string) => Promise<void>;
  release: (token: string) => Promise<void>;
  quarantine: () => Promise<void>;
  capture: (token: string, expected: string) => Promise<string>;
  discard: (token: string, id: string) => Promise<void>;
};

export function nativeDatabaseLifecycle(): NativeDatabaseLifecycle | undefined {
  if (Platform.OS !== 'android') return undefined;
  const value: unknown = NativeModules.SmartFinDatabaseLifecycle;
  if (!value || typeof value !== 'object' ||
      ['acquire', 'checkOwner', 'release', 'quarantine', 'capture', 'discard'].some(
        key => typeof Reflect.get(value, key) !== 'function',
      )) throw new Error('La coordinación nativa SQLite no está disponible.');
  return value as NativeDatabaseLifecycle;
}

/** A timed-out receipt never certifies the end of the underlying native work. */
export async function quarantineNativeDatabase(): Promise<void> {
  await nativeDatabaseLifecycle()?.quarantine();
}
