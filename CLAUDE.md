# SmartFin - Claude Code Instructions

@AGENTS.md

## Reglas Principales y Dominio Financiero

- **Offline-first y Local-first**: Toda la lógica financiera y de persistencia es local (SQLite). No agregar servicios remotos, telemetría ni analítica sin aprobación explícita.
- **Integridad Financiera**: Antes de modificar cálculos de balances, deudas, suscripciones, tarjetas o movimientos, revisa la skill en `.claude/skills/smartfin-financial-domain/SKILL.md`.
- **Rendimiento React Native**: Para optimizaciones de render, listas y memoria, consulta la skill en `.claude/skills/react-native-best-practices/SKILL.md`.

## Skills Disponibles (Claude Code)

- `/smartfin-financial-domain`: Reglas de dominio financiero, integridad de balances, préstamos, tarjetas y atomicidad SQLite.
- `/react-native-best-practices`: Guías de rendimiento, FlashList, optimizaciones Hermes y evitar re-renders.

## Comandos de Verificación y Desarrollo

```bash
# Ejecutar suite de pruebas (Jest)
npm test -- --runInBand

# Verificación estricta de tipos de TypeScript
npx tsc --noEmit

# Linter
npm run lint

# Iniciar Metro Bundler
npm start
```
