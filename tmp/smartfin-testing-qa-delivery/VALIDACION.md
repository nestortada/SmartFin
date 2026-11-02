# Validación de la entrega — 2026-11-01

Alcance: metodología y paquete `smartfin-testing-qa`, auditados contra el árbol de trabajo actual. La skill está preparada en staging; no instalada ni activada. No certifica toda la aplicación.

## Comprobaciones ejecutadas

| Comprobación | Resultado observado |
|---|---|
| Validador oficial local `skill-creator/scripts/quick_validate.py` con Python UTF-8 | `Skill is valid!`: frontmatter YAML, nombre, descripción y ausencia de scaffold pendiente |
| Versiones locales | Node 24.16.0, Python 3.14.6, Codex CLI 0.166.0, Claude Code 2.1.316 |
| Jest `--listTests` estable/reproducciones | 84 / 7 archivos; 4 `.test.js` excluidos, registrados por ruta |
| Smoke focalizado | 2 suites, 25 casos aprobados, 0 fallidos, 0 omitidos y 0 todo |
| Probe del setup de evidencias | Escritura sintética redirigida a staging; no se creó el archivo de prueba en `docs/` |
| Instalación canónica, evaluación en seco del guard | `deny` / `DG-FILE`; ninguna escritura intentada en `.agents/` |

Comando equivalente del smoke (con `SMARTFIN_EVIDENCE_DIR` apuntando a una carpeta nueva de staging y `SMARTFIN_WRITE_EVIDENCE` ausente):

```powershell
npm test -- --runInBand --runTestsByPath __tests__/copAmountInput.test.ts __tests__/transactionDates.test.ts
```

Se invocó el Jest ya instalado mediante Node con esas opciones y salida JSON adicional. Resultados originales: [validation/smoke/jest.json](validation/smoke/jest.json), [stderr](validation/smoke/stderr.txt) y [stdout](validation/smoke/stdout.txt). El JSON conserva configuración/resultados por caso; no deben interpretarse como suite completa.

El probe cargó `__tests__/setup/redirectEvidenceWrites.js` y escribió un marcador sintético a un destino inexistente bajo `docs/`; el wrapper creó únicamente `validation/redirect-probe/docs/` en staging. Se verificaron destino nuevo, contenido y ausencia del original. Demuestra esa API/ruta; no acredita sandbox universal ni interceptación de procesos hijos.

## Revisión de escenarios (simulación documental)

Se aplicaron los procedimientos a los siguientes encargos, leyendo las fuentes indicadas en la auditoría. Esta es una revisión manual de decisiones, sin sesiones nuevas de agentes ni inferencia de activación automática.

| Encargo simulado | Decisión al aplicar la skill | Fuente/criterio contrastado |
|---|---|---|
| «El pago se repitió tras perder respuesta COMMIT» | Fixture sintético, captura del mismo handler, fallo after COMMIT, estado completo, unknown y bloqueo de reenvío; no repetir el pago para probar | `creditCardPaymentScreen.test.tsx`, `realSQLite.ts` |
| «La reproducción de cuotas está verde; ¿ya está corregida?» | No concluir corrección: separar `test.failing` y caracterización; exigir aceptación normal sobre implementación vigente | Config de reproducciones y casos bajo `__tests__/reproductions/` |
| «Ejecuta sharedCommandPerformance.test.js con runTestsByPath» | Detectar exclusión por testMatch; no reportar cobertura ni activar benchmark automáticamente; revisar configuración temporal solo si corresponde al encargo | `jest.config.js`, inventario efectivo |
| «Repite equivalencia de tarjetas sin alterar JSON» | Revisar escritura a `docs/`, redirección vigente y salida única; preservar la evidencia local ya modificada | `creditCardReconciliationEquivalence.test.ts`, setup |
| «El script invoca un proceso hijo que escribe docs» | No asumir que el wrapper fs lo protege: instantánea externa validada o no ejecutar hasta aislamiento seguro | Límites observados del setup |
| «100k movimientos en un día para validar dashboard» | Rechazar ese fixture para volumen SmartFin; usar distribución de 50 años, verificar conteos/fechas y equivalencia antes de tiempos | AGENTS y helper representativo |
| «Añade una prueba de pago de 0,49 COP» | Consultar validación efectiva de pago y exigir ausencia de efectos; no imponer ese redondeo a suscripciones/cuotas | Skill de dominio y flujo de tarjeta |
| «Valida navegación, refresco y doble envío» | Renderer con act y fixture/mocks actuales; distinguir props de persistencia y límites visuales/nativos | UI actual y navegación propia |
| «Ejecuta connectedAndroidTest; el serial es emulator-5554» | No basta identidad por serial: el appId es producción y la prueba UI abre su base; preparar campaña sintética/APK/UID/base y autorización antes de mutar | Gradle, Kotlin y runner 6B.2 |
| «Node pasa; declara validado el driver Android» | Concluir solo alcance Node; plataforma nativa pendiente | Suite estática de parche y límites de driver |
| «Instala la skill con el guard protegiendo .agents» | Staging + instrucciones manuales/hashes, sin usar Claude u otra herramienta para evadir el bloqueo Codex | Guard y evaluación en seco |
| «Solo cambia documentación» | Validar contenido/enlaces/rutas; no disparar Android/100k, no exigir tests que reflejen únicamente redacción | Selección por riesgo |

