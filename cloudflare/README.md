# Nodus Cloud para Cloudflare

Servidor de sincronización y publicación de Nodus que se instala directamente en la cuenta de Cloudflare de cada usuario. Cloudflare ejecuta el Worker, guarda los datos estructurados en D1 y los archivos privados en R2. Nodus no recibe credenciales ni permisos sobre esa cuenta.

## Despliegue recomendado

Nodus Desktop abre el asistente oficial **Deploy to Cloudflare** con esta carpeta como plantilla. Cloudflare:

1. crea una copia del código en la cuenta de GitHub o GitLab elegida por el usuario;
2. crea D1 y R2 y conecta ambos recursos al Worker;
3. solicita el valor secreto `NODUS_BOOTSTRAP_SECRET_HASH` que muestra Desktop;
4. aplica las migraciones y publica una URL gratuita `workers.dev`.

No hace falta comprar un dominio, contratar hosting tradicional ni entregar a Nodus un token de Cloudflare. La ubicación de D1 y R2 es la selección automática de Cloudflare en este flujo. El botón oficial no documenta un parámetro para fijar jurisdicción; quien necesite fijación estricta debe crear esos recursos manualmente y revisar las opciones vigentes de Cloudflare.

Documentación oficial: [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [D1](https://developers.cloudflare.com/d1/), [R2](https://developers.cloudflare.com/r2/).

## Qué contiene la plantilla

- `src/`: Worker y API de Nodus Cloud.
- `migrations/`: esquema versionado de D1.
- `wrangler.jsonc`: bindings D1/R2 y tarea de mantenimiento.
- `.dev.vars.example`: variable secreta que Cloudflare solicita durante el despliegue.
- `package.json`: aplica migraciones antes de publicar el Worker.

Vectorize es opcional. Sus índices requieren una dimensión concreta que depende del modelo de embeddings de cada vault, algo que una plantilla pública estática no conoce. El despliegue directo usa matrices portables en R2 y búsqueda exacta; si el propietario añade bindings `VECTORS_<dim>`, el Worker los anuncia y Desktop los utiliza automáticamente.

## Desarrollo local

Se necesita Node 20 o posterior. Calcula primero el SHA-256 de un secreto de prueba y pásalo al Worker; el verificador usa el secreto original.

```sh
cd cloudflare
npm install
npx wrangler d1 migrations apply DB --local
NODUS_TEST_BOOTSTRAP_HASH="$(printf %s final-local-secret | shasum -a 256 | awk '{print $1}')"
npx wrangler dev --local --port 8799 --var "NODUS_BOOTSTRAP_SECRET_HASH:$NODUS_TEST_BOOTSTRAP_HASH"
```

En otra terminal, desde la raíz del repositorio:

```sh
node scripts/verify-cloudflare-local.mjs
```

Para comprobar el mantenimiento programado, inicia Wrangler con `--test-scheduled` y abre `http://localhost:8799/__scheduled?cron=17+3+*+*+*`.

## Licencia y actualizaciones

El código se distribuye bajo AGPL-3.0-only. La respuesta de capacidades enlaza al código fuente correspondiente. La copia creada por el asistente pertenece al usuario; los commits de esa copia activan Workers Builds. Consulta `UPDATING.md` antes de incorporar una nueva versión de Nodus Cloud.
