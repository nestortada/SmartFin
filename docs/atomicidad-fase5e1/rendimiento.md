# Rendimiento 5E.1

Muestras instrumentadas, sin percentiles ni promesas OEM. Tiempos en ms.

## API 24: fixture integrado 5E repetido

| Movimientos | Historial 5E | Historial 5E.1 | Dashboard 5E.1 | Captura 5E.1 | Admisión 5E.1 |
|---|---:|---:|---:|---:|---:|
| 1000 | falla 5E-001 | 40.49 | 16.92 | 210.79 | 211.82 |
| 10000 | falla 5E-001 | 359.76 | 100.91 | 300.82 | 302.40 |
| 100000 | falla 5E-001 | 12981.16 | 2099.08 | 1568.10 | 1570.25 |

## Mismo fixture, SQL anterior y corregido, API 24

| Fixture newest | Antes | Después |
|---|---:|---:|
| mixed-1000 | falla; intento de 6.39 ms | 37.47 |
| civil-1000 | falla; intento de 5.27 ms | 12.75 |
| legacy-1000 | falla; intento de 5.54 ms | 48.14 |
| civil-10000 | falla; intento de 5.18 ms | 25.72 |
| legacy-10000 | falla; intento de 7.01 ms | 403.37 |
| civil-100000 | falla; intento de 7.19 ms | 162.12 |
| legacy-100000 | falla; intento de 7.01 ms | 22852.32 |

El SQL anterior se ejecuta primero sobre otro proxy sin caché de pruebas; el cache de páginas del SO puede calentarse. Son pares secuenciales, no un experimento aleatorizado. No se atribuyen diferencias pequeñas al parche.

## Páginas frías y búsquedas, API 24

| Fixture | Consulta | Check inicial | Await SQL/puente | Filas JS | Admisión | Construcción/resto JS | Total |
|---|---|---:|---:|---:|---:|---:|---:|
| mixed-1000 | newest | 1.93 | 31.97 | 1.22 | 5.28 | 4.29 | 37.47 |
| mixed-1000 | oldest | 1.34 | 30.42 | 1.02 | 3.27 | 4.29 | 35.74 |
| mixed-1000 | merchant 49 | 7.63 | 38.41 | 0.98 | 6.03 | 4.27 | 43.66 |
| mixed-1000 | árbol | 1.86 | 31.50 | 1.11 | 4.82 | 5.44 | 38.05 |
| mixed-1000 | not found | 1.58 | 30.59 | 0.87 | 4.03 | 4.09 | 35.55 |
| mixed-1000 | %_ + filtros | 1.60 | 11.45 | 0.22 | 2.60 | 1.07 | 12.74 |
| civil-1000 | newest | 4.55 | 12.17 | 0.15 | 2.95 | 0.43 | 12.75 |
| civil-1000 | oldest | 3.69 | 12.70 | 0.15 | 2.11 | 0.97 | 13.82 |
| civil-1000 | merchant 49 | 4.40 | 40.60 | 1.07 | 5.36 | 5.83 | 47.49 |
| civil-1000 | árbol | 3.53 | 18.15 | 0.49 | 2.61 | 1.97 | 20.61 |
| civil-1000 | not found | 4.64 | 39.56 | 1.01 | 5.64 | 5.44 | 46.01 |
| civil-1000 | %_ + filtros | 6.01 | 20.97 | 0.29 | 3.37 | 0.68 | 21.94 |
| legacy-1000 | newest | 2.36 | 41.81 | 1.55 | 7.29 | 4.78 | 48.14 |
| legacy-1000 | oldest | 3.60 | 46.34 | 1.34 | 7.60 | 4.57 | 52.24 |
| legacy-1000 | merchant 49 | 2.15 | 41.15 | 1.45 | 5.34 | 5.13 | 47.72 |
| legacy-1000 | árbol | 1.85 | 37.28 | 1.07 | 6.01 | 5.08 | 43.43 |
| legacy-1000 | not found | 4.56 | 41.95 | 1.01 | 5.17 | 4.85 | 47.80 |
| legacy-1000 | %_ + filtros | 1.99 | 13.23 | 0.31 | 2.05 | 1.26 | 14.80 |
| civil-10000 | newest | 15.32 | 25.03 | 0.16 | 4.01 | 0.53 | 25.72 |
| civil-10000 | oldest | 6.97 | 32.11 | 0.14 | 1.87 | 0.49 | 32.74 |
| civil-10000 | merchant 49 | 8.58 | 73.40 | 2.59 | 8.39 | 8.42 | 84.41 |
| civil-10000 | árbol | 7.39 | 39.64 | 1.54 | 4.74 | 5.99 | 47.17 |
| civil-10000 | not found | 9.27 | 261.62 | 9.56 | 28.46 | 45.92 | 317.11 |
| civil-10000 | %_ + filtros | 9.52 | 30.66 | 0.44 | 3.24 | 0.69 | 31.79 |
| legacy-10000 | newest | 1.60 | 346.82 | 10.24 | 29.89 | 46.30 | 403.37 |
| legacy-10000 | oldest | 1.93 | 328.56 | 9.90 | 24.37 | 53.99 | 392.44 |
| legacy-10000 | merchant 49 | 1.92 | 556.16 | 9.98 | 32.28 | 40.90 | 607.04 |
| legacy-10000 | árbol | 1.54 | 339.57 | 10.58 | 34.20 | 55.88 | 406.03 |
| legacy-10000 | not found | 1.46 | 585.12 | 9.92 | 29.38 | 40.89 | 635.93 |
| legacy-10000 | %_ + filtros | 1.75 | 78.37 | 1.70 | 6.68 | 12.26 | 92.33 |
| civil-100000 | newest | 151.91 | 161.51 | 0.15 | 3.71 | 0.46 | 162.12 |
| civil-100000 | oldest | 109.22 | 393.24 | 0.14 | 2.53 | 0.40 | 393.78 |
| civil-100000 | merchant 49 | 109.94 | 147.05 | 1.38 | 6.08 | 5.13 | 153.55 |
| civil-100000 | árbol | 106.29 | 363.79 | 9.92 | 32.61 | 51.87 | 425.57 |
| civil-100000 | not found | 114.99 | 2745.17 | 98.57 | 261.41 | 424.55 | 3268.29 |
| civil-100000 | %_ + filtros | 110.46 | 258.70 | 0.29 | 2.80 | 0.62 | 259.61 |
| legacy-100000 | newest | 3.60 | 21312.67 | 168.81 | 703.94 | 1370.83 | 22852.32 |
| legacy-100000 | oldest | 2.13 | 12902.93 | 99.15 | 267.68 | 553.62 | 13555.70 |
| legacy-100000 | merchant 49 | 1.85 | 35709.38 | 98.55 | 294.37 | 413.10 | 36221.03 |
| legacy-100000 | árbol | 1.89 | 12967.69 | 97.36 | 286.48 | 497.68 | 13562.72 |
| legacy-100000 | not found | 2.38 | 35168.33 | 95.67 | 282.49 | 411.83 | 35675.83 |
| legacy-100000 | %_ + filtros | 3.04 | 2942.86 | 16.50 | 45.65 | 129.05 | 3088.41 |

