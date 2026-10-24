import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getSubscriptionApi } from '../services/subscriptionRuntime';
import type { SubscriptionApi } from '../useCases/createSubscriptionApi';
import type {
  Subscription,
  SubscriptionFormOptions,
  SubscriptionMutationResult,
  SubscriptionSummary,
  SubscriptionSyncResult,
} from '../types';

export function useSubscriptionsController(
  onChanged: () => void,
  acquireApi: () => Promise<SubscriptionApi> = getSubscriptionApi,
) {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [options, setOptions] = useState<SubscriptionFormOptions>({
    accounts: [],
    categories: [],
    subcategories: [],
  });
  const [summary, setSummary] = useState<SubscriptionSummary>();
  const [sync, setSync] = useState<SubscriptionSyncResult>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [revision, setRevision] = useState(0);
  const api = useRef<SubscriptionApi | undefined>(undefined);
  const alive = useRef(true);
  const generation = useRef(0);
  const operationActive = useRef(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const reload = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true);
    try {
      const current = await acquireApi();
      api.current = current;
      const result = await current.syncSubscriptions();
      const [values, formOptions, totals] = await Promise.all([
        current.getSubscriptions(),
        current.getSubscriptionFormOptions(),
        current.getSubscriptionSummary(),
      ]);
      if (!alive.current || token !== generation.current) return;
      setSubscriptions(values);
      setOptions(formOptions);
      setSummary(totals);
      setSync(result);
      setError(undefined);
      setRevision(value => value + 1);
    } catch (reason) {
      if (alive.current && token === generation.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'No se pudieron cargar las suscripciones.',
        );
    } finally {
      if (alive.current && token === generation.current) setLoading(false);
    }
  }, [acquireApi]);
  useEffect(() => {
    alive.current = true;
    void reload();
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void reload();
    });
    return () => {
      alive.current = false;
      listener.remove();
    };
  }, [reload]);
  const run = useCallback(
    async (
      task: (
        current: SubscriptionApi,
      ) => Promise<SubscriptionMutationResult<unknown>>,
    ) => {
      if (operationActive.current) return false;
      operationActive.current = true;
      setBusy(true);
      setError(undefined);
      setNotice(undefined);
      try {
        const current = api.current ?? (await acquireApi());
        const result = await task(current);
        if (alive.current) {
          setSync(result.sync);
          setNotice(
            result.sync.reminderErrors.length
              ? 'Guardado. Algunos recordatorios no se pudieron programar. Puedes reintentarlos.'
              : 'Cambios guardados.',
          );
          changed.current();
        }
        await reload();
        return true;
      } catch (reason) {
        if (alive.current)
          setError(
            reason instanceof Error
              ? reason.message
              : 'No se pudo completar la acción.',
          );
        return false;
      } finally {
        operationActive.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [acquireApi, reload],
  );
  const reminders = useCallback(
    async (request = false) => {
      if (operationActive.current) return;
      operationActive.current = true;
      setBusy(true);
      try {
        const current = api.current ?? (await acquireApi());
        if (request) await current.requestReminderPermission();
        const result = await current.syncSubscriptionReminders();
        if (alive.current) {
          setNotice(
            result.reminderErrors.length
              ? 'Los recordatorios siguen pendientes. Inténtalo nuevamente.'
              : 'Estado de recordatorios actualizado.',
          );
        }
        await reload();
      } catch (reason) {
        if (alive.current)
          setError(
            reason instanceof Error
              ? reason.message
              : 'No se pudieron actualizar los recordatorios.',
          );
      } finally {
        operationActive.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [acquireApi, reload],
  );
  return {
    subscriptions,
    options,
    summary,
    sync,
    loading,
    busy,
    error,
    notice,
    revision,
    reload,
    run,
    reminders,
    acquireApi,
  };
}
