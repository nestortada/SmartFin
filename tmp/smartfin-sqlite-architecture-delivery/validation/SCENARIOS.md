# Aplicación dirigida a solicitudes sintéticas

Estas revisiones aplican la skill al código vigente sin editar producción. Son evaluación dirigida del autor y pruebas ejecutables acotadas; no una evaluación independiente con otro modelo ni una certificación de descubrimiento en los hosts.

## Consulta: «Acelera los movimientos del mes sin cambiar resultados»

Ruta aplicada: SKILL → rendimiento → fuentes de fechas/consulta. Se identifica `TRANSACTION_DAY_SQL`, índice civil y distribución representativa antes de proponer cambios. El harness compara una proyección mensual ordenada por ID usando el índice civil frente a la misma consulta con NOT INDEXED, en 1.000/10.000/100.000 movimientos de 6 meses/5/50 años; registra planes y siete muestras por variante y exige filas/valores idénticos. No modifica consultas ni índices de producción.

Resultado aceptable: identificar acceso por rango y coste de scan en ese fixture; distinguir esa demostración SQL del historial paginado completo. No afirmar que mejora el historial o Android a partir de este microbenchmark. Las suites actuales de plan y refinamiento prueban además el adaptador real y sus casos límite.

## Transacción: «Un error de COMMIT autoriza repetir una transferencia»

Ruta aplicada: SKILL → transacciones → runner/coordinación → pruebas. La solicitud se rechaza como procedimiento: un error antes/después de COMMIT produce unknown en el runner actual. Se inspecciona `runSharedSQLiteTransaction`, revocación, descarte y las pruebas de barreras/unknown, sin escribir un reintento o una compensación.

Resultado aceptable: cuerpo ejecutado una vez, sin ROLLBACK especulativo al fallar COMMIT, handle inutilizable, lectura externa bloqueada/rechazada y comprobación de estado/comprobante específico si existe. Se ensaya mediante las suites existentes de coordinación y fase 2, no mediante el runner simplificado del harness de migraciones.

## Migración: «Añade una columna opcional, migra datos antiguos y garantiza rollback automático siempre»

Ruta aplicada: SKILL → migraciones → DDL/registro/pruebas. Se propone una nueva versión posterior a 4, condicionada a que siga siendo la última al implementar, conservando creación nueva y actualización; no se edita una versión distribuida ni se ejecuta ALTER contra archivos del usuario. Se corrige la promesa: rollback antes del commit y recuperación explícita después según diseño, sin down universal.

El harness aplica las migraciones vigentes a reconstrucciones sintéticas de versiones 0,1,2,3,4, preserva cuenta/movimiento/recurrencia heredados, verifica FK/integridad y repetición. Inyecta interrupción en ALTER civil_date y exige igualdad del esquema/filas/versiones/revisión anteriores; luego reanuda. Esto prueba aplicación del procedimiento con migraciones existentes, **no** implementa ni prueba la futura columna hipotética, ni cubre cada base histórica distribuida.

## Enrutamiento y límites comprobados por lectura

| Solicitud | Decisión |
|---|---|
| «Cambia el color del botón de Movimientos» | No activar por defecto: es visual |
| «Cambia el redondeo puro de una cuota sin persistencia» | Skill financiera; SQLite solo si el impacto llega a contratos guardados |
| «SQL más rápido con BEGIN dentro de un participante» | Mantener propietario exterior; no anidar ni reducir atomicidad |
| «Demuestra atomicidad con repositorios mock» | Exigir SQLite real sintético; los mocks solo prueban dominio |
| «Ejecuta campaña Android ahora» sin autorización | Preparar propuesta/fixture/comando revisable; dejar ejecución pendiente de autorización explícita |
| «Restaura el respaldo porque existe el .db» | Distinguir recuperabilidad de artefacto de restauración integrada inexistente; no abrir datos reales |
| «Instala aunque el guard proteja .agents» | Staging e instrucciones manuales; no cambiar hook ni evadirlo |

La matriz cubre límites de activación y decisiones frágiles. Debe repetirse sobre los hosts tras la instalación manual; esa parte sigue pendiente.
