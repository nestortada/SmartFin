import { useEffect, useState } from 'react';

import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import type { DashboardSummary } from '../types/DashboardSummary';
import {
  getEmptyDashboardSummary,
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
 * financial data is changed or deleted).
 *
 * Uses an empty local summary while the database is not yet ready.
 */
export function useDashboardSummary(
  database: SmartFinSQLiteDatabase | undefined,
  refreshKey: number,
): UseDashboardSummaryResult {
  const [summary, setSummary] = useState<DashboardSummary>(() => getEmptyDashboardSummary());
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
