import React from 'react';
import { AppState, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { realSQLite } from './helpers/realSQLite';
import { SQLITE_SCHEMA_STATEMENTS } from '../src/database/sqliteSchema';
import { applyVersionedMigrations } from '../src/database/migrations';
import { createSqliteSubscriptionRepository } from '../src/modules/subscriptions/repositories/sqliteSubscriptionRepository';
import { createSubscriptionApi } from '../src/modules/subscriptions/useCases/createSubscriptionApi';
import { getSubscriptionApi } from '../src/modules/subscriptions/services/subscriptionRuntime';
import { SubscriptionsScreen } from '../src/modules/subscriptions/ui/SubscriptionsScreen';
import type { SubscriptionReminderService } from '../src/modules/subscriptions/services/SubscriptionReminderService';
import {
  createSqliteCategoryRepository,
  createSqliteSubcategoryRepository,
} from '../src/modules/categories/repositories';

jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  openDatabase: jest.fn(),
}));
jest.mock('../src/modules/subscriptions/services/subscriptionRuntime', () => ({
  getSubscriptionApi: jest.fn(),
}));
jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

async function setup() {
  const sql = realSQLite();
  for (const statement of SQLITE_SCHEMA_STATEMENTS)
    await sql.database.executeSql(statement);
  await applyVersionedMigrations(sql.database);
  const service: SubscriptionReminderService = {
    getStatus: async () => ({ available: true, permission: 'granted' }),
    requestPermission: jest.fn(async () => ({
      available: true,
      permission: 'granted' as const,
    })),
    schedule: async () => undefined,
    cancel: async () => undefined,
    cancelAll: async () => undefined,
    ensureMaintenance: async () => undefined,
  };
  const api = createSubscriptionApi({
    repository: createSqliteSubscriptionRepository(sql.database),
    reminderService: service,
    categoryRepository: createSqliteCategoryRepository(sql.database),
    subcategoryRepository: createSqliteSubcategoryRepository(sql.database),
  });
  jest.mocked(getSubscriptionApi).mockResolvedValue(api);
  const changed = jest.fn();
  const home = jest.fn();
  const createMovement = jest.fn();
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <SubscriptionsScreen
        activeTheme="dark"
        onChanged={changed}
        onNavigateToHome={home}
        onNavigateToTransactions={jest.fn()}
        onOpenSettings={jest.fn()}
        onOpenCreditCards={jest.fn()}
        onOpenDebitCards={jest.fn()}
        onCreateTransaction={createMovement}
      />,
    );
  });
  if (!renderer) throw new Error('Renderer missing');
  const view = renderer;
  const press = async (label: string) => {
    const button = view.root
      .findAll(node => typeof node.props.onPress === 'function')
      .find(value => value.props.accessibilityLabel === label);
    if (!button)
      throw new Error(
        `Missing button: ${label}: ${JSON.stringify(view.toJSON()).slice(
          0,
          1800,
        )}`,
      );
    await act(async () => {
      button.props.onPress();
    });
  };
  const enter = async (label: string, value: string) => {
    const input = view.root
      .findAllByType(TextInput)
      .find(field => field.props.accessibilityLabel === label);
    if (!input) throw new Error(`Missing field: ${label}`);
    await act(async () => {
      input.props.onChangeText(value);
    });
  };
  const close = () => {
    act(() => view.unmount());
    sql.native.close();
  };
  return {
    view,
    api,
    service,
    press,
    enter,
    changed,
    home,
    close,
    sql,
    createMovement,
  };
}
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('list, creation, filters and terminal cancellation use the real domain without new transactions', async () => {
  const f = await setup();
  try {
    await f.press('Añadir suscripción');
    await f.enter('Nombre', 'Netflix');
    await f.enter('Importe en COP', '38.900');
    await f.press('Crear suscripción');
    expect((await f.api.getSubscriptions())[0]?.amount).toBe(38900);
    expect(f.changed).toHaveBeenCalledTimes(1);
    await f.press('Pausadas (0)');
    expect(
      f.view.root.findAllByProps({ accessibilityLabel: 'Ver Netflix' }),
    ).toHaveLength(0);
    await f.press('Todas (1)');
    await f.press('Ver Netflix');
    await f.press('Pausar');
    await f.press('Confirmar pausa');
    expect((await f.api.getSubscriptions())[0]?.status).toBe('paused');
    await f.press('Reanudar');
    await f.press('Confirmar reanudación');
    await f.press('Cancelar');
    await f.press('Cancelar compromiso definitivamente');
    expect((await f.api.getSubscriptions())[0]?.status).toBe('cancelled');
    expect(
      f.view.root.findAllByProps({ accessibilityLabel: 'Editar suscripción' }),
    ).toHaveLength(0);
    expect(
      f.sql.query('SELECT COUNT(*) AS count FROM transactions').rows.item(0)
        ?.count,
    ).toBe(0);
  } finally {
    f.close();
  }
});
test('permission is requested only by explicit action and failed reminders retain saved subscription', async () => {
  const f = await setup();
  try {
    expect(f.service.requestPermission).not.toHaveBeenCalled();
    f.service.schedule = async () => {
      throw new Error('Platform unavailable');
    };
    await f.press('Añadir suscripción');
    await f.enter('Nombre', 'Netflix');
    await f.enter('Importe en COP', '100');
    await f.press('Crear suscripción');
    expect(await f.api.getSubscriptions()).toHaveLength(1);
    expect(
      f.view.root.findAllByProps({
        accessibilityLabel: 'Reintentar recordatorios',
      }).length,
    ).toBeGreaterThan(0);
    await f.press('Estado de recordatorios');
    await f.press('Solicitar permiso de notificaciones');
    expect(f.service.requestPermission).toHaveBeenCalledTimes(1);
  } finally {
    f.close();
  }
});
test('invalid forms preserve drafts and never call a financial mutation', async () => {
  const f = await setup();
  try {
    await f.press('Añadir suscripción');
    await f.enter('Nombre', 'Netflix');
    await f.enter('Importe en COP', '-5');
    await f.press('Crear suscripción');
    expect(await f.api.getSubscriptions()).toHaveLength(0);
    expect(f.changed).not.toHaveBeenCalled();
    expect(
      f.view.root
        .findAllByType(TextInput)
        .find(input => input.props.accessibilityLabel === 'Nombre')?.props
        .value,
    ).toBe('Netflix');
  } finally {
    f.close();
  }
});