## Replay nativo independiente, API 24

| Fixture | Caso | Admisión/apertura | SQL hasta primera fila | Cursor/filas | Sentencias |
|---|---|---:|---:|---:|---:|
| mixed-1000 | newest | 2.57 | 2.30 | 3.05 | 10 |
| mixed-1000 | oldest | 2.17 | 2.19 | 1.90 | 10 |
| mixed-1000 | merchant 49 | 2.01 | 4.01 | 1.63 | 10 |
| mixed-1000 | árbol | 2.18 | 2.64 | 2.69 | 10 |
| mixed-1000 | not found | 1.87 | 3.58 | 1.66 | 9 |
| mixed-1000 | %_ | 1.89 | 1.19 | 0.35 | 5 |
| civil-1000 | newest | 2.08 | 1.52 | 0.72 | 5 |
| civil-1000 | oldest | 2.57 | 3.24 | 0.27 | 5 |
| civil-1000 | merchant 49 | 4.47 | 4.50 | 1.96 | 11 |
| civil-1000 | árbol | 2.29 | 2.23 | 0.91 | 7 |
| civil-1000 | not found | 2.34 | 4.38 | 1.92 | 10 |
| civil-1000 | %_ | 2.50 | 2.68 | 0.57 | 6 |
| legacy-1000 | newest | 2.21 | 4.28 | 2.50 | 10 |
| legacy-1000 | oldest | 2.64 | 3.70 | 1.92 | 10 |
| legacy-1000 | merchant 49 | 2.05 | 7.06 | 1.56 | 10 |
| legacy-1000 | árbol | 2.85 | 3.17 | 1.87 | 10 |
| legacy-1000 | not found | 2.09 | 7.27 | 1.56 | 9 |
| legacy-1000 | %_ | 2.17 | 1.74 | 0.55 | 5 |
| civil-10000 | newest | 3.23 | 10.86 | 0.64 | 5 |
| civil-10000 | oldest | 2.41 | 28.45 | 0.27 | 5 |
| civil-10000 | merchant 49 | 4.32 | 19.72 | 4.32 | 14 |
| civil-10000 | árbol | 2.05 | 7.73 | 2.28 | 11 |
| civil-10000 | not found | 2.05 | 34.26 | 23.81 | 55 |
| civil-10000 | %_ | 2.09 | 13.58 | 0.62 | 6 |
| legacy-10000 | newest | 2.27 | 115.10 | 20.18 | 55 |
| legacy-10000 | oldest | 2.40 | 111.60 | 17.41 | 55 |
| legacy-10000 | merchant 49 | 2.82 | 364.15 | 17.13 | 55 |
| legacy-10000 | árbol | 2.01 | 115.35 | 16.74 | 55 |
| legacy-10000 | not found | 2.91 | 357.71 | 17.02 | 54 |
| legacy-10000 | %_ | 2.15 | 30.47 | 2.82 | 13 |
| civil-100000 | newest | 3.32 | 141.58 | 0.42 | 5 |
| civil-100000 | oldest | 2.33 | 376.74 | 0.26 | 5 |
| civil-100000 | merchant 49 | 3.14 | 115.85 | 2.94 | 12 |
| civil-100000 | árbol | 2.17 | 139.95 | 21.60 | 59 |
| civil-100000 | not found | 3.92 | 619.62 | 179.41 | 505 |
| civil-100000 | %_ | 2.54 | 244.24 | 0.55 | 6 |
| legacy-100000 | newest | 6.24 | 18420.71 | 328.19 | 505 |
| legacy-100000 | oldest | 3.68 | 10660.30 | 179.40 | 505 |
| legacy-100000 | merchant 49 | 8.91 | 32633.66 | 167.51 | 505 |
| legacy-100000 | árbol | 3.54 | 10918.46 | 169.52 | 505 |
| legacy-100000 | not found | 4.83 | 32337.30 | 180.38 | 504 |
| legacy-100000 | %_ | 2.37 | 2426.23 | 27.45 | 88 |

