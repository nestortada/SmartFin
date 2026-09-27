# Roadmap

## 1. Punto de partida

La visión original se planteó para Android nativo con Kotlin/Compose y Room. La implementación evolucionó a React Native/TypeScript con SQLite y módulos Kotlin puntuales. El roadmap debe continuar desde esta base real; no se recomienda reescribir el producto solo para coincidir con el documento histórico.

## 2. Estado resumido

```mermaid
flowchart LR
    A[Núcleo local] --> B[Cuentas y categorías]
    B --> C[Movimientos y transferencias]
    C --> D[Tarjetas débito/crédito]
    D --> E[Seguridad y respaldo parcial]
    E --> F[Presupuestos y obligaciones]
    F --> G[Automatización]
    G --> H[Reportes e inteligencia]

    classDef done fill:#b7f7cf,stroke:#18794e,color:#102a1d;
    classDef partial fill:#ffe9a8,stroke:#8a6500,color:#2e2500;
    classDef todo fill:#e6e8ef,stroke:#667085,color:#20242c;
    class A,B,C,D done;
    class E partial;
    class F,G,H todo;
```

## 3. Fase 0: endurecer el núcleo

Objetivo: preparar la aplicación para datos reales antes de ampliar funciones.

- Versionar migraciones de base de datos.
- Definir estrategia de dinero sin errores de punto flotante.
- Separar claramente seed demo y onboarding de producción.
- Añadir transacciones SQLite atómicas en escrituras multitabla.
- Añadir CI y pruebas de migración/integración.
- Corregir y normalizar textos/encoding heredados.
- Evaluar navegación formal cuando crezcan rutas y deep links.

Criterio de salida: una actualización de versión conserva datos, los flujos financieros críticos son atómicos y la validación se ejecuta automáticamente.

## 4. Fase 1: privacidad y recuperación

Objetivo: cerrar las brechas más sensibles del producto local-first.

- Cifrado de SQLite con migración de instalaciones existentes.
- Respaldo cifrado y formato versionado.
- Restauración manual con validación, vista previa y rollback.
- Política de intentos de PIN y bloqueo temporal.
- Documentación de amenaza y canal privado de vulnerabilidades.
- Revisión de paridad o decisión explícita de soporte iOS.

Criterio de salida: pérdida o cambio de dispositivo tiene un camino de recuperación probado sin exponer copias en texto claro.

## 5. Fase 2: presupuestos y obligaciones

Objetivo: convertir el registro en control preventivo.

- Presupuesto global, por categoría y por cuenta.
- Umbrales y alertas locales.
- Sobres y movimientos entre sobres.
- Suscripciones y recurrencias con tareas locales.
- Préstamos y tabla de amortización.
- Integración de obligaciones con dashboard y calendario.

Criterio de salida: el usuario puede saber cuánto puede gastar y qué pagos se aproximan sin conexión.

## 6. Fase 3: patrimonio, metas y flujo futuro

Objetivo: responder “hacia dónde va mi dinero”.

- Metas financieras y aporte mensual requerido.
- Fondo de emergencia.
- Historial de balance y patrimonio neto temporal.
- Inversiones registradas manualmente.
- Flujo de caja futuro por cuenta.
- Score financiero explicable, sin decisiones opacas.

Criterio de salida: el dashboard muestra estado actual y proyección con reglas auditables.

## 7. Fase 4: automatización local

Objetivo: reducir el registro manual preservando privacidad.

- Diseño de permisos y consentimiento para SMS/notificaciones.
- Parser extensible por institución.
- Bandeja local de movimientos pendientes.
- Deduplicación y auditoría del texto de origen.
- Merchant mappings y reglas editables.
- Matching de transferencias y reversos.
- Trabajo en segundo plano compatible con restricciones modernas de Android.

Criterio de salida: la mayoría de movimientos compatibles se proponen automáticamente y siempre requieren un mecanismo claro de corrección.

## 8. Fase 5: reportes y captura documental

Objetivo: hacer los datos portables y auditables.

- Reportes mensuales, trimestrales y anuales.
- Exportación XLSX con ledger y dashboard.
- Filtros por cuenta, categoría, comercio y tipo.
- Adjuntos locales de recibos.
- OCR opcional en dispositivo.
- Etiquetas y resumen fiscal sin presentarlo como asesoría tributaria.

Criterio de salida: una exportación reproduce totales del dashboard y puede auditarse hasta cada movimiento.

## 9. Priorización sugerida

| Orden | Iniciativa | Valor | Riesgo/dependencia |
|---|---|---|---|
| 1 | Migraciones + atomicidad | Protege datos existentes | Requiere pruebas SQLite reales |
| 2 | Dinero entero/decimal | Evita errores financieros | Migración transversal |
| 3 | Backup cifrado + restauración | Recuperación y privacidad | Diseño de claves y formato |
| 4 | Presupuestos | Valor diario inmediato | Reglas de periodos y recálculo |
| 5 | Suscripciones/préstamos | Visibilidad de obligaciones | Tareas programadas y fechas |
| 6 | Metas y flujo futuro | Decisiones a mediano plazo | Depende de recurrencias fiables |
| 7 | Ingesta automática | Propuesta de cero fricción | Permisos, parsers y políticas Android |
| 8 | Reportes/OCR | Portabilidad y fiscalidad | Bibliotecas, rendimiento y privacidad |

## 10. Capacidades que no deben adelantarse

- No añadir IA remota antes de definir consentimiento y minimización de datos.
- No añadir sincronización antes de versionar esquema y resolver conflictos.
- No prometer borrado seguro mientras existan copias y SQLite sin cifrar.
- No construir un score financiero sin explicar fórmula, datos y limitaciones.
- No capturar SMS/notificaciones sin onboarding de permisos y una bandeja de revisión.

## 11. Cómo actualizar estados

Una capacidad pasa a “implementada” solo cuando incluye:

1. tipos de dominio;
2. caso de uso con reglas fuera de la UI;
3. persistencia o servicio detrás de un contrato;
4. pruebas automatizadas relevantes;
5. recorrido visible o API pública utilizable;
6. documentación y notas de privacidad actualizadas.