test('custom daily creation navigates through 50-item history pages without losing occurrences', async () => {
  const f = await setup();
  try {
    await f.press('Añadir suscripción');
    await f.enter('Nombre', 'Servicio diario');
    await f.enter('Importe en COP', '100');
    await f.press('Periodicidad');
    await f.press('Personalizada');
    await f.enter('Cada cuántos periodos', '1');
    await f.press('Unidad');
    await f.press('Días');
    await f.press('Crear suscripción');
    const subscription = (await f.api.getSubscriptions())[0];
    if (!subscription) throw new Error('Daily subscription was not saved');
    expect(subscription.recurrence).toEqual({
      periodicity: 'custom',
      interval: 1,
      unit: 'days',
    });
    const history = jest.spyOn(f.api, 'getSubscriptionHistory');
    await f.press('Ver Servicio diario');
    expect(history).toHaveBeenLastCalledWith(subscription.id, {
      limit: 50,
      offset: 0,
    });
    await f.press('Más historial');
    expect(history).toHaveBeenLastCalledWith(subscription.id, {
      limit: 50,
      offset: 50,
    });
    await f.press('Página anterior');
    expect(history).toHaveBeenLastCalledWith(subscription.id, {
      limit: 50,
      offset: 0,
    });
    const all = await f.api.getSubscriptionHistory(subscription.id, {
      limit: 500,
    });
    expect(all).toHaveLength(91);
    expect(
      f.sql.query('SELECT COUNT(*) AS count FROM transactions').rows.item(0)
        ?.count,
    ).toBe(0);
  } finally {
    f.close();
  }
});

test('inline category creation keeps the draft and month editing changes only the selected occurrence', async () => {
  const f = await setup();
  try {
    await f.press('Añadir suscripción');
    await f.enter('Nombre', 'Netflix');
    await f.enter('Importe en COP', '44900');
    expect(
      f.view.root
        .findAllByType(TextInput)
        .find(input => input.props.accessibilityLabel === 'Importe en COP')
        ?.props.value,
    ).toBe('44.900');
    await f.press('Categoría de gasto (opcional)');
    await f.press('Crear categoría');
    await f.enter('Nombre de la categoría o subcategoría', 'Streaming');
    await f.press('Guardar categoría o subcategoría');
    await f.press('Subcategoría (opcional)');
    await f.press('Crear subcategoría');
    await f.enter('Nombre de la categoría o subcategoría', 'Video');
    await f.press('Guardar categoría o subcategoría');
    await f.press('Crear suscripción');
    const subscription = (await f.api.getSubscriptions())[0];
    if (!subscription) throw new Error('Missing subscription');
    expect(subscription).toMatchObject({ name: 'Netflix', amount: 44900 });
    expect(subscription.categoryId).toBeTruthy();
    expect(subscription.subcategoryId).toBeTruthy();
    await f.press('Ver Netflix');
    const before = await f.api.getSubscriptionHistory(subscription.id);
    await f.press('Editar importe de este cobro');
    await f.enter('Importe esperado de este cobro', '47200');
    await f.press('Guardar importe de este cobro');
    const after = await f.api.getSubscriptionHistory(subscription.id);
    expect(after.filter(item => item.expectedAmount === 47200)).toHaveLength(1);
    expect(after.filter(item => item.expectedAmount === 44900)).toHaveLength(
      before.length - 1,
    );
    expect((await f.api.getSubscriptionById(subscription.id))?.amount).toBe(
      44900,
    );
  } finally {
    f.close();
  }
});

test('registering a missing expense opens Movimientos with the occurrence and never creates or links automatically', async () => {
  const f = await setup();
  try {
    await f.press('Añadir suscripción');
    await f.enter('Nombre', 'Netflix');
    await f.enter('Importe en COP', '44900');
    await f.press('Crear suscripción');
    await f.press('Próximos cobros');
    await f.press('Vincular');
    await f.press('Registrar nuevo gasto');
    expect(f.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionName: 'Netflix',
        expectedAmount: 44900,
      }),
      expect.objectContaining({ name: 'Netflix' }),
    );
    expect(
      f.sql.query('SELECT COUNT(*) AS count FROM transactions').rows.item(0)
        ?.count,
    ).toBe(0);
  } finally {
    f.close();
  }
});
