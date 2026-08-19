# Nodus Mobile: conector Nodus Cloud

El repositorio actual contiene Desktop y el servidor, pero no el código fuente de Nodus Mobile. La integración móvil se entrega como contrato y cliente compartido en `shared/cloudflare.ts` y `shared/cloudflareClient.ts`; debe importarse desde el repositorio de Mobile en vez de duplicar rutas o modelos.

Mobile no despliega infraestructura ni necesita credenciales de Cloudflare. Se conecta a la URL `workers.dev` del usuario exactamente como se conecta a cualquier servidor Nodus. El propietario puede iniciar la instalación desde Desktop y después añadir sus teléfonos mediante login o código de emparejamiento.

## Selector de servidor

El formulario de conexión de Mobile debe ofrecer `Nodus Server` y `Nodus Cloud`. Para Cloudflare:

1. Validar la URL con `NodusCloudClient.capabilities()`.
2. Permitir correo/contraseña mediante `signIn()` y seleccionar uno de los espacios devueltos; cambiar el ticket por credencial con `selectSpace()`.
3. Mantener también el código temporal con `pair()` para el flujo iniciado desde la administración web.
4. Guardar `deviceToken` únicamente en Keychain (iOS) o Android Keystore. `serverKind`, URL y `spaceId` no son secretos.
5. Marcar el remoto como `serverKind: "cloudflare"`; los registros antiguos sin valor se interpretan como `classic`.

## Sincronización

- Descargar `snapshot()` con ETag y aplicar el mismo importador lógico que ya usa Nodus Server.
- Enviar únicamente las tablas mutables permitidas en lotes de hasta 32 con `postMutations()`; conservar los lotes hasta recibirlos en `accepted` o `duplicate`.
- Ante `missing_assets`, cargar primero los objetos indicados y reintentar el mismo identificador de mutación.
- Usar `negotiateAssets()`, `uploadAsset()` y `asset()` del cliente compartido para deduplicar, cargar y descargar imágenes; no construir URLs ni cabeceras de autenticación a mano.
- Sincronizar las notas de Nodi con `getNodiNotes()` y `putNodiNotes()` usando `updatedAt` y lápidas.
- Un `401` obliga a volver a iniciar sesión; un `403` cambia el remoto a `revoked` sin borrar los datos locales.

## Pruebas exigidas en el repositorio Mobile

- Inicio de sesión, selección de espacio y revocación.
- Descarga inicial, respuesta 304 y reanudación después de perder la red.
- Conflictos, lápidas, reintento idempotente y archivo ausente.
- Vault grande con descarga en streaming y espacio insuficiente.
- Keychain/Keystore bloqueado y restauración del sistema.
- Compatibilidad simultánea con servidor clásico y Cloudflare.
