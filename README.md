# SmartFin

SmartFin es una aplicación móvil de finanzas personales construida con React Native y TypeScript. Su núcleo actual permite administrar movimientos, cuentas débito, tarjetas de crédito, categorías, seguridad local y respaldos elegidos por el usuario. La persistencia principal es SQLite en el dispositivo.

El proyecto sigue tres principios:

- **Local-first:** la aplicación funciona sobre datos almacenados localmente.
- **Offline-first:** las operaciones financieras principales no dependen de una conexión.
- **Privacy-first:** no hay telemetría, analítica, sincronización automática ni servicios financieros de terceros.

> Estado documentado: 27 de septiembre de 2026. La visión original incluida en `SmartFin_Objetivos_y_Funcionalidades.pdf` es más amplia que la implementación actual. Consulta [Producto y alcance](docs/PRODUCTO_Y_ALCANCE.md) para distinguir lo disponible de lo planificado.

## Estado actual

| Área | Estado |
|---|---|
| Dashboard financiero | Implementado |
| Movimientos manuales, filtros, edición y categorización | Implementado |
| Transferencias internas y cobro opcional del 4x1000 | Implementado |
| Cuentas y tarjetas débito | Implementado |
| Tarjetas de crédito, cuotas, extractos y pagos | Implementado |
| Categorías personalizadas | Implementado |
| Tema claro/oscuro, PIN y biometría Android | Implementado |
| Respaldo manual a una carpeta visible de Google Drive en Android | Implementado, sin cifrado |
| Presupuestos, préstamos, metas, suscripciones y reportes | Modelo preparado; interfaz y casos de uso pendientes |
| Captura de SMS/notificaciones, OCR e inversiones | Planificado |

## Tecnologías

- React Native `0.85.3` y React `19.2.3`.
- TypeScript estricto `5.8.3`.
- SQLite mediante `react-native-sqlite-storage`.
- Jest para pruebas unitarias.
- Kotlin para los módulos nativos Android de seguridad y respaldo.
- Hermes y la nueva arquitectura de React Native habilitados en Android.

## Requisitos

- Node.js `22.11.0` o superior.
- npm.
- Entorno de React Native configurado para la plataforma elegida.
- Android: Android SDK 36, JDK compatible y un emulador o dispositivo.
- iOS: macOS, Xcode, Ruby/Bundler y CocoaPods.

La guía oficial de preparación del entorno está en [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment).

## Instalación

```sh
npm install
```

El `postinstall` adapta la dependencia `react-native-sqlite-storage` para repositorios y versiones modernas de Gradle. No edites directamente su copia dentro de `node_modules`.

En iOS, instala también los pods:

```sh
bundle install
bundle exec pod install --project-directory=ios
```

## Ejecución

Inicia Metro:

```sh
npm start
```

En otra terminal, ejecuta una plataforma:

```sh
npm run android
npm run ios
```

Las funciones nativas de PIN, biometría y respaldo en Google Drive están implementadas solo para Android. En iOS, la aplicación conserva el resto del flujo, pero esas capacidades no están disponibles.

## Verificación

```sh
npm test -- --runInBand
npx tsc --noEmit
npm run lint
```

Estado de referencia al documentar: **13 suites y 51 pruebas aprobadas**, sin errores de TypeScript ni ESLint.

## Estructura principal

```text
SmartFin/
├── android/                 # Proyecto nativo y módulos Kotlin
├── ios/                     # Proyecto nativo iOS
├── src/
│   ├── app/                 # Composición raíz
│   ├── database/            # SQLite, esquema, filas y seed
│   ├── modules/             # Módulos por capacidad de negocio
│   ├── navigation/          # Navegación y coordinación de la app
│   ├── shared/              # Componentes, tipos, hooks y utilidades comunes
│   └── native/              # Límites de integración nativa
├── __tests__/               # Pruebas unitarias y de repositorios
├── docs/                    # Documentación del proyecto
└── scripts/                 # Automatización de instalación
```

## Documentación

El punto de entrada completo es [docs/INDICE.md](docs/INDICE.md).

- [Producto y alcance](docs/PRODUCTO_Y_ALCANCE.md)
- [Arquitectura](docs/ARQUITECTURA.md)
- [Módulos y flujos](docs/MODULOS_Y_FLUJOS.md)
- [Base de datos](docs/BASE_DE_DATOS.md)
- [Seguridad y privacidad](docs/SEGURIDAD_Y_PRIVACIDAD.md)
- [Guía de desarrollo](docs/GUIA_DESARROLLO.md)
- [Pruebas y calidad](docs/PRUEBAS_Y_CALIDAD.md)
- [Roadmap](docs/ROADMAP.md)
- [Guía de contribución](CONTRIBUTING.md)

## Decisiones esenciales

- Las pantallas no contienen reglas financieras ni consultan SQLite directamente.
- La lógica financiera vive en `useCases`; la persistencia, detrás de `repositories`.
- Las integraciones de plataforma viven en `services` o código nativo.
- La moneda de dominio implementada es COP.
- Agregar red, telemetría, sincronización o proveedores financieros requiere una decisión explícita de producto.

## Advertencia sobre respaldos

El respaldo Android exporta una copia SQLite y archivos CSV **sin cifrar** a la carpeta que el usuario selecciona mediante el selector de documentos del sistema. SmartFin no usa la API de Google Drive ni recibe credenciales de Google. El proveedor de documentos controla la subida efectiva a la nube.

## Licencia

El repositorio no incluye actualmente un archivo de licencia. No se debe asumir permiso de redistribución fuera de los derechos del propietario del proyecto.
