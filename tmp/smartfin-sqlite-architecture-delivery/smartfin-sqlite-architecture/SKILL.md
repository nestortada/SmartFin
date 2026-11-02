---
name: smartfin-sqlite-architecture
description: Audita y modifica la persistencia SQLite de SmartFin con procedimientos verificables para consultas, índices, migraciones, transacciones entre repositorios, concurrencia, recuperación, respaldos y driver Android. Úsala al cambiar esas garantías o investigar fallos de persistencia; no para cambios solo visuales ni cálculos financieros puros sin impacto en SQLite.
---

# Arquitectura SQLite de SmartFin

## Empezar por la evidencia vigente

1. Localiza la raíz mediante `AGENTS.md` y `package.json`. Las rutas de código de estas referencias son relativas a esa raíz, no al directorio de la skill. Lee `AGENTS.md`, `CLAUDE.md` y el estado/diff local; conserva trabajo ajeno.
2. Delimita el encargo: auditoría, consulta, operación transaccional, esquema o plataforma. Una auditoría no autoriza reparaciones. Comprueba que los archivos citados sigan existiendo con `rg --files` y sigue sus llamadores actuales.
3. Lee las secciones pertinentes de `docs/ARQUITECTURA.md` y `docs/BASE_DE_DATOS.md`; contrástalas con código y pruebas. El [mapa auditado](references/sqlite-architecture.md) orienta la búsqueda, pero no sustituye una comprobación nueva. Si cambió una fuente, revisa sus afirmaciones antes de reutilizarlas.
4. Define entidades afectadas, límite de commit, invariantes, plataformas y evidencia de aceptación **antes** de editar. Usa solo fixtures sintéticos en memoria o temporales aislados; no abras bases financieras reales para probar.

## Elegir la referencia necesaria

| Tarea | Leer |
|---|---|
| Localizar repositorios, relaciones, versiones o una discrepancia | [Arquitectura y auditoría](references/sqlite-architecture.md); [inventario de esquema](references/schema-inventory.md) solo si hace falta detalle |
| Escrituras, varios repositorios, carreras o confirmación incierta | [Transacciones y concurrencia](references/transactions-and-concurrency.md) |
| DDL, restricciones, índices persistidos o compatibilidad instalada | [Migraciones](references/migrations.md) |
| Consultas, paginación, agregados, índices o bloqueos lentos | [Rendimiento](references/performance.md) |
| Apertura/cierre, driver, fallos, snapshots, exportación o borrado | [Recuperación y respaldos](references/recovery-and-backups.md) |
| Seleccionar verificaciones o cerrar el cambio | [Pruebas según riesgo](references/testing-checklist.md) |

No cargues todas las referencias por defecto. El [inventario JSON](references/schema-inventory.json) conserva el detalle derivado de SQLite; consulta únicamente las tablas relevantes.

## Límites que deben conservarse

- Reutiliza los ámbitos existentes. Un permiso de mantenimiento serializa acceso; **no equivale a una transacción**. Varios `await` o repositorios creados con conexiones distintas tampoco acreditan atomicidad.
- En un comando compartido, un único propietario abre y finaliza la transacción; todas las operaciones usan su participante. No añadas `BEGIN`/`COMMIT`, transacciones anidadas o callbacks `async` dentro de `database.transaction`.
- Conserva `confirmed`, `rolledBack` y `unknown`. Ante `unknown`, no repitas el cuerpo financiero ni lo compenses; recupera/verifica estado y comprobantes específicos sin inventar idempotencia global.
- Mantén FK activas, identidad/referencias, revisión y contratos de orden/precisión. No sustituyas el guardado de cuentas o movimientos por `INSERT OR REPLACE`.
- No aceptes una optimización por apariencia: reproduce, mide, explica la causa y demuestra equivalencia. No reduzcas el ámbito atómico para mejorar tiempos.
- Cambios autorizados de esquema requieren compatibilidad instalada y validación sintética; no prometas reversión automática universal.
- No alteres hooks, políticas ni permisos al usar esta skill. Si el guard bloquea una ruta de instalación, entrega staging e instrucciones manuales; no lo evadas. Las campañas Android necesitan autorización explícita y una APK/entorno sintéticos.

## Colaborar con otras skills

`smartfin-financial-domain` define efectos de saldo, deuda, patrimonio, impuestos, cuotas y reglas de edición. Cárgala si esos efectos pueden cambiar; esta skill define cómo persistirlos y verificarlos. Localízala en las rutas descubiertas del agente; no presupongas sincronía entre sus copias. Su texto contiene observaciones históricas: prevalece la evidencia actual contrastada, y se informa la contradicción.

Si existe `smartfin-testing-qa`, úsala para metodología general y conserva aquí las exigencias SQLite. Comprueba la existencia y alcance real de `financial-integrity-guard` antes de atribuirle verificaciones automáticas. `dangerous-command-guard` es infraestructura de hooks, no una skill financiera ni un sustituto de las pruebas. En la auditoría inicial no se encontraron `smartfin-testing-qa` ni un hook `financial-integrity-guard` en las rutas de proyecto revisadas; no los instales implícitamente.

## Entregar un resultado comprobable

Informa comportamiento preservado o delta autorizado, archivos/símbolos vigentes, contradicciones y su evidencia, verificaciones ejecutadas con resultado y verificaciones pendientes. Separa SQLite Node, driver Android y evidencia histórica. No declares validación de dispositivo, restauración o durabilidad ante pérdida de energía a partir de mocks, archivos exportados o pruebas Node.
