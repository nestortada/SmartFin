# Validación aislada de publicación 5B.2

Requiere las herramientas Android y dependencias ya instaladas. No instala nuevas
dependencias ni modifica `com.smartfin`. El proveedor sintético existe solo en el
APK `com.smartfin.snapshot5b2.tests`, con UID y base propios.

```powershell
node scripts/phase5b2/baseline.cjs
node scripts/phase5b2/prepare-android.cjs C:/sf-snapshot5b2-20261023
# Desde C:/sf-snapshot5b2-20261023/android:
.\gradlew.bat assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain
# Desde el repositorio, por cada dispositivo:
./scripts/phase5b2/run-android.ps1 -Serial emulator-5554 -Campaign publication -Output docs/atomicidad-fase5b2/android/api24/publication
```

La primera preparación exige un directorio nuevo fuera del producto; las siguientes
actualizan solo el harness. Cada APK lleva atestación de fuentes y driver. El runner
comprueba hashes, paquete, UID/rutas y metadatos del paquete real antes/después.
Especificar siempre un `-Output` distinto por campaña/dispositivo.

Orden de campañas:

1. `publication`, `publication-restart-verify`, `publication-after-verify`.
2. `core`, `restart-verify`, `close-lost`, `open-lost`, `host-destroyed`, `host-real`.
3. `publication-performance`: nueve muestras, tres por tamaño. Reinicia solo datos sintéticos.
4. Por cada sufijo `before`, `after`, `captured`: `publication-kill-<sufijo>` y
   `publication-kill-recover`. Guardar la recuperación como `publication-recover-<sufijo>`.

Las campañas de kill terminan realmente su proceso; escriben antes un recibo de
etapa de prueba sincronizado. La siguiente campaña comprueba recuperación con otro
PID. El corte `after` ocurre después de verificar el manifiesto externo, antes del
éxito durable local. `captured` comprueba adopción del recibo privado cuando el
trabajo todavía no tiene `snapshotId`. Se modifica el origen después de capturar
para detectar una reconstrucción indebida.

`publication` prueba cada CSV, destinos parciales/corruptos, permiso revocado,
lectura rechazada y un error de recibo inyectado tras el cierre real. El provider
usa una pipe fiable para la escritura parcial. No representa Google Drive real ni
certifica subida remota. Los hooks de captura/host son los de 5B.1; el preparador
identifica expresamente sus adaptaciones, sin cambiar el driver.

```powershell
node scripts/phase5b2/quality.cjs
node scripts/phase5b2/summarize.cjs
```

`run-all.ps1 -Serial <serial> -Api 24|35` ejecuta las 16 campañas en orden.
`-KeepAwake` conserva temporalmente la pantalla despierta por USB y restaura su
valor original en `finally`, registrándolo en `session.json`.

El resumen exige las 32 campañas, nueve muestras por API, calidad y coincidencia de
fuentes de producción con la verificación final. Admite APKs con distinta
instrumentación, conservando su atestación; no admite fuentes de producción
distintas. `--partial` solo informa pendientes y no los declara aprobados.
