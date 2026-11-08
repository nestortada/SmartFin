# SmartFin - Claude Code Instructions

@AGENTS.md

## Reglas Principales y Dominio Financiero

- **Offline-first y Local-first**: Toda la lógica financiera y de persistencia es local (SQLite). No agregar servicios remotos, telemetría ni analítica sin aprobación explícita.
- **Integridad Financiera**: Antes de modificar cálculos de balances, deudas, suscripciones, tarjetas o movimientos, revisa la skill en `.claude/skills/smartfin-financial-domain/SKILL.md`.
- **Rendimiento React Native**: Para optimizaciones de render, listas y memoria, consulta la skill en `.claude/skills/react-native-best-practices/SKILL.md`.

## Skills Disponibles (Claude Code)

- `/smartfin-financial-domain`: Reglas de dominio financiero, integridad de balances, préstamos, tarjetas y atomicidad SQLite.
- `/smartfin-sqlite-architecture`: Consultas, índices, migraciones, transacciones entre repositorios, concurrencia, recuperación, respaldos y driver Android.
- `/smartfin-security-privacy`: Amenazas, exposición de datos, credenciales, Keystore/biometría, respaldos, IA e integraciones externas.
- `/smartfin-testing-qa`: Diseño y evaluación de pruebas Jest, React Native, SQLite y Android; regresiones financieras, atomicidad y rendimiento con datos sintéticos.
- `/react-native-best-practices`: Guías de rendimiento, FlashList, optimizaciones Hermes y evitar re-renders.
- `/agent-device`: Automatización de dispositivos y emuladores (navegar, tocar, capturas, evidencia de UI).
- `/smartfin-phase-delivery`: Protocolo de una fase numerada: estado inicial, reproducción, decisión, invariantes, atomicidad, pruebas, revisores, documento de fase, índice y pendientes.
- `/smartfin-android-campaign`: Preparación, ejecución autorizada y aceptación de campañas de equivalencia Node–Android (workspace sintético, APK, runner, rondas rN).

## Delegación

- Antes de dar por terminado un cambio en `useCases`, repositorios, SQL o migraciones, invoca `financial-reviewer`.
- Antes de dar por terminado un cambio en `android/`, servicios de plataforma o `databaseCoordination.ts`, invoca `android-native-reviewer`.
- Antes de dar por terminado un cambio en respaldo, restauración, exportación, autenticación, permisos o servicios externos, invoca `security-privacy-reviewer`.
- El hook `Stop` (`.claude/hooks/reviewer-reminder.cjs`) recuerda estos revisores cuando cambian esas áreas durante la sesión; no sustituye el criterio de invocarlos.

## Comandos de Verificación y Desarrollo

```bash
# Ejecutar suite de pruebas (Jest)
npm test -- --runInBand

# Reproducciones de defectos (test.failing controlados; igual que la CI)
npm run test:reproductions -- --runInBand

# Verificación estricta de tipos de TypeScript (igual que la CI)
npm run typecheck

# Linter
npm run lint

# Iniciar Metro Bundler
npm start
```
