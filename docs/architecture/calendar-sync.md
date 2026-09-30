# Calendar integration decisions

Status: implemented Desktop behavior, checked on 2026-09-30. This replaces the
research document's delivered implementation and discarded OAuth-first proposal.

Study and Teaching calendars retain their own vault events. Outlook integration
exports iCalendar files for manual import; Google retains its manual event form.
Automatic synchronization is the macOS Apple Calendar integration. The current
implementation does not register Google/Microsoft OAuth clients or run a hosted
calendar synchronization service.

Apple destinations are editable local/iCloud calendars, excluding Google,
Exchange and other provider-backed calendars exposed through EventKit. Access is
requested from the user's calendar-selection action. The native bridge is built
by [build-apple-calendar.cjs](../../scripts/build-apple-calendar.cjs), with typed
contracts in [appleCalendar.ts](../../shared/appleCalendar.ts) and the application
bridge in [appleCalendarBridge.ts](../../electron/calendar/appleCalendarBridge.ts).

Synchronization projects Nodus events into the chosen Apple calendar. It does not
import remote edits into Nodus, and it runs while Nodus is open. Existing vault
events are included on activation. Disabling preserves remote copies; changing
destinations preserves copies in the previous destination.

Identity mappings, fingerprints and pending write intentions are stored per vault
and calendar under the local application profile, outside shared vault tables.
Intent is persisted before a native write, so retries can recover an interrupted
acknowledgment without creating another event. State writes are atomic and use
restricted permissions. Corrupt/unwritable state stops writes rather than
silently discarding identity mappings.

Native errors retain pending operations with progressive retry delays. An
inaccessible vault is not an empty calendar; errors and lost permissions must not
be interpreted as requests to delete remote events. See
[core projection](../../electron/calendar/appleCalendarCore.ts),
[persistent state](../../electron/calendar/appleCalendarState.ts) and
[synchronization](../../electron/calendar/appleCalendarSync.ts).

The [calendar integration tests](../../scripts/test-calendar-integrations.mjs)
cover exports, adapter/state behavior and recovery using test doubles. They do
not establish permission behavior, iCloud latency or interoperability with a real
external account; those remain manual integration checks on a throwaway calendar.
