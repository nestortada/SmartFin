---
paths:
  - "__tests__/**/*.{ts,tsx,js,cjs}"
---

# Pruebas: propósito y evidencia

Al crear o cambiar pruebas:

- Vincula cada prueba a un requisito, defecto o contrato concreto.
- No ajustes expectativas para ocultar un error; si un resultado cambia, explica por qué.
- Distingue la caracterización de un defecto (`test.failing` en las reproducciones) de la aceptación de su corrección.
- Usa fixtures sintéticos y deterministas, con los volúmenes representativos que define AGENTS.md.
- Declara si la prueba usa mocks, SQLite real en Node o requiere Android.
- Para regresiones complejas o campañas, consulta la skill `smartfin-testing-qa`.
- No añadas pruebas que solo comprueben que existe un texto literal.
