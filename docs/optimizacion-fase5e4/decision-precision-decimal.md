# Decisión pendiente: precisión decimal del dashboard (sin cambios en 5E.4)

Fase 5E.4 **no modifica** el orden de acumulación del dashboard ni el modelo monetario. Esta nota solo
conserva la decisión abierta de 5E.3 ([informe 5E.3, sección 4](../aceptacion-integrada-fase5e3.md)).

- El orden efectivo (`ORDER BY date DESC, created_at DESC` sin desempate) entrega hoy rowid ASC en Node,
  SQLite 3.9.2 y 3.44.5. Las diferencias contra la referencia histórica son binarias; ingresos, gastos y
  ahorro coinciden al centavo en decimal exacto.
- Un total exacto terminado en ,50 COP puede mostrarse con $1 de diferencia según el orden de suma
  **y según el formateador `Intl` de cada versión de Android** (API 24 redondea el decimal exacto;
  HONOR/V8 redondean el binario). Fijar un desempate no corrige el caso sin empates.

Opciones que requieren autorización explícita:

1. Mantener el estado actual.
2. Desempate explícito `rowid ASC`: reproduce el resultado medido actual; cambia el SQL de un cálculo
   financiero sin cambio observable medido.
3. Suma exacta en centavos enteros y formato desde el decimal exacto: corrige ambas causas, pero es un
   cambio observable de modelo monetario (fase propia, con migración de pruebas y snapshots).
