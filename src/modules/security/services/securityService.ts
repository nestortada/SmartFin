import { NativeModules, Platform } from 'react-native';

export type SecurityService = {
  isBiometricsAvailable: () => Promise<boolean>;
  enableBiometrics: () => Promise<void>;
  setLocalCredential: (secret: string) => Promise<void>;
  verifyLocalCredential: (secret: string) => Promise<boolean>;
};

type NativeSecurityModule = SecurityService;

const { SmartFinSecurity } = NativeModules as {
  SmartFinSecurity?: NativeSecurityModule;
};

function getNativeSecurityModule(): NativeSecurityModule | undefined {
  if (Platform.OS !== 'android') {
    return undefined;
  }

  return SmartFinSecurity;
}

export function createSecurityService(): SecurityService {
  return {
    enableBiometrics: async () => {
      const nativeModule = getNativeSecurityModule();

      if (!nativeModule) {
        throw new Error('La biometría no está disponible en esta plataforma.');
      }

      await nativeModule.enableBiometrics();
    },
    isBiometricsAvailable: async () => {
      const nativeModule = getNativeSecurityModule();

      if (!nativeModule) {
        return false;
      }

      return nativeModule.isBiometricsAvailable();
    },
    setLocalCredential: async secret => {
      const nativeModule = getNativeSecurityModule();

      if (!nativeModule) {
        throw new Error(
          'El almacenamiento seguro no está disponible en esta plataforma.',
        );
      }

      await nativeModule.setLocalCredential(secret);
    },
    verifyLocalCredential: async secret => {
      const nativeModule = getNativeSecurityModule();

      if (!nativeModule) {
        return false;
      }

      return nativeModule.verifyLocalCredential(secret);
    },
  };
}
