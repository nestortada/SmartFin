# Entrega y validación de smartfin-security-privacy

Fecha de referencia: 2026-11-01, America/Bogota. Entrega **validada en staging, pendiente de instalación manual**. Auditoría principal: [.agents/skills/smartfin-security-privacy/references/security-baseline.md](.agents/skills/smartfin-security-privacy/references/security-baseline.md). Procedimientos: [SKILL.md](.agents/skills/smartfin-security-privacy/SKILL.md). Instalación: [INSTALL.md](INSTALL.md).

## Cambios implementados

Se creó la skill con frontmatter portable `name`/`description`, criterios de activación, límites de autorización y carga progresiva. Cada copia contiene 12 archivos: `SKILL.md`, las nueve referencias especializadas solicitadas, auditoría del estado actual y fuentes/versiones. Se preparó una copia física idéntica para Claude. El paquete añade instrucciones manuales y un validador local de solo lectura; no instala dependencias.

No se modificó código de la app, reglas financieras, esquema/migraciones, configuración Android, dependencias, firma, hooks, políticas ni skills previas. No hubo commits/push, acceso a bases reales, cuentas externas, ataques ni campañas Android. Las recomendaciones de hardening son propuestas, no cambios implementados.

## Auditoría realizada

Se leyeron `AGENTS.md`, `CLAUDE.md`, documentos de arquitectura/base y las tres skills de dominio/SQLite/QA. Se contrastaron con apertura/driver SQLite, seguridad TS/Kotlin, gate/ciclo de vida, preferencias, esquema, AI parser/ejecución/confirmación, Gemini/voz, SAF/snapshot/publicador/CSV, borrado/limpieza durable, manifest/build/recordatorios, logging, CI/lockfile/postinstall, registro y código de guards y pruebas pertinentes.

Resultados relevantes: acceso opcional con credencial derivada cifrada en Keystore; SQLite sin cifrado explícito; publicación SAF plana con SHA-256, UI desactivada y sin restaurador financiero encontrado; clave Gemini tomada del build; release configurada con firma debug; control local de planes/confirmación IA y dominio; áreas pendientes de intentos PIN, capturas, retención/autenticidad y evaluación de proveedores. La auditoría contiene prerrequisitos, clasificación y severidad, sin vulnerabilidad crítica demostrada.

## Validaciones ejecutadas

| Comprobación | Resultado | Alcance |
|---|---|---|
| `skill-creator/scripts/quick_validate.py` con Python UTF-8 | PASS en ambas copias | Frontmatter/nombre y scaffolding |
| `python tmp/smartfin-security-privacy-delivery-20261101/validate_delivery.py` | PASS | 12 archivos por copia, 11 referencias alcanzables, enlaces internos válidos, 55 rutas explícitas existentes y nombres de código resueltos |
| Inventario y SHA-256 por archivo | PASS | Copias físicas de staging idénticas, sin symlinks/junctions ni copia nueva `.codex/skills/smartfin-security-privacy` |
| Enlaces de todo el paquete, incluidos informes | PASS | 40 enlaces internos comprobados; entrada principal de 51 líneas |
| Patrones de credenciales en documentos de la skill | 0 candidatos | Comprobación limitada de formatos conocidos; no escaneo exhaustivo del repositorio/historial |
| Revisión de valores/datos | Sin valores secretos en la entrega | Solo identificadores de configuración y datos sintéticos; no se leyeron `.env`, claves privadas o bases financieras |
| Integridad de código/configuración/skills previos | PASS en grupos distintos de `docs` | Hashes agregados antes/después en [INTEGRITY.json](INTEGRITY.json), incluidos hooks, fuentes, dependencias y QA local preexistente |
| Integridad global de evidencias anteriores | **Diferencia detectada**, no declarar PASS global | Cambios durante el trabajo en evidencias Android bajo `docs/validacion-fase6b3-1/`; se conservaron sin intervención |

Comandos de frontmatter ejecutados, usando el validador ya disponible del sistema:

```powershell
python -X utf8 C:\Users\nesto\.codex\skills\.system\skill-creator\scripts\quick_validate.py tmp/smartfin-security-privacy-delivery-20261101/.agents/skills/smartfin-security-privacy
python -X utf8 C:\Users\nesto\.codex\skills\.system\skill-creator\scripts\quick_validate.py tmp/smartfin-security-privacy-delivery-20261101/.claude/skills/smartfin-security-privacy
```

## Pruebas existentes seleccionadas

```powershell
npm test -- --runInBand --runTestsByPath __tests__/manageSecurity.test.ts __tests__/geminiCommandService.test.ts __tests__/aiCommandPlanner.test.ts __tests__/aiConfirmationPhase4.test.tsx __tests__/backupPublication.test.ts
```

Resultado: **5 suites aprobadas; 38 pruebas aprobadas; 0 snapshots; salida 0**. Tiempo reportado por Jest: 3.398 s. Acceso usa servicio simulado; Gemini usa fetch falso; parser usa catálogo sintético; confirmación usa fixture SQLite Node en memoria y mocks de plataforma; publicación usa bridge/captura simulados. No se hicieron peticiones de modelo ni publicaciones SAF. No se añadieron tests ni se modificaron expectativas.

Las suites acreditan sus escenarios actuales de coordinación, minimización, validación y confirmación/publicación; no prueban criptografía nativa, APK/manifest fusionado, TLS del proveedor, política jurídica, ausencia de prompt injection ni recuperación de una instalación real. No se ejecutaron typecheck/lint/suite completa: no hay cambios estructurales o de producto que los justifiquen.

