# legalize-ar

Legislación de Argentina en formato Markdown, versionada como repositorio git.

Cada ley es un archivo; cada reforma es un commit con la fecha real de publicación oficial. El `git log` de cada ley te muestra su historia completa — cuándo se sancionó, qué artículos se modificaron y por qué norma.

Alcance V1: **solo legislación nacional con texto consolidado** (~2.000 normas). La legislación provincial (23 provincias + CABA) se incorporará en V2 desde el dataset SAIJ provincial.

## Qué contiene

- **Leyes nacionales** (`LEY-XXXXX.md`) — `ar/LEY-19550.md`, `ar/LEY-26994.md`
- **Decretos reglamentarios** (`DEC-N-YYYY.md`) — `ar/DEC-222-2003.md`
- **Decretos de Necesidad y Urgencia** (`DNU-N-YYYY.md`) — `ar/DNU-70-2023.md`
- **Decretos/leyes** (`DL-N-YYYY.md`) — normas dictadas por gobiernos de facto con fuerza de ley.
- **Constitución Nacional** — incluida vía `LEY-24430.md` (el acto legislativo que ordenó la publicación del texto oficial).

## Fuente de los datos

- **InfoLEG (Ministerio de Justicia — Dirección Nacional del SAIJ)**
  - Catálogo mensual en CSV: https://datos.jus.gob.ar/dataset/base-de-datos-legislativos-infoleg
  - Texto consolidado por norma: https://servicios.infoleg.gob.ar/infolegInternet/anexos/
  - Portal: https://www.infoleg.gob.ar

## Atribución

> Datos legislativos provistos por el Ministerio de Justicia de la República Argentina a través de la Dirección Nacional del Sistema Argentino de Información Jurídica (SAIJ). Publicados en https://datos.jus.gob.ar bajo licencia Creative Commons Atribución 4.0 Internacional.

Todos los datos son públicos y se publican bajo la licencia **Creative Commons Atribución 4.0 (CC-BY 4.0)** (Resolución MINJUS 986/2016).

## Versiones reales, no solo timeline

A diferencia de otros portales, este repo **reconstruye el contenido de cada artículo en cada fecha** en que fue modificado. Cuando miras `git log ar/LEY-19550.md`, cada commit corresponde a un Boletín Oficial concreto (una reforma real) y `git show` te muestra exactamente qué cambió en esa fecha.

La reconstrucción se basa en:

1. El texto original de la ley (`norma.htm` en InfoLEG) como commit inicial.
2. Las modificatorias cronológicamente ordenadas, bajadas una por una y analizadas para extraer los artículos que sustituyen, derogan o incorporan.
3. Una verificación final contra el texto consolidado actual (`texact.htm`) para garantizar que el último commit del repo coincide con el texto vigente.

Cada norma lleva en su frontmatter un campo `reform_quality` con el grado de fidelidad de la reconstrucción:

- `clean` — la cadena de reformas converge exactamente al texto consolidado.
- `partial` — algunas reformas no se pudieron aplicar automáticamente; el último commit es una `[consolidacion]` que alinea con el texto vigente.
- `bootstrap-only` — la reconstrucción falló; el repo solo tiene el texto original y el texto actual, sin el camino intermedio.

## Limitaciones conocidas

- Las **tablas tarifarias escaneadas como JPG** (p. ej. los anexos de la Ley 27.430 de Reforma Tributaria) se dropean del texto Markdown. El campo `extra.images_dropped` en el frontmatter indica cuántas se perdieron. Un futuro pase de OCR las incorporará.
- Las **~94 resoluciones que actualizan montos** (capital social mínimo por inflación, multas) de algunas leyes clave no se incluyen como commits en V1. Son cambios puramente numéricos que no modifican el articulado.
- **Actualizaciones mensuales**: el catálogo InfoLEG se regenera el día 1 de cada mes. El repo se sincroniza automáticamente el día 2. La latencia máxima entre una publicación en el B.O. y su aparición aquí es ~30 días.

## Otros países

Este repositorio es parte del proyecto **Legalize**, que mantiene legislación de múltiples países como repos git. Ver https://legalize.dev para el catálogo completo.

## Apoyar

Legalize es libre y abierto. Si este trabajo te resulta útil, puedes ayudar a sostener su alojamiento y desarrollo: [Apoya este proyecto](https://buymeacoffee.com/legalizedev).

## Licencia

- **Código del pipeline**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Datos**: CC-BY 4.0 (atribución obligatoria a SAIJ)
