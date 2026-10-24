import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { exportDriveBackup, verifyDriveBackupJob, getDriveBackupJobs } from '../src/modules/settings/services/androidDriveBackupService';
import { captureLocalDatabaseSnapshot, LocalSnapshotFailure } from '../src/modules/settings/services/localDatabaseSnapshot';
import type { SmartFinSQLiteDatabase } from '../src/database/sqliteDatabase';

jest.mock('../src/database/sqliteDatabase', () => ({ openSmartFinDatabase: jest.fn(async () => ({})) }));

jest.mock('../src/modules/settings/services/localDatabaseSnapshot', () => ({
  captureLocalDatabaseSnapshot: jest.fn(),
  LocalSnapshotFailure: jest.requireActual('../src/modules/settings/services/localDatabaseSnapshot').LocalSnapshotFailure,
}));
const id = '11111111-1111-4111-8111-111111111111';
const snapshotId = '22222222-2222-4222-8222-222222222222';
const database = {} as SmartFinSQLiteDatabase;
const capture = jest.mocked(captureLocalDatabaseSnapshot);
const published = { generationId: id, state: 'verified', fileCount: 14, lastBackupAt: '2026-10-23T10:00:00.000Z',
  revision: 10, locationName: 'Sintético', permissionPersistent: true };
let native: { preparePublication: jest.Mock; publishSnapshot: jest.Mock; getPublicationJobs: jest.Mock; failCapture: jest.Mock;
  chooseBackupDirectory: jest.Mock; getBackupStatus: jest.Mock; publishSnapshotWithProgress?: jest.Mock };
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  native = { preparePublication: jest.fn(async () => JSON.stringify({ id, state: 'prepared' })),
    publishSnapshot: jest.fn(async () => JSON.stringify(published)), getPublicationJobs: jest.fn(async () => '[]'),
    failCapture: jest.fn(), chooseBackupDirectory: jest.fn(), getBackupStatus: jest.fn() };
  NativeModules.SmartFinDriveBackup = native;
  capture.mockResolvedValue({ database, snapshot: { id: snapshotId }, timings: {} } as Awaited<ReturnType<typeof capture>>);
});
afterEach(() => { delete NativeModules.SmartFinDriveBackup; });

test('publication receives only the captured identity after recovered handle is delivered', async () => {
  const trace: string[] = [];
  native.publishSnapshot.mockImplementation(async (job: string, snapshot: string) => {
    expect(job).toBe(id); expect(snapshot).toBe(snapshotId);
    expect(trace).toEqual(['closed', 'recovered']);
    return JSON.stringify(published);
  });
  const result = await exportDriveBackup({ onDatabase: value => trace.push(value ? 'recovered' : 'closed') });
  expect(result).toEqual(published);
  expect(capture).toHaveBeenCalledWith(id);
});
test.each([undefined, database])('capture/recovery failure prevents all SAF writes and retains the recovered handle when known: %p', async recovered => {
  const error = new LocalSnapshotFailure(new Error('capture'), recovered ? undefined : new Error('unknown'), recovered);
  capture.mockRejectedValue(error);
  const onDatabase = jest.fn();
  await expect(exportDriveBackup({ onDatabase })).rejects.toBe(error);
  expect(native.publishSnapshot).not.toHaveBeenCalled();
  expect(onDatabase).toHaveBeenLastCalledWith(recovered);
  expect(native.failCapture).toHaveBeenCalledWith(id);
});
test('two concurrent requests cannot create two jobs or captures', async () => {
  let finish!: (value: string) => void;
  native.publishSnapshot.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
  const first = exportDriveBackup({ onDatabase: jest.fn() });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  await expect(exportDriveBackup({ onDatabase: jest.fn() })).rejects.toThrow('en curso');
  finish(JSON.stringify(published)); await first;
  expect(native.preparePublication).toHaveBeenCalledTimes(1);
  expect(capture).toHaveBeenCalledTimes(1);
});
test('explicit recovery never reconstructs a snapshot from current data', async () => {
  await expect(verifyDriveBackupJob(id)).resolves.toEqual(published);
  expect(native.publishSnapshot).toHaveBeenCalledWith(id, null);
  expect(capture).not.toHaveBeenCalled();
});
test('a write receipt without verified generation evidence is rejected', async () => {
  native.publishSnapshot.mockResolvedValue(JSON.stringify({ ...published, state: 'publicationPending' }));
  await expect(verifyDriveBackupJob(id)).rejects.toThrow('verificar');
});
test('durable uncertain work is returned for explicit verification', async () => {
  native.getPublicationJobs.mockResolvedValue(JSON.stringify([{ id, state: 'uncertain', completedFiles: 3, totalFiles: 14 }]));
  await expect(getDriveBackupJobs()).resolves.toEqual([{ id, state: 'uncertain', completedFiles: 3, totalFiles: 14 }]);
  expect(native.publishSnapshot).not.toHaveBeenCalled();
});

