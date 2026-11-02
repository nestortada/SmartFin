# Auditoría de QA de SmartFin — 2026-11-01

Auditoría del checkout de trabajo, incluidos cambios locales previos. No se auditó una revisión limpia equivalente al HEAD ni se certificó todo el producto. El objetivo fue fundamentar `smartfin-testing-qa` sin modificar producción, pruebas, esquema, hooks, permisos o configuración.

## Fuentes contrastadas

Se leyeron `AGENTS.md`, `CLAUDE.md`, secciones de `docs/ARQUITECTURA.md`, `docs/BASE_DE_DATOS.md`, `docs/PRUEBAS_Y_CALIDAD.md`, las skills canónicas de dominio/SQLite, `package.json`, configs Jest/TS/ESLint, setup de evidencias, helpers SQLite/snapshots/volumen y muestras de suites/harnesses/Kotlin. Se inspeccionaron registros/políticas de hooks en `.codex/` y `.claude/`, así como CI. Las rutas de este informe parten de la raíz del proyecto.

Entorno observado: Windows, Node 24.16.0, Python 3.14.6, Codex CLI 0.166.0 y Claude Code 2.1.316. `package.json`: React Native 0.85.3, React 19.2.3, Jest ^29.6.3, TypeScript ^5.8.3, `react-native-sqlite-storage` ^6.0.1 y `react-test-renderer` 19.2.3. No declara React Native Testing Library. TS extiende la configuración RN con `strict`, `noImplicitReturns`, `noUncheckedIndexedAccess` y otras comprobaciones; ESLint extiende `@react-native` con excepciones locales documentadas. No se instalaron dependencias.

## Descubrimiento efectivo

`npm test -- --listTests --runInBand` y `npm run test:reproductions -- --listTests --runInBand` se ejecutaron correctamente. El inventario completo está en [validation/inventory.json](validation/inventory.json).

| Configuración | Resultado observado | Interpretación |
|---|---|---|
| `jest.config.js` | 84 archivos TS/TSX descubiertos | No significa que todos sus casos se ejecuten; hay condiciones y skips |
| `jest.reproductions.config.js` | 7 archivos `.repro.ts/.repro.tsx` | Caracterización más `test.failing`; verde puede preservar el defecto |
| Archivos `.test.js` | 4 excluidos de ambas selecciones | Su existencia no acredita ejecución Jest |

Excluidos: `__tests__/integrationAudit.test.js`, `sharedCommandPerformance.test.js`, `sharedForgivenessPerformance.test.js` y `sharedPositionPerformance.test.js` bajo `__tests__/`. Activar una variable de benchmark no cambia `testMatch`. `--runTestsByPath` tampoco lo evita.

Las 7 reproducciones cubren validación de importes IA, progreso de cuotas, extractos, edición de cuenta débito, categorías de primera instalación, redondeo de cuotas y opciones de reconocimiento de voz. No se ejecutaron como campaña de aceptación en esta entrega.

## Mapa por capacidad y clase

Los ejemplos siguientes existen y se descubren salvo indicación; cada suite puede mezclar clases. No se revisaron exhaustivamente todas sus aserciones.

