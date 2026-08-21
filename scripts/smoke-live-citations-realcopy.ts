// Live citation labels, proved against a COPY of a real corpus.
//
// The change rewrites text inside saved reports. Two things must hold, and neither
// is obvious from reading the code:
//
//   1. It works. Reports that named the editor of an edited volume now name the
//      author of the chapter they are actually citing.
//   2. It breaks nothing. Every anchor survives byte-for-byte, in the same order;
//      the prose around the citations is untouched to the character; labels a
//      person wrote are left alone; and no citation is left empty or dangling.
//
// Assertion (2) is checked structurally rather than by eye: each report is reduced
// to a "skeleton" with every link label blanked out, and the skeletons before and
// after must be identical. Anything that moved outside a label would show up there.
//
// Point NODUS_TEST_USERDATA at a directory holding a COPY of nodus.sqlite.
//
//   npm run smoke:live-citations   (see scripts/run-smoke.mjs)
import { getDb } from '../electron/db/database';
import { reconcileAuthorRolesOnce } from '../electron/db/authorsRepo';
import { relabelCitationsDetailed, relabelDraft, resolveCitationLabel } from '../electron/citations/liveCitations';
import { getWritingWorkshopDraft, listWritingWorkshopDrafts } from '../electron/db/writingDraftsRepo';
import { NODUS_LINK_RE, looksLikeGeneratedLabel, yearOfLabel } from '@shared/citationLabel';
import type { WritingWorkshopDraft } from '@shared/types';

const db = getDb();

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

/** Every anchor in render order: what a citation points at, ignoring what it says. */
function anchors(markdown: string): string[] {
  return [...markdown.matchAll(new RegExp(NODUS_LINK_RE.source, 'g'))].map((m) => `${m[2]}:${m[3]}`);
}

/** The report with every link label blanked out — the part that must never move. */
function skeleton(markdown: string): string {
  return markdown.replace(new RegExp(NODUS_LINK_RE.source, 'g'), (_full, _label, kind, id) => `[⟦⟧](nodus://${kind}/${id})`);
}

function labelsOf(markdown: string): string[] {
  return [...markdown.matchAll(new RegExp(NODUS_LINK_RE.source, 'g'))].map((m) => String(m[1]));
}

// ── The corpus must first be in its repaired state, or there is nothing to relabel.
reconcileAuthorRolesOnce();

const rows = db
  .prepare('SELECT id, title, draft_json FROM writing_saved_drafts ORDER BY created_at')
  .all() as { id: string; title: string; draft_json: string }[];
assert(rows.length > 0, 'the copy holds no saved reports, so this proves nothing');
console.log(`saved reports: ${rows.length}`);

let totalAnchors = 0;
let totalChanged = 0;
let totalKeptHandwritten = 0;
let totalUnresolvable = 0;
const examples: string[] = [];
const unresolvableByKind = new Map<string, number>();
const bibliographyChanges: string[] = [];

