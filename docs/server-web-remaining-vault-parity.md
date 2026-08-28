# Paridad de las superficies restantes del servidor

Esta matriz cubre las rutas de bóveda que no son académicas, de estudio ni de
worldbuilding/genealogía. El servidor conserva el patrón visual de Desktop (catálogo
denso → pestaña → dossier/lector) y publica únicamente el contexto incluido en el
`snapshot`; las operaciones de edición, ficheros locales, audio y personas no públicas
siguen siendo de Desktop.

| Tipo normalizado | Ruta visible | Catálogo | Detalle y navegación | Estado seguro |
| --- | --- | --- | --- | --- |
| `primary_sources` | Archivo | `archive-items` | dossier de siete pestañas; fuente → repositorio/unidad/extracto/análisis/persona | texto y metadatos publicados; sin rutas, blobs ni notas privadas |
| `primary_sources` | Buscar | `archive-items`, `archive-units`, `archive-excerpts`, `source-analyses` | resultado recargable hacia su dossier dedicado | solo filas publicadas |
| `databases` | Páginas | `database-pages` | lector de página con bloques publicados | comentarios reducidos; sin contenido eliminado |
| `databases` | Análisis / bases | `databases` | tabla publicada, vistas, relaciones, opciones, adjuntos-imagen | adjuntos binarios solo si su asset fue publicado |
| `testimonios` | Entrevistas | `testimony-interviews` | dossier entrevista → transcripción/códigos | sin media, contactos ni identidades de participantes |
| `testimonios` | Contrastes | `testimony-contrasts` | memorando → fragmentos comparados | citas/anotaciones publicadas únicamente |
| `testimonios` | Buscar | `testimony-interviews`, `testimony-transcripts`, `testimony-codes`, `testimony-contrasts` | cada tipo mantiene su lector/dossier | el detalle de código elimina ids de entrevista/transcripción |
| `prosopography` | Población / fuentes / análisis / redes | tablas, métricas y red agregada generadas al publicar | dossier agregado recargable, sin enlaces a identidades | sólo agregados; personas, nodos, aristas, citas y resolución de identidad siguen fail-closed |
| `docencia` | Grupos / calificaciones / unidades | superficies explícitas privadas | no hay datos ni enlaces a registros | denylist permanente; no se sustituyen por datos de estudio |

## Dossiers anidados añadidos

Los enlaces del dossier de una fuente ya no caen en la vista de columnas genéricas:

- repositorio: unidades y fuentes vinculadas;
- unidad descriptiva: repositorio y fuentes descritas;
- extracto: cita/localizador y fuente de origen;
- análisis de fuente: campos críticos y fuente analizada;
- código de testimonio: descripción, etiqueta y fragmentos anotados.

Cada relación usa una colección REST canónica y conserva el deep-link de la pestaña
activa después de recargar. Las respuestas del servidor filtran deliberadamente
identificadores de entrevistas/transcripciones en anotaciones de códigos.

El Archivo de fuentes primarias ofrece tres proyecciones de lectura: tabla para
comparar metadatos, galería para inspección rápida e **jerarquía** para conservar
la navegación Desktop por unidad archivística o colección de trabajo. La jerarquía
agrupa las filas publicadas, mantiene el contador de cada grupo, incluye un estado
explícito para fuentes sin unidad/colección y abre el dossier de la fuente sin
convertir el catálogo en una cuadrícula genérica.

Prosopografía mantiene sus rutas Desktop, pero el adaptador sustituye los catálogos
identificables por `prosopography-public-*` únicamente cuando el snapshot contiene la
proyección agregada. Si esa proyección no existe, la vista vuelve al estado privado; no
reutiliza `persons`, `relationships` ni fuentes archivísticas como atajo visual.
