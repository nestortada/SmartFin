# Mediciones de aceptación 5B.2

Cinco primeras capturas en cinco procesos nuevos y cinco capturas tras calentamiento en un único proceso por tamaño/API. No se purgó la caché del SO ni se reinició el dispositivo. No son muestras de disco frío ni de TTI. El control evita el hash completo de inicio del harness previo para no precalentar todos los bytes. Apertura inicial y comprobación de volumen ocurren antes de capturar.

| API | Movimientos | Condición | n | Apertura inicial | Captura | Espera escritor | Fin escritor | Publicación |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| 24 | 1000 | cold | 5 | 277.62 / 320.86 / 336.66 | 285.98 / 328.17 / 374.48 | 288.34 / 331.11 / 376.11 | 298.60 / 345.11 / 391.24 | 221.74 / 244.57 / 299.49 |
| 24 | 1000 | warm | 5 | 376.95 / 376.95 / 376.95 | 197.61 / 218.40 / 260.91 | 199.47 / 220.22 / 262.89 | 209.61 / 227.56 / 274.75 | 207.25 / 222.23 / 254.35 |
| 24 | 10000 | cold | 5 | 292.99 / 296.11 / 311.49 | 368.50 / 407.65 / 575.23 | 369.69 / 409.06 / 579.26 | 378.15 / 418.73 / 590.64 | 421.53 / 422.53 / 432.37 |
| 24 | 10000 | warm | 5 | 320.71 / 320.71 / 320.71 | 320.37 / 330.70 / 335.55 | 324.45 / 332.83 / 337.80 | 334.32 / 340.88 / 347.57 | 385.67 / 402.61 / 403.57 |
| 24 | 100000 | cold | 5 | 575.72 / 641.41 / 767.75 | 1642.63 / 1693.86 / 1948.73 | 1644.34 / 1697.64 / 1951.47 | 1653.23 / 1709.72 / 1960.50 | 3267.95 / 3466.25 / 3818.19 |
| 24 | 100000 | warm | 5 | 586.54 / 586.54 / 586.54 | 1605.69 / 1789.84 / 1944.96 | 1608.25 / 1793.26 / 1947.57 | 1617.40 / 1804.97 / 1957.92 | 3351.35 / 3536.46 / 3741.97 |
| 35 | 1000 | cold | 5 | 351.50 / 432.17 / 548.47 | 291.34 / 343.28 / 533.43 | 293.55 / 345.22 / 538.97 | 299.56 / 350.75 / 551.04 | 179.75 / 243.35 / 292.23 |
| 35 | 1000 | warm | 5 | 349.82 / 349.82 / 349.82 | 290.16 / 447.19 / 806.28 | 292.00 / 450.01 / 813.49 | 296.82 / 457.93 / 832.46 | 229.82 / 273.49 / 322.30 |
| 35 | 10000 | cold | 5 | 392.16 / 455.33 / 562.57 | 560.17 / 573.03 / 600.41 | 563.93 / 575.85 / 602.30 | 573.24 / 583.56 / 611.18 | 529.00 / 550.64 / 600.16 |
| 35 | 10000 | warm | 5 | 392.46 / 392.46 / 392.46 | 561.81 / 1088.06 / 1149.60 | 565.07 / 1090.17 / 1159.83 | 575.00 / 1100.79 / 1180.45 | 554.88 / 739.65 / 820.82 |
| 35 | 100000 | cold | 5 | 1208.45 / 1217.47 / 1299.19 | 3836.70 / 4026.47 / 4760.66 | 3839.66 / 4031.60 / 4764.39 | 3849.27 / 4043.36 / 4774.45 | 10312.74 / 10329.29 / 13735.02 |
| 35 | 100000 | warm | 5 | 1633.20 / 1633.20 / 1633.20 | 4255.13 / 5713.84 / 6268.04 | 4260.25 / 5718.93 / 6275.96 | 4267.89 / 5733.42 / 6303.13 | 10301.97 / 14747.11 / 38230.67 |

Cada celda: mínimo / mediana / máximo en ms. No se estima p95 con n=5. Warm-up completo separado, no contado entre las cinco mediciones. Las cinco aperturas iniciales warm pertenecen al mismo proceso y comparten su valor de contexto; no son cinco arranques.

