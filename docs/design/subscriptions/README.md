# Suscripciones: referencias Stitch y revisión Android

Proyecto: SmartFin: Private AI Finance, `16999270237230511089`.
Referencias proporcionadas: `5813cf1188c0487ea47c70d865f86851`, `badf61f9bd8b44ec9a778b06d385115e`, `78db6e8977e34a828aa37d562fe53ff3`, `1e5c4e2ba5394fd0a69ec36c0102ab45`.

| Exportación en Descargas | Referencia local |
|---|---|
| `stitch_smartfin_private_ai_finance (1).zip` | [Listado](list.png), [HTML](list.html) |
| `stitch_smartfin_private_ai_finance (2).zip` | [Próximos cobros](upcoming.png), [HTML](upcoming.html) |
| `stitch_smartfin_private_ai_finance (3).zip` | [Detalle](detail.png), [HTML](detail.html) |
| `stitch_smartfin_private_ai_finance.zip` | [Vinculación](link-payment.png), [HTML](link-payment.html) |

[DESIGN.md](DESIGN.md) conserva el sistema visual exportado. El HTML es referencia de diseño y no forma parte del runtime: React Native usa componentes nativos y datos locales. Se corrigieron título, cálculos, fechas y “Débito automático”; el producto utiliza “Cobro esperado”. Las diferencias muestran evidencia esperado/real sin especular sobre su causa.

Manrope se incluye localmente en Regular, SemiBold, Bold y ExtraBold. La fuente variable original proviene del repositorio oficial `google/fonts/ofl/manrope` y se conserva como fuente de los archivos estáticos. [Licencia SIL OFL](../../../src/assets/fonts/OFL-Manrope.txt). Los iconos proceden de MaterialIcons ya instalado. No se descargan fuentes ni iconos durante el uso.

## Capturas de validación

Capturas tomadas en Pixel 10 Pro XL, API 37. Los nombres “prueba” identifican datos de instrumentación eliminados al finalizar; no son ejemplos incluidos en producción. El test crea Netflix, vincula un gasto existente, verifica saldo y único movimiento, pausa, reanuda y cancela. Los cambios de tamaño/fuente reinician la actividad: el test vuelve a abrir el módulo antes de capturar.

- [Listado oscuro 360](validation/list-dark-360.png), [390](validation/list-dark-390.png), [430](validation/list-dark-430.png).
- [Listado claro](validation/list-light.png) y texto ampliado 1,3: [360](validation/list-large-text-360.png), [390](validation/list-large-text-390.png), [430](validation/list-large-text-430.png).
- [Formulario inicial](validation/form-start-dark.png), [teclado](validation/form-keyboard.png), [programación y recordatorios](validation/form-dark.png).
- [Detalle](validation/detail-dark.png), [vinculación](validation/payment-dark.png), [permiso denegado](validation/permission-denied.png).

La comparación mantiene superficies oscuras, lavanda/verde, tarjetas redondeadas y jerarquía de importes. El contenido contractual adicional se desplaza verticalmente; los filtros se desplazan horizontalmente. No se replica la información ficticia de Stitch.

## Reproducir

Con Metro en 8081 y un emulador conectado:

```powershell
adb -s emulator-5554 reverse tcp:8081 tcp:8081
.\android\gradlew.bat -p android :app:assembleDebug :app:assembleDebugAndroidTest '-PreactNativeArchitectures=x86_64'
adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s emulator-5554 shell am instrument -w -e class 'com.smartfin.SubscriptionInterfaceTest#netflixFlowPreservesMoneyAndSupportsThemesWidthsAndPermissions' com.smartfin.test/androidx.test.runner.AndroidJUnitRunner
adb -s emulator-5554 shell pm revoke com.smartfin android.permission.POST_NOTIFICATIONS
adb -s emulator-5554 shell am instrument -w -e permissionDenied true -e class 'com.smartfin.SubscriptionReminderTest#deniedPermissionRetainsReminderAndDoesNotPublish,com.smartfin.SubscriptionInterfaceTest#deniedPermissionKeepsUiOperational' com.smartfin.test/androidx.test.runner.AndroidJUnitRunner
adb -s emulator-5554 shell pm grant com.smartfin android.permission.POST_NOTIFICATIONS
adb -s emulator-5554 shell am instrument -w -e class com.smartfin.SubscriptionReminderTest com.smartfin.test/androidx.test.runner.AndroidJUnitRunner
```

