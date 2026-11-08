---
paths:
  - "src/modules/*/ui/**/*.{ts,tsx}"
  - "src/modules/*/hooks/**/*.{ts,tsx}"
  - "src/shared/components/**/*.{ts,tsx}"
  - "src/shared/hooks/**/*.{ts,tsx}"
  - "src/app/**/*.{ts,tsx}"
  - "src/navigation/**/*.{ts,tsx}"
---

# Interfaz React Native: estados y confirmación

Al cambiar pantallas, componentes, hooks o navegación:

- Cubre los estados de carga, vacío, éxito, error y recuperación de cada flujo que toques.
- Bloquea los envíos duplicados mientras una operación está en curso.
- Presenta como hecho solo el resultado que el caso de uso confirmó después del COMMIT; no anticipes el éxito.
- Da a cada elemento interactivo rol, etiqueta y estado accesibles.
- Reutiliza los componentes y patrones visuales existentes antes de crear otros.
- Consulta la skill `react-native-best-practices` solo ante un problema de renderizado, listas o memoria.

No impongas `useMemo`/`useCallback`, bibliotecas nuevas ni un sistema de diseño nuevo.
