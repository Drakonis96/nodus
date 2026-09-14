# legalize-cl

Legislación de Chile en formato Markdown, versionada como repositorio git.

Cada ley es un archivo; cada reforma es un commit con la fecha real de publicación oficial. El `git log` de cada ley te muestra su historia completa — cuándo se sancionó, qué artículos se modificaron y por qué norma.

El repositorio recoge la legislación consolidada de Chile publicada por BCN — Ley Chile, con cada norma como archivo Markdown y cada reforma como un commit de git fechado en la fecha oficial de publicación en el Diario Oficial. El alcance del fetcher se centra en leyes, decretos con fuerza de ley, decretos leyes, decretos supremos, decretos, tratados internacionales, leyes orgánicas constitucionales y leyes de quórum calificado; se excluyen explícitamente resoluciones y ordenanzas.

## Qué contiene

- **Ley** (`CL-XXXXXX.md`) — `cl/CL-242302.md`, `cl/CL-1138479.md`
- **Código** (`CL-XXXXXX.md`) — `cl/CL-6374.md`
- **Decreto con Fuerza de Ley** (`CL-XXXXXX.md`)
- **Decreto Ley** (`CL-XXXXXX.md`)
- **Decreto / Decreto Supremo** (`CL-XXXXXX.md`) — `cl/CL-258831.md`
- **Tratado Internacional** (`CL-XXXXXX.md`)
- **Ley Orgánica Constitucional** (`CL-XXXXXX.md`)
- **Ley de Quórum Calificado** (`CL-XXXXXX.md`)

## Fuente de los datos

- **Biblioteca del Congreso Nacional de Chile (BCN) — Ley Chile**
  - Portal: https://www.bcn.cl/leychile/
  - Texto XML por norma: https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma={id}
  - Búsqueda/exportación CSV: https://nuevo.leychile.cl/servicios/Consulta/script/exportarBSimpleMetas
  - Datos abiertos enlazados: https://datos.bcn.cl/es/

## Identificador y nombres de archivo

El identificador de cada norma es `CL-{idNorma}`, donde `idNorma` es el identificador interno de BCN para la norma (no el número de ley). El archivo se nombra `cl/CL-{idNorma}.md`.

## Descubrimiento y límites de cobertura

El endpoint de búsqueda simple de BCN (`exportarBSimpleMetas`) limita silenciosamente cada consulta a unas ~1.600 filas e ignora la paginación, por lo que el descubrimiento combina dos fases: (A) iteración por número de ley (`idLey` 1…~22.000) vía `Navegar/get_norma_json` para resolver el catálogo completo de leyes, y (B) paginación por tipo de norma para el resto de rangos. En consecuencia, las leyes tienen cobertura prácticamente completa, mientras que los demás tipos (decretos, decretos leyes, DFL, decretos supremos, tratados, etc.) están limitados a las ~1.600 normas más recientes por tipo.

## Contenido omitido

Los adjuntos binarios incrustados (JPEG/PDF en base64 dentro del texto) se descartan y se contabilizan en `extra`. Las imágenes no se incluyen.

## Otros países

Este repositorio es parte del proyecto **Legalize**, que mantiene legislación de múltiples países como repos git. Ver https://legalize.dev para el catálogo completo.

## Apoyar

Legalize es libre y abierto. Si este trabajo te resulta útil, puedes ayudar a sostener su alojamiento y desarrollo: [Apoya este proyecto](https://buymeacoffee.com/legalizedev).

## Licencia

- **Código del pipeline**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Datos**: Dominio público (publicaciones oficiales del Estado)
