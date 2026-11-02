# Entrega y validación de smartfin-sqlite-architecture

Fecha: 1 de noviembre de 2026. Implementación limitada a esta carpeta de staging. No se modificaron producción, esquema/migraciones, hooks, políticas, instrucciones permanentes ni dependencias. No se hicieron commits/push ni campañas Android.

## Contenido revisable

- [SKILL.md](smartfin-sqlite-architecture/SKILL.md): activación automática, exclusiones, flujo operativo, restricciones y lectura progresiva.
- [Auditoría de arquitectura](smartfin-sqlite-architecture/references/sqlite-architecture.md): fuentes reales, responsabilidades, conexiones, operaciones compuestas y contradicciones entre documentación/código/pruebas.
- [Inventario legible](smartfin-sqlite-architecture/references/schema-inventory.md) y [JSON completo](smartfin-sqlite-architecture/references/schema-inventory.json): 39 tablas, PK/FK, acciones de borrado, columnas, CHECK, unicidad, 39 índices explícitos, índices automáticos y 99 triggers.
- [Transacciones](smartfin-sqlite-architecture/references/transactions-and-concurrency.md), [migraciones](smartfin-sqlite-architecture/references/migrations.md), [rendimiento](smartfin-sqlite-architecture/references/performance.md), [recuperación y respaldos](smartfin-sqlite-architecture/references/recovery-and-backups.md) y [pruebas](smartfin-sqlite-architecture/references/testing-checklist.md).
- [Instalación/compatibilidad Codex y Claude](INSTALACION.md): versiones locales verificadas, rutas oficiales, fuente canónica y alternativa manual sin enlaces.
- [Escenarios de aplicación](validation/SCENARIOS.md), [harness reproducible](validation/validate.cjs), [resultados sintéticos](validation/results.json), [resultados Jest](validation/jest-results.json), [huellas previas de fuentes/configuración](validation/protected-before.json) y [SHA-256 del paquete](validation/package-sha256.json).

El paquete instalable es únicamente la carpeta `smartfin-sqlite-architecture`; validación e instalación permanecen fuera para no cargar instrucciones de entrega durante cada uso. `SKILL.md` usa solo `name`/`description`, sin hooks, permisos de herramientas, dependencias MCP, llamadas de red, generación dinámica o campos exclusivos de un agente. La selección automática queda habilitada por defecto.

## Comprobaciones ejecutadas

| Verificación | Resultado |
|---|---|
| Validador oficial skill-creator (`quick_validate.py`, Python UTF-8) | `Skill is valid!` |
| YAML compartido, nombre, descripción y rutas relativas de Markdown | Válidos; enlaces comprobados contra el paquete completo |
| Rutas concretas de código/documentación citadas | Existencia comprobada por harness; símbolos/procedimientos contrastados durante auditoría |
| Reconstrucción sintética del esquema vigente | 39 tablas, 39 índices explícitos y 99 triggers; inventario completo generado desde SQLite |
| Versiones sintéticas 0,1,2,3,4 → actual | Conservan saldos, identidad/importe/fecha de movimientos y datos de suscripción; FK/integridad correctas; versiones 1–4 presentes y segunda aplicación sin cambios |
| Interrupción sintética de migración 3 | Rollback conserva esquema, filas y revisión; siguiente aplicación sin fallo termina correctamente |
| Consulta civil mensual, índice frente a scan | Resultados idénticos en 1.000/10.000/100.000; planes y siete muestras por variante en JSON; 100.000 repartidos en 50 años |
| Suites existentes del adaptador/runner | 10 suites, 186 pruebas aprobadas, ninguna omitida en esa selección, 31,698 s reportados por Jest |
| Integridad de fuentes/hooks/configuración enumerados | 881 archivos con hashes previos iguales después de los ensayos; los cambios locales anteriores se conservaron |
| Escenarios de enrutamiento/decisiones | Revisión dirigida documentada: consulta, commit incierto, migración y límites de activación |