El test de permiso denegado se ejecuta aparte porque revocar un permiso mata el proceso Android. Las cinco pruebas nativas de recordatorios validan alarmas, revisión del receptor, privacidad, recuperación y worker Headless JS. Las pruebas Jest usan SQLite real y servicios de plataforma simulados.

Validación final: 20 suites / 130 pruebas Jest, TypeScript y ESLint aprobados; siete casos Android aprobados en ejecuciones separadas. APK debug compilado. El APK release quedó bloqueado por Device Guard al ejecutar Hermes (4551); iOS no se compiló en Windows.

APK de desarrollo generado para arm64-v8a y x86_64: `android/app/build/outputs/apk/debug/app-debug.apk` (requiere Metro).

Actualización del 3 de octubre de 2026: `assembleRelease` completado correctamente con arm64-v8a y x86_64, sin cambiar Hermes ni políticas de Windows. El APK release está en `android/app/build/outputs/apk/release/app-release.apk` y funciona con su bundle incluido. No es depurable. Conserva la clave existente (actualmente `debug.keystore`) para actualizar la instalación personal sin cambiar de identidad; una clave distinta impediría reemplazarla conservando sus datos. Esto no constituye una configuración de firma para publicar en tiendas.

Se verificó la misma firma SHA-256 en el APK release y la aplicación del teléfono. Se copió `SmartFin-release-2026-10-03.apk` a Descargas del teléfono, sin instalarlo ni modificar su base de datos. El usuario puede abrirlo y elegir Actualizar, manteniendo la aplicación instalada. Se recomienda guardar previamente un respaldo fuera de la aplicación.

El APK release se instaló como actualización únicamente en el emulador. Con reversos ADB retirados y Wi-Fi/datos móviles desactivados, pasó `aiSubscriptionReviewCommitsWithoutCreatingExpense` (1 prueba): abrió sin Metro, confirmó el borrador local, persistió suscripción/recordatorios y mantuvo saldo y ausencia de movimientos. La interpretación de Gemini sigue requiriendo conexión; esta prueba verifica el guardado local del borrador.

## Validación de las mejoras de importes

Las pruebas posteriores cubren separadores y decimales, creación de categoría/subcategoría sin perder el borrador y edición de una sola fecha con contrato, otras ocurrencias, saldo e importe real intactos. El recorrido Android adicional crea categorías, modifica un mes, registra un gasto desde el panel de vinculación, comprueba un único movimiento y su impacto normal en el saldo, y exige confirmación explícita del vínculo.

Capturas: [importe por fecha](validation/enhancements-month-amount.png), [registro del gasto](validation/enhancements-new-expense.png), [detalle al regresar](validation/enhancements-detail.png).

Validación de estas mejoras: 21 suites / 139 pruebas Jest, TypeScript y ESLint aprobados. El caso Android `enhancementsCreateCategoriesExpenseAndOneDateAmount` pasó en el emulador con datos propios de prueba; no se instaló ni modificó la aplicación del teléfono físico.

## Creación desde el asistente

Hablar con IA admite crear suscripciones con parámetros completos, aclaraciones y revisión editable. El recorrido Android adicional usa un borrador local de prueba y valida que Confirmar todo cree suscripción y recordatorios sin movimientos ni cambios de saldo. Capturas: [revisión](validation/ai-subscription-review.png) y [guardado](validation/ai-subscription-saved.png). El caso `aiSubscriptionReviewCommitsWithoutCreatingExpense` pasó; Gemini y dictado real no se invocaron. Validación posterior: 22 suites / 153 pruebas Jest, TypeScript, ESLint y compilación debug.
