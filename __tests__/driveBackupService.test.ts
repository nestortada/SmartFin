import { NativeModules, Platform } from 'react-native';

import {
  exportDriveBackup,
  getDriveBackupStatus,
} from '../src/modules/settings';

beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
});

afterEach(() => {
  delete NativeModules.SmartFinDriveBackup;
});

test('getDriveBackupStatus validates and maps the Android status', async () => {
  NativeModules.SmartFinDriveBackup = {
    chooseBackupDirectory: jest.fn(),
    exportBackup: jest.fn(),
    getBackupStatus: jest.fn(async () => ({
      accessNeedsRenewal: false,
      configured: true,
      lastBackupAt: '2026-09-26T15:00:00.000Z',
      locationName: 'SmartFin',
      outdated: true,
      permissionPersistent: true,
      remoteRevision: 10,
    })),
  };

  await expect(getDriveBackupStatus(12)).resolves.toEqual({
    accessNeedsRenewal: false,
    available: true,
    configured: true,
    lastBackupAt: '2026-09-26T15:00:00.000Z',
    localRevision: 12,
    locationName: 'SmartFin',
    outdated: true,
    permissionPersistent: true,
    remoteRevision: 10,
  });
});

test('getDriveBackupStatus rejects malformed native data', async () => {
  NativeModules.SmartFinDriveBackup = {
    chooseBackupDirectory: jest.fn(),
    exportBackup: jest.fn(),
    getBackupStatus: jest.fn(async () => ({ configured: 'yes' })),
  };

  await expect(getDriveBackupStatus(2)).rejects.toThrow('estado de respaldo inválido');
});

test('exportDriveBackup returns the confirmed exported file count', async () => {
  NativeModules.SmartFinDriveBackup = {
    chooseBackupDirectory: jest.fn(),
    getBackupStatus: jest.fn(),
    exportBackup: jest.fn(async () => ({
      fileCount: 9,
      lastBackupAt: '2026-09-26T15:00:00.000Z',
      locationName: 'SmartFin',
      permissionPersistent: true,
      revision: 42,
    })),
  };

  await expect(exportDriveBackup(42)).resolves.toEqual({
    fileCount: 9,
    lastBackupAt: '2026-09-26T15:00:00.000Z',
    locationName: 'SmartFin',
    permissionPersistent: true,
    revision: 42,
  });
});