## API 35: fixture integrado 5E repetido

| Movimientos | Historial 5E | Historial 5E.1 | Dashboard 5E.1 | Captura 5E.1 | Admisión 5E.1 |
|---|---:|---:|---:|---:|---:|
| 1000 | 87.95 | 275.06 | 156.10 | 1324.77 | 1327.93 |
| 10000 | 2406.75 | 3223.64 | 379.38 | 1653.07 | 1657.34 |
| 100000 | 83001.38 | 62289.62 | 3506.69 | 4812.25 | 4815.50 |

## Mismo fixture, SQL anterior y corregido, API 35

| Fixture newest | Antes | Después |
|---|---:|---:|
| mixed-1000 | 81.08 | 78.09 |
| civil-1000 | 21.28 | 18.71 |
| legacy-1000 | 78.87 | 77.68 |
| civil-10000 | 22.33 | 19.97 |
| legacy-10000 | 1097.06 | 3013.07 |
| civil-100000 | 220.82 | 94.11 |
| legacy-100000 | 134574.74 | 115256.76 |

El SQL anterior se ejecuta primero sobre otro proxy sin caché de pruebas; el cache de páginas del SO puede calentarse. Son pares secuenciales, no un experimento aleatorizado. No se atribuyen diferencias pequeñas al parche.

En las campañas detalladas HONOR no se mantuvo la pantalla inicialmente. Se observó Asleep a las 18:51 Bogotá y se pasó a Awake/stayOn a las 18:52, conservando el proceso 24404. Las muestras previas o que cruzan ese cambio son diagnósticas, no una comparación causal controlada. La campaña integrada posterior usa pantalla mantenida, como la muestra 5E anterior. El estado previo se restaura al cierre.

## Páginas frías y búsquedas, API 35

