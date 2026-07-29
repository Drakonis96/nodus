# Backup and recovery audit

Date: 2026-07-19 · Base branch: `claude/backup-recovery-audit-9727f4` · Scheme: v87

> ** Status: CORREGIDO.** The three blocks have been implemented and verified
> (531/531 tests, build and smoke e2e with the actual app on scheme v87).
> correction was also verified * temporarily neutralizing* to confirm that its
> test detects it; the detail is in "Verification" at the end. The original diagnosis
> it is preserved in its entirety because it explains why the code is as it is now.

Scope: `.nodus` (automatic and manual encrypted copy), restoration, life cycle of credentials, and
`.nodussync` (inter-team transfer).Rectoral question: **Can a vault become unrecoverable, and what
fails to change the device?**

---

## Executive summary

The cryptographic design and data model are solid. Failures are not in encryption: they are in **the
atomity of restoration**, in **the silence of failures** and, above all, in that **`.nodussync`
promises a transfer between teams that does not comply**.

Three conclusions:

1. There are two routes through which a vault is destroyed ** with no possibility of going back**.
2. There are at least five routes by which ** copies stop being done in silence**, while the
   interface continues to show the last correct state. It is the worst possible failure in a backup
   system: false security.
3. `.nodussync` **does not carry the teacher's notes, the writing workshop or the entire
   genealogical layer**, and may be permanently broken by a clash of academic year names that the
   app invites to provoke.

---

## What's right (don't touch)

- **Crypt**: AES-256-GCM + scrypt (N=32768, 64 MB), IV and random salt per copy, hash SHA-256 of
  clear text and encryption verified in restoration (`backupCrypto.ts:88-108`).
- **Independent recovery key** (format v6): the payload is encrypted with a stable key and that key
  is wrapped with the password. Changing the password does not invalidate old copies, because the
  recovery key continues to open the payload directly (`exportImport.ts:405-425`).
- **Reexportable Recovery Kit** from Settings with both credentials (`ipc.ts:3227-3262`), not only
  once in the wizard.
- **Multi-boved restoration "merge-safe"**: validates everything in time before touching anything,
  and never deletes local vaults missing from the file (`exportImport.ts:511-556`).
- **Assembly as BLOB in SQLite**, not as routes: evidence, portraits, materials, recordings and
  database attachments travel in copy. Deliberate and correct decision (`migrations.ts:1100-1103`).
- **The merge of `.nodussync` is atomic**: a single transaction, WAL. Killing the app in half
  reverses cleanly. There is no corruption possible out there.

---

## A. Routes by which a vault is irrecoverable

### A1 · The restore deletes the database before copying the new — CRITICAL

`vaultRegistry.ts:272-273`:

```ts
removeSqliteDatabaseFiles(record.path);   // deletes .sqlite, -wal, -shm
fs.copyFileSync(sourceFile, record.path); // and now copy
```

Between these two lines the vault does not exist. If `copyFileSync` fails at half-write (full disk,
unassembled volume, cut of light), there is a truncated file where there was a vault.

The safety net does not cover this case. `restoreBackupArchiveSafely` makes a previous copy and, if
something fails, reverses — but **the reversal uses exactly the same non-atomic path**
(`exportImport.ts:352`), and the previous backup is written in `userData/restore-safety/`, **on the
same disk that is failing** (`exportImport.ts:332`). `ENOSPC`. `ENOSPC` fails for the same reason as
the accident. With several vaults, the already restored ones look good and the one that failed is
lost.

- **Fix**: copy to `<destino>.tmp` in the same directory and `rename()` above. The rename is atomic
  in the same file system and removes the entire window.
- **Test coverage**: none. `test-backup-vaults.mjs` only proves the wrong happy path and password;
  `restoreBackupArchiveSafely` is never exercised.

### A2 · No single instance block — CRITICAL

`grep -rn "requestSingleInstanceLock" electron/` does not return anything.

Two instances of Nodus open on the same vault is a scenario that the app does not prevent. If one
restores while the other has the DB open, the first deletes the file and the second continues to
write on an already unlinked inode: its changes are lost and the WAL can be desyncronized from the
new file. The two instances can also launch simultaneous automatic copies on the same vaults.

This already appeared in previous audits (genealogy, MCP). Here it is more serious because the
operation at stake is destructive by design.

### A3 · `.nodussync` replaces entire databases — CRITICAL

`databasesRepo.ts:1088-1091`:

```ts
db.prepare('DELETE FROM db_databases WHERE id = ?').run(unit.database.id); // All children shells
```

The conflict unit is **the entire database**; the editing unit is **a cell**. `updated_at` is
touched on any mutation (`databasesRepo.ts:462-463`, 12 callers).

