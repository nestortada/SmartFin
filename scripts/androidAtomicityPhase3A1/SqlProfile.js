// Test harness only: monotonic spans and a deterministic audit clock.
const RealDate = Date;
const performance = global.performance;
const fixed = '2026-10-11T12:00:00.000Z';
let active = false;
let sqlSamples = [];
let spans = [];
export const wallClockNow = () => RealDate.now();
export function fixedClock() {
  global.Date = class extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(fixed); }
    static now() { return new RealDate(fixed).getTime(); }
  };
}
export function restoreClock() { global.Date = RealDate; }
export function startProfile() { sqlSamples = []; spans = []; active = true; }
export function stopProfile() { active = false; return { sql: sqlSamples, spans }; }
export function span(name, ms) { if (active) spans.push({ name, ms }); }
const fixedSQL = sql => sql.replace(/strftime\('%Y-%m-%dT%H:%M:%fZ',\s*'now'\)/g, "strftime('%Y-%m-%dT%H:%M:%fZ','2026-10-11T12:00:00.000Z')");
export function profileDatabase(raw, deterministic = false) {
  const fix = sql => deterministic ? fixedSQL(sql) : sql;
  return new Proxy(raw, { get(target, key) {
    if (key === 'executeSql') return async (sql, values) => {
      const started = performance.now();
      const result = await target.executeSql(fix(sql), values);
      if (active) sqlSamples.push({ sql, values: values ?? [], ms: performance.now() - started, startMs: started, endMs: performance.now(), rows: result[0].rows.length });
      return result;
    };
    if (key === 'transaction') return (callback, ...rest) => target.transaction(tx => callback(new Proxy(tx, { get(t, k) {
      if (k === 'executeSql') return (sql, ...args) => t.executeSql(fix(sql), ...args);
      const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v;
    } })), ...rest);
    if (key === 'then') return undefined;
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
