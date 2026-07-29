# ADR-004: Gobernanza, paquetes de investigación y recuperación

- Estado: aceptada
- Fecha: 2026-07-29
- Ámbito: vault `primary_sources`

## Contexto

Una fuente puede ser abierta, privada, restringida, embargada o tener derechos
desconocidos. Esa dimensión es independiente de su sensibilidad. La interfaz no
puede ser la única barrera: Toolkit, IA, búsqueda, sincronización y exportación
también tienen entradas desde IPC y procesos en segundo plano.

Un ZIP que borra filas de una copia SQLite tampoco es seguro por sí solo. Los
registros eliminados pueden quedar en páginas libres, los triggers pueden generar
tombstones con IDs filtrados y un enlace de nota puede conservar una referencia a
una fuente excluida.

## Decisión

`decidePrimarySourcePolicy` es la primitiva compartida y
`primary_source_policies` conserva la configuración del vault. Cada consumidor
vuelve a evaluar la política en el backend. Una autorización es explícita, acotada
a una ejecución y no puede levantar un bloqueo institucional o un embargo.

El Toolkit resuelve primero la selección exacta y devuelve una previsualización con
fuentes, archivos o textos, bytes, proveedor, modelo, salida del dispositivo,
decisiones de política y clase de resultado. OCR, transcripción, segmentación y
traducción crean versiones append-only. Las demás operaciones crean propuestas o
informes pendientes. Los modelos de visión reciben como máximo ocho imágenes
compatibles y 30 MiB; ningún archivo bloqueado se carga en el contexto.

Los prompts de crítica de fuentes existen en los ocho idiomas de interfaz. Obligan
a separar transcripción, observación e inferencia; conservar forma histórica,
contradicción e incertidumbre; citar localizador; no inventar texto, identidades,
fechas, relaciones o intenciones; y tratar toda salida como propuesta humana.

`primary_source_operation_runs` solo registra hashes, conteos, proveedor, modelo,
bytes, ubicación de procesamiento y resultado. No guarda IDs, texto, nombres,
rutas, prompt ni respuesta.

Las citas se construyen desde campos estructurados y un enlace estable
`nodus://primary-source/...`. El texto editorial es corregible sin modificar esos
campos ni la procedencia.

## Paquete portable

Los perfiles iniciales son inventario, paquete de fuentes, dossier de evidencia y
datos interoperables. Antes de crear el paquete se muestran inclusiones,
restricciones, redacciones, notas privadas, archivos ausentes, referencias
incompletas y tamaño. Una nota tiene acceso y sensibilidad propios y es privada por
defecto.

El paquete contiene:

- inventario CSV, JSON o XLSX;
- metadatos y, si se autoriza, texto, notas y objetos;
- una instantánea SQLite filtrada;
- manifiesto con esquema, tablas, conteos, tamaños y SHA-256;
- instrucciones de validación.

El filtrado SQLite desactiva bytes duplicados y rutas locales, elimina toda tabla
no portable, corta referencias a elementos excluidos y vuelve a limpiar tablas
operativas después de que actúen los triggers. `VACUUM` elimina páginas libres para
que una cadena restringida no sea recuperable del binario. Los IDs de exclusiones
solo aparecen como huellas SHA-256 truncadas en el manifiesto. Antes de empaquetar
se ejecutan `foreign_key_check` y `quick_check`.

La sincronización cifrada aplica la misma política por fila a fuentes, archivos,
textos, unidades, notas y enlaces. Las auditorías de llamadas, exportaciones y
restauraciones permanecen locales. Cambiar la política no concede una autorización
silenciosa a un proceso ya preparado.

## Validación y restauración

El validador rechaza ZIP ilegible, rutas absolutas o con traversal, entradas
duplicadas, formato o esquema incompatibles, archivos ausentes y cualquier
discrepancia de tamaño o checksum. La restauración hidrata los objetos solo después
de validar, comprueba otra vez claves foráneas e integridad SQLite y crea siempre un
vault nuevo. El vault abierto no se sobrescribe. El informe conserva hash del
paquete, estado y conteos, no la ruta del archivo.

La copia completa sigue siendo distinta del paquete de investigación. Reutiliza el
motor de recuperación general, que inventaría dinámicamente todas las tablas,
verifica checksums y prueba que la copia abre. La sincronización no se presenta como
backup porque puede propagar borrados o corrupción.

## Consecuencias

- Una fuente restringida no entra en un paquete ni en contexto externo aunque el
  renderer envíe su ID como “autorizado”.
- Un resultado automático nunca sobrescribe máster, texto revisado ni datos
  canónicos.
- Los paquetes se pueden auditar y validar sin confiar en su nombre o procedencia.
- Las notas no se publican por el mero hecho de citar una fuente abierta.
- Agregar una tabla primaria sin clasificar hace fallar la prueba de inventario en
  vez de producir una copia silenciosamente incompleta.
