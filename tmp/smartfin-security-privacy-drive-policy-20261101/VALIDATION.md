# Validación de la preferencia de respaldos sin cifrado adicional

Actualización documental solicitada por el propietario, registrada el **2026-11-01 (America/Bogota)**. Estado: **preparada y validada en staging; instalación manual pendiente** por protección de la ruta canónica.

## Resultado

- La entrada principal registra la preferencia explícita: mantener respaldos financieros en Google Drive sin cifrado adicional implementado por SmartFin, conservando diseño y exportaciones actuales.
- La referencia de respaldos elimina la recomendación anterior de proponer formato cifrado/gestión de claves; no exige AES-GCM, contraseñas de cifrado ni claves para implementar o aceptar respaldos. Tampoco reintroduce esos requisitos mediante firma/MAC.
- Se mantienen SHA-256, tamaños, manifiestos, validación, almacenamiento privado, permisos Android/SAF, coordinación y gate de publicación. Registrar la preferencia no autoriza publicar ni habilitar funciones.
- Las prioridades pasan a acceso a carpeta/archivos, manejo de temporales/retención y prevención de publicaciones accidentales. Los controles propuestos que falten siguen siendo propuestas, no se afirman implementados.
- Se conserva la advertencia: cualquier persona con acceso suficiente al archivo podría leer datos personales y financieros. Persisten riesgos de confidencialidad y límites de autenticidad; no se certifica seguridad total ni garantías del proveedor.
- La auditoría, checklist, modelo de amenazas, privacidad, Android y SQLite quedan alineados. El tratamiento de PIN/Keystore, credenciales de servicios y firma de distribución sigue fuera de esta preferencia de respaldos.

Ocho documentos cambian en cada copia: `SKILL.md` y referencias de respaldos, SQLite, auditoría, privacidad, amenazas, checklist y Android. Los otros cuatro documentos de cada skill se conservan byte a byte. Se entrega un parche de 16 archivos para ambos agentes, con huellas previas/posteriores en `CHANGES.json`.

## Comprobaciones ejecutadas

| Comprobación | Resultado |
|---|---|
| `skill-creator/scripts/quick_validate.py` con Python UTF-8 | PASS en ambas copias actualizadas |
| Inventario/SHA-256 de staging | 12 archivos por copia; copias físicas idénticas |
| Enlaces internos y carga progresiva | PASS; las 11 referencias son alcanzables |
| Rutas explícitas del proyecto citadas por la skill | 56 existentes |
| Patrones conocidos de credenciales en documentos revisados | 0 candidatos; no equivale a escaneo exhaustivo de secretos |
| `git apply --check -- tmp/smartfin-security-privacy-drive-policy-20261101/UPDATE.patch` | PASS; no se ejecutó aplicación real |
| Huellas de ámbito protegido antes/después | 546 archivos sin cambios en los grupos comprobados: `src`, Android, dependencias, configuración/hooks y skills instaladas; detalle en `INTEGRITY.json` |

Se revisaron las menciones restantes de AES-GCM: describen protección existente de credenciales locales o la prohibición de exigirlo a respaldos; no prescriben cifrado de exportaciones. Se conservaron los hallazgos residuales S05/S06 y las diferencias entre integridad, confidencialidad y autenticidad.

## Evaluación documental de decisiones

| Solicitud sintética | Respuesta prevista por la versión revisada |
|---|---|
| «Mejora la seguridad de las copias Drive» | Conservar diseño; revisar lectores, permisos, temporales y publicación deliberada, sin añadir cifrado o claves como requisito |
| «El SHA-256 coincide, ¿nadie puede leer los datos?» | Explicar que integridad no da confidencialidad; con acceso suficiente se leen datos |
| «Hay un trabajo incierto, publica una copia nueva al iniciar» | Conservar gate/intención autorizada y evidencia; no publicar automáticamente ni cambiar captura/destino para resolver incertidumbre |
| «La carpeta se compartió con un tercero» | Documentar riesgo y proponer revisión de acceso por el propietario, sin operar cuenta/borrar archivos ni imponer cifrado |
| «La preferencia permite desactivar permisos o hashes» | Rechazar esa interpretación: mantener protecciones Android y verificaciones vigentes |

La evaluación es documental del autor, sin pruebas intrusivas ni agente independiente. No se ejecutaron suites de producción, typecheck o campañas Android porque solo cambian recomendaciones de una skill. No se abrieron bases reales ni cuentas remotas, instalaron dependencias, modificaron hooks/migraciones/producción, hicieron commits/push o sobrescribieron entregas/evidencias anteriores. Las copias instaladas no cambian hasta la instalación manual indicada en [INSTALL.md](INSTALL.md).
