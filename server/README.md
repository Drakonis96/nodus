# Nodus Server

> **Experimental e inestable.** Esta versión solo está destinada a pruebas.
> Conserva copias de seguridad, no la utilices todavía como único acceso a
> materiales importantes y espera cambios incompatibles antes de la versión estable.

Nodus Server permite compartir una proyección de un vault con estudiantes o investigadores. Es independiente de Nodus Desktop: el servidor vive en Docker y la aplicación de escritorio solo realiza conexiones HTTPS salientes. No se publica el puerto del MCP local ni se copia la base SQLite original.

## Qué necesitas

- Un ordenador que permanezca encendido o un VPS con Windows, macOS o Linux.
- Docker Desktop (Windows/macOS) o Docker Engine con el complemento Compose (Linux).
- Un dominio o subdominio apuntando a la IP pública del servidor, por ejemplo `nodus.universidad.es`.
- Los puertos 80 y 443 accesibles si vas a usar el Caddy incluido.

La instalación recomendada define la cuenta administradora como variables del Stack y abre directamente la página de login. Como alternativa, puede utilizarse un token temporal y el asistente `/setup`. La gestión diaria de espacios, usuarios, permisos y dispositivos se hace por web.

## Prueba desde Portainer

El workflow `Nodus Server image (experimental)` prueba y publica desde `main`
una imagen multi-arquitectura en GitHub Container Registry. Crea un Stack con
`portainer-stack.yml` mediante el editor web. Portainer descargará siempre:

- `ghcr.io/drakonis96/nodus-server:main`

La etiqueta `main` es móvil e inestable. Cada compilación también se publica con
una etiqueta `main-<sha>` para poder fijar o restaurar una prueba concreta. Define
estas variables en el Stack:

- `NODUS_DOMAIN`: dominio sin `https://`, por ejemplo `nodus.ejemplo.es`.
- `NODUS_ADMIN_EMAIL`: correo de la cuenta administradora.
- `NODUS_ADMIN_PASSWORD`: contraseña única y larga, de al menos 12 caracteres.

Estas dos variables deben definirse juntas. En el primer arranque crean la cuenta; en despliegues posteriores actualizan el correo o rotan la contraseña si cambias sus valores. La contraseña nunca se escribe en `state.json`: solo se conserva su hash. Mientras mantengas estas variables, sus valores son la fuente autoritativa y volverán a aplicarse en cada reinicio.

Como alternativa, deja ambas vacías y define `NODUS_SETUP_TOKEN` con un valor aleatorio temporal de al menos 16 caracteres. En ese caso completarás `/setup` manualmente y deberás borrar el token después.

El workflow termina cerrando la sesión de GHCR y leyendo el manifiesto como usuario
anónimo. Así falla si el paquete no es público o si falta `amd64` o `arm64`; una
ejecución verde significa que Portainer puede descargar la etiqueta sin credenciales.

Este Stack incluye Caddy y requiere que 80/443 estén libres. Si ya existe un
reverse proxy, despliega únicamente `nodus-server`, conéctalo a la red Docker del
proxy y configura como destino HTTP `nodus-server:7443`.

## Opción A: no tienes Caddy, Nginx ni otro proxy

1. Descarga esta carpeta `server` y abre una terminal dentro de ella.
2. Copia `.env.example` como `.env`.
3. Edita `.env`: cambia `NODUS_DOMAIN` y `NODUS_PUBLIC_URL`, introduce `NODUS_ADMIN_EMAIL` y genera una contraseña única para `NODUS_ADMIN_PASSWORD` (por ejemplo, con `openssl rand -base64 32`). Protege el archivo `.env` y no lo subas a Git.
4. Ejecuta:

```sh
docker compose --profile proxy pull
docker compose --profile proxy up -d
```

5. Abre `https://tu-dominio`: Nodus te enviará directamente al login y podrás entrar con esas credenciales.
6. Para rotarlas, cambia las dos variables y vuelve a desplegar el contenedor. Se cerrarán las sesiones y conexiones OAuth anteriores si cambia la contraseña.

Caddy obtiene y renueva automáticamente el certificado HTTPS. Los datos quedan en el volumen Docker `nodus_data`; recrear o actualizar el contenedor no los borra.

## Opción B: ya tienes Caddy o Nginx en el servidor

Ejecuta solo Nodus Server:

```sh
docker compose pull
docker compose up -d
```

Docker publica Nodus exclusivamente en `127.0.0.1:7443`. Así no ocupa 80/443, no queda accesible directamente desde Internet y no interfiere con tu proxy actual. Configura el dominio en ese proxy y reenvíalo a `http://127.0.0.1:7443`.

### Caddy ya instalado en el sistema

```caddy
nodus.ejemplo.es {
  encode zstd gzip
  reverse_proxy 127.0.0.1:7443
}
```

Recarga Caddy después de guardar la configuración.

### Nginx ya instalado en el sistema

```nginx
server {
    listen 443 ssl http2;
    server_name nodus.ejemplo.es;

    # Conserva aquí las rutas de certificado que ya gestione tu instalación.
    ssl_certificate /etc/letsencrypt/live/nodus.ejemplo.es/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nodus.ejemplo.es/privkey.pem;

    client_max_body_size 100m;
    location / {
        proxy_pass http://127.0.0.1:7443;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Authorization $http_authorization;
    }
}
```

