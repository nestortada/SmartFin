package com.smartfin

import android.app.Notification
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.text.Normalizer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class SmartFinNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val preferences = getSharedPreferences("smartfin_sms", Context.MODE_PRIVATE)
    if (!preferences.getBoolean("sms_reading_enabled", false)) {
      return
    }

    val packageName = sbn.packageName ?: return
    val appLabel = getAppLabel(packageName)
    if (!isAllowedBankSource(packageName, appLabel)) {
      return
    }

    val extras = sbn.notification.extras ?: Bundle.EMPTY
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim()
    val body = getNotificationBody(extras)

    if (title.isNullOrBlank() && body.isBlank()) {
      return
    }

    val combinedText = listOfNotNull(title, body).joinToString(" ")
    if (!looksLikeFinancialPurchase(combinedText)) {
      return
    }

    val localIntent = Intent(SmartFinSmsIngestionModule.INCOMING_FINANCIAL_MESSAGE_ACTION)
    localIntent.setPackage(applicationContext.packageName)
    localIntent.putExtra("body", body)
    localIntent.putExtra("packageName", packageName)
    localIntent.putExtra("receivedAt", toIsoString(Date(sbn.postTime)))
    localIntent.putExtra("sender", appLabel)
    localIntent.putExtra("sourceApp", appLabel)
    localIntent.putExtra("sourceType", "notification")
    localIntent.putExtra("title", title)
    sendBroadcast(localIntent)
  }

  private fun getNotificationBody(extras: Bundle): String {
    val parts = mutableListOf<String>()
    val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
    val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
    val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()
    val textLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)

    listOf(text, bigText, subText)
        .filterNot { it.isNullOrBlank() }
        .forEach { parts.add(it!!.trim()) }

    textLines
        ?.mapNotNull { it?.toString()?.trim() }
        ?.filter { it.isNotBlank() }
        ?.forEach { parts.add(it) }

    return parts.distinct().joinToString("\n")
  }

  private fun getAppLabel(packageName: String): String {
    return try {
      val applicationInfo = packageManager.getApplicationInfo(packageName, 0)
      packageManager.getApplicationLabel(applicationInfo).toString()
    } catch (_: Exception) {
      packageName
    }
  }

  private fun isAllowedBankSource(packageName: String, appLabel: String): Boolean {
    if (ALLOWED_BANK_PACKAGES.contains(packageName.lowercase(Locale.US))) {
      return true
    }

    val normalizedLabel = normalize(appLabel)
    return normalizedLabel == "nu" ||
        normalizedLabel.contains("nubank") ||
        normalizedLabel.contains("nequi") ||
        normalizedLabel.contains("bancolombia") ||
        normalizedLabel.contains("davivienda") ||
        normalizedLabel.contains("daviplata")
  }

  private fun looksLikeFinancialPurchase(text: String): Boolean {
    val normalized = normalize(text)
    val hasAmount = Regex("\\$?\\s*\\d{1,3}(?:\\.\\d{3})*(?:,\\d{1,2})?").containsMatchIn(text)
    val hasPurchaseWord =
        listOf(
            "compra",
            "compraste",
            "pagaste",
            "pago",
            "aprobada",
            "aprobado",
            "transaccion",
            "debito",
            "credito"
        ).any { normalized.contains(it) }

    return hasAmount && hasPurchaseWord
  }

  private fun normalize(value: String): String {
    val withoutAccents = Normalizer
        .normalize(value, Normalizer.Form.NFD)
        .replace(Regex("[\\u0300-\\u036f]"), "")
    return withoutAccents
        .lowercase(Locale.US)
        .replace(Regex("[^a-z0-9]+"), " ")
        .trim()
  }

  private fun toIsoString(date: Date): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter.format(date)
  }

  companion object {
    private val ALLOWED_BANK_PACKAGES = setOf(
        "com.nu.production"
    )
  }
}
