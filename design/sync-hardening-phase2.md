# Synchronization: deleted, encrypted and clocks

Design proposal · 2026-07-19 · continues `backup-recovery-audit.md`

The three points that were consciously left out of the first correction. They are not independent:
**The same mechanism that makes the erased secure makes the clock bias** safe, so it is appropriate
to decide them together.

---

## Guiding principle

Today the fusion is *newest-wins destructive*: the version that loses the comparison disappears
without leaving a trace. That is acceptable when the clocks match and nobody erases anything; it
ceases to be as soon as one of the two things fails.

The proposal is based on a single idea:

> **Let the merger stop destroying.** If every losing version is preserved and can
> recover, then a misplaced clock, a timeless erasing or a resolution
> They cease to be data loss and become a reviewable decision.

On that basis, the three problems become treatable without rewriting the app.

---

## 1 · Deleted (tombstones)

### Current behaviour

Notes, folders, searches, drafts, verdicts and databases are deleted hard. When importing any
package prior to deletion, the `INSERT` branch revives them with its original marks — and repeats it
in each synchronization, in both directions. **There is no way to permanently delete anything
between two computers.**

Study entities are the correct exception: they use `deleted_at`, so deletion is an update and
spreads itself.

### Proposed design

**A tablet board, powered by triggers.**

```sql
CREATE TABLE sync_tombstones (
  table_name TEXT NOT NULL,
  row_key    TEXT NOT NULL,          -- serialized identity key
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (table_name, row_key)
);
```

Triggers are generated ** from the recording of sync groups**, not by hand, in each opening of the
base (`ensureTombstoneTriggers()`). Thus a new table is covered by the same mechanism that already
forces to classify it, and there is no way to forget.

> Checked on the library using the app: a `DELETE` cascaded **yes** shoots the
> `AFTER DELETE` of the child tables, with and without `recursive_triggers`. The triggers, by
> so much, they also capture those erased by waterfall — there is no need to reason on trees.

**Full Rules** (last-writer-wins, treating the deleted as one more writing):

| Status | Outcome |
|---|---|
| An unknown row arrives and there is a tombstone with `deleted_at >= updated_at` | It was deleted after writing. |
| An unknown row arrives and there is a tombstone with `deleted_at < updated_at` | The tombstone is inserted and removed: the other computer edited it *after* the deletion, and that edition is the last word. |
| A newer tombstone arrives than the local row | The local row is deleted and the tombstone is saved. **The deleted row goes to `sync_superseded`** (§4): a remote deletion never destroys local work without return. |
| There comes a tombstone older than the local row | It is discarded: the row was edited after the other one deleted it. |

The tombstones travel in the package as one more table.

### The real problem: tombstone collection

A tombstone cannot live forever, and if it is collected before a team lags behind syncs, the row
resurrects. It is an inherent limitation to file synchronization, not an oversight.

Proposal: ** 180-day horizon**, and — this is important — when importing a package built more than
that horizon, ** explicitly warn** that old erasers can reappear. The limit ceases to be a silent
trap and becomes information.

---

## 2 · Encryption of `.nodussync`

### Current behaviour

Zip in clear. It contains bodies of notes, study papers, grades, genealogical evidence and
attachments. It lives in Settings with the copy encrypted by master password, without warning of
asymmetry.

### Proposed design

**Always Encrypt. No "unencrypted" box.** A clear convenience option is exactly the way these files
are filtered.

Reusing the already audited primitives of `backupCrypto.ts` (scrypt N=32768 + AES-256-GCM), with a
necessary change: **derivate the key once**, not per input. scrypt costs ~100 ms; applied to 500
entries would be almost a minute. `deriveBackupKey()` and `encryptWithKey()/decryptWithKey()` are
added to the existing module.

**Structure (format v3)** — preserves the property that fixed the size limit:

