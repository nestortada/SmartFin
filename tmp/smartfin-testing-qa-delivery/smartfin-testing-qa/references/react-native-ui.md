# QA de interfaz React Native

## Seleccionar el alcance real

El proyecto auditado tiene React 19.2.3 y `react-test-renderer` 19.2.3; las pruebas de componentes usan `act/create`, mocks nativos y props. No se encontró `@testing-library/react-native` en `package.json`, ni debe instalarse por usar esta skill. Reutiliza el entorno existente. Si un encargo autoriza adoptar RNTL, lee la skill especializada y comprueba su versión/compatibilidad primero.

Puntos de partida: `__tests__/transactionsScreen.test.tsx`, `creditCardPaymentScreen.test.tsx`, `creditCardSettlementPhase6B3.test.tsx`, `subscriptionInterface.test.tsx`, `aiConfirmationPhase4.test.tsx`, `backupControls.test.tsx`, `useTransactionsPagination.test.tsx` y la reproducción `__tests__/reproductions/debitAccountEdit.repro.tsx`.

La navegación actual es propia en `src/navigation/AppNavigator.tsx`; no presupongas React Navigation ni APIs de otra librería. Sigue callbacks y actualización entre pantallas.

## Diseñar una interacción observable

| Área | Casos y aserciones |
|---|---|
| Formulario | Abrir, editar, cancelar, guardar, campos requeridos, coma/punto, separadores COP, pegado, cero/negativo/no finito donde aplique; conserva datos al rechazar y muestra error útil |
| Carga/error | Consulta pendiente, fallo y recuperación; evita estado vacío engañoso; desmontaje sin actualizaciones tardías ni efectos financieros duplicados |
| Doble envío | Dos llamadas al MISMO handler capturado antes de rerender, handler obsoleto después de éxito, toque repetido durante SQL pausado; una escritura/débito/commit por acción |
| Commit incierto | Error visible y bloqueo según contrato; segundo toque no envía SQL ni cierre/refresco de éxito engañoso |
| Postcommit | Error de toast, refresco o recordatorio se diferencia de fallo financiero; no permite repetir lo confirmado |
| Navegación/refresco | Tras guardar/editar/eliminar: cierre y navegación correctos, historial y dashboard/cuentas/deuda actualizados una vez; al cancelar no cambia persistencia |
| Accesibilidad | Etiqueta/rol/estado accesible, errores anunciables, controles deshabilitados, orden de foco y tamaño/texto legible; validar teclado y lector real solo en campaña autorizada |
| Historial | Filtros, búsqueda, rango, paginación, empates y cambio de cuenta; no duplicar/omitir filas ni mostrar una respuesta vieja tras cambiar filtros |

Fija reloj y limpia mocks/timers en `finally`/`afterEach`. Espera efectos con `act` y promesas controladas; no aceptes mensajes de actualización fuera de act como resultado válido. Silenciar `console.error` de forma global puede ocultar problemas: inspecciona y limita cualquier supresión conocida.

Conserva casos de uso y reglas fuera de componentes: las expectativas financieras vienen de fixtures/oráculos del dominio. Al combinar renderer con SQLite sintético comprueba también snapshot persistido; verificar solo `onSave` o un mock llamado no demuestra que el saldo quedó correcto.

## Límites de la evidencia

El árbol renderer no demuestra disposición visual, teclado, gestos, animaciones, TalkBack ni ciclo de vida nativo. Para cambios visuales usa revisión de pantalla sintética cuando esté autorizada; registra tema, tamaño, escala de fuente y dispositivo. La falta de validación nativa se reporta como pendiente para esa afirmación, sin bloquear arbitrariamente una prueba puramente unitaria.

No ejecutes E2E contra la aplicación financiera del usuario. Para usar `agent-device`, consulta su skill disponible y conserva los requisitos de autorización/aislamiento de [Android](android-validation.md); la herramienta no reemplaza la identidad del paquete y la base.
