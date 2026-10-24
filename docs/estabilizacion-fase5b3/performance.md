# Mediciones de estabilización 5B.3

Cinco primeras capturas en cinco procesos nuevos y cinco capturas tras calentamiento en un único proceso por tamaño/API. No se purgó la caché del SO ni se reinició el dispositivo. No son muestras de disco frío ni de TTI. El control evita el hash completo de inicio del harness previo para no precalentar todos los bytes. Apertura inicial y comprobación de volumen ocurren antes de capturar.

| API | Movimientos | Condición | n | Apertura inicial | Captura | Espera escritor | Fin escritor | Publicación |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| 24 | 1000 | cold | 5 | 231.39 / 263.53 / 265.57 | 272.38 / 304.80 / 484.25 | 274.40 / 308.49 / 494.29 | 281.77 / 318.55 / 514.45 | 198.07 / 204.99 / 230.08 |
| 24 | 1000 | warm | 5 | 354.67 / 354.67 / 354.67 | 155.26 / 231.50 / 276.54 | 156.53 / 234.10 / 279.49 | 164.40 / 244.47 / 289.02 | 206.35 / 215.79 / 240.86 |
| 24 | 10000 | cold | 5 | 284.40 / 291.72 / 368.17 | 374.39 / 407.87 / 464.63 | 375.92 / 409.61 / 469.22 | 387.68 / 416.98 / 485.80 | 378.07 / 404.91 / 436.25 |
| 24 | 10000 | warm | 5 | 249.09 / 249.09 / 249.09 | 340.39 / 352.92 / 504.84 | 343.56 / 354.66 / 507.25 | 352.59 / 366.02 / 520.00 | 387.37 / 430.61 / 500.72 |
| 24 | 100000 | cold | 5 | 570.46 / 587.93 / 597.78 | 1622.27 / 1691.36 / 1793.55 | 1624.55 / 1693.76 / 1795.56 | 1634.13 / 1703.33 / 1805.98 | 3142.62 / 3202.10 / 3351.14 |
| 24 | 100000 | warm | 5 | 566.25 / 566.25 / 566.25 | 1644.82 / 1855.60 / 1878.18 | 1647.91 / 1857.81 / 1882.35 | 1655.19 / 1867.47 / 1892.42 | 3130.80 / 3311.98 / 3493.51 |
| 35 | 1000 | cold | 5 | 320.73 / 376.72 / 525.66 | 327.32 / 334.77 / 343.56 | 332.30 / 336.97 / 345.53 | 341.49 / 343.68 / 352.96 | 183.03 / 213.52 / 228.95 |
| 35 | 1000 | warm | 5 | 358.25 / 358.25 / 358.25 | 295.89 / 452.58 / 1203.76 | 298.96 / 457.22 / 1215.36 | 307.20 / 472.72 / 1236.06 | 229.16 / 321.01 / 433.05 |
| 35 | 10000 | cold | 5 | 366.41 / 426.56 / 463.81 | 573.26 / 592.32 / 612.16 | 575.80 / 595.24 / 614.40 | 582.53 / 603.38 / 621.64 | 484.88 / 506.84 / 567.91 |
| 35 | 10000 | warm | 5 | 458.10 / 458.10 / 458.10 | 735.14 / 1054.10 / 1096.29 | 739.02 / 1058.23 / 1100.67 | 746.98 / 1068.82 / 1112.70 | 540.27 / 896.55 / 960.73 |
| 35 | 100000 | cold | 5 | 1109.99 / 1239.76 / 1656.86 | 4020.14 / 5688.75 / 5846.38 | 4025.36 / 5699.45 / 5854.97 | 4046.83 / 5730.99 / 5881.17 | 10040.37 / 17187.88 / 17222.40 |
| 35 | 100000 | warm | 5 | 1205.91 / 1205.91 / 1205.91 | 3963.48 / 4326.56 / 4555.95 | 3966.62 / 4335.39 / 4562.72 | 3975.95 / 4351.88 / 4581.84 | 9916.18 / 10017.14 / 10079.17 |

Cada celda: mínimo / mediana / máximo en ms. No se estima p95 con n=5. Warm-up completo separado, no contado entre las cinco mediciones. Las cinco aperturas iniciales warm pertenecen al mismo proceso y comparten su valor de contexto; no son cinco arranques.

Las fuentes de captura, publicador, CSV y driver coinciden con el código medido. Dos archivos de presentación recibieron después el ajuste de acceso revocado; sus hashes medidos/actuales están en summary.json. Esas pantallas no se montan en el banco nativo. El APK final de UI valida ese ajuste por separado.

