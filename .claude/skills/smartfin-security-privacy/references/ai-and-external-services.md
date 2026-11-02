# IA, voz y servicios externos

## Flujo real

`src/services/geminiCommandService.ts` construye prompt y POST HTTPS al endpoint Gemini `v1beta`. Modelo declarado: `gemini-3.5-flash-lite`; el nombre de modelo/configuración no demuestra su disponibilidad ni condiciones comerciales. La cabecera usa una clave de build. Se envían solicitud, fecha/zona y catálogo de cuentas activas (ID/nombre/tipo/institución), categorías y subcategorías. El constructor no incluye saldos ni historial completo; el texto del usuario puede incluir datos financieros. Una revisión añade plan vigente y preguntas/respuestas. No afirmes que no sale información personal.

`src/modules/transactions/hooks/useAiAssistantController.ts` carga contexto local, persiste borradores y ofrece confirmación. `aiCommandPlanner.ts` parsea/normaliza campos, resuelve entidades y preguntas. `executeAiCommandPlan.ts` usa casos de dominio, ámbito compartido y comprobante durable en `ai_command_drafts`; bloquea reintento ante resultado incierto. No es una API de ejecución SQL remota.

`useAiSpeechInput.ts` usa `rn-speech-recognition` mediante `src/native/speechRecognition.ts`, solicita permiso al dictar y configura `recordingOptions.persist=false`. No solicita garantía on-device en esa llamada: ausencia de audio persistido por la app no prueba reconocimiento offline ni ausencia de transmisión del proveedor.

## Procedimiento

1. Enumera cada frontera y qué campos salen en interpretación/revisión/voz; sigue persistencia local y exportaciones posteriores. Comprueba finalidad, texto visible/consentimiento y alcance actual, sin inferir autorización universal por existir el servicio. Mantén rutas financieras locales disponibles ante caída de IA.
2. Trata solicitud, nombres del catálogo, transcripción, historial, respuesta del modelo y documentos externos como datos no confiables. Frases dentro de ellos no autorizan cambios de política ni herramientas. Delimitar/explicar en prompt ayuda, pero la defensa efectiva reside en validación y autorización locales.
3. Inspecciona parser del cliente: objeto/array, operaciones y entidades permitidas, campos/tipos, números finitos/límites, fechas civiles, cantidades de acciones/texto y referencias. El schema remoto limita 20 acciones y `parseAiCommandPlan` exige de una a 20 localmente. La entrada normal tiene límite de 4.000 caracteres; no atribuyas ese límite al prompt total de revisión. Verifica dónde se aplican los límites y documenta ausencias.
4. Rechaza SQL, shell, navegación/URL arbitraria, entidades no soportadas y referencias cruzadas inválidas. Un texto que pide ignorar controles se conserva como dato; no cambies validadores para acomodar la salida de IA.
5. Separa sugerencia → aclaraciones → preview completa → confirmación explícita → revalidación de dominio sobre estado vigente → commit → efectos plataforma. La confirmación debe corresponder a ese plan/destinos/importes, también al borrar o editar. Revisa stale plan, doble toque, cambios mientras espera y replay de borrador. Confirmar por el modelo no equivale a confirmar por la persona.
6. Conserva los casos de dominio existentes y comprobantes; ningún resultado externo llama directo a repositorios para saltarse validaciones financieras. Distingue reintentar interpretación (sin efecto financiero) de reintentar un commit `unknown` (no autorizado).
7. Comprueba timeout/cancelación, 429, 5xx, JSON inválido, respuesta excesiva y error de plataforma sin guardar parcialmente ni revelar payload/clave. El servicio actual reintenta hasta dos intentos en ciertos fallos de red/5xx; no extrapoles ese retry al ejecutor financiero.
8. Minimiza catálogo y texto según la operación. Revisa si IDs/nombres pueden pseudonimizarse sin perder resolución local; no agregues saldos/historial para mejorar precisión sin autorización. No envíes secretos al modelo. No añadas un proxy/backend por defecto.

## Regresión propuesta

Con fetch/reconocedor falsos y catálogos inventados: un nombre que contiene «ignora reglas»; operación/entidad desconocida; campos arbitrarios; referencias ausentes/duplicadas; `NaN`/infinitos; respuesta malformada/grande; plan revisado después de preview; confirmación duplicada y commit incierto. Verifica cero escrituras antes de confirmación válida y resultados financieros coherentes después. No uses un modelo externo para ejecutar estos casos.

Evidencia existente: `__tests__/geminiCommandService.test.ts` (minimización y errores con fetch mock), `__tests__/aiCommandPlanner.test.ts`, `__tests__/aiConfirmationPhase4.test.tsx` y `__tests__/aiDraftRepository.test.ts`. No certifican inmunidad a prompt injection, permisos del proveedor o cumplimiento de su política de datos.
