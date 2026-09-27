# Pruebas y calidad

## 1. Estado verificado

Al 27 de septiembre de 2026:

| Verificación | Resultado |
|---|---|
| `npm test -- --runInBand` | 13 suites, 51 pruebas aprobadas |
| `npx tsc --noEmit` | Sin errores |
| `npm run lint` | Sin errores ni advertencias reportadas |

No existe todavía una configuración de cobertura mínima ni un pipeline de integración continua en el repositorio.

## 2. Inventario de pruebas

| Archivo | Alcance |
|---|---|
| `saveManualTransaction.test.ts` | Gastos débito, cuotas, transferencias, 4x1000 y edición |
| `transactionAccountFilter.test.ts` | Visibilidad de patas de transferencias por cuenta |
| `debitCardManagement.test.ts` | Alta y cierre lógico de cuenta débito |
| `debitCardsOverview.test.ts` | Métricas mensuales y tendencia semanal |
| `creditCardsOverview.test.ts` | Cupo, extracto, interés, cuotas y restricciones de cierre |
| `creditCardTransactionRelations.test.ts` | Deuda, extractos, pagos, ciclos y tarjetas sin clasificar |
| `creditCardRepository.test.ts` | Lectura SQLite de tarjetas, perfiles, extractos y cuotas |
| `creditCardFormatters.test.ts` | Entrada y presentación de tasas decimales |
| `categoryManagement.test.ts` | Alta, edición, duplicados, protección y reasignación |
| `settingsRepository.test.ts` | Valores por defecto y persistencia de tema |
| `manageSecurity.test.ts` | PIN, biometría y fallback |
| `driveBackupService.test.ts` | Validación de respuestas del módulo nativo |
| `financialDataRepository.test.ts` | Borrado de dominio conservando ajustes |

## 3. Pirámide actual

La mayor parte son pruebas unitarias de casos de uso y pruebas de repositorio con dobles de la interfaz SQLite. Esto ofrece buena velocidad y cobertura de reglas críticas, pero no verifica por sí solo:

- renderizado e interacción de pantallas;
- ejecución real sobre SQLite nativo;
- ciclo completo de módulos Kotlin;
- comportamiento en dispositivo y permisos del proveedor Drive;
- arranque, migraciones y reanudación del proceso;
- accesibilidad visual y lectores de pantalla.

## 4. Casos que deben conservarse

Las siguientes invariantes requieren prueba ante cualquier refactor:

- editar un movimiento revierte su impacto anterior antes de aplicar el nuevo;
- una transferencia mueve saldo sin aumentar el gasto mensual;
- el 4x1000 es un gasto separado y reversible;
- una compra a crédito aumenta deuda por el total, pero una cuota activa aporta el mensual al extracto;
- un pago de tarjeta reduce la deuda y la cuenta de origen, sin crear gasto;
- no se cierra una tarjeta con deuda, cuotas o movimientos sin liquidar;
- eliminar una categoría reasigna referencias a `Otros`;
- borrar datos financieros no borra preferencias;
- un fallo biométrico puede caer a PIN sin conceder acceso;
- datos nativos mal formados se rechazan.

## 5. Estrategia para pruebas nuevas

### Caso de uso

- Inyecta repositorios y fecha actual.
- Prueba camino feliz, límites, error y edición/reversión.
- Comprueba tanto el resultado como las escrituras realizadas.
- Evita depender de `Date.now()` sin controlar cuando el identificador sea relevante.

### Repositorio

- Prueba filas completas, nulos opcionales y colecciones vacías.
- Verifica sentencias y parámetros, no solo el valor devuelto.
- Añade una prueba de integración SQLite cuando haya migraciones o restricciones complejas.

### Servicio nativo

- Simula ausencia del módulo y métodos opcionales.
- Rechaza formas incorrectas provenientes de `unknown`.
- Verifica el comportamiento fuera de Android.
- Completa con una prueba manual en dispositivo para permisos, UI del sistema y ciclo de vida.

### UI

Se recomienda añadir React Native Testing Library para formularios y estados de error, y una herramienta E2E para los recorridos críticos. No debe introducirse solo para una prueba aislada: primero define una base reutilizable y estable.

## 6. Matriz manual de aceptación

Antes de una versión candidata:

| Área | Escenario mínimo |
|---|---|
| Arranque | Base nueva crea esquema y muestra dashboard |
| Persistencia | Reiniciar mantiene movimientos, cuentas y tema |
| Movimiento débito | Gasto reduce saldo y aparece en el mes |
| Ingreso | Aumenta saldo e ingreso mensual |
| Transferencia | Origen baja, destino sube y gasto no cambia |
| Crédito | Compra aumenta deuda y cupo usado |
| Cuotas | Muestra total, mensual y progreso correcto |
| Pago tarjeta | Debita origen y reduce deuda sin gasto |
| Categorías | Crear, editar y eliminar reasigna a `Otros` |
| Seguridad | PIN incorrecto falla; correcto desbloquea; reentrada bloquea |
| Biometría | Cancelar no concede acceso; éxito desbloquea |
| Respaldo | Crea todos los archivos y detecta una revisión posterior |
| Borrado | Elimina finanzas, conserva ajustes y reinicia saldos |
| Tema | Claro/oscuro persiste tras reinicio |

## 7. Calidad recomendada antes de merge

```sh
npm test -- --runInBand
npx tsc --noEmit
npm run lint
```

Además:

- revisa el diff para evitar archivos generados o secretos;
- prueba manualmente si cambias UI, Kotlin, esquema o permisos;
- actualiza documentación y datos demo afectados;
- no aceptes una nueva regla financiera sin prueba automatizada;
- no marques una capacidad como implementada si solo existe su tabla.

## 8. Deuda de calidad priorizada

1. Añadir CI para test, TypeScript y lint.
2. Añadir cobertura y umbrales graduales para `useCases` y repositorios.
3. Añadir pruebas de migración sobre SQLite real.
4. Añadir pruebas de componentes para formularios críticos.
5. Añadir E2E Android para movimiento, pago, bloqueo y respaldo.
6. Añadir matriz de dispositivos y versiones Android soportadas.
