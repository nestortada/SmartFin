# Secretos, autenticación e incidentes

## Controles y fronteras actuales

`src/modules/security/useCases/manageSecurity.ts` valida mínimo cuatro caracteres al establecer PIN/contraseña. `SmartFinSecurityModule.kt` calcula SHA-256 con sal aleatoria de 16 bytes, cifra sal+derivado mediante AES-GCM y conserva el ciphertext en preferencias privadas `smartfin_security`; la clave usa Android Keystore. La comparación es `MessageDigest.isEqual`. No se encontró KDF de contraseñas con coste ni límite durable de intentos en estas rutas. No confundas el hash rápido con una KDF, ni el almacenamiento cifrado del derivado con cifrado de la base.

`AppAccessGate.tsx` ofrece biometría/PIN, y `src/navigation/AppNavigator.tsx` configura gate al inicio y al volver a `active` según preferencias. Son controles de acceso UI opcionales, no autorización por rol/cuenta ni autenticación de cada repositorio. `securityService.ts` maneja ausencia de métodos, pero su tipado del bridge no valida en runtime que una respuesta nativa sea estrictamente booleana. No extrapoles la validación `unknown` de otros servicios a este servicio.

`src/services/geminiCommandService.ts` obtiene `GEMINI_API_KEY` de `react-native-config` y la usa en cabecera `x-goog-api-key`. `android/app/build.gradle` carga dotenv: una clave incluida al compilar debe tratarse como recuperable del cliente, aunque `.env` esté ignorado. La revisión no necesita leer su valor ni probar si funciona. No se encontró OAuth de Drive: SAF guarda URI/permisos, que no son tokens OAuth. Tokens de coordinación SQLite tampoco son credenciales remotas.

## Inspección sin exponer valores

1. Clasifica candidatos: clave privada/firma, token de usuario, clave API con cuota/restricciones, certificado/clave pública distribuible, identificador o token interno. No marques un certificado público o un placeholder de prueba como secreto privado.
2. Empieza por nombres de variables, referencias y metadatos de archivos. Revisa `.gitignore`, manifiestos de build, CI y archivos rastreados; no ejecutes `Get-Content .env`, listados completos del entorno, `git show` o `git log -p` que puedan revelar credenciales.
3. Si se autoriza un escaneo de contenidos/historial, utiliza un detector local ya disponible con salida redactada a archivo nuevo; informa solo tipo, ubicación y revisión. Un `rg` sin redacción puede imprimir coincidencias completas. No instales un escáner ni envíes el repositorio a terceros implícitamente.
4. Sigue el secreto hasta bundle/APK, almacenamiento, IPC, cabeceras, excepciones y logs. No registres valores, hashes de PIN, request bodies, cabeceras ni prefijos/sufijos reales en evidencia. Capturas y mensajes de error también son sumideros.
5. Para Keystore revisa alias/propósitos, modo autenticado, IV único generado por el cifrador, gestión de errores, persistencia, autenticación requerida, soporte hardware comprobado y recuperación tras reinstalación/cambio de bloqueo. No supongas StrongBox por usar Keystore.
6. Comprueba consistencia entre flag SQLite y preferencias nativas cuando falla guardar/borrar la credencial; evalúa lockout y recuperación sin abrir el gate por error. La credencial no debe convertirse en texto plano para facilitar recuperación.
7. Firma: distingue `debug.keystore` público de desarrollo de clave privada de distribución. La referencia release→debug confirmada necesita una propuesta de gestión de firma, sin sustituir claves automáticamente ni imprimir sus contraseñas.

## Respuesta a exposición

Registra solo contexto mínimo: tipo, ubicación, periodo y rutas afectadas. No reproduzcas el valor filtrado. Delimita credencial pública/privada, privilegios y destinatarios; propone revocar/rotar en el proveedor y revisar abuso/cuota con el titular autorizado. Una clave compilada puede requerir nueva distribución y reducción de alcance; moverla a `.env` no corrige la extracción.

Rotar/revocar tiene efectos externos: prepara el procedimiento y ejecútalo únicamente con autorización específica. Conserva evidencia redactada. No reescribas Git ni borres evidencia automáticamente: la eliminación del historial no revoca una credencial. Backend/proxy o rediseño de identidad requiere aprobación explícita según las reglas local-first; ofrece alternativas y sus límites sin añadirlo al producto.

## Aceptación

Dobles locales deben cubrir credencial inválida, error biométrico, cancelación, módulo ausente y fallo de persistencia sin éxito falso. Las futuras regresiones de intentos/KDF deben medir bloqueo y compatibilidad de credenciales instaladas, no solo buscar nombres de algoritmos. `__tests__/manageSecurity.test.ts` prueba coordinación con mocks; no prueba AES-GCM/Keystore, resistencia a adivinación ni dispositivo.
