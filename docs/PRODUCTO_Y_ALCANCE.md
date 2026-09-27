# Producto y alcance

## 1. Propósito

SmartFin busca responder con rapidez tres preguntas: cuánto dinero está disponible, cuánto se debe y cómo se mueve el dinero. La aplicación prioriza control local, operación sin conexión y trazabilidad de los cálculos financieros.

La visión histórica propone automatización por SMS y notificaciones, presupuestos, préstamos, metas, inversiones, OCR, impuestos y simuladores. El producto implementado cubre hoy el núcleo manual y una parte avanzada de cuentas y tarjetas.

## 2. Principios de producto

- Los datos financieros permanecen en el dispositivo salvo una exportación iniciada por el usuario.
- El flujo principal debe funcionar sin conexión.
- Los pagos de tarjetas y las transferencias internas no se cuentan como gastos reales.
- Las reglas financieras deben ser deterministas y comprobables.
- La interfaz no debe acoplarse a SQLite ni a integraciones de plataforma.
- Las capacidades futuras se añaden detrás de contratos para conservar estable la experiencia.

## 3. Usuarios principales

| Perfil | Necesidad cubierta hoy | Necesidad futura |
|---|---|---|
| Persona con cuentas débito | Saldos, ingresos, pagos, transferencias y tendencias | Conciliación y automatización |
| Usuario de tarjeta de crédito | Cupo, uso, cuotas, extracto, pago y simulación mínima | Alertas programadas y proyección completa |
| Persona que registra gastos | Alta manual, edición, búsqueda, filtros y categorías | Captura automática y OCR |
| Usuario preocupado por privacidad | SQLite local, PIN/biometría Android y borrado financiero | Cifrado de base y respaldo |
| Persona con varias obligaciones | Dashboard básico de activos y deuda | Préstamos, presupuestos, metas y flujo futuro |

## 4. Capacidades implementadas

### Dashboard

- Saldo disponible de efectivo, cuentas bancarias y cuentas de ahorro activas.
- Deuda de tarjetas y préstamos activos.
- Patrimonio neto básico: activos líquidos e inversiones menos deuda.
- Ingresos, gastos y ahorro del mes.
- Conteo de movimientos publicados de los últimos 30 días.
- Acceso a movimientos, tarjetas débito, tarjetas de crédito y ajustes.

### Movimientos

- Registro manual de ingresos, gastos y transferencias internas.
- Operación débito o crédito.
- Compras a cuotas en tarjeta de crédito.
- Transferencias con movimiento acompañante y cobro opcional del 4x1000.
- Edición, eliminación, búsqueda y filtros.
- Categorización manual y creación de categorías durante el flujo.
- Asociación automática de movimientos de crédito a una tarjeta existente por pista; si no coincide, uso de una cuenta especial “Tarjeta por clasificar”.
- Actualización de saldos fuera de la pantalla, dentro del caso de uso.

### Cuentas débito

- Creación y edición de cuentas bancarias y de ahorro.
- Saldo actual, institución y metadatos de ingreso recurrente.
- Cierre lógico de la cuenta para conservar el historial.
- Resumen mensual, movimientos y tendencia de siete días.
- Inicio de una transferencia desde la pantalla de la cuenta.

### Tarjetas de crédito

- Creación y edición de tarjeta, banco, cupo, últimos cuatro dígitos, corte, pago, tasa efectiva anual y cuota de manejo.
- Cálculo de cupo usado, disponible y porcentaje de utilización.
- Extracto del ciclo actual y fecha de pago.
- Compras a cuotas y progreso de cuotas.
- Simulación de pago mínimo e interés adicional.
- Registro de pagos desde una cuenta débito o de ahorro.
- Reconciliación de deuda y extracto desde los movimientos.
- Asociación de movimientos pendientes al crear una tarjeta compatible.
- Cierre lógico solo cuando no hay deuda, cuotas activas ni movimientos sin liquidar.

### Categorías y ajustes

