
## API24

| Campaña | Caso | 5E.1 ms mediana (mín–máx) | Sent./filas | 5E.2 ms mediana (mín–máx) | Sent./filas | Cursor 5E.1→5E.2 | Pág. 2 5E.1 / 5E.2 ms | Heap Hermes Δ 5E.1 / 5E.2 KB |
|---|---|---:|---:|---:|---:|---|---:|---:|
| history-civil-1000 | newest | 28 (26–34) n=3 | 5/54 | 23 (19–34) n=3 | 4/54 | keyset→keyset | 20 / 20 | 177 / 172 |
| history-civil-1000 | oldest | 31 (31–34) n=3 | 5/54 | 29 (22–35) n=3 | 4/54 | keyset→keyset | 22 / 19 | 179 / 174 |
| history-civil-1000 | search49 | 51 (35–56) n=3 | 8/468 | 48 (31–49) n=3 | 6/470 | end→end | 0.00 / 0.00 | 635 / 601 |
| history-civil-1000 | unicode | 46 (45–47) n=3 | 7/453 | 52 (51–90) n=3 | 6/653 | keyset→keyset | 38 / 56 | 627 / 730 |
| history-civil-1000 | absent | 58 (45–59) n=3 | 7/434 | 46 (40–54) n=3 | 5/436 | end→end | 0.00 / 0.00 | 569 / 537 |
| history-civil-1000 | combined | 17 (15–17) n=3 | 4/2 | 23 (19–32) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-civil-10000 | newest | 33 (33–34) n=3 | 5/54 | 31 (28–51) n=3 | 4/54 | keyset→keyset | 17 / 19 | 176 / 172 |
| history-civil-10000 | oldest | 63 (39–66) n=3 | 5/54 | 27 (21–38) n=3 | 4/54 | keyset→keyset | 45 / 16 | 179 / 174 |
| history-civil-10000 | search49 | 78 (72–103) n=3 | 8/653 | 79 (75–81) n=3 | 6/653 | keyset→keyset | 36 / 37 | 794 / 749 |
| history-civil-10000 | unicode | 107 (102–111) n=3 | 11/1253 | 90 (88–91) n=3 | 7/1453 | keyset→keyset | 28 / 33 | -2147.95 / 1581 |
| history-civil-10000 | absent | 326 (322–332) n=3 | 27/4406 | 310 (301–346) n=3 | 8/4345 | end→end | 0.00 / 0.00 | 1411 / 920 |
| history-civil-10000 | combined | 24 (22–26) n=3 | 4/2 | 32 (31–32) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-civil-100000 | newest | 202 (181–211) n=3 | 5/54 | 212 (170–231) n=3 | 4/54 | keyset→keyset | 17 / 16 | 176 / 172 |
| history-civil-100000 | oldest | 600 (590–601) n=3 | 5/54 | 194 (179–196) n=3 | 4/54 | keyset→keyset | 453 / 20 | 180 / 175 |
| history-civil-100000 | search49 | 286 (195–288) n=3 | 6/253 | 251 (233–275) n=3 | 5/253 | keyset→keyset | 49 / 73 | 341 / 327 |
| history-civil-100000 | unicode | 498 (494–525) n=3 | 34/5853 | 574 (538–696) n=3 | 10/12653 | keyset→keyset | 30 / 15 | -681.23 / 4238 |
| history-civil-100000 | absent | 1734 (1192–2156) n=3 | 117/22449 | 1535 (1506–2876) n=3 | 14/43426 | end→end | 0.00 / 0.00 | 3233 / 10987 |
| history-civil-100000 | combined | 208 (205–213) n=3 | 4/2 | 369 (356–374) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-legacyDay-1000 | newest | 84 (80–86) n=3 | 10/1053 | 25 (23–47) n=3 | 4/54 | legacy→keyset | 15 / 21 | -465.23 / 159 |
| history-legacyDay-1000 | oldest | 82 (80–86) n=3 | 10/1053 | 22 (19–25) n=3 | 4/54 | legacy→keyset | 14 / 18 | -1406.19 / 159 |
| history-legacyDay-1000 | search49 | 30 (27–30) n=3 | 7/470 | 27 (23–33) n=3 | 6/470 | end→end | 0.00 / 0.00 | 594 / 590 |
| history-legacyDay-1000 | unicode | 43 (38–47) n=3 | 10/1053 | 27 (24–28) n=3 | 6/653 | legacy→keyset | 8.66 / 25 | 1338 / 700 |
| history-legacyDay-1000 | absent | 23 (20–32) n=3 | 6/436 | 23 (22–27) n=3 | 5/436 | end→end | 0.00 / 0.00 | 529 / 530 |
| history-legacyDay-1000 | combined | 8.58 (8.32–9.48) n=3 | 5/9 | 9.95 (9.12–10) n=3 | 5/9 | end→end | 0.00 / 0.00 | 73 / 82 |
| history-legacyDay-10000 | newest | 526 (504–591) n=3 | 54/10023 | 29 (28–30) n=3 | 4/54 | legacy→keyset | 15 / 17 | 3140 / 159 |
| history-legacyDay-10000 | oldest | 524 (475–536) n=3 | 54/10023 | 16 (16–30) n=3 | 4/54 | legacy→keyset | 8.64 / 9.53 | 1232 / 159 |
| history-legacyDay-10000 | search49 | 209 (188–254) n=3 | 27/4576 | 70 (68–110) n=3 | 7/1453 | legacy→keyset | 10 / 73 | 1393 / 1603 |
| history-legacyDay-10000 | unicode | 491 (479–510) n=3 | 54/10021 | 44 (34–50) n=3 | 6/653 | legacy→keyset | 12 / 43 | 715 / 698 |
| history-legacyDay-10000 | absent | 272 (255–275) n=3 | 25/4319 | 213 (189–236) n=3 | 8/4345 | end→end | 0.00 / 0.00 | 976 / 1420 |
| history-legacyDay-10000 | combined | 29 (29–30) n=3 | 5/55 | 36 (35–37) n=3 | 5/55 | end→end | 0.00 / 0.00 | 151 / 152 |
| history-legacyDay-100000 | newest | 4287 (4287–4287) n=1 | 376/74358 | 225 (216–228) n=3 | 4/54 | legacy→keyset | 24 / 21 | 8303 / 159 |
| history-legacyDay-100000 | oldest | 3914 (3914–3914) n=1 | 376/74358 | 203 (202–208) n=3 | 4/54 | legacy→keyset | 14 / 15 | 9499 / 161 |
| history-legacyDay-100000 | search49 | 2882 (2882–2882) n=1 | 198/38776 | 295 (285–316) n=3 | 7/1453 | legacy→keyset | 17 / 166 | 2250 / 1589 |
| history-legacyDay-100000 | unicode | 3736 (3736–3736) n=1 | 376/74355 | 233 (210–241) n=3 | 6/653 | legacy→keyset | 7.27 / 47 | 3951 / 703 |
| history-legacyDay-100000 | absent | 2417 (2417–2417) n=1 | 213/41907 | 2626 (2612–2759) n=3 | 14/43426 | end→end | 0.00 / 0.00 | -134.55 / 13836 |
| history-legacyDay-100000 | combined | 213 (213–213) n=1 | 6/342 | 104 (92–131) n=3 | 5/253 | legacy→keyset | 8.00 / 32 | 648 / 318 |
| history-legacyTied-1000 | newest | 87 (87–91) n=3 | 10/1053 | 36 (26–37) n=3 | 4/54 | legacy→keyset | 16 / 25 | -488.70 / 158 |
| history-legacyTied-1000 | oldest | 76 (74–81) n=3 | 10/1053 | 27 (22–28) n=3 | 4/54 | legacy→keyset | 15 / 21 | -1530.91 / 158 |
| history-legacyTied-1000 | search49 | 56 (55–58) n=3 | 7/470 | 55 (52–69) n=3 | 6/470 | end→end | 0.00 / 0.00 | 586 / 582 |
| history-legacyTied-1000 | unicode | 86 (78–89) n=3 | 10/1053 | 55 (54–64) n=3 | 6/653 | legacy→keyset | 14 / 46 | 1321 / 692 |
| history-legacyTied-1000 | absent | 56 (51–58) n=3 | 6/436 | 52 (50–71) n=3 | 5/436 | end→end | 0.00 / 0.00 | 523 / 523 |
| history-legacyTied-1000 | combined | 24 (22–34) n=3 | 4/2 | 19 (16–21) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-legacyTied-10000 | newest | 707 (659–708) n=3 | 55/10053 | 64 (64–68) n=3 | 4/54 | legacy→keyset | 11 / 70 | 2992 / 158 |
| history-legacyTied-10000 | oldest | 740 (708–756) n=3 | 55/10053 | 70 (67–73) n=3 | 4/54 | legacy→keyset | 15 / 62 | 3009 / 158 |
| history-legacyTied-10000 | search49 | 522 (512–535) n=3 | 27/4565 | 201 (177–202) n=3 | 7/1453 | legacy→keyset | 13 / 230 | -2307.88 / 1597 |
| history-legacyTied-10000 | unicode | 784 (662–828) n=3 | 55/10053 | 129 (115–131) n=3 | 6/653 | legacy→keyset | 14 / 115 | 490 / 691 |
| history-legacyTied-10000 | absent | 470 (465–546) n=3 | 25/4345 | 389 (365–418) n=3 | 8/4345 | end→end | 0.00 / 0.00 | 1006 / 1109 |
| history-legacyTied-10000 | combined | 17 (13–24) n=3 | 4/2 | 16 (15–24) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-legacyTied-100000 | newest | 23429 (23429–23429) n=1 | 505/100053 | 565 (318–581) n=3 | 4/54 | legacy→keyset | 16 / 503 | 13235 / 158 |
| history-legacyTied-100000 | oldest | 23662 (23662–23662) n=1 | 505/100053 | 478 (421–531) n=3 | 4/54 | legacy→keyset | 15 / 529 | 13294 / 158 |
| history-legacyTied-100000 | search49 | 31332 (31332–31332) n=1 | 230/45174 | 1576 (1522–1626) n=3 | 7/1453 | legacy→keyset | 9.25 / 1609 | 4376 / 1600 |
| history-legacyTied-100000 | unicode | 24445 (24445–24445) n=1 | 505/100053 | 851 (796–863) n=3 | 6/653 | legacy→keyset | 16 / 918 | 3831 / 696 |
| history-legacyTied-100000 | absent | 15901 (15901–15901) n=1 | 221/43426 | 3867 (3865–4656) n=3 | 14/43426 | end→end | 0.00 / 0.00 | 865 / 12725 |
| history-legacyTied-100000 | combined | 59 (59–59) n=1 | 4/2 | 89 (89–94) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-legacyWithCivil-1000 | newest | 96 (84–119) n=3 | 10/1053 | 31 (30–36) n=3 | 5/54 | legacy→keyset | 20 / 20 | -660.69 / 172 |
| history-legacyWithCivil-1000 | oldest | 92 (87–108) n=3 | 10/1053 | 35 (34–35) n=3 | 5/54 | legacy→keyset | 17 / 19 | 1990 / 171 |
| history-legacyWithCivil-1000 | search49 | 52 (39–79) n=3 | 7/470 | 52 (48–69) n=3 | 7/470 | end→end | 0.00 / 0.00 | 596 / 602 |
| history-legacyWithCivil-1000 | unicode | 93 (78–93) n=3 | 10/1053 | 64 (58–68) n=3 | 7/653 | legacy→keyset | 16 / 55 | 1341 / 713 |
| history-legacyWithCivil-1000 | absent | 51 (47–52) n=3 | 6/436 | 65 (45–71) n=3 | 6/436 | end→end | 0.00 / 0.00 | 531 / 542 |
| history-legacyWithCivil-1000 | combined | 20 (19–21) n=3 | 5/9 | 18 (15–23) n=3 | 5/9 | end→end | 0.00 / 0.00 | 73 / 83 |
| history-legacyWithCivil-10000 | newest | 561 (465–569) n=3 | 54/10042 | 30 (24–40) n=3 | 5/55 | legacy→keyset | 12 / 13 | -599.46 / 172 |
| history-legacyWithCivil-10000 | oldest | 564 (556–608) n=3 | 54/10042 | 290 (231–336) n=3 | 11/10054 | legacy→legacy | 14 / 16 | 856 / -516.53 |
| history-legacyWithCivil-10000 | search49 | 275 (272–289) n=3 | 27/4590 | 104 (96–110) n=3 | 8/1454 | legacy→keyset | 12 / 79 | 1491 / 1618 |
| history-legacyWithCivil-10000 | unicode | 452 (423–503) n=3 | 54/10040 | 62 (55–64) n=3 | 7/654 | legacy→keyset | 11 / 45 | 777 / -2931.20 |
| history-legacyWithCivil-10000 | absent | 286 (235–297) n=3 | 25/4329 | 224 (200–237) n=3 | 9/4346 | end→end | 0.00 / 0.00 | 1076 / 963 |
| history-legacyWithCivil-10000 | combined | 23 (19–23) n=3 | 5/55 | 45 (40–49) n=3 | 6/56 | end→end | 0.00 / 0.00 | 152 / 166 |
| history-legacyWithCivil-100000 | newest | 2833 (2833–2833) n=1 | 440/87156 | 314 (283–326) n=3 | 5/55 | legacy→keyset | 8.07 / 11 | 12259 / 172 |
| history-legacyWithCivil-100000 | oldest | 2828 (2828–2828) n=1 | 440/87156 | 1713 (1666–1745) n=3 | 25/100054 | legacy→legacy | 7.43 / 7.88 | 12952 / 17868 |
| history-legacyWithCivil-100000 | search49 | 1638 (1638–1638) n=1 | 233/45676 | 323 (322–325) n=3 | 8/1454 | legacy→keyset | 7.84 / 102 | 1485 / -2008.08 |
| history-legacyWithCivil-100000 | unicode | 2565 (2565–2565) n=1 | 440/87155 | 289 (280–293) n=3 | 7/654 | legacy→keyset | 8.41 / 23 | 5234 / 717 |
| history-legacyWithCivil-100000 | absent | 1478 (1478–1478) n=1 | 203/39836 | 1686 (1667–1688) n=3 | 15/43427 | end→end | 0.00 / 0.00 | 1890 / 10357 |
| history-legacyWithCivil-100000 | combined | 196 (196–196) n=1 | 6/341 | 379 (368–381) n=3 | 7/340 | legacy→legacy | 9.68 / 13 | 649 / 512 |
| history-mixed-1000 | newest | 83 (74–117) n=3 | 10/1053 | 56 (48–57) n=3 | 7/1053 | legacy→legacy | 18 / 17 | -418.55 / 746 |
| history-mixed-1000 | oldest | 75 (73–85) n=3 | 10/1053 | 56 (51–74) n=3 | 7/1053 | legacy→legacy | 18 / 18 | 1729 / 746 |
| history-mixed-1000 | search49 | 58 (54–63) n=3 | 7/470 | 50 (47–56) n=3 | 6/470 | end→end | 0.00 / 0.00 | 592 / 570 |
| history-mixed-1000 | unicode | 75 (72–87) n=3 | 10/1053 | 68 (62–72) n=3 | 7/1053 | legacy→legacy | 19 / 15 | -2408.55 / 1208 |
| history-mixed-1000 | absent | 41 (39–46) n=3 | 6/436 | 45 (39–48) n=3 | 5/436 | end→end | 0.00 / 0.00 | 528 / 509 |
| history-mixed-1000 | combined | 15 (15–17) n=3 | 4/2 | 15 (14–17) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-mixed-10000 | newest | 633 (611–644) n=3 | 55/10053 | 295 (284–310) n=3 | 10/10053 | legacy→legacy | 12 / 9.61 | 3206 / 2798 |
| history-mixed-10000 | oldest | 692 (649–759) n=3 | 55/10053 | 306 (306–332) n=3 | 10/10053 | legacy→legacy | 15 / 17 | 543 / -105.27 |
| history-mixed-10000 | search49 | 323 (318–368) n=3 | 27/4565 | 271 (225–291) n=3 | 9/4565 | legacy→legacy | 7.93 / 15 | 1697 / 1356 |
| history-mixed-10000 | unicode | 626 (575–634) n=3 | 55/10053 | 473 (444–546) n=3 | 10/10053 | legacy→legacy | 15 / 19 | 865 / 4077 |
| history-mixed-10000 | absent | 374 (328–389) n=3 | 25/4345 | 313 (277–326) n=3 | 8/4345 | end→end | 0.00 / 0.00 | 1059 / 950 |
| history-mixed-10000 | combined | 22 (21–22) n=3 | 4/2 | 27 (26–27) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-mixed-100000 | newest | 6645 (6645–6645) n=1 | 505/100053 | 1984 (1967–2177) n=3 | 24/100053 | legacy→legacy | 9.55 / 8.73 | -24532.33 / 19387 |
| history-mixed-100000 | oldest | 6636 (6636–6636) n=1 | 505/100053 | 1997 (1993–2004) n=3 | 24/100053 | legacy→legacy | 7.94 / 7.82 | 15575 / 18580 |
| history-mixed-100000 | search49 | 5339 (5339–5339) n=1 | 230/45174 | 1933 (1903–1973) n=3 | 16/45174 | legacy→legacy | 9.02 / 7.55 | 1023 / 13573 |
| history-mixed-100000 | unicode | 6398 (6398–6398) n=1 | 505/100053 | 2964 (2948–2970) n=3 | 24/100053 | legacy→legacy | 7.54 / 8.96 | 5239 / 25505 |
| history-mixed-100000 | absent | 5173 (5173–5173) n=1 | 221/43426 | 1865 (1830–1918) n=3 | 14/43426 | end→end | 0.00 / 0.00 | 1666 / 11297 |
| history-mixed-100000 | combined | 82 (82–82) n=1 | 4/2 | 131 (131–131) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |

