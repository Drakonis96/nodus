# Actualizar y revertir Nodus Cloud

La instalación creada por **Deploy to Cloudflare** vive en una copia del repositorio que pertenece al usuario. Nodus Desktop no tiene acceso a esa copia ni a la cuenta de Cloudflare.

## Actualizar

1. Comprueba las notas de la nueva versión de Nodus y sus migraciones.
2. Incorpora a tu copia los cambios publicados en `https://github.com/Drakonis96/nodus/tree/main/cloudflare` mediante la interfaz de GitHub/GitLab o Git.
3. Confirma los cambios. Workers Builds ejecutará `npm run deploy`, aplicará las migraciones D1 y publicará el Worker.
4. Abre Nodus Desktop y fuerza una sincronización para verificar la conexión.

Las migraciones deben ser compatibles hacia delante. Haz un export de D1 y conserva la clave de recuperación antes de una actualización importante.

## Revertir

Cloudflare permite volver a una versión o despliegue anterior del Worker desde su panel. Esto revierte el código, no la base D1. No reviertas una migración destructiva sin un procedimiento de restauración específico.

Documentación oficial: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [versiones y despliegues](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/), [exportar e importar D1](https://developers.cloudflare.com/d1/best-practices/import-export-data/).