- Categorías de ingreso y gasto personalizables.
- Protección de la categoría de respaldo `Otros`.
- Reasignación de referencias al eliminar una categoría.
- Tema claro u oscuro.
- Borrado de datos financieros sin eliminar las preferencias.

### Seguridad y respaldo Android

- Bloqueo por PIN o biometría al abrir y al volver al primer plano.
- Credencial local cifrada con una clave AES-GCM del Android Keystore.
- Respaldo manual a una carpeta seleccionada mediante Storage Access Framework.
- Exportación de base SQLite, CSV y manifiesto de revisión.
- Detección de respaldo desactualizado.

## 5. Matriz de alcance

| Capacidad de la visión | Estado | Evidencia o límite |
|---|---|---|
| Cuentas, categorías y movimientos | Implementado | Módulos `accounts`, `categories`, `transactions` |
| Dashboard inicial | Implementado | Métricas mensuales, saldo, deuda y patrimonio básico |
| Transferencias internas | Implementado | Dos patas relacionadas y 4x1000 opcional |
| Merchant mapping | Parcial | Persistencia y uso básico; sin editor masivo ni motor completo de reglas |
| Tarjetas y compras a cuotas | Implementado | Gestión, reconciliación, extractos y pagos |
| Seguridad local | Parcial | PIN y biometría Android; SQLite y respaldos no cifrados |
| Respaldo | Parcial | Exportación Android manual; sin restauración ni cifrado |
| Presupuestos y sobres | Modelo preparado | Tablas existentes, sin caso de uso ni interfaz |
| Suscripciones | Modelo preparado | Tabla existente, sin programación ni interfaz |
| Préstamos y amortización | Modelo preparado | Tablas existentes, sin cálculos ni interfaz |
| Metas y patrimonio avanzado | Modelo preparado | Tabla de metas; dashboard con patrimonio básico |
| Inversiones | Modelo preparado | Tabla existente, sin interfaz |
| Reportes | Pendiente | No hay generación de Excel ni vistas de reportes |
| SMS y notificaciones | Pendiente | No hay listeners ni parser en la implementación actual |
| OCR y recibos | Modelo preparado | Tabla existente, sin captura ni OCR |
| Impuestos | Modelo preparado | Tablas de etiquetas; 4x1000 sí está implementado como gasto |
| Flujo de caja y score | Modelo preparado | Tablas existentes, sin motor ni interfaz |
| iOS | Parcial | Proyecto base disponible; seguridad y respaldo nativos son Android-only |

## 6. Criterios de comportamiento actuales

- Solo movimientos `posted` cuentan en el dashboard.
- Solo `expense` con salida cuenta como gasto mensual.
- Solo `income` con entrada cuenta como ingreso mensual.
- Transferencias internas y pagos de tarjeta quedan fuera del gasto mensual.
- Las cuentas cerradas o inactivas no participan en los totales principales.
- La moneda soportada por el dominio es únicamente COP.
- El borrado financiero vuelve a sembrar cuentas esenciales con saldo cero y categorías base.

## 7. Fuera de alcance sin aprobación explícita

- Sincronización remota automática.
- Analítica, telemetría o seguimiento publicitario.
- Conexiones a bancos o agregadores financieros.
- Envío de datos a servicios de IA externos.
- Backend de cuentas de usuario.
- Cualquier integración que rompa el modo local/offline por defecto.

## 8. Terminología

| Término | Significado en SmartFin |
|---|---|
| Movimiento publicado | Transacción confirmada con estado `posted` |
| Gasto real | Movimiento `expense` con dirección `outflow` |
| Cuenta débito | Cuenta `bankAccount` o `savingsAccount` mostrada como tarjeta débito |
| Deuda de tarjeta | Saldo reconciliado desde compras de crédito menos pagos |
| Respaldo al día | El manifiesto accesible tiene la misma revisión local; no confirma que Google ya terminó la subida |
| Cierre lógico | Cambio de estado a `closed` sin eliminar el historial |
