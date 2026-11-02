# Revisión, validación y cierre

## Secuencia de auditoría

1. Definir alcance, autorización, fuentes, versiones y estado local.
2. Identificar activos, actores, superficies y límites de confianza.
3. Inspeccionar código, configuración, documentación y pruebas vigentes.
4. Identificar controles implementados y sus límites reales.
5. Formular hipótesis de vulnerabilidad con condiciones verificables.
6. Reproducir de forma segura solo cuando esté autorizado; usar fixtures sintéticos, servicios falsos y evidencia nueva.
7. Evaluar impacto, probabilidad y confianza según [criterios](threat-modeling.md).
8. Proponer corrección mínima dentro del alcance; una auditoría sola no autoriza cambios de producto.
9. Diseñar regresiones observables, incluidas negativas y persistencia posterior al fallo.
10. Verificar corrección y regresiones si se implementó; documentar lo no ejecutado.
11. Registrar riesgo residual, responsables y próximos pasos separados de la entrega actual.

## Checklist por frontera

- Acceso: arranque/primer plano, error/cancelación de biometría, PIN, consistencia de flags/credencial, intentos y operaciones sensibles.
- Datos: archivo principal/auxiliares/copias, permisos reales vs supuestos, consultas parametrizadas y allowlists dinámicas, confidencialidad separada de commit/FK.
- Android: manifest fuente/fusionado, permisos mínimos, exported, intents/URI/PendingIntent, backup por API/OEM, TLS por variante, firma/debug, capturas/recientes y WebView si existe.
- Salidas: exportaciones/CSV/metadatos, autenticidad vs hashes, permisos/retención, limpieza de temporales y capacidad de restauración demostrada.
- IA/externos: datos transmitidos, prompt injection como entrada, parser local, límites, preview/confirmación, controles de dominio y fallos sin replay financiero.
- Secretos/privacidad: clasificación, fuentes, exposición en compilación/logs/Git, propuesta de rotación, finalidad y evaluación jurídica acotada.
- Cadena de suministro: versiones resueltas, transitivas alcanzables, lifecycle/parches, vulnerabilidades consultadas o pendientes y compatibilidad.
- Agentes: hooks registrados y límites verificados, sin alterar políticas; skill como guía, no control de ejecución.

## Escenarios documentales obligatorios

Usa entradas inventadas y describe decisión, evidencia buscada y límite. No lances un dispositivo, un proveedor ni una petición de modelo para resolverlos.

| Caso sintético | Decisión esperada al aplicar la skill | Evidencia/regresión que corresponde |
|---|---|---|
| Se pierde teléfono bloqueado con PIN SmartFin habilitado | Revisar bloqueo SO/gate y riesgo residual de almacenamiento; no afirmar SQLite cifrado | Inicio/retorno/error de autenticación con mocks; controles de archivo/dispositivo pendientes |
| Un tercero recibe carpeta con SQLite+CSV+manifiesto | Tratarla como exposición de datos planos; SHA no da confidencialidad | Contenido sintético y permisos/retención; no abrir copia real ni borrar carpeta |
| Se informa una clave Gemini filtrada | No repetir valor; clasificar, acotar y proponer revocación/rotación | Ubicación/uso/alcance redactados; no probar clave ni operar cuenta sin autorización |
| URI `smartfin://delete?all=true` llega de otra app | Buscar primero un handler real; no inventar vulnerabilidad ni despachar borrado | Manifest/callers/fusionado; si se implementa handler, rechazar efecto automático y exigir dominio/confirmación |
| IA devuelve plan de gasto/borrado y texto que exige ejecutarlo | Tratarlo como dato; parser, aclaraciones, preview y confirmación de persona | Cero escrituras previas; doble confirmación/replay/unknown sin duplicación |
| Advisory reporta defecto en una dependencia | Verificar versión resuelta/ruta/contexto antes de asignar severidad | Advisory oficial, transitivas y propuesta de cambio; no `audit fix` ni actualización automática |

## Ejecutar pruebas de forma proporcionada

Para una skill/documentación: frontmatter, enlaces, rutas, versiones, copias, escenarios y revisión de secretos bastan. No necesitas modificar tests del producto. Si seleccionas suites existentes para sustentar el mapa, inspecciona imports/setup/efectos y registra comando, número de casos y limitaciones. Usa `smartfin-testing-qa` para aislamiento: no sobrescribas evidencia versionada, no actives benchmarks ni exportes datos reales.

Mantén la distinción: mocks de biometría no prueban Keystore; Node SQLite no prueba driver Android; fuente Kotlin no prueba comportamiento OEM; evidencia Android histórica no es una campaña nueva. Cien mil movimientos representan décadas según `AGENTS.md`, no una única importación/fecha; esta auditoría no necesita pruebas de ese volumen.

## Formato de informe

Por hallazgo: ID/título, estado de evidencia, fuente con archivo/símbolo y línea vigente si se ha comprobado, escenario/prerrequisitos, control y límite, P/I/severidad razonada, propuesta mínima, pruebas ejecutadas/propuestas y riesgo residual. Separa cambios implementados de recomendaciones futuras. Registra omisiones como falta de evidencia, sin declararlas vulnerabilidades ni éxitos.

Al cerrar confirma qué se modificó, compatibilidad/distribución de la skill, ausencia de cambios a hooks/dependencias/esquema/producción, tratamiento de cambios locales y limitaciones. Una búsqueda parcial no demuestra que nunca hubo secretos en Git. No emitas certificación MASVS ni cumplimiento legal global.