> Team A adds a row at 10:00. Team B had added fifty to the
> 09:00. The package of A is imported into B → wins A → **50 rows of B, its
> cells and their attachments are deleted**. The summary reports `databases: {updated: 1}`.

The test is explicitly good (`test-sync-package.mjs:216`, `'stale B row replaced away'`). It is not
a limit case: it is normal use on two computers.

---

## B. Copies that stop silently

This block is, on the whole, more dangerous than A: the user believes he is protected.

### B1 · If the master password cannot be read, no error is recorded

`autoBackup.ts:225-226`:

```ts
if (!settings.autoBackupFolder || !getBackupPassword()) return null;
```

`getBackupPassword()` returns `null` also when the file exists but `safeStorage` cannot be decrypted
(`secretStore.ts:70-81`): session password change, migration with Migration Assistant, recreated
keychain. In that case `maybeRunAutoBackup` comes out by `return null` **without writing
`lastAutoBackupStatus`**.

Result: `lastAutoBackupAt` and `lastAutoBackupStatus` remain frozen in the last success. The
interface continues to show *«12/01/2026 · ok: Copy saved in...»* for months while not a single copy
is made.

### B2 · Unreadable API key aborts all copies

`exportImport.ts:215-218`: if `lockedApiKeyProviders()` is not empty, `createBackupArchive` throws.
That is, an API keypad that the keychain can no longer decrypt **blocks the copy of the entire
library**. The intention (not to lose keys silently) is reasonable, but the price is
disproportionate: the copy of the entire corpus is sacrificed to protect a credential that the user
can re-paste in thirty seconds. It should warn and continue without that key.

### B3 · It is never verified that a written copy can be decrypted, and the above are pruned

`runAutoBackupNow` writes the file and then calls `pruneBackups` (`autoBackup.ts:208-210`). There is
no verification that the newly written `.nodus` can be opened with the credential that the user has.
If the keychain password is broken or corrupted, the new copies are encrypted with something that
the user does not know and the pruning erases the old ones, which were recoverable.

The initial wizard check (`recoveryManager.ts:194`) only reads the manifest in clear; ** does not
decipher**.

- **Minimum Arrangement**: After writing, re-opening the file and decrypting only
  `payload-manifest.json`. It is cheap and converts the copy to verified. And prune only if that
  verification happens.

### B4 · The health of copies is not shown anywhere visible

The only indicator for the entire system is a truncated `<span>` grey `neutral-500` within a folding
section of Settings (`Settings.tsx:1199-1204`). There is no:

- seniority notice (‘your last copy is 47 days’),
- warning when `recoveryStatus.folder.kind === 'missing'` — is calculated (`recoveryManager.ts:138`)
  and ** is not used at all** except to open the wizard,
- notification on failure: `main.ts:458` only makes `console.log`.

### B5 · All file is built in memory

`createBackupArchive` reads each entire BD to `Buffer`, puts them in a zip in memory, serializes it
to another `Buffer` and encrypts it to a third. With several large vaults (records, attachments,
portraits, all in BLOB) this is a multiple of the actual RAM size of the main process, every 30
minutes. After a certain threshold — one single BD above 2 GB breaks `readFileSync` — **the copies
cease to function forever** with an error that is not shown anywhere (see B1/B4).

---

## C. Change of device: what is lost and what is broken

### C1 · `nodi-notes.json` is not in copy — REAL LOSS

`nodiNotes.ts:20` writes up to 500 user Markdown notes in `userData/nodi-notes.json`. The whitelist
of the copy (`exportImport.ts:99`) includes your brother file `nodi-chat-history.json` but **not
this**. They are lost without notice.

It's in your actual installation, modified on July 18. It's an omission, not a decision: the two
files write almost identical code. The arrangement is to add the name to `GLOBAL_AUXILIARY_FILES`;
the restore generically already treats any name in that list (`exportImport.ts:598-602`), so that's
what both addresses work with.

### C2 · `zoteroStoragePath` travels with the absolute route of the other team — BREAK THE CORPUS

`zoteroStoragePath` lives in the row `settings` of the DB (`settingsRepo.ts:96`), not in
`app-prefs.json`. The row of settings **yes** goes in the copy: `scrubSettings` only removes
`mcpToken` and `providerKeys` (`exportImport.ts:632-638`).

When restoring on another Mac with another user, the vault is pointing to
`/Users/nombre-antiguo/Zotero/storage`. Everything that solves PDFs per disk fails silently
(`textExtractor.ts:560-566`): rescan, OCR, new extraction, open per page. Text already extracted and
embeddings survive, so **is not lost, it is blindness**. The `defaultZoteroStorage()` backup only
acts if the string is empty: an obsolete path is worse than none.

