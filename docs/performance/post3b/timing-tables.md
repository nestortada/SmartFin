# Mediciones repetidas post-3B

Milisegundos. Calentamientos y oráculo excluidos; las filas con error no representan una operación exitosa.

| API | Operación | Fixture | Versión | n | Mediana | Mín.–máx. | DE | BEGIN/finalización | Intervalo lector | Cola inicial | Errores |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 24 | associate | {"relevant":100} | after | 3 | 307.17 | 282.75–482.12 | 88.79 | 300.78 | 307.08 | 0.05 | 0 |
| 24 | associate | {"relevant":100} | before | 3 | 534.04 | 418.00–598.97 | 74.85 | 524.12 | 534.00 | 0.08 | 0 |
| 24 | associate | {"relevant":997} | after | 3 | 2316.07 | 2087.15–2555.31 | 191.14 | 2308.89 | 2315.90 | 0.04 | 0 |
| 24 | associate | {"relevant":997} | before | 3 | 2439.89 | 2345.90–2702.29 | 150.81 | 2434.65 | 2439.63 | 0.06 | 0 |
| 24 | associate | {"relevant":998} | after | 3 | 4881.85 | 2226.42–5189.02 | 1330.11 | 4876.09 | 4881.83 | 0.13 | 0 |
| 24 | associate | {"relevant":998} | before | 3 | 3217.90 | 2234.63–4397.33 | 884.13 | 3213.34 | 3217.79 | 0.08 | 3 |
| 24 | associate | {"relevant":1000} | after | 3 | 4845.29 | 4579.49–5327.14 | 309.45 | 4832.25 | 4845.18 | 0.10 | 0 |
| 24 | associate | {"relevant":1000} | before | 3 | 4657.74 | 4487.28–4841.22 | 144.53 | 4649.61 | 4657.40 | 0.12 | 3 |
| 24 | associate | {"relevant":10000} | after | 3 | 47940.34 | 46962.47–55258.53 | 3701.90 | 47932.05 | 47940.21 | 0.13 | 0 |
| 24 | associate | {"relevant":10000} | before | 3 | 47031.73 | 45984.15–47314.20 | 572.16 | 47018.64 | 47031.42 | 0.13 | 3 |
| 24 | reconcile | {"noise":1000} | after | 3 | 21.47 | 20.53–31.43 | 4.93 | 20.99 | 22.94 | 0.09 | 0 |
| 24 | reconcile | {"noise":1000} | before | 3 | 20.57 | 17.30–51.98 | 15.63 | 20.06 | 21.52 | 0.07 | 0 |
| 24 | close | {"noise":1000} | after | 3 | 24.39 | 24.32–27.76 | 1.60 | 23.92 | 25.43 | 0.07 | 0 |
| 24 | close | {"noise":1000} | before | 3 | 27.94 | 25.65–28.68 | 1.29 | 27.57 | 29.03 | 0.09 | 0 |
| 24 | reconcile | {"noise":100000} | after | 5 | 65.26 | 53.69–197.92 | 54.11 | 63.94 | 66.16 | 0.06 | 0 |
| 24 | reconcile | {"noise":100000} | before | 5 | 68.97 | 51.04–88.99 | 12.90 | 68.31 | 71.46 | 0.09 | 0 |
| 24 | close | {"noise":100000} | after | 5 | 70.77 | 62.19–104.56 | 15.00 | 70.41 | 71.94 | 0.05 | 0 |
| 24 | close | {"noise":100000} | before | 5 | 64.31 | 63.02–112.58 | 19.31 | 63.83 | 65.73 | 0.05 | 0 |
| 24 | reconcile | {"noise":100000,"expected":true} | after | 3 | 60.55 | 59.02–65.48 | 2.76 | 60.02 | 61.63 | 0.09 | 0 |
| 24 | reconcile | {"noise":100000,"expected":true} | before | 3 | 58.45 | 56.69–60.50 | 1.56 | 57.98 | 59.77 | 0.08 | 0 |
| 24 | close | {"noise":100000,"expected":true} | after | 3 | 63.84 | 60.30–83.35 | 10.13 | 63.38 | 65.00 | 0.09 | 0 |
| 24 | close | {"noise":100000,"expected":true} | before | 3 | 71.58 | 67.71–77.83 | 4.17 | 71.12 | 72.24 | 0.10 | 0 |
| 24 | reconcile | {"noise":80000,"relevant":10000,"shape":"paid"} | after | 3 | 1039.75 | 933.39–1051.78 | 53.20 | 1038.78 | 1040.83 | 0.12 | 0 |
| 24 | reconcile | {"noise":80000,"relevant":10000,"shape":"paid"} | before | 3 | 1390.14 | 1125.29–4706.98 | 1629.59 | 1389.54 | 1392.66 | 0.07 | 0 |
| 24 | close | {"noise":80000,"relevant":10000,"shape":"paid"} | after | 3 | 1159.46 | 1065.87–1262.07 | 80.13 | 1158.71 | 1160.50 | 0.05 | 0 |
| 24 | close | {"noise":80000,"relevant":10000,"shape":"paid"} | before | 3 | 1147.49 | 1099.17–1226.98 | 52.69 | 1146.93 | 1148.51 | 0.06 | 0 |
| 24 | reconcile | {"originalCloseFixture":true,"noise":100000,"light":true} | after | 5 | 103.34 | 78.69–228.16 | 55.16 | 102.45 | 105.71 | 0.12 | 0 |
| 24 | close | {"originalCloseFixture":true,"noise":100000,"light":true} | after | 5 | 125.81 | 113.57–166.82 | 19.50 | 125.09 | 128.87 | 0.11 | 0 |
| 24 | associate | {"relevant":1000,"light":true} | after | 3 | 5143.13 | 5122.59–5693.89 | 264.60 | 5141.52 | 5145.19 | 0.11 | 0 |
| 24 | associate | {"relevant":10000,"light":true} | after | 3 | 51144.05 | 48610.38–51324.94 | 1239.22 | 51143.27 | 51146.45 | 0.13 | 0 |
| 35 | associate | {"relevant":100} | after | 3 | 543.08 | 537.97–700.11 | 75.26 | 536.91 | 542.98 | 0.07 | 0 |
| 35 | associate | {"relevant":100} | before | 3 | 611.49 | 574.90–655.93 | 33.13 | 604.20 | 611.40 | 0.07 | 0 |
| 35 | associate | {"relevant":997} | after | 3 | 4819.20 | 4109.42–4847.73 | 341.52 | 4808.27 | 4819.07 | 0.07 | 0 |
| 35 | associate | {"relevant":997} | before | 3 | 4893.05 | 3760.58–4964.28 | 551.41 | 4884.26 | 4892.92 | 0.07 | 0 |
| 35 | associate | {"relevant":998} | after | 3 | 3445.22 | 3393.56–3561.58 | 70.27 | 3429.14 | 3445.15 | 0.03 | 0 |
| 35 | associate | {"relevant":998} | before | 3 | 3382.77 | 3167.21–3438.25 | 116.91 | 3363.73 | 3382.69 | 0.03 | 0 |
| 35 | associate | {"relevant":1000} | after | 3 | 3466.16 | 3304.07–4833.64 | 686.04 | 3458.87 | 3466.06 | 0.05 | 0 |
| 35 | associate | {"relevant":1000} | before | 3 | 4655.69 | 3317.15–4660.45 | 632.12 | 4647.44 | 4655.58 | 0.06 | 0 |
| 35 | associate | {"relevant":10000} | after | 3 | 39679.00 | 39010.81–43766.45 | 2102.11 | 39670.64 | 39678.94 | 0.03 | 0 |
| 35 | associate | {"relevant":10000} | before | 3 | 34750.95 | 34725.51–45400.71 | 5026.35 | 34745.23 | 34750.90 | 0.03 | 0 |
| 35 | reconcile | {"noise":1000} | after | 3 | 42.96 | 35.36–56.69 | 8.83 | 41.72 | 44.92 | 0.10 | 0 |
| 35 | reconcile | {"noise":1000} | before | 3 | 44.61 | 42.78–55.52 | 5.62 | 43.36 | 48.13 | 0.11 | 0 |
| 35 | close | {"noise":1000} | after | 3 | 68.73 | 56.40–72.90 | 7.00 | 67.64 | 71.56 | 0.10 | 0 |
| 35 | close | {"noise":1000} | before | 3 | 58.54 | 57.93–60.03 | 0.88 | 56.98 | 60.34 | 0.10 | 0 |
| 35 | reconcile | {"noise":100000} | after | 5 | 181.83 | 176.41–183.56 | 2.69 | 180.73 | 184.80 | 0.08 | 0 |
| 35 | reconcile | {"noise":100000} | before | 5 | 188.28 | 178.02–679.13 | 196.09 | 186.55 | 190.25 | 0.10 | 0 |
| 35 | close | {"noise":100000} | after | 5 | 162.96 | 158.80–466.64 | 119.49 | 161.79 | 165.29 | 0.07 | 0 |
| 35 | close | {"noise":100000} | before | 5 | 171.98 | 152.81–661.93 | 198.29 | 171.27 | 173.52 | 0.09 | 0 |
| 35 | reconcile | {"noise":100000,"expected":true} | after | 3 | 147.29 | 147.00–159.70 | 5.92 | 146.52 | 149.03 | 0.05 | 0 |
| 35 | reconcile | {"noise":100000,"expected":true} | before | 3 | 169.71 | 164.86–184.92 | 8.54 | 167.96 | 171.22 | 0.09 | 0 |
| 35 | close | {"noise":100000,"expected":true} | after | 3 | 163.05 | 159.77–178.94 | 8.37 | 162.11 | 164.83 | 0.06 | 0 |
| 35 | close | {"noise":100000,"expected":true} | before | 3 | 180.30 | 176.58–553.78 | 176.94 | 179.18 | 181.60 | 0.09 | 0 |
| 35 | reconcile | {"noise":80000,"relevant":10000,"shape":"paid"} | after | 3 | 2242.81 | 2216.76–2265.62 | 19.96 | 2242.12 | 2244.95 | 0.06 | 0 |
| 35 | reconcile | {"noise":80000,"relevant":10000,"shape":"paid"} | before | 3 | 2271.67 | 2239.63–2305.31 | 26.82 | 2271.00 | 2281.99 | 0.06 | 0 |
| 35 | close | {"noise":80000,"relevant":10000,"shape":"paid"} | after | 3 | 3072.80 | 3042.53–3101.38 | 24.03 | 3071.88 | 3074.65 | 0.08 | 0 |
| 35 | close | {"noise":80000,"relevant":10000,"shape":"paid"} | before | 3 | 3057.88 | 3026.08–3067.23 | 17.62 | 3057.13 | 3059.39 | 0.06 | 0 |
| 35 | reconcile | {"originalCloseFixture":true,"noise":100000,"light":true} | after | 5 | 205.64 | 204.01–214.03 | 3.55 | 204.12 | 208.06 | 0.08 | 0 |
| 35 | close | {"originalCloseFixture":true,"noise":100000,"light":true} | after | 5 | 219.63 | 217.56–222.18 | 1.81 | 218.54 | 221.32 | 0.07 | 0 |
| 35 | associate | {"relevant":1000,"light":true} | after | 3 | 5926.22 | 5912.93–5972.04 | 25.32 | 5925.36 | 5928.06 | 0.08 | 0 |
| 35 | associate | {"relevant":10000,"light":true} | after | 3 | 57881.65 | 53872.85–58840.83 | 2151.78 | 57880.82 | 57883.93 | 0.07 | 0 |

DE: desviación estándar poblacional de estas muestras; no es una estimación de percentiles.
BEGIN/finalización incluye ROLLBACK en el original que falla por parámetros.
**La duración real del lector solo se acredita cuando readerTiming en summary.json es completion-captured** (en los resultados archivados, las filas light:true). En las primeras campañas el intervalo lector se calculó después de esperar al escritor y no acredita que el lector permaneciese bloqueado; queda conservado como dato legado. Los tiempos de operación/commit y sus equivalencias siguen siendo válidos.
Las etapas JS/driver, memoria y sondas nativas completas están en [summary.json](summary.json).
