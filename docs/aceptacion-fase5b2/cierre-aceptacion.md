# Cierre de aceptación de SmartFin 5B.2

**Veredicto: condicionado. No habilitar todavía.**

La protección de generaciones y la integridad de publicación tienen evidencia
técnica válida. La aceptación del producto requiere cerrar los hallazgos de UI,
adoptar el lector semanal v2, aprobar el presupuesto de bloqueo y definir la
coexistencia con borrado. `BACKUP_PUBLICATION_UI_ENABLED` permanece en `false`.
No se implementa ni se inicia 5C.

## Estado técnico y correspondencia de evidencia

Se revisaron `AGENTS.md`, las skills de dominio financiero y rendimiento RN,
`ARQUITECTURA.md`, `BASE_DE_DATOS.md`, flujos/Suscripciones y los informes
[5A](../atomicidad-financiera-fase5a.md),
[5B.1](../atomicidad-financiera-fase5b1.md) y
[5B.2](../atomicidad-financiera-fase5b2.md). Las limitaciones del publicador de 5A y
el estado local de 5B.1 son históricos; se contrastaron con el publicador actual.

La auditoría compara los **464 archivos** protegidos de la validación final previa
y todas las fuentes atestadas de sus **32 campañas / 148 controles**. No encuentra
diferencias. Incluye driver, esquema, migraciones, dominio, snapshots, servicios,
UI y pruebas existentes. [Auditoría reproducible](source-audit.json).

Se mantienen las garantías observadas de 5B.2:

- Captura privada validada; recuperación del singleton y liberación de permisos
  antes de exportar/publicar. SQLite y CSV proceden de esa captura.
- Nombres y manifiesto exclusivos por UUID, sin borrar, renombrar o truncar la
  generación anterior. Una URI ya existente no se acepta como documento nuevo.
- Relectura de tamaños/SHA-256, manifiesto final y comparación con el plan privado
  para trabajos propios. Una publicación parcial no se elige como generación válida.
- Estados durables e incertidumbre conservada; la recuperación no reconstruye una
  captura antigua con datos actuales ni repite operaciones financieras.
- CSV de tarjetas con `creditCard`, sin cambiar las otras consultas de exportación.

Estas son garantías dentro de las rutas y escenarios probados, no autenticación
criptográfica de manifiestos ajenos, durabilidad ante pérdida eléctrica ni prueba
de que un proveedor remoto terminó su sincronización.

## Transición del analista semanal

Se entrega [especificación completa](lector-semanal-v2.md) y
[bloque listo para incorporar](instrucciones-analista-semanal.md). El lector debe
enumerar candidatos, validar identidad/estructura, comprobar **todos** sus bytes,
tamaños y hashes, seleccionar el último íntegro y usar exclusivamente sus referencias.
Las fuentes v1 quedan `legacyUnverified`; un lector sin capacidad de hash debe
informar `verificationUnavailable`.

`generatedAt` se valida como instante real UTC y se presenta convertido mediante
`America/Bogota`, sin cambiar fechas civiles de movimientos. El ejemplo UTC que
cruza de día fue ejecutado con Intl; [resultado](clock-audit.json). La UI actual
usa la zona del dispositivo, no fuerza Bogotá; API 24 estaba en GMT y el HONOR en
Bogotá. No se cambiaron esas zonas ni se atribuyó cobertura semanal al timestamp
de preparación del trabajo.

No se encontró el código del analista externo en este repositorio. **No se modificó
ni contactó ninguna automatización o conversación ChatGPT externa.** Su incorporación
efectiva y pruebas con documentos sintéticos en esa herramienta son una condición
pendiente de aceptación, no un resultado simulado de esta entrega.

## Rendimiento y alcance de medición

La campaña completó cinco primeras capturas en cinco procesos distintos y cinco
capturas tras un calentamiento completo en el mismo proceso, por cada tamaño y API.
El resumen contiene **60 mediciones**, más seis calentamientos no contados,
en 42 campañas. Se usan las fuentes Kotlin y TypeScript actuales, release/Hermes y
el proveedor SAF sintético del paquete `com.smartfin.snapshot5b2.tests`.

«Frío» significa proceso recién iniciado/primer snapshot: no se purga la caché del
SO, no se reinicia el teléfono ni se afirma disco frío. Se evita el hash de todo el
origen en `getConstants` del instrumento previo, para no precalentar artificialmente
esos bytes; los hashes de captura/publicación de producción permanecen intactos.
La apertura inicial y comprobación del volumen se miden/separan antes de capturar.

Se registran espera por permisos, fuente JS, cierre, fuente Kotlin, copia/hash de
origen, integridad del snapshot, hash de destino, reapertura, revalidación privada
posterior, exportación CSV, hashes de componentes, escritura SAF y relecturas.
El escritor de contención confirma una transacción sintética de **+1 COP** después
de liberar la captura. Cada respaldo debe conservar el saldo anterior y la base
viva quedar exactamente +1; también se verifican tarjeta, comprobante IA, conteos,
tablas y CSV. No es una medición del formulario de pago ni una nueva regla financiera.

