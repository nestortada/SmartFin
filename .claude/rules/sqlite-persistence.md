---
paths:
  - "src/database/**/*.ts"
  - "src/modules/*/repositories/**/*.ts"
  - "src/modules/*/database/**/*.ts"
---

# Persistencia SQLite: lecturas, escrituras y contratos

Antes de cambiar estos archivos:

- Identifica qué lee y qué escribe el cambio y quién consume cada resultado, incluidos contratos amplios como `getTransactions()`.
- Determina si la operación participa en un ámbito transaccional compartido con otros repositorios o casos de uso, y quién es su dueño.
- Localiza los contratos de repositorio y los validadores de filas afectados y mantenlos alineados con el SQL.
- Ante cambios de SQL, índices, migraciones, concurrencia, recuperación o rendimiento, consulta la skill `smartfin-sqlite-architecture`.
- Separa las pruebas de equivalencia de resultados de las mediciones de rendimiento: una no sustituye a la otra.

Esta regla no autoriza cambios de esquema.
