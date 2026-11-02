# Auditoría estática de seguridad actual

Fecha de referencia: **2026-11-01, America/Bogota**. Alcance: fuentes y configuración del checkout, documentación, skills/hooks y suites indicadas. No se abrieron bases financieras, cuentas remotas, APK privadas ni dispositivos. No se efectuó pentest, escaneo exhaustivo de historial Git, consulta de CVE ni evaluación jurídica completa. Revalida este mapa antes de usarlo como diagnóstico futuro.

Actualización de recomendaciones por decisión explícita del propietario (2026-11-01): mantener respaldos financieros en Google Drive sin cifrado adicional de SmartFin y conservar el diseño de exportación. La [decisión vigente](backups-and-recovery.md) sustituye recomendaciones anteriores de exigir cifrado/contraseñas/gestión de claves para respaldos. Los riesgos S05/S06 permanecen documentados; acceso suficiente a un archivo permite leer sus datos. Esta actualización documental no es una nueva campaña de seguridad ni cambia código, formatos, controles de integridad o permisos.

## Arquitectura y datos comprobados

SmartFin mantiene dominio/persistencia locales bajo módulos. La UI delega finanzas en casos de uso y SQLite en repositorios/adaptadores. `AGENTS.md` conserva las reglas offline/privacy-first; la app incluye integración Gemini explícita y proveedor de documentos Android. Las tablas modelan datos implementados y otros previstos: existir `receipt_attachments`, `loans` o `backup_records` no demuestra una funcionalidad terminada.

| Área | Fuente/símbolo contrastado | Control actual y límite |
|---|---|---|
| Acceso opcional | `src/modules/settings/types/Settings.ts`, `src/navigation/AppNavigator.tsx`, `AppAccessGate` en `src/modules/security/ui/AppAccessGate.tsx` | Flags iniciales desactivados; al habilitarlos, gate al inicio y en `AppState=active`. Base se abre antes del desbloqueo. No se encontró autorización por rol ni gate criptográfico por operación |
| Credencial | `src/modules/security/useCases/manageSecurity.ts`: `setLocalAccessSecret`; `android/app/src/main/java/com/smartfin/SmartFinSecurityModule.kt`: `hashSecret`, `encrypt`, `getOrCreateSecretKey` | Mínimo cuatro caracteres, SHA-256 con sal, AES-GCM del derivado y Keystore, comparación constante. Sin KDF de coste ni límite durable de intentos en las rutas revisadas; clave sin requisito de autenticación de uso |
| Biometría/bridge | `SmartFinSecurityModule.kt`: `canAuthenticateBiometrics`, `authenticateBiometrics`; `src/modules/security/services/securityService.ts` | Ruta biométrica API 28+, prompt sin CryptoObject; wrappers ante módulo ausente. Respuestas nativas tipadas como boolean no son validadas en runtime por ese wrapper |
| Archivo/driver | `src/database/sqliteDatabase.ts`: `openSmartFinDatabase`; `src/database/sqliteSchema.ts`; `SmartFinLocalSnapshot.kt` | `smartfin.db`, almacenamiento privado resuelto por Android, FK/integridad/revisión, coordinación/cuarentena. No configuración de cifrado SQLite; no se midieron permisos efectivos de instalación |
| Datos personales | `src/database/sqliteSchema.ts`; `src/modules/transactions/database/sharedExpenseSchema.ts`; `sqliteAiDraftRepository.ts` | Cuentas/importes/notas, contactos compartidos, borradores/planes/conversaciones; tabla histórica de mensajes y URI de adjuntos. No se verificó contenido real ni retención efectiva del usuario |
| Backup | `src/modules/settings/services/androidDriveBackupService.ts`, `backupPublicationPolicy.ts`; `SmartFinDriveBackupModule.kt`, `SmartFinBackupPublisher.kt` | SAF, permiso URI temporal/persistible, generaciones y manifiesto v2 con relectura SHA-256. Datos planos; `cloudSync=unconfirmed`. Publicación UI desactivada. Sin restaurador financiero encontrado |
| CSV | `android/app/src/main/java/com/smartfin/SmartFinBackupCsv.kt`: `csvEscape`, `exactReal` | Escapa comillas/delimitadores y preserva REAL; no neutraliza fórmulas para hojas de cálculo |
| Borrado | `src/modules/settings/useCases/deleteFinancialData.ts`, `repositories/sqliteFinancialDataRepository.ts`, `services/financialDeletionLifecycle.ts`; `SmartFinFinancialDeletion.kt` | Inventario cerrado, commit y comprobante, limpieza privada recuperable, épocas de recursos. Conserva ajustes; no borra respaldos externos ni acredita borrado forense |
| IA | `src/services/geminiCommandService.ts`: prompt/parseo/request; `src/modules/transactions/useCases/aiCommandPlanner.ts`, `executeAiCommandPlan.ts`; hook de confirmación | HTTPS, catálogo reducido sin saldos/historial completo por constructor, validación y confirmación, dominio/comprobantes/atomicidad. Sí salen nombres/IDs/instituciones, texto y contexto de revisión |
| Voz | `src/modules/transactions/hooks/useAiSpeechInput.ts`, `src/native/speechRecognition.ts` | Permiso al dictar y `persist=false`; no demuestra reconocimiento exclusivamente local |
| Android | `android/app/src/main/AndroidManifest.xml`, `MainActivity.kt`, receptores y módulo de recordatorios | Launcher exportada; receptores propios privados; PendingIntent inmutable y notificación privada con versión pública genérica. Sin handler de deep links/WebView propio encontrado; manifest fusionado no evaluado |
| Build/red | `android/build.gradle`, `android/app/build.gradle`, manifest | API mínima 24/target 36; `allowBackup=false`; cleartext es placeholder sin comprobar resolución; release firma debug y minificación apagada. No hay APK de distribución evaluada |
| Diagnóstico | `src/modules/transactions/ui/TransactionsScreen.tsx`, `SmartFinSubscriptionReminderReceiver.kt`, servicios de errores | Hay `console.error` con objetos y presentación de mensajes. Recuperación nativa registra mensajes genéricos/tipo. No se reprodujo filtración de datos específicos |

