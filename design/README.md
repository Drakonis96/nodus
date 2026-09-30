# Design directory

The repository's current decisions are indexed in
[docs/architecture/](../docs/architecture/README.md). This directory retains the retirement inventory and a compatibility pointer
for a source comment; neither is an implementation roadmap.

## Retired implementation documents

Reviewed against the linked current implementation and regression suites on
2026-09-30. Removal applies to the historical documents, not their implemented
features. Git history retains the original plans and dated evaluation results.

| Former document | Reason | Current decisions/evidence |
| --- | --- | --- |
| `backup-recovery-audit.md` | Completed audit; original diagnosis and deferred-debt claims no longer describe current backup safeguards. | [Backup and sync](../docs/architecture/backup-and-sync.md) |
| `sync-hardening-phase2.md` | File hardening delivered; operation replication also implements the HLC ordering once described as future work. | [Backup and sync](../docs/architecture/backup-and-sync.md) |
| `calendar-sync-research.md` | Delivered Apple/ICS integration supersedes the researched Google/Outlook OAuth-first roadmap. | [Calendars](../docs/architecture/calendar-sync.md) |
| `local-extraction-and-free-tier-plan.md` | Replaced by the implemented capability matrix and provider request/quota policies; dated benchmarks are not current guarantees. | [Local AI policy](../docs/architecture/local-ai-model-policy.md) |
| `nodus-apps-prompt-evaluation.md` | Completed historical provider evaluation; retain the runtime/validation decisions rather than dated model rankings and prices. | [App Studio](../docs/architecture/toolkit.md#app-studio) |
| `nodus-toolkit-plan.md` | Convert and the expanded Toolkit are implemented; old placeholder cards and proposed worker layout are obsolete. A short compatibility pointer remains for an existing source comment. | [Toolkit](../docs/architecture/toolkit.md) |
| `nodus-protect-parity-v0.4.1.md` | Acceptance matrix remains useful; moved out of the plan directory rather than discarded. | [Protect parity matrix](../docs/architecture/toolkit-protect-parity.md) |
| `pdf-presenter-plan.md` | Presenter library, windows, state, conversion and controller already have implementation and tests; the pending-code status is obsolete. | [Presenter](../docs/architecture/toolkit.md#pdf-presenter) |
| `prosopography-domain-adr.md` | Accepted domain decisions remain current; moved into the architecture collection. | [Prosopography](../docs/architecture/prosopography-domain.md) |
| `worldbuilding-characters-plan.md` | Implemented characters/calendar/groups/scenes supersede the phase handoff and pending W2–W4 list. | [Worldbuilding](../docs/architecture/worldbuilding-domain.md) |
| `worldbuilding-families-plan.md` | Proposed separate family schema was superseded by the current kinship and house-group/dynasty destinations. | [Characters and groups](../docs/architecture/worldbuilding-domain.md#characters-kinship-and-groups) |
| `worldbuilding-collections-plan.md` | Collections/filtering delivered; claimed absent demo, tour and analysis/manuscript sections are now implemented. | [Worldbuilding](../docs/architecture/worldbuilding-domain.md) |
| `worldbuilding-maps-plan.md` | Completed maps/presence implementation; retain normalized geometry and derived presence decisions. | [Maps and presence](../docs/architecture/worldbuilding-domain.md#maps-and-presence) |
| `worldbuilding-analyze-plan.md` | Analysis sections implemented; a migration-99 phase report is no longer the current roadmap. | [Analysis and manuscripts](../docs/architecture/worldbuilding-domain.md#analysis-and-manuscripts) |
| `worldbuilding-manuscript-plan.md` | Completed scene-based manuscripts and book/chapter runs; preserve their single ordering model. | [Analysis and manuscripts](../docs/architecture/worldbuilding-domain.md#analysis-and-manuscripts) |