| Fixture | Consulta | Check inicial | Await SQL/puente | Filas JS | Admisión | Construcción/resto JS | Total |
|---|---|---:|---:|---:|---:|---:|---:|
| mixed-1000 | newest | 2.26 | 60.82 | 3.45 | 6.38 | 13.82 | 78.09 |
| mixed-1000 | oldest | 1.59 | 60.74 | 3.32 | 5.16 | 13.36 | 77.42 |
| mixed-1000 | merchant 49 | 1.73 | 65.27 | 3.13 | 5.82 | 11.77 | 80.16 |
| mixed-1000 | árbol | 2.29 | 62.11 | 3.45 | 5.99 | 13.26 | 78.82 |
| mixed-1000 | not found | 1.70 | 59.32 | 3.05 | 5.33 | 11.47 | 73.84 |
| mixed-1000 | %_ + filtros | 2.40 | 20.20 | 0.72 | 2.73 | 2.85 | 23.77 |
| civil-1000 | newest | 6.02 | 17.20 | 0.45 | 2.82 | 1.05 | 18.71 |
| civil-1000 | oldest | 5.94 | 17.37 | 0.45 | 2.73 | 1.45 | 19.28 |
| civil-1000 | merchant 49 | 5.87 | 66.46 | 3.04 | 6.36 | 11.35 | 80.86 |
| civil-1000 | árbol | 5.95 | 36.28 | 1.71 | 4.17 | 5.44 | 43.43 |
| civil-1000 | not found | 5.92 | 64.67 | 2.98 | 6.42 | 11.54 | 79.19 |
| civil-1000 | %_ + filtros | 5.79 | 26.18 | 0.92 | 3.71 | 1.69 | 28.79 |
| legacy-1000 | newest | 2.24 | 62.09 | 3.34 | 5.95 | 12.25 | 77.68 |
| legacy-1000 | oldest | 1.99 | 66.81 | 3.40 | 6.28 | 13.18 | 83.39 |
| legacy-1000 | merchant 49 | 2.32 | 79.10 | 3.16 | 6.24 | 11.03 | 93.28 |
| legacy-1000 | árbol | 1.93 | 63.40 | 3.39 | 6.71 | 12.99 | 79.78 |
| legacy-1000 | not found | 2.08 | 74.68 | 2.98 | 6.03 | 10.38 | 88.04 |
| legacy-1000 | %_ + filtros | 2.35 | 22.64 | 0.91 | 3.44 | 3.80 | 27.35 |
| civil-10000 | newest | 7.35 | 18.63 | 0.40 | 3.40 | 0.94 | 19.97 |
| civil-10000 | oldest | 39.59 | 110.76 | 1.09 | 8.71 | 2.33 | 114.18 |
| civil-10000 | merchant 49 | 34.57 | 341.35 | 16.47 | 26.98 | 50.74 | 408.56 |
| civil-10000 | árbol | 19.41 | 214.46 | 9.54 | 31.70 | 37.73 | 261.72 |
| civil-10000 | not found | 41.06 | 1468.19 | 75.58 | 112.92 | 308.62 | 1852.40 |
| civil-10000 | %_ + filtros | 52.40 | 139.90 | 2.15 | 11.62 | 3.46 | 145.51 |
| legacy-10000 | newest | 4.68 | 2389.80 | 230.35 | 135.77 | 392.92 | 3013.07 |
| legacy-10000 | oldest | 5.62 | 2431.98 | 126.20 | 127.18 | 469.65 | 3027.82 |
| legacy-10000 | merchant 49 | 5.74 | 6869.12 | 251.35 | 99.84 | 869.28 | 7989.76 |
| legacy-10000 | árbol | 3.40 | 2499.12 | 187.78 | 92.91 | 796.76 | 3483.66 |
| legacy-10000 | not found | 5.85 | 6947.50 | 252.55 | 105.31 | 867.37 | 8067.42 |
| legacy-10000 | %_ + filtros | 3.91 | 579.67 | 27.31 | 18.98 | 154.38 | 761.35 |
| civil-100000 | newest | 57.61 | 89.55 | 1.61 | 5.18 | 2.95 | 94.11 |
| civil-100000 | oldest | 58.03 | 171.96 | 1.85 | 5.61 | 2.66 | 176.46 |
| civil-100000 | merchant 49 | 91.02 | 426.05 | 31.60 | 18.29 | 102.47 | 560.12 |
| civil-100000 | árbol | 54.62 | 2455.62 | 244.88 | 98.29 | 969.85 | 3670.34 |
| civil-100000 | not found | 54.91 | 21663.87 | 2087.53 | 829.41 | 7673.76 | 31425.17 |
| civil-100000 | %_ + filtros | 1069.41 | 2275.17 | 2.54 | 6.35 | 3.68 | 2281.39 |
| legacy-100000 | newest | 4.02 | 109689.22 | 2376.60 | 971.98 | 3190.95 | 115256.76 |
| legacy-100000 | oldest | 3.16 | 95555.85 | 2690.21 | 1016.70 | 6520.04 | 104766.11 |
| legacy-100000 | merchant 49 | 4.03 | 523452.84 | 1060.88 | 607.73 | 3951.00 | 528464.72 |
| legacy-100000 | árbol | 3.99 | 105401.24 | 2335.60 | 913.24 | 9201.63 | 116938.47 |
| legacy-100000 | not found | 4.73 | 426585.45 | 1457.93 | 733.18 | 5248.86 | 433292.25 |
| legacy-100000 | %_ + filtros | 5.30 | 14343.01 | 464.12 | 199.11 | 2010.55 | 16817.69 |