Entorno: Node 24.16.0, SQLite Node 3.53.0; Codex CLI 0.166.0 y Claude Code 2.1.316. Son versiones observadas localmente, no requisitos universales de la skill. No se instaló ninguna dependencia para validar.

Reproducir el harness, desde la raíz y conservando esta ubicación de staging:

```powershell
node tmp/smartfin-sqlite-architecture-delivery/validation/validate.cjs
```

Este comando usa TypeScript/js-yaml ya instalados, lee las fuentes actuales y escribe solo inventario/resultados en la entrega. SQLite se ejecuta en memoria. `baseline` es una operación separada utilizada **antes** de los ensayos; no regenerarla para ocultar diferencias posteriores. El harness compara con esa línea base y falla si cambian los archivos enumerados. No es un instalador.

Comando de las suites ejecutadas:

```powershell
$env:SMARTFIN_WRITE_EVIDENCE='0'
$env:SMARTFIN_EVIDENCE_DIR='tmp/smartfin-sqlite-architecture-delivery/validation/evidence'
npm test -- --runInBand --runTestsByPath __tests__/financialAtomicityInfrastructure.test.ts __tests__/sharedSQLiteCoordination.test.ts __tests__/sqliteRecoveryLifecycle.test.ts __tests__/sqliteAndroidRecoveryPatch.test.ts __tests__/localSnapshotCoordination.test.ts __tests__/subscriptions.test.ts __tests__/sharedExpenses.test.ts __tests__/financialAtomicityPhase2.test.ts __tests__/transactionHistoryPhase5E2RangePlan.test.ts __tests__/transactionHistoryRefinement.test.ts --json --outputFile tmp/smartfin-sqlite-architecture-delivery/validation/jest-results.json
```

Los ensayos revisados cubren sentencias con fallos antes/después, rollback, respuesta perdida de COMMIT, no reintento, revocación/expiración, carreras con lector/cierre, recibos tardíos, migración/reconciliación y el parche instalado. No se lanzó toda la suite ni las campañas de rendimiento Android. No se corrió typecheck: no hubo cambios estructurales/TypeScript de producción; el harness auxiliar es JavaScript y se ejecutó.

## Límites y pendientes reales

- El harness de DDL transpila módulos actuales y ejecuta el **generador real de migraciones** con un runner aislado en memoria; no sustituye al runner/driver RN. Las suites Jest ejecutadas cubren por separado el runner actual, con adaptador Node y mocks de plataforma.
- Las bases históricas se reconstruyen sintéticamente: no certifican todas las bases distribuidas, todos los datos heredados ni una migración futura hipotética.
- El microbenchmark muestra equivalencia de una proyección mensual y diferencia de plan, sin atribuir mejora al historial completo ni fijar un umbral de aceptación de ms. Los tiempos son locales Node, no Android.
- El parche Android se leyó y pasó su suite de idempotencia/layout; no se ejecutó el driver real en dispositivos. Recuperación tras pérdida de energía/terminación abrupta nativa no está certificada por estos ensayos.
- La skill complementa la financiera sin cambiarla ni copiar sus fórmulas. Observaciones antiguas contradictorias quedan señaladas; no se corrigieron documentos previos fuera del alcance.
- No se encontraron `smartfin-testing-qa` ni un hook `financial-integrity-guard` implementado en las rutas de proyecto inspeccionadas. No se les atribuye cobertura ni se instalaron.
- La skill es compatible en formato y rutas documentadas con ambos agentes, pero está **pendiente de instalación manual y de prueba de descubrimiento/invocación en esos hosts** por las protecciones existentes. Ver [guía de instalación](INSTALACION.md).
- No hay restauración integrada en la app acreditada. Recuperabilidad de exportaciones sintéticas y publicación verificada no deben presentarse como restauración disponible.

Las recomendaciones de evolución están separadas de los hechos en la auditoría. La entrega no activa UI de respaldos, cambia precisión monetaria, repara categorías ni altera reglas de seguridad.
