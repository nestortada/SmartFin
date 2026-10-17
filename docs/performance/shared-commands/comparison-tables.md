# Mediciones completas de comandos compartidos

Tiempos en ms; mediana con tres muestras y valor individual con una. Filas/lecturas son instrumentadas. No son mediciones de la interfaz.

## Node: 1000 movimientos / 10 gastos compartidos

| Operación | Muestras antes/después | Antes ms | Después ms | Transacción antes/después ms | Lecturas antes/después | Filas antes/después | Caracteres antes/después |
|---|---:|---:|---:|---:|---:|---:|---:|
| createPurchase | 3/3 | 25.70 | 9.77 | 25.56/9.61 | 35/31 | 2085/1877 | 974997/113678 |
| sharePurchase | 3/3 | 35.25 | 9.72 | 35.19/9.63 | 14/14 | 3046/1868 | 1440224/112245 |
| updateDistribution | 3/3 | 30.55 | 8.46 | 30.50/8.00 | 14/14 | 3049/1871 | 1441353/113374 |
| updatePurchase | 3/3 | 35.98 | 11.91 | 35.91/11.68 | 35/38 | 3098/1923 | 1455720/128823 |
| recordReceipt | 3/3 | 35.05 | 8.90 | 34.99/8.75 | 31/27 | 3094/1879 | 1455076/114601 |
| linkReceipt | 3/3 | 30.17 | 9.65 | 30.11/9.57 | 14/14 | 3054/1875 | 1443685/114055 |
| recordAdvance | 3/3 | 37.94 | 9.83 | 37.80/9.71 | 31/27 | 3105/1885 | 1458725/115760 |
| applyReceipt | 3/3 | 23.82 | 1.55 | 23.77/1.47 | 12/10 | 2054/48 | 968419/14789 |
| forgivePartial | 3/3 | 21.91 | 1.80 | 21.86/1.69 | 12/10 | 2055/49 | 968687/15057 |
| forgiveFull | 3/3 | 25.73 | 1.53 | 25.68/1.44 | 12/10 | 2056/50 | 968975/15345 |
| recoveryReceipt | 3/3 | 35.98 | 10.10 | 35.92/9.85 | 31/27 | 3116/1891 | 1462513/116987 |
| recoverForgiveness | 3/3 | 28.64 | 2.22 | 28.48/1.90 | 12/10 | 2060/52 | 970612/15886 |
| reverseRecovery | 3/3 | 23.25 | 2.20 | 23.19/1.99 | 12/10 | 2061/53 | 970941/16215 |
| reverseForgiveness | 3/3 | 21.85 | 1.61 | 21.80/1.52 | 12/10 | 2062/54 | 971286/16560 |
| returnAdvance | 3/3 | 31.23 | 8.49 | 31.17/8.39 | 30/26 | 3124/1894 | 1465831/117554 |
| cancelDivision | 3/3 | 27.33 | 7.78 | 27.28/7.71 | 12/12 | 2066/1888 | 972920/116228 |
| deleteMovement | 3/3 | 44.99 | 14.65 | 44.78/14.49 | 69/61 | 4293/2008 | 1993098/151328 |
| idempotentReplay | 3/3 | 0.15 | 0.30 | 0.09/0.21 | 1/1 | 1/1 | 582/582 |

## Node: 10000 movimientos / 100 gastos compartidos

