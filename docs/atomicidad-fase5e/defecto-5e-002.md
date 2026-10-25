# 5E-002 — excepción de contención de limpieza sin capturar en el receptor

**Bloqueo de aceptación. No se aplica corrección de producción.** HONOR CRT-NX3,
API 35, paquete/UID sintéticos `com.smartfin.snapshot5b2.tests` / 10292.

## Reproducción física observada

Tras el reinicio autorizado, `boot_id` cambió y el dispositivo se desbloqueó.
Dos capturas anteriores a abrir el harness no encontraron proceso ni alarmas del
paquete de pruebas. Al abrir `phase5d-reboot-verify`, el proceso 10278 terminó
por APP CRASH a las 17:18:14. El informe de aceptación no llegó a escribirse.
El intento queda excluido en `android/api35/reboot-verify/`; no se sustituye por
un resultado aprobado. `honor-reboot-exit-info.txt` y `honor-reboot-dropbox.txt`
conservan el cierre y la excepción, filtrados por paquete/timestamp propios.
Logcat devolvió buffers vacíos; no se inventa un log alternativo.

El stack real identifica:

```
java.lang.IllegalStateException: Cleanup already running
  SmartFinFinancialDeletion.recover(SmartFinFinancialDeletion.kt:135)
  SmartFinSubscriptionRecoveryReceiver.onReceive$lambda$1$lambda$0(...:89)
```

Se ejecutó el APK primario atestado en `reboot-stage/environment.json`, con
las mismas 319 fuentes originales de producción de las campañas anteriores.
Las transformaciones del receptor aíslan identidad y permiten PendingResult
nulo al invocarlo explícitamente; no añaden captura de esa excepción ni cambian
el mutex. El crash físico pasó por el executor real del receptor.

## Causa y límite de la evidencia

`recover()` ejecuta `check(cleanup.tryLock())` antes de su `try/finally`; rechaza
correctamente a un segundo propietario. El receptor crea un executor nuevo por
broadcast y llama `recover()` con `finally`, sin `catch`. Por eso la contención
normal puede llegar al manejador de excepciones no capturadas y terminar todo
el proceso. Worker sí convierte excepciones en retry; ese tratamiento no protege
al executor del receptor ni serializa dos broadcasts.

El stack físico no revela qué acción disparó el receptor ni quién tenía el primer
lock. No se afirma que fuera BOOT_COMPLETED ni se atribuye a un primer participante
concreto. La reproducción determinista separada mantiene ocupado el mutex real
y observa el segundo `recover()` y el receptor real, sin necesitar esa suposición.
No se demuestra corrupción financiera; sí pérdida del proceso de recuperación.

## Harness de diagnóstico

`scripts/phase5e/prepare-contention.cjs` prepara otra copia aislada, en
`C:/sf-5e-race-20261024`. Su módulo de pruebas obtiene por reflexión el mutex
existente y lo mantiene en otro hilo respecto de `recover()`. Después invoca
explícitamente el receptor real. Un manejador **solo del harness** recoge la
excepción no capturada esperada para poder guardar el informe sin matar este
proceso diagnóstico. No es una corrección ni prueba de entrega automática.
Las demás excepciones se delegan al manejador anterior y este se restaura.
Se comparan conteos, columnas y hashes de todas las tablas antes/después, además
de FK/integridad. Este APK y sus adaptaciones se atestan como otro grupo.
La ejecución `android/api35/recovery-contention/result.json` completó ambos
controles: `contendingRecover` y `receiverUncaught` contienen la excepción
esperada, y el inventario completo anterior/posterior coincide. El resultado
aprobado del harness significa reproducción confirmada del defecto.

## Recuperación posterior y propuesta mínima

Una segunda ejecución explícita, conservando el fixture y el APK primario,
`reboot-verify-final2`, pasa: `automaticAlarm=false`, recuperación WorkManager
89,75 ms, transacciones intactas y sin reproducción de comandos financieros.
Esto acredita únicamente esa recuperación explícita; no borra el crash anterior
ni acredita reparación automática tras reboot HONOR.

Propuesta: capturar `Exception` en el executor del receptor alrededor de la
recuperación, conservando `finish()`/`shutdown()` en `finally`, y permitir el
reintento de recuperación bajo la barrera/época existentes. La contención no
debe convertirse en éxito financiero ni terminar el proceso. Mantener el lock,
el orden de permisos, los estados durable/unknown y la prohibición de repetir
DELETE o comandos financieros. Validar recepción concurrente con Worker y JS,
fallo real de limpieza y nueva época antes de aceptar el parche. No requiere
migración, driver, nuevas dependencias ni cambiar la entrega incierta.
