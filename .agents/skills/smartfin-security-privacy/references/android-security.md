# Revisión Android por versión y variante

## Estado de referencia

`android/build.gradle`: minSdk 24, compileSdk/targetSdk 36. No confundas campañas históricas API 24/35 con cobertura de API 36.

`android/app/src/main/AndroidManifest.xml` declara INTERNET, RECORD_AUDIO, USE_BIOMETRIC, USE_FINGERPRINT, POST_NOTIFICATIONS y RECEIVE_BOOT_COMPLETED. `MainActivity` es exportada para MAIN/LAUNCHER; los receptores propios de recordatorios/recuperación son `exported=false`. No se encontraron filtros VIEW/BROWSABLE ni WebView propio en las fuentes revisadas. Eso no inventaría un deep link explotable ni cubre componentes aportados por librerías.

`allowBackup=false`; `usesCleartextTraffic` es un placeholder. No hay reglas explícitas `dataExtractionRules`/`fullBackupContent` en el manifest fuente inspeccionado. No concluyas su valor de release ni todos los efectos de backup sin revisar el manifest fusionado. `android/app/build.gradle` asigna a release la firma debug y desactiva minificación: la firma es un pendiente de distribución; minificar es defensa adicional y no protección de secretos.

## Procedimiento

1. Compara manifiesto fuente, overlays y manifiesto fusionado de la variante relevante, si ya existe como artefacto seguro. Inventaría Activities, Services, Receivers, Providers y permisos. No lances build o campaña Android por una auditoría documental; marca la verificación del APK como pendiente.
2. Justifica permiso por ruta: red Gemini; micrófono por solicitud al dictar; biometría al desbloquear; notificaciones en API 33+; boot para recuperación. SAF no requiere acceso general al almacenamiento. Revisa negativas/revocación sin impedir funciones locales ajenas. `queries` declara visibilidad de paquetes, no concede RECORD_AUDIO ni autoridad financiera.
3. Para cada componente exportado identifica llamadores, acciones, extras, URI y permiso exigido. Launcher exportada es esperable; exportación por sí sola no demuestra vulnerabilidad. Valida también PendingIntent explícito, identidad y `FLAG_IMMUTABLE`, receptor y referencias antes del efecto.
4. Si se introduce deep link, verifica esquema/host/ruta permitidos, URI malformadas, parámetros duplicados y decodificación, estado bloqueado, destinos y origen no confiable. Un enlace puede abrir una vista; no debe confirmar una operación, importación o borrado. No confíes en extras ni redirijas intents arbitrarios. App Links necesita validar la asociación del dominio cuando corresponda.
5. Sigue URI SAF y flags lectura/escritura/persistencia desde selector hasta uso; verifica pérdida de permiso, proveedor inesperado y acceso temporal. Conserva estas protecciones y revisa destinatarios/acceso y prevención de publicación accidental según la [preferencia de respaldos Drive sin cifrado propio](backups-and-recovery.md). No reduzcas una URI a una ruta local ni asumas que proveedor Drive prueba cifrado/entrega remota; cualquier persona con acceso suficiente al archivo podría leer sus datos.
6. Para backup SO distingue API 24–30 y 31+ (reglas de extracción), fabricante y destino cloud/D2D. Android documenta variaciones D2D aun con `allowBackup=false`. Exige evidencia por dispositivo/variante antes de prometer exclusión total. Evalúa incompatibilidad de preferencias cifradas con claves no migradas.
7. Revisa valor efectivo de cleartext por variante, configuraciones de confianza/certificados y depuración. La llamada Gemini usa HTTPS; eso no acredita pinning ni transporte final del proveedor SAF. No desactives TLS ni impongas pinning sin plan de rotación/disponibilidad.
8. Revisa firma y certificado de la APK de distribución cuando exista, `debuggable`, logs, source maps y secretos compilados. No abras keystores, imprimas contraseñas o cambies firma durante la auditoría.
9. Evalúa capturas, grabaciones, recientes, portapapeles y pantallas con datos/PIN. `MainActivity.kt` revisada no configura `FLAG_SECURE`; el gate vuelve a bloquear en `active`, lo cual no demuestra ocultamiento al pasar a segundo plano. Propón política proporcional y verifica con datos ficticios; no atribuyas protección absoluta a flags.
10. Si aparece WebView, comprueba orígenes/navegación permitidos, JavaScript/bridges, acceso a archivos/contenido y errores TLS; no declares aplicable esta superficie por usar React Native.

## Controles observados y límites

`SmartFinSubscriptionReminderReceiver.kt` usa notificación privada con versión pública genérica y PendingIntent explícito inmutable. `SmartFinSubscriptionRemindersModule.kt` configura canal privado. El usuario/SO puede variar la visualización: la revisión estática no certifica lockscreen.

`SmartFinSecurityModule.kt` permite biometría desde API 28; API 24 no tiene ese camino. Revisa inscripción/disponibilidad, cancelación/error, cambios del ciclo de vida, PIN y pérdida/invalidez de claves. El prompt no usa CryptoObject y la clave actual no exige autenticación por uso: no atribuyas vinculación criptográfica entre desbloqueo y archivo financiero.