| Operación | Muestras antes/después | Antes ms | Después ms | Transacción antes/después ms | Lecturas antes/después | Filas antes/después | Caracteres antes/después |
|---|---:|---:|---:|---:|---:|---:|---:|
| createPurchase | 3/3 | 837.78 | 72.81 | 837.69/72.70 | 35/31 | 20625/18525 | 9699987/1084955 |
| sharePurchase | 3/3 | 921.21 | 68.31 | 921.15/68.19 | 14/14 | 30316/18516 | 14354701/1083521 |
| updateDistribution | 3/3 | 922.14 | 65.25 | 922.08/65.11 | 14/14 | 30319/18519 | 14355830/1084650 |
| updatePurchase | 3/3 | 915.01 | 70.14 | 914.87/69.98 | 35/38 | 30638/18841 | 14456701/1186603 |
| recordReceipt | 3/3 | 909.77 | 76.36 | 909.70/76.22 | 31/27 | 30634/18527 | 14456057/1085878 |
| linkReceipt | 3/3 | 905.34 | 67.48 | 905.27/67.37 | 14/14 | 30324/18523 | 14358162/1085331 |
| recordAdvance | 3/3 | 931.75 | 72.93 | 931.68/72.81 | 31/27 | 30645/18533 | 14459706/1087037 |
| applyReceipt | 3/3 | 820.06 | 4.91 | 819.98/4.68 | 12/10 | 20324/318 | 9606905/101293 |
| forgivePartial | 3/3 | 834.48 | 6.50 | 834.41/6.40 | 12/10 | 20325/319 | 9607173/101561 |
| forgiveFull | 3/3 | 966.27 | 5.93 | 966.22/5.80 | 12/10 | 20326/320 | 9607461/101849 |
| recoveryReceipt | 3/3 | 946.00 | 72.09 | 945.93/71.90 | 31/27 | 30656/18539 | 14463494/1088264 |
| recoverForgiveness | 3/3 | 850.80 | 5.09 | 850.71/4.96 | 12/10 | 20330/322 | 9609098/102390 |
| reverseRecovery | 3/3 | 849.50 | 5.21 | 849.44/5.11 | 12/10 | 20331/323 | 9609427/102719 |
| reverseForgiveness | 3/3 | 850.12 | 5.79 | 850.06/5.67 | 12/10 | 20332/324 | 9609772/103064 |
| returnAdvance | 3/3 | 919.49 | 71.33 | 919.43/71.20 | 30/26 | 30664/18542 | 14466812/1088831 |
| cancelDivision | 3/3 | 839.67 | 65.30 | 839.61/65.21 | 12/12 | 20336/18536 | 9611406/1087504 |
| deleteMovement | 3/3 | 1012.94 | 80.30 | 1012.88/80.20 | 69/61 | 41643/19196 | 19529582/1295613 |
| idempotentReplay | 3/3 | 0.17 | 0.26 | 0.10/0.17 | 1/1 | 1/1 | 582/582 |

## Node: 100000 movimientos / 100 gastos compartidos

| Operación | Muestras antes/después | Antes ms | Después ms | Transacción antes/después ms | Lecturas antes/después | Filas antes/después | Caracteres antes/después |
|---|---:|---:|---:|---:|---:|---:|---:|
| createPurchase | 1/3 | 277548.66 | 654.99 | 277547.99/654.74 | 35/31 | 200625/182163 | 95216349/9921408 |
| sharePurchase | 1/3 | 306615.06 | 610.09 | 306614.85/609.88 | 14/14 | 300316/182154 | 142629244/9919973 |
| updateDistribution | 1/3 | 274574.65 | 676.06 | 274574.43/675.83 | 14/14 | 300319/182157 | 142630373/9921102 |
| updatePurchase | 1/3 | 334193.04 | 622.63 | 334192.60/622.35 | 35/38 | 300638/182479 | 142731244/10023055 |
| recordReceipt | 1/3 | 358845.22 | 614.67 | 358844.91/614.48 | 31/27 | 300634/182165 | 142730600/9922331 |
| linkReceipt | 1/3 | 277856.45 | 629.80 | 277856.26/629.70 | 14/14 | 300324/182161 | 142632705/9921783 |
| recordAdvance | 1/3 | 275384.83 | 681.10 | 275384.42/680.99 | 31/27 | 300645/182171 | 142734249/9923490 |
| applyReceipt | 1/3 | 274251.67 | 4.70 | 274251.24/4.60 | 12/10 | 200324/318 | 95123267/101293 |
| forgivePartial | 1/3 | 276982.63 | 5.07 | 276980.98/4.91 | 12/10 | 200325/319 | 95123535/101561 |
| forgiveFull | 1/3 | 283521.43 | 5.05 | 283521.24/4.83 | 12/10 | 200326/320 | 95123823/101849 |
| recoveryReceipt | 1/3 | 283468.98 | 632.18 | 283468.04/632.07 | 31/27 | 300656/182177 | 142738037/9924717 |
| recoverForgiveness | 1/3 | 300463.61 | 4.28 | 300463.38/4.12 | 12/10 | 200330/322 | 95125460/102390 |
| reverseRecovery | 1/3 | 304826.19 | 4.68 | 304825.97/4.58 | 12/10 | 200331/323 | 95125789/102719 |
| reverseForgiveness | 1/3 | 285331.75 | 4.22 | 285331.52/4.14 | 12/10 | 200332/324 | 95126134/103064 |
| returnAdvance | 1/3 | 284099.45 | 645.31 | 284098.94/644.96 | 30/26 | 300664/182180 | 142741355/9925284 |
| cancelDivision | 1/3 | 274803.19 | 616.75 | 274802.93/616.62 | 12/12 | 200336/182174 | 95127768/9923956 |
| deleteMovement | 1/3 | 278381.77 | 666.40 | 278381.57/666.18 | 69/61 | 401643/182834 | 190562306/10132066 |
| idempotentReplay | 1/3 | 1.16 | 0.30 | 0.41/0.16 | 1/1 | 1/1 | 582/582 |

