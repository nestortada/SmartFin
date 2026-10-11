# Fase 1.1: diagnóstico antes de modificar producción

Nota posterior: el usuario autorizó «Autorizar parche y completar validación». La propuesta de este informe histórico se aplicó y se validó en el [informe final de fase 1.1](../atomicidad-financiera-fase11.md). El texto siguiente conserva el diagnóstico presentado antes de esa autorización.

Los tres fallos se reprodujeron de nuevo en API 24 y API 35, con el APK anterior y sin cambios de producción. Los 11 casos principales siguen aprobando. También se reprodujo la espera usando directamente `react-native-sqlite-storage`, sin el runner ni el coordinador de SmartFin.

## Cadena comprobada

1. El driver traduce BEGIN a `SQLiteDatabase.beginTransaction()` en su `DBRunner`. Una sesión mantiene su conexión adquirida hasta `endTransaction()`.
2. El cierre anterior llama `SQLiteDatabase.close()` sin terminar esa sesión. Logcat API 24 informa que el pool cerró con **una conexión todavía en uso**.
3. La apertura nativa posterior falla con `SQLiteDatabaseLockedException`, al compilar **PRAGMA journal_mode**. El log del driver registra que se detuvo el hilo DBRunner. La primera sentencia de aplicación no llegó a ejecutarse.
4. La API Promise instalada resuelve `openDatabase` con el objeto devuelto por la fábrica, antes del callback nativo de apertura (`sqlite.js`, `returnValueExpected` y `resolve(retValue)`). Por ello, el harness interpretaba como reapertura confirmada una devolución provisional del objeto.
5. `executeSql` crea una transacción JS con callbacks por sentencia, pero sin callback de error de transacción. Si la apertura falla, `abortFromQ` notifica solo `this.error`; la promesa de la sentencia encolada queda sin respuesta. Eso explica los 30 segundos esperando `PRAGMA foreign_keys=ON`.

Las pilas nativas capturadas después del fallo están vacías porque el DBRunner fallido ya terminó. Logcat conserva la excepción y su pila en el momento de apertura. No se atribuye el bloqueo a un deadlock del coordinador JS: se reproduce sin usarlo.

En una prueba Android independiente, sin el driver RN, `inTransaction()` es true antes de cerrar y `isOpen()` es false después; la nueva apertura falla por bloqueo. En la variante que llama `endTransaction()` en el mismo hilo antes de cerrar, `inTransaction()` pasa a false, la reapertura responde y el saldo sintético inicial 1.000.000 persiste. El experimento no cambia producción ni constituye una aprobación de recuperación por caracterizar el bloqueo.

Fuentes Android 7.0/AOSP: [SQLiteConnectionPool](https://android.googlesource.com/platform/frameworks/base/+/android-7.0.0_r1/core/java/android/database/sqlite/SQLiteConnectionPool.java), [SQLiteSession](https://android.googlesource.com/platform/frameworks/base/+/android-7.0.0_r1/core/java/android/database/sqlite/SQLiteSession.java). Se conservan copias locales en `baseline/` para revisión. El pool cierra inmediatamente conexiones disponibles y difiere las adquiridas; `endTransaction` libera la conexión de la sesión.

## Propuesta que requiere autorización

Se necesita un parche permanente del driver; todavía **no se aplicó**. La autorización se pide por la condición explícita del apartado 3 del encargo.

- En la rama de cierre de **DBRunner**, terminar únicamente las transacciones de `this.mydb` activas en ese mismo hilo antes de cerrar y emitir éxito. No recorrer bases ni conexiones Kotlin ajenas. La cola JS ya revocó el ámbito y conserva el permiso exclusivo mientras cierra.
- `endTransaction()` conserva la decisión nativa ya establecida: una sesión no marcada se revierte; una marcada por un COMMIT previamente solicitado puede confirmarse. En ambos casos el resultado financiero incierto sigue siendo **unknown**. El cierre no se interpreta como confirmación o rollback del comando, y no se vuelve a ejecutar su cuerpo.
- Si la terminación/cierre falla, propagar el error y conservar la cuarentena; nunca emitir éxito de recuperación.
- Hacer el parche reproducible e idempotente en el `postinstall` existente, con comprobación estricta del fragmento instalado. No actualizar la versión ni introducir dependencias.
- En el adaptador de SmartFin, esperar el callback nativo de apertura antes de entregar el objeto; añadir verificaciones de FK, integridad y revisión financiera. Esto evita depender de la promesa provisional del driver, sin modificar firmas públicas.
- Retener los fallos de recuperación para bloquear reaperturas automáticas de esa generación. Un límite de espera debe devolver error y preservar cuarentena, nunca éxito ni un handle supuestamente recuperado.

Se conservarán los tres estados del runner, los snapshots de fase 0 y la prohibición de reintento financiero. El parche se validará con los 14 casos Android, fallos de recuperación, Jest, TypeScript y ESLint. La finalización nativa de una transacción ya marcada es un riesgo que se comprobará y documentará expresamente; no se promete rollback de un resultado desconocido.

Evidencia: `before-api24-*`, `before-api35-*`, `diagnostic-api24-core`, `diagnostic-api35-core`, `diagnostic-api24-native-probe`, `native-probe-api35`, `raw-driver-api24` y `diagnostic-api35-raw-driver`, en este directorio. Las ejecuciones de diagnóstico que no generaron reporte se consideran fallidas y no cuentan como evidencia aprobada.