Los resultados de esta campaña se registran en [performance.md](performance.md),
[muestras](samples.json) y [resumen verificable](summary.json). Con n=5 se informa
mínimo/mediana/máximo, sin estimar p95 ni convertirlos en garantías para todos los OEM.
No se retiraron verificaciones, no se acortó la exclusión y no se afirma mejora
frente a muestras históricas con condiciones térmicas/cachés diferentes.

### Resultados observados

Captura en milisegundos, mínimo / mediana / máximo; cinco muestras por celda.
La espera del escritor incluye obtener de nuevo el singleton tras la captura.

| API | Movimientos | Captura fría de proceso | Captura caliente | Máxima espera del escritor |
|---|---:|---:|---:|---:|
| 24 | 1.000 | 285,98 / 328,17 / 374,48 | 197,61 / 218,40 / 260,91 | 376,11 |
| 24 | 10.000 | 368,50 / 407,65 / 575,23 | 320,37 / 330,70 / 335,55 | 579,26 |
| 24 | 100.000 | 1.642,63 / 1.693,86 / 1.948,73 | 1.605,69 / 1.789,84 / 1.944,96 | 1.951,47 |
| 35 | 1.000 | 291,34 / 343,28 / 533,43 | 290,16 / 447,19 / 806,28 | 813,49 |
| 35 | 10.000 | 560,17 / 573,03 / 600,41 | 561,81 / 1.088,06 / 1.149,60 | 1.159,83 |
| 35 | 100.000 | 3.836,70 / 4.026,47 / 4.760,66 | 4.255,13 / 5.713,84 / 6.268,04 | 6.275,96 |

API 24 corresponde al emulador y API 35 al HONOR físico: sus diferencias no aíslan
el efecto de la versión Android. No se observa una mejora caliente uniforme.
En HONOR/100.000, el escritor completó hasta en **6.303,13 ms**; la publicación
posterior alcanzó **38.230,67 ms**, fuera de la barrera financiera. El máximo de
captura + publicación de una misma muestra fue **42.485,80 ms**.

El valor de publicación más alto corresponde a la segunda repetición caliente:
**36.739,37 ms de exportación CSV**, 934,82 de revalidación privada, 84,73 de hash
de componentes, 272,83 de escritura SAF y 105,62 de relectura SAF. Estos temporizadores
localizan el coste en CSV; no permiten atribuir su causa a temperatura, CPU o disco.
El proveedor es local sintético: no hay medición de latencia ni confirmación de Drive.
Las etapas restantes, apertura/cierre, integridad y copia, se desglosan en
[performance.md](performance.md) y en cada muestra, sin sumar medianas independientes.

### Presupuesto de latencia propuesto

Son objetivos de producto pendientes de aprobación, no tiempos de expiración de
locks ni autorización para cancelar SQLite en curso o repetir operaciones financieras.

| Modalidad | Objetivo propuesto | Justificación y resultado |
|---|---|---|
| Manual, hasta 10.000 movimientos | Espera del escritor ≤2 s | Máximo observado 1,16 s; deja margen en estos dos dispositivos. Cumple esta campaña |
| Manual, 100.000 movimientos | Espera del escritor ≤6 s, con aviso previo de pausa | El máximo frío 4,76 s con aproximadamente 25% de margen motiva 6 s. El máximo caliente 6,28 s **incumple**; no se eleva el umbral para hacerlo pasar |
| Manual, preparación CSV y publicación posterior | ≤20 s con progreso persistente | Las muestras grandes rondan 10–15 s en HONOR, pero una alcanza 38,23 s: **incumple**. No es un SLA remoto |
| Automático dentro de la app | Espera del escritor ≤250 ms y sin pausas silenciosas de varios segundos | Incluso escenarios pequeños superan ese objetivo. **No aprobado**; requiere diseño y campaña propia de interferencia |

Se recomienda mantener el respaldo manual desactivado hasta resolver o explicar
con evidencia la variabilidad grande y acordar su UX; después, repetir los escenarios
afectados. Una decisión explícita de otro presupuesto requiere justificar el coste
para el usuario. La evidencia actual tampoco habilita respaldos automáticos; no se
ha implementado su planificación en este cierre.

## Revisión de UI y protección de envíos

| Aspecto | Comprobación y resultado |
|---|---|
| Captura | `AppNavigator` asigna «Capturando SQLite. Las operaciones financieras esperan...» antes de esperar la captura |
| Publicación | Hay mapa `snapshotValidated`/`publicationPending` y progreso por componentes; el sondeo es cada 750 ms, por lo que una operación breve puede saltar directamente a éxito |
| Recuperación | La sección muestra trabajos pendientes/inciertos y «Verificar trabajo original»; el servicio reutiliza el ID sin recapturar |
| Evitar duplicados | `active` del servicio rechaza otra exportación/verificación; el lock nativo y el registro durable rechazan otro trabajo pendiente. Regresiones existentes conservadas |
| Sincronización | El mensaje de éxito dice «mediante SAF»; la sección declara sincronización con nube sin confirmar y advierte de la raíz histórica congelada |
| Fechas | UI en zona del dispositivo; el contrato externo exige explícitamente Bogotá |

