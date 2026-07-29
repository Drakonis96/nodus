# ADR-003: Texto versionado, fragmentos y entidades derivadas

- Estado: aceptada
- Fecha: 2026-07-29
- Ámbito: vault `primary_sources`

## Contexto

OCR, transcripción, observación estructurada e interpretación no tienen el mismo
estatuto. Enlazar una persona con un documento completo tampoco basta para recuperar
la afirmación que sostiene el vínculo.

## Decisión

El texto se conserva en versiones (`ocr`, `diplomatic`, `normalized`,
`translation`) con autor o motor y estado de revisión. Segmentos estables anclan
páginas, regiones o intervalos. `archive_excerpts` guarda el localizador humano, el
ancla técnica y una copia del texto citado; corregir la transcripción no reescribe la
cita.

Las operaciones automáticas crean `archive_entity_proposals`. Aceptarlas crea o
vincula entidades y añade `record_evidence` en una sola transacción. Rechazarlas
conserva la huella de entrada/modelo para que un reintento sea idempotente. Una
relación confirmada requiere evidencia o una excepción explícita auditada.

`archive_proposal_decisions` es un diario append-only: conserva por separado la
salida original del modelo, la versión editada por la persona revisora, la decisión,
la entidad materializada y la evidencia resultante. Un índice parcial admite una
única aceptación por propuesta, por lo que repetir la operación devuelve el mismo
recibo sin duplicar entidad ni evidencia. Rechazar o aplazar nunca modifica el
payload original ni permite que una reejecución lo vuelva a dejar pendiente.

Las coincidencias con personas, lugares y eventos existentes se ofrecen como
candidatos, no como decisiones automáticas. Una persona nueva nace como identidad
provisional. Las confirmaciones de identidad se registran en `entity_resolutions`;
revertir una resolución cambia el estado del registro, sin borrar la mención, la
propuesta ni la evidencia.

La vista documental de personas interpreta una fusión como una superposición, no
como una migración destructiva. Una resolución activa `person A → person B` hace
que el dossier de B reúna recursivamente menciones, variantes, decisiones y
evidencias de A. No se actualiza `archive_person_mentions.person_id`, no se copian
evidencias y no se elimina A. Revertir la resolución separa los dossiers de
inmediato porque nunca hubo datos que reconstruir. Los nombres escritos en las
fuentes proceden de `archive_person_mentions.original_label`; las variantes
editoriales viven aparte en `person_names`.

El dossier no sintetiza una ficha por consenso. Cada nombre y cada valor aceptado
se proyecta como una aserción que conserva fuente, fragmento, localizador, evidencia
y papel probatorio. Los valores distintos de un mismo campo —o una evidencia marcada
como contradicción— forman una discrepancia visible. Las variantes ortográficas del
nombre se muestran juntas, pero no se consideran por sí solas una contradicción.
Las personas sin menciones o evidencia del corpus se excluyen de esta vista, aunque
puedan seguir existiendo en otros dominios.

La extracción se ejecuta exclusivamente sobre un `archive_excerpt`. Los prompts
están disponibles en los ocho idiomas de interfaz y obligan a conservar las citas
en el idioma original. El código de extracción no importa repositorios canónicos de
escritura: su único destino persistente es la cola de propuestas.

Las notas son interpretación. `note_links` permite citar o interpretar un fragmento,
pero el buscador y la interfaz etiquetan la nota como interpretación, nunca como
contenido de la fuente.

## Consecuencias

- Ninguna llamada de IA escribe datos canónicos.
- Identidades y topónimos pueden permanecer sin resolver.
- Evidencia contradictoria se conserva junto a la de soporte.
- Todo evento, lugar o relación documentado puede volver al fragmento y al máster.
- Un fallo al crear evidencia revierte también la entidad y la decisión.
- Modelo, payload original, edición humana y resultado quedan auditables.
- Reunir identidades nunca borra registros ni formas originales y es reversible en
  tiempo constante cambiando únicamente el estado de la resolución.

## Vistas históricas derivadas

Cronología, mapa y relaciones sociales son proyecciones de evidencia documental
aceptada. Un elemento confirmado solo se devuelve si tiene al menos un fragmento
exacto con una cita no vacía. Los elementos manuales o insuficientemente sustentados
siguen disponibles como hipótesis, se distinguen visualmente y permanecen ocultos por
defecto. Las fechas y relaciones contradictorias se conservan como alternativas.

La cronología mantiene la formulación humana de la fecha, el intervalo normalizado,
el calificador y el estado de revisión. El mapa conserva siempre el topónimo original
de la fuente. La resolución añade una decisión reversible en
`archive_place_resolution_decisions` y nunca reescribe la etiqueta documental. Si un
candidato de gazetteer ya corresponde a otro lugar, la decisión lo referencia como
superposición canónica sin vulnerar la unicidad del gazetteer.

Las capas cartográficas distinguen mención, evento, movimiento, repositorio,
custodia, consulta y ubicación física privada. Esta última está desactivada por
defecto; las coordenadas sensibles se ocultan o redondean antes de llegar al
renderizador. El grafo social reutiliza el modelo general de relaciones, adjunta
evidencia a toda arista confirmada y ofrece una tabla accesible. Las tres vistas
permiten filtrar por tiempo y fuente y abren el dossier de evidencia subyacente.

## Búsqueda y notas de investigación

La búsqueda transversal consulta directamente los datos canónicos y etiqueta cada
resultado como metadato, texto automático, transcripción, fragmento, entidad o
interpretación. Un resultado textual conserva versión y rango; si existe un fragmento
que cubre la coincidencia, el enlace usa ese fragmento. El contenido privado,
restringido o con derechos por revisar solo entra mediante una confirmación explícita
compatible con la política central. SQLite `LIKE` permanece como estrategia inicial
mientras la medición del corpus de referencia se mantenga bajo el objetivo; FTS5 solo
se añadirá como índice reconstruible si la métrica lo justifica.

Las notas continúan usando el cuerpo Markdown compartido. La tabla
`primary_source_note_profiles` añade tipo, estado, colección, acceso y sensibilidad
sin convertirlos en secciones ni hechos. Una nota es privada por defecto y sus
permisos no se heredan de la fuente enlazada. `note_links` conserva la relación tipada y
`primary_source_note_link_snapshots` guarda la cita y el localizador vistos al
insertarla. Esa instantánea permite advertir de cambios sin reescribir la nota ni la
fuente. Inicio deriva métricas y tareas de los registros canónicos; cada tarjeta
transporta un conjunto acotado de identificadores para abrir una lista realmente
filtrada en la sección responsable.