## Replay nativo independiente, API 35

| Fixture | Caso | Admisión/apertura | SQL hasta primera fila | Cursor/filas | Sentencias |
|---|---|---:|---:|---:|---:|
| mixed-1000 | newest | 3.04 | 6.12 | 3.76 | 10 |
| mixed-1000 | oldest | 3.19 | 6.19 | 3.69 | 10 |
| mixed-1000 | merchant 49 | 3.13 | 11.09 | 3.61 | 10 |
| mixed-1000 | árbol | 3.14 | 6.17 | 3.78 | 10 |
| mixed-1000 | not found | 2.98 | 10.85 | 3.40 | 9 |
| mixed-1000 | %_ | 3.34 | 2.95 | 0.74 | 5 |
| civil-1000 | newest | 3.11 | 2.42 | 0.49 | 5 |
| civil-1000 | oldest | 3.21 | 2.80 | 0.48 | 5 |
| civil-1000 | merchant 49 | 3.18 | 9.40 | 3.70 | 11 |
| civil-1000 | árbol | 3.03 | 4.56 | 1.82 | 7 |
| civil-1000 | not found | 3.07 | 9.06 | 3.58 | 10 |
| civil-1000 | %_ | 3.08 | 4.65 | 1.04 | 6 |
| legacy-1000 | newest | 3.25 | 9.77 | 3.67 | 10 |
| legacy-1000 | oldest | 3.39 | 9.73 | 3.78 | 10 |
| legacy-1000 | merchant 49 | 3.17 | 23.26 | 3.54 | 10 |
| legacy-1000 | árbol | 3.06 | 9.57 | 3.72 | 10 |
| legacy-1000 | not found | 3.11 | 23.24 | 3.43 | 9 |
| legacy-1000 | %_ | 3.13 | 3.19 | 0.95 | 5 |
| civil-10000 | newest | 3.26 | 4.99 | 0.52 | 5 |
| civil-10000 | oldest | 21.80 | 41.59 | 1.96 | 5 |
| civil-10000 | merchant 49 | 7.96 | 48.90 | 12.84 | 14 |
| civil-10000 | árbol | 5.45 | 22.45 | 7.44 | 11 |
| civil-10000 | not found | 5.95 | 109.33 | 41.30 | 55 |
| civil-10000 | %_ | 3.20 | 31.34 | 1.05 | 6 |
| legacy-10000 | newest | 7.67 | 462.17 | 32.64 | 55 |
| legacy-10000 | oldest | 18.25 | 1312.57 | 83.57 | 55 |
| legacy-10000 | merchant 49 | 8.77 | 4698.45 | 78.28 | 55 |
| legacy-10000 | árbol | 8.44 | 1274.84 | 78.59 | 55 |
| legacy-10000 | not found | 8.78 | 4733.17 | 77.88 | 54 |
| legacy-10000 | %_ | 8.17 | 354.38 | 14.62 | 13 |
| civil-100000 | newest | 19.48 | 80.68 | 1.39 | 5 |
| civil-100000 | oldest | 12.34 | 139.34 | 1.32 | 5 |
| civil-100000 | merchant 49 | 12.44 | 132.44 | 14.28 | 12 |
| civil-100000 | árbol | 8.02 | 386.02 | 103.79 | 59 |
| civil-100000 | not found | 8.74 | 5439.68 | 887.14 | 505 |
| civil-100000 | %_ | 8.13 | 2221.29 | 2.71 | 6 |
| legacy-100000 | newest | 13.45 | 116027.03 | 794.97 | 505 |
| legacy-100000 | oldest | 7.87 | 127151.51 | 850.06 | 505 |
| legacy-100000 | merchant 49 | 8.15 | 347437.49 | 589.34 | 505 |
| legacy-100000 | árbol | 12.49 | 119585.81 | 710.08 | 505 |
| legacy-100000 | not found | 12.82 | 170989.27 | 301.62 | 504 |
| legacy-100000 | %_ | 3.09 | 11476.69 | 47.33 | 88 |

La comprobación inicial incluye SQL/materialización. La admisión es parte del await. No sumar columnas superpuestas. El replay usa los mismos SELECT/bindings en una conexión nativa distinta; no mide dentro del driver y no se resta del total entregado. Avanzar el cursor puede ejecutar SQLite. Los componentes JS se miden en la página real; construcción/resto JS es un residual, no un perfil de CPU.
