import type { SmartFinSQLiteDatabase } from '../../../database/sqliteDatabase';
import {
  readString,
  resultSetToRows,
  type SQLiteRow,
} from '../../../database/sqliteRows';

export type MissingCreditCardAlert = {
  id: string;
  creditCardName: string;
  message: string;
  title: string;
  triggeredAt: string;
};

export type CreditCardAlertRepository = {
  getPendingMissingCreditCardAlerts: () => Promise<MissingCreditCardAlert[]>;
  resolveMissingCreditCardAlert: (creditCardName: string) => Promise<void>;
  saveMissingCreditCardAlert: (params: {
    creditCardHint?: string;
    transactionId?: string;
  }) => Promise<MissingCreditCardAlert | undefined>;
};

const ALERT_TYPE = 'missingCreditCard';
const RELATED_ENTITY_TYPE = 'creditCardHint';

function normalizeCreditCardName(value?: string): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function createAlertId(creditCardName: string): string {
  return `alert-missing-credit-card-${creditCardName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

function rowToMissingCreditCardAlert(row: SQLiteRow): MissingCreditCardAlert {
  return {
    id: readString(row, 'id'),
    creditCardName: readString(row, 'related_entity_id'),
    message: readString(row, 'message'),
    title: readString(row, 'title'),
    triggeredAt: readString(row, 'triggered_at'),
  };
}

export function createSqliteCreditCardAlertRepository(
  database: SmartFinSQLiteDatabase,
): CreditCardAlertRepository {
  return {
    getPendingMissingCreditCardAlerts: async () => {
      const [resultSet] = await database.executeSql(
        `SELECT id, title, message, related_entity_id, triggered_at
        FROM smart_alerts
        WHERE alert_type = ? AND status = ? AND related_entity_type = ?
        ORDER BY triggered_at DESC;`,
        [ALERT_TYPE, 'open', RELATED_ENTITY_TYPE],
      );

      return resultSetToRows(resultSet).map(rowToMissingCreditCardAlert);
    },
    resolveMissingCreditCardAlert: async creditCardName => {
      const normalizedName = normalizeCreditCardName(creditCardName);
      if (!normalizedName) {
        return;
      }

      await database.executeSql(
        `UPDATE smart_alerts
        SET status = ?, resolved_at = ?, updated_at = ?
        WHERE alert_type = ? AND related_entity_type = ? AND related_entity_id = ?;`,
        ['resolved', new Date().toISOString(), new Date().toISOString(), ALERT_TYPE, RELATED_ENTITY_TYPE, normalizedName],
      );
    },
    saveMissingCreditCardAlert: async ({ creditCardHint, transactionId }) => {
      const creditCardName = normalizeCreditCardName(creditCardHint);
      if (!creditCardName) {
        return undefined;
      }

      const now = new Date().toISOString();
      const alert: MissingCreditCardAlert = {
        id: createAlertId(creditCardName),
        creditCardName,
        message: `Crea la tarjeta "${creditCardName}" para asociar los movimientos pendientes.`,
        title: 'Tarjeta de credito pendiente',
        triggeredAt: now,
      };

      await database.executeSql(
        `INSERT OR REPLACE INTO smart_alerts (
          id,
          alert_type,
          severity,
          title,
          message,
          related_entity_type,
          related_entity_id,
          status,
          triggered_at,
          resolved_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT resolved_at FROM smart_alerts WHERE id = ?), NULL), COALESCE((SELECT created_at FROM smart_alerts WHERE id = ?), ?), ?);`,
        [
          alert.id,
          ALERT_TYPE,
          'warning',
          alert.title,
          transactionId ? `${alert.message} Movimiento: ${transactionId}` : alert.message,
          RELATED_ENTITY_TYPE,
          creditCardName,
          'open',
          now,
          alert.id,
          alert.id,
          now,
          now,
        ],
      );

      return alert;
    },
  };
}
