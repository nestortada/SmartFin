# SmartFin: prueba visual aislada con Maestro (Codex y Claude Code)

**Estado:** configuración propuesta, no ejecutada en Android por este cambio. El preparador no compila ni instala APK, no ejecuta `adb`, no abre la base financiera del usuario y no modifica el repositorio de producción. **No confundir preparación con validación visual aprobada.**

## Arquitectura

- El preparador `prepare.cjs` **solo** genera un workspace nuevo, externo al checkout de SmartFin. No se reutiliza el harness `com.smartfin.snapshot5b2.tests`.
- La copia utiliza `applicationId=com.smartfin.visualtests`, archivo SQLite `smartfin_visual_synthetic.db` tanto en TypeScript como en referencias literales Kotlin/Java, y `.env` vacío.
- Su `index.js` ejecuta `VisualBootstrap.jsx`, que inserta un fixture en una transacción SQLite confirmada **antes de renderizar el App real** (`src/app/App.tsx` → `AppNavigator` → `DashboardScreen`). La identidad del fixture impide duplicarlo en cada inicio.
- En la copia se deshabilita el mantenimiento automático de suscripciones al montar, y se eliminan los receptores de arranque/recordatorio del manifiesto. Los módulos de producción pueden seguir disponibles para pruebas manuales sintéticas; **no usar esta APK con datos reales**.
- No se cambia `AGENTS.md`, la lógica financiera de producción, el código del repositorio principal, los harness de atomicidad ni los límites existentes de permisos de compilación.

**Límite:** una base aislada por paquete no demuestra por sí sola ausencia de cada efecto nativo. Antes de compilar, revisar el manifiesto final, los módulos Kotlin y las referencias a almacenamiento externo, `WorkManager`, SAF, notificaciones, tareas headless y recuperación. No autorizar operaciones nativas automáticas no previstas. Si el control de compilación existente no admite la nueva APK, detenerse; **no eludir el guard**.

## 1. Preparar, solamente después de revisar el checkout y el guard

En PowerShell, con la rama de este trabajo disponible localmente:

```powershell
cd C:\Users\nesto\Proyectos\SmartFin
git status --short
node scripts/maestro-visual/prepare.cjs C:\sf-smartfin-visual-synthetic-20261101
```

Requisitos: Node, dependencias existentes en `node_modules`, `ANDROID_HOME` válido y carpeta de destino **inexistente**. El script falla si el paquete de producción o nombre de base de datos dejan de coincidir con lo esperado. Guarda huellas de integridad en `visual-isolation-audit.json`.

**No ejecutar preparación si no se ha comprobado que el checkout local incluye esta rama.** Nunca preparar encima de una carpeta existente. No usar `npm install` dentro de la variante salvo revisión explícita.

## 2. Compilar e instalar

Primero se necesita **validar y autorizar el límite de compilación actual**. El guard que protege SmartFin permite únicamente comandos auditados. No se incluye un atajo ni una nueva secuencia que lo evada. Cuando haya una compilación autorizada de la variante, se verificará su `applicationId`, hash SHA-256, firmante y procedencia; únicamente entonces se autorizará instalarla **solo** en `emulator-5554`.

Comprobaciones de solo lectura que se pueden hacer antes de instalar:

```powershell
adb -s emulator-5554 shell getprop ro.build.version.sdk
adb -s emulator-5554 shell pm list packages com.smartfin
```

**Esperado:** paquete `com.smartfin.visualtests` coexistiendo con `com.smartfin.snapshot5b2.tests`; nunca reemplazar `com.smartfin` ni la APK de snapshots. Mantener el dispositivo físico fuera de cualquier comando de instalación o prueba.

## 3. Flujos Maestro, una vez validada la APK

| Archivo | Comportamiento | Escritura financiera |
| --- | --- | --- |
| `01-dashboard.yaml` | Espera la interfaz, comprueba saldo y captura | No |
| `02-navigation.yaml` | Abre Movimientos y Ajustes; captura | No |
| `03-form-readonly.yaml` | Prueba el campo de búsqueda de movimientos | No |
| `04-expense-draft.yaml` | Abre formulario Gasto, introduce borrador, vuelve atrás **sin guardar** | No |

Las pruebas pueden ejecutar `launchApp` sobre el **paquete sintético**, y deben estar dirigidas explícitamente a `emulator-5554`. La inserción inicial de datos sintéticos ocurre una vez al arrancar; la columna «Escritura financiera» se refiere a las acciones de Maestro, no a ese fixture de inicialización.

Ejemplo opcional de ejecución CLI **solo tras autorización del entorno**:

```powershell
maestro --device emulator-5554 test scripts/maestro-visual/flows/01-dashboard.yaml
```

Para Codex y Claude Code, usar Maestro MCP sobre el mismo emulador y exactamente esos cuatro flujos **en sesiones separadas**, sin crear ni cambiar `appId` o `deviceId`. No activar `clearState: true` ni usar gestos que pulsen `Guardar`. Una búsqueda que no encuentre resultados es un resultado válido; una navegación que abra la UI equivocada es un fallo verificable. Las etiquetas pueden haber cambiado: actualizar los flujos en la rama, nunca inventar un PASS.

## 4. Evidencia y comparación real

Cada agente debe ejecutar sus cuatro flujos y conservar: captura, jerarquía de UI, logs, resultado por flujo, SHA-256 de la **misma APK sintética** y observaciones accesibilidad. Para no contaminar comparaciones, cerrar la aplicación entre sesiones sin borrar datos, sin modificar la base y sin instalar otra APK. No habilitar acceso al dispositivo físico.

1. Copiar `evidence-template.json` dos veces a archivos `codex.json` y `claude.json`, en carpetas de evidencia separadas; cambiar `agent`, `apkSha256`, `flows[*].status`, `screenshots`, y `notes` según **resultados ejecutados**.
2. En `screenshots`, poner rutas relativas a cada archivo JSON; los ficheros deben existir realmente y no estar vacíos.
3. Ejecutar:

```powershell
node scripts/maestro-visual/compare.cjs evidence/codex.json evidence/claude.json evidence/comparison.md
```

El comparador falla con evidencia ausente, capturas inexistentes, un APK distinto o pruebas pendientes/fallidas. Solo compara resultados declarados y existencia de archivos; **no reemplaza revisión humana de capturas ni pruebas TalkBack**.

## 5. Matriz de aceptación

- **Seguridad:** no se ha tocado el APK ni los datos del dispositivo físico; el packageId y SQLite son independientes, los cambios están solo en el workspace de test. Comparar `git status` antes/después.
- **Instalación:** `pm path com.smartfin.visualtests` responde únicamente en emulador autorizado.
- **Dashboard:** el encabezado real SmartFin, `SALDO DISPONIBLE` y tarjetas sin errores de carga.
- **Navegación:** pestaña Movimientos y pantalla Ajustes accesibles sin solapamientos.
- **Formularios:** búsqueda y borrador de gasto funcionan, sin pulsar `Guardar`; comprobar snapshot SQLite si se requiere demostrar no-escritura del formulario.
- **Comparación:** cuatro flujos ejecutados por cada agente, capturas y SHA idéntico; describir diferencias reales en jerarquía, texto cortado, tiempo y capturas.
- **Accesibilidad adicional:** ejecutar TalkBack, tamaño de fuente ampliado y contrastes solo después de aprobar las pruebas iniciales.

No declarar estos puntos «aprobados» antes de disponer de evidencia en Android.
