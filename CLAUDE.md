# SmartFin - Claude Code Instructions

@AGENTS.md

## Reglas Principales y Dominio Financiero

- **Offline-first y Local-first**: Toda la lógica financiera y de persistencia es local (SQLite). No agregar servicios remotos, telemetría ni analítica sin aprobación explícita.
- **Integridad Financiera**: Antes de modificar cálculos de balances, deudas, suscripciones, tarjetas o movimientos, revisa la skill en `.claude/skills/smartfin-financial-domain/SKILL.md`.
- **Rendimiento React Native**: Para optimizaciones de render, listas y memoria, consulta la skill en `.claude/skills/react-native-best-practices/SKILL.md`.
- **Lecturas bloqueadas**: `.claude/settings.json` impide leer `.env`, keystores, claves y bases SQLite con `Read`/`Grep`/`Glob` (el guard de comandos no cubre esas herramientas). No intentes leerlos por otra vía.
- **Reglas por ruta**: `.claude/rules/` contiene recordatorios por ruta que Claude Code carga al trabajar con archivos coincidentes; no sustituyen AGENTS.md, las skills, los revisores ni los hooks. Solo aplican a Claude Code.

## Skills Disponibles (Claude Code)

- `/smartfin-financial-domain`: Reglas de dominio financiero, integridad de balances, préstamos, tarjetas y atomicidad SQLite.
- `/smartfin-sqlite-architecture`: Consultas, índices, migraciones, transacciones entre repositorios, concurrencia, recuperación, respaldos y driver Android.
- `/smartfin-security-privacy`: Amenazas, exposición de datos, credenciales, Keystore/biometría, respaldos, IA e integraciones externas.
- `/smartfin-testing-qa`: Diseño y evaluación de pruebas Jest, React Native, SQLite y Android; regresiones financieras, atomicidad y rendimiento con datos sintéticos.
- `/react-native-best-practices`: Guías de rendimiento, FlashList, optimizaciones Hermes y evitar re-renders.
- `/agent-device`: Automatización de dispositivos y emuladores (navegar, tocar, capturas, evidencia de UI).
- `/smartfin-phase-delivery`: Protocolo de una fase numerada: estado inicial, reproducción, decisión, invariantes, atomicidad, pruebas, revisores, documento de fase, índice y pendientes.
- `/smartfin-android-campaign`: Preparación, ejecución autorizada y aceptación de campañas de equivalencia Node–Android (workspace sintético, APK, runner, rondas rN).
- `/verificar`: Ejecuta en local las comprobaciones de la CI y resume el resultado (solo invocación manual; `/verificar rapido` omite Jest).

## Delegación

- Antes de dar por terminado un cambio en `useCases`, repositorios, SQL, migraciones, tipos de dominio o utilidades monetarias y de fecha (`exactCopCents`, `copAmountInput`, `transactionDate`), invoca `financial-reviewer`.
- Antes de dar por terminado un cambio en `android/`, servicios de plataforma, `databaseCoordination.ts` o los parches del driver SQLite (`scripts/*Patch.js`), invoca `android-native-reviewer`.
- Antes de dar por terminado un cambio en respaldo, restauración, exportación, autenticación, permisos o servicios externos, invoca `security-privacy-reviewer`.
- Antes de dar por terminado un cambio que modifique o elimine pruebas, reproducciones, helpers u oráculos existentes en `__tests__/`, invoca `test-reviewer`.
- Antes de dar por terminado un cambio de código no trivial en `src/`, `android/`, `scripts/` o `__tests__/`, invoca `code-quality-reviewer` con la lista de archivos cambiados y su estado (A, M o D): es de solo lectura y no ve el diff. Complementa a los especialistas; no los sustituye.
- El hook `Stop` (`.claude/hooks/reviewer-reminder.cjs`) recuerda estos revisores cuando cambian esas áreas durante la sesión, `npm run skills:sync` cuando las copias de skills difieren, y typecheck, Jest o las pruebas de hooks cuando cambiaste código después de la última vez que se ejecutaron; no sustituye el criterio de invocarlos ni de verificar.
- Para tareas que necesitan exploración, un escritor y varios revisores, existe el workflow `/smartfin-development` (`audit` por defecto, `implement` con comportamiento esperado verificable). Por decisión del propietario, `implement` todavía no se usa sobre código financiero.

## Autonomía: cuándo actuar y cuándo preguntar

Procede sin pedir confirmación, y verifica antes de terminar:

