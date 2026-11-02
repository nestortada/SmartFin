# Privacidad, finalidad y contexto colombiano

## Inventario de tratamiento

| Datos | Fuente/almacén real | Destinos que revisar |
|---|---|---|
| Saldos, deuda, movimientos, entidades/fechas/notas | tablas de `src/database/sqliteSchema.ts` y repositorios de módulo | UI, SQLite, copia completa y CSV |
| Contactos y participaciones de gastos compartidos | `src/modules/transactions/database/sharedExpenseSchema.ts`, `shared_contacts` | API local, snapshot, CSV de personas/compartidos |
| Texto original, conversaciones/planes IA | `ai_command_drafts`, `sqliteAiDraftRepository.ts` | Gemini según constructor de prompt; copia SQLite completa |
| Mensajes financieros históricos | `raw_financial_messages` en esquema | Posibles instalaciones heredadas; no pruebes su existencia abriendo la base del usuario |
| Recibos/adjuntos y URI | `receipt_attachments` y campos URI | Distinguir tabla prevista de almacenamiento/retención realmente implementados |
| PIN derivado cifrado, clave y flags | preferencias privadas/Keystore; flags en `app_settings` | Acceso local; no hay evidencia de plantillas biométricas almacenadas por SmartFin |
| Audio/transcripción | reconocedor del SO y hook de voz | Proveedor de reconocimiento; no asumir offline por `persist=false` |
| Diagnósticos y temporales | errores, notificaciones, snapshots/trabajos | Logcat/console, recientes/capturas, proveedor y consumidores |

Trata datos financieros como sensibles para ingeniería y minimiza su uso; no deduzcas automáticamente la categoría jurídica de «dato sensible» de esa etiqueta. El uso de BiometricPrompt no demuestra que la app recolecte la plantilla biométrica del sistema.

## Procedimiento

1. Registra dato, titular (incluidos terceros de gastos compartidos), finalidad, fundamento/consentimiento cuando corresponda, almacén, destinatario, plazo, eliminación y responsable. No recolectes contactos del sistema ni información adicional solo por conveniencia: el manifest revisado no solicita READ_CONTACTS.
2. Sigue las tres vías distintas: finanzas locales, IA/voz y archivos elegidos en SAF. Minimiza cada una; acceso concedido a una carpeta no prueba consentimiento de todos los titulares para transmitir datos a un servicio IA.
3. Comprueba avisos y controles en UI antes de salida sensible, negativas/revocación y uso local sin integración. No declares existencia de política/consentimiento por una mención en documentación. La auditoría no verificó una política jurídica publicada ni términos vigentes del proveedor.
4. Define retención por clase: borradores/conversaciones, mensajes heredados, logs, parciales, generaciones, notificaciones. Conserva lo necesario para recuperación y trazabilidad con plazo justificado; no inventes un plazo legal universal.
5. Sigue eliminación hasta copias/exportaciones, preferencias, páginas SQLite y proveedor. El borrado actual es financiero lógico con limpieza privada recuperable; no borra carpetas externas. Explica los límites antes de prometer supresión completa; no borres copias reales para probarlo.
6. Revisa errores desde su fuente. `TransactionsScreen.tsx` envía objetos de error a `console.error`; algunos servicios presentan `error.message`. Los logs nativos de recuperación examinados usan mensajes genéricos/tipo de excepción. Busca payload sensible concreto antes de declarar filtración. Propón mensajes/códigos redactados y prueba que no incluyen PIN, clave, URI privada ni contenido financiero.
7. Para cualquier servicio que reciba datos, identifica operador, país/destinatarios, finalidad, retención, entrenamiento/uso secundario, subencargados, derechos y supresión. Obtén términos actuales de la modalidad contratada; no extrapoles plan gratuito, empresarial o modelo por el texto de un error.

## Evaluación jurídica acotada

Usa como punto de partida Ley 1581 de 2012 y reglamentación aplicable, especialmente el régimen compilado de protección de datos del Decreto 1074 de 2015; revisa también si un tratamiento concreto entra en un régimen especial como Ley 1266 de 2008. Consulta [fuentes](standards-and-sources.md) y verifica texto consolidado, modificaciones, vigencia, territorio, roles y exclusiones antes de emitir conclusiones.

Distingue uso estrictamente personal/doméstico de tratamiento por desarrollador/proveedor y de transmisión de datos de terceros. No concluyas exclusión ni obligación específica sin hechos. Evalúa autorización, finalidades, información al titular, seguridad, consultas/reclamos y transferencia/transmisión internacional según el caso. Los datos locales y la ausencia de backend propio no establecen por sí solos cumplimiento.

En esta entrega hubo resultados oficiales indexados sobre Ley 1581, pero falló recuperar íntegramente las páginas legales consultadas; la vigencia consolidada y el alcance jurídico quedan pendientes. No se afirma cumplimiento ni se inventan obligaciones, registros o plazos. Una conclusión legal posterior requiere esa verificación y una evaluación específica del tratamiento.
