# Matriz previa de aceptación integrada 5E

Las pruebas históricas son antecedentes; las campañas 5E se registran por separado.
La historia financiera común usa casos de uso actuales, dinero exacto, reloj fijo,
auditoría de apertura sintética y todas las tablas/columnas descubiertas.

| Dependencia / participantes | Fallo o intercalación | Garantía previa | Aceptación 5E / evidencia requerida |
|---|---|---|---|
| Movimientos → cuentas → acompañantes → impuesto | Antes/después de cada escritura | Fase 2: commit compartido | Matriz nueva sobre historia con tarjetas, compartidos, IA y suscripciones |
| Tarjetas → cuotas/extractos → dashboard | Pago concurrente con consulta | 3A/3B: reconciliación completa y exclusión | Lectura retenida por barrera, gasto/patrimonio invariantes, rechazo $0,40 |
| IA → revisión → comprobante → movimientos | Escritura manual en cola, fallo de recibo | Fase 4: recibo atómico e intención inmutable | Rechazo de revisión obsoleta y rollback total de plan sobre fixture común |
| Suscripciones → ocurrencias → gasto vinculado → recordatorios | Registro y mantenimiento concurrentes | Fase 4: commit local, efectos OS posteriores | Pagada/pendiente, vínculo repetido, sin segundo gasto; lotes serializados |
| Cola JS → dueño Kotlin → SQLite | Receptor concurrente, cierre/captura | 5B.1/5D: permiso explícito y drenaje | API 24 y HONOR API 35 con fuentes atestadas; no extrapolar Node a Android |
| Snapshot → recibo IA → CSV → SAF → manifiesto | Escritura viva después de captura, publicación parcial | 5B.2/5B.3: generación inmutable y relectura | Publicación sobre fixture común, CSV tarjetas celda a celda, reanudar original |
| Publicador → admisión de borrado | SAF activo / revocación de época | 5C: lease y corte durable | Rechazo sin SQL; jobs antiguos no publican, bytes históricos intactos |
| Borrado → 36 DELETE → intención/recibo | 38 escrituras × antes/después; COMMIT perdido | 5C: confirmed/rolledBack/unknown | Matriz nueva sobre fixture combinado; no repetir DELETE ante unknown |
| Limpieza → AlarmManager/WorkManager → nueva época | Fallo OS, reinicio, ID reutilizado | 5C: limpieza exacta recuperable | Commit confirmado con limpieza pendiente; suscripción real nueva protegida |
| Notificación → acuse SQL → recuperación | notify sin acuse, reboot, primer plano | 5D: posible repetición con misma identidad | Regresiones nativas actuales; separar recuperación automática/manual |
| Generación v2 → analista semanal | Hash, selección, Bogotá, siete días, borrado | Contrato documentado, analista sin integrar | Fixtures locales de lector; integración externa pendiente |
| Todos → escalabilidad | 1k/10k/100k | Presupuestos manuales provisionales | Etapas separadas, sin afirmar percentiles ni universalidad |

API 35/HONOR: el propietario conectó posteriormente el dispositivo y autorizó
expresamente su reinicio físico. Los resultados 5E actuales se conservan separados
en `summary-api35.json`; las campañas históricas 5D no los sustituyen. La
recuperación automática requiere evidencia anterior a la invocación del harness.

Alcance protegido: sin cambios de producción, driver, esquema, dependencias, reglas
contables o política de entrega incierta; publicación de UI sigue desactivada.

## Resultados actuales

| Interacción | Resultado / evidencia 5E |
|---|---|
| Manual ↔ mantenimiento; pago ↔ dashboard; IA ↔ manual | Barreras deterministas Node, snapshots exactos y rechazo de revisión antigua; `node/integration.json` |
| Receptor Kotlin ↔ pago real JavaScript | Campaña `contender-payment`: espera bajo dueño nativo, débito/deuda −$1 y ningún segundo gasto |
| Snapshot ↔ escritura financiera | `integrated-final2`: snapshot anterior a escritor en espera, recibo IA y CSV coherentes |
| SAF activo ↔ borrado | Rechazo antes de permiso financiero y sin cambios de tablas |
| Borrado ↔ Headless viejo ↔ suscripción nueva | `restart-final2`: limpieza sin segundo DELETE, rechazo de época vieja, alarma nueva intacta |
| Fallos BEGIN/COMMIT/ROLLBACK | Seis unknown en fixture de disco, sin repetir cuerpo; regresiones Android conservadas |
| Publicación incierta ↔ recuperación | Reanudación original sin recaptura; generación parcial excluida y anterior conservada |
| Historial ↔ SQLite API 24 | **Falla 5E-001**, reproducido en repositorio y Kotlin; propuesta mínima sin aplicar |
| Reboot ↔ recuperación | Reboot real API 24 y HONOR; reparación automática no acreditada. HONOR: crash inicial 5E-002, recuperación explícita posterior 89,75 ms |
| Receptor de recuperación ↔ mutex de limpieza | **Falla 5E-002** física y reproducción determinista con mutex/receptor reales; no se aplica parche |
| Espera de captura ↔ operación concurrente 100k | HONOR: 5,82/6,26 s en dos muestras, un exceso del presupuesto provisional de 6 s |
| v2 ↔ analista | Fixtures binarios/tiempo/época probados; implementación externa pendiente |

Inventarios por plataforma y total en `summary-integrated.json`. Veredictos,
métricas y límites completos en
`../atomicidad-financiera-fase5e.md`. Completar el harness de medición no convierte
el fallo explícito del historial en una página entregada.

API 24: 31 campañas/249 controles; API 35: 33/257, incluidas repetición de rendimiento
y reproducción de defecto. Total 64/506 controles del harness; estos conteos no
equivalen a aprobación funcional. El crash físico sin informe se conserva aparte
y el diagnóstico esperado no convierte 5E-002 en una garantía aprobada.
