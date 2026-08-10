# Biblioteca transversal y lector limpio

La Biblioteca es el catálogo documental global de Nodus. No pertenece al vault
abierto: aparece en todos los vaults y mantiene una sola copia canónica de cada
documento. Un vault puede enlazar uno de esos documentos para analizarlo sin
duplicar ni modificar el original.

## Decisiones de arquitectura

- La fuente de verdad vive en la carpeta de copias de seguridad elegida por la
  persona usuaria, dentro de `nodus-library`.
- El catálogo SQLite es una caché local descartable. Se reconstruye a partir de
  los manifiestos y no se sincroniza.
- El original, el Markdown limpio, los recursos extraídos, el mapa hacia las
  páginas, las anotaciones y el chat se guardan juntos bajo un identificador
  estable.
- Zotero se consulta en modo de solo lectura. Una actualización nunca escribe
  en Zotero ni elimina las correcciones propias de Nodus.
- La Biblioteca y los vaults tienen responsabilidades distintas: la primera
  conserva y organiza documentos; los segundos contienen análisis, ideas,
  pasajes, notas y demás trabajo específico.

## Estructura en disco

```text
<carpeta-de-backups>/
└── nodus-library/
    ├── library.json
    ├── <identificador-estable>/
    │   ├── metadata.json
    │   ├── original.pdf                 # o la ruta declarada en metadata.json
    │   ├── reader.md
    │   ├── source-map.json
    │   ├── quality-report.json
    │   ├── annotations.json
    │   ├── chat.json
    │   ├── attachments/
    │   └── assets/
    └── .nodus/
        ├── collections/
        ├── records/
        │   ├── items/
        │   └── collections/
        └── conflicts/
```

Los nombres concretos de los derivados se declaran en `metadata.json`. Todas
las rutas se resuelven dentro de la carpeta del documento; una ruta o enlace
simbólico que intente salir de ella se ignora. Los sidecars nuevos de
anotaciones y chat se escriben de forma atómica y, en sistemas POSIX, con modo
`0600`.

El catálogo local está en el perfil de Nodus, en `library/catalog.sqlite`. Es
deliberadamente regenerable: borrarlo no borra documentos, colecciones ni
anotaciones.

### Identidad

- Un ítem personal de Zotero conserva su clave, por ejemplo `E7FGXJFE`, como
  carpeta y `storageId`.
- Un ítem de grupo conserva el identificador canónico completo en los
  metadatos. Solo se codifica el nombre físico si contiene caracteres no
  portables entre Windows, macOS y Linux.
- Un archivo añadido desde Nodus recibe un identificador estable derivado de su
  registro, no de su título visible.
- El `citationKey`, cuando existe, se conserva como dato bibliográfico, pero no
  sustituye al identificador estable.

## Importación y organización

### Zotero

El diálogo de Zotero descubre la biblioteca personal y las bibliotecas de
grupo, permite seleccionar cuáles importar, copiar adjuntos e incluir ítems sin
colección. La jerarquía de colecciones no tiene límite artificial de niveles.

La importación usa las versiones de Zotero para recuperar solo cambios cuando
es posible. La barra informa de conexión, colecciones, catálogo, adjuntos,
reconstrucción y finalización. Cancelar conserva lo ya recuperado; reanudar no
duplica documentos ni adjuntos. Las colecciones importadas son un espejo de
solo lectura. Se pueden combinar con colecciones propias de Nodus, que sí se
pueden crear, anidar, mover, renombrar y eliminar.

El plugin de Zotero expone tres acciones coordinadas con el escritorio:
consultar el estado de la copia limpia, importar o actualizar la biblioteca y
abrir el documento actual en el lector limpio. El original en Zotero nunca se
edita.

### Mendeley y otros gestores

La importación interoperable acepta RIS, BibTeX y CSL JSON. Mendeley y otros
gestores pueden exportar en uno de esos formatos; Nodus importa las fichas,
detecta duplicados y permite añadir después los archivos correspondientes. No
se requiere entregar credenciales de Mendeley a Nodus.

También se pueden añadir directamente PDF, EPUB, HTML, Markdown, texto e
imágenes compatibles. El hash del contenido impide importar dos veces el mismo
archivo.

## Extracción a Markdown limpio

El pipeline trabaja en segundo plano y conserva siempre el original separado.
Para cada documento:

1. identifica el formato y recupera texto y disposición;
2. elimina ruido repetido de cabeceras y pies, normaliza Unicode, espacios,
   guiones de final de línea y saltos de párrafo;
3. conserva títulos, listas, citas y tablas como Markdown estructurado;
4. extrae figuras e imágenes a `assets/` y las referencia con rutas relativas;
5. aplica OCR local a páginas sin texto cuando está habilitado;
6. usa OCR remoto únicamente si la persona lo elige y ha configurado un modelo
   de visión;
7. escribe `source-map.json` con páginas y coordenadas y
   `quality-report.json` con métricas y avisos;
8. publica todos los derivados de forma atómica y actualiza el estado del ítem.

El informe de calidad cuenta espacios dobles, caracteres Unicode descompuestos,
guiones blandos, palabras partidas, páginas vacías, bloques, figuras, tablas y
páginas OCR. Un resultado dudoso queda como `needs-review`; no se presenta como
perfecto de forma silenciosa. Una tarea interrumpida se puede reanudar y una
tarea fallida se puede reintentar.

## Lector

