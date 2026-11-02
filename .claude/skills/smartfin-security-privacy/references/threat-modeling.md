# Modelo de amenazas y evaluación

## Procedimiento

1. Define caso y exclusiones: leer historial, desbloquear, interpretar una solicitud, publicar copia o borrar finanzas son operaciones distintas. Identifica versión/commit y cambios locales.
2. Inventaría activos y dueños: libro financiero, contactos compartidos, conversaciones IA, recibos/URI, preferencias, PIN derivado, clave Keystore, credencial Gemini, firma de distribución y copias externas.
3. Dibuja entradas/salidas y límites: persona↔UI; UI↔casos de uso; JS↔Kotlin; proceso↔sandbox/Keystore; app↔SAF/proveedor; app↔Gemini/reconocedor de voz; repositorio↔instalación/CI. No asumas IPC seguro entre procesos: la coordinación actual se documenta para el proceso de la app.
4. Identifica actores con capacidades concretas: persona con teléfono desbloqueado, app de otro UID, persona con acceso a carpeta SAF, proveedor externo, dependencia comprometida y atacante con control del SO. No concedas root a cualquier app instalada.
5. Formula una hipótesis por activo/frontera y contrástala con llamadores, validaciones, configuración y pruebas. Registra el control que existe y qué no cubre.
6. Reproduce solo con datos sintéticos y medios autorizados. Una lectura estática puede confirmar una configuración; no acredita explotación, alcance de una APK ni comportamiento OEM.
7. Evalúa probabilidad/impacto, corrección mínima, regresión y riesgo residual. Repite la evaluación después de verificar el cambio.

## Registro mínimo por amenaza

`ID | activo/finalidad | actor/prerrequisitos | entrada/límite | vector | evidencia código/config/test | control actual | estado de evidencia | probabilidad | impacto | severidad y motivo | cambio mínimo | prueba | riesgo residual/responsable`

Estados: **confirmada** exige evidencia verificable del defecto y de la ruta afectada (indica si solo estática); **potencial** tiene vector plausible y un prerrequisito sin verificar; **falta de evidencia** identifica exactamente qué falta; **preventiva** propone defensa sin afirmar vulnerabilidad.

## Criterios de severidad

Puntúa probabilidad P de 1 a 4: 1 requiere compromiso privilegiado/condiciones excepcionales; 2 requiere acceso local o carpeta compartida; 3 entrada accesible con configuración habitual; 4 explotación trivial/repetible en la ruta expuesta. Puntúa impacto I: 1 metadatos limitados/reparable; 2 exposición acotada o indisponibilidad recuperable; 3 libro completo, secreto reutilizable o alteración financiera relevante; 4 exposición/alteración extensa con pérdida grave y recuperación difícil.

| P × I | Severidad inicial |
|---|---|
| 1–3 | Baja |
| 4–7 | Media |
| 8–11 | Alta |
| 12–16 | Crítica candidata |

Solo confirma **crítica** con una ruta demostrada, exposición efectiva y consecuencias graves; si faltan, conserva el escenario como potencial y explica la incertidumbre, sin inflar puntuaciones. La matriz ayuda a comparar dentro de un alcance; no sustituye contexto ni equivale a CVSS. Separa gravedad condicional y confianza de la evidencia; documenta cualquier ajuste. No puntúes una simple ausencia de pruebas como defecto explotable.

## Escenarios propios de SmartFin

| Escenario | Controles que comprobar | Límite/residual |
|---|---|---|
| Teléfono perdido | bloqueo SO, ajustes opcionales, gate al inicio/primer plano, PIN/biometría | Sin bloqueo configurado no hay gate; no cifra SQLite |
| SO comprometido | sandbox, Keystore, datos en memoria, autorización por operación | Keystore no garantiza que un proceso comprometido no use una clave |
| Carpeta de respaldo expuesta | alcance SAF, lectores/permisos, temporales, retención y publicación deliberada; conservar [preferencia Drive sin cifrado propio](backups-and-recovery.md) | Con acceso suficiente al archivo se leen datos; la decisión mantiene riesgo residual. Checksums no ocultan datos ni autentican a su autor |
| Token/clave expuesto | compilación, Git, uso/alcance/cuota, logs | `.env` ignorado no oculta una clave compilada |
| Entrada/archivo alterado | parseo, allowlists, referencias, hashes, límites | Base y manifiesto controlados juntos no prueban origen |
| Restauración incompleta | buscar primero importador, autorización y commit | Recuperar un trabajo no es restaurar una base |
| Respuesta maliciosa de IA | parser, resolución, preview, confirmación y dominio | Prompt defensivo y esquema remoto no sustituyen controles locales |
| Diagnóstico sensible | errores JS/nativos, datos en pantallas/capturas | No afirmar filtración sin seguir el dato hasta el sumidero |