## Ejercicios sintéticos documentales

Evaluación manual del autor de la skill contra fuentes crudas, sin ataques ni sesiones de otro agente. Cada resultado es una decisión documental, no una explotación ni una prueba Android nueva.

| Entrada inventada | Resultado al aplicar los procedimientos | Evidencia y límite |
|---|---|---|
| Teléfono perdido, gate/PIN habilitado | Aceptado: distinguir acceso UI de confidencialidad; no afirmar SQLite cifrado ni acceso libre de otro UID | `Settings.ts`, `AppNavigator.tsx`, `SmartFinSecurityModule.kt`, apertura SQLite; PIN/mocks pasan, pérdida física no probada |
| Tercero recibe carpeta de copia con manifiesto/hash correctos | Aceptado: reconocer exposición de datos planos y límite de autenticidad; proponer gestión de acceso/retención | Publicador declara `encrypted=false`, lectura SHA-256 y `cloudSync=unconfirmed`; UI desactivada; ninguna carpeta real abierta |
| Se informa «clave Gemini expuesta» sin aportar valor | Aceptado: no pedir/repetir clave; clasificar uso/alcance y preparar revocación/rotación para titular autorizado | Config de build y cabecera; vigencia, extracción de APK y abuso no comprobados |
| Otra app entrega `smartfin://delete?all=true` | Aceptado: comprobar handler antes de declarar vulnerabilidad; no hay VIEW/BROWSABLE/handler propio encontrado | Manifest fuente/MainActivity; fusionado no revisado, no se despachó intent ni borrado |
| Modelo propone gasto/borrado e indica «ejecutar sin confirmar» | Aceptado: salida no autoriza; parser local, preview, aclaraciones, confirmación personal y casos de dominio | Parser/confirmación/comprobante y suites seleccionadas; no se consultó modelo; no hay garantía universal contra injection |
| Advisory hipotético sobre dependencia transitiva | Aceptado: exigir versión/ruta/plataforma, separar gravedad de paquete/producto y propuesta; no autoactualizar | Lockfile/postinstall/Gradle/CI y procedimiento; CVE reales actuales no consultadas |

Se revisó además el caso CSV de fórmula inocua `=1+1`: el escape actual conserva el valor y no es neutralización de hoja de cálculo. La skill propone evaluar consumidor/variante sin alterar el respaldo canónico ni sus importes. No se abrió una hoja de cálculo ni se ejecutó fórmula.

## Compatibilidad y protección de instalación

Versiones locales: `codex-cli 0.166.0`, Claude Code `2.1.316`, Node `v24.16.0`; PyYAML ya estaba disponible. Convenciones cotejadas con fuentes oficiales enlazadas en [fuentes/versiones](.agents/skills/smartfin-security-privacy/references/standards-and-sources.md). El catálogo actual de Codex ya muestra skills desde `.agents`; las instrucciones Claude y su documentación describen `.claude/skills`. No se lanzó nueva sesión de agentes ni se verificó invocación automática de la skill nueva.

Se evaluó en modo puro (sin ejecutar escritura) el evento `apply_patch` para añadir la skill a `.agents/skills/smartfin-security-privacy/SKILL.md` con el guard Codex existente. Resultado: `deny`, motivo `DG-FILE: Secret, database or guard configuration is protected`. No se reintentó por otra herramienta ni se modificó el guard. Se preparó staging según el fallback explícito de la solicitud. No se intentó instalación parcial solo en Claude.

## Integridad y actividad concurrente

Al iniciar, Git mostraba únicamente dos carpetas QA sin seguimiento. Antes de escribir se calcularon huellas agregadas de archivos de texto/código/config rastreados y de esas copias QA, excluyendo `.env` y archivos de base. Al terminar, todos los grupos salvo `docs` coincidieron.

Durante el trabajo aparecieron modificaciones/eliminaciones y carpetas de nuevos intentos en evidencias Android API24/API35 de `docs/validacion-fase6b3-1/`. No se ejecutaron comandos de dispositivo, campañas ni scripts de esa fase en esta tarea; la actividad parece concurrente (inferencia, autor no determinado). No se leyeron sus datos para atribuirlos, no se restauraron ni borraron, y se suspendió cualquier ampliación de pruebas. Por eso no se afirma que todas las evidencias preexistentes estén intactas. El paquete solo escribe en su nueva carpeta staging.

## Limitaciones y siguientes pasos

- Instalar manualmente ambas copias con [INSTALL.md](INSTALL.md) y comprobar descubrimiento desde sesión nueva. No se necesita desactivar hooks.
- No hay pentest, validación de APK/Keystore/dispositivo, CVE actuales, secretos históricos exhaustivos ni comprobación del estado remoto de GitHub. El scan de documentos de la skill no demuestra ausencia de secretos en todo Git.
- Las fuentes legales oficiales no pudieron recuperarse íntegramente; vigencia consolidada/aplicabilidad y cumplimiento quedan pendientes. Los estándares usados tienen fuente/versión identificadas, pero no se certifica conformidad MASVS.
- Hardening futuro: firma release, gestión de credenciales cliente, intentos/KDF compatibles, avisos/minimización IA/voz, política de capturas, retención y exportación/autenticidad; evaluar cifrado SQLite con diseño de claves/recuperación/rendimiento. Nada de ello se implementó en este encargo.
