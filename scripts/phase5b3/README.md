# Fase 5B.3: instrumentos sintéticos

Todos los comandos se ejecutan desde la raíz. No sustituir el paquete
`com.smartfin.snapshot5b2.tests`, el proveedor de prueba ni la base
`phase5b2_synthetic.db` por los de la aplicación del usuario.

1. `node scripts/phase5b3/baseline.cjs` antes de modificar producción. Conserva
   reportes históricos que Jest regenera y registra hashes del estado inicial.
2. `node scripts/phase5b3/prepare.cjs C:/sf-5b3-20261023`; en su carpeta `android`,
   compilar `./gradlew.bat assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain`.
3. Ejecutar `run-all.ps1 -Serial <serial> -Api 24` y el equivalente API 35 con
   `-KeepAwake`. Son 42 campañas/60 muestras; restaurar el ajuste del teléfono.
   No ejecutar compilaciones ni Jest mientras se mide el emulador.
4. El diagnóstico CSV se ejecuta después de sembrar 100.000 con `run-android.ps1
   -Campaign acceptance-seed-100000 ...`, seguido de `-Campaign csv-diagnostic`.
   Usar siempre `-Output` propio. Genera cinco pares medidos y un calentamiento,
   alterna orden y compara todos los hashes. La versión final añade casos de escape
   en un clon de trabajo; nunca modifica el snapshot original.
5. `node scripts/phase5b3/prepare-ui.cjs C:/sf-5b3ui-20261023` prepara otra copia.
   Compilarla de la misma forma, con las compilaciones serializadas. El UI gate
   queda habilitado **solo allí**. Las pausas nativas y botones «Liberar ... de prueba»
   son observación funcional, no medidas de latencia.
6. `run-android.ps1 -Harness C:/sf-5b3ui-20261023 -Campaign ui-prepare ...` inicializa
   la base de UI. Relanzar únicamente el paquete sintético con URL
   `snapshot5b2://campaign/ui-slow`, `ui-publishslow`, `ui-fail`,
   `ui-recoverinspect`, `ui-recoverexternal`, `ui-revoked`, `ui-uncertain` o
   `ui-recover`. Reiniciar proceso entre escenarios; no limpiar datos entre un fallo
   y su recuperación. `ui.cjs <serial> <api> <nombre> [tap|double|scroll] [etiqueta]`
   conserva XML y PNG antes de actuar. Comprobar la imagen si Android comunica bounds
   recortados/invertidos de un menú animado; no usar coordenadas inferidas de esos bounds.
7. Repetir `core → restart-verify` y `publication → publication-restart-verify →
   publication-after-verify`, más close-lost/open-lost según el plan. El runner
   limpia solo fixtures iniciales del paquete sintético y atesta APK, fuentes y UID.
8. `node scripts/phase5b3/reader-example.cjs`, `diagnostics.cjs`, `source-audit.cjs`,
   `quality.cjs` y `summarize.cjs` producen evidencias bajo
   `docs/estabilizacion-fase5b3/`. No reinterpretar `--partial` como aprobación.

Conservar cada intento antes de repetirlo. Los scripts no activan la bandera real,
no modifican el analista externo y no implementan borrado. Al terminar, detener el
paquete de prueba, restaurar el ajuste temporal y apagar solo el emulador creado
para la sesión. No cerrar la aplicación real ni tocar su base o Drive.