What is striking is that the code ** already knows this danger** and defends it for `app-prefs.json`
(`exportImport.ts:580-585`, «Absolute folder paths ... belong to this machine»). Only the same
criterion needs to be applied to `zoteroStoragePath` and `toolkitOutputDir` in the row of the DB.

### C3 · Other items not included

| Element | Effect |
|---|---|
| `audio_key_*.bin` (Hume TTS) | It is lost; it must be reintroduced. Easy to correct omission. |
| `backup_password.bin`, `backup_recovery_key.bin` | Right to exclude them (they are linked to `safeStorage`), but after restoring **the protection is disabled** without notice. |
| `local-ai/`, `whisper.cpp/models/`, `tessdata/` | Downloads of several GB to repeat. Correct to exclude them. |
| `~/.nodus-copilot-certs/`, Word manifest | Outside `userData`. Reinstall the plugin and re-trust the CA. |
| `codex-subscription/`, `github-copilot-subscription/` | Reauthentication. |

None of these justifies changing the format, but yes **a post-restore checklist**, which does not
exist today.

---

## D. `.nodussync`: the transfer between teams does not fulfil what it promises

It is the weakest part of the system and the worst communicating its limits.

### D1 · Whole modules that are never synchronized

The coverage is dynamic only for `study_*` (`syncPackage.ts:193-196`, `LIKE 'study\_%'`). Everything
else is lists of handwritten columns.

- **Full teaching**: `teaching_groups`, `teaching_students`, `teaching_assessment_plans`,
  `teaching_assessment_items`, `teaching_grade_entries`, `teaching_rubrics`,
  `teaching_rubric_evaluations`, `teaching_exams`, `teaching_exam_questions`, `teaching_logos`.
  (`grep -c "teaching_" syncPackage.ts` → **0**)
- **Writer workshop**: `projects`, `project_sections`, `project_chapters`,
  `project_chapter_versions`, `project_chapter_ideas`, ...
- ** Genealogy and archive**: `persons`, `person_names`, `person_portraits`, `places`, `events`,
  `relationships`, `evidence`, `archive_items`, `archive_folders`, `kinship_suggestions`,
  `social_contacts`, ...
- **Research map**, chats, translations, decorative images, `match_feedback`.

The case of teaching is the most misleading: `teaching_exams.course_id` reference
`study_courses(id)` (`migrations.ts:2784`), which **does** sync. A teacher synchronizes home ↔ school,
sees `study: {inserted: 200}` and concludes that the grade book has traveled. No note has done so.
`SyncMergeSummary` (`shared/types.ts:2412-2421`) does not even have a teaching counter where a zero
could be seen.

### D2 · A duplicate academic year breaks synchronization forever — CRITICAL

`migrations.ts:2731`: `CREATE UNIQUE INDEX idx_study_academic_years_label ON
study_academic_years(label);`

`createStudyAcademicYear` deduplicates by tag **in local only** and generates a new UUID.
`normalizeAcademicYearLabel` canonicalizes the string, so the two teams produce `"2024/2025"` byte
to identical byte with different ids.

> 2024/2025 is created on laptop. 2024/2025 is created on desktop — which is the only thing
> When syncing, the id is unknown, the branch is taken.
> `INSERT` (`syncPackage.ts:251-255`) and jump
> `UNIQUE constraint failed: study_academic_years.label`.

As merge is a single transaction, ** everything is reversed**: notes, drafts, databases, the rest of
study tables. And it will again fail in the same row in each future attempt, **in both directions**.
The user sees a raw string of SQLite, without knowing what entity causes it or that renaming a
course would fix it.

Since the module revolves around the academic year, this is not unlikely: it is almost inevitable.
(Minor variant with `db_databases.short_id`, 4 characters, local only collision check: ~1 between
400 and 50 bases per team.)

### D3 · No tombstones: the deleted resuscitates

Explicit by design (`syncPackage.ts:16-17`). Notes and folders are deleted in hard
(`notesRepo.ts:184`, `:242`), so when importing any package prior to erasing the `INSERT` branch, it
revives them with its original time marks — and it will continue to do so at every sync. **There is
no way to permanently delete anything between two computers.** Partial and correct exception: study
entities use soft deletion (`studyOrgRepo.ts:661-675`), so there it does spread.

### D4 · `schemaVersion` is decorative

It is written in the manifest (`syncPackage.ts:123`) and **never compared**: validation only looks
at `format` and `formatVersion` (`syncPackage.ts:152-154`), a fixed `1` that has never been raised
despite changing the form of payload.

The dangerous case is a new package → old app: the unknown columns are filtered and ** are quietly
discarded** (`syncPackage.ts:245`); the truncated row retains the new `updated_at`, so when syncing
back **propagates truncation to the computer that was up to date**. Data destruction without a
single error along the way.

