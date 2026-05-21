import { NativeModules, Platform } from 'react-native';

export type SecurityService = {
  authenticateBiometrics: () => Promise<boolean>;
  clearLocalCredential: () => Promise<void>;
  isBiometricsAvailable: () => Promise<boolean>;
  enableBiometrics: () => Promise<void>;
  setLocalCredential: (secret: string) => Promise<void>;
  verifyLocalCredential: (secret: string) => Promise<boolean>;
};

type NativeSecurityModule = {
  authenticateBiometrics?: () => Promise<boolean>;
  clearLocalCredential?: () => Promise<void>;
  isBiometricsAvailable?: () => Promise<boolean>;
  enableBiometrics?: () => Promise<void>;
  setLocalCredential?: (secret: string) => Promise<void>;
  verifyLocalCredential?: (secret: string) => Promise<boolean>;
};

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
    authenticateBiometrics: async () => {
      const nativeModule = getNativeSecurityModule();

      if (!nativeModule) {
        return false;
      }

      if (!nativeModule.authenticateBiometrics) {
        return false;
      }

      return nativeModule.authenticateBiometrics();
    },
    clearLocalCredential: async () => {
      const nativeModule = getNativeSecurityModule();

      if (!nativeModule) {
        return;
      }

      if (nativeModule.clearLocalCredential) {
        await nativeModule.clearLocalCredential();
      }
    },
    enableBiometrics: async () => {
      const nativeModule = getNativeSecurityModule();

      if (!nativeModule) {
        throw new Error('La biometría no está disponible en esta plataforma.');
      }

      if (!nativeModule.enableBiometrics) {
        throw new Error('La biometria requiere reinstalar la app.');
      }

      await nativeModule.enableBiometrics();
    },
    isBiometricsAvailable: async () => {
      const nativeModule = getNativeSecurityModule();

      if (!nativeModule) {
        return false;
      }

      if (!nativeModule.isBiometricsAvailable) {
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

      if (!nativeModule.setLocalCredential) {
        throw new Error('El PIN requiere reinstalar la app.');
      }

      await nativeModule.setLocalCredential(secret);
    },
    verifyLocalCredential: async secret => {
      const nativeModule = getNativeSecurityModule();

      if (!nativeModule) {
        return false;
      }

      if (!nativeModule.verifyLocalCredential) {
        return false;
      }

      return nativeModule.verifyLocalCredential(secret);
    },
  };
}
