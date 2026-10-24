# Mediciones sintéticas de fase 5B.2

Tres muestras consecutivas por tamaño/API, sin optimizar ni reducir la barrera. Rangos en ms; no son percentiles ni un SLA.

| API | Movimientos | Captura total | Lector | Operación financiera | Publicación (fuera de barrera) |
|---|---:|---:|---:|---:|---:|
| 24 | 1000 | 375.81–555.24 | 384.69–563.68 | 397.55–577.63 | 252.10–261.84 |
| 24 | 10000 | 653.75–728.45 | 660.37–739.32 | 672.94–755.88 | 532.15–563.26 |
| 24 | 100000 | 2557.90–2973.77 | 2564.75–2986.81 | 2580.14–3006.17 | 4935.56–6162.80 |
| 35 | 1000 | 299.75–313.08 | 304.51–319.52 | 310.10–324.92 | 168.17–181.48 |
| 35 | 10000 | 881.71–1489.88 | 891.34–1507.08 | 901.77–1523.59 | 547.34–564.62 |
| 35 | 100000 | 4276.91–4502.50 | 4287.74–4514.62 | 4299.18–4525.56 | 10218.92–10372.15 |

Mediana de cada etapa en ms (medianas independientes; no sumarlas como si fueran una muestra):

| API | Movimientos | Espera permiso | Checkpoint | Fuente JS | Cierre | Fuente Kotlin | Copia + hash origen | Integridad snapshot | Hash destino | Reapertura | Revalidación privada posterior | CSV | Hash componentes | SAF escritura | SAF relecturas |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 24 | 1000 | 0.74 | 0.01 | 101.38 | 2.04 | 21.29 | 11.88 | 20.02 | 2.25 | 285.42 | 39.19 | 35.32 | 5.79 | 26.97 | 20.14 |
| 24 | 10000 | 1.01 | 0.02 | 147.96 | 2.10 | 85.96 | 26.30 | 62.32 | 12.77 | 330.83 | 73.85 | 248.64 | 13.81 | 45.92 | 43.45 |
| 24 | 100000 | 1.15 | 0.03 | 642.67 | 3.90 | 523.61 | 168.92 | 520.52 | 89.32 | 830.19 | 636.07 | 3914.08 | 120.23 | 227.45 | 267.59 |
| 35 | 1000 | 0.59 | 0.00 | 82.61 | 1.61 | 22.53 | 12.94 | 21.46 | 1.62 | 161.41 | 26.47 | 42.96 | 3.82 | 36.94 | 13.58 |
| 35 | 10000 | 1.63 | 0.00 | 285.77 | 5.49 | 175.74 | 27.63 | 84.95 | 4.14 | 561.77 | 128.49 | 253.11 | 7.72 | 70.66 | 22.30 |
| 35 | 100000 | 1.61 | 0.00 | 976.27 | 3.77 | 889.21 | 187.31 | 831.47 | 30.29 | 1523.18 | 851.08 | 8929.27 | 47.97 | 258.78 | 101.58 |

El checkpoint de estas muestras es el coste de comprobar un journal rollback; no se ejecutó WAL checkpoint. La campaña core conserva el escenario WAL aparte. Fuente JS incluye puente, integridad/FK y metadatos. La reapertura incluye la recuperación verificada de 1.1. SAF se mide contra un proveedor sintético local, sin red. El total de publicación incluye staging, metadatos y descubrimiento además de sus etapas. La relectura SAF incluye la pasada final de todos los componentes.

Las diferencias respecto a la muestra histórica HONOR de 16.820,74 ms no acreditan una optimización: se conserva el algoritmo, y no se controlaron energía, cachés, temperatura o carga de igual forma. Persisten esperas perceptibles. La UI requiere aceptación explícita; no se declara lista para distribución ni mejora de FPS/TTI.
