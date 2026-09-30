# Backup, recovery and synchronization decisions

Status: implemented safeguards, checked on 2026-09-30. This replaces the completed
backup audit and file-sync hardening proposal. Current code and regression suites
define the supported formats and behavior.

## Backup and restore

Backup encryption uses scrypt and AES-256-GCM in
[backupCrypto.ts](../../electron/export/backupCrypto.ts), with streaming support
for file operations. Automatic backups write a temporary file and rename it into
place, authenticate/decrypt the committed result, and only then prune older
copies. Verification failures preserve earlier backups. The expensive validation
runs in a disposable utility process. See
[autoBackup.ts](../../electron/export/autoBackup.ts),
[backup utility host](../../electron/export/backupUtilityHost.ts), and
[verification core](../../electron/export/backupVerificationCore.ts).

Vault restoration stages replacement data before replacing the live database.
Keep local paths and credentials subject to their explicit portability policies;
restoring another machine's absolute Zotero storage path is not valid recovery.
Auxiliary files and settings have explicit inclusion/filtering rules in
[exportImport.ts](../../electron/export/exportImport.ts). Do not replace those
rules with a blanket copy of the application profile.

The [backup vault](../../scripts/test-backup-vaults.mjs),
[streaming](../../scripts/test-backup-file-streaming.mjs), and
[automatic backup](../../scripts/test-auto-backup.mjs) suites exercise these
boundaries with temporary data and failure cases.

## Portable file synchronization

[syncPackage.ts](../../electron/export/syncPackage.ts) writes encrypted format-v3
`.nodussync` packages and retains import compatibility for formats v1/v2. It
derives the key once, encrypts individual table/blob entries, and hides table
names in an encrypted index. The clear manifest carries format/schema metadata,
allowing an incompatible newer schema to be rejected before decryption.

The sync passphrase has its own lifecycle. Do not couple it to an automatically
regenerated backup master password. Table coverage and portable identity are
defined by [syncTables.ts](../../electron/db/syncTables.ts) and the package's
normalization/identity rules.

Deletions travel as tombstones. Trigger and merge handling must distinguish a real
deletion from delete/reinsert saves, merge cleanup and restoration. Superseded
rows preserve overwritten or remotely deleted work; this recovery history stays
local, deduplicates entries, and does not duplicate BLOB payloads. Restoring a
saved version is itself a new change. See
[syncSupersededRepo.ts](../../electron/db/syncSupersededRepo.ts),
[tombstone tests](../../scripts/test-tombstones.mjs),
[superseded-version tests](../../scripts/test-superseded-versions.mjs) and
[package tests](../../scripts/test-sync-package.mjs).

File packages retain their explicit age/clock warnings. A one-way old package
cannot distinguish an old export from a sender whose wall clock is behind.
Do not claim a clock offset was measured without such evidence.

## Operation-based replication

The current application also has an operation journal and HLC-based ordering for
replication. Its contract is in [syncOperations.ts](../../shared/syncOperations.ts)
and its application is covered by
[HLC](../../scripts/test-sync-hlc.mjs) and
[convergence](../../scripts/test-sync-convergence.mjs) tests. The retired plan's
statement that logical clocks are only a future idea no longer describes this
path. Keep file-package format compatibility and operation-stream semantics
explicit when changing either implementation.
