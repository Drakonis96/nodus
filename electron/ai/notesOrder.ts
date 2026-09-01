// AI logical reordering of notes: given a set of notes (usually one folder's),
// ask the model to arrange them so each note follows naturally from the previous
// one — like the sections of an argument. The new order is persisted via
// order_idx and returned so the UI can offer keep / undo.
import type { NotesReorderResult } from '@shared/types';
import { notesOrderPromptPack } from '@shared/notesOrderPromptPacks';
import { getNote, reorderNotes } from '../db/notesRepo';
import { getSettings } from '../db/settingsRepo';
import { completeJson } from './aiClient';

interface OrderResponse {
  order: string[];
}

function isOrderResponse(v: unknown): v is OrderResponse {
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as OrderResponse).order) &&
    (v as OrderResponse).order.every((x) => typeof x === 'string')
  );
}

function snippet(markdown: string, max = 240): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export async function reorderNotesByAI(noteIds: string[]): Promise<NotesReorderResult> {
  const notes = noteIds.map((id) => getNote(id)).filter((n): n is NonNullable<typeof n> => n !== null);
  if (notes.length < 2) {
    return { orderedIds: notes.map((n) => n.id) };
  }

  const prompt = notesOrderPromptPack(getSettings().promptLanguage ?? 'es');

  const list = notes
    .map((n, i) => {
      const body = snippet(n.content);
      return `${i + 1}. id="${n.id}" · ${prompt.title}: ${n.title}${body ? `\n   ${prompt.summary}: ${body}` : ''}`;
    })
    .join('\n');

  const system = prompt.system;
  const user = `${prompt.notes}:\n${list}\n\n${prompt.returnOrder}`;

  const result = await completeJson<OrderResponse>({ system, user, temperature: 0 }, isOrderResponse);

  // Reconcile: keep only known ids (once), then append any the model dropped, so
  // no note is ever lost regardless of the model's output.
  const known = new Set(noteIds);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of result.order) {
    if (known.has(id) && !seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }
  for (const id of noteIds) if (!seen.has(id)) ordered.push(id);

  reorderNotes(ordered);
  return { orderedIds: ordered };
}