| Sonda | Variante | Listado exacto | Páginas exactas | Filas/distintas/esperadas | Plan |
|---|---|---|---|---|---|
| order-probe | civil-1000-newestCurrent | false | false | 1015/979/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | civil-1000-newestPlusCreated | false | false | 1015/979/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | civil-1000-newestCastKey | true | true | 1000/1000/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort; USE TEMP B-TREE FOR ORDER |
| order-probe | civil-1000-oldestCurrent | true | true | 1000/1000/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort; USE TEMP B-TREE FOR ORDER |
| order-probe | civil-1000-oldestPlusCreated | true | true | 1000/1000/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | civil-1000-oldestOriginal5E | true | true | 1000/1000/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | civil-1000-newestCoalesce | false | false | 1015/979/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | civil-1000-oldestCoalesce | true | true | 1000/1000/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | legacyDay-3000-newestCurrent | false | false | 2977/2937/3000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | legacyDay-3000-newestPlusCreated | false | false | 2977/2937/3000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | legacyDay-3000-newestCastKey | true | true | 3000/3000/3000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort; USE TEMP B-TREE FOR ORDER |
| order-probe | legacyDay-3000-oldestCurrent | true | true | 3000/3000/3000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort; USE TEMP B-TREE FOR ORDER |
| order-probe | legacyDay-3000-oldestPlusCreated | true | true | 3000/3000/3000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | legacyDay-3000-oldestOriginal5E | true | true | 3000/3000/3000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | legacyDay-3000-newestCoalesce | false | false | 2977/2937/3000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | legacyDay-3000-oldestCoalesce | true | true | 3000/3000/3000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | legacyTied-1000-newestCurrent | true | true | 1000/1000/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | legacyTied-1000-newestPlusCreated | true | true | 1000/1000/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | legacyTied-1000-newestCastKey | true | true | 1000/1000/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort; USE TEMP B-TREE FOR ORDER |
| order-probe | legacyTied-1000-oldestCurrent | true | true | 1000/1000/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort; USE TEMP B-TREE FOR ORDER |
| order-probe | legacyTied-1000-oldestPlusCreated | false | false | 101/51/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | legacyTied-1000-oldestOriginal5E | false | false | 101/51/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | legacyTied-1000-newestCoalesce | true | true | 1000/1000/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |
| order-probe | legacyTied-1000-oldestCoalesce | false | false | 101/51/1000 | SCAN TABLE transactions USING INDEX idx_transactions_civil_sort |

