# legalize-co

Legislación de Colombia en formato Markdown, versionada como repositorio git.

Cada ley es un archivo; cada reforma es un commit con la fecha real de publicación oficial. El `git log` de cada ley te muestra su historia completa — cuándo se sancionó, qué artículos se modificaron y por qué norma.

Cobertura de la normativa nacional colombiana publicada en SUIN-Juriscol, con texto consolidado por norma. SUIN no expone API ni catálogo: las normas se descubren enumerando identificadores numéricos internos del portal (viewDocument.asp?id=...). Cada archivo es una norma; el historial de reformas se reconstruye a partir de los bloques "LEGISLACIÓN ANTERIOR" que SUIN incrusta por artículo, con su rango de vigencia.

## Qué contiene

- **Ley** (`LEY-XX-AAAA.md`) — `co/LEY-57-1887.md`
- **Decreto** (`DECRETO-XX-AAAA.md`) — `co/DECRETO-453-1981.md`
- **Acto Legislativo** (`ACTO-LEGISLATIVO-XX-AAAA.md`) — Reformas a la Constitución Política.
- **Otros tipos normativos** (`{TIPO}-XX-AAAA.md`) — SUIN-Juriscol también publica acuerdos, resoluciones, circulares, instrucciones, constituciones y jurisprudencia (Corte Constitucional, Consejo de Estado, Corte Suprema); el rango del nombre de archivo se deriva del campo tipo de cada norma.

## Fuente de los datos

- **SUIN-Juriscol — Sistema Único de Información Normativa, Ministerio de Justicia y del Derecho de Colombia**
  - Portal: https://www.suin-juriscol.gov.co
  - Documento: https://www.suin-juriscol.gov.co/viewDocument.asp?id={id}
  - Dataset (Datos Abiertos Colombia): https://www.datos.gov.co/Justicia-y-Derecho/Lista-de-normas-cargadas-en-el-Sistema-nico-de-Inf/fiev-nid6

## Limitaciones conocidas

- Las imágenes incrustadas en las normas se omiten deliberadamente (no se procesan activos binarios).
- Las fechas de publicación provienen de campos editados manualmente por SUIN y ocasionalmente contienen años futuros erróneos; el parser los descarta y recurre a otras fechas (vigencia, expedición) cuando la fecha del Diario Oficial es implausible.
- SUIN-Juriscol sirve una cadena de certificados TLS rota, por lo que la descarga deshabilita la verificación de TLS.
- El identificador del archivo se construye a partir de los campos tipo/número/año de la norma; cuando faltan, se intenta derivar del título y, en última instancia, se usa el id numérico interno de SUIN.

## Otros países

Este repositorio es parte del proyecto **Legalize**, que mantiene legislación de múltiples países como repos git. Ver https://legalize.dev para el catálogo completo.

## Apoyar

Legalize es libre y abierto. Si este trabajo te resulta útil, puedes ayudar a sostener su alojamiento y desarrollo: [Apoya este proyecto](https://buymeacoffee.com/legalizedev).

## Licencia

- **Código del pipeline**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Datos**: Textos normativos oficiales del Estado colombiano, reproducibles conforme al art. 41 de la Ley 23 de 1982, con la obligación de conformarse con la edición oficial. Los campos editoriales que acompañan a cada norma (vigencia, subtipo, sector, materia) y el historial de reformas provienen de la anotación de SUIN-Juriscol (Ministerio de Justicia y del Derecho); Legalize no reclama derechos sobre ellos, ni reproduce el formato, el diseño ni la marca del portal. La licencia MIT cubre el código del pipeline, nunca el contenido normativo.