Las rutas Kotlin sin prefijo completo de la tabla están bajo `android/app/src/main/java/com/smartfin/`; nombres TS de módulo se desarrollan en las referencias especializadas. Las validaciones de seguridad no se atribuyen a todos los módulos por compartir un nombre.

## Riesgos y hallazgos priorizados

P/I y severidad siguen [modelo de amenazas](threat-modeling.md). No se identificó una vulnerabilidad crítica demostrada dentro de este alcance. La certeza de una configuración no acredita explotación ni distribución de un artefacto.

| ID / clasificación | Evidencia y escenario | Evaluación | Propuesta futura y residual |
|---|---|---|---|
| S01 Configuración confirmada | Release usa firma debug en `android/app/build.gradle`; riesgo si se distribuye así | P3/I3=9, alta condicional a distribución | Separar firma release y verificar certificado/artefacto con plan de custodia. No se cambió firma ni abrió keystore |
| S02 Riesgo potencial | Clave Gemini de build llega al cliente mediante config; no se inspeccionó valor, APK, vigencia o restricciones | P2/I3=6, media; reevaluar si reutilizable y expuesta | Clasificar alcance/cuotas/restricciones; plan de rotación y diseño autorizado. `.env` ignorado no resuelve extracción |
| S03 Riesgo potencial | Credencial corta, hash rápido y ausencia de límite de intentos en código de acceso revisado | P3/I2=6, media con teléfono accesible y PIN habilitado | Evaluar intentos/KDF y recuperación compatible, con pruebas negativas. No se intentó adivinar PIN |
| S04 Propiedad confirmada / riesgo potencial | SQLite sin cifrado propio; el sandbox sí protege frente a otros UID sin privilegios | P1/I3=3, baja en escenario de extracción que requiere compromiso privilegiado; reevaluar contexto | Revisar aislamiento/permisos y recuperación. Una evaluación de cifrado de la base operativa requiere encargo específico y no cambia el diseño de respaldos. No afirmar extracción posible por cualquier app |
| S05 Riesgo potencial residual del diseño elegido | Copias SAF con `encrypted=false`; tercero con acceso suficiente al archivo puede leer finanzas | P2/I3=6, media, condicionado a publicación/acceso (UI actual apagada); la preferencia no elimina el riesgo | Mantener copias sin cifrado propio; priorizar autorización, permisos de carpeta/lectores, temporales, retención y prevención de publicación accidental. Comunicar legibilidad. No revocar/borrar copias reales |
| S06 Riesgo potencial residual | Checksums y manifiesto externo no autentican autor si ambos se manipulan, especialmente sin trabajo privado como ancla | P2/I3=6, media para consumidor externo que confíe en origen | Conservar SHA-256/manifiestos y ancla privada cuando exista; revisar acceso/procedencia y documentar límites sin imponer firma/MAC o claves. No se probó un restore inexistente |
| S07 Riesgo potencial | `csvEscape` no neutraliza fórmulas; consumidor abre texto controlado en hoja que las evalúa | P2/I2=4, media condicionada al consumidor | Evaluar variante de presentación; mantener respaldo canónico y precisión. No se ejecutaron fórmulas en una app |
| S08 Riesgo potencial | Sin `FLAG_SECURE` propio encontrado; bloqueo al regresar no oculta necesariamente recientes | P2/I2=4, media | Política de capturas/recientes y validación sintética por API. No se observaron capturas reales |
| S09 Falta de evidencia | `allowBackup=false`, sin reglas explícitas de extracción y sin manifest fusionado/OEM evaluados | Severidad sin asignar: no hay ruta de extracción demostrada | Verificar cloud/D2D por versión y variante, compatibilidad Keystore |
| S10 Riesgo potencial | Objetos de error en console/mensajes pueden contener datos sensibles según su origen | P1/I2=2, baja provisional | Trazar datos concretos y redactar sumideros; no afirmar filtración actual sin evidencia |
| S11 Falta de evidencia | No CVE actual, escaneo completo Git, política jurídica ni condiciones de proveedores verificadas | Severidad sin asignar | Revisiones acotadas con fuentes actuales y evidencia redactada |

