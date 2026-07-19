/**
 * Short, human-readable ids for the rows a teacher adds by hand — rubric criteria and
 * levels, the pairs of a matching question.
 *
 * These ids look decorative and are not: they key the rubric's `cells` map and the AI
 * fill-one-cell call. Minting them as `` `C${list.length + 1}` `` collides the moment
 * anything is deleted — remove C2 from C1/C2/C3 and the next criterion is another C3,
 * after which filling one cell with AI writes into two rows, and two level columns
 * share `cells[id]` so typing in one changes the other.
 *
 * Counting is therefore done against the ids that EXIST, not against the length.
 *
 * Pure: no Electron, no DB.
 */

/** The lowest `${prefix}${n}` that nothing in `existing` already uses. */
export function nextSequentialId(prefix: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

/** The same, for the common case of a list of `{ id }` rows. */
export function nextIdFor(prefix: string, rows: readonly { id: string }[]): string {
  return nextSequentialId(prefix, rows.map((row) => row.id));
}