## Node: 100000 movimientos / 1000 gastos compartidos

| Operación | Muestras antes/después | Antes ms | Después ms | Transacción antes/después ms | Lecturas antes/después | Filas antes/después | Caracteres antes/después |
|---|---:|---:|---:|---:|---:|---:|---:|
| createPurchase | 1/3 | 281473.01 | 620.82 | 281472.86/620.65 | 35/31 | 206025/185027 | 96962213/10805080 |
| sharePurchase | 1/3 | 274045.64 | 610.22 | 274045.32/609.95 | 14/14 | 303016/185018 | 143505612/10803648 |
| updateDistribution | 1/3 | 295063.42 | 613.77 | 295063.20/613.65 | 14/14 | 303019/185021 | 143506741/10804777 |
| updatePurchase | 1/3 | 282199.09 | 654.65 | 282198.82/654.38 | 35/38 | 306038/188043 | 144478826/11777947 |
| recordReceipt | 1/3 | 271832.03 | 628.41 | 271831.79/628.24 | 31/27 | 306034/185029 | 144478182/10806006 |
| linkReceipt | 1/3 | 279897.43 | 675.58 | 279897.25/675.41 | 14/14 | 303024/185025 | 143509073/10805458 |
| recordAdvance | 1/3 | 301255.44 | 626.51 | 301255.11/626.35 | 31/27 | 306045/185035 | 144481831/10807165 |
| applyReceipt | 1/3 | 278994.69 | 33.88 | 278994.21/33.79 | 12/10 | 203024/3018 | 95997917/972510 |
| forgivePartial | 1/3 | 270884.43 | 30.29 | 270884.21/30.21 | 12/10 | 203025/3019 | 95998185/972778 |
| forgiveFull | 1/3 | 269031.25 | 38.82 | 269031.10/38.71 | 12/10 | 203026/3020 | 95998473/973066 |
| recoveryReceipt | 1/3 | 274435.35 | 637.98 | 274435.09/637.89 | 31/27 | 306056/185041 | 144485619/10808392 |
| recoverForgiveness | 1/3 | 274323.34 | 28.16 | 274323.11/28.01 | 12/10 | 203030/3022 | 96000110/973607 |
| reverseRecovery | 1/3 | 308092.56 | 34.30 | 308092.32/34.22 | 12/10 | 203031/3023 | 96000439/973936 |
| reverseForgiveness | 1/3 | 281738.90 | 30.41 | 281738.69/30.26 | 12/10 | 203032/3024 | 96000784/974281 |
| returnAdvance | 1/3 | 269924.98 | 667.23 | 269924.62/666.92 | 30/26 | 306064/185044 | 144488937/10808959 |
| cancelDivision | 1/3 | 271797.67 | 665.09 | 271797.38/664.91 | 12/12 | 203036/185038 | 96002418/10807631 |
| deleteMovement | 1/3 | 283022.56 | 653.86 | 283022.33/653.77 | 69/61 | 415143/191098 | 194925248/12758176 |
| idempotentReplay | 1/3 | 1.10 | 0.39 | 0.83/0.17 | 1/1 | 1/1 | 582/582 |

## Android físico: 1000 movimientos / 10 gastos compartidos

