// Phase 5E.4 (defect 5E3-001): a recovery already owned by another Android owner is
// reported as `running`, never as an error; concurrent JS callers share one native
// call; waiting is bounded and stops for gone callers; unexpected errors still reject.
jest.mock('react-native-sqlite-storage', () => ({ enablePromise: jest.fn(), openDatabase: jest.fn() }));
const mockNativeRecover = jest.fn<Promise<unknown>, []>();
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: {
    SmartFinDatabaseLifecycle: {
      beginFinancialDeletion: jest.fn(), financialDeletionInventory: jest.fn(), rollbackFinancialDeletion: jest.fn(),
      resourceEpoch: jest.fn(), recoverFinancialDeletion: () => mockNativeRecover(),
    },
  },
}));

import { awaitFinancialDeletionRecovery, recoverFinancialDeletion } from '../src/modules/settings/services/financialDeletionLifecycle';

const ID = '11111111-1111-4111-8111-111111111111';
const json = (value: object) => Promise.resolve(JSON.stringify(value));
const noSleep = () => Promise.resolve();
beforeEach(() => mockNativeRecover.mockReset());

test('running is a valid status without identity; other statuses keep their validation', async () => {
  mockNativeRecover.mockReturnValueOnce(json({ status: 'running' }));
  await expect(recoverFinancialDeletion()).resolves.toEqual({ status: 'running', id: undefined });
  mockNativeRecover.mockReturnValueOnce(json({ status: 'completed' }));
  await expect(recoverFinancialDeletion()).rejects.toThrow('Recuperación sin identidad.');
  mockNativeRecover.mockReturnValueOnce(json({ status: 'busy' }));
  await expect(recoverFinancialDeletion()).rejects.toThrow('Recuperación de borrado inválida.');
});

test('concurrent JS callers (App and AppNavigator) share one native recovery', async () => {
  let resolve!: (value: string) => void;
  mockNativeRecover.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const first = recoverFinancialDeletion();
  const second = recoverFinancialDeletion();
  resolve(JSON.stringify({ status: 'completed', id: ID }));
  await expect(Promise.all([first, second])).resolves.toEqual([{ status: 'completed', id: ID }, { status: 'completed', id: ID }]);
  expect(mockNativeRecover).toHaveBeenCalledTimes(1);
  // After settling, a later request asks native again (no stale cached result).
  mockNativeRecover.mockReturnValueOnce(json({ status: 'none' }));
  await expect(recoverFinancialDeletion()).resolves.toEqual({ status: 'none', id: undefined });
  expect(mockNativeRecover).toHaveBeenCalledTimes(2);
});

test('waits while another owner recovers and returns its final state', async () => {
  mockNativeRecover
    .mockReturnValueOnce(json({ status: 'running' }))
    .mockReturnValueOnce(json({ status: 'running' }))
    .mockReturnValueOnce(json({ status: 'completed', id: ID }));
  const onRunning = jest.fn();
  await expect(awaitFinancialDeletionRecovery({ onRunning, sleep: noSleep })).resolves.toEqual({ status: 'completed', id: ID });
  expect(onRunning).toHaveBeenCalledTimes(2);
});

test('pending and unknown results are returned unchanged, never retried as success', async () => {
  mockNativeRecover.mockReturnValueOnce(json({ status: 'running' })).mockReturnValueOnce(json({ status: 'cleanupPending', id: ID }));
  await expect(awaitFinancialDeletionRecovery({ sleep: noSleep })).resolves.toEqual({ status: 'cleanupPending', id: ID });
  mockNativeRecover.mockReturnValueOnce(json({ status: 'unknown', id: ID }));
  await expect(awaitFinancialDeletionRecovery({ sleep: noSleep })).resolves.toEqual({ status: 'unknown', id: ID });
  expect(mockNativeRecover).toHaveBeenCalledTimes(3);
});

test('waiting is bounded and returns running after the timeout', async () => {
  mockNativeRecover.mockImplementation(() => json({ status: 'running' }));
  await expect(awaitFinancialDeletionRecovery({ sleep: noSleep, intervalMs: 10, timeoutMs: 30 })).resolves.toEqual({ status: 'running', id: undefined });
  expect(mockNativeRecover).toHaveBeenCalledTimes(4);
});

test('a gone caller stops polling: no late callback replaces newer state', async () => {
  mockNativeRecover.mockImplementation(() => json({ status: 'running' }));
  let current = true;
  const sleep = async () => { current = false; };
  await expect(awaitFinancialDeletionRecovery({ isCurrent: () => current, sleep })).resolves.toEqual({ status: 'running', id: undefined });
  expect(mockNativeRecover).toHaveBeenCalledTimes(1);
});

test('unexpected native failures still reject and are not hidden as running', async () => {
  mockNativeRecover.mockReturnValueOnce(Promise.reject(new Error('No se pudo confirmar el ciclo de vida SQLite.')));
  await expect(awaitFinancialDeletionRecovery({ sleep: noSleep })).rejects.toThrow('No se pudo confirmar el ciclo de vida SQLite.');
  expect(mockNativeRecover).toHaveBeenCalledTimes(1);
});
