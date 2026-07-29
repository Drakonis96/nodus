# Preservación, copia y recuperación

## Principios

- El archivo recibido se conserva como máster.
- Cada BLOB obtiene SHA-256 al ingresar.
- Los derivados enlazan padre, transformación, versión y hash.
- OCR y transcripciones son capas versionadas, no sustitutos del original.
- Miniaturas y derivados de acceso son regenerables.
- Una incidencia de integridad informa; nunca reescribe el máster.
- Sincronización y copia de seguridad son operaciones distintas.

Los listados consultan metadatos y la existencia del contenido, pero no leen el
BLOB ni el texto completo. El visor solicita bytes por identificador y puede
leerlos por rangos.

## Copia de seguridad

El snapshot del vault incluye tablas, BLOBs, jerarquía, perfiles, versiones,
fragmentos, propuestas, evidencia y auditoría. El inventario del paquete
enumera archivos y hashes. Si hay rutas externas, el manifiesto permite detectar
ausencias y restaurarlas deliberadamente.

Antes de una migración que lo requiera, Nodus crea una copia previa mediante el
motor compartido. Las tablas de Fuentes primarias están clasificadas en el
inventario de sincronización; los registros operativos y las métricas locales
quedan excluidos.

## Recuperación comprobable

1. Conserva el vault afectado sin modificar.
2. Restaura el paquete como un vault nuevo.
3. Verifica el manifiesto y los hashes.
4. Ejecuta las migraciones pendientes.
5. Abre una muestra de másteres, derivados, textos y fragmentos.
6. Comprueba jerarquía, evidencia y restricciones.
7. Solo después decide sustituir el vault de trabajo.

Las pruebas automatizadas reconstruyen paquetes permitidos, detectan
manifiestos o hashes alterados, restauran como nuevo y comprueban
`foreign_key_check` y `quick_check`. La copia cifrada usa el mismo subsistema de
backup de Nodus y no omite las tablas nuevas.

## Incidencias

Un archivo ausente, hash nulo o discrepancia se registra con estado y fecha. El
dossier ofrece reintento de verificación y conserva el historial. Nunca se
redirige una cita silenciosamente a otra versión: si la representación citada
falta, se abre el contexto disponible y se muestra la incidencia.