| API | Movimientos | Condición | Espera permiso | Checkpoint* | Fuente JS | Cierre | Fuente Kotlin | Copia+hash origen | Integridad snapshot | Hash destino | Reapertura |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 24 | 1000 | cold | 0.80 | 0.01 | 78.83 | 0.93 | 31.76 | 13.27 | 26.72 | 2.58 | 154.29 |
| 24 | 1000 | warm | 0.56 | 0.01 | 51.77 | 0.77 | 13.70 | 7.55 | 14.47 | 2.77 | 130.90 |
| 24 | 10000 | cold | 0.59 | 0.01 | 98.81 | 1.30 | 53.76 | 18.49 | 39.62 | 8.40 | 172.79 |
| 24 | 10000 | warm | 0.68 | 0.01 | 77.34 | 1.41 | 50.75 | 16.31 | 41.04 | 6.91 | 154.19 |
| 24 | 100000 | cold | 0.65 | 0.01 | 353.05 | 1.90 | 346.15 | 145.92 | 320.94 | 55.88 | 432.54 |
| 24 | 100000 | warm | 0.53 | 0.01 | 357.29 | 2.06 | 345.74 | 173.54 | 406.85 | 54.95 | 412.89 |
| 35 | 1000 | cold | 0.76 | 0.00 | 84.01 | 1.57 | 23.49 | 10.51 | 21.99 | 1.83 | 183.89 |
| 35 | 1000 | warm | 0.68 | 0.00 | 79.11 | 1.72 | 22.61 | 14.96 | 22.42 | 1.67 | 317.99 |
| 35 | 10000 | cold | 0.80 | 0.00 | 135.63 | 1.80 | 90.42 | 25.38 | 78.75 | 4.43 | 242.09 |
| 35 | 10000 | warm | 0.92 | 0.00 | 228.37 | 3.28 | 146.45 | 37.10 | 133.90 | 6.82 | 439.89 |
| 35 | 100000 | cold | 0.61 | 0.00 | 869.94 | 1.72 | 1054.79 | 301.11 | 1424.75 | 52.66 | 1920.60 |
| 35 | 100000 | warm | 1.07 | 0.00 | 1006.31 | 5.04 | 873.95 | 185.15 | 825.85 | 31.71 | 1322.02 |

| API | Movimientos | Condición | Revalidación posterior | CSV | Hash componentes | Escritura SAF | Relectura SAF |
|---|---:|---|---:|---:|---:|---:|---:|
| 24 | 1000 | cold | 18.73 | 25.15 | 5.03 | 21.39 | 13.17 |
| 24 | 1000 | warm | 26.04 | 14.96 | 3.10 | 41.73 | 14.60 |
| 24 | 10000 | cold | 51.64 | 147.84 | 12.09 | 30.79 | 30.39 |
| 24 | 10000 | warm | 53.06 | 146.48 | 13.42 | 43.45 | 32.17 |
| 24 | 100000 | cold | 392.39 | 2246.08 | 84.86 | 134.50 | 169.13 |
| 24 | 100000 | warm | 376.82 | 2292.51 | 84.94 | 205.38 | 183.89 |
| 35 | 1000 | cold | 28.15 | 55.18 | 3.94 | 49.69 | 14.40 |
| 35 | 1000 | warm | 40.27 | 45.07 | 4.81 | 88.71 | 16.28 |
| 35 | 10000 | cold | 96.24 | 265.55 | 7.93 | 64.95 | 22.09 |
| 35 | 10000 | warm | 147.25 | 358.90 | 13.57 | 156.23 | 39.56 |
| 35 | 100000 | cold | 1524.84 | 14902.92 | 81.92 | 381.74 | 164.91 |
| 35 | 100000 | warm | 879.20 | 8610.15 | 47.72 | 261.47 | 99.59 |

Etapas: medianas independientes, no deben sumarse como una muestra real. *Checkpoint es el coste de la rama de journal rollback; no se ejecutó WAL checkpoint en esta campaña. La validación WAL pertenece a las regresiones previas atestadas, no a una medición omitida. Fuente JS incluye puente/FK/metadatos; reapertura incluye recuperación 1.1. Publicación incluye staging, comprobaciones, metadatos y proveedor SAF local sintético; no mide Drive remoto.

El escritor de contención es una transacción sintética que suma 1 COP a la cuenta banco después de liberar la captura. Se mide la espera antes de obtener el singleton y el tiempo hasta COMMIT; no es una medición del formulario de pago. Cada respaldo mantiene el saldo anterior, sus tablas, su tarjeta y un comprobante IA; la base viva queda exactamente +1 COP respecto a ese snapshot. No se cambiaron las verificaciones ni la exclusión de producción.
