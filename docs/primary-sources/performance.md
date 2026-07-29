# Rendimiento

La prueba reproducible es
`node scripts/test-primary-sources-performance.mjs`.

## Corpus de referencia

- Pequeño: 100 unidades y 500 archivos/páginas.
- Medio: 10.000 unidades y 50.000 páginas.
- Grande: 100.000 unidades de metadatos y un subconjunto de 50.000 archivos.

Los datos son sintéticos, locales y deterministas. La prueba crea una base
nueva, ejecuta migraciones, inserta los tres tamaños en transacciones y termina
con comprobaciones de claves externas e integridad SQLite.

## Presupuestos exigidos

En el corpus medio:

- lista inicial menor de 1,5 s;
- filtro de metadatos menor de 300 ms;
- dossier menor de 500 ms;
- búsqueda textual habitual menor de 1 s.

El corpus grande demuestra que la lista conserva una página de 200 resultados,
no materializa más de 2.000 nodos de contexto y entrega menos de 5 MB.

La consulta del listado no selecciona `content_blob`, `archive_items.blob`,
`extracted_text` ni el contenido de versiones textuales. Los archivos se
representan mediante conteos y `has_content`; el dossier tampoco carga bytes.
La miniatura y el visor los solicitan de forma independiente.

## Resultado de referencia

La ejecución del 29 de julio de 2026 en el entorno de desarrollo produjo:

| Operación | Tiempo |
|---|---:|
| Lista inicial, medio | 17,1 ms |
| Filtro de metadatos, medio | 11,9 ms |
| Dossier, medio | 10,7 ms |
| Búsqueda textual, medio | 211,9 ms |
| Lista inicial, grande | 130,7 ms |

Son medidas orientativas, no una promesa para cualquier equipo. La prueba falla
si el corpus medio rebasa un presupuesto.
