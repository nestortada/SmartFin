# Documentación de SmartFin

Este índice separa la documentación por audiencia y fuente de verdad. El código tiene prioridad cuando una descripción histórica contradice la implementación.

| Documento | Audiencia | Contenido |
|---|---|---|
| [README](../README.md) | Todas | Resumen, instalación, ejecución y enlaces |
| [Producto y alcance](PRODUCTO_Y_ALCANCE.md) | Producto, diseño y desarrollo | Visión, usuarios, capacidades y estado real |
| [Arquitectura](ARQUITECTURA.md) | Desarrollo y arquitectura | Capas, dependencias, arranque y decisiones técnicas |
| [Módulos y flujos](MODULOS_Y_FLUJOS.md) | Desarrollo y QA | Responsabilidades y recorridos funcionales |
| [Base de datos](BASE_DE_DATOS.md) | Desarrollo y datos | SQLite, tablas, relaciones, migraciones y respaldo |
| [Seguridad y privacidad](SEGURIDAD_Y_PRIVACIDAD.md) | Producto, seguridad y desarrollo | Modelo de protección, datos sensibles y límites |
| [Guía de desarrollo](GUIA_DESARROLLO.md) | Desarrollo | Entorno, convenciones y extensión del sistema |
| [Pruebas y calidad](PRUEBAS_Y_CALIDAD.md) | Desarrollo y QA | Comandos, cobertura funcional y estrategia |
| [Roadmap](ROADMAP.md) | Producto y desarrollo | Brechas y fases propuestas |
| [Extractos multiciclo (Fase 1a.2)](correccion-fase1a2.md) | Desarrollo y QA | Cuotas por ciclo con el motor, protección de extractos históricos y validación pendiente |
| [Validación Android 1a.2 (preparada)](validacion-fase1a2/README.md) | QA | Campaña phase1a2-statements, matriz por dispositivo y procedimiento autorizable |
| [Escenario C: pago de un ciclo anterior](analisis-escenario-c-fase1a2.md) | Producto y desarrollo | Datos necesarios para asociar pagos con extractos |
| [Persistencia segura (Fase 1a.3A)](persistencia-segura-fase1a3A.md) | Desarrollo y QA | Sustitución de INSERT OR REPLACE en tarjetas, identidad y dependientes, validada en Android |
| [Validación Android 1a.3A](validacion-fase1a3a/README.md) | QA | 223/223 en API 24 (SQLite 3.9.2) y API 35; identidad, atomicidad y regresiones sin diferencias |
| [Imputaciones y revisiones (Fase 1a.3B)](persistencia-imputaciones-fase1a3B.md) | Desarrollo y QA | Migración 5: imputaciones, historial de planes y metadatos D1, política de eliminación D5/D6 |
| [Validación Android 1a.3B (preparada)](validacion-fase1a3b/README.md) | QA | 7 campañas (66 casos) + 11 regresiones, oráculo Node de 28.443 hojas y workspace sintético; no ejecutada |
| [Revisión inicial de compras nuevas (Fase 1a.4A)](revision-inicial-fase1a4A.md) | Desarrollo y QA | Revisión 0 atómica al dar de alta o recrear un plan a cuotas, con el motor 1a.1 |
| [Validación Android 1a.4A (preparación)](validacion-fase1a4a/README.md) | QA | r2 aprobada: 355/355 casos y 198/198 puntos de fallo en API 24 y API 35 (r1 detenida y conservada) |
| [Abonos extraordinarios «No sé» (Fase 1a.4B)](abonos-extraordinarios-fase1a4B.md) | Desarrollo y QA | Imputación limitada al capital estimado, revisión 0 perezosa, reversiones D6 y protección de compras imputadas; interno, sin interfaz; validado en Android r5 |
| [Validación Android 1a.4B](validacion-fase1a4b/r5/README.md) | QA | r5 aprobada: 568/568 casos y 356/356 puntos de fallo en API 24 y API 35, 0 diferencias frente a Node (r1–r4 y r5 intento 1 conservados) |
| [Pendientes tras 1a.4B](pendientes-fase1a4B.md) | Desarrollo | Huella del comando, reconciliación bancaria, respaldo y restauración del historial, intermitencia de pruebas; sin implementar |
| [Motor de cuotas (Fase 1a.1)](motor-cuotas-fase1a1.md) | Desarrollo y QA | Calendario de cuotas puro y exacto en centavos; contrato y reglas de ciclos |
| [Guard de comandos en Claude Code (v2)](dangerous-command-guard-claude.md) | Desarrollo | Hook PreToolUse vigente: reglas, límites y verificación; la v1 está en [historico/guard-claude-v1](historico/guard-claude-v1/dangerous-command-guard-claude-v1.md) |
| [Guard de comandos en Codex (v1)](dangerous-command-guard.md) | Desarrollo | Hook de Codex en `.codex/hooks/`: contrato, política y pruebas |
| [Contribución](../CONTRIBUTING.md) | Colaboradores | Flujo de cambios y lista de verificación |