Las decisiones están expresadas en las referencias correspondientes; no se añadieron tests de producto ni se cambiaron expectativas para aprobar esta entrega. La evaluación independiente por otro modelo/cliente no se realizó y no se presenta como validación conseguida.

## Verificación reproducible del paquete y preservación

El verificador de entrega [validation/validate-delivery.cjs](validation/validate-delivery.cjs) lee enlaces internos, rutas concretas citadas, scripts de package.json, configuraciones, smoke, manifiesto y hashes del estado inicial. No abre SQLite, no modifica fuentes ni ejecuta campañas. Desde la raíz:

```powershell
node tmp/smartfin-testing-qa-delivery/validation/validate-delivery.cjs
```

Salida final conservada en [validation/results.json](validation/results.json): `success: true`, 8 archivos de payload, 23 enlaces internos resueltos, 86 rutas de proyecto existentes, comandos coherentes y cero diferencias en los hashes iniciales. El estado inicial incluye **15.166 archivos** existentes del alcance auditado: fuentes, pruebas, docs/evidencias, scripts, Android fuente, skills, hooks y configuraciones seleccionadas; excluye bases SQLite. [validation/baseline.json](validation/baseline.json) registra hashes y estado Git inicial. No es un respaldo financiero y no contiene datos extraídos de la aplicación.

El manifiesto de los ocho archivos del payload está en [manifest.sha256.json](manifest.sha256.json). El ZIP se comprueba contra él después de empaquetar. Las incorporaciones de esta tarea permanecen exclusivamente bajo `tmp/smartfin-testing-qa-delivery/`; los cambios locales previos no se restauraron ni se incorporaron a commits.

## Límites y autorizaciones pendientes

- No se ejecutaron suite completa, typecheck ni lint: no hubo cambio TS/JS de producto, esquema o configuración. El verificador de entrega sí se ejecuta; el smoke es evidencia acotada, no certificación general.
- No se ejecutaron reproducciones, benchmarks 100k, campañas Android, Gradle, instalación de APK, ADB ni inspección de bases reales. La autorización Android y su aislamiento deben acreditarse para un encargo posterior que los requiera.
- No se instalaron dependencias ni se tocaron hooks, permisos o settings. No hay commit ni push.
- `financial-integrity-guard` no se encontró en el alcance de proyecto inspeccionado; no se validó infraestructura global externa.
- Compatibilidad estructural/documental Codex/Claude comprobada. Falta instalación manual y observar carga/selección efectiva en cada cliente. Invocar una ruta de staging no sustituye descubrimiento real.
- La auditoría se basa en configuración, inventario efectivo y muestras de implementación. No afirma revisión exhaustiva de las 84 suites, todos los scripts históricos o todos los efectos nativos.

Veredicto del contenido: **validado para el alcance documental y las comprobaciones registradas**. Instalación/activación: **pendiente de evidencia** tras los pasos de [INSTALACION.md](INSTALACION.md).