- Leer, buscar y explorar el repositorio; delegar en `scout` o en los revisores.
- Ejecutar comprobaciones locales: typecheck, lint, Jest (completo o de las pruebas afectadas), reproducciones, pruebas de hooks y `skills:check`.
- Dejar el entorno listo para verificar: si un worktree no tiene `node_modules`, sigue la indicación del hook `SessionStart` (junction al checkout principal si el lockfile coincide; `npm ci` si no).
- Refactorizaciones equivalentes con las pruebas en verde, corrección de tipos y lint, pruebas nuevas, cambios de UI sin reglas financieras y documentación no histórica.
- Corregir un defecto propio que acabas de introducir o que detectó un revisor dentro del alcance de la tarea.

Detente y pide aprobación explícita antes de:

- Un cambio financiero funcional, es decir, que altere importes, saldos, deuda, redondeos o fechas observables (`.claude/rules/financial-flow.md`).
- Cambios de esquema o migraciones, y cambios en los parches del driver SQLite (`scripts/*Patch.js`).
- Añadir o actualizar dependencias, o cambiar `.nvmrc` o `engines`.
- Llamadas de red, telemetría, permisos Android o servicios externos nuevos.
- Compilar o instalar APK, ejecutar campañas Android o usar dispositivos (`/smartfin-android-campaign`).
- Activar `BACKUP_PUBLICATION_UI_ENABLED` o cambiar decisiones registradas del propietario.
- Debilitar, omitir o reescribir pruebas, reproducciones u oráculos existentes para que pasen.
- Hacer commit, push, abrir PR o tocar ramas que no son de la tarea.

Si no está claro en qué lista cae un cambio, trátalo como si necesitara aprobación y explica por qué en una frase.

## Mapa rápido del código

- **Transacciones SQLite**: `src/database/atomicSQLite.ts` (`runSharedSQLiteTransaction`, `runSQLiteTransaction`, programas generadores `SQLiteProgram`). Esquema y migraciones: `src/database/sqliteSchema.ts` y `src/database/migrations.ts`. Coordinación con el lado nativo: `src/database/databaseCoordination.ts`.
- **Dinero y fechas**: `src/shared/utils/exactCopCents.ts` (sumas y agregados exactos del libro `REAL`), `copAmountInput.ts` (entrada de importes) y `transactionDate.ts` (fechas civiles `America/Bogota`). Tipos comunes: `src/shared/types/finance.ts`.
- **Módulos**: `src/modules/<feature>/` con la API pública en `index.ts`; la lógica vive en `useCases/`, la persistencia en `repositories/` y `database/`. El motor de cuotas puro en centavos está en `src/modules/creditCards/useCases/installmentPlan.ts`; los gastos compartidos, en `src/modules/transactions/repositories/SharedExpenseRepository.ts` y sus casos de uso.
- **Integraciones**: `src/services/` (IA Gemini), `src/native/` y los `services/` de cada módulo (respaldo, copia local, notificaciones); su lado Kotlin está en `android/app/src/main/java/com/smartfin/`.
- **Pruebas**: SQLite real en Node con `__tests__/helpers/realSQLite.ts`; históricos representativos en `__tests__/helpers/representativeHistory.ts`; defectos confirmados en `__tests__/reproductions/` (`jest.reproductions.config.js`). Las evidencias de las pruebas se redirigen con `__tests__/setup/redirectEvidenceWrites.js`.
- **Documentación**: empieza por `docs/INDICE.md`; `docs/MODULOS_Y_FLUJOS.md` describe los recorridos funcionales y `docs/BASE_DE_DATOS.md` las tablas.
- **Memoria de agentes**: `.claude/agent-memory/` (por ahora solo `financial-reviewer`). Los agentes la consultan y proponen cambios en su informe; solo se actualiza con aprobación explícita, en commits de documentación separados. Mantenimiento: `.claude/agent-memory/README.md`.

## Comandos de Verificación y Desarrollo

```bash
# Ejecutar suite de pruebas (Jest)
npm test -- --runInBand

# Solo las pruebas afectadas por un cambio
npx jest --runInBand <rutas-de-prueba>

# Pruebas de los hooks de Claude Code (igual que la CI, job guard-hooks)
node --test .claude/hooks/__tests__/dangerous-command-guard.test.cjs .claude/hooks/__tests__/reviewer-reminder.test.cjs .claude/hooks/__tests__/session-context.test.cjs .claude/hooks/__tests__/agent-config-policy.test.cjs

# Reproducciones de defectos (test.failing controlados; igual que la CI)
npm run test:reproductions -- --runInBand

# Verificación estricta de tipos de TypeScript (igual que la CI)
npm run typecheck

# Linter
npm run lint

# Copiar .claude/skills a .agents/skills (Codex) / comprobar que son idénticas
npm run skills:sync
npm run skills:check

# Iniciar Metro Bundler
npm start
```