**Hallazgo UI-1, condición antes de habilitar.** Los botones no reciben un estado
disabled por trabajo activo. El wrapper actual `runSettingsTask` limpia siempre el
busy compartido en su propio `finally`: un segundo intento rechazado puede ocultar
el mensaje del primero mientras este sigue capturando/publicando. El servicio
protege la operación financiera; esa protección no acredita continuidad del progreso.
Se ejecutó el callback exacto extraído del archivo actual, con dos promesas sintéticas
y cero escrituras financieras: [repro y traza](ui-audit.json),
[instrumento](../../scripts/phase5b2Acceptance/ui-audit.cjs). No se dedujo de una
stale closure especulativa ni de un conteo de componentes.

**Hallazgo UI-2, condición antes de habilitar.** La rama de recuperación llama a
`verifyDriveBackupJob` sin callback de progreso; conserva el busy genérico
«Actualizando respaldo...» y no transmite sus estados/archivos de recuperación.
El sondeo de exportación no cubre esa rama. Se requiere un estado visual de dueño
único que abarque también recuperar, rechazar otro envío sin limpiar al dueño y
mostrar éxito/error/incertidumbre de la tarea correspondiente.

La bandera falsa impide ejecutar la ruta activada en la app. Esta revisión combina
fuente, regresiones de servicio y un repro del wrapper; **no certifica un recorrido
de UI activada en dispositivo**, accesibilidad, FPS o TTI. Las correcciones y ese
recorrido controlado se proponen como trabajo posterior explícito, sin cambios de
producción ni nuevas dependencias en este cierre.

## Contrato previo a 5C

Se entrega [orden de coordinación, estados, autorizaciones y matriz exigible](contrato-previo-fase5c.md).
El publicador actual no comparte un fence de borrado y el v2 no comunica linaje al
analista externo. Un backup íntegro anterior no debe presentarse como conjunto
vigente después de borrar. La solución exige admisión/revocación y drenaje antes
de SQLite, intención/recibo/época coherentes con el commit y un contrato externo
de actualidad, sin interpretar revisión o fecha como identidad.

No se ha añadido esa protección al borrado actual. Antes de coexistir con él, se
necesita la implementación autorizada del fence o una restricción de producto
explícita que impida esa combinación. No basta pedir al usuario que evite una carrera.
La eliminación de copias externas verificadas y la retención de evidencia incierta
requieren decisiones separadas; no están autorizadas ni implementadas aquí.

## Riesgos residuales y condiciones de aceptación

1. Incorporar realmente el contrato v2 al lector externo y probar sus capacidades;
   no analizar CSV fijos como actuales, no afirmar verificación sin hashes.
2. Resolver UI-1/UI-2 y probar el recorrido completo en paquete aislado sin cambiar
   esta bandera de producción; distinguir mensajes de captura, publicación y recuperación.
3. Aceptar el presupuesto manual tras revisar las mediciones y ampliar dispositivos
   representativos. Ninguna espera agotada permite liberar trabajo SQLite activo ni
   reintentar finanzas automáticamente.
4. Resolver la coexistencia con borrado y el contexto externo de linaje antes de
   habilitar ambos flujos. El contrato documentado no equivale a 5C implementada.
5. Mantener `cloudSync=unconfirmed` salvo evidencia remota independiente, y conservar
   incertidumbre ante permisos revocados, lecturas no fiables o cierre fallido.

## Validación final

La ejecución completa de Jest pasó **612 pruebas, 53 suites y 8 snapshots**; quedan
las tres pruebas de benchmark previamente omitidas. Pasaron también TypeScript,
ESLint y `git diff --check`. [Resultados y logs](quality/quality-results.json).
Se conservan las regresiones de respaldos, recuperación SQLite, IA, tarjetas,
suscripciones, pagos mínimos, gastos compartidos y dashboard. La auditoría confirma
que ninguno de los 464 archivos protegidos cambió durante este cierre.

Las 42 campañas terminaron y el resumen no tiene pendientes de medición. Esto no
convierte los hallazgos de aceptación en aprobados. La integridad técnica de 5B.2
no autoriza por sí sola activación pública o respaldos automáticos. No se altera
el driver, dominio, esquema, borrado ni la bandera.

Se restauró el ajuste temporal de pantalla del HONOR a `0`, se detuvo únicamente
el paquete sintético en ambos dispositivos y se apagó el emulador de esta sesión.
El teléfono físico permanece conectado. [Registro de cierre](session-closure.json).
Las pruebas utilizaron datos sintéticos y proveedor de prueba, sin acceder a Drive
real ni a bases financieras personales.
