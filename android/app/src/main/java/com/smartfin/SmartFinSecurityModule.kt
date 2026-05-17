package com.smartfin

import android.app.KeyguardManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SmartFinSecurityModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  private val preferences =
      reactContext.getSharedPreferences("smartfin_security", Context.MODE_PRIVATE)

  override fun getName(): String = "SmartFinSecurity"

  @ReactMethod
  fun isBiometricsAvailable(promise: Promise) {
    promise.resolve(hasBiometricOrSecureAccess())
  }

  @ReactMethod
  fun enableBiometrics(promise: Promise) {
    if (!hasBiometricOrSecureAccess()) {
      promise.reject("BIOMETRICS_UNAVAILABLE", "La biometría no está disponible en este dispositivo.")
      return
    }

    preferences.edit().putBoolean("biometrics_enabled", true).apply()
    promise.resolve(null)
  }

  @ReactMethod
  fun setLocalCredential(secret: String, promise: Promise) {
    try {
      val salt = ByteArray(16)
      SecureRandom().nextBytes(salt)
      val hash = hashSecret(secret, salt)
      val payload = "${encode(salt)}:${encode(hash)}"
      val encrypted = encrypt(payload)
      preferences.edit().putString("credential_hash", encrypted).apply()
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("SECURE_STORAGE_ERROR", "No se pudo guardar la credencial local.", error)
    }
  }

  @ReactMethod
  fun verifyLocalCredential(secret: String, promise: Promise) {
    try {
      val encrypted = preferences.getString("credential_hash", null)
      if (encrypted == null) {
        promise.resolve(false)
        return
      }

      val decrypted = decrypt(encrypted)
      val parts = decrypted.split(":")
      if (parts.size != 2) {
        promise.resolve(false)
        return
      }

      val salt = decode(parts[0])
      val expectedHash = decode(parts[1])
      val actualHash = hashSecret(secret, salt)
      promise.resolve(MessageDigest.isEqual(expectedHash, actualHash))
    } catch (error: Exception) {
      promise.reject("SECURE_STORAGE_ERROR", "No se pudo verificar la credencial local.", error)
    }
  }

  private fun hasBiometricOrSecureAccess(): Boolean {
    val keyguardManager =
        reactContext.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    val packageManager = reactContext.packageManager
    val hasFingerprint =
        packageManager.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT)
    val hasFace =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            packageManager.hasSystemFeature(PackageManager.FEATURE_FACE)

    return keyguardManager.isDeviceSecure && (hasFingerprint || hasFace)
  }

  private fun hashSecret(secret: String, salt: ByteArray): ByteArray {
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update(salt)
    digest.update(secret.toByteArray(Charsets.UTF_8))
    return digest.digest()
  }

  private fun encrypt(value: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
    val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    return "${encode(cipher.iv)}:${encode(encrypted)}"
  }

  private fun decrypt(value: String): String {
    val parts = value.split(":")
    if (parts.size != 2) {
      throw IllegalArgumentException("Credencial cifrada inválida.")
    }

    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(
        Cipher.DECRYPT_MODE,
        getOrCreateSecretKey(),
        GCMParameterSpec(128, decode(parts[0])),
    )
    return String(cipher.doFinal(decode(parts[1])), Charsets.UTF_8)
  }

  private fun getOrCreateSecretKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore")
    keyStore.load(null)

    keyStore.getKey(KEY_ALIAS, null)?.let { existingKey ->
      return existingKey as SecretKey
    }

    val keyGenerator =
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    val keySpec =
        KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build()
    keyGenerator.init(keySpec)
    return keyGenerator.generateKey()
  }

  private fun encode(value: ByteArray): String =
      Base64.encodeToString(value, Base64.NO_WRAP)

  private fun decode(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)

  companion object {
    private const val KEY_ALIAS = "smartfin_local_security_key"
  }
}
