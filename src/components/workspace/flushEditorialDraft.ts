/** A user may keep typing while a save is in flight. Flush that newer edit too. */
export async function flushEditorialDraft(save: () => Promise<boolean>, isCurrent: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (!await save()) return false;
    if (isCurrent()) return true;
  }
  // Continuous editing keeps the document open instead of dropping a newer draft.
  return false;
}
