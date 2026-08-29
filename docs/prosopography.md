# Bóveda de Prosopografía

La bóveda de Prosopografía construye una biografía colectiva sin separar los datos de su evidencia. Su flujo recomendado es:

1. definir pregunta, población, criterios y sesgos;
2. publicar el cuestionario común y sus vocabularios;
3. registrar fuentes y segmentos citables;
4. importar menciones a staging;
5. crear factoids y statements atómicos;
6. resolver identidades y pertenencia con decisiones humanas;
7. congelar cohortes cuando se necesite una muestra reproducible;
8. ejecutar análisis con denominador y razones de ausencia;
9. explorar redes distinguiendo relaciones explícitas, derivadas e hipótesis.

## Reglas del modelo

- Una mención no crea ni fusiona una persona.
- Todo factoid enlaza una fuente y un segmento.
- El literal convive con el valor normalizado.
- Las versiones publicadas de metodología y cuestionario son inmutables.
- Una resolución no elimina statements alternativos.
- Las cohortes congeladas son inmutables.
- Los análisis guardan definición, corte, fingerprint, matriz, N, ausencias y casos.
- Una arista explícita requiere factoids; una derivada requiere regla y fingerprint.
- La IA y MCP solo crean propuestas, nunca decisiones de identidad o pertenencia.

## Intercambio y recuperación

`exportProsopLongRows` genera una fila por statement con sujeto, valor, literal, fuente, localizador y certezas. `exportProsopIpif` genera el borrador IPIF separando persona, fuente, factoid y statement. El auditor verifica invariantes, `PRAGMA quick_check`, checksum canónico y cobertura de sincronización.

Todas las tablas `prosop_*` viajan en el grupo de sincronización local `prosopography`;
eso no implica publicación en Server. Una bóveda `server_native` autenticada puede
gestionar sólo su allowlist explícita de personas, perfiles, fuentes/segmentos,
organizaciones y vínculos de red. Una bóveda `desktop_published` nunca copia esas
filas: sólo publica agregados `prosopography-public-*`, sin nombres, citas, nodos,
aristas ni resolución de identidad. Factoids, statements, pertenencias, hipótesis,
capturas y propuestas siguen siendo locales hasta disponer de contratos de dominio
con sus invariantes. `note_links` viaja con Notas. El backup normal de la bóveda
contiene el SQLite completo y sus adjuntos.

## Privacidad y accesibilidad

Las variables tienen sensibilidad ordinaria, sensible o restringida. Las personas mantienen estado de privacidad. Los datos restringidos no deben enviarse a IA ni exportarse sin una decisión explícita. Las vistas ofrecen modo claro/oscuro, estructura semántica, estados con texto además de color, tablas alternativas a gráficos y navegación por teclado.