```
manifest.json     ← plaintext: format, version, date, schemaVersion, KDF parameters
index.bin         ← encrypted: which entry corresponds to each table and blob
<id opaco>        ← cifrado: IV(12) ‖ authTag(16) ‖ ciphertext, uno por tabla y por blob
```

Each entry is encrypted separately with its own IV. **There is no point at which the entire package
exists as a single buffer**, which is just what made it impossible to synchronize large vaults.
Table names live in `index.bin` encrypted, so the file does not reveal that it contains, for
example, ratings.

`schemaVersion` is out on purpose: it allows you to reject a package from a newer version ** without
asking for the password**, which is better experience and reveals nothing.

### The credential: here is the design decision

Manual export `.nodus` generates a random single-use key. **For sync that would be an error**: it is
a *recurrent* operation, and copying a new key on each export is abandoned the third time.

It is also useless to reuse the master copy password: after a recovery key restoration, Nodus **
generates a new, random master password**, so the two teams would have different credentials and the
sync would fail for no apparent reason.

Proposal: **a proper "sync" phrase**, which the user fixes once and writes on both computers. It is
saved with `safeStorage` like the others. Export is denied if it is not configured; import uses it
automatically and only asks if it does not decrypt. Explicit, stable, without attaching to the life
cycle of copies.

Compatibility: still **read** packages v1 and v2 in clear; only **write** v3.

---

## 3 · Watch bias

### Current behaviour

The winner is chosen by comparing `updated_at` as strings. A team with the back clock loses **all**
comparisons, always, silently, and the summary presents it as `skipped`, indistinguishable from
"already up to date".

### What can and cannot be detected

You should be honest: with one-way file packages ** you can't measure the clock lag**. A
three-day-old package can be a genuinely old package or a three-day-long clock; there's no way to
distinguish them without a round trip.

Yes it is detectable ** one** address, which is also the dangerous one:

- Package date or row marks **in the future** with respect to the local clock the transmitter clock
  is ahead. That team would win all comparisons.

The opposite direction (retarded transmitter) is indistinguishable from an old package.

### Proposed design: three layers

**Capa 1 — detect the detectable.** If the package or its rows come from the future, warn; if the
lag exceeds 24 h, require explicit confirmation before merging.

**Capa 2 — compare over a common time line.** When a consistent advance is detected, compensate
incoming marks for the time lag measured **only for comparison purposes**, without rewriting
anything, and record that it was made.

**Capa 3 — and this is the one that really solves the problem — never destroy the loser** (§4). Even
if a misplaced watch missolves a conflict, the version that loses is preserved and can be recovered.
Watch bias ceases to be data loss and becomes a suboptimal, reviewable resolution.

### The book alternative, and why I don't recommend it now

The correct thing in theory is logical clocks per row (Lamport/HLC): each writing increases a
counter and the comparison ceases to depend on the wall clock.

The actual cost in this code: **a new column in ~60 tables** and touch **all the write paths of ~70
repositories, because today each makes `updated_at = now()` on its own. It is a big, cross-sectional
change with a lot of regression surface, to solve a problem that layer 3 becomes harmless.

My recommendation is to make the three layers now and leave the logical clocks as later evolution:
**`sync_superseded` is precisely the basis on which they would be built**.

---

## 4 · The common piece: `sync_superseded`

```sql
CREATE TABLE sync_superseded (
  id            TEXT PRIMARY KEY,
  table_name    TEXT NOT NULL,
  row_key       TEXT NOT NULL,
  origin        TEXT NOT NULL,   -- 'incoming-lost' | 'local-overwritten' | 'deleted-remotely'
  row_json      TEXT NOT NULL,   -- row, no BLOB columns
  row_stamp     TEXT,
  winner_stamp  TEXT,
  package_date  TEXT,
  created_at    TEXT NOT NULL
);
```

It is written in **three** situations, and the second is the most important:

1. The incoming row loses and its content differs from the local one (`incoming-lost`).
2. The incoming row wins and **overwrites** different local work (`local-overwritten`) ← the case
   that today destroys user work without leaving a trace.
3. A remote headstone deletes a local row (`deleted-remotely`).

** Honest limitation:** the BLOB columns (attaches, recordings, portraits) are not saved. Duplicate
them would multiply the size of the base. For those columns the row and a marker are kept, not
bytes. Collection at 90 days.

**User surface:** in Settings → Synchronization, "N substituted versions", with view of detail and
action to restore. Without that view, the table is just comfort.

---

## Proposed phases

| Phase | Content | Risk |
|---|---|---|
| **F1** | `sync_superseded` + record in all three situations + view in Settings | It doesn't change any resolution, it just stops destroying. |
| **F2** | Tombstones: table, triggers generated, fusion rules, horizon and warning | Medium. Change the observable behavior of erasing. |
| **F3** | Encryption v3 + synchronization phrase + v1/v2 reading | Medium. New format; it is advisable to go after F1/F2 so as not to mix. |
| **F4** | Watch layers 1 and 2 (detection, confirmation, compensation) | Low. |

**F1 first, deliberately.** It is the one that turns any error of the other two into recoverable, so
it is convenient to have it before touching deleted or temporary resolution. Each phase is
verifiable separately with the real scheme harness that already exists.

---

## F1 · Implemented (scheme v88)

`scripts/test-superseded-versions.mjs`. 532/532 tests, build and smoke e2e on the real app (v88).
Delivered:

- Migration **88**, purely additive: creates `sync_superseded` and does not touch any existing
  table. A real **base is constructed in v87**, it is populated (notes, genealogy with blob,
  ratings, databases) and it is verified that after migrating **each table retains its exact
  count**, the integrity and foreign keys are clean, the bytes of the evidence are identical, and
  remigration does not change anything.
- Recording in the two directions of the conflict, including the one that previously destroyed work
  without leaving a trace: **the local version overwritten by the other team.**
- Restore **reversible**: by promoting a version, the one that moves is saved in turn, so restoring
  by mistake is also undone. A deleted row can be recreated from its saved version.
- `sync_superseded` is explicitly **local**: does not travel in the package, because the record of
  what *this* computer discarded makes no sense in the other.
- Verified compatibility in both directions: a `.nodussync` built with scheme 87 continues to
  matter, a copy of a newer ** scheme** is rejected without touching the data, and one of an earlier
  scheme is restored normally.

### Default found during implementation

The first version kept **the same losing version at each synchronization**: a row that lost once
lost in all future imports of the same package, so the list would have grown with a duplicate by
sync until it buried the actual conflicts. `recordSuperseded` deduplicates and returns if it got to
store; the summary counter only counts what is actually saved.

### Limitations assumed

- **BLOB columns are not saved.** Duplicate attachments, recordings and portraits would multiply the
  size of the base. The row and a marker with size are retained; current attachments are maintained
  when restored and notice is given.
- **There is no automatic collection.** This table *is* the safety net, so nothing erases it for
  time: only the user, explicitly. Growth is limited by real conflicts, which are rare, and
  deduplication prevents repetition.

---

## F2 · Implemented (Scheme v89)

`scripts/test-tombstones.mjs` (10 assumptions) + `scripts/test-source-hygiene.mjs`. 534/534 tests,
build and smoke e2e on the real app (v89).

A deletion ceases to resurrect: it is recorded in `sync_tombstones` by triggers generated from the
same record that decides what is synchronized, travels in the package, applies before merging rows,
and what it removes is recoverable in `sync_superseded`.

### The Dangerous Half: What Must NOT Look Like a Wipe

Propagating deleted is easy; it is difficult not to propagate those that are not. Each of these
would have deleted user data ** on the other computer**:

