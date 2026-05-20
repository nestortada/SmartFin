package com.smartfin

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import java.security.MessageDigest
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

      val localIntent = Intent(SmartFinSmsIngestionModule.INCOMING_FINANCIAL_MESSAGE_ACTION)
      localIntent.setPackage(context.packageName)
      localIntent.putExtra("body", body)
      localIntent.putExtra("receivedAt", receivedAt)
      localIntent.putExtra("sender", sender)
      localIntent.putExtra("sourceApp", "android-sms")
      localIntent.putExtra("sourceType", "sms")
      localIntent.putExtra("packageName", "android-sms")
      localIntent.putExtra("messageHash", stableHash("${sender ?: ""}:$body"))
      context.sendBroadcast(localIntent)
    }
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
}
