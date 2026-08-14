# Configuración de release de Nodus Cloud

“Deploy to Cloudflare” no requiere cliente OAuth, dominio de Nodus, backend de aprovisionamiento ni credenciales del proyecto. Desktop construye el enlace oficial:

```text
https://deploy.workers.cloudflare.com/?url=https://github.com/Drakonis96/nodus/tree/main/cloudflare
```

La plantilla debe permanecer pública y la subcarpeta `cloudflare/` debe funcionar como raíz de proyecto aislada. Cloudflare crea en la cuenta del usuario una copia Git, los recursos definidos por bindings y un deployment administrable por el propio usuario. Véase [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/).

## Requisitos de la plantilla publicada

- `wrangler.jsonc` declara D1 `DB`, R2 `OBJECTS`, `workers.dev` y el cron de mantenimiento, sin identificadores reales de ninguna cuenta.
- `.dev.vars.example` declara `NODUS_BOOTSTRAP_SECRET_HASH`; Cloudflare lo solicita como secreto durante el flujo.
- `package.json` incluye descripciones sencillas para los bindings y ejecuta migraciones remotas antes de `wrangler deploy`.
- Todas las rutas de código, migraciones, licencia e instrucciones necesarias viven dentro de `cloudflare/`; no se importa `../`.
- `NODUS_SOURCE_URL` apunta a la fuente correspondiente a la versión distribuida.
- No se incluyen tokens, secretos, IDs de cuenta, IDs reales de D1/R2 ni dominios personales.

Cloudflare documenta que el botón puede aprovisionar bindings D1/R2, solicitar secretos desde `.dev.vars.example`, usar un comando de despliegue personalizado y tratar una subcarpeta de monorepo como raíz. Esos comportamientos deben volver a verificarse antes de cambiar la plantilla.

## Catálogo de precios actualizable

`cloudflare/catalog/pricing.v1.json` es una copia comprobada para funcionar sin red. Una release puede recibir un catálogo firmado configurando:

- `NODUS_CLOUDFLARE_CATALOG_URL`: HTTPS que devuelve `{ "catalog": ..., "signature": "base64" }`;
- `NODUS_CLOUDFLARE_CATALOG_PUBLIC_KEY`: clave pública Ed25519 PEM.

El build copia esos valores públicos a `catalog-config.json`. Desktop solo acepta un catálogo remoto con firma válida. Ante cualquier error usa la copia incluida, avisa de su fecha y enlaza siempre la documentación oficial. La clave privada de firma nunca entra en el repositorio ni en la aplicación.

## Comprobación previa a publicar

- Revisar de nuevo precios, límites, condiciones de nivel gratuito y comportamiento del botón en la documentación oficial.
- Confirmar que la URL de plantilla pública existe y que su licencia y código fuente son accesibles.
- Ejecutar `npm run build`, `npm run typecheck`, `npm run test:cloudflare` y `node scripts/verify-cloudflare-local.mjs` contra Wrangler local.
- Probar el botón de extremo a extremo en una cuenta Cloudflare y una cuenta Git de staging. Esta interacción no puede automatizarse sin dar a la prueba acceso a esas cuentas.
- Confirmar que el build y el paquete no contienen `api.cloudflare.com`, tokens Cloudflare, clientes OAuth de control ni `oauth-client.json`.
- Verificar alta, reconexión tras interrupción, publicación, Mobile, export de recuperación y rollback de Worker.