### D5 · The package is not encrypted

Flat Zip with `user-layer.json` in clear: note bodies, study documents, recordings and attachments
in base64. Live in Settings with the master password encrypted copy, without any warning about the
asymmetry. Whoever moves it by Dropbox or mail is exposing its entire writing layer.

### D6 · Test validates a scheme that is not distributed

`test-sync-package.mjs` constructs a synthetic scheme of 20 tables by hand instead of
`runMigrations`, and stubea `SCHEMA_VERSION = 28`. Therefore, it does not detect any of the above:
in its scheme there is no single academic year index, nor `teaching_*`, nor `db_attachments.thumb`,
nor `note_folders.summary`. The assertions are correct; the scheme against which it makes them, no.

---

## Priorities

**Now (destruction or false security)**

1. A1 — `rename()` atomic in `restoreVaultDatabase`. Three-line change.
2. B1 — record `lastAutoBackupStatus` also when released by unreadable credential.
3. B3 — verify the decryption of the newly written file **before** pruning.
4. D2 — resolve the shock of `label` by `id` on the merge (or dedupe per label) and isolate each
   table so that a bug does not reverse the entire package.
5. C1 — add `nodi-notes.json` to `GLOBAL_AUXILIARY_FILES`.

**Next (sync integrity and honesty)**

6. D1 — either expands coverage, or the interface explicitly states what travels. What cannot be
   sustained is a summary that does not mention what is missing.
7. C2 — do not restore `zoteroStoragePath` from another computer (same criterion as
   `RECOVERY_PREF_KEYS`).
8. B4 — Age and folder warning inaccessible outside Settings.
9. A2 — `requestSingleInstanceLock()`.
10. B2 — degrade key-blocked abortion on notice.

**Structural debt**

11. D6 — that the sync test runs `runMigrations` on the actual schema.
12. D5 — Encrypt `.nodussync` or warn clearly.
13. B5 — streaming on file construction.
14. D3/D4 — tombstones and actual check of `schemaVersion`.

---

---

## Verification of corrections

A passing test proves nothing if it would also pass without correction. Each critical warranty was
checked by temporarily deactivating the arrangement and confirming that your test fails:

| Corrigendum | By deactivating it, the test fails with |
|---|---|
| A1 · atomic restoration | `the vault database still exists after a failed restore` → **`actual: false`**: with the old code the vault ** ceases to exist**. It reproduces by injecting a `ENOSPC` into the copy (a read-only directory does NOT work: it also blocks the deletion, and the vault is saved by accident). |
| C2 · local routes | The path `/Users/equipo-origen/Zotero/storage` is filtered to the target computer. |
| D2 · Bricking per duplicate course | Jump `UNIQUE constraint failed: study_academic_years.label` — but **no longer aborts fusion**: it is reported and continues. Two independent layers. |
| Cells without time-marking | `an edited cell reaches the other machine via its row timestamp`: an edited cell did not travel. |

Three real failures appeared *during* implementation, not in diagnosis:

1. `new AdmZip()` release exception with a truncated `.nodus` instead of returning error — also
   affected the restore, not only the verification.
2. `study_schedule_day_styles` has no primary key and its unique index is about an expression that
   SQLite cannot describe: the colors of the schedule would never have been synchronized. Hence
   `IDENTITY_OVERRIDES` and the guard `unmergeable` in the test.
3. The relation verdicts are about an unordered pair**; the generic engine duplicated them and the
   two machines would have disagreed forever. Hence `ROW_NORMALIZERS`.

And a risk that I introduced and closed: the sweep of foreign keys could erase existing and
inconsistent local rows. Now you can only delete rows that **that same merge** has inserted, and is
limited to touched tables.

### What has NOT been deliberately done

- **Tombstones.** The deleted ones still do not spread: delete a note on one computer and
  synchronize from the other it resurrects it. It is the previous behavior, now extended to new
  modules. It requires own design (deleted marks with expiration) and did not enter into this order.
- **Cift of `.nodussync`.** It is still a clear zip. It is no longer a single giant JSON, so the
  size limit is gone, but the content is not protected.
- **Watch bias.** The winner continues to decide for wall `updated_at`. A computer with the clock
  behind keeps losing always, although now at least the unapplied rows are reported.

---

## Personally verified

`nodi-notes.json` outside the white list · `zoteroStoragePath` absent from `GLOBAL_PREF_KEYS` ·
`idx_study_academic_years_label` · `teaching_` with 0 appearances in `syncPackage.ts` · `DELETE FROM
db_databases` in replacement · `schemaVersion` not compared in import · `removeSqliteDatabaseFiles`
followed by `copyFileSync` · `requestSingleInstanceLock` missing · copy status as the only indicator
in `Settings.tsx`.

No code files have been modified.
