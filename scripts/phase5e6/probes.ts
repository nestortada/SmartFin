// Phase 5E.6: synthetic probes shared by the test APK (Kotlin inserts them into a private
// copy of a published database and runs the production CSV exporter) and the Node checks.
// Small and pathological on purpose: they test cells and tie-breaks, not volume.

// Two 32-bit words, without BigInt, so the same code runs on Hermes and Node.
/** IEEE-754 bits as 16 hex digits, so Kotlin stores exactly this double. */
export function bitsOf(value: number) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return [0, 4].map(at => view.getUint32(at).toString(16).padStart(8, '0')).join('');
}
export function fromBits(hex: string) {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, parseInt(hex.slice(0, 8), 16));
  view.setUint32(4, parseInt(hex.slice(8), 16));
  return view.getFloat64(0);
}
/** Adjacent double of a positive finite value. */
const adjacent = (value: number, direction: 1 | -1) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const low = view.getUint32(4) + direction;
  view.setUint32(4, (low + 0x100000000) % 0x100000000);
  if (low < 0 || low > 0xffffffff) view.setUint32(0, view.getUint32(0) + direction);
  return view.getFloat64(0);
};

/** Deterministic xorshift: finite doubles from random bit patterns, and money-like amounts. */
export function randomDoubles(count: number) {
  let state = 0x9e3779b9;
  // eslint-disable-next-line no-bitwise -- xorshift32 is defined on 32-bit words
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 2) { const v = fromBits(next().toString(16).padStart(8, '0') + next().toString(16).padStart(8, '0')); if (Number.isFinite(v)) values.push(v); }
    else values.push((next() % 2 ? -1 : 1) * (next() * 4096 + next() % 4096) / [1, 10, 100][next() % 3]!);
  }
  return values;
}

/** Amounts and balances (COP) plus binary edge cases. Each becomes one REAL cell per CSV. */
export const PRECISION_VALUES: { label: string; value: number }[] = [
  { label: '1.234.567 COP', value: 1234567 },
  { label: '123.456,50 COP', value: 123456.5 },
  { label: '525.357.500 COP', value: 525357500 },
  { label: '8.296.299,60 COP (saldo 5E.5)', value: 8296299.6 },
  { label: '2.345.678,90 COP', value: 2345678.9 },
  { label: '1.234.565 COP (empate %g)', value: 1234565 },
  { label: '12.345,50 COP', value: 12345.5 },
  { label: '44.900 COP', value: 44900 },
  { label: '0,01 COP', value: 0.01 },
  { label: '0,40 COP', value: 0.4 },
  { label: '0,1 + 0,2', value: 0.1 + 0.2 },
  { label: 'cero', value: 0 },
  { label: 'negativo -44.900,25', value: -44900.25 },
  { label: 'negativo -525.357.500', value: -525357500 },
  { label: 'negativo -0,01', value: -0.01 },
  { label: 'billón 1.000.000.000.000', value: 1e12 },
  { label: '98.765.432.109.876,54', value: 98765432109876.54 },
  { label: 'MAX_SAFE_INTEGER', value: Number.MAX_SAFE_INTEGER },
  { label: '2^53 + 2', value: 2 ** 53 + 2 },
  { label: '%g exponencial 1e-05', value: 0.00001 },
  { label: '1e-7', value: 1e-7 },
  { label: '1e21', value: 1e21 },
  { label: '1.2345678901234567e+25', value: 1.2345678901234567e25 },
  { label: '1e300', value: 1e300 },
  { label: 'Number.MAX_VALUE', value: Number.MAX_VALUE },
  { label: 'menor normal', value: 2.2250738585072014e-308 },
  { label: 'menor subnormal', value: 5e-324 },
  { label: 'siguiente a 1', value: adjacent(1, 1) },
  { label: 'anterior a 1.234.567', value: adjacent(1234567, -1) },
  { label: 'siguiente a 123.456,5', value: adjacent(123456.5, 1) },
  { label: '1/3 (17 cifras)', value: 1 / 3 },
  { label: '-2/3', value: -2 / 3 },
  { label: '2^53 + 1 (se guarda 2^53)', value: 2 ** 53 + 1 },
];

/**
 * Annual-order probes (civil date, local time, created_at). Inserted in this order, so rowid
 * order is the reverse of the declared order inside 1902-03-04 and the statuses alternate:
 * SQLite 3.9.2 with the old ORDER BY returns idx_transactions_civil_day order (day, status, rowid).
 * 'tie-*' rows are full ties of every ORDER BY term: their relative order is not specified.
 */
export const ORDER_ROWS: { id: string; date: string; civilDate: string | null; localTime: string | null; createdAt: string; status: string }[] = [
  { id: 'order-09', date: '1902-03-04T23:00:00.000Z', civilDate: '1902-03-04', localTime: '18:00', createdAt: '1902-03-04T23:00:00.000Z', status: 'posted' },
  { id: 'order-08', date: '1902-03-04T22:00:00.000Z', civilDate: '1902-03-04', localTime: '17:00', createdAt: '1902-03-04T22:00:00.000Z', status: 'cancelled' },
  { id: 'order-07', date: '1902-03-04T21:00:00.000Z', civilDate: '1902-03-04', localTime: '16:00', createdAt: '1902-03-04T21:30:00.000Z', status: 'pending' },
  { id: 'order-06', date: '1902-03-04T21:00:00.000Z', civilDate: '1902-03-04', localTime: '16:00', createdAt: '1902-03-04T21:00:00.000Z', status: 'posted' },
  { id: 'order-05', date: '1902-03-04T15:00:00.000Z', civilDate: '1902-03-04', localTime: '10:00', createdAt: '1902-03-04T15:00:00.000Z', status: 'cancelled' },
  { id: 'order-04', date: '1902-03-04T05:00:00.000Z', civilDate: '1902-03-04', localTime: '00:00', createdAt: '1902-03-04T05:00:00.000Z', status: 'pending' },
  { id: 'order-03', date: '1902-03-04', civilDate: null, localTime: null, createdAt: '1902-03-04T12:00:00.000Z', status: 'posted' },
  { id: 'order-02', date: '1902-03-04', civilDate: '1902-03-04', localTime: null, createdAt: '1902-03-04T01:00:00.000Z', status: 'pending' },
  { id: 'order-01', date: '1902-03-03T12:00:00.000Z', civilDate: '1902-03-03', localTime: '07:00', createdAt: '1902-03-03T12:00:00.000Z', status: 'posted' },
  // The UTC date is in 1902, the civil day in 1903: it belongs to movimientos-1903.csv only.
  { id: 'order-10', date: '1902-12-31T23:30:00-05:00', civilDate: '1903-01-01', localTime: '04:30', createdAt: '1903-01-01T09:30:00.000Z', status: 'posted' },
  { id: 'order-11', date: '1903-01-01T08:00:00.000Z', civilDate: '1902-12-31', localTime: '23:00', createdAt: '1903-01-01T04:00:00.000Z', status: 'posted' },
  { id: 'tie-3', date: '1902-06-01', civilDate: '1902-06-01', localTime: '12:00', createdAt: '1902-06-01T17:00:00.000Z', status: 'posted' },
  { id: 'tie-1', date: '1902-06-01', civilDate: '1902-06-01', localTime: '12:00', createdAt: '1902-06-01T17:00:00.000Z', status: 'cancelled' },
  { id: 'tie-2', date: '1902-06-01', civilDate: '1902-06-01', localTime: '12:00', createdAt: '1902-06-01T17:00:00.000Z', status: 'pending' },
];