for (const row of rows) {
  const draft = JSON.parse(row.draft_json) as WritingWorkshopDraft;
  const before = draft.draftMarkdown ?? '';
  const detail = relabelCitationsDetailed(before);
  const after = detail.markdown;

  // ── (2) Nothing outside a label moved ──────────────────────────────────────
  assert(skeleton(before) === skeleton(after), `${row.id}: the prose or an anchor changed, not just a label`);
  const anchorsBefore = anchors(before);
  const anchorsAfter = anchors(after);
  assert(
    anchorsBefore.length === anchorsAfter.length && anchorsBefore.every((a, i) => a === anchorsAfter[i]),
    `${row.id}: the anchors changed`
  );
  assert(!/\[\]\(nodus:\/\//.test(after), `${row.id}: a citation was left with no visible label`);
  assert(
    (before.match(/nodus:\/\//g) ?? []).length === (after.match(/nodus:\/\//g) ?? []).length,
    `${row.id}: the number of citations changed`
  );

  // A label a person wrote must come out of the relabel untouched.
  const beforeLabels = labelsOf(before);
  const afterLabels = labelsOf(after);
  beforeLabels.forEach((label, i) => {
    if (!looksLikeGeneratedLabel(label)) {
      assert(afterLabels[i] === label, `${row.id}: a hand-written label was rewritten ("${label}")`);
      totalKeptHandwritten += 1;
    }
  });

  // Every anchor that still resolves must end up carrying its current label, and
  // — the load-bearing one — a relabelled citation must still name the SAME source.
  // A byline repair never moves a year, so a year that changed means the citation
  // was re-pointed at a different work, which is worse than the stale name it fixes.
  beforeLabels.forEach((label, i) => {
    const [kind, id] = anchorsBefore[i].split(/:(.+)/);
    const fresh = resolveCitationLabel(kind, decodeURIComponent(id), label);
    if (!fresh) {
      totalUnresolvable += 1;
      unresolvableByKind.set(kind, (unresolvableByKind.get(kind) ?? 0) + 1);
      assert(afterLabels[i] === label, `${row.id}: an unresolvable citation lost its stored label`);
      return;
    }
    if (!looksLikeGeneratedLabel(label)) return;
    assert(afterLabels[i].startsWith(fresh), `${row.id}: label ${i} is not the current one ("${afterLabels[i]}" vs "${fresh}")`);
    if (kind === 'idea') {
      assert(
        yearOfLabel(afterLabels[i]) === yearOfLabel(label),
        `${row.id}: citation ${i} was re-pointed at another source ("${label}" → "${afterLabels[i]}")`
      );
    }
  });

  totalAnchors += anchorsBefore.length;
  totalChanged += detail.changed.length;
  for (const change of detail.changed.slice(0, 2)) {
    if (examples.length < 12) examples.push(`  ${change.from}  →  ${change.to}`);
  }

  // ── The reference list and the prose must stay in agreement ────────────────
  const relabelled = relabelDraft(draft);
  const bib = relabelled.bibliography ?? [];
  assert(bib.length === (draft.bibliography ?? []).length, `${row.id}: the reference list changed length`);
  bib.forEach((entry, i) => {
    const old = (draft.bibliography ?? [])[i];
    if (entry === old) return;
    // A rewritten entry must also appear rewritten inside the prose, or the report
    // would print one bibliography and carry another. Testing that the new text is
    // present is the real invariant: some rewrites are additive (a DOI the corpus
    // has acquired since), so the old string legitimately survives inside the new.
    assert(
      !(draft.draftMarkdown ?? '').includes(old) || relabelled.draftMarkdown.includes(entry),
      `${row.id}: reference "${old.slice(0, 50)}…" was updated in the list but not in the report body`
    );
    if (bibliographyChanges.length < 6) bibliographyChanges.push(`  ${old.slice(0, 78)}\n    →  ${entry.slice(0, 78)}`);
  });

  // Relabelling twice must produce the same text: the operation is a projection of
  // the corpus, not an accumulating edit.
  assert(relabelCitationsDetailed(after).markdown === after, `${row.id}: relabelling is not idempotent`);
}

const byKind = [...unresolvableByKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
console.log(`\ncitations: ${totalAnchors} anchors · ${totalChanged} labels refreshed · ${totalKeptHandwritten} hand-written left alone`);
console.log(`not re-derivable, kept exactly as stored: ${totalUnresolvable} (${byKind || 'none'})`);
if (examples.length) {
  console.log('\nnames a report used to print, and what it prints now:');
  for (const line of examples) console.log(line);
}
if (bibliographyChanges.length) {
  console.log('\nreference entries rebuilt from the corpus:');
  for (const line of bibliographyChanges) console.log(line);
}

assert(totalChanged > 0, 'no label changed at all — the repair is not reaching stored reports');

// ── It reaches the real read path, not just the function under test ──────────
// Everything above calls the relabeller directly. This reads the reports the way
// the reader, the exports, the archive and the MCP tools do — through the repo —
// and proves the text they receive is the refreshed one, while the row on disk is
// untouched. Nothing else in the app would notice if the wiring were missing.
const served = listWritingWorkshopDrafts();
assert(served.length === rows.length, 'the repo did not return every saved report');
let servedChanged = 0;
for (const saved of served) {
  const stored = rows.find((r) => r.id === saved.id);
  assert(!!stored, `${saved.id}: served a report the table does not hold`);
  const raw = JSON.parse(stored!.draft_json) as WritingWorkshopDraft;
  assert(
    saved.draft.draftMarkdown === relabelDraft(raw).draftMarkdown,
    `${saved.id}: the repo served text that is not the refreshed one`
  );
  // Every line that differs must differ for one of exactly two sanctioned reasons:
  // it carries a citation whose label was refreshed, or it is a reference entry
  // rebuilt from the corpus. A line that changed for any other reason is prose
  // Nodus had no business touching.
  const storedLines = (raw.draftMarkdown ?? '').split('\n');
  const servedLines = saved.draft.draftMarkdown.split('\n');
  assert(storedLines.length === servedLines.length, `${saved.id}: the report gained or lost lines`);
  const oldEntries = (raw.bibliography ?? []).filter((entry) => entry.trim().length > 0);
  storedLines.forEach((line, i) => {
    if (line === servedLines[i]) return;
    const isCitationLine = line.includes('nodus://') && skeleton(line) === skeleton(servedLines[i]);
    const isReferenceLine = oldEntries.some((entry) => line.includes(entry));
    assert(isCitationLine || isReferenceLine, `${saved.id}: line ${i + 1} changed for no sanctioned reason:\n  ${line}\n  ${servedLines[i]}`);
  });
  if (saved.draft.draftMarkdown !== raw.draftMarkdown) servedChanged += 1;
}
// The archive and the MCP tools fetch one report at a time through the other
// getter; it must refresh the same way, or an export would disagree with the reader.
for (const saved of served) {
  const single = getWritingWorkshopDraft(saved.id);
  assert(!!single, `${saved.id}: the single-report getter returned nothing`);
  assert(
    single!.draft.draftMarkdown === saved.draft.draftMarkdown,
    `${saved.id}: the single-report getter served different text from the list`
  );
}

const onDisk = db.prepare('SELECT draft_json FROM writing_saved_drafts WHERE id = ?').get(rows[0].id) as { draft_json: string };
assert(onDisk.draft_json === rows[0].draft_json, 'reading a report rewrote it on disk');
console.log(`\nthrough the repo the reader actually uses: ${served.length} reports served, ${servedChanged} with refreshed names, 0 rows written back`);

console.log('\nLABELS ARE LIVE · ANCHORS AND PROSE UNTOUCHED ✓');
