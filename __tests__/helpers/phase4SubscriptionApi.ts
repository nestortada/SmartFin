// Frozen before phase 4; only relative imports adapted.
import { transactionSortValue } from '../../src/shared/utils/transactionDate';
import type {
  SubscriptionRepository,
  SubscriptionState,
  SubscriptionScope,
} from '../../src/modules/subscriptions/repositories/SubscriptionRepository';
import type { SubscriptionReminderService } from '../../src/modules/subscriptions/services/SubscriptionReminderService';
import type {
  SubscriptionClock,
  SubscriptionInput,
  SubscriptionUpdate,
  SubscriptionSyncResult,
  SubscriptionMutationResult,
  SubscriptionSummary,
  SubscriptionStatus,
} from '../../src/modules/subscriptions/types';
import {
  annualEquivalent,
  civilDate,
  parseCivilDate,
  roundSubscriptionMoney,
  addDays,
} from '../../src/modules/subscriptions/useCases/recurrence';
import {
  buildSubscription,
  updateSubscriptionState,
  changeSubscriptionStatus,
  synchronizeSubscriptionState,
  confirmPayment,
  skipOccurrence,
  subscriptionMatches,
  compatibleSubscriptionPayment,
  updateOccurrenceAmount,
} from '../../src/modules/subscriptions/useCases/subscriptionLifecycle';
import {
  createCategory,
  type CategoryManagementRepository,
} from '../../src/modules/categories/useCases/manageCategories';
import { createSubcategory } from '../../src/modules/categories/useCases/manageSubcategories';
import type { SubcategoryRepository } from '../../src/modules/categories/repositories';

