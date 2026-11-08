# Plantilla de documento de fase

Ejemplos reales que siguen esta estructura: `docs/revision-inicial-fase1a4A.md`, `docs/abonos-extraordinarios-fase1a4B.md` y `docs/persistencia-imputaciones-fase1a3B.md`. Ábrelos si dudas del nivel de detalle esperado.

Nombre del archivo: `docs/<tema-en-español>-fase<id>.md` (por ejemplo, `abonos-extraordinarios-fase1a4B.md`). Escribe en español, con importes de datos sintéticos y cifras reales de las ejecuciones.

```markdown
# Fase <id>: <título breve>

<Fecha>, America/Bogota. Rama `<rama>`, commit base `<hash>` («<mensaje>»), <árbol limpio | cambios ajenos conservados: …>.
<Sin commit ni push | commit `<hash>`>. Validación Android <no requerida | preparada, no ejecutada | aprobada en …>.

## 1. Estado inicial

- Qué contiene el commit base y qué validó la fase anterior (cifras). Esa línea base no valida este código.
- Piezas existentes relevantes y sus llamadores reales.

## 2. Reproducción del comportamiento anterior (datos sintéticos)

| # | Comprobación | Resultado antes del cambio |
|---|---|---|

Conclusión: qué exige cambiar y qué no (esquema, migración, triggers).

## 3. Decisión

Alcance elegido y motivo. Opciones descartadas, si las hubo.

## 4. Diseño

Archivos y funciones nuevas o modificadas, flujo paso a paso dentro de la transacción y forma del resultado.

## 5. Rutas afectadas

Matriz de rutas de edición y borrado: operación, comportamiento antes, comportamiento después, cumple o no.

## 6. Invariantes financieros

Flujo comparado con y sin el cambio; qué es idéntico y qué difiere exactamente.

## 7. Atomicidad, recuperación e idempotencia

Puntos de fallo inyectados (antes y después de cada escritura), COMMIT `unknown`, reapertura y repetición del comando.

## 8. Cambios realizados

Lista de archivos con una línea cada uno. Lo que explícitamente no cambió (esquema, migraciones, UI, reglas contables).

## 9. Efectos sobre validaciones anteriores

Qué campañas o suites históricas siguen siendo válidas y cuáles quedan desactualizadas por este cambio.

## 10. Validación Android

Plan de campaña (o enlace a `docs/validacion-fase<id>/README.md`) y estado: no requerida, preparada o aprobada.

## 11. Riesgos y decisiones pendientes

Lista numerada. Cada punto que requiera al propietario se marca como «confirmar con el propietario».

## 12. Resultados de verificación y siguiente etapa

| Verificación | Resultado |
|---|---|
| Suite de la fase | n/n |
| `npm test -- --runInBand` | suites y pruebas aprobadas, omitidas y fallidas |
| `npm run test:reproductions -- --runInBand` | n/n |
| `npm run typecheck` | Sin errores |
| `npm run lint` | errores y advertencias |
| `git diff --check` | Limpio |

Siguiente etapa (no iniciada): …
```

Cuando una fase se valida o corrige más tarde, añade una sección fechada al final («Validación Android rN: aprobada», «Corrección de regresiones») en lugar de reescribir el historial del documento.
