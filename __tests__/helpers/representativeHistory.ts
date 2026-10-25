// Default representative volumes (AGENTS.md "Performance Volumes"):
// 100,000 movements over 50 calendar years, 10,000 over 5 and 1,000 over 6 months,
// all ending on the reference day. Pure SQL with a fixed seed so Node and the
// synthetic Android APK generate byte-identical histories. Synthetic data only.
export const REPRESENTATIVE_REFERENCE_DAY = '2026-10-25';
export const REPRESENTATIVE_SEED = 20261025;
export const REPRESENTATIVE_VOLUMES = {
  1000: { start: '2026-04-26', label: '6 meses (2026-04-26 – 2026-10-25)' },
  10000: { start: '2022-01-01', label: '5 años calendario (2022–2026)' },
  100000: { start: '1977-01-01', label: '50 años calendario (1977–2026)' },
} as const;
export type RepresentativeSize = keyof typeof REPRESENTATIVE_VOLUMES;

// Deterministic per-row hashes (64-bit SQLite integers, never negative here).
const hash = (salt: number) => `((n * 2654435761 + ${REPRESENTATIVE_SEED} * ${salt}) % 1000003)`;

export function representativeSeedStatements(size: RepresentativeSize): string[] {
  const { start } = REPRESENTATIVE_VOLUMES[size];
  const span = `(julianday('${REPRESENTATIVE_REFERENCE_DAY}') - julianday('${start}') + 1)`;
  // Kind buckets per 100: 70 expense, 8 credit expense, 10 income, 8 transfer, 4 card payment.
  const kind = `(${hash(1)} % 100)`;
  const isIncome = `${kind} BETWEEN 78 AND 87`;
  // Salaries land on the 1st or 15th of their month; everything else on any day.
  const rawDay = `date('${start}', '+' || (${hash(2)} % CAST(${span} AS INTEGER)) || ' days')`;
  const civilDay = `CASE WHEN ${isIncome} THEN MAX('${start}', MIN('${REPRESENTATIVE_REFERENCE_DAY}', substr(${rawDay}, 1, 8) || CASE WHEN ${hash(3)} % 2 = 0 THEN '01' ELSE '15' END)) ELSE ${rawDay} END`;
  const localTime = `printf('%02d:%02d', 6 + ${hash(4)} % 17, ${hash(5)} % 60)`;
  return [
    `INSERT OR IGNORE INTO accounts (id, name, type, status, currency, balance_amount, debt_balance_amount, created_at, updated_at) VALUES
      ('rep-bank', 'Banco principal', 'bankAccount', 'active', 'COP', 4500000, NULL, '1977-01-01', '1977-01-01'),
      ('rep-bank2', 'Banco secundario', 'bankAccount', 'active', 'COP', 820000, NULL, '1977-01-01', '1977-01-01'),
      ('rep-savings', 'Ahorros', 'savingsAccount', 'active', 'COP', 12000000, NULL, '1977-01-01', '1977-01-01'),
      ('rep-cash', 'Efectivo', 'cash', 'active', 'COP', 150000, NULL, '1977-01-01', '1977-01-01'),
      ('rep-card', 'Tarjeta Visa', 'creditCard', 'active', 'COP', 0, 1250000, '1977-01-01', '1977-01-01'),
      ('rep-card2', 'Tarjeta Master', 'creditCard', 'active', 'COP', 0, 380000, '1977-01-01', '1977-01-01');`,
    `INSERT OR IGNORE INTO categories (id, name, type, macro_category, color) VALUES
      ('rep-food', 'Comida', 'expense', 'needs', '#000000'), ('rep-transport', 'Transporte', 'expense', 'needs', '#000000'),
      ('rep-housing', 'Vivienda', 'expense', 'needs', '#000000'), ('rep-health', 'Salud', 'expense', 'needs', '#000000'),
      ('rep-fun', 'Entretenimiento', 'expense', 'wants', '#000000'), ('rep-services', 'Servicios', 'expense', 'needs', '#000000'),
      ('rep-education', 'Educación', 'expense', 'savings', '#000000'), ('rep-salary', 'Salario', 'income', 'income', '#000000');`,
    `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${size}),
     rows AS (SELECT n, ${kind} AS kind, ${civilDay} AS day, ${localTime} AS clock FROM seq)
     INSERT INTO transactions(id, amount, currency, description, date, civil_date, local_time, time_zone, date_precision,
       account_id, category_id, type, direction, status, target_account_id, merchant_name, payment_method, notes, created_at, updated_at)
     SELECT 'rep-' || n,
       CASE WHEN kind BETWEEN 78 AND 87 THEN 2000000 + (${hash(6)} % 60) * 100000
            WHEN kind >= 88 THEN 50000 + (${hash(6)} % 400) * 1000
            WHEN ${hash(7)} % 100 = 0 THEN 1000 + (${hash(6)} % 50000) + 0.5
            ELSE 2000 + (${hash(6)} % 4000) * 100 END,
       'COP',
       CASE WHEN kind BETWEEN 78 AND 87 THEN 'Salario'
            WHEN kind BETWEEN 88 AND 95 THEN 'Transferencia entre cuentas'
            WHEN kind >= 96 THEN 'Pago tarjeta'
            ELSE 'Compra ' || (${hash(8)} % 300) END,
       strftime('%Y-%m-%dT%H:%M:00.000Z', day || ' ' || clock, '+5 hours'), day, clock, 'America/Bogota', 'dateTime',
       CASE WHEN kind BETWEEN 70 AND 77 THEN CASE WHEN n % 3 = 0 THEN 'rep-card2' ELSE 'rep-card' END
            WHEN kind BETWEEN 78 AND 87 THEN 'rep-bank'
            WHEN kind BETWEEN 88 AND 95 THEN CASE WHEN n % 2 = 0 THEN 'rep-bank' ELSE 'rep-savings' END
            WHEN kind >= 96 THEN 'rep-bank'
            ELSE CASE ${hash(9)} % 4 WHEN 0 THEN 'rep-cash' WHEN 1 THEN 'rep-bank2' ELSE 'rep-bank' END END,
       CASE WHEN kind BETWEEN 78 AND 87 THEN 'rep-salary' WHEN kind >= 88 THEN NULL
            ELSE CASE ${hash(10)} % 7 WHEN 0 THEN 'rep-food' WHEN 1 THEN 'rep-transport' WHEN 2 THEN 'rep-housing'
              WHEN 3 THEN 'rep-health' WHEN 4 THEN 'rep-fun' WHEN 5 THEN 'rep-services' ELSE 'rep-education' END END,
       CASE WHEN kind BETWEEN 78 AND 87 THEN 'income' WHEN kind BETWEEN 88 AND 95 THEN 'internalTransfer'
            WHEN kind >= 96 THEN 'creditCardPayment' ELSE 'expense' END,
       CASE WHEN kind BETWEEN 78 AND 87 THEN 'inflow' ELSE 'outflow' END,
       CASE ${hash(11)} % 100 WHEN 0 THEN 'cancelled' WHEN 1 THEN 'cancelled' WHEN 2 THEN 'pending' WHEN 3 THEN 'pending' WHEN 4 THEN 'pending' ELSE 'posted' END,
       CASE WHEN kind BETWEEN 88 AND 95 THEN CASE WHEN n % 2 = 0 THEN 'rep-savings' ELSE 'rep-bank' END
            WHEN kind >= 96 THEN CASE WHEN n % 3 = 0 THEN 'rep-card2' ELSE 'rep-card' END ELSE NULL END,
       CASE WHEN kind < 78 THEN 'Comercio ' || (${hash(8)} % 300) ELSE NULL END,
       CASE WHEN kind BETWEEN 70 AND 77 THEN 'credit' WHEN kind < 70 THEN 'debit' ELSE NULL END,
       CASE WHEN ${hash(12)} % 10 = 0 THEN 'Nota sintética, con "comillas" y ñ' ELSE NULL END,
       strftime('%Y-%m-%dT%H:%M:%fZ', day || ' ' || clock, '+5 hours', '+' || (${hash(13)} % 7200) || ' seconds'),
       strftime('%Y-%m-%dT%H:%M:%fZ', day || ' ' || clock, '+5 hours', '+' || (${hash(13)} % 7200) || ' seconds')
     FROM rows;`,
  ];
}