export function createSubscriptionApi(dependencies: {
  repository: SubscriptionRepository;
  reminderService: SubscriptionReminderService;
  clock?: SubscriptionClock;
  createId?: () => string;
  categoryRepository?: CategoryManagementRepository;
  subcategoryRepository?: SubcategoryRepository;
}) {
  const { repository, reminderService } = dependencies;
  const clock = dependencies.clock ?? { now: () => new Date() };
  const createId =
    dependencies.createId ??
    (() => `subscription-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const synchronizeReminders = async (): Promise<
    Pick<SubscriptionSyncResult, 'reminders' | 'reminderErrors'>
  > => {
    const reminderErrors: string[] = [];
    let status: SubscriptionSyncResult['reminders'] = {
      available: false,
      permission: 'unsupported',
    };
    try {
      status = await reminderService.getStatus();
      await reminderService.ensureMaintenance();
    } catch (error) {
      reminderErrors.push(
        error instanceof Error
          ? error.message
          : 'No se pudo consultar la plataforma.',
      );
    }
    const acknowledge: typeof repository.acknowledgeReminder = async (
      ...args
    ) => {
      try {
        await repository.acknowledgeReminder(...args);
      } catch (error) {
        reminderErrors.push(
          error instanceof Error
            ? error.message
            : 'No se pudo guardar el estado del recordatorio.',
        );
      }
    };
    let reminders: Awaited<ReturnType<typeof repository.getReminders>>;
    try {
      reminders = await repository.getReminders();
    } catch (error) {
      reminderErrors.push(
        error instanceof Error
          ? error.message
          : 'No se pudieron recuperar los recordatorios.',
      );
      return { reminders: status, reminderErrors };
    }
    for (const reminder of reminders) {
      if (reminder.desired === 'scheduled' && status.permission !== 'granted') {
        await acknowledge(
          reminder.id,
          reminder.revision,
          'blocked',
          status.permission,
        );
        continue;
      }
      // Re-scheduling is idempotent and also repairs lost OS alarms after reboot.
      try {
        if (reminder.desired === 'cancelled')
          await reminderService.cancel(reminder.id);
        else await reminderService.schedule(reminder);
        await acknowledge(
          reminder.id,
          reminder.revision,
          reminder.desired === 'cancelled' ? 'cancelled' : 'scheduled',
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Falló el recordatorio local.';
        reminderErrors.push(message);
        await acknowledge(reminder.id, reminder.revision, 'failed', message);
      }
    }
    return { reminders: status, reminderErrors };
  };
  const mutate = async <T>(
    operation: (state: SubscriptionState, today: string, now: string) => T,
    scope: Partial<SubscriptionScope> = {},
  ): Promise<SubscriptionMutationResult<T>> => {
    const date = clock.now();
    const today = civilDate(date);
    const now = date.toISOString();
    const result = await repository.mutate({ ...scope, today }, state => {
      const value = operation(state, today, now);
      const hasMore = synchronizeSubscriptionState(state, today, now);
      return { value, hasMore, diagnostics: state.diagnostics };
    });
    return {
      value: result.value,
      sync: {
        hasMore: result.hasMore,
        diagnostics: result.diagnostics,
        ...(await synchronizeReminders()),
      },
    };
  };
  const syncSubscriptions = async (): Promise<SubscriptionSyncResult> =>
    (await mutate(() => undefined)).sync;
  const getSubscriptions = async (filter?: { status?: SubscriptionStatus }) =>
    (await repository.getSubscriptions()).filter(
      value => !filter?.status || value.status === filter.status,
    );
  const getUpcomingSubscriptionCharges = async (range: {
    from: string;
    to: string;
  }) => {
    parseCivilDate(range.from);
    parseCivilDate(range.to);
    if (range.to < range.from) throw new Error('Rango de fechas inválido.');
    return repository.getCharges(range.from, range.to, ['pending']);
  };
  const getAnnualSubscriptionCommitment = async () =>
    roundSubscriptionMoney(
      (await getSubscriptions({ status: 'active' })).reduce(
        (total, value) =>
          total + annualEquivalent(value.amount, value.recurrence),
        0,
      ),
    );
  const getMonthlySubscriptionCommitment = async () =>
    roundSubscriptionMoney(
      (await getSubscriptions({ status: 'active' })).reduce(
        (total, value) =>
          total + annualEquivalent(value.amount, value.recurrence),
        0,
      ) / 12,
    );
  const getNextSubscriptionCharge = async () =>
    (
      await repository.getCharges(civilDate(clock.now()), '9999-12-31', [
        'pending',
      ])
    )[0];
  return {
    createSubscriptionCategory: async (name: string) => {
      if (!dependencies.categoryRepository)
        throw new Error('Creación de categorías no disponible.');
      const value = await createCategory(dependencies.categoryRepository, {
        name,
        type: 'expense',
        color: '#bbc3ff',
      });
      return { value, sync: await syncSubscriptions() };
    },
    createSubscriptionSubcategory: async (categoryId: string, name: string) => {
      if (!dependencies.subcategoryRepository)
        throw new Error('Creación de subcategorías no disponible.');
      if (
        !(await repository.getFormOptions()).categories.some(
          category => category.id === categoryId && category.type === 'expense',
        )
      )
        throw new Error('Selecciona una categoría de gasto válida.');
      const value = await createSubcategory(
        dependencies.subcategoryRepository,
        { categoryId, name },
      );
      return { value, sync: await syncSubscriptions() };
    },
    updateSubscriptionOccurrenceAmount: (
      occurrenceId: string,
      amount: number,
    ) =>
      mutate(
        (state, _today, now) =>
          updateOccurrenceAmount(state, occurrenceId, amount, now),
        { occurrenceId },
      ),
    getSubscriptionFormOptions: repository.getFormOptions,
    getOverdueSubscriptionCharges: async (
      pagination: { limit?: number; offset?: number } = {},
    ) => {
      const { limit = 50, offset = 0 } = pagination;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 500 ||
        !Number.isInteger(offset) ||
        offset < 0
      )
        throw new Error('Paginación inválida.');
      return repository.getCharges(
        '0001-01-01',
        civilDate(clock.now()),
        ['overdue'],
        { limit, offset },
      );
    },
    getSubscriptionPaymentCandidates: async (input: {
      occurrenceId: string;
      query?: string;
      suggestedOnly?: boolean;
      limit?: number;
      offset?: number;
    }) => {
      const { limit = 30, offset = 0, suggestedOnly = true } = input;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 500 ||
        !Number.isInteger(offset) ||
        offset < 0
      )
        throw new Error('Paginación inválida.');
      const state = await repository.getPaymentContext(
        input.occurrenceId,
        input.query?.trim() ?? '',
        suggestedOnly,
      );
      const occurrence = state.occurrences.find(
        value => value.id === input.occurrenceId,
      );
      if (!occurrence || !['pending', 'overdue'].includes(occurrence.status))
        throw new Error('Este cobro ya no admite vincular pagos.');
      return state.transactions
        .flatMap(transaction => {
          if (!compatibleSubscriptionPayment(occurrence, transaction))
            return [];
          const match = subscriptionMatches(state, transaction).find(
            value => value.occurrenceId === occurrence.id,
          );
          if (suggestedOnly && !match) return [];
          return [
            {
              transaction,
              score: match?.score ?? 0,
              reasons: match?.reasons ?? [
                'Movimiento compatible seleccionado manualmente',
              ],
            },
          ];
        })
        .sort(
          (a, b) =>
            b.score - a.score ||
            transactionSortValue(b.transaction) - transactionSortValue(a.transaction) ||
            a.transaction.id.localeCompare(b.transaction.id),
        )
        .slice(offset, offset + limit);
    },
    createSubscription: (input: SubscriptionInput) =>
      mutate((state, _today, now) =>
        buildSubscription(state, input, createId(), now),
      ),
    updateSubscription: (id: string, input: SubscriptionUpdate) =>
      mutate((state, today, now) =>
        updateSubscriptionState(state, id, input, today, now),
      ),
    pauseSubscription: (id: string) =>
      mutate((state, today, now) =>
        changeSubscriptionStatus(state, id, 'paused', today, now),
      ),
    resumeSubscription: (id: string) =>
      mutate((state, today, now) =>
        changeSubscriptionStatus(state, id, 'active', today, now),
      ),
    cancelSubscription: (id: string) =>
      mutate((state, today, now) =>
        changeSubscriptionStatus(state, id, 'cancelled', today, now),
      ),
    confirmSubscriptionPayment: (input: {
      occurrenceId: string;
      transactionId: string;
    }) =>
      mutate(
        (state, _today, now) =>
          confirmPayment(state, input.occurrenceId, input.transactionId, now),
        input,
      ),
    skipSubscriptionOccurrence: (id: string, notes?: string) =>
      mutate((state, _today, now) => skipOccurrence(state, id, now, notes), {
        occurrenceId: id,
      }),
    getSubscriptions,
    getActiveSubscriptions: () => getSubscriptions({ status: 'active' }),
    getSubscriptionById: async (id: string) => {
      const diagnostic = (await repository.getDiagnostics()).find(
        value => value.subscriptionId === id,
      );
      if (diagnostic) throw new Error(diagnostic.message);
      return (await getSubscriptions()).find(value => value.id === id);
    },
    getSubscriptionHistory: (
      id: string,
      pagination: { limit?: number; offset?: number } = {},
    ) => {
      const { limit = 50, offset = 0 } = pagination;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 500 ||
        !Number.isInteger(offset) ||
        offset < 0
      )
        throw new Error('Paginación inválida.');
      return repository.getHistory(id, limit, offset);
    },
    getUpcomingSubscriptionCharges,
    getNextSubscriptionCharge,
    getAnnualSubscriptionCommitment,
    getMonthlySubscriptionCommitment,
    getSubscriptionSummary: async (range?: {
      from: string;
      to: string;
    }): Promise<SubscriptionSummary> => {
      const today = civilDate(clock.now());
      const subscriptions = await getSubscriptions({ status: 'active' });
      const annual = subscriptions.reduce(
        (total, value) =>
          total + annualEquivalent(value.amount, value.recurrence),
        0,
      );
      const upcoming = await getUpcomingSubscriptionCharges(
        range ?? { from: today, to: addDays(today, 30) },
      );
      const overdue = await repository.getCharges('0001-01-01', today, [
        'overdue',
      ]);
      return {
        activeCount: subscriptions.length,
        annualEquivalent: roundSubscriptionMoney(annual),
        monthlyEquivalent: roundSubscriptionMoney(annual / 12),
        nextCharge: await getNextSubscriptionCharge(),
        upcomingCount: upcoming.length,
        overdueCount: overdue.length,
      };
    },
    findSubscriptionMatches: async (transactionId: string) =>
      repository.mutate(
        { today: civilDate(clock.now()), transactionId },
        state => {
          const transaction = state.transactions.find(
            value => value.id === transactionId,
          );
          if (!transaction) throw new Error('Transacción inexistente.');
          return subscriptionMatches(state, transaction);
        },
      ),
    syncSubscriptions,
    ensureUpcomingSubscriptionOccurrences: syncSubscriptions,
    markOverdueOccurrences: syncSubscriptions,
    syncSubscriptionCashFlow: syncSubscriptions,
    syncSubscriptionAlerts: syncSubscriptions,
    syncSubscriptionReminders: synchronizeReminders,
    getReminderStatus: reminderService.getStatus,
    requestReminderPermission: reminderService.requestPermission,
    getSubscriptionDiagnostics: repository.getDiagnostics,
  };
}
export type SubscriptionApi = ReturnType<typeof createSubscriptionApi>;