| API | Movimientos | Condición | Espera permiso | Checkpoint* | Fuente JS | Cierre | Fuente Kotlin | Copia+hash origen | Integridad snapshot | Hash destino | Reapertura |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 24 | 1000 | cold | 0.86 | 0.01 | 96.64 | 0.89 | 30.38 | 9.90 | 18.28 | 2.45 | 144.10 |
| 24 | 1000 | warm | 0.48 | 0.01 | 50.07 | 0.89 | 15.19 | 15.24 | 13.71 | 2.20 | 109.46 |
| 24 | 10000 | cold | 0.90 | 0.01 | 100.92 | 1.44 | 56.60 | 27.92 | 46.25 | 7.85 | 160.90 |
| 24 | 10000 | warm | 0.50 | 0.01 | 70.95 | 1.18 | 37.47 | 18.35 | 40.19 | 7.68 | 138.04 |
| 24 | 100000 | cold | 0.69 | 0.01 | 363.94 | 2.23 | 325.10 | 133.03 | 350.40 | 59.21 | 451.35 |
| 24 | 100000 | warm | 0.57 | 0.01 | 363.89 | 1.84 | 334.75 | 167.21 | 329.06 | 56.69 | 438.74 |
| 35 | 1000 | cold | 0.79 | 0.00 | 98.62 | 1.48 | 21.59 | 11.21 | 22.40 | 1.81 | 168.28 |
| 35 | 1000 | warm | 0.66 | 0.00 | 76.72 | 1.52 | 22.99 | 15.15 | 22.13 | 1.69 | 308.95 |
| 35 | 10000 | cold | 0.94 | 0.00 | 125.81 | 1.76 | 84.62 | 26.37 | 78.70 | 4.22 | 236.69 |
| 35 | 10000 | warm | 1.73 | 0.00 | 233.17 | 4.38 | 132.15 | 34.70 | 114.13 | 5.57 | 418.83 |
| 35 | 100000 | cold | 0.53 | 0.00 | 866.85 | 1.68 | 827.77 | 190.28 | 835.59 | 31.96 | 1257.32 |
| 35 | 100000 | warm | 1.14 | 0.00 | 1426.35 | 11.61 | 1223.54 | 243.49 | 1163.96 | 41.66 | 1518.50 |

| API | Movimientos | Condición | Revalidación posterior | CSV | Hash componentes | Escritura SAF | Relectura SAF |
|---|---:|---|---:|---:|---:|---:|---:|
| 24 | 1000 | cold | 28.34 | 34.40 | 5.17 | 28.13 | 15.65 |
| 24 | 1000 | warm | 25.33 | 14.59 | 4.13 | 33.55 | 13.59 |
| 24 | 10000 | cold | 48.34 | 171.09 | 11.88 | 24.72 | 31.02 |
| 24 | 10000 | warm | 46.65 | 152.88 | 10.84 | 38.15 | 29.05 |
| 24 | 100000 | cold | 386.71 | 2516.73 | 84.08 | 154.62 | 178.28 |
| 24 | 100000 | warm | 370.73 | 2446.93 | 83.68 | 228.22 | 197.62 |
| 35 | 1000 | cold | 26.96 | 65.55 | 4.16 | 62.15 | 15.66 |
| 35 | 1000 | warm | 29.98 | 41.89 | 4.10 | 74.58 | 16.68 |
| 35 | 10000 | cold | 95.59 | 305.22 | 7.73 | 65.06 | 21.90 |
| 35 | 10000 | warm | 119.23 | 345.05 | 10.40 | 118.09 | 30.60 |
| 35 | 100000 | cold | 895.83 | 9007.69 | 48.70 | 243.13 | 101.94 |
| 35 | 100000 | warm | 1240.96 | 12738.46 | 67.73 | 342.47 | 140.66 |

Etapas: medianas independientes, no deben sumarse como una muestra real. *Checkpoint es el coste de la rama de journal rollback; no se ejecutó WAL checkpoint en esta campaña. La validación WAL pertenece a las regresiones previas atestadas, no a una medición omitida. Fuente JS incluye puente/FK/metadatos; reapertura incluye recuperación 1.1. Publicación incluye staging, comprobaciones, metadatos y proveedor SAF local sintético; no mide Drive remoto.

El escritor de contención es una transacción sintética que suma 1 COP a la cuenta banco después de liberar la captura. Se mide la espera antes de obtener el singleton y el tiempo hasta COMMIT; no es una medición del formulario de pago. Cada respaldo mantiene el saldo anterior, sus tablas, su tarjeta y un comprobante IA; la base viva queda exactamente +1 COP respecto a ese snapshot. No se cambiaron las verificaciones ni la exclusión de producción.
