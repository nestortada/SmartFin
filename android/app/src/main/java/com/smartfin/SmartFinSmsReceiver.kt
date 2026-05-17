package com.smartfin

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.provider.Telephony
import java.security.MessageDigest
import java.text.Normalizer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class SmartFinSmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
      return
    }

    val preferences = context.getSharedPreferences("smartfin_sms", Context.MODE_PRIVATE)
    if (!preferences.getBoolean("sms_reading_enabled", false)) {
      return
    }

    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
    for (message in messages) {
      val body = message.messageBody ?: continue
      val sender = message.displayOriginatingAddress
      val receivedAt = toIsoString(Date(message.timestampMillis))
      saveSms(context, sender, body, receivedAt)

      val localIntent = Intent("com.smartfin.INCOMING_SMS")
      localIntent.setPackage(context.packageName)
      localIntent.putExtra("body", body)
      localIntent.putExtra("receivedAt", receivedAt)
      localIntent.putExtra("sender", sender)
      context.sendBroadcast(localIntent)
    }
  }

  private fun saveSms(
      context: Context,
      sender: String?,
      body: String,
      receivedAt: String,
  ) {
    val database = context.openOrCreateDatabase(DATABASE_NAME, Context.MODE_PRIVATE, null)
    try {
      ensureRawMessagesTable(database)
      val parsed = parseFinancialSms(body)
      val createdAt = toIsoString(Date())
      val messageId = "sms-${receivedAt}-${stableHash("${sender ?: ""}:$body")}"

      database.execSQL(
          """
          INSERT OR REPLACE INTO raw_financial_messages (
            id,
            source_type,
            source_app,
            sender,
            raw_text,
            received_at,
            parsed_status,
            parsed_amount,
            parsed_currency,
            parsed_merchant_name,
            parsed_account_hint,
            parser_name,
            error_message,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
          """.trimIndent(),
          arrayOf(
              messageId,
              "sms",
              "android-sms",
              sender,
              body,
              receivedAt,
              parsed.status,
              parsed.amount,
              parsed.currency,
              parsed.merchantName,
              null,
              parsed.parserName,
              parsed.errorMessage,
              createdAt,
              createdAt,
          ),
      )
    } finally {
      database.close()
    }
  }

  private fun ensureRawMessagesTable(database: SQLiteDatabase) {
    database.execSQL(
        """
        CREATE TABLE IF NOT EXISTS raw_financial_messages (
          id TEXT PRIMARY KEY NOT NULL,
          source_type TEXT NOT NULL,
          source_app TEXT,
          sender TEXT,
          raw_text TEXT NOT NULL,
          received_at TEXT NOT NULL,
          parsed_status TEXT NOT NULL,
          parsed_amount REAL,
          parsed_currency TEXT,
          parsed_merchant_name TEXT,
          parsed_account_hint TEXT,
          parser_name TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        """.trimIndent(),
    )
  }

  private fun parseFinancialSms(body: String): ParsedSms {
    val pattern =
        Regex(
            "^NEQUI:\\s*Pa[sg]{1,2}aste\\s+([\\d.]+(?:,\\d{1,2})?)\\s*en\\s+(.+)$",
            RegexOption.IGNORE_CASE,
        )
    val match = pattern.find(body.trim())

    if (match == null) {
      return ParsedSms(
          status = "unsupported",
          amount = null,
          currency = null,
          merchantName = null,
          parserName = "unsupported",
          errorMessage = "El SMS no coincide con un pago soportado.",
      )
    }

    val rawAmount = match.groupValues[1]
    val rawMerchantName = match.groupValues[2]
    val amount = rawAmount.replace(".", "").replace(",", ".").toDoubleOrNull()

    if (amount == null) {
      return ParsedSms(
          status = "unsupported",
          amount = null,
          currency = null,
          merchantName = null,
          parserName = "unsupported",
          errorMessage = "El monto del SMS no se pudo interpretar.",
      )
    }

    return ParsedSms(
        status = "parsed",
        amount = amount,
        currency = "COP",
        merchantName = normalizeMerchantName(rawMerchantName),
        parserName = "nequi-payment-v1",
        errorMessage = null,
    )
  }

  private fun normalizeMerchantName(value: String): String {
    val withoutExtraSpaces = value.replace(Regex("\\s+"), " ").trim()
    val normalized = Normalizer.normalize(withoutExtraSpaces, Normalizer.Form.NFC)
    return normalized.uppercase(Locale("es", "CO"))
  }

  private fun stableHash(value: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val hash = digest.digest(value.toByteArray(Charsets.UTF_8))
    return hash.take(10).joinToString("") { "%02x".format(it) }
  }

  private fun toIsoString(date: Date): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter.format(date)
  }

  companion object {
    private const val DATABASE_NAME = "smartfin.db"
  }
}

data class ParsedSms(
    val status: String,
    val amount: Double?,
    val currency: String?,
    val merchantName: String?,
    val parserName: String,
    val errorMessage: String?,
)
