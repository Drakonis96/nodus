# Architecture decisions

These documents describe accepted boundaries and implemented domain rules. The
linked code and regression suites are the references for current behavior;
historical implementation-phase counts are not release requirements.

| Area | Decision record |
| --- | --- |
| Primary sources | [Domain overview](primary-sources-domain.md), [hierarchy](adr-001-primary-sources-hierarchy.md), [files](adr-002-primary-sources-files.md), [evidence](adr-003-primary-sources-evidence.md), [governance/export](adr-004-primary-sources-governance-export.md), [release/privacy](adr-005-primary-sources-release-privacy.md) |
| Capability plugins | [ADR-006: capability API v2](adr-006-capability-api-v2.md) |
| Browser connector | [Browser connector](browser-connector.md) |
| Worldbuilding | [Domain, maps, analysis and manuscripts](worldbuilding-domain.md) |
| Backup and synchronization | [Recovery safeguards, file packages and operation replication](backup-and-sync.md) |
| Calendars | [Implemented Desktop integrations](calendar-sync.md) |
| Local AI and quotas | [Capabilities and provider request policy](local-ai-model-policy.md) |
| Toolkit | [Convert, Presenter and App Studio](toolkit.md), [Protect acceptance matrix](toolkit-protect-parity.md) |
| Prosopography | [Accepted domain contract](prosopography-domain.md) |

Completed or superseded implementation plans were retired from `design/` after a
code comparison on 2026-09-30. The [retirement inventory](../../design/README.md)
records the replacement for each document. Existing ADRs remain in place.
