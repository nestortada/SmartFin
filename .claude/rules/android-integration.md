---
paths:
  - "android/**/*.{kt,java,xml,gradle,kts}"
  - "src/native/**/*.ts"
  - "src/modules/*/services/**/*.ts"
  - "src/database/databaseCoordination.ts"
---

# Integración Android: el contrato a ambos lados

Al cambiar código nativo o sus puentes:

- Revisa juntos los dos lados del contrato TypeScript–Kotlin: métodos, forma de las respuestas, errores y registro del módulo.
- Trata cada respuesta nativa como `unknown` y valídala antes de exponer tipos.
- Cubre las rutas de éxito, error, cancelación y proceso destruido.
- Comprueba la compatibilidad con la configuración Android real, leída de Gradle y del manifest, no supuesta.
- Separa lo verificable en Node de lo que exige dispositivo o emulador, y deja esto último como pendiente.
- Consulta `smartfin-android-campaign`, `smartfin-sqlite-architecture` o `smartfin-security-privacy` según corresponda.

Esta regla no autoriza compilar, instalar APK, ejecutar campañas ni usar dispositivos con datos reales.