El lector representa `reader.md`, no una capa superpuesta al PDF. Incluye:

- índice de secciones y navegación al punto exacto;
- figuras y tablas estructuradas;
- apertura temporal de la página original asociada;
- apertura independiente del original completo;
- subrayados de seis colores, comentarios y un marcador de lectura por sección;
- panel derecho con metadatos, notas y chat;
- conversación persistente junto al documento;
- apertura de la misma conversación en el Asistente general.

Las selecciones guardan offsets, texto y contexto para poder reanclarse. La
identidad de cada anotación sigue siendo la clave estable del documento, también
cuando el ítem procede de Zotero.

El chat reutiliza el motor y la configuración de modelos de Nodus. Recibe el
Markdown limpio, las anotaciones y una ventana limitada del historial. No
inventa páginas o citas: el prompt exige distinguir el contenido disponible de
una inferencia. Si se usa un modelo local, el contexto no sale del equipo. Si se
elige un proveedor remoto, el texto necesario se envía a ese proveedor solo al
formular una pregunta.

## Metadatos y duplicados

La ficha de Nodus admite título, tipo, autoría, fecha, publicación, editorial,
volumen, número, páginas, edición, lugar, idioma, derechos, URL, DOI, ISBN,
ISSN, resumen y etiquetas.

Las búsquedas por identificador consultan:

- Crossref para DOI e ISSN;
- Open Library para ISBN.

Nodus muestra candidatos y una vista previa; nada se aplica sin revisión. Las
correcciones quedan en una capa propia y sobreviven a futuras sincronizaciones
con el gestor de origen. La detección de duplicados usa DOI, ISBN o una ficha
normalizada. Fusionar es una acción explícita: conserva colecciones, adjuntos,
Markdown, anotaciones y chat en el registro elegido y envía los demás a la
papelera recuperable.

## Relación con los vaults

`Añadir al vault` materializa una referencia analizable con la identidad del
documento. No copia el original ni mueve `reader.md`. Extracción, búsqueda,
resúmenes, pasajes y análisis del vault resuelven el texto desde la Biblioteca.
La operación es idempotente y la ficha global muestra en qué vaults está
disponible y el estado de sus análisis.

Los vaults conectados de solo lectura no aceptan esta escritura. Borrar la
referencia de trabajo dentro de un vault no destruye la copia global.

## Copia, sincronización y recuperación

`nodus-library` forma parte de la carpeta de backups elegida. Si esa carpeta se
sincroniza mediante otro servicio, se sincronizan manifiestos, originales y
sidecars, pero no el SQLite local. Cada cambio de ítem o colección crea un
registro inmutable con reloj, revisión, dispositivo y hash. Dos ediciones
offline divergentes se conservan; Nodus elige una de forma determinista y deja
la otra en `.nodus/conflicts/` para revisión.

Para recuperar la Biblioteca:

1. conserva una copia sin modificar de la carpeta afectada;
2. restaura la carpeta de backups completa, incluida `nodus-library`;
3. selecciona esa carpeta en Ajustes de Nodus;
4. abre Biblioteca; un cambio de raíz invalida la caché y reconstruye el
   catálogo desde los manifiestos;
5. comprueba los contadores de registros inválidos y conflictos;
6. abre una muestra de originales, Markdown, figuras, anotaciones y chats;
7. reintenta únicamente las extracciones que indiquen revisión o error.

Enviar un ítem a la papelera solo lo oculta y conserva sus archivos. La
eliminación física de un backup debe hacerse fuera de Nodus y solo después de
verificar la política de conservación aplicable.

## Privacidad, red y licencias

- Catalogación, lectura, anotaciones, OCR local y reconstrucción funcionan en
  el equipo.
- Zotero se consulta localmente o a través de la API que la persona ya haya
  autorizado, siempre en modo de lectura.
- Crossref y Open Library reciben únicamente el identificador solicitado.
- El OCR remoto y el chat solo contactan el proveedor de IA elegido al ejecutar
  la acción correspondiente.
- Los originales y derivados no se publican en Nodus Server por enlazarlos a un
  vault.
- Esta implementación no añade Firecrawl, Anydoc ni otra dependencia de
  extracción. Reutiliza el pipeline ya incluido en Nodus; no se incorporó una
  nueva herramienta con licencia incompatible.

La carpeta de backups puede contener documentos sujetos a derechos de autor o
datos personales. Debe protegerse con permisos adecuados, cifrado de disco y
la política de copias de la organización.

## Pruebas y mantenimiento

Las pruebas principales son:

- `test-library-storage.mjs`: manifiestos, conflictos y reconstrucción;
- `test-library-migration.mjs`: migración desde vaults sin pérdida;
- `test-zotero-library-import.mjs`: importación diferencial y adjuntos;
- `test-library-extraction.mjs`: Markdown, recursos, OCR, calidad y cola;
- `test-global-library-operations.mjs`: colecciones, importación y papelera;
- `test-library-metadata.mjs`: identificadores, formatos y duplicados;
- `test-global-library-reader.mjs`: lector, páginas, anotaciones y chat;
- `test-global-library-vault-integration.mjs`: enlace y análisis desde un vault;
- `test-global-library-hardening.mjs`: contención de rutas y sidecars privados;
- `e2e-global-library.mjs` y `e2e-library-reader.mjs`: interfaz Electron real.

La matriz de entrega está en
[global-library-acceptance.md](global-library-acceptance.md).
