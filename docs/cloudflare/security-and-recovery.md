# Seguridad, recuperación y portabilidad

## Fronteras de confianza

- **Cuenta Cloudflare:** pertenece al usuario. Nodus no pide ni recibe tokens de API/OAuth, permisos, cookies ni acceso de facturación.
- **Despliegue:** Cloudflare abre la plantilla pública, crea los recursos y conecta bindings directamente. La URL de despliegue solo contiene la URL pública de la plantilla.
- **Runtime:** el Worker accede a D1, R2 y Vectorize opcional mediante bindings. R2 permanece privado; no se habilita `r2.dev` ni se crean credenciales S3.
- **Dispositivos:** cada dispositivo recibe un token aleatorio limitado a un espacio, rol y tipo de cliente. Desktop lo guarda cifrado con el almacén seguro del sistema operativo.
- **Navegador:** la administración usa cookie `HttpOnly; Secure; SameSite=Lax`, CSRF y contraseña PBKDF2-SHA256. Login, pairing y recovery tienen rate limiting.
- **MCP:** OAuth 2.0 propio de la instalación, con PKCE y audiencia exacta. Este OAuth da acceso a datos de Nodus, no a la cuenta Cloudflare.

## Bootstrap sin intermediario

Desktop genera 32 bytes aleatorios. Guarda el secreto original cifrado y muestra un **código de configuración** que es `SHA-256(secreto)`. El usuario pega únicamente ese hash en el asistente de Cloudflare como `NODUS_BOOTSTRAP_SECRET_HASH`.

Durante la primera conexión, Desktop envía el secreto original al Worker mediante HTTPS. El Worker calcula SHA-256 y compara el resultado en tiempo constante. Conocer el valor pegado en Cloudflare no permite reconstruir el secreto original ni inicializar el Worker. Tras crear la instalación, D1 marca el bootstrap como usado; cualquier repetición devuelve conflicto aunque el binding continúe presente.

El secreto temporal se elimina de Desktop después del éxito. Si Desktop se cierra entre el bootstrap remoto y el guardado local, puede iniciar sesión y derivar la misma clave de recuperación para terminar de conectar sin recrear datos.

## Amenazas mitigadas

- Carga corrupta: SHA-256 de objeto y parte, recuentos de manifest y comprobación de MIME para imágenes/ZIP.
- Path traversal y ejecución de contenido: claves R2 generadas por servidor, descarga como attachment, `nosniff` y CSP sandbox.
- Reintentos/replay: revisiones únicas, claves estables, mutaciones únicas y chunks vectoriales por hash.
- Escalada horizontal: cada consulta incluye `space_id` y vuelve a comprobar membresía y rol.
- Lotes parciales: referencias a archivos y estructura se validan antes de persistir mutaciones.
- Aprovisionamiento malicioso: Desktop acepta solo HTTPS y valida el documento de capacidades de Nodus antes de entregar el secreto.
- Confused deputy en MCP: audiencia de recurso obligatoria y redirect URIs exactas.

Riesgos que conserva el usuario: una cuenta Cloudflare o Git comprometida puede modificar su infraestructura; una clave de recuperación filtrada permite exportar datos; contenido que el usuario publique puede estar sujeto a derechos de terceros y a las condiciones de Cloudflare.

## Recuperación

El bootstrap devuelve una clave de recuperación de 256 bits. D1 almacena solo su hash junto al identificador de instalación. Con ambos valores se puede:

- listar los espacios mediante `/recovery/index.json`;
- descargar manifest verificable y páginas NDJSON;
- descargar el snapshot portable completo;
- recuperar assets, paquetes de biblioteca, matrices vectoriales y backups enumerados;
- comprobar SHA-256 y restaurar el contenido en Nodus.

La clave viaja como `Authorization: Recovery …`, nunca en una URL. Desktop la guarda cifrada; el usuario debe conservar otra copia fuera del equipo. La administración normal ofrece el mismo manifest a usuarios autorizados.

D1 Time Travel es una capa adicional para errores de base de datos, no sustituye snapshots/exports. Su ventana depende del plan vigente: [documentación oficial de Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

## Actualizaciones y rollback

La copia Git creada por Cloudflare pertenece al usuario. Workers Builds publica sus commits sin intervención de Nodus. Cada release mantiene migraciones hacia delante e idempotentes; una migración destructiva requiere export y procedimiento específico.

Cloudflare puede revertir una versión o despliegue del Worker desde su panel. Esto no revierte D1. La limpieza de Nodus adquiere o elimina referencias con sentencias condicionales antes de borrar bytes de R2, por lo que una publicación concurrente conserva el objeto o falla de forma reintentable.

Referencias: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [versiones y despliegues](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/), [exportar/importar D1](https://developers.cloudflare.com/d1/best-practices/import-export-data/).
