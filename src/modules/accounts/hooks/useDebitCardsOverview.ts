import { useEffect, useState } from 'react';

import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import { createSqliteTransactionRepository } from '../../transactions/repositories/sqliteTransactionRepository';
import { createSqliteAccountRepository } from '../repositories/sqliteAccountRepository';
import {
  getDebitCardsOverview,
  type DebitCardsOverview,
} from '../useCases';

type DebitCardsOverviewState = {
  error?: string;
  loading: boolean;
  overview: DebitCardsOverview;
};

const EMPTY_OVERVIEW: DebitCardsOverview = {
  cards: [],
  generatedAt: new Date(0).toISOString(),
  totalAvailable: 0,
};

export function useDebitCardsOverview(
  database?: SmartFinSQLiteDatabase,
  refreshKey = 0,
): DebitCardsOverviewState {
  const [state, setState] = useState<DebitCardsOverviewState>({
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

    getDebitCardsOverview({
      accountRepository: createSqliteAccountRepository(database),
      transactionRepository: createSqliteTransactionRepository(database),
    })
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
          error: error instanceof Error ? error.message : 'No se pudieron cargar las tarjetas debito.',
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
