import { useEffect, useState } from 'react';

import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { createSqliteTransactionRepository } from '../../transactions/repositories/sqliteTransactionRepository';
import { createSqliteCreditCardRepository } from '../repositories';
import type { CreditCardsOverview } from '../types';
import { getCreditCardsOverview } from '../useCases';

type CreditCardsOverviewState = {
  error?: string;
  loading: boolean;
  overview: CreditCardsOverview;
};

const EMPTY_OVERVIEW: CreditCardsOverview = {
  cards: [],
  generatedAt: new Date(0).toISOString(),
};

export function useCreditCardsOverview(
  database?: SmartFinSQLiteDatabase,
  refreshKey = 0,
): CreditCardsOverviewState {
  const [state, setState] = useState<CreditCardsOverviewState>({
    loading: Boolean(database),
    overview: EMPTY_OVERVIEW,
  });

  useEffect(() => {
    let isMounted = true;

    if (!database) {
      setState({
        loading: false,
        overview: EMPTY_OVERVIEW,
      });
      return undefined;
    }

    setState(current => ({
      ...current,
      error: undefined,
      loading: true,
    }));

    getCreditCardsOverview(
      createSqliteCreditCardRepository(database),
      createSqliteTransactionRepository(database),
    )
      .then(overview => {
        if (!isMounted) {
          return;
        }

        setState({
          loading: false,
          overview,
        });
      })
      .catch(error => {
        if (!isMounted) {
          return;
        }

        setState({
          error: error instanceof Error ? error.message : 'No se pudieron cargar las tarjetas.',
          loading: false,
          overview: EMPTY_OVERVIEW,
        });
      });

    return () => {
      isMounted = false;
    };
  }, [database, refreshKey]);

  return state;
}
