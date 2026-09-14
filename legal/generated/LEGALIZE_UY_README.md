# legalize-uy

Legislación de Uruguay en formato Markdown, versionada como repositorio git.

Cada ley es un archivo; cada reforma es un commit con la fecha real de publicación oficial. El `git log` de cada ley te muestra su historia completa — cuándo se sancionó, qué artículos se modificaron y por qué norma.

Recopila normativa nacional uruguaya consolidada publicada por IMPO: leyes, decretos-ley del período de facto (1973-1985), constitución y códigos. IMPO publica únicamente el texto consolidado vigente, por lo que cada norma se incorpora como un único punto de partida (bootstrap) en la fecha de su publicación, sin historial de reformas artículo por artículo. La cobertura por defecto del pipeline se concentra en el rango más fiable y denso de IMPO (leyes con número 9000 en adelante, posteriores a 1935); las normas anteriores a 1935 están mayormente sin indexar en la fuente.

## Qué contiene

- **Leyes** (`UY-ley-XXXXX.md`) — `uy/UY-ley-19996.md`, `uy/UY-ley-18331.md`
- **Decretos-ley** (`UY-decreto-ley-XXXXX.md`) — `uy/UY-decreto-ley-14261.md`
- **Decretos** (`UY-decreto-NNN-AAAA.md`) — `uy/UY-decreto-414-2009.md`, `uy/UY-decreto-122-2021.md`
- **Códigos** (`UY-codigo-{nombre}-XXXXX.md`) — `uy/UY-codigo-tributario-14306.md`, `uy/UY-codigo-civil-16603.md`
- **Constitución** (`UY-constitucion-AAAA.md`) — `uy/UY-constitucion-1967.md`

## Fuente de los datos

- **IMPO — Centro de Información Oficial (Dirección Nacional de Impresiones y Publicaciones Oficiales), Uruguay**
  - Portal: https://www.impo.com.uy/
  - Base de normativa: https://www.impo.com.uy/bases/
  - API de datos abiertos (JSON): cualquier URL de norma + ?json=true — https://www.impo.com.uy/datos-abiertos/
  - Esquema JSON: https://www.impo.com.uy/resources/basesIMPO.json

## Atribución

> Fuente: IMPO — Centro de Información Oficial (https://www.impo.com.uy). Datos reutilizados bajo la Licencia de Datos Abiertos – Uruguay (Decreto 54/017).

## Detalles de la fuente

- Codificación de origen: ISO-8859-1 (Latin-1), normalizada a UTF-8 en el repositorio.
- Las imágenes (escaneos del Diario Oficial, etc.) no se incluyen; se conserva el enlace al escaneo en `extra.gazette_scan_url`.
- Las notas editoriales de IMPO (referencias cruzadas e historial de modificaciones que añade el organismo, no texto legal aprobado) no se vuelcan al cuerpo; solo se registra su número en `extra.editorial_notes_count`.

## Otros países

Este repositorio es parte del proyecto **Legalize**, que mantiene legislación de múltiples países como repos git. Ver https://legalize.dev para el catálogo completo.

## Apoyar

Legalize es libre y abierto. Si este trabajo te resulta útil, puedes ayudar a sostener su alojamiento y desarrollo: [Apoya este proyecto](https://buymeacoffee.com/legalizedev).

## Licencia

- **Código del pipeline**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Datos**: Licencia de Datos Abiertos – Uruguay (Decreto 54/017) — requiere atribución
