/** Civil movement dates are distinct from the UTC audit clock. */
export const TRANSACTION_TIME_ZONE = 'America/Bogota' as const;
export type TransactionDate =
  | { kind: 'date'; date: string }
  | {
      kind: 'dateTime';
      date: string;
      time: string;
      timeZone: typeof TRANSACTION_TIME_ZONE;
    };

export type TransactionDateFields = {
  date: string;
  civilDate?: string;
  localTime?: string;
  timeZone?: string;
  datePrecision?: 'date' | 'dateTime';
};

export function validateCivilDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000')
    throw new Error('Fecha inválida. Usa YYYY-MM-DD.');
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new Error('La fecha no existe.');
  return value;
}

const bogotaFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TRANSACTION_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
function bogotaParts(instant: Date): { date: string; time: string } {
  const parts = bogotaFormatter.formatToParts(instant);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find(p => p.type === name)!.value;
  return {
    date: `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}
export function bogotaToday(now: Date = new Date()): string {
  return bogotaParts(now).date;
}
export function bogotaCalendarDate(now: Date): Date {
  // Civil arithmetic uses the host calendar only after extracting Colombia's day.
  return new Date(`${bogotaToday(now)}T12:00:00`);
}

export function encodeTransactionDate(
  value: TransactionDate,
): TransactionDateFields {
  const civilDate = validateCivilDate(value.date);
  if (value.kind === 'date')
    return { date: civilDate, civilDate, datePrecision: 'date' };
  if (
    value.timeZone !== TRANSACTION_TIME_ZONE ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)
  )
    throw new Error('Hora inválida. Usa HH:mm en Colombia.');
  // Resolve the zone from the complete civil date (including historical offsets).
  const requested = new Date(`${civilDate}T${value.time}:00Z`).getTime();
  let instant = new Date(requested + 5 * 60 * 60 * 1000);
  for (let attempt = 0; attempt < 3; attempt++) {
    const local = bogotaParts(instant);
    if (local.date === civilDate && local.time === value.time) break;
    instant = new Date(
      instant.getTime() +
        requested -
        new Date(`${local.date}T${local.time}:00Z`).getTime(),
    );
  }
  const resolved = bogotaParts(instant);
  if (resolved.date !== civilDate || resolved.time !== value.time)
    throw new Error('La hora no existe en Colombia para esa fecha.');
  return {
    date: instant.toISOString(),
    civilDate,
    localTime: value.time,
    timeZone: value.timeZone,
    datePrecision: 'dateTime',
  };
}

/** Strict wire format: bare day, local ISO minute, or timestamp with offset. */
export function parseTransactionDate(value: string): TransactionDate {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return { kind: 'date', date: validateCivilDate(value) };
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(
      value,
    );
  if (!match)
    throw new Error('Indica una fecha YYYY-MM-DD y una hora opcional HH:mm.');
  validateCivilDate(match[1]!);
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(match[2]!) ||
    Number(match[3] ?? 0) > 59
  )
    throw new Error('Hora inválida.');
  let date = match[1]!;
  let time = match[2]!;
  if (match[4]) {
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) throw new Error('Fecha inválida.');
    const local = bogotaParts(instant);
    date = local.date;
    time = local.time;
  }
  return { kind: 'dateTime', date, time, timeZone: TRANSACTION_TIME_ZONE };
}

export function transactionDateKey(
  value: Pick<TransactionDateFields, 'date' | 'civilDate'>,
): string {
  return value.civilDate ?? value.date.slice(0, 10);
}

export function validateTransactionDateFields(
  value: TransactionDateFields,
): void {
  if (
    [
      value.civilDate,
      value.localTime,
      value.timeZone,
      value.datePrecision,
    ].every(field => field === undefined)
  )
    return;
  if (
    !value.civilDate ||
    !['date', 'dateTime'].includes(value.datePrecision ?? '')
  )
    throw new Error('Metadatos de fecha incompletos.');
  const encoded =
    value.datePrecision === 'date'
      ? encodeTransactionDate({ kind: 'date', date: value.civilDate })
      : encodeTransactionDate({
          kind: 'dateTime',
          date: value.civilDate,
          time: value.localTime ?? '',
          timeZone: value.timeZone as typeof TRANSACTION_TIME_ZONE,
        });
  if (
    encoded.date !== value.date ||
    encoded.localTime !== value.localTime ||
    encoded.timeZone !== value.timeZone
  )
    throw new Error('La fecha, hora y precisión del movimiento no coinciden.');
}

export function transactionSortValue(value: TransactionDateFields): number {
  // Midnight is only a sorting convention for days without a supplied hour.
  return new Date(
    value.civilDate
      ? `${value.civilDate}T${value.localTime ?? '00:00'}:00.000Z`
      : value.date,
  ).getTime();
}

export const TRANSACTION_DAY_SQL = 'COALESCE(civil_date, substr(date, 1, 10))';
export const TRANSACTION_SORT_SQL =
  "COALESCE(civil_date || 'T' || COALESCE(local_time, '00:00') || ':00.000Z', date)";
