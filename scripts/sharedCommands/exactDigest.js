const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');
const tables = [
  'accounts',
  'transactions',
  'shared_contacts',
  'shared_expenses',
  'transaction_splits',
  'shared_receipts',
  'shared_allocations',
  'shared_returns',
  'shared_loss_events',
  'shared_commands',
  'installment_purchases',
  'credit_card_statements',
];
// Cross-runtime oracle: floating SQLite values use binary64 bits, never decimal formatting.
function exactDigest(db) {
  return Object.fromEntries(
    tables.map(table => {
      const real = new Set(
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .filter(c => c.type === 'REAL')
          .map(c => c.name),
      );
      const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
      const hash = createHash('sha256');
      for (const row of rows)
        for (const [key, value] of Object.entries(row)) {
          if (key === 'created_at' || key === 'updated_at') continue;
          let raw;
          if (value === null) raw = '<NULL>';
          else if (real.has(key)) {
            const bytes = Buffer.alloc(8);
            bytes.writeDoubleBE(value);
            raw = bytes.readBigUInt64BE().toString(16);
          } else raw = String(value);
          raw = raw.replace(/tx_manual_\d+(?:_\d+)?/g, 'generated-purchase');
          hash.update(`${raw.length}:${raw};`);
        }
      return [table, { count: rows.length, sha256: hash.digest('hex') }];
    }),
  );
}
module.exports = { exactDigest };
