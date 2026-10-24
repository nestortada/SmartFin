# Pruebas sintéticas de fase 5C

Ejecutar desde la raíz. Nunca sustituir el paquete
`com.smartfin.snapshot5b2.tests`, su UID/base o el proveedor por la app financiera.

1. `node scripts/phase5c/prepare-android.cjs C:/sf-5c-20261024` prepara una copia
   externa aislada. Reutiliza el preparador 5B.2, añade el objeto nativo de 5C y
   hooks de fallo exclusivamente en esa copia. No cambia driver ni UI gate.
2. En su carpeta `android` ejecutar `./gradlew.bat assembleRelease
   '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain`.
3. `./scripts/phase5c/run-android.ps1 -Serial <serial> -Campaign <campaña>
   -Output <directorio-nuevo>` valida APK, fuentes, UID y metadatos de producción,
   instala únicamente el paquete sintético y conserva resultado/logcat. Usa un
   mutex por dispositivo; no ejecutar campañas simultáneas en el mismo serial.
4. Por API ejecutar `phase5c-matrix`; después `phase5c-main → phase5c-restart →
   phase5c-new-identities`; `phase5c-cleanup-matrix`; `phase5c-lost-before →
   phase5c-unknown-restart`; `phase5c-lost-after → phase5c-restart`.
   No limpiar datos entre una respuesta perdida y su reinicio.
5. Regresiones: `core → restart-verify`; `publication →
   publication-restart-verify → publication-after-verify`; `close-lost`;
   `open-lost`. El runner limpia solo fixtures iniciales conocidos.
6. Compatibilidad de nueva época: `phase5c-main → phase5c-restart → publication`.
   En **ese último comando** incluir `-PreserveData`; así el publicador crea y
   verifica nuevas capturas sobre la época posterior al borrado, preservando
   documentos externos anteriores. Nunca usar pm clear entre esos tres pasos.
7. `npm test -- --runInBand`, `npx tsc --noEmit`, `npm run lint` y
   `git diff --check`. Jest regenera reportes históricos: conservar sus bytes
   antes de correr y guardar las muestras nuevas bajo el directorio de 5C.
8. `node scripts/phase5c/summarize.cjs` consolida los nombres de campaña de la
   entrega, verifica las fuentes y rechaza resultados fallidos o huellas distintas.
   `complete=false` no es aceptación.

Al terminar, detener únicamente el paquete sintético; restaurar el ajuste temporal
del HONOR y apagar solo el emulador creado para esta sesión. Los archivos de
prueba privados/SAF pertenecen al paquete sintético. No abrir la base personal,
Drive real ni modificar el analista externo.

El probe AlarmManager comprueba la existencia del PendingIntent y los efectos
nativos de cancelación. No certifica entrega futura exacta, sonido, reboot del SO,
TalkBack ni pérdida eléctrica. Los hooks de estado de jobs son fixtures explícitos;
los hooks de COMMIT simulan respuesta perdida antes/después de la acción nativa.
