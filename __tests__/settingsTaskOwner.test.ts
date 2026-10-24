import { createSettingsTaskRunner, type SettingsTaskOwner } from '../src/modules/settings/services/settingsTaskOwner';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('simultaneous rejected action cannot execute or hide the active owner', async () => {
  const busy = jest.fn(), error = jest.fn(), notice = jest.fn();
  const run = createSettingsTaskRunner({ busy, error, notice });
  const pending = deferred();
  const second = jest.fn(async () => { throw new Error('service rejection'); });
  const first = run('captura', () => pending.promise);
  await run('segundo', second);
  expect(second).not.toHaveBeenCalled();
  expect(busy).toHaveBeenLastCalledWith('captura');
  expect(error).toHaveBeenCalledTimes(1);
  pending.resolve(); await first;
  expect(busy).toHaveBeenLastCalledWith(undefined);
});

test('out of order progress and completion from a previous owner cannot replace a newer operation', async () => {
  const busy = jest.fn(), error = jest.fn(), notice = jest.fn();
  const run = createSettingsTaskRunner({ busy, error, notice });
  let old!: SettingsTaskOwner;
  await run('primero', async owner => { old = owner; });
  const pending = deferred();
  const next = run('recuperación', () => pending.promise);
  old.report('publicación anterior'); old.confirmed('éxito anterior');
  expect(busy).toHaveBeenLastCalledWith('recuperación');
  expect(notice).not.toHaveBeenCalledWith('éxito anterior');
  pending.reject(new Error('incierto')); await next;
  expect(error).toHaveBeenLastCalledWith('incierto');
});

test('presentation failure after verified success preserves confirmation and never repeats the action', async () => {
  const busy = jest.fn(), error = jest.fn(), notice = jest.fn();
  const run = createSettingsTaskRunner({ busy, error, notice });
  const action = jest.fn(async (owner: SettingsTaskOwner) => {
    owner.confirmed('Verificado mediante SAF');
    throw new Error('refresh unavailable');
  });
  await run('publicación', action);
  expect(action).toHaveBeenCalledTimes(1);
  expect(notice).toHaveBeenLastCalledWith('Verificado mediante SAF');
  expect(error).toHaveBeenLastCalledWith(expect.stringContaining('No repitas la operación confirmada'));
  expect(busy).toHaveBeenLastCalledWith(undefined);
});
