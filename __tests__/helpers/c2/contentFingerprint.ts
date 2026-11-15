// Etapa C2 — prototipo aislado (no es código de producción). Huella canónica del contenido, formato v1.
//
// Especificación (debe reproducirse igual en Kotlin en C3):
// 1. Tablas: todas las de sqlite_master con type='table' y nombre que no empieza por 'sqlite_', ordenadas por
//    nombre (bytes UTF-8). En app_settings se excluyen las claves reservadas que empiezan por '__smartfin_'
//    (estado de plataforma: ciclo de vida del borrado, identidades futuras), no datos financieros.
// 2. Columnas: nombres de PRAGMA table_info ordenados por bytes. Se codifican junto a cada valor.
// 3. Valor: lo calcula SQLite salvo REAL, para no depender de la versión de printf ni de la plataforma:
//      SELECT typeof(c), CASE typeof(c) WHEN 'integer' THEN CAST(c AS TEXT) WHEN 'real' THEN c ELSE hex(c) END
//    null    -> "n"
//    integer -> "i<len>:<decimal exacto de SQLite (64 bits)>"
//    real    -> "r:<16 hex, bits IEEE-754 big-endian leídos con sqlite3_column_double>"  (sin redondeo)
//    text    -> "t<bytes>:<hex de los bytes UTF-8>"
//    blob    -> "b<bytes>:<hex>"
// 4. Fila: concatenación por columna de "<len(nombre)>:<nombre>=<valor>;". rowDigest = SHA-256(fila UTF-8).
// 5. Tabla: SHA-256("table:<nombre>\ncolumns:<c1,c2,...>\nrows:<n>\n" + rowDigests ordenados unidos por "\n").
//    Ordenar los digests de fila hace la huella independiente de rowid, orden de inserción y VACUUM.
// 6. Huella: SHA-256("smartfin-content-fingerprint/v1\n" + líneas "<tabla> <digest>" unidas por "\n"), hex.
// No prueba autenticidad: cualquiera que reescriba la base puede recalcularla.
type Row = Record<string, unknown>;
type Db = { prepare: (sql: string) => { all: (...values: unknown[]) => Row[] }; close: () => void };
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (file: string, options?: { readOnly?: boolean }) => Db };
const crypto = require('node:crypto') as {
  createHash: (algorithm: string) => { update: (data: string) => { digest: (encoding: 'hex') => string } };
};

export const FINGERPRINT_FORMAT = 'smartfin-content-fingerprint/v1';
export const RESERVED_SETTING_PREFIX = '__smartfin_';

const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;
const byteOrder = (a: string, b: string) => {
  const left = Array.from(new TextEncoderPolyfill().encode(a));
  const right = Array.from(new TextEncoderPolyfill().encode(b));
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return left.length - right.length;
};
// Minimal UTF-8 encoder (identifiers and hex are ASCII in practice; kept exact for any input).
class TextEncoderPolyfill {
  encode(text: string): number[] {
    const out: number[] = [];
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if (code < 0x80) out.push(code);
      else if (code < 0x800) out.push(0xc0 + Math.floor(code / 64), 0x80 + (code % 64));
      else if (code < 0x10000) out.push(0xe0 + Math.floor(code / 4096), 0x80 + (Math.floor(code / 64) % 64), 0x80 + (code % 64));
      else out.push(0xf0 + Math.floor(code / 262144), 0x80 + (Math.floor(code / 4096) % 64), 0x80 + (Math.floor(code / 64) % 64), 0x80 + (code % 64));
    }
    return out;
  }
}

export function realBits(value: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  let hex = '';
  for (let i = 0; i < 8; i++) hex += view.getUint8(i).toString(16).padStart(2, '0');
  return hex;
}

export function encodeValue(type: string, value: unknown): string {
  switch (type) {
    case 'null': return 'n';
    case 'integer': { const text = String(value); return `i${text.length}:${text}`; }
    case 'real': return `r:${realBits(Number(value))}`;
    case 'text': { const hex = String(value).toLowerCase(); return `t${hex.length / 2}:${hex}`; }
    case 'blob': { const hex = String(value).toLowerCase(); return `b${hex.length / 2}:${hex}`; }
    default: throw new Error(`Tipo SQLite desconocido: ${type}`);
  }
}

export type ContentFingerprint = { format: string; digest: string; tables: Record<string, { rows: number; digest: string }> };

export function contentFingerprint(file: string): ContentFingerprint {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").all()
      .map(row => String(row.name)).sort(byteOrder);
    const tables: ContentFingerprint['tables'] = {};
    const lines: string[] = [];
    for (const name of names) {
      const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all().map(row => String(row.name)).sort(byteOrder);
      const select = columns.map((column, index) => {
        const c = quoteIdentifier(column);
        return `typeof(${c}) AS t${index}, CASE typeof(${c}) WHEN 'integer' THEN CAST(${c} AS TEXT) WHEN 'real' THEN ${c} ELSE hex(${c}) END AS v${index}`;
      }).join(', ');
      const where = name === 'app_settings' ? ` WHERE setting_key NOT LIKE '${RESERVED_SETTING_PREFIX.replace(/_/g, '\\_')}%' ESCAPE '\\'` : '';
      const digests = db.prepare(`SELECT ${select} FROM ${quoteIdentifier(name)}${where}`).all().map(row => sha(
        columns.map((column, index) => `${column.length}:${column}=${encodeValue(String(row[`t${index}`]), row[`v${index}`])};`).join(''),
      )).sort();
      const digest = sha(`table:${name}\ncolumns:${columns.join(',')}\nrows:${digests.length}\n${digests.join('\n')}`);
      tables[name] = { rows: digests.length, digest };
      lines.push(`${name} ${digest}`);
    }
    return { format: FINGERPRINT_FORMAT, digest: sha(`${FINGERPRINT_FORMAT}\n${lines.join('\n')}`), tables };
  } finally { db.close(); }
}