| Área | Fuentes/suites bajo `__tests__/` | Qué demuestran y límites |
|---|---|---|
| Unitarias/entradas/fechas | `copAmountInput.test.ts`, `creditCardFormatters.test.ts`, `transactionDates.test.ts`, `subscriptionRecurrence.test.ts` | Parseo, formato y fechas; algunas mezclan integración real |
| Integración de dominio | `saveManualTransaction.test.ts`, `creditCardTransactionRelations.test.ts`, `subscriptions.test.ts`, `sharedExpenses.test.ts`, `sharedForgiveness.test.ts` | Casos de uso y relaciones; examinar dobles/conexión antes de atribuir atomicidad |
| Financiera vigente | `financialIntegrity.test.ts`, `creditCardPaymentScreen.test.tsx`, `creditCardSettlementPhase6B3.test.tsx`, `sharedFinancialTotals.test.ts` | Métricas, pagos/ediciones, compartidos; `financialIntegrity` mezcla imports actuales y phase0 |
| Caracterización | `financialAtomicityPhase0.test.ts`, helpers `phase0ManualTransactions.ts`, `phase0CreditCardPayment.ts` | Estados parciales históricos con oráculo que rechaza rollback íntegro; no aceptación vigente |
| Atomicidad | `financialAtomicityInfrastructure.test.ts`, `financialAtomicityPhase2.test.ts`, `financialAtomicityPhase3A.test.ts`, `financialAtomicityPhase3B.test.ts`, `financialAtomicityPhase4.test.ts`, `subscriptionAtomicityPhase4.test.ts` | Inyección antes/después, FK, snapshots, límites compartidos; seleccionar por comando actual |
| Concurrencia/recuperación | `sharedSQLiteCoordination.test.ts`, `sqliteRecoveryLifecycle.test.ts`, `localSnapshotCoordination.test.ts`, `financialDeletionRecoveryPhase5E4.test.ts` | Barreras, permisos/generaciones, recuperación; Node no prueba el driver de dispositivo |
| Respaldos | `backupPublication.test.ts`, `backupRecoverabilityPhase5E5.test.ts`, `backupCsvPhase5E6.test.ts`, `backupCsvYearQueryPhase5E4.test.ts` | Publicación, corrupción de copias sintéticas y comparación de evidencia; revisar archivos/condiciones |
| UI/hook | `transactionsScreen.test.tsx`, `creditCardPaymentScreen.test.tsx`, `aiConfirmationPhase4.test.tsx`, `subscriptionInterface.test.tsx`, `useTransactionsPagination.test.tsx` | Renderer/mocks y algunos fixtures reales; no layout/teclado/TalkBack nativo |
| Diagnóstico | `dashboardPhase5E2Diagnostic.test.ts`, `dashboardPhase5E5PrecisionDiagnostic.test.ts`, `financialAuditPhase6B.test.ts`, `phase6b3Reproduction.test.ts`, `zzTieBreakProbe.test.ts` | Planes/precisión/sondas; el nombre o salida verde no garantizan umbrales de aceptación |
| Rendimiento | `dashboardPerformance.test.ts`, `transactionHistoryRefinementPerformance.test.ts`, `transactionHistoryPhase5E3FiftyYears.test.ts`, `creditCardAssociationScaling.test.ts` | Verificar variables, distribución, baseline y aserciones; no lanzar por una edición menor |

`realSQLite.ts` usa `node:sqlite` real en memoria por defecto y archivo sintético opcional, con trazas, fallos y barreras. `financialState.ts` compara todas las tablas/columnas, auditoría, revisión, métricas y PRAGMA. Los fallos antes/después de COMMIT tienen resultados diferentes; una promesa rechazada puede dejar datos confirmados.

## Escrituras y evidencia

La búsqueda heurística encontró **34 archivos de pruebas/helpers/setup** con APIs de escritura y **20 archivos de suite candidatos con variables/skip**; son candidatos de inspección, no un conteo exacto de suites que escriben o casos omitidos. Inventario en JSON. Ejemplos con salidas `docs/`:

- `creditCardReconciliationEquivalence.test.ts`: `docs/atomicidad-fase3a1/node-equivalence.json`.
- `subscriptionMaintenanceComparison.test.ts` y `subscriptionAtomicityPhase4.test.ts`: resultados bajo `docs/atomicidad-fase4/`.
- `financialCorrectionPhase6B1.test.ts`, `dashboardAggregatesPhase6B2.test.ts`, `creditCardSettlementPhase6B3.test.tsx`: resultados de fases correctivas.
- `sharedCommandReaderWait.test.ts`: evidencia de espera de lectores.
- Benchmarks/diagnósticos: salidas condicionadas y baselines históricos, algunas rutas externas.

El setup vigente redirige varias operaciones `fs` dirigidas a `docs/` a `artifacts/jest-evidence` o `SMARTFIN_EVIDENCE_DIR`, salvo `SMARTFIN_WRITE_EVIDENCE=1`. No cambia lecturas ni es sandbox de procesos hijos, snapshots o todas las APIs/rutas. Las referencias exigen revisar efectos transitivos, usar salida única y validar hashes; si la redirección no basta, instantánea externa validada o resultado pendiente.

`docs/PRUEBAS_Y_CALIDAD.md` conserva una cabecera histórica de 13 suites y ausencia de CI; su sección posterior y `.github/workflows/ci.yml` ya describen CI. La configuración actual es la evidencia de descubrimiento; no se reescribió ese documento ajeno. La CI declara typecheck, lint, Jest estable, reproducciones y preservación del árbol. No se comprobó ejecución remota de CI ni se adoptó su `npm ci` como permiso de instalar en esta tarea.

## Android y harnesses

