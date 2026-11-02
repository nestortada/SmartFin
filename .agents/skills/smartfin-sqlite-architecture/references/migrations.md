# Migraciones seguras

## Base comprobada

`src/database/migrations.ts::applyVersionedMigrations` crea `schema_migrations` fuera del generador y aplica las versiones pendientes en una transacción local. Usa introspección `PRAGMA table_info` y no ignora errores de ALTER/índices. La versión registrada no es `user_version` ni `schema_version`.

| Versión | Cambio vigente |
|---|---|
| 1 | Campos de medio/pista/deduplicación en movimientos, JSON de mensajes/aclaraciones en borradores; índice único parcial dedupe no nulo |
| 2 | Columnas de recurrencia/cursor/recordatorios; `subscription_occurrences`, `subscription_reminders`, índices/triggers; preserva la próxima fecha heredada como anclaje/cursor |
| 3 | Cuatro metadatos de fecha en movimientos, cuatro campos compartidos en splits; seis tablas compartidas, índices y triggers |
| 4 | `shared_loss_events`, CHECK/FK diferida, índices y triggers del diario |

El DDL inicial de `src/database/sqliteSchema.ts` refleja tablas actuales, pero `src/database/sqliteDatabase.ts::applySchema` aplaza componentes compartidos/pérdidas hasta las migraciones. Mantén tanto instalaciones nuevas como actualizaciones; no ejecutes a ciegas la lista completa sobre una base antigua.

## Procedimiento obligatorio ante un cambio de esquema

1. Inspecciona fuentes vigentes y un fixture **sintético** con `sqlite_master`, `table_info`, `foreign_key_list`, `index_list`/`index_xinfo` y `schema_migrations`. Registra DDL y versiones; no deduzcas columnas solo de la versión, porque pueden existir instalaciones parcialmente configuradas o DDL idempotente.
2. Define compatibilidad: versiones de app origen/destino, instalación vacía y actualizada, SQLite mínimo Android y consumidores de snapshots/exportación/borrado. Identifica filas, referencias, NULL, duplicados heredados, tipos reales almacenados y campos JSON/polimórficos afectados.
3. Diseña una migración nueva y su DDL de instalación nueva; no edites silenciosamente una versión ya distribuida para que solo algunas instalaciones reciban el cambio. Conserva filas y relaciones. No conviertas/borras datos inválidos sin una política explícita; informa si un índice único no puede construirse por duplicados.
4. Determina el límite atómico compatible con el runner y el driver. No añadas `BEGIN`/`COMMIT` al generador ni ejecutes PRAGMA de control para eludir las protecciones. No desactives FK como solución incidental. Si SQLite mínimo obliga a reconstruir una tabla, diseña copia/orden/validación y riesgo como cambio explícito; no asumas soporte de ALTER o UPSERT moderno.
5. Para cada tabla afectada conserva PK, defaults, NOT NULL, CHECK, unicidad parcial/expresiones, acciones FK, FK diferidas, triggers e índices. Revisa listas de revisión y borrado, readers de snapshots y CSV. `CREATE ... IF NOT EXISTS` no modifica una definición ya instalada.
6. Define recuperación: rollback transaccional ante error antes del commit; después, migración correctiva o restauración mediante procedimiento **existente y validado**, si lo hubiera. Documenta cambios irreversibles y precondiciones. No prometas un comando down universal ni una restauración en app que hoy no existe.
7. Construye fixtures sintéticos de versiones previas relevantes con datos relacionales: pagos/cuotas, suscripciones vinculadas, participaciones/pérdidas, borradores y datos heredados. Incluye campos ausentes y ya presentes cuando aplique; registra qué fixture reconstruye el pasado y cuál proviene de una copia de código histórica sintética.
8. Prueba avance, repetición donde deba ser idempotente, interrupción en cada DDL/escritura relevante y nueva apertura. Exige conservación exacta de valores/IDs/referencias no modificados, registro de versiones consistente y ausencia de resultados parciales tras rollback confirmado.
9. Tras migrar: verifica FK habilitadas, `PRAGMA foreign_key_check` vacío y `PRAGMA integrity_check` con `ok`; compara inventario y métricas financieras antes/después. Una prueba de FK vacía no demuestra equivalencia monetaria ni referencias sin FK. Repite la apertura/migración y compara esquema/filas.
10. Ejecuta suites relevantes y evaluación Android autorizada cuando el SQL/driver cambie. Si solo se probó Node, deja compatibilidad Android como pendiente; no ejecutes una campaña por inferencia.

## Casos de atención especial

- Dedupe tiene índice único **parcial**. Varias filas con NULL no significan un defecto. Un índice equivalente debe conservar su predicado.
- `subscription_occurrences` requiere unicidad por suscripción/fecha y por movimiento vinculado no nulo; no basta conservar su PK.
- Los índices civiles dependen de las expresiones de `src/shared/utils/transactionDate.ts`. Cambiar expresión exige revisar consultas/orden y datos históricos; no desplazar días por zona horaria.
- `shared_loss_events.related_event_id` es `DEFERRABLE INITIALLY DEFERRED`: valida al confirmar, incluyendo fallos que solo aparecen en COMMIT. La clasificación de resultado incierto del driver sigue aplicando.
- Una versión futura/desconocida en una base sintética debe investigarse: el runner actual no implementa una política general de downgrade. No atribuyas rechazo automático de versiones futuras al código existente.

Pruebas de partida: `__tests__/subscriptions.test.ts` (migración heredada, repetición y rollback), `__tests__/sharedExpenses.test.ts` (migración/constraints/revisión), `__tests__/sharedForgiveness.test.ts` (diario). Amplía escenarios según el cambio; un fixture reconstruido de versiones 0–4 no demuestra compatibilidad con toda instalación histórica posible.