| Campaña | Caso | 5E.2 = oráculo | Detalle (5E.1 coincide = frozenAgrees) |
|---|---|---|---|
| history-civil-1000 | newest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":false}} |
| history-civil-1000 | oldest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-civil-1000 | search49 | sí | {"single":{"pages":1,"total":17,"expected":17,"complete":true,"frozenAgrees":true}} |
| history-civil-1000 | unicode | sí | {"single":{"pages":3,"total":142,"expected":142,"complete":true,"frozenAgrees":false}} |
| history-civil-1000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-civil-1000 | combined | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-civil-10000 | newest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":false}} |
| history-civil-10000 | oldest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-civil-10000 | search49 | sí | {"single":{"pages":4,"total":170,"expected":170,"complete":true,"frozenAgrees":false}} |
| history-civil-10000 | unicode | sí | {"single":{"pages":29,"total":1428,"expected":1428,"complete":true,"frozenAgrees":false}} |
| history-civil-10000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-civil-10000 | combined | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-civil-100000 | newest | sí | {"single":{"pages":2000,"total":100000,"expected":100000,"complete":true,"frozenAgrees":false}} |
| history-civil-100000 | oldest | sí | {"single":{"pages":2000,"total":100000,"expected":100000,"complete":true,"frozenAgrees":true}} |
| history-civil-100000 | search49 | sí | {"single":{"pages":34,"total":1698,"expected":1698,"complete":true,"frozenAgrees":false}} |
| history-civil-100000 | unicode | sí | {"single":{"pages":286,"total":14285,"expected":14285,"complete":true,"frozenAgrees":false}} |
| history-civil-100000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-civil-100000 | combined | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-1000 | newest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-1000 | oldest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-1000 | search49 | sí | {"single":{"pages":1,"total":17,"expected":17,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-1000 | unicode | sí | {"single":{"pages":3,"total":142,"expected":142,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-1000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-1000 | combined | sí | {"single":{"pages":1,"total":3,"expected":3,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-10000 | newest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":false}} |
| history-legacyDay-10000 | oldest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":false}} |
| history-legacyDay-10000 | search49 | sí | {"single":{"pages":4,"total":170,"expected":170,"complete":true,"frozenAgrees":false}} |
| history-legacyDay-10000 | unicode | sí | {"single":{"pages":29,"total":1428,"expected":1428,"complete":true,"frozenAgrees":false}} |
| history-legacyDay-10000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-10000 | combined | sí | {"single":{"pages":1,"total":26,"expected":26,"complete":true,"frozenAgrees":false}} |
| history-legacyDay-100000 | newest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":false},"complete":{"pages":2000,"total":100000,"expected":100000,"complete":true}} |
| history-legacyDay-100000 | oldest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":false},"complete":{"pages":2000,"total":100000,"expected":100000,"complete":true}} |
| history-legacyDay-100000 | search49 | sí | {"lockstep":{"pages":3,"total":150,"expected":1698,"complete":false,"frozenAgrees":false},"complete":{"pages":34,"total":1698,"expected":1698,"complete":true}} |
| history-legacyDay-100000 | unicode | sí | {"lockstep":{"pages":3,"total":150,"expected":14285,"complete":false,"frozenAgrees":false},"complete":{"pages":286,"total":14285,"expected":14285,"complete":true}} |
| history-legacyDay-100000 | absent | sí | {"lockstep":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true},"complete":{"pages":1,"total":0,"expected":0,"complete":true}} |
| history-legacyDay-100000 | combined | sí | {"lockstep":{"pages":3,"total":150,"expected":286,"complete":false,"frozenAgrees":false},"complete":{"pages":6,"total":286,"expected":286,"complete":true}} |
| history-legacyTied-1000 | newest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-1000 | oldest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-1000 | search49 | sí | {"single":{"pages":1,"total":17,"expected":17,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-1000 | unicode | sí | {"single":{"pages":3,"total":142,"expected":142,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-1000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-1000 | combined | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-10000 | newest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-10000 | oldest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-10000 | search49 | sí | {"single":{"pages":4,"total":170,"expected":170,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-10000 | unicode | sí | {"single":{"pages":29,"total":1428,"expected":1428,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-10000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-10000 | combined | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-100000 | newest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":true},"complete":{"pages":40,"total":2000,"expected":100000,"complete":false}} |
| history-legacyTied-100000 | oldest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":true},"complete":{"pages":40,"total":2000,"expected":100000,"complete":false}} |
| history-legacyTied-100000 | search49 | sí | {"lockstep":{"pages":3,"total":150,"expected":1698,"complete":false,"frozenAgrees":true},"complete":{"pages":34,"total":1698,"expected":1698,"complete":true}} |
| history-legacyTied-100000 | unicode | sí | {"lockstep":{"pages":3,"total":150,"expected":14285,"complete":false,"frozenAgrees":true},"complete":{"pages":40,"total":2000,"expected":14285,"complete":false}} |
| history-legacyTied-100000 | absent | sí | {"lockstep":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true},"complete":{"pages":1,"total":0,"expected":0,"complete":true}} |
| history-legacyTied-100000 | combined | sí | {"lockstep":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true},"complete":{"pages":1,"total":0,"expected":0,"complete":true}} |
| history-legacyWithCivil-1000 | newest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-1000 | oldest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-1000 | search49 | sí | {"single":{"pages":1,"total":17,"expected":17,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-1000 | unicode | sí | {"single":{"pages":3,"total":142,"expected":142,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-1000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-1000 | combined | sí | {"single":{"pages":1,"total":3,"expected":3,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-10000 | newest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":false}} |
| history-legacyWithCivil-10000 | oldest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":false}} |
| history-legacyWithCivil-10000 | search49 | sí | {"single":{"pages":4,"total":170,"expected":170,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-10000 | unicode | sí | {"single":{"pages":29,"total":1428,"expected":1428,"complete":true,"frozenAgrees":false}} |
| history-legacyWithCivil-10000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-10000 | combined | sí | {"single":{"pages":1,"total":26,"expected":26,"complete":true,"frozenAgrees":false}} |
| history-legacyWithCivil-100000 | newest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":false},"complete":{"pages":2000,"total":100000,"expected":100000,"complete":true}} |
| history-legacyWithCivil-100000 | oldest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":false},"complete":{"pages":2000,"total":100000,"expected":100000,"complete":true}} |
| history-legacyWithCivil-100000 | search49 | sí | {"lockstep":{"pages":3,"total":150,"expected":1698,"complete":false,"frozenAgrees":false},"complete":{"pages":34,"total":1698,"expected":1698,"complete":true}} |
| history-legacyWithCivil-100000 | unicode | sí | {"lockstep":{"pages":3,"total":150,"expected":14285,"complete":false,"frozenAgrees":false},"complete":{"pages":286,"total":14285,"expected":14285,"complete":true}} |
| history-legacyWithCivil-100000 | absent | sí | {"lockstep":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true},"complete":{"pages":1,"total":0,"expected":0,"complete":true}} |
| history-legacyWithCivil-100000 | combined | sí | {"lockstep":{"pages":3,"total":150,"expected":286,"complete":false,"frozenAgrees":false},"complete":{"pages":6,"total":286,"expected":286,"complete":true}} |
| history-mixed-1000 | newest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-mixed-1000 | oldest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-mixed-1000 | search49 | sí | {"single":{"pages":1,"total":17,"expected":17,"complete":true,"frozenAgrees":true}} |
| history-mixed-1000 | unicode | sí | {"single":{"pages":3,"total":142,"expected":142,"complete":true,"frozenAgrees":true}} |
| history-mixed-1000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-mixed-1000 | combined | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-mixed-10000 | newest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-mixed-10000 | oldest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-mixed-10000 | search49 | sí | {"single":{"pages":4,"total":170,"expected":170,"complete":true,"frozenAgrees":true}} |
| history-mixed-10000 | unicode | sí | {"single":{"pages":29,"total":1428,"expected":1428,"complete":true,"frozenAgrees":true}} |
| history-mixed-10000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-mixed-10000 | combined | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-mixed-100000 | newest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":true},"complete":{"pages":2000,"total":100000,"expected":100000,"complete":true}} |
| history-mixed-100000 | oldest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":true},"complete":{"pages":2000,"total":100000,"expected":100000,"complete":true}} |
| history-mixed-100000 | search49 | sí | {"lockstep":{"pages":3,"total":150,"expected":1698,"complete":false,"frozenAgrees":true},"complete":{"pages":34,"total":1698,"expected":1698,"complete":true}} |
| history-mixed-100000 | unicode | sí | {"lockstep":{"pages":3,"total":150,"expected":14285,"complete":false,"frozenAgrees":true},"complete":{"pages":286,"total":14285,"expected":14285,"complete":true}} |
| history-mixed-100000 | absent | sí | {"lockstep":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true},"complete":{"pages":1,"total":0,"expected":0,"complete":true}} |
| history-mixed-100000 | combined | sí | {"lockstep":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true},"complete":{"pages":1,"total":0,"expected":0,"complete":true}} |

| Dashboard | Versión | Frío ms | Caliente mediana (mín–máx) | Igualdad exacta actual/baseline |
|---|---|---:|---:|---|
| dashboard-canonicalSpread-1000 | current | 14 | 11 (10–16) n=4 | sí |
| dashboard-canonicalSpread-1000 | baseline | - | 37 (33–49) n=4 | sí |
| dashboard-canonicalSpread-10000 | current | 14 | 13 (12–16) n=4 | sí |
| dashboard-canonicalSpread-10000 | baseline | - | 382 (380–387) n=4 | sí |
| dashboard-canonicalSpread-100000 | current | 40 | 36 (35–44) n=4 | sí |
| dashboard-canonicalSpread-100000 | baseline | - | 7067 (7027–7214) n=4 | sí |
| dashboard-integratedToday-1000 | current | 42 | 28 (26–46) n=4 | NO: [{"key":"monthlyIncome","current":258.2999999999997,"baseline":258.29999999999967},{"key":"monthlySavings","current":-413.3000000000029,"baseline":-413.30000000000297}] |
| dashboard-integratedToday-1000 | baseline | - | 79 (72–100) n=4 | NO: [{"key":"monthlyIncome","current":258.2999999999997,"baseline":258.29999999999967},{"key":"monthlySavings","current":-413.3000000000029,"baseline":-413.30000000000297}] |
| dashboard-integratedToday-10000 | current | 192 | 94 (92–109) n=4 | sí |
| dashboard-integratedToday-10000 | baseline | - | 373 (372–454) n=4 | sí |
| dashboard-integratedToday-100000 | current | 1944 | 1795 (1769–1813) n=4 | sí |
| dashboard-integratedToday-100000 | baseline | - | 6067 (6028–6314) n=4 | sí |
| dashboard-legacySpread-1000 | current | 31 | 27 (24–34) n=4 | sí |
| dashboard-legacySpread-1000 | baseline | - | 78 (75–109) n=4 | sí |
| dashboard-legacySpread-10000 | current | 16 | 13 (12–16) n=4 | sí |
| dashboard-legacySpread-10000 | baseline | - | 349 (347–361) n=4 | sí |
| dashboard-legacySpread-100000 | current | 37 | 36 (32–39) n=4 | sí |
| dashboard-legacySpread-100000 | baseline | - | 6682 (6543–6904) n=4 | sí |
| integrated-performance-1000 | integrado 5E | - | historial 13 ms; dashboard 17 ms | passed |
| integrated-performance-10000 | integrado 5E | - | historial 39 ms; dashboard 115 ms | passed |
| integrated-performance-100000 | integrado 5E | - | historial 271 ms; dashboard 2121 ms | passed |

| Dashboard (lecturas secuenciales) | accounts ms (filas) | monthlyAmounts ms (filas) | recentDayCounts ms (filas) | sharedPosition ms (filas) | lossPeriod ms (filas) | Suma JS ms |
|---|---:|---:|---:|---:|---:|---:|
| dashboard-canonicalSpread-1000 | 2.23 (4) | 2.77 (18) | 2.94 (26) | 2.75 (1) | 2.46 (1) | 0.01 |
| dashboard-canonicalSpread-10000 | 2.32 (4) | 3.37 (197) | 2.65 (34) | 2.91 (1) | 2.29 (1) | 0.01 |
| dashboard-canonicalSpread-100000 | 2.79 (4) | 18 (1969) | 7.48 (34) | 3.14 (1) | 2.50 (1) | 0.05 |
| dashboard-integratedToday-1000 | 4.40 (4) | 15 (900) | 5.63 (1) | 5.58 (1) | 4.42 (1) | 0.06 |
| dashboard-integratedToday-10000 | 2.48 (4) | 89 (9000) | 5.55 (1) | 3.01 (1) | 2.11 (1) | 0.22 |
| dashboard-integratedToday-100000 | 3.94 (4) | 1724 (90000) | 34 (1) | 3.41 (1) | 2.29 (1) | 3.30 |
| dashboard-legacySpread-1000 | 4.90 (4) | 4.11 (18) | 4.44 (26) | 5.41 (1) | 4.28 (1) | 0.03 |
| dashboard-legacySpread-10000 | 2.10 (4) | 3.22 (197) | 2.72 (34) | 3.00 (1) | 2.12 (1) | 0.01 |
| dashboard-legacySpread-100000 | 2.68 (4) | 19 (1969) | 7.20 (34) | 3.15 (1) | 2.39 (1) | 0.05 |

Condiciones observadas (198 lecturas): mWakefulness=Awake; batería 100–100 %; temperatura batería 0–0 °C.

## API35

| Campaña | Caso | 5E.1 ms mediana (mín–máx) | Sent./filas | 5E.2 ms mediana (mín–máx) | Sent./filas | Cursor 5E.1→5E.2 | Pág. 2 5E.1 / 5E.2 ms | Heap Hermes Δ 5E.1 / 5E.2 KB |
|---|---|---:|---:|---:|---:|---|---:|---:|
| history-civil-1000 | newest | 19 (18–24) n=3 | 5/54 | 17 (15–17) n=3 | 4/54 | keyset→keyset | 14 / 12 | 177 / 172 |
| history-civil-1000 | oldest | 17 (17–17) n=3 | 5/54 | 15 (15–16) n=3 | 4/54 | keyset→keyset | 12 / 12 | 179 / 174 |
| history-civil-1000 | search49 | 48 (47–48) n=3 | 8/470 | 43 (42–45) n=3 | 6/470 | end→end | 0.00 / 0.00 | 637 / 601 |
| history-civil-1000 | unicode | 43 (38–44) n=3 | 7/453 | 47 (45–51) n=3 | 6/653 | keyset→keyset | 40 / 43 | 626 / 730 |
| history-civil-1000 | absent | 86 (60–93) n=3 | 7/436 | 68 (63–72) n=3 | 5/436 | end→end | 0.00 / 0.00 | 572 / 537 |
| history-civil-1000 | combined | 20 (18–22) n=3 | 4/2 | 23 (20–24) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-civil-10000 | newest | 18 (18–20) n=3 | 5/54 | 17 (17–17) n=3 | 4/54 | keyset→keyset | 12 / 12 | 176 / 172 |
| history-civil-10000 | oldest | 63 (55–66) n=3 | 5/54 | 51 (49–52) n=3 | 4/54 | keyset→keyset | 45 / 37 | 179 / 174 |
| history-civil-10000 | search49 | 270 (246–288) n=3 | 8/653 | 234 (181–260) n=3 | 6/653 | keyset→keyset | 123 / 133 | -2823.85 / 749 |
| history-civil-10000 | unicode | 269 (226–345) n=3 | 11/1253 | 201 (123–317) n=3 | 7/1453 | keyset→keyset | 62 / 59 | 1556 / -1921.18 |
| history-civil-10000 | absent | 848 (838–853) n=3 | 26/4345 | 491 (413–512) n=3 | 8/4345 | end→end | 0.00 / 0.00 | 1270 / 1507 |
| history-civil-10000 | combined | 44 (40–86) n=3 | 4/2 | 69 (53–102) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-civil-100000 | newest | 125 (122–135) n=3 | 5/54 | 124 (120–131) n=3 | 4/54 | keyset→keyset | 59 / 59 | 177 / 172 |
| history-civil-100000 | oldest | 191 (185–217) n=3 | 5/54 | 119 (110–122) n=3 | 4/54 | keyset→keyset | 123 / 59 | 180 / 175 |
| history-civil-100000 | search49 | 77 (76–85) n=3 | 6/253 | 103 (101–103) n=3 | 5/253 | keyset→keyset | 51 / 82 | 341 / 327 |
| history-civil-100000 | unicode | 1082 (952–1735) n=3 | 59/10853 | 775 (722–790) n=3 | 10/12653 | keyset→keyset | 35 / 31 | 1415 / 4319 |
| history-civil-100000 | absent | 9116 (8630–9573) n=3 | 222/43426 | 3515 (3431–3545) n=3 | 14/43426 | end→end | 0.00 / 0.00 | 4840 / 11418 |
| history-civil-100000 | combined | 462 (460–482) n=3 | 4/2 | 861 (855–862) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-legacyDay-1000 | newest | 77 (75–79) n=3 | 10/1053 | 19 (17–19) n=3 | 4/54 | legacy→keyset | 11 / 12 | -465.77 / 159 |
| history-legacyDay-1000 | oldest | 84 (82–85) n=3 | 10/1053 | 18 (18–18) n=3 | 4/54 | legacy→keyset | 11 / 12 | -1395.65 / 159 |
| history-legacyDay-1000 | search49 | 42 (41–43) n=3 | 7/470 | 45 (45–46) n=3 | 6/470 | end→end | 0.00 / 0.00 | 594 / 590 |
| history-legacyDay-1000 | unicode | 207 (122–212) n=3 | 10/1053 | 119 (114–127) n=3 | 6/653 | legacy→keyset | 36 / 114 | 1338 / 700 |
| history-legacyDay-1000 | absent | 103 (95–106) n=3 | 6/436 | 107 (92–109) n=3 | 5/436 | end→end | 0.00 / 0.00 | 529 / 530 |
| history-legacyDay-1000 | combined | 62 (43–66) n=3 | 5/9 | 61 (55–72) n=3 | 5/9 | end→end | 0.00 / 0.00 | 73 / 83 |
| history-legacyDay-10000 | newest | 1560 (1537–1589) n=3 | 55/10053 | 59 (58–61) n=3 | 4/54 | legacy→keyset | 34 / 37 | -643.51 / 159 |
| history-legacyDay-10000 | oldest | 1586 (1581–1604) n=3 | 55/10053 | 59 (58–59) n=3 | 4/54 | legacy→keyset | 32 / 36 | 1053 / 159 |
| history-legacyDay-10000 | search49 | 834 (494–852) n=3 | 27/4565 | 265 (253–268) n=3 | 7/1453 | legacy→keyset | 32 / 249 | 1414 / 1603 |
| history-legacyDay-10000 | unicode | 1634 (1598–1779) n=3 | 55/10053 | 130 (124–195) n=3 | 6/653 | legacy→keyset | 29 / 119 | 883 / 698 |
| history-legacyDay-10000 | absent | 778 (669–808) n=3 | 25/4345 | 448 (405–508) n=3 | 8/4345 | end→end | 0.00 / 0.00 | 1079 / 940 |
| history-legacyDay-10000 | combined | 100 (99–109) n=3 | 5/55 | 133 (83–140) n=3 | 5/55 | end→end | 0.00 / 0.00 | 151 / 152 |
| history-legacyDay-100000 | newest | 23329 (23329–23329) n=1 | 505/100053 | 121 (110–169) n=3 | 4/54 | legacy→keyset | 29 / 45 | 11456 / 159 |
| history-legacyDay-100000 | oldest | 24533 (24533–24533) n=1 | 505/100053 | 89 (87–101) n=3 | 4/54 | legacy→keyset | 24 / 31 | -2697.89 / 161 |
| history-legacyDay-100000 | search49 | 12314 (12314–12314) n=1 | 230/45174 | 420 (409–455) n=3 | 7/1453 | legacy→keyset | 26 / 632 | 692 / -1916.32 |
| history-legacyDay-100000 | unicode | 23821 (23821–23821) n=1 | 505/100053 | 182 (175–195) n=3 | 6/653 | legacy→keyset | 25 / 117 | 5547 / 703 |
| history-legacyDay-100000 | absent | 13248 (13248–13248) n=1 | 221/43426 | 9590 (9514–10726) n=3 | 14/43426 | end→end | 0.00 / 0.00 | 1438 / 10432 |
| history-legacyDay-100000 | combined | 1285 (1285–1285) n=1 | 6/339 | 445 (440–628) n=3 | 5/253 | legacy→keyset | 35 / 108 | 643 / 318 |
| history-legacyTied-1000 | newest | 79 (78–81) n=3 | 10/1053 | 17 (17–17) n=3 | 4/54 | legacy→keyset | 11 / 15 | -489.27 / 158 |
| history-legacyTied-1000 | oldest | 80 (79–80) n=3 | 10/1053 | 17 (17–18) n=3 | 4/54 | legacy→keyset | 11 / 14 | -1525.84 / 158 |
| history-legacyTied-1000 | search49 | 48 (48–50) n=3 | 7/470 | 47 (47–48) n=3 | 6/470 | end→end | 0.00 / 0.00 | 586 / 582 |
| history-legacyTied-1000 | unicode | 219 (154–219) n=3 | 10/1053 | 124 (117–138) n=3 | 6/653 | legacy→keyset | 35 / 118 | 1321 / 691 |
| history-legacyTied-1000 | absent | 122 (114–125) n=3 | 6/436 | 121 (116–121) n=3 | 5/436 | end→end | 0.00 / 0.00 | 523 / 523 |
| history-legacyTied-1000 | combined | 38 (33–41) n=3 | 4/2 | 38 (32–53) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-legacyTied-10000 | newest | 3382 (3312–3440) n=3 | 55/10053 | 88 (86–118) n=3 | 4/54 | legacy→keyset | 31 / 87 | 2998 / 158 |
| history-legacyTied-10000 | oldest | 2865 (2473–3389) n=3 | 55/10053 | 141 (117–160) n=3 | 4/54 | legacy→keyset | 28 / 117 | 3011 / 158 |
| history-legacyTied-10000 | search49 | 2312 (1993–2411) n=3 | 27/4565 | 373 (361–390) n=3 | 7/1453 | legacy→keyset | 51 / 322 | -2244.18 / 1597 |
| history-legacyTied-10000 | unicode | 3084 (2124–3745) n=3 | 55/10053 | 202 (196–272) n=3 | 6/653 | legacy→keyset | 33 / 204 | 436 / 691 |
| history-legacyTied-10000 | absent | 1543 (1035–2106) n=3 | 25/4345 | 557 (516–612) n=3 | 8/4345 | end→end | 0.00 / 0.00 | 933 / 1124 |
| history-legacyTied-10000 | combined | 24 (21–27) n=3 | 4/2 | 30 (28–34) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-legacyTied-100000 | newest | 110946 (110946–110946) n=1 | 505/100053 | 370 (362–1318) n=3 | 4/54 | legacy→keyset | 11 / 380 | 1976 / 158 |
| history-legacyTied-100000 | oldest | 69834 (69834–69834) n=1 | 505/100053 | 1102 (367–1198) n=3 | 4/54 | legacy→keyset | 28 / 1188 | 9683 / 158 |
| history-legacyTied-100000 | search49 | 99707 (99707–99707) n=1 | 230/45174 | 1563 (1535–1577) n=3 | 7/1453 | legacy→keyset | 17 / 1571 | 339 / 1600 |
| history-legacyTied-100000 | unicode | 63069 (63069–63069) n=1 | 505/100053 | 784 (765–804) n=3 | 6/653 | legacy→keyset | 16 / 802 | 3758 / 696 |
| history-legacyTied-100000 | absent | 82165 (82165–82165) n=1 | 221/43426 | 8045 (7520–8762) n=3 | 14/43426 | end→end | 0.00 / 0.00 | 4967 / 8699 |
| history-legacyTied-100000 | combined | 111 (111–111) n=1 | 4/2 | 168 (167–175) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-legacyWithCivil-1000 | newest | 79 (79–80) n=3 | 10/1053 | 22 (22–24) n=3 | 5/54 | legacy→keyset | 12 / 12 | -660.73 / 172 |
| history-legacyWithCivil-1000 | oldest | 82 (81–84) n=3 | 10/1053 | 22 (22–23) n=3 | 5/54 | legacy→keyset | 12 / 12 | 1990 / 171 |
| history-legacyWithCivil-1000 | search49 | 42 (42–43) n=3 | 7/470 | 50 (48–51) n=3 | 7/470 | end→end | 0.00 / 0.00 | 596 / 602 |
| history-legacyWithCivil-1000 | unicode | 198 (144–211) n=3 | 10/1053 | 138 (131–138) n=3 | 7/653 | legacy→keyset | 32 / 111 | 1342 / 713 |
| history-legacyWithCivil-1000 | absent | 109 (101–110) n=3 | 6/436 | 101 (85–126) n=3 | 6/436 | end→end | 0.00 / 0.00 | 531 / 542 |
| history-legacyWithCivil-1000 | combined | 42 (37–42) n=3 | 5/9 | 44 (36–59) n=3 | 5/9 | end→end | 0.00 / 0.00 | 73 / 83 |
| history-legacyWithCivil-10000 | newest | 1577 (1526–1586) n=3 | 55/10053 | 81 (67–90) n=3 | 5/55 | legacy→keyset | 33 / 35 | -665.45 / 172 |
| history-legacyWithCivil-10000 | oldest | 1600 (1298–1759) n=3 | 55/10053 | 573 (448–610) n=3 | 11/10054 | legacy→legacy | 26 / 32 | 4930 / 2995 |
| history-legacyWithCivil-10000 | search49 | 892 (554–906) n=3 | 27/4565 | 284 (283–316) n=3 | 8/1454 | legacy→keyset | 34 / 242 | 1464 / 1618 |
| history-legacyWithCivil-10000 | unicode | 1624 (926–1886) n=3 | 55/10053 | 80 (63–163) n=3 | 7/654 | legacy→keyset | 15 / 53 | 764 / 713 |
| history-legacyWithCivil-10000 | absent | 752 (746–859) n=3 | 25/4345 | 504 (489–622) n=3 | 9/4346 | end→end | 0.00 / 0.00 | 1036 / 1399 |
| history-legacyWithCivil-10000 | combined | 103 (95–105) n=3 | 5/55 | 160 (155–163) n=3 | 6/56 | end→end | 0.00 / 0.00 | 152 / 166 |
| history-legacyWithCivil-100000 | newest | 14645 (14645–14645) n=1 | 505/100053 | 105 (87–136) n=3 | 5/55 | legacy→keyset | 25 / 35 | 11640 / 172 |
| history-legacyWithCivil-100000 | oldest | 13830 (13830–13830) n=1 | 505/100053 | 3847 (3649–3899) n=3 | 25/100054 | legacy→legacy | 22 / 19 | 13051 / 21607 |
| history-legacyWithCivil-100000 | search49 | 6719 (6719–6719) n=1 | 230/45174 | 213 (193–276) n=3 | 8/1454 | legacy→keyset | 19 / 316 | 5334 / -2178.22 |
| history-legacyWithCivil-100000 | unicode | 14107 (14107–14107) n=1 | 505/100053 | 190 (167–229) n=3 | 7/654 | legacy→keyset | 19 / 115 | 6106 / 717 |
| history-legacyWithCivil-100000 | absent | 7490 (7490–7490) n=1 | 221/43426 | 4145 (4133–4156) n=3 | 15/43427 | end→end | 0.00 / 0.00 | 2101 / 14006 |
| history-legacyWithCivil-100000 | combined | 655 (655–655) n=1 | 6/339 | 1248 (1247–1266) n=3 | 7/340 | legacy→legacy | 31 / 30 | 644 / 512 |
| history-mixed-1000 | newest | 77 (77–79) n=3 | 10/1053 | 46 (46–48) n=3 | 7/1053 | legacy→legacy | 12 / 11 | -419.54 / 746 |
| history-mixed-1000 | oldest | 77 (76–77) n=3 | 10/1053 | 47 (45–48) n=3 | 7/1053 | legacy→legacy | 11 / 11 | 1729 / 746 |
| history-mixed-1000 | search49 | 46 (44–46) n=3 | 7/470 | 43 (43–45) n=3 | 6/470 | end→end | 0.00 / 0.00 | 592 / 570 |
| history-mixed-1000 | unicode | 170 (164–174) n=3 | 10/1053 | 160 (149–161) n=3 | 7/1053 | legacy→legacy | 26 / 34 | -2409.42 / 1208 |
| history-mixed-1000 | absent | 105 (87–108) n=3 | 6/436 | 110 (82–111) n=3 | 5/436 | end→end | 0.00 / 0.00 | 528 / 509 |
| history-mixed-1000 | combined | 30 (28–32) n=3 | 4/2 | 32 (24–34) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-mixed-10000 | newest | 1784 (1483–2007) n=3 | 55/10053 | 489 (470–532) n=3 | 10/10053 | legacy→legacy | 33 / 29 | 3208 / 2803 |
| history-mixed-10000 | oldest | 1807 (1694–2411) n=3 | 55/10053 | 561 (447–575) n=3 | 10/10053 | legacy→legacy | 32 / 32 | 606 / -122.95 |
| history-mixed-10000 | search49 | 1096 (1081–1120) n=3 | 27/4565 | 570 (528–613) n=3 | 9/4565 | legacy→legacy | 32 / 32 | 1701 / 1372 |
| history-mixed-10000 | unicode | 1634 (1205–1799) n=3 | 55/10053 | 714 (642–762) n=3 | 10/10053 | legacy→legacy | 24 / 25 | 860 / 4100 |
| history-mixed-10000 | absent | 1044 (1034–1058) n=3 | 25/4345 | 510 (491–514) n=3 | 8/4345 | end→end | 0.00 / 0.00 | 971 / 1002 |
| history-mixed-10000 | combined | 80 (54–80) n=3 | 4/2 | 103 (97–106) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |
| history-mixed-100000 | newest | 30123 (30123–30123) n=1 | 505/100053 | 4473 (3891–4501) n=3 | 24/100053 | legacy→legacy | 19 / 16 | -27963.94 / 19414 |
| history-mixed-100000 | oldest | 31135 (31135–31135) n=1 | 505/100053 | 4650 (4616–4654) n=3 | 24/100053 | legacy→legacy | 18 / 18 | -42832.29 / 19452 |
| history-mixed-100000 | search49 | 28175 (28175–28175) n=1 | 230/45174 | 4972 (4932–5044) n=3 | 16/45174 | legacy→legacy | 28 / 18 | 4870 / 9712 |
| history-mixed-100000 | unicode | 32925 (32925–32925) n=1 | 505/100053 | 6393 (6388–6582) n=3 | 24/100053 | legacy→legacy | 18 / 18 | 1910 / 28373 |
| history-mixed-100000 | absent | 27954 (27954–27954) n=1 | 221/43426 | 4741 (4653–4750) n=3 | 14/43426 | end→end | 0.00 / 0.00 | 1495 / 11360 |
| history-mixed-100000 | combined | 239 (239–239) n=1 | 4/2 | 418 (417–419) n=3 | 4/3 | end→end | 0.00 / 0.00 | 53 / 63 |

| Sonda | Variante | Listado exacto | Páginas exactas | Filas/distintas/esperadas | Plan |
|---|---|---|---|---|---|
| order-probe | civil-1000-newestCurrent | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | civil-1000-newestPlusCreated | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | civil-1000-newestCastKey | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | civil-1000-oldestCurrent | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | civil-1000-oldestPlusCreated | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | civil-1000-oldestOriginal5E | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | civil-1000-newestCoalesce | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | civil-1000-oldestCoalesce | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyDay-3000-newestCurrent | true | true | 3000/3000/3000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyDay-3000-newestPlusCreated | true | true | 3000/3000/3000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyDay-3000-newestCastKey | true | true | 3000/3000/3000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyDay-3000-oldestCurrent | true | true | 3000/3000/3000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyDay-3000-oldestPlusCreated | true | true | 3000/3000/3000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyDay-3000-oldestOriginal5E | true | true | 3000/3000/3000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyDay-3000-newestCoalesce | true | true | 3000/3000/3000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyDay-3000-oldestCoalesce | true | true | 3000/3000/3000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyTied-1000-newestCurrent | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyTied-1000-newestPlusCreated | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyTied-1000-newestCastKey | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyTied-1000-oldestCurrent | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyTied-1000-oldestPlusCreated | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyTied-1000-oldestOriginal5E | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyTied-1000-newestCoalesce | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |
| order-probe | legacyTied-1000-oldestCoalesce | true | true | 1000/1000/1000 | EXPLAIN unavailable: another row available (Sqlite code 100 SQLITE_ROW), (OS error - 2:No  |

| Campaña | Caso | 5E.2 = oráculo | Detalle (5E.1 coincide = frozenAgrees) |
|---|---|---|---|
| history-civil-1000 | newest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-civil-1000 | oldest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-civil-1000 | search49 | sí | {"single":{"pages":1,"total":17,"expected":17,"complete":true,"frozenAgrees":true}} |
| history-civil-1000 | unicode | sí | {"single":{"pages":3,"total":142,"expected":142,"complete":true,"frozenAgrees":true}} |
| history-civil-1000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-civil-1000 | combined | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-civil-10000 | newest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-civil-10000 | oldest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-civil-10000 | search49 | sí | {"single":{"pages":4,"total":170,"expected":170,"complete":true,"frozenAgrees":true}} |
| history-civil-10000 | unicode | sí | {"single":{"pages":29,"total":1428,"expected":1428,"complete":true,"frozenAgrees":true}} |
| history-civil-10000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-civil-10000 | combined | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-civil-100000 | newest | sí | {"single":{"pages":2000,"total":100000,"expected":100000,"complete":true,"frozenAgrees":true}} |
| history-civil-100000 | oldest | sí | {"single":{"pages":2000,"total":100000,"expected":100000,"complete":true,"frozenAgrees":true}} |
| history-civil-100000 | search49 | sí | {"single":{"pages":34,"total":1698,"expected":1698,"complete":true,"frozenAgrees":true}} |
| history-civil-100000 | unicode | sí | {"single":{"pages":286,"total":14285,"expected":14285,"complete":true,"frozenAgrees":true}} |
| history-civil-100000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-civil-100000 | combined | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-1000 | newest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-1000 | oldest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-1000 | search49 | sí | {"single":{"pages":1,"total":17,"expected":17,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-1000 | unicode | sí | {"single":{"pages":3,"total":142,"expected":142,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-1000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-1000 | combined | sí | {"single":{"pages":1,"total":3,"expected":3,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-10000 | newest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-10000 | oldest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-10000 | search49 | sí | {"single":{"pages":4,"total":170,"expected":170,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-10000 | unicode | sí | {"single":{"pages":29,"total":1428,"expected":1428,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-10000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-10000 | combined | sí | {"single":{"pages":1,"total":26,"expected":26,"complete":true,"frozenAgrees":true}} |
| history-legacyDay-100000 | newest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":true},"complete":{"pages":2000,"total":100000,"expected":100000,"complete":true}} |
| history-legacyDay-100000 | oldest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":true},"complete":{"pages":2000,"total":100000,"expected":100000,"complete":true}} |
| history-legacyDay-100000 | search49 | sí | {"lockstep":{"pages":3,"total":150,"expected":1698,"complete":false,"frozenAgrees":true},"complete":{"pages":34,"total":1698,"expected":1698,"complete":true}} |
| history-legacyDay-100000 | unicode | sí | {"lockstep":{"pages":3,"total":150,"expected":14285,"complete":false,"frozenAgrees":true},"complete":{"pages":286,"total":14285,"expected":14285,"complete":true}} |
| history-legacyDay-100000 | absent | sí | {"lockstep":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true},"complete":{"pages":1,"total":0,"expected":0,"complete":true}} |
| history-legacyDay-100000 | combined | sí | {"lockstep":{"pages":3,"total":150,"expected":286,"complete":false,"frozenAgrees":true},"complete":{"pages":6,"total":286,"expected":286,"complete":true}} |
| history-legacyTied-1000 | newest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-1000 | oldest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-1000 | search49 | sí | {"single":{"pages":1,"total":17,"expected":17,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-1000 | unicode | sí | {"single":{"pages":3,"total":142,"expected":142,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-1000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-1000 | combined | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-10000 | newest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-10000 | oldest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-10000 | search49 | sí | {"single":{"pages":4,"total":170,"expected":170,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-10000 | unicode | sí | {"single":{"pages":29,"total":1428,"expected":1428,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-10000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-10000 | combined | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyTied-100000 | newest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":true},"complete":{"pages":40,"total":2000,"expected":100000,"complete":false}} |
| history-legacyTied-100000 | oldest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":true},"complete":{"pages":40,"total":2000,"expected":100000,"complete":false}} |
| history-legacyTied-100000 | search49 | sí | {"lockstep":{"pages":3,"total":150,"expected":1698,"complete":false,"frozenAgrees":true},"complete":{"pages":34,"total":1698,"expected":1698,"complete":true}} |
| history-legacyTied-100000 | unicode | sí | {"lockstep":{"pages":3,"total":150,"expected":14285,"complete":false,"frozenAgrees":true},"complete":{"pages":40,"total":2000,"expected":14285,"complete":false}} |
| history-legacyTied-100000 | absent | sí | {"lockstep":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true},"complete":{"pages":1,"total":0,"expected":0,"complete":true}} |
| history-legacyTied-100000 | combined | sí | {"lockstep":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true},"complete":{"pages":1,"total":0,"expected":0,"complete":true}} |
| history-legacyWithCivil-1000 | newest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-1000 | oldest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-1000 | search49 | sí | {"single":{"pages":1,"total":17,"expected":17,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-1000 | unicode | sí | {"single":{"pages":3,"total":142,"expected":142,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-1000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-1000 | combined | sí | {"single":{"pages":1,"total":3,"expected":3,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-10000 | newest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-10000 | oldest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-10000 | search49 | sí | {"single":{"pages":4,"total":170,"expected":170,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-10000 | unicode | sí | {"single":{"pages":29,"total":1428,"expected":1428,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-10000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-10000 | combined | sí | {"single":{"pages":1,"total":26,"expected":26,"complete":true,"frozenAgrees":true}} |
| history-legacyWithCivil-100000 | newest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":true},"complete":{"pages":2000,"total":100000,"expected":100000,"complete":true}} |
| history-legacyWithCivil-100000 | oldest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":true},"complete":{"pages":2000,"total":100000,"expected":100000,"complete":true}} |
| history-legacyWithCivil-100000 | search49 | sí | {"lockstep":{"pages":3,"total":150,"expected":1698,"complete":false,"frozenAgrees":true},"complete":{"pages":34,"total":1698,"expected":1698,"complete":true}} |
| history-legacyWithCivil-100000 | unicode | sí | {"lockstep":{"pages":3,"total":150,"expected":14285,"complete":false,"frozenAgrees":true},"complete":{"pages":286,"total":14285,"expected":14285,"complete":true}} |
| history-legacyWithCivil-100000 | absent | sí | {"lockstep":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true},"complete":{"pages":1,"total":0,"expected":0,"complete":true}} |
| history-legacyWithCivil-100000 | combined | sí | {"lockstep":{"pages":3,"total":150,"expected":286,"complete":false,"frozenAgrees":true},"complete":{"pages":6,"total":286,"expected":286,"complete":true}} |
| history-mixed-1000 | newest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-mixed-1000 | oldest | sí | {"single":{"pages":20,"total":1000,"expected":1000,"complete":true,"frozenAgrees":true}} |
| history-mixed-1000 | search49 | sí | {"single":{"pages":1,"total":17,"expected":17,"complete":true,"frozenAgrees":true}} |
| history-mixed-1000 | unicode | sí | {"single":{"pages":3,"total":142,"expected":142,"complete":true,"frozenAgrees":true}} |
| history-mixed-1000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-mixed-1000 | combined | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-mixed-10000 | newest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-mixed-10000 | oldest | sí | {"single":{"pages":200,"total":10000,"expected":10000,"complete":true,"frozenAgrees":true}} |
| history-mixed-10000 | search49 | sí | {"single":{"pages":4,"total":170,"expected":170,"complete":true,"frozenAgrees":true}} |
| history-mixed-10000 | unicode | sí | {"single":{"pages":29,"total":1428,"expected":1428,"complete":true,"frozenAgrees":true}} |
| history-mixed-10000 | absent | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-mixed-10000 | combined | sí | {"single":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true}} |
| history-mixed-100000 | newest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":true},"complete":{"pages":2000,"total":100000,"expected":100000,"complete":true}} |
| history-mixed-100000 | oldest | sí | {"lockstep":{"pages":3,"total":150,"expected":100000,"complete":false,"frozenAgrees":true},"complete":{"pages":2000,"total":100000,"expected":100000,"complete":true}} |
| history-mixed-100000 | search49 | sí | {"lockstep":{"pages":3,"total":150,"expected":1698,"complete":false,"frozenAgrees":true},"complete":{"pages":34,"total":1698,"expected":1698,"complete":true}} |
| history-mixed-100000 | unicode | sí | {"lockstep":{"pages":3,"total":150,"expected":14285,"complete":false,"frozenAgrees":true},"complete":{"pages":286,"total":14285,"expected":14285,"complete":true}} |
| history-mixed-100000 | absent | sí | {"lockstep":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true},"complete":{"pages":1,"total":0,"expected":0,"complete":true}} |
| history-mixed-100000 | combined | sí | {"lockstep":{"pages":1,"total":0,"expected":0,"complete":true,"frozenAgrees":true},"complete":{"pages":1,"total":0,"expected":0,"complete":true}} |

| Dashboard | Versión | Frío ms | Caliente mediana (mín–máx) | Igualdad exacta actual/baseline |
|---|---|---:|---:|---|
| dashboard-canonicalSpread-1000 | current | 13 | 9.80 (9.76–10) n=4 | sí |
| dashboard-canonicalSpread-1000 | baseline | - | 90 (89–93) n=4 | sí |
| dashboard-canonicalSpread-10000 | current | 17 | 19 (15–34) n=4 | sí |
| dashboard-canonicalSpread-10000 | baseline | - | 861 (854–925) n=4 | sí |
| dashboard-canonicalSpread-100000 | current | 141 | 131 (130–174) n=4 | sí |
| dashboard-canonicalSpread-100000 | baseline | - | 25149 (23087–25197) n=4 | sí |
| dashboard-integratedToday-1000 | current | 35 | 30 (29–31) n=4 | NO: [{"key":"monthlyIncome","current":258.2999999999997,"baseline":258.29999999999967},{"key":"monthlySavings","current":-413.3000000000029,"baseline":-413.30000000000297}] |
| dashboard-integratedToday-1000 | baseline | - | 92 (91–95) n=4 | NO: [{"key":"monthlyIncome","current":258.2999999999997,"baseline":258.29999999999967},{"key":"monthlySavings","current":-413.3000000000029,"baseline":-413.30000000000297}] |
| dashboard-integratedToday-10000 | current | 204 | 206 (203–289) n=4 | sí |
| dashboard-integratedToday-10000 | baseline | - | 813 (811–887) n=4 | sí |
| dashboard-integratedToday-100000 | current | 3065 | 4166 (3190–4401) n=4 | sí |
| dashboard-integratedToday-100000 | baseline | - | 18933 (16661–21339) n=4 | sí |
| dashboard-legacySpread-1000 | current | 16 | 11 (10–13) n=4 | sí |
| dashboard-legacySpread-1000 | baseline | - | 86 (86–101) n=4 | sí |
| dashboard-legacySpread-10000 | current | 18 | 20 (17–49) n=4 | sí |
| dashboard-legacySpread-10000 | baseline | - | 795 (784–897) n=4 | sí |
| dashboard-legacySpread-100000 | current | 126 | 122 (119–133) n=4 | sí |
| dashboard-legacySpread-100000 | baseline | - | 21583 (21466–21639) n=4 | sí |
| integrated-performance-1000 | integrado 5E | - | historial 54 ms; dashboard 101 ms | passed |
| integrated-performance-10000 | integrado 5E | - | historial 55 ms; dashboard 316 ms | passed |
| integrated-performance-100000 | integrado 5E | - | historial 406 ms; dashboard 4143 ms | passed |

| Dashboard (lecturas secuenciales) | accounts ms (filas) | monthlyAmounts ms (filas) | recentDayCounts ms (filas) | sharedPosition ms (filas) | lossPeriod ms (filas) | Suma JS ms |
|---|---:|---:|---:|---:|---:|---:|
| dashboard-canonicalSpread-1000 | 1.83 (4) | 2.06 (18) | 2.04 (26) | 1.88 (1) | 1.77 (1) | 0.00 |
| dashboard-canonicalSpread-10000 | 7.49 (4) | 18 (197) | 8.28 (34) | 7.52 (1) | 7.13 (1) | 0.05 |
| dashboard-canonicalSpread-100000 | 5.37 (4) | 96 (1969) | 7.14 (34) | 6.30 (1) | 5.47 (1) | 0.50 |
| dashboard-integratedToday-1000 | 2.53 (4) | 21 (900) | 3.19 (1) | 2.33 (1) | 2.00 (1) | 0.09 |
| dashboard-integratedToday-10000 | 5.65 (4) | 201 (9000) | 8.75 (1) | 6.96 (1) | 7.27 (1) | 0.98 |
| dashboard-integratedToday-100000 | 4.69 (4) | 3267 (90000) | 37 (1) | 4.56 (1) | 4.14 (1) | 9.38 |
| dashboard-legacySpread-1000 | 1.90 (4) | 2.06 (18) | 1.87 (26) | 1.85 (1) | 1.76 (1) | 0.00 |
| dashboard-legacySpread-10000 | 8.05 (4) | 16 (197) | 7.93 (34) | 9.99 (1) | 6.77 (1) | 0.05 |
| dashboard-legacySpread-100000 | 5.95 (4) | 98 (1969) | 7.64 (34) | 5.64 (1) | 7.91 (1) | 0.48 |

Condiciones observadas (245 lecturas): mWakefulness=Awake, mWakefulness=Asleep; batería 99–100 %; temperatura batería 32–36 °C.
Campañas con lectura distinta de Awake: history-legacyDay-100000.
