package com.smartfin

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter

class SmartFinSmsIngestionModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), PermissionListener {
  private var permissionPromise: Promise? = null
  private val preferences =
      reactContext.getSharedPreferences("smartfin_sms", Context.MODE_PRIVATE)

  override fun getName(): String = "SmartFinSmsIngestion"

  override fun onRequestPermissionsResult(
      requestCode: Int,
      permissions: Array<String>,
      grantResults: IntArray,
  ): Boolean {
    if (requestCode != SMS_PERMISSION_REQUEST_CODE) {
      return false
    }

    val isGranted =
        grantResults.isNotEmpty() &&
            grantResults.all { it == PackageManager.PERMISSION_GRANTED }
    permissionPromise?.resolve(if (isGranted) "granted" else "denied")
    permissionPromise = null
    return true
  }

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action == "com.smartfin.INCOMING_SMS") {
        val body = intent.getStringExtra("body")
        val receivedAt = intent.getStringExtra("receivedAt")
        val sender = intent.getStringExtra("sender")

        val map = Arguments.createMap().apply {
          putString("body", body)
          putString("receivedAt", receivedAt)
          putString("sender", sender)
        }

        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("SmartFinIncomingSms", map)
      }
    }
  }

  override fun initialize() {
    super.initialize()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactContext.registerReceiver(
          receiver,
          IntentFilter("com.smartfin.INCOMING_SMS"),
          Context.RECEIVER_NOT_EXPORTED
      )
    } else {
      reactContext.registerReceiver(
          receiver,
          IntentFilter("com.smartfin.INCOMING_SMS")
      )
    }
  }

  override fun onCatalystInstanceDestroy() {
    super.onCatalystInstanceDestroy()
    try {
      reactContext.unregisterReceiver(receiver)
    } catch (e: Exception) {
      // Ignored
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required by NativeEventEmitter.
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required by NativeEventEmitter.
  }

  @ReactMethod
  fun getSmsPermissionState(promise: Promise) {
    promise.resolve(getPermissionState())
  }

  @ReactMethod
  fun requestSmsPermission(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      promise.resolve("granted")
      return
    }

    val activity = reactContext.currentActivity
    if (activity !is PermissionAwareActivity) {
      promise.resolve("unavailable")
      return
    }

    val permissions =
        arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS)
    val alreadyGranted =
        permissions.all {
          reactContext.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED
        }

    if (alreadyGranted) {
      promise.resolve("granted")
      return
    }

    permissionPromise = promise
    activity.requestPermissions(permissions, SMS_PERMISSION_REQUEST_CODE, this)
  }

  @ReactMethod
  fun setSmsReadingEnabled(enabled: Boolean, promise: Promise) {
    preferences.edit().putBoolean("sms_reading_enabled", enabled).apply()
    promise.resolve(null)
  }

  private fun getPermissionState(): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      return "granted"
    }

    val permissions =
        arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS)
    val alreadyGranted =
        permissions.all {
          reactContext.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED
        }

    return if (alreadyGranted) "granted" else "available"
  }

  companion object {
    private const val SMS_PERMISSION_REQUEST_CODE = 7211
  }
}
