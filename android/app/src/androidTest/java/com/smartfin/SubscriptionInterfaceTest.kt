package com.smartfin

import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Device-only test data are identified by __subscription_ui; no user rows are removed. */
@RunWith(AndroidJUnit4::class)
class SubscriptionInterfaceTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context = instrumentation.targetContext
  private val automation get() = instrumentation.uiAutomation
  private fun find(label: String, editableOnly: Boolean = false, clickableOnly: Boolean = false): AccessibilityNodeInfo? {
    fun visit(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
      if (node == null) return null
      if (node.isVisibleToUser && (!editableOnly || node.isEditable) && (!clickableOnly || node.isClickable) && (node.contentDescription?.toString() == label || node.text?.toString() == label)) return node
      for (i in 0 until node.childCount) visit(node.getChild(i))?.let { return it }
      return null
    }
    return visit(automation.rootInActiveWindow)
  }
  private fun waitFor(label: String, timeout: Long = 15000, editableOnly: Boolean = false, clickableOnly: Boolean = false): AccessibilityNodeInfo {
    val deadline = System.currentTimeMillis() + timeout
    while (System.currentTimeMillis() < deadline) {
      find(label,editableOnly,clickableOnly)?.let { return it }
      Thread.sleep(150)
    }
    error("Element not visible: $label")
  }
  private fun click(label: String) {
    var node: AccessibilityNodeInfo? = find(label,clickableOnly=true) ?: waitFor(label)
    while (node != null && !node.isClickable) node = node.parent
    check(node?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true) { "Cannot click $label" }
    Thread.sleep(350)
  }
  private fun enter(label: String, value: String) {
    val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,value) }
    check(waitFor(label,editableOnly=true).performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args)) { "Cannot edit $label" }
    Thread.sleep(200)
  }
  private fun scrollTo(label: String) {
    Thread.sleep(300)
    for (direction in listOf(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD, AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)) {
      for (i in 0 until 15) {
        if (find(label,clickableOnly=true) != null) return
        fun scroll(node: AccessibilityNodeInfo?): Boolean {
          if (node == null) return false
          if (node.isScrollable && node.performAction(direction)) return true
          for (child in 0 until node.childCount) if (scroll(node.getChild(child))) return true
          return false
        }
        if (!scroll(automation.rootInActiveWindow)) break
        Thread.sleep(350)
      }
    }
    waitFor(label)
  }
  private fun shell(command: String) { automation.executeShellCommand(command).use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() } }
  private fun screenshot(name: String) {
    val directory = File(context.filesDir,"subscription-ui-validation").apply { mkdirs() }
    automation.takeScreenshot()?.let { bitmap -> File(directory,"$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) };bitmap.recycle() }
  }
  private fun database() = SQLiteDatabase.openDatabase(context.getDatabasePath("smartfin.db").absolutePath,null,SQLiteDatabase.OPEN_READWRITE)
  private fun openSubscriptionList() {
    waitFor("Más",60000);click("Más");click("Suscripciones");waitFor("COMPROMISO MENSUAL")
    Thread.sleep(700)
  }
  private fun textValue(db: SQLiteDatabase, sql: String): String = db.rawQuery(sql,null).use { cursor -> check(cursor.moveToFirst());cursor.getString(0) }

  @Test fun deniedPermissionKeepsUiOperational() {
    org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("permissionDenied") == "true")
    context.startActivity(Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    waitFor("Más",60000);click("Más");click("Suscripciones");waitFor("COMPROMISO MENSUAL")
    click("Estado de recordatorios")
    waitFor("Notificaciones bloqueadas. La intención de programación se conserva.")
    Thread.sleep(500)
    screenshot("permission-denied")
    assertTrue(find("Solicitar permiso de notificaciones") != null)
    click("Cerrar")
  }

  @Test fun netflixFlowPreservesMoneyAndSupportsThemesWidthsAndPermissions() {
    shell("pm grant com.smartfin android.permission.POST_NOTIFICATIONS")
    context.startActivity(Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    waitFor("Más",60000)
    click("Más");click("Ajustes");scrollTo("Oscuro");click("Oscuro")
    val today=SimpleDateFormat("yyyy-MM-dd",Locale.US).format(Date())
    database().use { db ->
      db.execSQL("INSERT OR IGNORE INTO accounts (id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('__subscription_ui_bank','Bancolombia · prueba','bankAccount','active','COP',2500000,?,?)",arrayOf(today,today))
      db.execSQL("INSERT OR IGNORE INTO transactions (id,amount,currency,description,date,account_id,type,direction,status,created_at,updated_at,merchant_name) VALUES ('__subscription_ui_payment',47200,'COP','NETFLIX FACTURA PRUEBA',?,'__subscription_ui_bank','expense','outflow','posted',?,?,'Netflix')",arrayOf(today+"T12:00:00Z",today,today))
    }
    try {
      click("Más");click("Suscripciones");waitFor("COMPROMISO MENSUAL");scrollTo("Añadir suscripción");screenshot("list-empty-dark")
      click("Añadir suscripción");waitFor("Nombre");screenshot("form-start-dark")
      val nameBounds=android.graphics.Rect()
      waitFor("Nombre",editableOnly=true).getBoundsInScreen(nameBounds)
      shell("settings put secure show_ime_with_hard_keyboard 1")
      shell("input tap ${nameBounds.centerX()} ${nameBounds.centerY()}")
      Thread.sleep(1000);screenshot("form-keyboard");shell("input keyevent 111");Thread.sleep(400)
      enter("Nombre","Netflix Estándar · prueba");enter("Comercio (opcional)","Netflix");enter("Importe en COP","44.900")
      scrollTo("Cuenta (opcional)");click("Cuenta (opcional)");click("Bancolombia · prueba")
      scrollTo("Crear suscripción");screenshot("form-dark");click("Crear suscripción")
      waitFor("Ver Netflix Estándar · prueba");screenshot("list-dark-390")
      click("Ver Netflix Estándar · prueba");waitFor("Editar suscripción");screenshot("detail-dark")
      click("Volver");click("Próximos cobros");scrollTo("Vincular");click("Vincular");waitFor("Seleccionar NETFLIX FACTURA PRUEBA");screenshot("payment-dark")
      click("Seleccionar NETFLIX FACTURA PRUEBA");scrollTo("Vincular movimiento seleccionado");click("Vincular movimiento seleccionado")
      waitFor("No hay cobros próximos dentro de este periodo.");click("Volver");click("Ver Netflix Estándar · prueba");scrollTo("Ver movimiento: NETFLIX FACTURA PRUEBA")
      database().use { db ->
        assertEquals("2500000.0",textValue(db,"SELECT CAST(balance_amount AS TEXT) FROM accounts WHERE id='__subscription_ui_bank'"))
        assertEquals("1",textValue(db,"SELECT COUNT(*) FROM transactions WHERE id='__subscription_ui_payment'"))
        assertEquals("47200.0",textValue(db,"SELECT CAST(actual_amount AS TEXT) FROM subscription_occurrences WHERE transaction_id='__subscription_ui_payment'"))
        assertEquals("44900.0",textValue(db,"SELECT CAST(expected_amount AS TEXT) FROM subscription_occurrences WHERE transaction_id='__subscription_ui_payment'"))
      }
      click("Volver");waitFor("Añadir suscripción");click("Estado de recordatorios");click("Cerrar")
      val density=instrumentation.targetContext.resources.displayMetrics.density
      for (width in listOf(360,390,430)) {
        shell("wm size ${(width*density).toInt()}x${(844*density).toInt()}")
        Thread.sleep(900);openSubscriptionList();screenshot("list-dark-$width")
      }
      shell("settings put system font_scale 1.3");Thread.sleep(3500)
      for (width in listOf(360,390,430)) {
        shell("wm size ${(width*density).toInt()}x${(844*density).toInt()}")
        Thread.sleep(1500);openSubscriptionList();screenshot("list-large-text-$width")
      }
      screenshot("list-large-text")
      shell("settings put system font_scale 1.0");shell("wm size reset")
      Thread.sleep(3500);click("Más");click("Ajustes");scrollTo("Claro");click("Claro");openSubscriptionList();screenshot("list-light")
      click("Ver Netflix Estándar · prueba");click("Pausar");click("Confirmar pausa");waitFor("Reanudar");click("Reanudar");click("Confirmar reanudación");waitFor("Pausar");click("Cancelar");click("Cancelar compromiso definitivamente")
      database().use { db -> assertEquals("cancelled",textValue(db,"SELECT status FROM recurring_subscriptions WHERE name='Netflix Estándar · prueba'")) }
    } catch (error: Throwable) { screenshot("failure");throw error
    } finally {
      shell("wm size reset");shell("settings put system font_scale 1.0");shell("appops set com.smartfin POST_NOTIFICATION default")
      shell("settings put secure show_ime_with_hard_keyboard 0")
      database().use { db ->
        db.execSQL("DELETE FROM subscription_reminders WHERE occurrence_id IN (SELECT o.id FROM subscription_occurrences o JOIN recurring_subscriptions s ON s.id=o.subscription_id WHERE s.name='Netflix Estándar · prueba')")
        db.execSQL("DELETE FROM cash_flow_events WHERE source_entity_type='subscription_occurrence' AND source_entity_id IN (SELECT o.id FROM subscription_occurrences o JOIN recurring_subscriptions s ON s.id=o.subscription_id WHERE s.name='Netflix Estándar · prueba')")
        db.execSQL("DELETE FROM smart_alerts WHERE related_entity_id IN (SELECT id FROM recurring_subscriptions WHERE name='Netflix Estándar · prueba') OR related_entity_id IN (SELECT o.id FROM subscription_occurrences o JOIN recurring_subscriptions s ON s.id=o.subscription_id WHERE s.name='Netflix Estándar · prueba')")
        db.execSQL("DELETE FROM subscription_occurrences WHERE subscription_id IN (SELECT id FROM recurring_subscriptions WHERE name='Netflix Estándar · prueba')")
        db.execSQL("DELETE FROM recurring_subscriptions WHERE name='Netflix Estándar · prueba'")
        db.execSQL("DELETE FROM transactions WHERE id='__subscription_ui_payment'");db.execSQL("DELETE FROM accounts WHERE id='__subscription_ui_bank'")
      }
    }
  }

  @Test fun enhancementsCreateCategoriesExpenseAndOneDateAmount() {
    val name="Netflix mejoras · prueba"
    val today=SimpleDateFormat("yyyy-MM-dd",Locale.US).format(Date())
    context.startActivity(Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    waitFor("Más",60000)
    database().use { db -> db.execSQL("INSERT OR IGNORE INTO accounts (id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('__subscription_ui_bank','Bancolombia · prueba','bankAccount','active','COP',2500000,?,?)",arrayOf(today,today)) }
    try {
      openSubscriptionList();scrollTo("Añadir suscripción");click("Añadir suscripción")
      enter("Nombre",name);enter("Importe en COP","44900")
      scrollTo("Cuenta (opcional)");click("Cuenta (opcional)");click("Bancolombia · prueba")
      scrollTo("Categoría de gasto (opcional)");click("Categoría de gasto (opcional)");click("Crear categoría")
      enter("Nombre de la categoría o subcategoría","Streaming __subscription_ui");click("Guardar categoría o subcategoría")
      scrollTo("Subcategoría (opcional)");click("Subcategoría (opcional)");click("Crear subcategoría")
      enter("Nombre de la categoría o subcategoría","Video __subscription_ui");click("Guardar categoría o subcategoría")
      scrollTo("Crear suscripción");click("Crear suscripción");waitFor("Ver $name");click("Ver $name")
      scrollTo("Editar importe de este cobro");click("Editar importe de este cobro")
      enter("Importe esperado de este cobro","47200");Thread.sleep(500);screenshot("enhancements-month-amount");click("Guardar importe de este cobro")
      database().use { db ->
        assertEquals("44900.0",textValue(db,"SELECT CAST(amount AS TEXT) FROM recurring_subscriptions WHERE name='$name'"))
        assertEquals("1",textValue(db,"SELECT COUNT(*) FROM subscription_occurrences o JOIN recurring_subscriptions s ON s.id=o.subscription_id WHERE s.name='$name' AND expected_amount=47200"))
      }
      click("Volver");click("Próximos cobros");scrollTo("Vincular");click("Vincular");scrollTo("Registrar nuevo gasto");click("Registrar nuevo gasto")
      waitFor("Guardar Gasto",60000);Thread.sleep(500);screenshot("enhancements-new-expense");click("Guardar Gasto")
      waitFor("Vincular cobro esperado",60000);waitFor("Seleccionar $name")
      database().use { db ->
        assertEquals("1",textValue(db,"SELECT COUNT(*) FROM transactions WHERE merchant_name='$name'"))
        assertEquals("2455100.0",textValue(db,"SELECT CAST(balance_amount AS TEXT) FROM accounts WHERE id='__subscription_ui_bank'"))
        assertEquals("0",textValue(db,"SELECT COUNT(*) FROM subscription_occurrences o JOIN recurring_subscriptions s ON s.id=o.subscription_id WHERE s.name='$name' AND o.status='paid'"))
      }
      Thread.sleep(700)
      val candidateBounds=android.graphics.Rect()
      waitFor("Seleccionar $name").getBoundsInScreen(candidateBounds)
      shell("input tap ${candidateBounds.centerX()} ${candidateBounds.centerY()}")
      Thread.sleep(500)
      assertTrue("Payment must be explicitly selected",waitFor("Seleccionar $name").isChecked)
      scrollTo("Vincular movimiento seleccionado");click("Vincular movimiento seleccionado")
      waitFor("Editar suscripción")
      database().use { db -> assertEquals("1",textValue(db,"SELECT COUNT(*) FROM subscription_occurrences o JOIN recurring_subscriptions s ON s.id=o.subscription_id WHERE s.name='$name' AND o.status='paid'")) }
      screenshot("enhancements-detail")
    } catch(error: Throwable) { screenshot("enhancements-failure");throw error
    } finally {
      database().use { db ->
        val ids="SELECT o.id FROM subscription_occurrences o JOIN recurring_subscriptions s ON s.id=o.subscription_id WHERE s.name='$name'"
        db.execSQL("DELETE FROM subscription_reminders WHERE occurrence_id IN ($ids)")
        db.execSQL("DELETE FROM cash_flow_events WHERE source_entity_type='subscription_occurrence' AND source_entity_id IN ($ids)")
        db.execSQL("DELETE FROM smart_alerts WHERE related_entity_id IN ($ids) OR related_entity_id IN (SELECT id FROM recurring_subscriptions WHERE name='$name')")
        db.execSQL("DELETE FROM subscription_occurrences WHERE subscription_id IN (SELECT id FROM recurring_subscriptions WHERE name='$name')")
        db.execSQL("DELETE FROM recurring_subscriptions WHERE name='$name'")
        db.execSQL("DELETE FROM transactions WHERE merchant_name='$name'")
        db.execSQL("DELETE FROM subcategories WHERE name='Video __subscription_ui'")
        db.execSQL("DELETE FROM categories WHERE name='Streaming __subscription_ui'")
        db.execSQL("DELETE FROM accounts WHERE id='__subscription_ui_bank'")
      }
    }
  }

  @Test fun aiSubscriptionReviewCommitsWithoutCreatingExpense() {
    val name="Netflix IA __subscription_ui"
    val subscriptionId="ai-subscription:__subscription_ui_ai_draft:netflix"
    val today=SimpleDateFormat("yyyy-MM-dd",Locale.US).format(Date())
    context.startActivity(Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    waitFor("Hablar con IA",60000)
    val fields=org.json.JSONObject().apply {
      put("name",name);put("merchantName","Netflix");put("amount",44900)
      put("accountId","__subscription_ui_ai_bank");put("categoryId",org.json.JSONObject.NULL);put("subcategoryId",org.json.JSONObject.NULL)
      put("anchorDate",today);put("billingDay",today.substring(8).toInt());put("periodicity","monthly")
      put("remindersEnabled",true);put("reminderOffsets","3,1,0");put("reminderHour",9);put("reminderMinute",0)
    }
    val action=org.json.JSONObject().apply { put("id","netflix");put("entity","subscription");put("operation","create");put("fields",fields) }
    val plan=org.json.JSONObject().apply {
      put("version",1);put("summary","Crear suscripción de Netflix")
      put("answeredFields",org.json.JSONArray(listOf("netflix.categoryId","netflix.subcategoryId")))
      put("actions",org.json.JSONArray().put(action))
    }
    database().use { db ->
      db.execSQL("INSERT OR IGNORE INTO accounts (id,name,type,status,currency,balance_amount,created_at,updated_at) VALUES ('__subscription_ui_ai_bank','Banco IA prueba','bankAccount','active','COP',1000000,?,?)",arrayOf(today,today))
      db.execSQL("INSERT INTO ai_command_drafts (id,raw_input,plan_json,messages_json,clarification_history_json,phase,created_at,updated_at) VALUES ('__subscription_ui_ai_draft','Crea Netflix mensual por 44900',?,'[]','[]','review',?,?)",arrayOf(plan.toString(),today,today))
    }
    try {
      Thread.sleep(1200)
      val openBounds=android.graphics.Rect()
      waitFor("Hablar con IA").getBoundsInScreen(openBounds)
      shell("input tap ${openBounds.centerX()} ${openBounds.centerY()}")
      Thread.sleep(1000)
      if (find("Crear suscripción de Netflix") == null && find("Hablar con IA") != null) {
        find("Hablar con IA",clickableOnly=true)?.getBoundsInScreen(openBounds)
        shell("input tap ${openBounds.centerX()} ${openBounds.centerY()}")
      }
      waitFor("Crear suscripción de Netflix");scrollTo("Confirmar todo");screenshot("ai-subscription-review")
      database().use { db -> assertEquals("0",textValue(db,"SELECT COUNT(*) FROM recurring_subscriptions WHERE id='$subscriptionId'")) }
      val confirmBounds=android.graphics.Rect()
      waitFor("Confirmar todo").getBoundsInScreen(confirmBounds)
      shell("input tap ${confirmBounds.centerX()} ${confirmBounds.centerY()}")
      waitFor("Operaciones guardadas",30000);screenshot("ai-subscription-saved")
      database().use { db ->
        assertEquals("1",textValue(db,"SELECT COUNT(*) FROM recurring_subscriptions WHERE id='$subscriptionId' AND amount=44900 AND status='active'"))
        assertEquals("1000000.0",textValue(db,"SELECT CAST(balance_amount AS TEXT) FROM accounts WHERE id='__subscription_ui_ai_bank'"))
        assertEquals("0",textValue(db,"SELECT COUNT(*) FROM transactions WHERE account_id='__subscription_ui_ai_bank'"))
        assertTrue(textValue(db,"SELECT COUNT(*) FROM subscription_reminders WHERE occurrence_id IN (SELECT id FROM subscription_occurrences WHERE subscription_id='$subscriptionId')").toInt()>0)
      }
    } catch(error: Throwable) { screenshot("ai-subscription-failure");throw error
    } finally {
      database().use { db ->
        val ids="SELECT id FROM subscription_occurrences WHERE subscription_id='$subscriptionId'"
        db.execSQL("DELETE FROM subscription_reminders WHERE occurrence_id IN ($ids)")
        db.execSQL("DELETE FROM cash_flow_events WHERE source_entity_type='subscription_occurrence' AND source_entity_id IN ($ids)")
        db.execSQL("DELETE FROM smart_alerts WHERE related_entity_id IN ($ids) OR related_entity_id='$subscriptionId'")
        db.execSQL("DELETE FROM subscription_occurrences WHERE subscription_id='$subscriptionId'")
        db.execSQL("DELETE FROM recurring_subscriptions WHERE id='$subscriptionId'")
        db.execSQL("DELETE FROM ai_command_drafts WHERE id='__subscription_ui_ai_draft'")
        db.execSQL("DELETE FROM accounts WHERE id='__subscription_ui_ai_bank'")
      }
    }
  }

}
