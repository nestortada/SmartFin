Intentos API 24 no válidos, conservados como evidencia:
- 26–27 oct: el host se suspendió durante `volume-100000-pesos` (6 h sin actividad hasta un `TIME_SET`); las
  campañas siguientes fallaron con «SQLite state verification receipt timed out» tras el salto de reloj.
- 30 oct: un relanzamiento por error mientras la serie original seguía viva; esos casos se rechazaron por el
  mutex («Another synthetic campaign is active») sin llegar a ejecutarse.
- 30 oct: la sesión terminó y el emulador se cerró con la serie en curso.
Las campañas se repitieron desde cero; los resultados válidos están en la carpeta superior.
