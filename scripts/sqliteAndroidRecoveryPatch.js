// Approved phase 1.1 patch. Fail closed if the installed driver layout changes.
const anchor = `            if (dbq != null && dbq.close) {
                try {
                    closeDatabaseNow(dbname);`;
const replacement = `            if (dbq != null && dbq.close) {
                try {
                    // SmartFin: release this DBRunner thread's abandoned sessions.
                    // Native commit flags are preserved; JS command outcome stays unknown.
                    while (this.mydb.inTransaction()) {
                        this.mydb.endTransaction();
                    }
                    closeDatabaseNow(dbname);`;
function patchSQLiteAndroidRecovery(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const normalized = source.replace(/\r\n/g, '\n');
  if (
    normalized.split(replacement).length === 2 &&
    !normalized.includes(anchor)
  )
    return source;
  if (
    normalized.split(anchor).length !== 2 ||
    normalized.includes('SmartFin: release')
  )
    throw new Error(
      'Unsupported SQLite driver close layout; recovery patch not applied',
    );
  return normalized.replace(anchor, replacement).replace(/\n/g, newline);
}
module.exports = { patchSQLiteAndroidRecovery };