## Contradicciones con documentación

- `docs/BASE_DE_DATOS.md`, sección 12, afirma que no hay llamadas propias de red; `geminiCommandService.ts` implementa POST. La ausencia de backend financiero propio sí es compatible con almacenamiento local.
- La tabla `app_settings` se describe como guardando credencial: código solo guarda flags y tema entre ajustes públicos; el derivado cifrado reside en preferencias nativas. La base contiene además claves internas de ciclo/comprobantes.
- Secciones antiguas describen nombres fijos de backup/reemplazo; secciones posteriores y publicador vigente usan generaciones exclusivas y activación UI pendiente. La capacidad histórica no sustituye el estado del flag.
- `docs/ARQUITECTURA.md` resume dos puentes nativos, pero hay además ciclo de base/recordatorios y coordinación. `securityService.ts` no aplica la validación runtime `unknown` atribuida genéricamente a puentes.
- Skills financieras/SQLite contienen observaciones históricas; la skill SQLite decía no encontrar `smartfin-testing-qa` en su auditoría inicial, pero ambas copias QA existen actualmente como cambios locales sin seguimiento. No se modificaron para corregir textos históricos.

## Pruebas y protecciones del repositorio

Se revisaron suites de acceso, Gemini, planes/confirmación IA, captura, publicación y borrado/recuperación. Acceso usa `SecurityService` mock; Gemini inyecta fetch; backup de orquestación usa bridge/captura simulados. No son pruebas de Keystore, TLS de proveedor, autorización Android o resistencia frente a dispositivo comprometido. Los resultados de la ejecución acotada de esta entrega se registran fuera de la skill, en `VALIDATION.md` del paquete, para no convertir una corrida en garantía permanente.

`.gitignore` excluye `.env*` salvo ejemplo y keystores salvo debug; `git ls-files` de esos patrones mostró `.env.example` y `android/app/debug.keystore`. Esto no verifica contenidos ni todo el historial. El lockfile, postinstall/parches y CI están presentes; branch protection remoto no se consultó. Las claves públicas de desarrollo no se tratan como credenciales privadas de producción.

Hooks registrados: `.codex/hooks.json` apunta a `.codex/hooks/dangerous-command-guard.cjs` con política/parser; `.claude/settings.json` registra `.claude/hooks/dangerous-command-guard.cjs`. Son implementaciones distintas y no acreditan cobertura idéntica. No se encontró `financial-integrity-guard` en las rutas de hooks de proyecto revisadas. Hay tests propios de guards; no se modificaron ni se desactivaron.

La evaluación pura del guard Codex para añadir `.agents/skills/smartfin-security-privacy/SKILL.md` devolvió `deny`, motivo `DG-FILE: Secret, database or guard configuration is protected`. Se eligió staging y distribución física preparada, sin intentar la escritura protegida por otra herramienta. No se afirma que la skill esté instalada o descubierta activamente.

## Recomendaciones fuera de esta entrega

Para respaldos, priorizar acceso a Drive/URI, permisos Android, temporales/retención y prevención de publicaciones accidentales, manteniendo hashes/manifiestos y el diseño sin cifrado propio. Registrar límites de confidencialidad y autenticidad sin convertirlos en requisitos de cifrado, contraseñas o gestión de claves. Fuera de respaldos, conservar las propuestas sobre firma de distribución, credenciales cliente, intentos/recuperación, capturas, avisos IA/voz y supply chain según su alcance. Cualquier evaluación de cifrado de la base operativa necesita un encargo específico. Esta actualización solo modifica documentación de la skill; ninguna de esas mejoras de producto se implementa aquí.
