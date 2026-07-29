# Contrato de dominio de Prosopografía

Estado: aceptado para la primera versión publicable.

## ADR-1 — La población es una decisión versionada

Una población objetivo pertenece a una metodología publicada. La pertenencia de una
persona se decide por versión, conserva autor, fecha, justificación y evaluaciones por
criterio. Una versión publicada es inmutable. Cambiar los criterios crea otra versión y
no reescribe decisiones anteriores.

## ADR-2 — Factoid y statement son capas distintas

El factoid identifica el lugar concreto de una fuente que el investigador interpreta.
Cada statement expresa una afirmación atómica. Un factoid revisado necesita fuente y
segmento; un statement revisado necesita factoid. La interfaz los llama observación y
afirmación. Una resolución puede preferir o relacionar statements, pero nunca borrarlos.

## ADR-3 — Mención e identidad no son equivalentes

La importación crea menciones. Resolver una mención contra una persona es una decisión
humana y reversible. Las coincidencias automáticas solo crean hipótesis `same_as` o
`different_from`, con puntuación explicativa y evidencia. El literal siempre se conserva.

## ADR-4 — El cuestionario es un esquema versionado

Una variable conserva una clave estable; cada cuestionario publicado contiene una
revisión con pregunta, tipo, cardinalidad, vocabulario, sensibilidad, aplicabilidad,
ausencias y política analítica. Cambios incompatibles crean una revisión nueva y una
versión nueva del cuestionario.

## ADR-5 — El análisis consume proyecciones reproducibles

Los statements son canónicos; una matriz es una proyección derivada. Su definición fija
grano, población, versiones, fuentes, corte temporal, resoluciones, multivalores y
ausencias. Su huella incorpora entradas y motor. Todos los resultados muestran población,
denominador conocido, ausencias, advertencias y casos subyacentes.

## ADR-6 — Privacidad y automatización son restricciones efectivas

Los niveles `sensitive` y `restricted` condicionan contexto de IA y exportación. Personas
vivas se excluyen, restringen o admiten con consentimiento según la política del estudio.
La IA y las importaciones escriben propuestas en staging; una persona debe aceptarlas.
Los proveedores externos nunca reciben material restringido sin autorización explícita.

## ADR-7 — Interoperabilidad conserva cuatro entidades

La exportación IPIF preliminar mantiene separadas persona, fuente, factoid y statement.
La exportación larga conserva valor literal, valor tipado, razones de ausencia,
identificadores de statements y fuentes, y la huella de la proyección.

## Casos límite obligatorios

- dos personas homónimas no se fusionan por nombre;
- una persona con varias grafías conserva cada mención;
- dos fuentes contradictorias conservan ambos statements;
- una normalización nunca sustituye el literal;
- un nulo siempre se distingue de una ausencia razonada;
- una cohorte congelada no se recalcula;
- una relación explícita requiere factoid;
- una relación derivada requiere huella de regla;
- una propuesta de IA aceptada requiere revisor;
- una versión publicada se duplica, no se edita.
