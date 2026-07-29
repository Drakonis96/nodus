# ADR-002: Unidad documental, representaciones digitales y máster inmutable

- Estado: aceptada
- Fecha: 2026-07-29
- Ámbito: Archivo compartido y vault `primary_sources`

## Contexto

Una unidad puede existir sin copia digital, contener varias páginas o archivos, y
tener copias de acceso, miniaturas, OCR y transformaciones. Reemplazar el BLOB de
`archive_items` destruiría identidad e historial.

## Decisión

`archive_items` continúa siendo el registro documental compatible.
`archive_item_files` almacena cada representación con rol, secuencia, versión, padre,
checksum SHA-256, metadatos de captura y transformación.

El primer archivo aceptado como `master` es inmutable. Cambiar bytes, MIME, nombre,
hash, ruta o metadatos de captura crea una fila nueva; nunca actualiza el máster. Un
derivado debe indicar padre y transformación. Rotación de vista y zoom son estado de
interfaz; una rotación guardada es un derivado.

La migración copia cada BLOB heredado a un máster, conserva las columnas antiguas
como fallback y compara bytes y hashes antes de avanzar. Las listas nunca devuelven
BLOBs; una operación específica lee o transmite el archivo.

## Consecuencias

- “Reemplazar archivo” se convierte en “Añadir versión”.
- La verificación no sustituye el hash esperado cuando hay discrepancia.
- Una fuente sin archivo sigue siendo válida, pero no puede figurar como preservada.
- Los conflictos de sincronización conservan las dos versiones.
