# Reproducir el cierre de aceptación 5B.2

Desde la raíz del repositorio, con dependencias instaladas y Android SDK/Java/ADB
disponibles. Usar exclusivamente el paquete y proveedor sintéticos; nunca cambiar
su applicationId por el de SmartFin ni sustituir su base por una base personal.
La preparación crea una copia externa y no cambia la bandera de la app.

```powershell
node scripts/phase5b2Acceptance/source-audit.cjs
node scripts/phase5b2Acceptance/ui-audit.cjs
node scripts/phase5b2Acceptance/prepare.cjs C:/sf-accept5b2-20261023
```

En `C:/sf-accept5b2-20261023/android`, compilar:

```powershell
.\gradlew.bat assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain
```

Volver a la raíz. Revisar primero `adb devices -l` y usar los seriales de los dos
dispositivos de prueba. Cada comando completa 21 campañas: sembrado, cinco procesos
fríos y una campaña con calentamiento más cinco capturas calientes, por volumen.
`KeepAwake` restaura el valor original al terminar; mantener el teléfono desbloqueado.
La primera instalación/reinstalación afecta únicamente al paquete de pruebas.

```powershell
./scripts/phase5b2Acceptance/run-all.ps1 -Serial emulator-5554 -Api 24
./scripts/phase5b2Acceptance/run-all.ps1 -Serial AXCC6R3919012932 -Api 35 -KeepAwake
node scripts/phase5b2Acceptance/quality.cjs
node scripts/phase5b2Acceptance/summarize.cjs
```

El resumen falla si faltan muestras, cambia una fuente atestada, no se restaura
la configuración temporal o falla calidad. `--partial` sirve sólo para diagnóstico:
no acredita finalización. Se necesitan 60 muestras medidas y seis calentamientos.
Los runners detienen el paquete sintético al terminar cada campaña. Apagar después
únicamente el emulador creado para esta sesión; no cerrar aplicaciones del usuario.

Las evidencias quedan en `docs/aceptacion-fase5b2/`. Antes de repetir una campaña,
conservar sus resultados anteriores en otra carpeta. El informe diferencia proceso
frío de disco frío, apertura inicial de reapertura y SAF de sincronización remota.
El diagnóstico de UI ejecuta el callback extraído, sin montar React ni acreditar
un recorrido de UI en dispositivo. No se usa Google Drive real.