## Historial de fases

Documentos de evidencia por fase, en orden. Son históricos: describen el código del momento en que se escribieron, y el código y las pruebas vigentes prevalecen cuando discrepan. El estado es el que declara cada documento; consulta su sección de veredicto antes de apoyarte en él.

### Integridad y atomicidad financiera (fases 0–4)

| Documento | Estado declarado |
|---|---|
| [Auditoría correctiva de integridad financiera](auditoria-integridad-financiera.md) | 11 oct 2026. Siete defectos reproducidos y corregidos en SQLite en memoria |
| [Diseño de atomicidad financiera](diseno-atomicidad-financiera.md) | Propuesta que originó las fases 0–4 (un dueño de conexión y un único COMMIT por operación) |
| [Fase 0](atomicidad-financiera-fase0.md) | Infraestructura, caracterización y oráculos de prueba |
| [Fase 1](atomicidad-financiera-fase1.md) y [validación API 24](validacion-atomicidad-fase1-api24.md) | Implementación inicial; 11/14 casos en Android, sustituida por la 1.1 |
| [Fase 1.1 correctiva](atomicidad-financiera-fase11.md) | 14/14 casos en API 24 y API 35 |
| [Fase 2](atomicidad-financiera-fase2.md) | Movimientos manuales y acciones rápidas en un único BEGIN IMMEDIATE/COMMIT |
| [Fase 3A](atomicidad-financiera-fase3a.md) | Pago independiente de tarjeta atómico |
| [Fase 3A.1](atomicidad-financiera-fase3a1.md) | Reloj de pruebas y reconciliación de tarjetas sobre todo el historial |
| [Fase 3B](atomicidad-financiera-fase3b.md) | Gestión y asociación de tarjetas; pago efectivo ≥ $1; 14 campañas aprobadas en API 24 y API 35 |
| [Rendimiento posterior a 3B](verificacion-rendimiento-post3b.md) | Diagnóstico y corrección del límite de parámetros |
| [Fase 4: IA y Suscripciones](atomicidad-financiera-fase4.md) | Plan IA con comprobante durable y Suscripciones bajo el runner compartido |

### Coordinación nativa, respaldos y aceptación integrada (fase 5)

| Documento | Estado declarado |
|---|---|
| [Fase 5A](atomicidad-financiera-fase5a.md) | Diagnóstico y diseño de coordinación nativa, respaldos y borrado |
| [Fase 5B.1](atomicidad-financiera-fase5b1.md) | Coordinación de un proceso y captura SQLite privada |
| [Fase 5B.2](atomicidad-financiera-fase5b2.md) | Publicación SAF por generaciones; `BACKUP_PUBLICATION_UI_ENABLED` sigue en `false` |
| [Fase 5C](atomicidad-financiera-fase5c.md) | Borrado financiero y limpieza recuperable; aceptada en el alcance sintético |
| [Fase 5D](atomicidad-financiera-fase5d.md) | Entrega de recordatorios y recuperación Android; no autoriza 5E por sí sola |
| [Fase 5E](atomicidad-financiera-fase5e.md) | Aceptación integrada: **bloqueada** en su momento |
| [Fase 5E.1](atomicidad-financiera-fase5e1.md) | 5E-001 y 5E-002 aceptados funcionalmente; aceptación integrada pendiente |
| [Fase 5E.2](rendimiento-fase5e2.md) | Rendimiento del historial (API 24: 12,98 s → 0,27 s) |
| [Fase 5E.3](aceptacion-integrada-fase5e3.md) | Fase 5E **condicionada**; activación de respaldos **bloqueada** |
| [Fase 5E.4](optimizacion-fase5e4.md) | Recuperación concurrente y optimización de respaldos manuales; aceptada |
| [Fase 5E.5](recuperabilidad-fase5e5.md) | Archivo de respaldo recuperable; sin restauración funcional; aceptada |
| [Fase 5E.6](correccion-fase5e6.md) | Precisión y orden de los CSV; aceptada |

