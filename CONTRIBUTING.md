# Contribuir a SmartFin

## Antes de cambiar código

1. Lee [la arquitectura](docs/ARQUITECTURA.md) y el módulo afectado en [Módulos y flujos](docs/MODULOS_Y_FLUJOS.md).
2. Revisa `AGENTS.md` para las reglas vigentes del repositorio.
3. Comprueba cambios locales existentes y no reviertas trabajo ajeno.
4. Determina si el cambio modifica datos sensibles, esquema o reglas financieras.

## Principios obligatorios

- Mantén el producto local-first, offline-first y privacy-first.
- No añadas red, telemetría, analítica, sincronización ni terceros financieros sin aprobación explícita.
- Mantén el código de producto bajo `src/` y organizado por módulo.
- No pongas reglas financieras ni SQL en pantallas o componentes.
- Evita `any`; valida límites `unknown`.
- No añadas alias de importación sin configurar también Metro/Babel.
- Conserva compatibilidad con bases instaladas.

## Flujo recomendado

1. Escribe o actualiza tipos de dominio.
2. Implementa el caso de uso y sus validaciones.
3. Añade o adapta el repositorio/servicio.
4. Escribe pruebas de la regla y de regresión.
5. Integra hook y UI.
6. Actualiza los documentos afectados.
7. Ejecuta la verificación completa.

## Verificación antes de entregar

```sh
npm test -- --runInBand
npx tsc --noEmit
npm run lint
```

Además, realiza prueba manual cuando cambies:

- componentes o navegación;
- código Kotlin/Swift;
- permisos y selectores del sistema;
- esquema, migraciones o seed;
- seguridad, respaldo o borrado;
- cálculos de saldo, deuda, cuota o periodo.

## Lista de verificación del cambio

- [ ] El comportamiento solicitado está cubierto.
- [ ] Las reglas permanecen fuera de la UI.
- [ ] No se introdujo acceso directo a SQLite desde pantallas.
- [ ] Los tipos son estrictos y no se añadió `any`.
- [ ] Las operaciones multitabla consideran atomicidad y reversión.
- [ ] Se preservan datos y cambios ajenos.
- [ ] Hay pruebas para reglas y regresiones.
- [ ] Test, TypeScript y lint pasan.
- [ ] Se actualizaron producto, arquitectura, base, seguridad o roadmap cuando aplica.
- [ ] No se añadieron secretos, datos financieros reales ni archivos generados innecesarios.

## Cambios de base de datos

Todo cambio debe incluir:

- DDL idempotente;
- camino para una base existente;
- prueba de lectura/escritura y migración;
- actualización de borrado financiero;
- decisión sobre triggers de revisión y respaldo;
- actualización de `docs/BASE_DE_DATOS.md`.

Nunca elimines una tabla o columna con datos sin explicar y probar la migración.

## Cambios de seguridad o privacidad

Describe el dato afectado, su origen, almacenamiento, retención y salida del dispositivo. Si aparece una conexión externa, documenta el consentimiento, proveedor, fallos y mecanismo de revocación antes de integrar la UI.

No uses datos reales en fixtures, capturas, logs, commits o reportes de errores.

## Commits y revisiones

Mantén cada cambio pequeño y coherente. En la descripción incluye:

- problema y resultado;
- reglas financieras afectadas;
- migraciones o cambios nativos;
- pruebas ejecutadas;
- implicaciones de privacidad;
- documentación modificada.
