# Documentación de SmartFin

Este índice separa la documentación por audiencia y fuente de verdad. El código tiene prioridad cuando una descripción histórica contradice la implementación.

| Documento | Audiencia | Contenido |
|---|---|---|
| [README](../README.md) | Todas | Resumen, instalación, ejecución y enlaces |
| [Producto y alcance](PRODUCTO_Y_ALCANCE.md) | Producto, diseño y desarrollo | Visión, usuarios, capacidades y estado real |
| [Arquitectura](ARQUITECTURA.md) | Desarrollo y arquitectura | Capas, dependencias, arranque y decisiones técnicas |
| [Módulos y flujos](MODULOS_Y_FLUJOS.md) | Desarrollo y QA | Responsabilidades y recorridos funcionales |
| [Base de datos](BASE_DE_DATOS.md) | Desarrollo y datos | SQLite, tablas, relaciones, migraciones y respaldo |
| [Seguridad y privacidad](SEGURIDAD_Y_PRIVACIDAD.md) | Producto, seguridad y desarrollo | Modelo de protección, datos sensibles y límites |
| [Guía de desarrollo](GUIA_DESARROLLO.md) | Desarrollo | Entorno, convenciones y extensión del sistema |
| [Pruebas y calidad](PRUEBAS_Y_CALIDAD.md) | Desarrollo y QA | Comandos, cobertura funcional y estrategia |
| [Roadmap](ROADMAP.md) | Producto y desarrollo | Brechas y fases propuestas |
| [Contribución](../CONTRIBUTING.md) | Colaboradores | Flujo de cambios y lista de verificación |

## Fuentes de verdad

1. Tipos, casos de uso, repositorios y esquema dentro de `src/`.
2. Módulos nativos en `android/app/src/main/java/com/smartfin/`.
3. Pruebas en `__tests__/`, que expresan reglas observables.
4. Este conjunto de documentos.
5. `SmartFin_Objetivos_y_Funcionalidades.pdf`, como visión histórica y no como descripción del estado actual.

## Cómo mantener la documentación

- Actualiza `PRODUCTO_Y_ALCANCE.md` y `ROADMAP.md` cuando una capacidad cambie de estado.
- Actualiza `ARQUITECTURA.md` si cambian límites, dependencias o secuencias de arranque.
- Actualiza `BASE_DE_DATOS.md` junto con toda modificación de esquema o migración.
- Actualiza `SEGURIDAD_Y_PRIVACIDAD.md` antes de introducir red, nube, analítica o nuevos datos sensibles.
- Añade o modifica pruebas y registra el alcance en `PRUEBAS_Y_CALIDAD.md` cuando aparezcan nuevas reglas financieras.

Fecha de revisión integral: **27 de septiembre de 2026**.
