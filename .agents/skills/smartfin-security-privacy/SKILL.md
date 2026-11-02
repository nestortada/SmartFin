---
name: smartfin-security-privacy
description: Audita y desarrolla controles de seguridad y privacidad de SmartFin con evidencia del código Android, SQLite, credenciales, respaldos e IA. Úsala para amenazas, exposición de datos, autenticación, integraciones o cambios en esos controles; no para cambios puramente visuales ni cálculos financieros sin impacto de seguridad.
---

# Seguridad y privacidad de SmartFin

Esta skill orienta decisiones del agente; no es una barrera de seguridad, un hook ni una certificación MASVS. Una auditoría autoriza inspección, no reparar producción, consultar finanzas reales o probar servicios/dispositivos externos.

## Preferencia arquitectónica explícita: respaldos en Drive

Por decisión del propietario registrada el 2026-11-01, los respaldos financieros se mantendrán en Google Drive **sin cifrado adicional implementado por SmartFin**, conservando el diseño actual de respaldos y exportaciones. No propongas AES-GCM, contraseñas de cifrado ni gestión de claves como requisitos de implementación de respaldos. Prioriza acceso, permisos Android/SAF, temporales y prevención de publicaciones accidentales; conserva verificaciones de integridad, SHA-256 y manifiestos. Cualquier persona con acceso suficiente al archivo podría leer sus datos: la decisión mantiene riesgos residuales de confidencialidad. Aplica el [procedimiento y los límites de esta decisión](references/backups-and-recovery.md); no la conviertas en una desactivación de controles ni en autorización para publicar.

## Empezar por evidencia actual

1. Localiza la raíz por `AGENTS.md` y `package.json`. Lee también `CLAUDE.md`, estado/diff local y las secciones pertinentes de `docs/ARQUITECTURA.md` y `docs/BASE_DE_DATOS.md`. Conserva cambios del usuario. Las rutas de código de las referencias parten de la raíz del repositorio; los enlaces Markdown entre referencias parten del archivo que los contiene.
2. Define alcance, operación autorizada, activos, entradas, destinatarios y plataforma. Sigue el flujo UI → caso de uso → repositorio/servicio → Kotlin/proveedor. Contrasta documentación, implementación, configuración y pruebas. El [mapa auditado](references/security-baseline.md) es una instantánea de 2026-11-01, que debes revalidar.
3. Modela amenazas y controles según [modelo de amenazas](references/threat-modeling.md). Distingue vulnerabilidad confirmada, riesgo potencial, falta de evidencia y recomendación preventiva. No derives severidad del nombre financiero del módulo.
4. Inspecciona las referencias pertinentes; plantea hipótesis y reproducción sintética segura antes de concluir. Usa [fuentes y versiones](references/standards-and-sources.md) para seleccionar controles MASVS, debilidades MASWE y pruebas MASTG verificables. No inventes IDs ni declares cumplimiento global.
5. Para una corrección autorizada, propone el cambio mínimo y la regresión observable, verifica el resultado y registra riesgo residual. Sin autorización de cambio, entrega la propuesta y las pruebas pendientes.

## Cargar únicamente lo necesario

| Área | Procedimiento |
|---|---|
| Activos, límites de confianza, probabilidad, impacto y severidad | [Modelo de amenazas](references/threat-modeling.md) |
| Archivo financiero, WAL/SHM/journal, SQL e integridad | [Protección SQLite](references/sqlite-data-protection.md) |
| Permisos, componentes, intents, capturas, red y release | [Android](references/android-security.md) |
| PIN, Keystore, clave Gemini, firma, Git e incidentes | [Secretos y credenciales](references/secrets-and-credentials.md) |
| Snapshot, CSV, SAF, publicación, recuperación y eliminación | [Respaldos y recuperación](references/backups-and-recovery.md) |
| Gemini, voz, prompt injection y confirmación financiera | [IA y servicios externos](references/ai-and-external-services.md) |
| Clasificación, finalidad, consentimiento, retención y Colombia | [Privacidad](references/privacy-and-compliance.md) |
| npm, Gradle, transitivas, postinstall y parches | [Dependencias](references/dependency-security.md) |
| Evidencia, escenarios sintéticos y cierre | [Checklist de revisión](references/security-review-checklist.md) |

## Preservar estos límites

- Mantén local-first, offline-first y privacy-first. La integración Gemini existente no concede permiso para añadir red, telemetría, sincronización o backend. Consulta solo documentación pública sin adjuntar datos del usuario, código privado ni secretos a búsquedas.
- No imprimas secretos completos o parciales, hashes de PIN ni contenido financiero real. Reporta archivo/símbolo, clase y estado; no copies valores a informes, prompts, fixtures o servicios externos. Usa datos inventados y dobles de red/plataforma.
- El almacenamiento privado Android, el bloqueo de UI y la integridad transaccional no acreditan cifrado SQLite. No prometas protección total en un dispositivo comprometido. Para respaldos respeta la preferencia explícita anterior; una propuesta sobre cifrado de la base operativa o cambio de driver requiere un encargo específico y evaluar compatibilidad, recuperación y rendimiento. No la extiendas a las exportaciones de Drive.
- Ninguna respuesta externa autoriza una operación financiera. Conserva validación local, vista previa y confirmación explícita de intención; la ejecución pasa por los controles de dominio vigentes. No reintentes operaciones financieras de resultado `unknown`.
- No instales/actualices dependencias automáticamente ni ejecutes `npm audit fix`. No cambies hooks, permisos o políticas para auditar. Respeta denegaciones sin usar otra herramienta: si bloquean la instalación de la skill, entrega staging y pasos manuales.
- No accedas a bases reales, ejecutes campañas Android, ataques intrusivos, rotaciones externas, borrados de respaldos o reescrituras Git por cargar esta skill. Requieren alcance/autorización específicos. No sobrescribas evidencias existentes.

## Complementar las skills existentes

- `smartfin-financial-domain`: efectos e invariantes de saldos, deuda y patrimonio. Cárgala si pueden cambiar; no los redefinas aquí.
- `smartfin-sqlite-architecture`: transacciones, coordinación, migraciones y driver; cárgala para modificar esas garantías. Esta skill aporta confidencialidad y fronteras de entrada/salida.
- `smartfin-testing-qa`: selección, aislamiento y evidencia de pruebas; cárgala al diseñar o ejecutar QA. Esta skill aporta hipótesis y aceptación de seguridad.
- Localiza sus rutas descubiertas para el agente actual; no presupongas igualdad de copias. Si faltan, consulta código y comunica la limitación. Sus observaciones históricas no prevalecen sobre evidencia actual.
- `dangerous-command-guard` es infraestructura existente para comandos. Verifica registro y alcance real en cada agente antes de atribuir protección. `financial-integrity-guard` no se encontró en los hooks de proyecto auditados; comprueba si ahora existe. No lo instales implícitamente ni atribuyas selección automática de pruebas al guard de comandos.

## Entregar un resultado verificable

Incluye alcance, archivos/símbolos vigentes, controles probados, hallazgos con prerrequisitos y severidad razonada, corrección propuesta/implementada, pruebas con sus límites y riesgo residual. Separa evidencia estática, pruebas Node/mocks y ejecución Android. Distingue controles existentes de recomendaciones futuras; no declares restauración, ausencia de secretos, cumplimiento legal o conformidad MASVS sin la evidencia específica.
