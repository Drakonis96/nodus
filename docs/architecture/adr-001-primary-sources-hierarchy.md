# ADR-001: Jerarquía archivística canónica y colecciones de trabajo

- Estado: aceptada
- Fecha: 2026-07-29
- Ámbito: vault `primary_sources`

## Contexto

El Archivo heredado usa carpetas personales. Una fuente primaria, además, necesita
representar repositorio, fondo, serie, expediente y unidad documental sin convertir
esa procedencia en una clasificación temática.

## Decisión

`archive_description_units` será la fuente canónica de procedencia y orden original.
Forma un árbol multinivel, admite niveles omitidos y niveles locales, y conserva
código, título, fecha humana, límites normalizados, creador, historia custodial y
posición. `archive_item_units` enlaza el registro compatible `archive_items` con una
o varias unidades. Cada fuente nueva tendrá una unidad principal, aunque sea
provisional y declare que la procedencia está incompleta.

Las carpetas, etiquetas y búsquedas guardadas se presentan como Colecciones de
trabajo. Son muchos-a-muchos, reversibles y nunca participan en la cita archivística.

Mover una unidad es una edición auditada de procedencia. El repositorio impide ciclos,
padres inexistentes y borrado implícito de descendientes. Añadir una colección no
requiere esa confirmación.

## Consecuencias

- `archive_items` se mantiene para compatibilidad, pero sus campos de procedencia son
  una proyección; las pantallas no escriben ambas capas.
- Referencias parciales duplicadas pueden permitirse por repositorio.
- El árbol y las colecciones deben tener terminología y aspecto distintos.
- Backup, sincronización, borrado y restauración incluyen ambas estructuras.