| Operación | Muestras antes/después | Antes ms | Después ms | Transacción antes/después ms | Lecturas antes/después | Filas antes/después | Caracteres antes/después |
|---|---:|---:|---:|---:|---:|---:|---:|
| createPurchase | 3/3 | 940.58 | 242.30 | 939.03/241.84 | 35/31 | 2085/1877 | 974997/113678 |
| sharePurchase | 3/3 | 856.86 | 220.05 | 856.54/219.58 | 14/14 | 3046/1868 | 1440224/112245 |
| updateDistribution | 3/3 | 834.07 | 125.77 | 833.49/125.53 | 14/14 | 3049/1871 | 1441353/113374 |
| updatePurchase | 3/3 | 935.40 | 325.09 | 934.68/324.82 | 35/38 | 3098/1923 | 1455720/128823 |
| recordReceipt | 3/3 | 847.27 | 329.15 | 846.65/328.26 | 31/27 | 3094/1879 | 1455076/114601 |
| linkReceipt | 3/3 | 893.24 | 245.81 | 892.80/244.91 | 14/14 | 3054/1875 | 1443685/114055 |
| recordAdvance | 3/3 | 919.93 | 283.48 | 919.58/282.72 | 31/27 | 3105/1885 | 1458725/115760 |
| applyReceipt | 3/3 | 686.06 | 77.92 | 685.61/77.52 | 12/10 | 2054/48 | 968419/14789 |
| forgivePartial | 3/3 | 746.02 | 101.68 | 745.72/100.59 | 12/10 | 2055/49 | 968687/15057 |
| forgiveFull | 3/3 | 736.36 | 61.09 | 736.13/60.15 | 12/10 | 2056/50 | 968975/15345 |
| recoveryReceipt | 3/3 | 973.07 | 205.60 | 972.76/205.21 | 31/27 | 3116/1891 | 1462513/116987 |
| recoverForgiveness | 3/3 | 746.76 | 67.01 | 746.42/66.69 | 12/10 | 2060/52 | 970612/15886 |
| reverseRecovery | 3/3 | 752.65 | 50.98 | 752.24/50.40 | 12/10 | 2061/53 | 970941/16215 |
| reverseForgiveness | 3/3 | 696.67 | 55.05 | 696.10/54.57 | 12/10 | 2062/54 | 971286/16560 |
| returnAdvance | 3/3 | 884.45 | 294.46 | 884.16/294.12 | 30/26 | 3124/1894 | 1465831/117554 |
| cancelDivision | 3/3 | 744.29 | 238.60 | 743.97/237.98 | 12/12 | 2066/1888 | 972920/116228 |
| deleteMovement | 3/3 | 1390.53 | 622.77 | 1390.22/622.10 | 69/61 | 4293/2008 | 1993098/151328 |
| idempotentReplay | 3/3 | 9.97 | 8.98 | 9.67/8.13 | 1/1 | 1/1 | 582/582 |

## Android físico: 10000 movimientos / 100 gastos compartidos

| Operación | Muestras antes/después | Antes ms | Después ms | Transacción antes/después ms | Lecturas antes/después | Filas antes/después | Caracteres antes/después |
|---|---:|---:|---:|---:|---:|---:|---:|
| createPurchase | 1/1 | 23557.21 | 839.34 | 23555.65/838.14 | 35/31 | 20625/18525 | 9699987/1084955 |
| sharePurchase | 1/1 | 26161.65 | 527.64 | 26161.35/527.41 | 14/14 | 30316/18516 | 14354701/1083521 |
| updateDistribution | 1/1 | 23981.05 | 678.17 | 23980.62/677.97 | 14/14 | 30319/18519 | 14355830/1084650 |
| updatePurchase | 1/1 | 24091.09 | 1133.30 | 24090.72/1132.98 | 35/38 | 30638/18841 | 14456701/1186603 |
| recordReceipt | 1/1 | 25075.37 | 896.84 | 25075.08/896.55 | 31/27 | 30634/18527 | 14456057/1085878 |
| linkReceipt | 1/1 | 24177.69 | 523.48 | 24177.33/523.26 | 14/14 | 30324/18523 | 14358162/1085331 |
| recordAdvance | 1/1 | 24061.18 | 910.07 | 24060.22/909.85 | 31/27 | 30645/18533 | 14459706/1087037 |
| applyReceipt | 1/1 | 23028.17 | 107.43 | 23027.88/107.21 | 12/10 | 20324/318 | 9606905/101293 |
| forgivePartial | 1/1 | 21527.46 | 93.19 | 21527.21/92.96 | 12/10 | 20325/319 | 9607173/101561 |
| forgiveFull | 1/1 | 24209.48 | 191.62 | 24209.20/191.37 | 12/10 | 20326/320 | 9607461/101849 |
| recoveryReceipt | 1/1 | 24417.58 | 854.87 | 24417.28/854.09 | 31/27 | 30656/18539 | 14463494/1088264 |
| recoverForgiveness | 1/1 | 22694.38 | 143.63 | 22694.00/143.37 | 12/10 | 20330/322 | 9609098/102390 |
| reverseRecovery | 1/1 | 24194.70 | 163.23 | 24194.37/163.00 | 12/10 | 20331/323 | 9609427/102719 |
| reverseForgiveness | 1/1 | 21116.42 | 127.38 | 21116.15/127.16 | 12/10 | 20332/324 | 9609772/103064 |
| returnAdvance | 1/1 | 22053.19 | 937.72 | 22052.90/937.47 | 30/26 | 30664/18542 | 14466812/1088831 |
| cancelDivision | 1/1 | 20136.54 | 731.88 | 20136.30/731.68 | 12/12 | 20336/18536 | 9611406/1087504 |
| deleteMovement | 1/1 | 26408.62 | 942.13 | 26408.35/941.94 | 69/61 | 41643/19196 | 19529582/1295613 |
| idempotentReplay | 1/1 | 7.55 | 15.04 | 7.23/14.66 | 1/1 | 1/1 | 582/582 |