test('a delayed progress read cannot reopen the busy indicator after completion', async () => {
  jest.useFakeTimers();
  try {
    let complete!: (value: string) => void;
    let readProgress!: (value: string) => void;
    native.publishSnapshot.mockImplementation(() => new Promise<string>(resolve => { complete = resolve; }));
    native.getPublicationJobs.mockImplementation(() => new Promise<string>(resolve => { readProgress = resolve; }));
    const onProgress = jest.fn();
    const operation = exportDriveBackup({ onDatabase: jest.fn(), onProgress });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    jest.advanceTimersByTime(750);
    complete(JSON.stringify(published)); await operation;
    const calls = onProgress.mock.calls.length;
    readProgress(JSON.stringify([{ id, state: 'publicationPending' }]));
    await Promise.resolve(); await Promise.resolve();
    expect(onProgress).toHaveBeenLastCalledWith({ state: 'verified' });
    expect(onProgress).toHaveBeenCalledTimes(calls);
  } finally { jest.useRealTimers(); }
});

test('recovery reports actual original-job phases and ignores foreign, older and late events', async () => {
  let finish!: (value: string) => void;
  let attempt!: string;
  native.publishSnapshotWithProgress = jest.fn((job: string, snapshot: null, request: string) => {
    expect(job).toBe(id); expect(snapshot).toBeNull(); attempt = request;
    return new Promise<string>(resolve => { finish = resolve; });
  });
  const progress = jest.fn();
  const operation = verifyDriveBackupJob(id, progress);
  await Promise.resolve(); await Promise.resolve();
  const emit = (state: string, sequence: number, attemptId = attempt) => DeviceEventEmitter.emit('SmartFinBackupProgress', {
    jobId: id, attemptId, state, sequence, completedFiles: 0, totalFiles: 0,
  });
  emit('inspectingSnapshot', 1);
  emit('validatingComponents', 2);
  emit('inspectingSnapshot', 1);
  emit('uncertain', 100, 'another-attempt');
  emit('continuingPublication', 3);
  expect(progress.mock.calls.map(([p]) => p.state)).toEqual([
    'recovering', 'inspectingSnapshot', 'validatingComponents', 'continuingPublication',
  ]);
  finish(JSON.stringify(published)); await operation;
  const calls = progress.mock.calls.length;
  emit('publicationPending', 4);
  expect(progress).toHaveBeenCalledTimes(calls);
  expect(progress).toHaveBeenLastCalledWith({ state: 'verified' });
  expect(capture).not.toHaveBeenCalled();
});

test('progress presentation throwing after verification does not fail or retry publication', async () => {
  const progress = jest.fn(() => { throw new Error('UI unavailable'); });
  await expect(verifyDriveBackupJob(id, progress)).resolves.toEqual(published);
  expect(native.publishSnapshot).toHaveBeenCalledTimes(1);
  expect(capture).not.toHaveBeenCalled();
});
