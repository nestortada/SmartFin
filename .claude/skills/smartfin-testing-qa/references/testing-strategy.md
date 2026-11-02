# Estrategia, descubrimiento y aislamiento

## Preflight reproducible

Desde la raíz, lee `package.json`, `jest.config.js`, `jest.reproductions.config.js`, `tsconfig.json`, `.eslintrc.js`, `.nvmrc` y cambios locales. Comprueba versiones y dependencias instaladas, sin instalarlas por usar esta skill. Referencia auditada: Node 24.16.0 (`>=24.16.0 <25`), React Native 0.85.3, React 19.2.3, Jest 29 y TypeScript estricto. Revalida si cambian esos archivos.

Comandos existentes y sin ejecución de casos para descubrir:

```powershell
node --version
npm test -- --listTests --runInBand
npm run test:reproductions -- --listTests --runInBand
```

`testMatch` estable solo incluye `**/__tests__/**/*.test.ts` y `.test.tsx`. Las reproducciones solo incluyen `.repro.ts/.repro.tsx`. `--runTestsByPath` NO evita los filtros del config. No uses `--passWithNoTests` para justificar cobertura. Para un `.test.js` excluido, documenta la ausencia; si el encargo requiere ejecutarlo, revisa sus efectos/fixture y usa una configuración temporal explícita con el mismo preset/setup y testMatch adecuado, sin modificar la configuración del usuario ni activarlo por accidente.

## Clasificar por lo que demuestra

| Clase | Qué ejecutar y observar |
|---|---|
| Unitaria | Función pura, importes, formato, fechas o validación; tabla de entradas/límites y oráculo independiente, sin repositorio simulado innecesario |
| Integración | Caso de uso con repositorios reales sintéticos; filas, relaciones y efectos entre módulos tras éxito/error |
| Aceptación/regresión | Comportamiento requerido en implementación vigente, aserciones de resultado y límites; una regresión previene un defecto corregido |
| Caracterización histórica | Baseline/helper congelado o defecto existente; demuestra lo que hacía esa versión, aunque acepte estado parcial |
| Diagnóstico | Sonda de planes, precisión, entorno o discrepancias; puede registrar sin imponer umbrales ni demostrar aceptación |
| Rendimiento | Mediciones repetibles junto con equivalencia funcional y distribución temporal validada |

Una suite puede contener varias clases: etiqueta cada caso. `financialIntegrity.test.ts` y `financialAtomicityPhase0.test.ts` usan fuentes históricas; sigue sus imports antes de tratarlas como regresiones vigentes. `phase6b3Reproduction.test.ts` se descubre en la suite estable por extensión: la palabra Reproduction no la cambia de configuración. En `__tests__/reproductions/`, `test.failing` verde confirma un fallo esperado, no la corrección del producto.

## Elegir nivel por impacto

| Nivel | Cuándo | Ejecución suficiente para ese nivel |
|---|---|---|
| 1. Rápido | Desarrollo acotado, cálculo/entrada/presentación local | Suites directas y casos límite del cambio; comprobar que se ejecutaron casos |
| 2. Intermedio | Regla financiera, repositorio o estructura/tipos | Nivel 1 + integración financiera relacionada + `npm run typecheck` + `npm run lint` |
| 3. Completo | Impacto transversal, coordinación, recuperación o consulta central | Suite ampliada pertinente, fallos, concurrencia y casos límite; suite estable completa si lo justifica el alcance; rendimiento solo si corresponde |
| 4. Android | Driver, Kotlin, ciclo de vida o afirmación específica de plataforma | Campaña explícitamente autorizada y aislada según la referencia Android; nunca se deriva automáticamente del nivel 3 |

Para documentación/skill bastan formato, enlaces, rutas, comandos y simulación de decisiones; no añadas tests de producción sin propósito. No escribas pruebas que solo repliquen implementación o ediciones reversibles de bajo impacto. Un riesgo financiero sí exige resultados observables y oráculos independientes.

Ejemplo nivel 1 (revisar antes fixtures y efectos):

```powershell
npm test -- --runInBand --runTestsByPath __tests__/copAmountInput.test.ts __tests__/transactionDates.test.ts
```

Ejemplo nivel 2 financiero: seleccionar `saveManualTransaction.test.ts`, `creditCardPaymentScreen.test.tsx`, `subscriptions.test.ts` o `sharedExpenses.test.ts` bajo `__tests__/` según el flujo; no ejecutar todas por defecto. Comandos ampliados existentes:

```powershell
npm run typecheck
npm run lint
npm test -- --runInBand
npm run test:reproductions -- --runInBand
```

La suite completa puede incluir volumen representativo no condicionado; léela antes de prometer una ejecución rápida. No actives variables de benchmark/100k por defecto.

## Evidencia y temporales

1. Inventaría escrituras antes de ejecutar: busca `writeFile`, `appendFile`, `rename`, `rm`, `mkdir`, snapshots, procesos hijos, variables `SMARTFIN_` y rutas en pruebas/helpers/scripts. Sigue los imports: buscar solo en la suite no basta.
2. Registra estado Git y hashes de fuentes/evidencias afectadas SIN abrir bases financieras reales. Los archivos ya modificados son el estado inicial que se debe conservar; no uses `git restore`, `reset`, `clean` ni regeneres snapshots para limpiar.
3. Mantén `SMARTFIN_WRITE_EVIDENCE` sin activar. El setup `__tests__/setup/redirectEvidenceWrites.js` redirige varias escrituras `fs` dirigidas a `docs/` hacia `artifacts/jest-evidence/docs/` o `SMARTFIN_EVIDENCE_DIR`. Las lecturas siguen leyendo los originales. Usa una carpeta nueva por ejecución para no pisar artefactos de otra pasada.
4. Ese wrapper NO es una frontera universal: no garantiza aislamiento de procesos hijos, descriptores, APIs no cubiertas, snapshots Jest ni escrituras fuera de `docs/`. Inspecciona especialmente scripts independientes, resultados definidos por variables y campañas PowerShell. No uses `-u`/`--updateSnapshot` sin un cambio esperado revisado y autorizado.
5. Si una suite puede alterar evidencias existentes y no demuestra redirección, usa una instantánea de trabajo externa aislada: copia código/config/fixtures sintéticos pertinentes, verifica hashes/contenido, conserva lectura histórica, ejecuta con salidas nuevas y compara originales al terminar. No copies bases del usuario, no redirijas a enlaces que regresen al original ni cambies hooks. Si no es viable, informa que no es seguro ejecutarla y deja la evidencia pendiente.
6. Crea cada base de archivo con nombre único en una carpeta temporal propia, fuera del almacenamiento de la app y respaldos. No la obtengas mediante extracción de producción. Verifica FK y cierra recursos incluso en fallos.
7. Antes de limpiar, resuelve la ruta absoluta, verifica que pertenece al temporal creado para esa ejecución y que no contiene junctions/enlaces ni archivos ajenos. Limpia solo si la operación está autorizada y admitida por el guard; si no, conserva y reporta el temporal. No vacíes carpetas compartidas ni cambies permisos.
8. Al terminar compara hashes y estado/diff. Si hubo una modificación inesperada, detén la ejecución, conserva evidencia y comunica la diferencia; no la ocultes restaurando archivos ajenos.

Servicios de red, reconocimiento, exportación y plataforma se sustituyen por dobles locales cuando el alcance es Node/UI. Esta metodología no autoriza llamadas remotas ni el acceso a cuentas reales.
