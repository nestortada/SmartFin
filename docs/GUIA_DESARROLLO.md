# Guía de desarrollo

## 1. Preparación

Requisitos mínimos:

- Node.js `>=22.11.0`;
- npm;
- Android Studio/SDK para Android;
- macOS y Xcode para iOS;
- Ruby, Bundler y CocoaPods para dependencias iOS.

Instalación:

```sh
npm install
```

El `postinstall` ejecuta `scripts/patchReactNativeSqliteStorage.js`. El script reemplaza `jcenter()` por `mavenCentral()` y ajusta el plugin de Android de la dependencia SQLite. Al reinstalar dependencias, este parche se vuelve a aplicar de forma idempotente.

Para iOS:

```sh
bundle install
bundle exec pod install --project-directory=ios
```

## 2. Comandos

| Comando | Propósito |
|---|---|
| `npm start` | Iniciar Metro |
| `npm run android` | Compilar e instalar Android |
| `npm run ios` | Compilar e iniciar iOS |
| `npm test -- --runInBand` | Ejecutar todas las pruebas en serie |
| `npx tsc --noEmit` | Verificar TypeScript estricto |
| `npm run lint` | Ejecutar ESLint |

El repositorio no contiene hoy scripts dedicados `typecheck`, `test:watch` o CI.

## 3. Configuración relevante

- `tsconfig.json`: `strict`, `noImplicitReturns`, `noUncheckedIndexedAccess` y `noFallthroughCasesInSwitch`.
- `.eslintrc.js`: preset React Native; permite estilos dependientes del tema en línea.
- `jest.config.js`: preset de Jest para React Native.
- `android/gradle.properties`: Hermes y nueva arquitectura habilitados.
- `android/build.gradle`: min SDK 24, compile/target SDK 36 y Kotlin 2.1.20.

## 4. Convenciones de arquitectura

### Nueva regla financiera

1. Define o reutiliza tipos en el módulo correspondiente.
2. Implementa la regla en `useCases`, idealmente como función pura o con dependencias inyectadas.
3. Expón solo los métodos necesarios del repositorio.
4. Añade pruebas con repositorios falsos o dobles de SQLite.
5. Conecta la UI mediante un hook o una llamada coordinada.

No pongas cálculos financieros ni consultas SQL en un componente React.

### Nueva persistencia

1. Añade DDL compatible e idempotente a `sqliteSchema.ts`.
2. Añade una migración ligera si una base ya instalada necesita columnas o datos nuevos.
3. Crea el mapper fila-dominio usando los lectores seguros de `sqliteRows.ts`.
4. Mantén el acceso detrás de `repositories`.
5. Decide si la tabla debe aumentar `financial_data_revision`.
6. Actualiza `BASE_DE_DATOS.md`, el borrado financiero y el respaldo si aplica.

### Nuevo módulo

```text
src/modules/nuevaCapacidad/
├── types/
├── useCases/
├── repositories/
├── hooks/
├── ui/
└── index.ts
```

Empieza por dominio y pruebas; añade carpetas solo cuando tengan una responsabilidad real. Mantén una API pública explícita en `index.ts`.

### Nueva integración de plataforma

- Define un contrato TypeScript en `services`.
- Mantén Android/iOS detrás de esa interfaz.
- Trata cualquier retorno nativo como `unknown`.
- Comprueba plataforma y métodos disponibles.
- Documenta el comportamiento degradado.
- No introduzcas red ni un proveedor externo sin aprobación explícita.

## 5. Tipos de dominio

Evita `any`. Si un límite no es confiable, usa `unknown` y valida. Los tipos principales son:

- `Money`, `CurrencyCode`, `ISODateString` en `src/shared/types`;
- `Account` en `modules/accounts/types`;
- `Transaction` en `modules/transactions/types`;
- `Category` en `modules/categories/types`;
- tipos de tarjeta y cuotas en `modules/creditCards/types`;
- `SettingsState` en `modules/settings/types`.

La moneda solo admite `COP`. Ampliarla requiere revisar formateo, persistencia, agregaciones y conversiones; no basta con extender la unión.

## 6. Repositorios y transacciones lógicas

Los contratos de repositorio permiten probar casos de uso sin un dispositivo. Cuando una operación afecta varias tablas, el caso de uso coordina el orden. Si una nueva regla necesita atomicidad fuerte, usa una transacción SQLite explícita en el repositorio/adaptador en vez de confiar en una secuencia de promesas.

No introduzcas una implementación remota directamente en la UI. Una futura sincronización debe implementar contratos separados y resolver conflictos en la capa de datos.

## 7. Fechas y zonas horarias

- Persiste instantes como ISO 8601.
- Para agrupación mensual se usa hoy el prefijo `YYYY-MM`.
- Para ventanas de días, el dashboard normaliza al día local.
- Las funciones de corte de tarjeta deben probar días límite, cambios de mes y años bisiestos.
- No construyas fechas con cadenas ambiguas dependientes del locale.

## 8. Dinero

El modelo actual usa `number` y SQLite `REAL`. Mientras esto se mantenga:

- valida `Number.isFinite` y montos positivos donde corresponda;
- redondea resultados de cuotas y pagos con una regla explícita;
- evita comparar resultados de punto flotante sin tolerancia;
- documenta qué ocurre con residuos de división;
- no mezcles monedas.

Para una migración futura, se recomienda representar dinero en unidades menores enteras con un tipo nominal o usar una biblioteca decimal cuidadosamente aislada.

## 9. Datos demo y primera ejecución

En una base vacía se insertan categorías y cuentas mock. En el primer arranque normal también se insertan datos demo de tarjetas. Tras usar “Eliminar datos financieros”, se recrean cuentas con saldo cero y no se vuelve a sembrar la demo de tarjetas.

Si cambia este comportamiento, añade una bandera de onboarding o seed versionado; no deduzcas “primera ejecución” solo por una tabla parcialmente vacía.

## 10. Depuración

Problemas frecuentes:

- **SQLite no compila en Android:** confirma que `npm install` ejecutó el parche y que `node_modules` no quedó a medio instalar.
- **Módulo nativo no disponible:** reinstala/recompila la app; Fast Refresh no registra módulos Kotlin nuevos.
- **Respaldo perdió acceso:** selecciona de nuevo la carpeta; algunos proveedores solo conceden permiso temporal.
- **Dashboard no refleja un cambio:** confirma que el flujo incrementa la clave de refresco tras mutar datos.
- **iOS no ofrece seguridad/respaldo:** es una limitación conocida; las implementaciones son Android-only.

## 11. Documentación obligatoria por cambio

| Cambio | Documentos mínimos |
|---|---|
| Nueva capacidad visible | Producto, módulos y roadmap |
| Nueva tabla/campo/migración | Base de datos y arquitectura |
| Nueva regla financiera | Módulos y pruebas |
| Nueva integración externa | Seguridad, arquitectura y producto |
| Cambio de entorno o comando | README y guía de desarrollo |
| Cambio de plataforma soportada | README, producto y seguridad |