## Android físico: 100000 movimientos / 100 gastos compartidos

| Operación | Muestras antes/después | Antes ms | Después ms | Transacción antes/después ms | Lecturas antes/después | Filas antes/después | Caracteres antes/después |
|---|---:|---:|---:|---:|---:|---:|---:|
| createPurchase | Sin medir/1 | Sin medir | 5833.11 | Sin medir/5831.64 | Sin medir/31 | Sin medir/182163 | Sin medir/9921408 |
| sharePurchase | Sin medir/1 | Sin medir | 5648.05 | Sin medir/5647.83 | Sin medir/14 | Sin medir/182154 | Sin medir/9919973 |
| updateDistribution | Sin medir/1 | Sin medir | 5605.35 | Sin medir/5605.11 | Sin medir/14 | Sin medir/182157 | Sin medir/9921102 |
| updatePurchase | Sin medir/1 | Sin medir | 6118.19 | Sin medir/6117.94 | Sin medir/38 | Sin medir/182479 | Sin medir/10023055 |
| recordReceipt | Sin medir/1 | Sin medir | 5723.43 | Sin medir/5723.20 | Sin medir/27 | Sin medir/182165 | Sin medir/9922331 |
| linkReceipt | Sin medir/1 | Sin medir | 5569.80 | Sin medir/5569.59 | Sin medir/14 | Sin medir/182161 | Sin medir/9921783 |
| recordAdvance | Sin medir/1 | Sin medir | 5719.94 | Sin medir/5719.64 | Sin medir/27 | Sin medir/182171 | Sin medir/9923490 |
| applyReceipt | Sin medir/1 | Sin medir | 114.48 | Sin medir/114.23 | Sin medir/10 | Sin medir/318 | Sin medir/101293 |
| forgivePartial | Sin medir/1 | Sin medir | 101.28 | Sin medir/99.80 | Sin medir/10 | Sin medir/319 | Sin medir/101561 |
| forgiveFull | Sin medir/1 | Sin medir | 95.42 | Sin medir/95.17 | Sin medir/10 | Sin medir/320 | Sin medir/101849 |
| recoveryReceipt | Sin medir/1 | Sin medir | 5784.13 | Sin medir/5783.90 | Sin medir/27 | Sin medir/182177 | Sin medir/9924717 |
| recoverForgiveness | Sin medir/1 | Sin medir | 139.26 | Sin medir/139.02 | Sin medir/10 | Sin medir/322 | Sin medir/102390 |
| reverseRecovery | Sin medir/1 | Sin medir | 115.70 | Sin medir/115.45 | Sin medir/10 | Sin medir/323 | Sin medir/102719 |
| reverseForgiveness | Sin medir/1 | Sin medir | 118.53 | Sin medir/118.26 | Sin medir/10 | Sin medir/324 | Sin medir/103064 |
| returnAdvance | Sin medir/1 | Sin medir | 17544.35 | Sin medir/17542.07 | Sin medir/26 | Sin medir/182180 | Sin medir/9925284 |
| cancelDivision | Sin medir/1 | Sin medir | 16849.15 | Sin medir/16848.69 | Sin medir/12 | Sin medir/182174 | Sin medir/9923956 |
| deleteMovement | Sin medir/1 | Sin medir | 20426.31 | Sin medir/20422.85 | Sin medir/61 | Sin medir/182834 | Sin medir/10132066 |
| idempotentReplay | Sin medir/1 | Sin medir | 7.78 | Sin medir/7.07 | Sin medir/1 | Sin medir/1 | Sin medir/582 |