### Precisión monetaria (fase 6)

| Documento | Estado declarado |
|---|---|
| [Fase 6A](precision-fase6a.md) | Ingresos, gastos y ahorro mensuales del dashboard en centavos exactos; 35/35 campañas por API |
| [Auditoría 6B](auditoria-fase6b.md) | Integridad interna **condicionada**; defectos 6B-D1…D5, 6B-C1 y 6B-O1 |
| [Fase 6B.1](correccion-fase6b1.md) | Saldos y deudas persistidos con centavos exactos (D1, D2); 39/39 campañas por API |
| [Fase 6B.2](correccion-fase6b2.md) | Agregados del dashboard exactos (D3) y cero sin signo (D4 parcial); validada en API 24 y API 35 |
| [Fase 6B.3](correccion-fase6b3.md) | Liquidación exacta de deuda de tarjeta (C1); validada en Node y, según su actualización del 1 nov 2026, en Android (API 24 y API 35: 102/102) |

### Gastos compartidos y condonaciones

| Documento | Estado declarado |
|---|---|
| [Fecha editable y gastos compartidos](GASTOS_COMPARTIDOS_Y_FECHAS.md) | Migración 3: dominio, persistencia y API; sin interfaz |
| [Condonaciones compartidas](CONDONACIONES_COMPARTIDAS.md) | Migración 4: pérdidas, recuperaciones y reversiones; sin interfaz |
| [Auditoría de gastos compartidos en Android](AUDITORIA_GASTOS_COMPARTIDOS_ANDROID.md) | Base funcional comprobada; interfaz no lista |
| [Validación Android de operaciones compartidas](VALIDACION_OPERACIONES_COMPARTIDAS_ANDROID.md) | Campaña sintética de los comandos del módulo |

### Línea base

| Documento | Estado declarado |
|---|---|
| [Línea base fase 0 y reproducciones](linea-base-fase0.md) | Origen de `__tests__/reproductions/` (`npm run test:reproductions`) |

## Fuentes de verdad

1. Tipos, casos de uso, repositorios y esquema dentro de `src/`.
2. Módulos nativos en `android/app/src/main/java/com/smartfin/`.
3. Pruebas en `__tests__/`, que expresan reglas observables.
4. Este conjunto de documentos.
5. `SmartFin_Objetivos_y_Funcionalidades.pdf`, como visión histórica y no como descripción del estado actual.

## Cómo mantener la documentación

- Actualiza `PRODUCTO_Y_ALCANCE.md` y `ROADMAP.md` cuando una capacidad cambie de estado.
- Actualiza `ARQUITECTURA.md` si cambian límites, dependencias o secuencias de arranque.
- Actualiza `BASE_DE_DATOS.md` junto con toda modificación de esquema o migración.
- Actualiza `SEGURIDAD_Y_PRIVACIDAD.md` antes de introducir red, nube, analítica o nuevos datos sensibles.
- Añade o modifica pruebas y registra el alcance en `PRUEBAS_Y_CALIDAD.md` cuando aparezcan nuevas reglas financieras.

- Añade una fila al historial de fases con el estado real de cada documento de fase nuevo (`docs/<tema>-fase<id>.md`).

Fecha de revisión integral: **27 de septiembre de 2026**. Historial de fases completado el 12 de noviembre de 2026; los documentos generales no se revisaron entonces.
