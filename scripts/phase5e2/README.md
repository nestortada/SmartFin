# Campañas 5E.2 (historial y dashboard)

Solo el paquete sintético `com.smartfin.snapshot5b2.tests` y su base `phase5b2_synthetic.db`.
El runner hereda las comprobaciones de aislamiento de 5E.1 y nunca cambia ajustes del
dispositivo: envía WAKEUP cada 20 s y registra pantalla, batería, temperatura y PID.

1. `node scripts/phase5e2/prepare-android.cjs C:/sf-5e2-20261024` (copia la cadena 5D→5E→5E.1,
   restaura el adaptador del historial de producción sin instrumentar y añade los comparadores
   congelados `history5E1.ts` y `dashboardBaseline.ts`).
2. En `C:/sf-5e2-20261024/android`, JDK 17: `./gradlew.bat assembleRelease
   '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain`.
3. `./scripts/phase5e2/run-campaigns.ps1 -Serial emulator-5554 -Api 24` y, en otro proceso,
   `-Serial AXCC6R3919012932 -Api 35`. Nunca dos campañas en el mismo serial.
4. `./scripts/phase5e2/run-regressions.ps1` con el mismo serial/API.
5. `node scripts/phase5e2/summarize-android.cjs` y `node scripts/phase5e2/summarize-node.cjs`.

Node: `SMARTFIN_5E2_BENCHMARK=1 node --expose-gc node_modules/jest/bin/jest.js
__tests__/transactionHistoryPhase5E2Performance.test.ts`; diagnósticos con
`SMARTFIN_5E2_DIAGNOSTIC=1` y `SMARTFIN_5E2_DASHBOARD=1`.

`phase5e2-order-probe` compara variantes de ORDER BY con un orden calculado en JS. Las
campañas de historial comparan 5E.2 con un oráculo JS independiente del planificador y solo
registran si 5E.1 coincide (en SQLite 3.9.2 no coincide: defecto 5E2-001). El dashboard se
mide con el handle administrado real: envolverlo en un Proxy hace que el repositorio compartido
pida dos veces el permiso de mantenimiento (interbloqueo del harness, intento conservado en
`docs/rendimiento-fase5e2/android/attempt2-dashboard-deadlock`).