Si tu Caddy/Nginx también está dentro de Docker, conecta ambos proyectos a una misma red Docker externa y usa `nodus-server:7443` como destino. No cambies el puerto 7443 a `0.0.0.0`: el único servicio público debe ser el proxy HTTPS.

## Dominio y URL pública

`NODUS_PUBLIC_URL` debe ser exactamente el origen que usarán las personas, sin ruta final: `https://nodus.ejemplo.es`. La URL que se añade en ChatGPT y Claude será `https://nodus.ejemplo.es/mcp`.

Si cambias el dominio, actualiza `NODUS_DOMAIN`, `NODUS_PUBLIC_URL`, el DNS y el proxy; después ejecuta de nuevo `docker compose up -d`. No uses una IP pública con HTTP. Nodus Desktop rechaza HTTP salvo para pruebas en `localhost`.

## Credenciales por entorno y Docker secrets

La opción sencilla para Portainer y Compose es `NODUS_ADMIN_EMAIL` + `NODUS_ADMIN_PASSWORD`. Quien tenga permisos para inspeccionar o editar el contenedor podrá ver sus variables, por lo que el acceso a Docker/Portainer debe limitarse a administradores.

Si tu plataforma admite secretos montados como archivos, puedes usar `NODUS_ADMIN_EMAIL_FILE` y `NODUS_ADMIN_PASSWORD_FILE` en lugar de los valores directos. No configures simultáneamente una variable directa y su variante `_FILE`. Nodus lee el archivo al arrancar y nunca registra el contenido.

## Conectar un vault de Nodus Desktop

1. Entra como administrador en `https://tu-dominio`.
2. Crea un espacio.
3. Pulsa «Crear código para Nodus»; el código caduca en 15 minutos y solo funciona una vez.
4. En Nodus Desktop abre **Ajustes → Servidor**, escribe la URL base y el código, y pulsa «Conectar vault».
5. La primera publicación se hace inmediatamente. Después Nodus comprueba un contador SQLite cada 30 segundos y solo vuelve a publicar cuando hay cambios, ha transcurrido un minuto sin actividad y se respeta un mínimo de dos minutos entre envíos.

Por defecto se publican referencias y conocimiento académico derivado. PDF, credenciales, rutas, embeddings, listas de alumnos, grupos, calificaciones y resultados de evaluación nunca se publican. Las notas/proyectos/materiales docentes y los pasajes extraídos tienen interruptores separados.

## Dar acceso a estudiantes o investigadores

1. Desde la administración web crea una cuenta lectora con contraseña temporal y asígnala a un espacio.
2. La persona inicia sesión y abre **Mi cuenta** para cambiar esa contraseña. Se cerrarán sus demás sesiones y se revocarán sus conexiones OAuth anteriores.
3. Puedes conceder a esa cuenta acceso lector a otros espacios, revocarlo o restablecer su contraseña temporal desde la tabla de usuarios. Un restablecimiento administrativo cierra todas las sesiones y conexiones OAuth de esa cuenta.
4. La persona añade `https://tu-dominio/mcp` como conector MCP personalizado en ChatGPT o Claude.
5. El cliente abre la pantalla OAuth de Nodus Server. La persona inicia sesión y autoriza el permiso de lectura.

Cada token está vinculado a esa persona y a esta URL MCP. Las herramientas comprueban la membresía del espacio en cada llamada. La versión actual es deliberadamente de solo lectura; las ediciones remotas no se mezclan con el vault local ni pueden sobrescribirlo.

## Seguridad y operación

- No expongas 7443 a Internet ni uses el servidor sin HTTPS.
- Mantén Docker, Caddy/Nginx y la imagen de Nodus actualizados.
- Usa contraseñas únicas; el servidor exige entre 12 y 1024 caracteres.
- El login limita intentos simultáneamente por IP, por cuenta (mediante un identificador hash que no revela el correo) y en todo el servidor. Las cuentas inexistentes ejecutan la misma verificación criptográfica que las existentes para evitar su enumeración por tiempos de respuesta.
- `/setup`, el emparejamiento, el registro OAuth y el intercambio de tokens tienen límites propios y límites globales. Los cuerpos de autenticación están acotados, las sesiones activas por cuenta se limitan y los registros internos de rate limiting no pueden crecer sin límite.
- Caddy o Nginx debe conservar la IP real del cliente mediante `X-Forwarded-For`; no coloques otro proxy no confiable directamente delante del puerto interno.
- Cambia tu propia contraseña desde **Mi cuenta**. El administrador solo puede restablecer contraseñas de cuentas lectoras; no puede ver las contraseñas existentes.
- Revoca desde la web cualquier dispositivo perdido. Desconectar el vault en Desktop detiene los envíos, pero el administrador debe eliminar la publicación retenida cuando corresponda.
- Haz copias periódicas del volumen `nodus_data` y prueba su restauración. El estado y las publicaciones están bajo `/data` dentro del contenedor.
- La copia de seguridad debe protegerse como los materiales que contiene. Para datos institucionales, documenta alojamiento, conservación, accesos, encargados y transferencias conforme a tu política y al RGPD.

Comprobación rápida:

```sh
curl https://tu-dominio/healthz
docker compose logs -f nodus-server
```

El endpoint de salud debe responder con `{"ok":true,...}`. Para validar MCP y OAuth de extremo a extremo durante una instalación técnica puede utilizarse MCP Inspector.
