# Informe, evidencia y aceptación

## Plantilla de informe

Completa los campos con resultados observados; usa «no medido/no ejecutado» si corresponde.

```text
Objetivo y comportamiento esperado:
Funcionalidad, archivos/símbolos y revisión/diff evaluados:
Alcance autorizado; nivel de riesgo y plataformas:
Entorno: SO, Node, RN/Jest, SQLite/driver/ICU; Android/ABI/APK si aplica:
Fixture sintético: origen, semilla, reloj, zona, fechas, volumen/distribución:
Aislamiento: base/temporal, destino nuevo de evidencia, hashes inicial/final:
Método y oráculo independiente; fuente histórica si se compara:
Comandos exactos, configuración, variables, duración y código de salida:
Casos previstos y realmente ejecutados:
  Aprobados:
  Fallidos por comportamiento:
  Omitidos por skip/condición (motivo):
  No ejecutados (motivo):
  Errores de infraestructura:
  Todo/pendientes de diseño, si existen:
Caracterizaciones y test.failing: defecto que sigue reproduciéndose:
Diferencias financieras: tabla/cuenta/periodo, esperado, real y delta exacto:
Atomicidad: puntos antes/después, BEGIN/COMMIT/ROLLBACK y resultado:
Rendimiento: muestras, equivalencia, consultas/filas/memoria/esperas:
Evidencias nuevas y evidencia histórica consultada (rutas + hashes):
Efectos secundarios; preservación de cambios y evidencia previa:
Riesgos, excepciones, cobertura ausente y autorización pendiente:
Veredicto y justificación dentro del alcance:
```

Cuenta suites y casos por separado; no sumes un `test.failing` aprobado como aceptación funcional normal. Distingue skip de filtro (`--testNamePattern`), caso condicionado, archivo no descubierto, dependencia ausente, timeout y test.todo. Si hubo un fallo inesperado, informa aunque el comando final sea verde. Un error de infraestructura no se registra como un defecto financiero demostrado.

## Veredictos

| Veredicto | Cuándo corresponde |
|---|---|
| Validado para el alcance probado | Se ejecutaron las verificaciones necesarias para las afirmaciones concretas, con oráculos correctos, sin diferencias inesperadas ni riesgos bloqueantes dentro de ese alcance |
| Validado con excepciones documentadas | Hay evidencia suficiente del alcance indicado y excepciones explícitamente compatibles con sus criterios; las áreas excluidas no se presentan como aprobadas |
| No validado | Falla un criterio requerido o la evidencia contradice la garantía reclamada; identifica el fallo concreto |
| Pendiente de evidencia | No se pudo ejecutar o falta una prueba necesaria por entorno, autorización, dato sintético o aislamiento; no equivale a fallo del producto ni a éxito |

Un informe puede tener veredicto global y por plataforma. No uses «con excepciones» para aceptar un rollback parcial, una diferencia monetaria no autorizada o un driver Android no ensayado cuando esa garantía sea el objetivo.

## Criterios mínimos de cierre según el cambio

- Corrección: defecto reproducido con rojo significativo cuando fue seguro, verde posterior y regresiones relacionadas; explica si el rojo previo no estuvo disponible. Nunca basta el diff.
- Refactorización/optimización: equivalencia financiera y referencial exacta del alcance; cambios de orden/precisión o predicados requieren resolver diferencias, no tolerancias inventadas.
- Persistencia: estado completo, FK, puntos de fallo y resultados inciertos/carreras según riesgo; no basta comparar saldo final agregado.
- UI: interacción/estados observados y confirmación financiera cuando el flujo escribe; límites renderer frente a dispositivo explícitos.
- Android: identidad/APK/UID/base y atestación, campaña realmente ejecutada y evidencia nueva; Node no sustituye driver.
- Documentación/skill: frontmatter, enlaces, rutas, comandos, simulación de decisiones y preservación de fuentes; descubrimiento esperado separado de carga efectiva en agente.

No alteres snapshots/JSON de referencia ni expectativas para obtener verde. Una excepción histórica necesita fuente, alcance y riesgo documentados; no se hereda automáticamente a una operación actual.
