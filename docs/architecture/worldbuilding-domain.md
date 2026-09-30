# Worldbuilding domain decisions

Status: implemented decisions, checked against the linked modules on 2026-09-30.
This replaces the completed character, collections, maps, analysis and manuscript
plans and the superseded family-table proposal. Historical phase numbers, schema
snapshots and one-off test counts are not current acceptance criteria.

## Characters, kinship and groups

Worldbuilding reuses people and kinship infrastructure, with fiction-specific
fields and vocabulary in [charactersRepo.ts](../../electron/db/charactersRepo.ts)
and [shared types](../../shared/types.ts). Preserve a character's own gender,
species and world chronology rather than deriving them from genealogy's sex/date
fields. The [world calendar](../../shared/worldCalendar.ts) supplies its own day
arithmetic.

Families and dynasties are distinct destinations. Families use the existing
kinship tree. Dynasties are `world_groups` of kind `house`, alongside other group
kinds, with emblems and editable lineage metadata. Affiliations carry temporal
membership/rank; the old proposed `character_families` schema is not the current
model. `TreeFamily` remains a rendering unit for a pair and children, not a house.
See [group persistence](../../electron/db/worldGroupsRepo.ts),
[group views](../../src/views/GroupsView.tsx),
[tree families](../../shared/treeFamilies.ts) and the
[dynasty contract tests](../../scripts/test-world-dynasties-ui.mjs).

Collections and place hierarchies use reusable facet filtering and explicit
containment rules. Keep the pure behavior in
[worldFilters.ts](../../shared/worldFilters.ts), with persistence in
[worldPlacesRepo.ts](../../electron/db/worldPlacesRepo.ts). The
[collections tests](../../scripts/test-world-collections.mjs) exercise combining
search with facets, clearing filters and place-kind semantics.

## Maps and presence

A map is a canvas that can link to a place; it does not replace the place entity.
Store geometry in normalized image coordinates, independent of display size.
Calibration, projection, units and child-map footprints determine measurements;
missing calibration must not fabricate physical distances. Keep these operations
in [worldMapGeometry.ts](../../shared/worldMapGeometry.ts), with storage in
[worldMapsRepo.ts](../../electron/db/worldMapsRepo.ts).

Character presence is derived from scenes, events and residences. A separate
position table would duplicate those sources. Undated residences are background
information and cannot generate interpolated journeys. Dated sources use world
days, or world-year/order keys when no calendar exists. Map dragging records an
event. Timeline movement, encounters and impossible-journey checks use the same
[worldPresence.ts](../../shared/worldPresence.ts) model and
[presence repository](../../electron/db/worldPresenceRepo.ts).

Keep geometric correctness separate from provider capabilities and image
generation. Pure geometry/presence tests complement
[maps integration tests](../../scripts/test-world-maps.mjs) and
[map UI checks](../../scripts/test-world-maps-ui.mjs).

## Analysis and manuscripts

Rules, continuity, narrative threads and open questions are stored domain data,
not inert sidebar destinations. Derived findings share explicit severity,
stable identity and mute handling through
[worldFindings.ts](../../shared/worldFindings.ts). See
[rules](../../electron/db/worldRulesRepo.ts),
[continuity](../../electron/db/worldContinuityRepo.ts),
[threads](../../electron/db/worldThreadsRepo.ts),
[questions](../../electron/db/worldQuestionsRepo.ts), and
[analysis tests](../../scripts/test-world-analyze.mjs).

Manuscript text belongs to scenes. Chapters and books are contiguous runs of the
same narrative order, marked by their starting scene; a second manuscript order
or duplicate scene membership would disagree with the story and analysis lanes.
Compilation, word totals, cast checks and link-preserving editor conversions live
in [worldManuscript.ts](../../shared/worldManuscript.ts); persistence lives in
[worldManuscriptRepo.ts](../../electron/db/worldManuscriptRepo.ts).
See the [pure](../../scripts/test-world-manuscript.mjs) and
[database](../../scripts/test-world-manuscript-db.mjs) suites.

The [home](../../src/views/WorldbuildingHome.tsx),
[tour](../../src/views/WorldbuildingTour.tsx) and
[demo data](../../electron/db/worldbuildingDemoData.ts) are implemented. Old
handoff statements claiming that they or the analysis/manuscript sections are
absent should not be used as a roadmap.
