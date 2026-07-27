/**
 * A character sheet as one page of Markdown — the thing you hand to an illustrator, a
 * co-author or a GM.
 *
 * Markdown rather than HTML→PDF: the destination is almost always another person's tool
 * (a doc, an email, a chat), and Markdown survives every one of them. It also stays
 * diffable, which a PDF does not.
 *
 * SECRETS ARE OMITTED BY DEFAULT. Exporting is handing the sheet to someone else, and a
 * secret alias is a plot device — leaking it in a file the author meant to share with an
 * illustrator is exactly the accident this flag exists to prevent.
 *
 * Pure: no DB, no filesystem, so the composition is unit-tested directly.
 */

import {
  CHARACTER_ARC_FIELDS,
  CHARACTER_EVENT_TYPE_LABEL,
  CHARACTER_LIFE_STATUS_LABEL,
  CHARACTER_NAME_KIND_LABEL,
  CHARACTER_ROLE_LABEL,
  CHARACTER_VOICE_FIELDS,
} from './characterLabels';
import type { CharacterAbility, CharacterArc, CharacterEvent, CharacterVoice, PersonName } from './types';
import type { CharacterLifeStatus, CharacterNarrativeRole } from './types';

export interface CharacterSheetExport {
  displayName: string;
  names: PersonName[];
  species: string | null;
  gender: string | null;
  pronouns: string | null;
  lifeStatus: CharacterLifeStatus;
  narrativeRole: CharacterNarrativeRole | null;
  birthDate: string | null;
  deathDate: string | null;
  birthYear: number | null;
  deathYear: number | null;
  appearance: string | null;
  personality: string | null;
  backstory: string | null;
  biography: string | null;
  arc: CharacterArc;
  voice: CharacterVoice;
  abilities: CharacterAbility[];
  events: CharacterEvent[];
  kin: { parents: string[]; spouses: string[]; children: string[]; siblings: string[] };
  relations: { role: string; target: string }[];
  notes: string | null;
}

export interface SheetExportOptions {
  /** Include names marked secret. Off by default: exporting means sharing. */
  includeSecrets?: boolean;
  /** Include the author's private notes. Off by default for the same reason. */
  includeNotes?: boolean;
}

function section(title: string, body: string | null | undefined): string[] {
  const clean = (body ?? '').trim();
  return clean ? [`## ${title}`, '', clean, ''] : [];
}

function bullets(title: string, items: string[]): string[] {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  return clean.length ? [`## ${title}`, '', ...clean.map((item) => `- ${item}`), ''] : [];
}

export function composeCharacterSheetMarkdown(
  sheet: CharacterSheetExport,
  { includeSecrets = false, includeNotes = false }: SheetExportOptions = {}
): string {
  const lines: string[] = [`# ${sheet.displayName}`, ''];

  const identity = [
    sheet.species,
    sheet.gender,
    sheet.pronouns,
    CHARACTER_LIFE_STATUS_LABEL[sheet.lifeStatus],
    sheet.narrativeRole ? CHARACTER_ROLE_LABEL[sheet.narrativeRole] : null,
  ].filter(Boolean);
  if (identity.length) lines.push(`*${identity.join(' · ')}*`, '');

  const span = [
    sheet.birthDate ? `n. ${sheet.birthDate}` : sheet.birthYear != null ? `n. ${sheet.birthYear}` : '',
    sheet.deathDate ? `†︎ ${sheet.deathDate}` : sheet.deathYear != null ? `†︎ ${sheet.deathYear}` : '',
  ].filter(Boolean);
  if (span.length) lines.push(span.join(' — '), '');

  const visibleNames = sheet.names.filter(
    (entry) => entry.name !== sheet.displayName && (includeSecrets || !entry.secret)
  );
  lines.push(
    ...bullets(
      'Nombres y alias',
      visibleNames.map((entry) => {
        const kind = entry.kind ? CHARACTER_NAME_KIND_LABEL[entry.kind] ?? entry.kind : null;
        const secret = entry.secret ? ` — secreto${entry.knownBy ? ` (${entry.knownBy})` : ''}` : '';
        return `**${entry.name}**${kind ? ` · ${kind}` : ''}${secret}`;
      })
    )
  );
  const hiddenCount = sheet.names.filter((entry) => entry.secret).length;
  if (hiddenCount > 0 && !includeSecrets) {
    lines.push(`> ${hiddenCount === 1 ? 'Se ha omitido 1 nombre secreto.' : `Se han omitido ${hiddenCount} nombres secretos.`}`, '');
  }

  lines.push(...section('Apariencia', sheet.appearance));
  lines.push(...section('Personalidad', sheet.personality));
  lines.push(...section('Trasfondo', sheet.backstory));
  lines.push(...section('Biografía', sheet.biography));

  const arc = CHARACTER_ARC_FIELDS.map((field) =>
    sheet.arc[field.id]?.trim() ? `**${field.label}:** ${sheet.arc[field.id]!.trim()}` : ''
  ).filter(Boolean);
  lines.push(...bullets('Arco', arc));

  const voice = CHARACTER_VOICE_FIELDS.map((field) =>
    sheet.voice[field.id]?.trim() ? `**${field.label}:** ${sheet.voice[field.id]!.trim()}` : ''
  ).filter(Boolean);
  lines.push(...bullets('Voz', voice));

  if (sheet.abilities.length) {
    lines.push('## Habilidades', '');
    for (const ability of sheet.abilities) {
      lines.push(`### ${ability.name}`, '');
      if (ability.description?.trim()) lines.push(ability.description.trim(), '');
      if (ability.cost?.trim()) lines.push(`- **Coste:** ${ability.cost.trim()}`);
      if (ability.limits?.trim()) lines.push(`- **Límite:** ${ability.limits.trim()}`);
      lines.push('');
    }
  }

  if (sheet.events.length) {
    lines.push('## Hechos de su vida', '');
    for (const event of sheet.events) {
      const when = [event.worldYear != null ? String(event.worldYear) : '', event.date ?? ''].filter(Boolean).join(' · ');
      const what = CHARACTER_EVENT_TYPE_LABEL[event.type] ?? event.type;
      lines.push(`- ${when ? `**${when}** — ` : ''}${what}${event.placeName ? `, en ${event.placeName}` : ''}`);
    }
    lines.push('');
  }

  const kin = [
    sheet.kin.parents.length ? `**Progenitores:** ${sheet.kin.parents.join(', ')}` : '',
    sheet.kin.spouses.length ? `**Parejas:** ${sheet.kin.spouses.join(', ')}` : '',
    sheet.kin.children.length ? `**Descendencia:** ${sheet.kin.children.join(', ')}` : '',
    sheet.kin.siblings.length ? `**Hermanos:** ${sheet.kin.siblings.join(', ')}` : '',
  ].filter(Boolean);
  lines.push(...bullets('Parentesco', kin));

  lines.push(...bullets('Vínculos', sheet.relations.map((relation) => `${relation.role}: ${relation.target}`)));

  if (includeNotes) lines.push(...section('Notas', sheet.notes));

  // Collapse the runs of blank lines the optional sections leave behind.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
