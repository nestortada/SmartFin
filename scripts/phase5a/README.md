# Diagnóstico de fase 5A

No implementa cambios financieros. Ejecutar desde la raíz de SmartFin con Node
24 y las dependencias ya instaladas:

```powershell
node scripts/phase5a/reproduce.js
node scripts/phase5a/quality.js
```

`reproduce.js` crea exclusivamente bases nuevas en un directorio temporal
`smartfin-phase5a-synthetic-*`. No recibe una ruta de base, no llama a ADB ni a
proveedores documentales. Importa esquema, migraciones, runners, borrado y helpers
vigentes. El bridge nativo se sustituye y su abridor está prohibido. Los efectos
Android se modelan explícitamente; no es una campaña Kotlin/AlarmManager/SAF.
El JSON identifica la huella del harness y de los módulos TS importados, sus
resultados y los límites de cada escenario. Los fixtures sintéticos permanecen
en el directorio temporal que indica el informe, para inspección.

`quality.js` ejecuta las suites existentes completas, tsc, ESLint y diff-check.
Guarda huellas de producción/tests/driver y conserva los bytes de documentos
históricos antes de ejecutar Jest; restaura los que los tests regeneran. No
restaura código. La carpeta `docs/atomicidad-fase5a/` recibe todos los resultados.

Las 72 posiciones del borrado son errores inyectados antes/después de las 36
escrituras descubiertas, no cortes de energía. R7 es un prototipo del orden
SQL→cleanup propuesto, no comportamiento actual. R8 sustituye notify por un Map.
R11 adapta el rótulo de error del driver para probar la cuarentena en Node.

Consultar el [informe](../../docs/atomicidad-financiera-fase5a.md) para inventario,
riesgos, alternativas, política de recuperación y plan Android pendiente. No
ejecutar las pruebas instrumentadas del paquete `com.smartfin` para reproducir
esta fase; requieren un paquete y un abridor sintético aislados.
