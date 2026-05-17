import { useEffect, useState } from 'react';

import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import type { DashboardSummary } from '../types/DashboardSummary';
import {
  getDashboardSummary,
  getDashboardSummaryFromDb,
} from '../useCases/getDashboardSummary';

type UseDashboardSummaryResult = {
  summary: DashboardSummary;
  loading: boolean;
  error: string | undefined;
};

/**
 * Reactively loads the dashboard summary from SQLite whenever
 * `database` becomes available or `refreshKey` changes (e.g. after
 * a new SMS transaction is saved or financial data is deleted).
 *
 * Falls back to the mock summary while the database is not yet ready.
 */
export function useDashboardSummary(
  database: SmartFinSQLiteDatabase | undefined,
  refreshKey: number,
): UseDashboardSummaryResult {
  const [summary, setSummary] = useState<DashboardSummary>(() =>
    getDashboardSummary(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!database) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);

    getDashboardSummaryFromDb(database)
      .then(result => {
        if (!cancelled) {
          setSummary(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('No se pudo cargar el resumen financiero.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [database, refreshKey]);

  return { summary, loading, error };
}
