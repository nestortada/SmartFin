package com.smartfin

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/** CSV queries preserve the historical contract; every query uses the same private snapshot. */
object SmartFinBackupCsv {
  val fixedFileNames: Set<String> get() = EXPORTS.map { it.fileName }.toSet()
  fun validate(file: File, expected: JSONObject, timings: JSONObject? = null) {
    SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
      db.execSQL("PRAGMA foreign_keys=ON")
      val actual = SmartFinLocalSnapshot.describe(db, timings)
      for (key in listOf("schema", "tables", "revision", "userVersion", "schemaVersion"))
        check(actual.get(key).toString() == expected.get(key).toString()) { "Snapshot metadata mismatch: $key" }
    }
  }
  /** `timings`, when given, receives one {name, rows, ms} entry per file (observation only). */
  fun export(file: File, directory: File, timings: JSONArray? = null): List<Pair<String, File>> {
    val result = mutableListOf<Pair<String, File>>()
    SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
      db.execSQL("PRAGMA foreign_keys=ON")
      for (definition in EXPORTS) {
        val csv = File(directory, definition.fileName)
        timed(timings, definition.fileName) { writeCsv(csv, db, definition.query) }
        result.add(definition.fileName to csv)
      }
      for (year in queryYears(db)) {
        check(year.matches(Regex("[0-9]{4}"))) { "Invalid transaction year" }
        val name = "movimientos-$year.csv"
        val csv = File(directory, name)
        // The range on the indexed civil-day expression only narrows the scan; the
        // original year predicate still decides membership and ORDER BY is unchanged.
        timed(timings, name) {
          if (year == "9999") writeCsv(csv, db, YEARLY_TRANSACTIONS_LAST_QUERY, arrayOf(year))
          else writeCsv(csv, db, YEARLY_TRANSACTIONS_QUERY, arrayOf(year, (year.toInt() + 1).toString().padStart(4, '0')))
        }
        result.add(name to csv)
      }
    }
    return result
  }
  private inline fun timed(timings: JSONArray?, name: String, write: () -> Int) {
    val start = System.nanoTime()
    val rows = write()
    timings?.put(JSONObject().put("name", name).put("rows", rows).put("ms", (System.nanoTime() - start) / 1_000_000.0))
  }
  private fun writeCsv(file: File, database: SQLiteDatabase, query: String, args: Array<String>? = null): Int =
    database.rawQuery(query, args).use { cursor ->
      file.outputStream().use { output ->
        output.write(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()))
        output.bufferedWriter(Charsets.UTF_8).use { writer ->
          writer.appendLine(cursor.columnNames.joinToString(",") { csvEscape(it) })
          val row = StringBuilder(512)
          val columns = cursor.columnCount
          while (cursor.moveToNext()) {
            row.setLength(0)
            for (column in 0 until columns) {
              if (column > 0) row.append(',')
              row.append(csvEscape(cursorValue(cursor, column)))
            }
            writer.appendLine(row)
          }
        }
      }
      cursor.count
    }
  private fun cursorValue(cursor: Cursor, index: Int): String =
      if (cursor.isNull(index)) "" else cursor.getString(index)

  private fun csvEscape(value: String): String =
      if (value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r')) {
        "\"${value.replace("\"", "\"\"")}\""
      } else {
        value
      }

  private fun queryYears(database: SQLiteDatabase): List<String> {
    val years = mutableListOf<String>()
    database.rawQuery(
        "SELECT DISTINCT substr(COALESCE(civil_date, date), 1, 4) AS year FROM transactions " +
            "WHERE date GLOB '[0-9][0-9][0-9][0-9]-*' ORDER BY year;",
        null,
    ).use { cursor ->
      while (cursor.moveToNext()) years.add(cursor.getString(0))
    }
    return years
  }

  private data class CsvExport(val fileName: String, val query: String)


    private val EXPORTS =
        listOf(
            CsvExport("cuentas.csv", "SELECT * FROM accounts ORDER BY name;"),
            CsvExport("categorias.csv", "SELECT * FROM categories ORDER BY name;"),
            CsvExport("subcategorias.csv", "SELECT * FROM subcategories ORDER BY name;"),
            CsvExport(
                "tarjetas-credito.csv",
                "SELECT a.*, p.monthly_interest_rate FROM accounts a " +
                    "LEFT JOIN credit_card_profiles p ON p.account_id = a.id " +
                    "WHERE a.type = 'creditCard' ORDER BY a.name;",
            ),
            CsvExport("compras-cuotas.csv", "SELECT * FROM installment_purchases ORDER BY created_at;"),
            CsvExport("personas.csv", "SELECT * FROM shared_contacts ORDER BY name;"),
            CsvExport("gastos-compartidos.csv", "SELECT * FROM shared_expenses ORDER BY date;"),
            CsvExport("participaciones.csv", "SELECT * FROM transaction_splits WHERE shared_expense_id IS NOT NULL ORDER BY created_at;"),
            CsvExport("reembolsos.csv", "SELECT * FROM shared_receipts ORDER BY date;"),
            CsvExport("abonos-compartidos.csv", "SELECT * FROM shared_allocations ORDER BY created_at;"),
            CsvExport("devoluciones-anticipos.csv", "SELECT * FROM shared_returns ORDER BY date;"),
        )

    private const val YEARLY_ORDER = "ORDER BY COALESCE(t.civil_date, substr(t.date,1,10)), t.local_time, t.created_at;"

    private const val YEARLY_SELECT =
        "SELECT t.id, COALESCE(t.civil_date, substr(t.date,1,10)) AS fecha, " +
            "t.local_time AS hora, t.time_zone AS zona_horaria, t.date_precision AS precision_fecha, " +
            "t.date AS fecha_original, t.description AS descripcion, " +
            "t.amount AS monto, t.currency AS moneda, t.type AS tipo, " +
            "t.direction AS direccion, t.status AS estado, " +
            "a.name AS cuenta, ta.name AS cuenta_destino, " +
            "c.name AS categoria, s.name AS subcategoria, " +
            "t.merchant_name AS comercio, t.payment_method AS medio_pago, " +
            "t.credit_card_hint AS tarjeta, t.notes AS notas, " +
            "t.created_at AS creado_en, t.updated_at AS actualizado_en " +
            "FROM transactions t " +
            "LEFT JOIN accounts a ON a.id = t.account_id " +
            "LEFT JOIN accounts ta ON ta.id = t.target_account_id " +
            "LEFT JOIN categories c ON c.id = t.category_id " +
            "LEFT JOIN subcategories s ON s.id = t.subcategory_id "

    private const val YEARLY_TRANSACTIONS_QUERY =
        YEARLY_SELECT +
            "WHERE COALESCE(t.civil_date, substr(t.date,1,10)) >= ?1 " +
            "AND COALESCE(t.civil_date, substr(t.date,1,10)) < ?2 " +
            "AND substr(COALESCE(t.civil_date, t.date), 1, 4) = ?1 " + YEARLY_ORDER

    // Android binds only non-null strings: year 9999 has no upper bound.
    private const val YEARLY_TRANSACTIONS_LAST_QUERY =
        YEARLY_SELECT +
            "WHERE COALESCE(t.civil_date, substr(t.date,1,10)) >= ?1 " +
            "AND substr(COALESCE(t.civil_date, t.date), 1, 4) = ?1 " + YEARLY_ORDER
}
