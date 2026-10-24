import { NativeModules, Platform } from 'react-native';

import {
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
    preparePublication: jest.fn(), publishSnapshot: jest.fn(), getPublicationJobs: jest.fn(async () => '[]'), failCapture: jest.fn(),
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
    datasetCurrency: 'unknown',
    accessNeedsRenewal: false,
    available: true,
    configured: true,
    lastBackupAt: '2026-09-26T15:00:00.000Z',
    localRevision: 12,
    locationName: 'SmartFin',
    outdated: true,
    permissionPersistent: true,
    remoteRevision: 10,
    validation: 'unverified',
    pendingJobs: [],
  });
});

test('getDriveBackupStatus rejects malformed native data', async () => {
  NativeModules.SmartFinDriveBackup = {
    chooseBackupDirectory: jest.fn(),
    preparePublication: jest.fn(), publishSnapshot: jest.fn(), getPublicationJobs: jest.fn(async () => '[]'), failCapture: jest.fn(),
    getBackupStatus: jest.fn(async () => ({ configured: 'yes' })),
  };

  await expect(getDriveBackupStatus(2)).rejects.toThrow('estado de respaldo inválido');
});