Se localizaron instrumentaciones Kotlin `SubscriptionInterfaceTest.kt` y `SubscriptionReminderTest.kt` en `android/app/src/androidTest/java/com/smartfin/`. La primera abre `smartfin.db` del targetContext en escritura y hace limpieza SQL. El appId principal es `com.smartfin`, con mínimo API 24: no debe ejecutarse directamente sobre la app del usuario. La segunda sustituye ruta de base mediante un contexto de prueba, pero usa recursos nativos.

Existen campañas bajo `scripts/androidAtomicityPhase1/` hasta fase 4, `scripts/androidPost3BPerformance/`, `scripts/androidTransactionsPhase3/`, `scripts/sharedCommands/` y fases `scripts/phase5a/` a `scripts/phase6b3/`. Se inspeccionaron especialmente runner/atestación de fase 6B.2 y puntos de preparación de 6B.3. Son harnesses independientes de Jest; pueden preparar árboles externos, construir/instalar APK, resetear paquete, modificar permisos y sobrescribir salida histórica.

El runner 6B.2 comprueba hashes de fuentes/preparación, asset de atestación, packageId de APK y UID distinto, y registra entorno. Mantiene mutex por dispositivo. Es una base útil para el procedimiento, no prueba suficiente de identidad de dispositivo por serial ni autorización de sus acciones. Usa por defecto `com.smartfin.snapshot5b2.tests`, pero eso debe contrastarse con la campaña/política vigente. No se consultaron dispositivos ni se ejecutó ADB, Gradle, instalación o campaña.

## Hooks y skills relacionados

- `financial-integrity-guard`: no se encontró implementación ni registro activo con ese nombre en `.codex/`, `.claude/`, `.agents/` y `scripts/`; las menciones encontradas eran documentación de la skill SQLite. No se atribuye selección/evidencia automática. No se afirma ausencia en configuraciones externas no inspeccionadas.
- Codex: `.codex/hooks.json` registra PreToolUse para `.codex/hooks/dangerous-command-guard.cjs`, política JSON versión 1, parser PowerShell/CMD y protección de `.agents/`, `.codex/`, bases/secretos y operaciones Android.
- Claude: `.claude/settings.json` registra `.claude/hooks/dangerous-command-guard.cjs` para herramientas seleccionadas. El archivo actual se identifica como v2, con `allow/ask/deny`; scripts auxiliares/backups y sus tests no implican registro activo. Las dos implementaciones no son idénticas.
- Se evaluó en seco el guard Codex sobre un patch hipotético a `.agents/skills/smartfin-testing-qa/SKILL.md`: `deny`, `DG-FILE: Secret, database or guard configuration is protected`. No se intentó escribir allí ni se evadió el control. No es una denegación de una campaña ni una prueba de que el hook esté siendo ejecutado por el cliente en cada llamada.
- Se leyeron `smartfin-financial-domain` y `smartfin-sqlite-architecture` canónicas. Dominio conserva contradicciones históricas sobre compartidos y redondeos: la nueva skill exige contrastar código y aserciones actuales, sin duplicar ni reparar aquellas skills.

## Volumen

`AGENTS.md` y `__tests__/helpers/representativeHistory.ts` coinciden en 1k/seis meses, 10k/cinco años y 100k/cincuenta años calendario, con semilla/día de referencia fijos, varias cuentas/categorías/tipos. El procedimiento exige conteos y distribución antes de aceptar métricas, exactamente 50 archivos anuales para el fixture 100k y comparación de entornos equivalentes. No se ejecutó volumen 100k en esta entrega.

## Entrega y compatibilidad

Payload: [smartfin-testing-qa/SKILL.md](smartfin-testing-qa/SKILL.md) y siete referencias progresivas. Es metodología, sin hooks, scripts de ejecución automática, dependencias ni privilegios preaprobados. La fuente canónica prevista es `.agents/skills/smartfin-testing-qa/`; staging queda pendiente de instalación manual por la protección observada.

La documentación oficial de [Codex](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills) describe descubrimiento en `.agents/skills` del repositorio. La de [Claude Code](https://code.claude.com/docs/en/skills#choose-where-skills-load) documenta `.claude/skills/` y `SKILL.md`. Se usa el frontmatter compartido `name`/`description`, sin extensiones exclusivas. Las skills existentes SQLite en `.agents/` y `.claude/` son carpetas físicas; se propone la misma copia con hashes, una sola fuente editable y sin nueva copia en `.codex/skills`.

Compatibilidad documental y estructural comprobada; carga/activación real en ambos clientes pendiente tras instalación. Detalles, sincronización manual y comprobación de activación: [INSTALACION.md](INSTALACION.md). Resultados y limitaciones: [VALIDACION.md](VALIDACION.md).
