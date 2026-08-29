# Auditoría Server Web: worldbuilding y genealogía

## Alcance verificable

La prueba `scripts/e2e-server-web-worldbuilding-genealogy.mjs` arranca un
Server temporal con `withServer`, publica dos snapshots sintéticos y autentica
un lector. No usa el Nodus del desarrollador ni el puerto `:7443`, y elimina el
directorio de datos temporal al terminar.

Última ejecución (28-08-2026):

```text
worldbuilding/genealogy matrix passed: 30 routes, 11 reloadable details
```

Se comprobaron ambos temas, ausencia de overflow horizontal a 390 px, estados
de carga/error, navegación a las 30 rutas y recarga de once dossiers. El
manifiesto y las capturas se escriben en `reports/server-web-qa/worldbuilding-genealogy/`
(ruta ignorada por Git).

## Matriz honesta

| Familia | Superficies cubiertas | Resultado observable | Límite que permanece |
| --- | --- | --- | --- |
| Genealogía | Inicio, Personas, Línea temporal, Mapa, Árbol genealógico, Archivo, Notas | Catálogos publicados, dossier de persona y fuente, mapa por coordenadas publicadas; cronología con los filtros Desktop de persona/tipo y participantes; árbol con geometría canónica, búsqueda, foco, orientación, zoom, arrastre, retratos, colores/visibilidad de ramas y detalles anidados recargables | La edición del árbol/vault y los originales que sólo existen en disco siguen siendo operaciones locales de Desktop |
| Genealogía | Relaciones sociales | La ruta existe y muestra el estado privado exacto | El grafo social Desktop no se publica porque sus tablas permanecen fuera del snapshot |
| Worldbuilding | Inicio, Enciclopedia, Personajes, Lugares, Facciones, Culturas, Dinastías, Cronología, Mapas, Familias, Reglas, Conflictos, Arcos, Continuidad, Preguntas, Escenas, Manuscrito, Notas | 19 rutas navegables; proyecciones de enciclopedia, jerarquía de lugares, facetas de grupos y dossiers publicados; cronología con fechas mundiales y filtros de personas/tipo; reglas con facetas de dureza/estado/salud; preguntas con origen, bloqueo, ancla y opciones; conflictos con tablero/lista; manuscrito con texto sólo al abrir una escena; detalles de personaje, lugar, grupo, enciclopedia, escena y mapa recargables | Server conserva el workbench publicado en modo lectura; generar mapas, editar escenas o persistir cálculos de continuidad sigue siendo una mutación del vault reservada a Desktop. Continuidad sólo muestra avisos estructurales derivables del snapshot y no los silencia ni los escribe |
| Worldbuilding | Relaciones | La ruta existe y muestra el estado privado exacto | El grafo social no se publica; no debe aliasarse a vínculos familiares |

El resultado demuestra paridad de navegación y presentación para la proyección
publicada de estas dos familias. No autoriza mutaciones del vault ni convierte
datos locales/privados en contenido publicable.

## Reproducir

```bash
npm run build:server-web
node scripts/e2e-server-web-worldbuilding-genealogy.mjs
```

El fixture del mapa worldbuilding no contiene imagen: el resultado esperado es
un mapa vacío legible, sin marcador fabricado ni error de consola. Las
relaciones sociales tienen un estado privado explícito y no se consideran una
superficie publicada.
