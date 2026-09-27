# Seguridad y privacidad

## 1. Modelo de datos sensibles

SmartFin procesa información financiera: saldos, deudas, movimientos, comercios, categorías, notas y hábitos de pago. Toda esa información se considera sensible, incluso cuando no contiene un nombre o número de identificación.

Superficies de almacenamiento actuales:

| Superficie | Datos | Protección actual |
|---|---|---|
| `smartfin.db` | Información financiera y preferencias | Sandbox de la aplicación; base no cifrada |
| Preferencias privadas Android | Credencial cifrada y URI de respaldo | Sandbox; credencial cifrada con clave del Keystore |
| Android Keystore | Clave AES local | Administrada por el sistema |
| Carpeta de respaldo | Copia SQLite, CSV y manifiesto | Acceso del proveedor; archivos no cifrados |
| Memoria de la app | Estado visible y formularios | Protegida solo por el ciclo de vida del proceso |

## 2. Garantías actuales

- No hay llamadas de red en el código TypeScript ni en los módulos nativos del proyecto.
- No hay telemetría, analítica ni publicidad.
- No se usa una API financiera ni un agregador bancario.
- La persistencia principal es local y funciona sin conexión.
- El usuario inicia y elige el destino de cada configuración de respaldo.
- La credencial local no se guarda en texto plano.
- Las respuestas de módulos nativos se validan antes de convertirse a tipos de dominio.
- El borrado financiero conserva ajustes, pero elimina las tablas financieras conocidas.

## 3. PIN y credencial local

En Android, el módulo nativo:

1. exige un secreto de al menos cuatro caracteres desde el caso de uso;
2. genera una sal aleatoria;
3. cifra la representación almacenada con AES/GCM/NoPadding;
4. guarda la clave AES en `AndroidKeyStore`;
5. verifica sin devolver el secreto a la interfaz.

El PIN protege el acceso desde la propia aplicación. No cifra la base SQLite ni evita que un dispositivo rooteado, un backup del sistema o una vulnerabilidad de plataforma accedan a archivos de la app.

## 4. Biometría

- Disponible solo en Android en la implementación actual.
- Requiere un dispositivo con bloqueo seguro y biometría compatible.
- Usa `android.hardware.biometrics.BiometricPrompt` para huella o rostro disponible; el bloqueo seguro del dispositivo es un prerrequisito, pero no se ofrece como método alternativo dentro del prompt actual.
- Un error nativo se trata como autenticación fallida.
- La biometría no cifra por sí misma la base de datos.

## 5. Bloqueo de aplicación

Si PIN o biometría están habilitados, la app se muestra bloqueada al arrancar. También se vuelve a bloquear cuando retorna a primer plano. No existe todavía un temporizador configurable de inactividad: el texto de interfaz sobre bloqueo automático corresponde al comportamiento de reentrada, no a un periodo seleccionable.

## 6. Respaldo Android

El respaldo usa Storage Access Framework:

- el usuario selecciona una carpeta;
- Android entrega un URI y, cuando es posible, un permiso persistente;
- SmartFin crea o reemplaza archivos mediante `DocumentsContract`;
- no se reciben credenciales de Google;
- no se llama a la API de Google Drive.

Archivos exportados:

- `smartfin-backup.db`;
- `movimientos-AAAA.csv` por año;
- `cuentas.csv`;
- `categorias.csv`;
- `subcategorias.csv`;
- `tarjetas-credito.csv`;
- `compras-cuotas.csv`;
- `smartfin-manifest.json`.

### Advertencia crítica

Los archivos se exportan **sin cifrar**. Cualquier persona, aplicación o servicio con acceso a la carpeta puede leerlos. El campo `encrypted: false` del manifiesto lo declara de forma explícita.

“Respaldo al día” significa que SmartFin escribió los archivos y pudo leer una revisión equivalente desde el proveedor. No demuestra que Google Drive haya terminado la transferencia a sus servidores. El usuario debe comprobar la carga desde Drive.

## 7. Borrado de datos

La zona de peligro elimina filas de todas las tablas financieras conocidas con claves foráneas desactivadas temporalmente. Después se reactivan y se vuelven a crear cuentas base con saldo cero y categorías.

Límites:

- no es un borrado criptográfico del archivo SQLite;
- páginas libres, WAL, respaldos externos o copias del sistema podrían conservar datos;
- los archivos ya exportados no se eliminan de la carpeta elegida;
- el PIN, el tema y otras preferencias permanecen.

No debe etiquetarse como “borrado seguro” hasta implementar y verificar garantías adicionales.

## 8. Riesgos conocidos y mitigaciones recomendadas

| Prioridad | Riesgo | Mitigación recomendada |
|---|---|---|
| Alta | Base SQLite sin cifrar | Evaluar SQLCipher y una migración segura de bases existentes |
| Alta | Backups SQLite/CSV sin cifrar | Contenedor cifrado con clave controlada por el usuario y flujo de recuperación |
| Alta | No hay restauración validada | Diseñar importación con versión, copia previa, validación y rollback |
| Media | Dinero en `REAL`/`number` | Migrar importes a unidades menores enteras o decimal explícito |
| Media | Borrado no criptográfico | Documentar retención y añadir estrategia de compactación/clave destruible |
| Media | Metadatos en `description` | Crear columnas o tabla versionada para reducir parsing implícito |
| Media | Semillas demo | Separar con claridad demo, desarrollo y primera ejecución de producción |
| Baja | PIN mínimo de cuatro caracteres | Ofrecer política configurable y retraso ante intentos fallidos |

## 9. Reglas para cambios futuros

Antes de añadir red, nube, analítica, sincronización o IA externa se debe documentar:

- datos exactos que salen del dispositivo;
- finalidad y base de consentimiento;
- proveedor y jurisdicción;
- cifrado en tránsito y reposo;
- retención y eliminación;
- funcionamiento offline y comportamiento ante fallos;
- forma de desactivar o revocar;
- pruebas y actualización de esta documentación.

Toda capacidad debe ser opt-in si transmite datos financieros y debe quedar detrás de una interfaz de servicio.

## 10. Reporte de vulnerabilidades

El repositorio no define todavía un canal público de seguridad. Hasta establecerlo, una vulnerabilidad no debe publicarse con datos reales ni incluir bases de usuario en un issue. El propietario del proyecto debe definir un contacto privado antes de una distribución pública.
