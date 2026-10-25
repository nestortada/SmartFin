# Rendimiento HONOR, aceptación 5E

CRT-NX3, Android API 35, SQLite 3.44.5. Muestras instrumentadas con el APK release
aislado y la misma historia usada en API 24. No son percentiles ni garantías OEM.
Los resultados completos están en `android/api35/performance-final/result.json`.

| Etapa (ms) | 1.000 | 10.000 | 100.000 |
|---|---:|---:|---:|
| Dashboard | 149,50 | 222,53 | 4.937,56 |
| Historial, primera página | 330,09 | 1.160,09 | 79.202,57 |
| Pago y reconciliación | 174,71 | 89,67 | 397,15 |
| Mantenimiento de suscripciones | 265,32 | 78,69 | 194,73 |
| Captura | 901,11 | 615,01 | 5.814,62 |
| Espera hasta admisión financiera | 903,00 | 615,87 | 5.817,40 |
| Espera más finalización financiera | 978,64 | 658,14 | 5.952,63 |
| Exportación CSV | 67,49 | 240,66 | 13.295,91 |
| Escritura SAF | 58,55 | 57,07 | 220,53 |
| Relectura SAF | 22,40 | 22,27 | 107,52 |
| Publicación observada | 279,17 | 476,99 | 15.012,60 |
| Borrado más limpieza | 637,67 | 570,18 | 3.926,74 |

La captura/admisión y la publicación cumplen los objetivos provisionales en esta
muestra; a 100k la captura se acerca al límite de seis segundos. La exportación
CSV representa 13,30 s de los 15,00 s nativos de publicación; escritura y relectura
SAF suman 0,33 s. No es evidencia de un proveedor remoto lento. La captura informa
1,45 s de verificación del origen y 1,54 s de reapertura; no se atribuye el resto
a una causa que no esté instrumentada. No se midieron aviso/progreso UI.

El historial entrega una página, pero su latencia a 100k requiere atención. El
fixture masivo de `androidHarness.js` siembra `date='2026-10-24'`, sin fecha civil
ni hora. En `sqliteTransactionHistory.ts`, la comprobación de longitud rechaza
ese formato como canónico y el camino de compatibilidad recorre el conjunto en
lotes de 200 antes de ordenar IDs y devolver 50 filas. Por tanto, aquí se mide
la primera página sobre fechas heredadas, no únicamente el acceso indexado a
50 registros canónicos. Esto identifica el camino ejecutado por el código; no
aisla cuánto cuesta SQL, el puente o la ordenación. No se afirma que la asociación
de tarjetas sea la causa. Cualquier optimización requiere un encargo separado.

El dashboard de 100k tarda aproximadamente cinco segundos en ambas plataformas;
no existe presupuesto universal acordado y su causa no está aislada. No se
introducen tolerancias monetarias, parches de historial ni rediseños de SQLite.

## Repetición conservada

`android/api35/performance-repeat/result.json` repite el fixture completo con
el mismo APK y nuevas épocas. Todos los controles financieros e integridad pasan.

| Etapa (ms), repetición | 1.000 | 10.000 | 100.000 |
|---|---:|---:|---:|
| Dashboard | 41,38 | 297,36 | 5.009,51 |
| Historial, primera página | 87,95 | 2.406,75 | 83.001,38 |
| Pago y reconciliación | 63,05 | 154,02 | 466,02 |
| Mantenimiento | 118,11 | 199,35 | 249,20 |
| Captura | 677,65 | 1.431,07 | 6.253,93 |
| Espera hasta admisión financiera | 679,33 | 1.433,71 | 6.257,00 |
| Espera más finalización financiera | 737,55 | 1.553,31 | 6.380,55 |
| Exportación CSV | 69,91 | 240,86 | 13.748,77 |
| Escritura SAF | 39,84 | 59,56 | 324,45 |
| Relectura SAF | 14,29 | 22,20 | 213,85 |
| Publicación observada | 246,45 | 512,34 | 15.688,71 |
| Borrado más limpieza | 585,03 | 954,17 | 3.997,51 |

La espera a 100k **incumple el objetivo provisional de 6 s en esta repetición**
por 257 ms. No se redondea a cumplimiento ni se sustituye por la primera muestra.
El mismo escenario produjo 5,82 y 6,26 s: hay variabilidad y margen insuficiente;
un incumplimiento se observó una vez en dos muestras. No se afirma que ambas
repeticiones excedieran el objetivo. La verificación del origen permaneció en
1,44–1,45 s y la reapertura pasó de 1,54 a 2,05 s (+506 ms), mientras la captura
aumentó 439 ms. El aumento observado de reapertura explica temporalmente la
diferencia, pero no aísla su causa interna. Espera de permiso ~2 ms y checkpoint
~0,003 ms no explican ese exceso. Falta perfilado acotado de reapertura; no se
atribuyen causas a temperatura, disco u OEM sin evidencia.

La latencia de primera página heredada se reproduce (79,20/83,00 s), al igual que
el dashboard de ~5 s. Los objetivos de publicación de 20 s y espera de 2 s hasta
10k pasan en ambas muestras. CSV domina la publicación en las dos. Antes de fase
6, perfilar por sentencia el camino heredado y la reapertura, contrastar un fixture
canónico equivalente y volver a medir; cualquier parche se propone por separado,
sin asociación masiva de tarjetas, migraciones ni rediseño SQLite.
