---
name: smartfin-testing-qa
description: Diseña, ejecuta y evalúa QA de SmartFin con Jest, React Native, SQLite y Android; reproduce defectos y valida regresiones financieras, atomicidad, concurrencia o rendimiento con datos sintéticos y evidencia protegida. Úsala para pruebas, revisión de cobertura o criterios de aceptación; no para cambios solo documentales o visuales sin una tarea de QA.
---

# Pruebas y QA de SmartFin

Esta skill guía el trabajo del agente. No es un hook, no ejecuta pruebas al cargarse ni concede permisos de instalación, dispositivo o acceso a datos.

## Preparar el alcance

1. Localiza la raíz con `AGENTS.md` y `package.json`; lee también `CLAUDE.md` y el estado/diff local. Todas las rutas de proyecto en las referencias parten de esa raíz. Los enlaces entre archivos de la skill parten de la propia skill, incluso en staging.
2. Define comportamiento esperado, cambio autorizado, entidades afectadas y plataforma que se pretende acreditar. Conserva cambios locales y separa defectos previos del encargo.
3. Consulta las secciones pertinentes de `docs/ARQUITECTURA.md`, `docs/BASE_DE_DATOS.md` y `docs/PRUEBAS_Y_CALIDAD.md`; contrasta con implementación, fixtures, configuración y pruebas vigentes. No conviertas una caracterización histórica en una regla de aceptación.
4. Antes de ejecutar, aplica [estrategia y aislamiento](references/testing-strategy.md): descubrimiento real de suites, efectos secundarios, protección de evidencias y nivel por riesgo. La ausencia de una suite o un caso omitido no acredita éxito.

## Elegir el procedimiento

Lee solo las referencias relevantes:

| Necesidad | Referencia |
|---|---|
| Selección de suites, comandos, niveles 1–4 y seguridad | [Estrategia de pruebas](references/testing-strategy.md) |
| Cálculos, importes, fechas, transferencias, tarjetas, compartidos y suscripciones | [Regresión financiera](references/financial-regression.md) |
| Repositorios, fallos por escritura, commit incierto, recuperación o carreras | [Atomicidad SQLite](references/sqlite-atomicity.md) |
| Formularios, navegación, doble envío, actualización o accesibilidad | [UI React Native](references/react-native-ui.md) |
| Driver, Kotlin, APK, emulador o dispositivo | [Validación Android](references/android-validation.md) |
| Consultas, paginación, memoria, lectores o grandes historiales | [Rendimiento representativo](references/performance-testing.md) |
| Evidencia, limitaciones y decisión de aceptación | [Informe y aceptación](references/reporting-and-acceptance.md) |

## Corregir un defecto con evidencia

1. Especifica el resultado esperado y su fuente: requisito, contrato vigente o diferencia funcional autorizada.
2. Reproduce con fixture sintético, fecha/semilla controladas y evidencia observable.
3. Crea o identifica una prueba que falle por ese defecto. Comprueba que ejecuta el código afectado y falla por la aserción adecuada, no por infraestructura.
4. Ejecútala antes de editar producción cuando sea seguro. Si no puede ejecutarse, explica el bloqueo y deja el resultado como pendiente; no inventes un rojo previo.
5. Determina la causa raíz siguiendo entradas, casos de uso, repositorios y efectos derivados.
6. Implementa la corrección mínima dentro de la autorización vigente. Una solicitud de auditoría no autoriza reparar producción.
7. Repite la prueba y verifica el resultado persistido/visible, no solo la resolución de una promesa.
8. Ejecuta regresiones relacionadas según riesgo y comprueba efectos secundarios entre módulos.
9. En reproducciones con `test.failing`, conserva por separado caracterización y aceptación: tras la corrección autorizada, promueve el caso de aceptación a regresión normal y explica la retirada de expectativas del defecto.
10. Documenta resultados, diferencias financieras, omisiones y límites usando el informe. No declares corregido porque cambió el código ni ajustes expectativas para ocultar fallos.

## Colaborar sin duplicar responsabilidades

- `smartfin-financial-domain` determina reglas y deltas financieros; cárgala cuando se evalúen esos efectos. Sus observaciones históricas deben contrastarse con el código actual.
- `smartfin-sqlite-architecture` determina contratos de persistencia y límites transaccionales; cárgala para repositorios, concurrencia, esquema, recuperación o driver. Esta skill organiza escenarios y evidencia, no redefine esos contratos.
- Localiza las skills en las rutas descubiertas por cada agente; no presupongas igualdad entre copias. Si falta una referencia necesaria, consulta el código/documentación y comunica la limitación sin instalarla implícitamente.
- Verifica el estado real de `financial-integrity-guard` antes de atribuirle selección automática o evidencia. En la auditoría de 2026-11-01 no se encontró implementado en las rutas de proyecto inspeccionadas.
- `dangerous-command-guard` protege comandos. Conserva sus decisiones; no lo desactives, no cambies hooks/permisos/configuración ni uses otra herramienta para evadir una denegación. Si impide instalar la skill, entrega staging e instalación manual.

## Cerrar con alcance explícito

Una suite verde acredita únicamente los casos efectivamente ejecutados y sus aserciones. Separa Node, mocks nativos, evidencia Android histórica y ejecución Android nueva. No ejecutes campañas Android ni volumen extremo por cambios menores. Usa exclusivamente datos sintéticos, protege evidencias previas y termina con uno de los cuatro veredictos definidos en [informe y aceptación](references/reporting-and-acceptance.md).
