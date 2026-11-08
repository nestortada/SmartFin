---
name: smartfin-phase-delivery
description: Protocolo de entrega de una fase de SmartFin (1a.5, migración 6, etapa C de restauración, correcciones por fase…): estado inicial, reproducción con datos sintéticos, decisión de alcance, implementación, invariantes, atomicidad, pruebas, revisores, documento de fase, índice y pendientes. Úsala siempre que el usuario pida implementar, corregir, auditar o cerrar una fase o etapa numerada, o redactar su documento en docs/, aunque no diga «fase» explícitamente; no para cambios sueltos de UI o de lint.
---

# Entrega de fases de SmartFin

SmartFin avanza por fases numeradas (1a.1, 1a.2, …, 5e6, 6b3, C1–C3A). Cada una deja código, pruebas y un documento de fase en `docs/` que sirve de evidencia para la siguiente. Este protocolo existe porque el propietario revisa cada fase por su documento: lo que no está medido y escrito no cuenta como hecho, y una afirmación sin evidencia obliga a repetir trabajo.

Aplica también las reglas de `AGENTS.md` y carga la skill de dominio que corresponda: `smartfin-financial-domain` si cambian importes o saldos, `smartfin-sqlite-architecture` para esquema, transacciones o driver, `smartfin-security-privacy` para respaldos, restauración o datos sensibles, y `smartfin-testing-qa` para diseñar las pruebas.

## 1. Estado inicial

Antes de tocar nada, registra:

- Fecha (America/Bogota), rama y commit base (`git log -1 --oneline`).
- Estado del árbol: limpio o con cambios ajenos. Los cambios ajenos se conservan; no los reviertas ni los incluyas en tu entrega.
- Línea base heredada: qué validó la fase anterior y con qué cifras (por ejemplo, «r5: 568/568 en API 24 y API 35»). Indica que esa línea base **no** valida el código nuevo.
- Documentos de partida: el de la fase anterior, `docs/pendientes-*` si existe y las decisiones del propietario que apliquen.

## 2. Reproducir antes de cambiar

Demuestra el comportamiento actual con datos sintéticos (sonda Node con SQLite en memoria o prueba de caracterización) y anótalo en una tabla «comprobación → resultado antes del cambio». Un defecto confirmado que todavía no se corrige va a `__tests__/reproductions/` con una prueba de caracterización y otra `test.failing` de aceptación.

Esto evita dos errores caros: arreglar algo que no estaba roto y no poder demostrar después qué cambió.

## 3. Decidir el alcance

Escribe la decisión y su motivo en pocas líneas. Detente y pide autorización explícita antes de:

- crear una migración, tabla, columna o trigger (las migraciones ya publicadas no se modifican; una nueva lleva el número siguiente);
- cambiar reglas contables vigentes, el driver SQLite, permisos Android o `BACKUP_PUBLICATION_UI_ENABLED`;
- ejecutar campañas en dispositivo o emulador;
- empezar la fase siguiente.

Si hay varias opciones, preséntalas con ventajas, costes y tu recomendación, y deja la decisión al propietario.

## 4. Implementar

Sigue la arquitectura de `AGENTS.md`: reglas en `useCases`, persistencia en repositorios, sin SQL en pantallas ni hooks. Una acción financiera es un único ámbito transaccional; los efectos de plataforma van después del COMMIT. Cambio mínimo: no arregles problemas ajenos al encargo, regístralos como pendientes.

## 5. Demostrar invariantes, atomicidad e idempotencia

- **Invariantes:** ejecuta el mismo flujo con y sin el cambio y compara saldos, deuda, cupo, patrimonio, ingresos, gastos, extractos y todas las tablas. Documenta exactamente qué difiere y por qué (por ejemplo, solo las filas de historial).
- **Atomicidad:** inyecta un fallo antes y después de cada escritura; tras el rollback, el estado completo debe ser idéntico. Cubre también el COMMIT con resultado `unknown`: conexión retirada, un solo intento, sin reintentar el cuerpo financiero.
- **Idempotencia:** repetir el mismo comando no escribe; un contenido distinto con el mismo identificador se rechaza.
- **Rutas afectadas:** si el cambio interactúa con edición o borrado, haz una matriz de rutas (editar importe, fecha, cuenta; borrar; cascadas) con el comportamiento antes y después.

## 6. Verificar con cifras reales

Crea o amplía la suite de la fase (`<tema>Phase<id>.test.ts`). Ejecuta y copia los resultados reales, sin redondear ni suponer:

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
npm run test:reproductions -- --runInBand
git diff --check
```

Si una prueba falla o se omitió, dilo con su salida. Si una cifra se obtuvo con una suite aislada y no con la suite completa, acláralo.

## 7. Pasar los revisores

Según los archivos tocados, invoca `financial-reviewer` (useCases, repositorios, SQL, migraciones), `android-native-reviewer` (`android/`, servicios de plataforma, `databaseCoordination.ts`) y `security-privacy-reviewer` (respaldo, restauración, exportación, autenticación, permisos). Corrige o registra cada hallazgo antes de cerrar.

## 8. Documentar

- Escribe `docs/<tema>-fase<id>.md` con la [plantilla de documento de fase](references/phase-document-template.md). Omite las secciones que no apliquen, pero nunca «Estado inicial», «Resultados de verificación» y «Riesgos y decisiones pendientes».
- Añade una fila a `docs/INDICE.md` con el estado real (implementada, validada en Node, Android preparada o aprobada).
- Aplica las reglas de mantenimiento de `docs/INDICE.md`: `BASE_DE_DATOS.md` con todo cambio de esquema, `ARQUITECTURA.md` si cambian límites, `PRUEBAS_Y_CALIDAD.md` con reglas financieras nuevas, `SEGURIDAD_Y_PRIVACIDAD.md` antes de añadir datos sensibles.
- Si quedan decisiones abiertas para la fase siguiente, escribe `docs/pendientes-fase<id>.md`: estado, hueco, opciones y decisión pendiente, sin implementar nada.

## 9. Validación Android

Las fases que cambian SQLite, transacciones o código nativo necesitan equivalencia Node–Android en API 24 y API 35. Prepara la campaña con la skill `smartfin-android-campaign` y déjala como «preparada, no ejecutada» hasta que el propietario la autorice.

## 10. Cerrar

Termina con un resumen honesto: qué cambió, qué se verificó (con cifras), qué no se verificó, qué queda pendiente y cuál es la siguiente etapa, indicando que no se ha iniciado. No hagas commit ni push salvo que el usuario lo pida.