## Android físico: 100000 movimientos / 1000 gastos compartidos

| Operación | Muestras antes/después | Antes ms | Después ms | Transacción antes/después ms | Lecturas antes/después | Filas antes/después | Caracteres antes/después |
|---|---:|---:|---:|---:|---:|---:|---:|
| createPurchase | Sin medir/1 | Sin medir | 25558.95 | Sin medir/25555.26 | Sin medir/31 | Sin medir/185027 | Sin medir/10805078 |
| sharePurchase | Sin medir/1 | Sin medir | 17617.01 | Sin medir/17616.59 | Sin medir/14 | Sin medir/185018 | Sin medir/10803643 |
| updateDistribution | Sin medir/1 | Sin medir | 17456.72 | Sin medir/17456.03 | Sin medir/14 | Sin medir/185021 | Sin medir/10804772 |
| updatePurchase | Sin medir/1 | Sin medir | 18442.87 | Sin medir/18442.17 | Sin medir/38 | Sin medir/188043 | Sin medir/11777939 |
| recordReceipt | Sin medir/1 | Sin medir | 17375.13 | Sin medir/17374.63 | Sin medir/27 | Sin medir/185029 | Sin medir/10806001 |
| linkReceipt | Sin medir/1 | Sin medir | 17437.95 | Sin medir/17437.37 | Sin medir/14 | Sin medir/185025 | Sin medir/10805453 |
| recordAdvance | Sin medir/1 | Sin medir | 18638.58 | Sin medir/18638.01 | Sin medir/27 | Sin medir/185035 | Sin medir/10807160 |
| applyReceipt | Sin medir/1 | Sin medir | 676.46 | Sin medir/676.07 | Sin medir/10 | Sin medir/3018 | Sin medir/972507 |
| forgivePartial | Sin medir/1 | Sin medir | 739.41 | Sin medir/738.61 | Sin medir/10 | Sin medir/3019 | Sin medir/972775 |
| forgiveFull | Sin medir/1 | Sin medir | 786.92 | Sin medir/781.44 | Sin medir/10 | Sin medir/3020 | Sin medir/973063 |
| recoveryReceipt | Sin medir/1 | Sin medir | 20821.09 | Sin medir/20814.06 | Sin medir/27 | Sin medir/185041 | Sin medir/10808387 |
| recoverForgiveness | Sin medir/1 | Sin medir | 823.13 | Sin medir/822.63 | Sin medir/10 | Sin medir/3022 | Sin medir/973604 |
| reverseRecovery | Sin medir/1 | Sin medir | 927.01 | Sin medir/920.94 | Sin medir/10 | Sin medir/3023 | Sin medir/973933 |
| reverseForgiveness | Sin medir/1 | Sin medir | 759.37 | Sin medir/758.95 | Sin medir/10 | Sin medir/3024 | Sin medir/974278 |
| returnAdvance | Sin medir/1 | Sin medir | 18711.48 | Sin medir/18710.82 | Sin medir/26 | Sin medir/185044 | Sin medir/10808954 |
| cancelDivision | Sin medir/1 | Sin medir | 21268.66 | Sin medir/21268.14 | Sin medir/12 | Sin medir/185038 | Sin medir/10807626 |
| deleteMovement | Sin medir/1 | Sin medir | 18798.19 | Sin medir/18797.68 | Sin medir/61 | Sin medir/191098 | Sin medir/12758164 |
| idempotentReplay | Sin medir/1 | Sin medir | 19.29 | Sin medir/18.80 | Sin medir/1 | Sin medir/1 | Sin medir/582 |
