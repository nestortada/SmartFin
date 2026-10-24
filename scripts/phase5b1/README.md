# Validación aislada de fase 5B.1

No abre `smartfin.db` de `com.smartfin`. El paquete release/Hermes es
`com.smartfin.snapshot5b1.tests`, con UID propio y archivo
`phase5b1_synthetic.db` en su sandbox. El preparador requiere un directorio nuevo
fuera del repositorio en su primera ejecución. Reutiliza dependencias instaladas.

```powershell
node scripts/phase5b1/prepare-android.cjs C:/sf-snapshot5b1-20261018
# Desde el directorio android del harness:
.\gradlew.bat assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain
# Desde el repositorio, por cada dispositivo:
./scripts/phase5b1/run-android.ps1 -Serial emulator-5554 -Campaign core -Output docs/atomicidad-fase5b1/android/api24/core
./scripts/phase5b1/run-android.ps1 -Serial emulator-5554 -Campaign restart-verify -Output docs/atomicidad-fase5b1/android/api24/restart-verify
```

Después pueden ejecutarse `close-lost`, `open-lost`, `host-destroyed` y
`host-real`, cada uno con su propio directorio de salida. Repetir con el HONOR
API 35. `core` **limpia solamente los datos del paquete sintético** antes de
crear el fixture. `restart-verify` necesita el archivo dejado por `core`.
Todas las campañas fuerzan el cierre solo del paquete de pruebas al terminar.

El runner verifica fuentes originales/preparadas, la copia intacta del driver,
el manifiesto del APK y la atestación de fuentes embebida en assets. Comprueba
UID distinto del producto, ruta SQLite sintética, hash APK y metadatos de
`com.smartfin` antes/después. No lee archivos financieros reales del producto.

Adaptaciones declaradas en `prepare-android.cjs`:

- Nombre de archivo sintético en la constante TS y las fábricas Kotlin copiadas.
- Paquete, composición de prueba y registro del Headless de producción.
- Trazas de permisos/conexiones y pausas/fallos deterministas en copias Kotlin.
- Pérdida simulada de respuestas de COMMIT/cierre/apertura tras la acción real del
  driver; no se cambia el driver. Apertura/cierre sin recibo usan su timeout real.
- Excepción previa al checkpoint y observación de sus filas, solo en TS copiado.
- Un escritor WAL deliberadamente ajeno a la barrera, solo en el controlador de
  prueba, verifica el rechazo de un checkpoint incompleto con dos conexiones.

Las fuentes Kotlin de recordatorios, receptor y Worker se ejecutan realmente;
AlarmManager, NotificationManager y WorkManager no son dobles. Las excepciones de
copia son inyecciones, no una reproducción de disco lleno o corte eléctrico.
`host-destroyed` prueba revocación determinista; `host-real` destruye ReactHost y
termina su verificación/reporte desde un hilo nativo que sobrevive a JavaScript.

```powershell
npm test -- --runInBand __tests__/localSnapshotCoordination.test.ts
node scripts/phase5b1/quality.cjs
```

El control de calidad preserva los informes históricos regenerados por Jest.
Las pruebas Node usan archivos temporales sintéticos y conexiones SQLite reales;
su módulo nativo es un sustituto explícito y no acredita Kotlin/Android.