- **Save by deleting and rewriting.**The schedule deletes all periods of a course and resets them
  with the same ids. Without the trigger `AFTER INSERT` that removes the tombstone, a normal save
  would have told the other computer to delete the schedule. Verified, and also verified that a row
  that *yes* disappears in that rewrite is marked.
- **The internal cleaning of the merge.** By dropping newly inserted rows whose foreign keys are
  hanging, the trigger does not distinguish that from a user deletion: the tombstone is explicitly
  removed.
- **Restore a saved version.** Write a row that a tombstone gives for dead. Without a new time mark,
  the following synchronization would have erased it again and the user would have seen how its
  recovery was undone alone. Now restoring is the latest fact about the row.

And in the opposite direction: one deleted is not sacred. If the other team edited the row **after**
the deleted one, that edition is the most recent fact and the row returns.

### Default found during implementation

The tombstone search key was built in two places, and in one the separator ended up being a **byte
NUL** instead of a space. Result: the search never coincided, the suppression of resurrections did
nothing, and **TypeScript compiled without complaining**; `grep` also stopped finding the file
because it was considered binary.

Two corrections: the key is now built into ** a single function** (`tombstoneKey`), and
`scripts/test-source-hygiene.mjs` rejects control characters and invalid UTF-8 throughout the code.
That guard uncovered three files already in `main` that use NUL as a code separator composed of
**deliberate and correct** (`ideaDedupe`, `graph/lod`, `stats`): they are in an explicit list, not
touched, for a new *NUL* to continue to fail.

### Known interaction (documented, not a failure)

Restore a previous copy to a deleted one returns the row ** and** backs the local state of
tombstones. If the other computer still has yours, the following synchronization will reapply the
deleted one, because it is the most recent fact. Nothing is lost: it remains in "Replaced version"
as *delete on the other computer*.

### Limitations assumed

- ** 180-day horizon.** After that time the tombstone is forgotten and the row could come back from
  a very backward team. By importing an older package that the horizon is explicitly warned in the
  summary.
- **One stone per row deleted.** Measured: 20,000 erased by cascade with the trigger cost 20 ms, so
  cost is not a problem; size is narrowed by the horizon.


---

## F3 and F4 implemented

`scripts/test-sync-package.mjs` (enlarged). 534/534 tests, build and smoke e2e (v89). **No schema
change**: the phrase lives on `safeStorage`, not on the base, so these two phases do not touch
anyone's data.

### F3 · Encryption (format v3)

Each table and attachment is sealed separately under a derived key ** once** (scrypt N=32768 +
AES-256-GCM, IV own per entry). Thus the encryption ** does not reintroduce** the unique buffer that
made it impossible to synchronize large vaults. The table names live in an encrypted index and the
entries have opaque names: the file does not announce that it contains a notebook of ratings.

The manifest is clear on purpose — it allows you to reject an incompatible package or warn of its
antiquity ** without asking for the phrase**.

** Verified compatibility**: packages are still imported **v1** (JSON unique with base64 blobs) and
**v2** (one entry per table, clear), including their attachments. Only v3 is written.

**Credential**: a proper "sync" phrase, not the master password — restoring with the recovery key
generates a new, random master password, so the two teams would have ended up with different
credentials and the sync would have failed for no apparent reason. It is included in the recovery
kit. When importing a foreign package, the interface asks for the phrase of the computer that
generated it instead of leaving the user stuck.

### F4 · Watch bias

The only thing that a one-way package can measure is measured and reported: that the emitter clock
is **advanced**. A packet with an old date is indistinguishable from a backward clock, so it is not
guessed — and the test explicitly checks that an old package **no** is confused with a lag.

What really solves the problem is not the detection, but the F1: win whoever wins the comparison,
the losing version is preserved. A bad clock costs a review, not the job.

### Assertions that were weak

The privacy checks looked for the flat text in the entire file. A zip **compressed** its entries, so
they passed the same without encrypting anything. Now they are done over the **decompressed** bytes
of each entry, and it was verified that with `seal` disabled the test fails.
