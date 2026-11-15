---
paths:
  - "scripts/*.js"
  - "package.json"
  - "package-lock.json"
  - ".nvmrc"
---

# Scripts del repositorio, parches del driver y dependencias

Al cambiar estos archivos:

- `scripts/patchReactNativeSqliteStorage.js` y `scripts/sqlite*Patch.js` modifican el driver SQLite instalado por `postinstall`. Cambiarlos es cambiar el driver: requiere aprobación explícita del propietario, pruebas de los parches (`__tests__/sqlite*Patch.test.ts`) y revisión de `android-native-reviewer`.
- La CI comprueba que los parches estén aplicados tras `npm ci`; un parche nuevo necesita su comprobación.
- Una dependencia nueva o actualizada requiere aprobación explícita. Revisa versión resuelta, dependencias transitivas y scripts `postinstall`; no ejecutes `npm audit fix`.
- `.nvmrc` y `engines` fijan Node 24; no los cambies sin aprobación.
- `scripts/syncAgentSkills.js` solo copia skills; no le añadas otras responsabilidades.
- Los scripts de campañas Android (`scripts/phase*/`, `scripts/c3a/`) solo se ejecutan con autorización y la skill `smartfin-android-campaign`.
