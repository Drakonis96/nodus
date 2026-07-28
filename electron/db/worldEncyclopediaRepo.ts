// The encyclopedia (schema v98).
//
// THE INDEX IS A READ, NOT A TABLE. A character, a place, a faction, a scene and a map are
// already rows somewhere; listing them alongside the native articles is six SELECTs, not a
// copy that would disagree with the originals the first time somebody renamed one. Same
// reasoning as shared/worldPresence.ts, which refused a fourth positions table.
//
// What IS stored is the link graph, because it cannot be recomputed on demand: five of the
// six entry kinds have no body column at all — a character's "body" is composed here from a
// dozen sheet fields — so answering "who mentions Kaelen" by scanning would mean composing
// every sheet in the world on every page view.
//
// Reads never inner-join an overlay. A person created by another path (a merge, a
// `.nodussync` import) has no `character_profiles` row, and an INNER JOIN would drop them
// from the index with no error at all.

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import { RULE_HARDNESS_LABEL, RULE_SCOPE_LABEL } from '@shared/worldRules';
import {
  ARTICLE_CATEGORY_LABEL,
  entryKey,
  entryLookup,
  extractSnippet,
  isArticleCategory,
  normalizeTitle,
  parseEntryKey,
  parseWorldLinks,
  pendingKey,
  pendingText as decodePendingText,
  resolvePendingLinks,
} from '@shared/worldEncyclopedia';
import type {
  WorldArticle,
  WorldEntryProposal,
  WorldArticleCategory,
  WorldArticleInput,
  WorldBodyHit,
  WorldEntry,
  WorldEntryDetail,
  WorldEntryKind,
  WorldEntryLink,
  WorldEntryRef,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

/** First line of a block of prose, for the one-line summary of an entry that has none. */
function firstLine(text: string | null | undefined, max = 160): string | null {
  const line = (text ?? '').trim().split(/\n+/)[0]?.trim();
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function category(value: string | null | undefined): WorldArticleCategory {
  return isArticleCategory(value) ? value : 'other';
}

// ── The index ────────────────────────────────────────────────────────────────

interface ArticleRow {
  article_id: string;
  title: string;
  title_key: string;
  category: string;
  summary: string | null;
  body: string | null;
  body_proposed: string | null;
  body_proposed_at: string | null;
  aka: string | null;
  origin: string;
  spoiler: number;
  sort_title: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** `aka` is one name per line: a second table for four words was not worth it. */
function akaNames(aka: string | null): string[] {
  return (aka ?? '')
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function rowToArticle(row: ArticleRow): WorldArticle {
  return {
    articleId: row.article_id,
    title: row.title,
    titleKey: row.title_key,
    category: category(row.category),
    summary: row.summary,
    body: row.body,
    proposedBody: row.body_proposed,
    proposedAt: row.body_proposed_at,
    aka: row.aka,
    origin: row.origin === 'ai_proposal' ? 'ai_proposal' : 'author',
    spoiler: row.spoiler === 1,
    sortTitle: row.sort_title,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function makeEntry(
  kind: WorldEntryKind,
  id: string,
  title: string,
  rest: Partial<Omit<WorldEntry, 'kind' | 'id' | 'key' | 'title' | 'titleKey'>>
): WorldEntry {
  return {
    kind,
    id,
    key: entryKey({ kind, id }),
    title,
    titleKey: normalizeTitle(title),
    aliases: rest.aliases ?? [],
    summary: rest.summary ?? null,
    category: rest.category ?? null,
    editable: kind === 'article',
    stub: rest.stub ?? false,
    spoiler: rest.spoiler ?? false,
    updatedAt: rest.updatedAt ?? '',
  };
}

/**
 * Every entry in the world, oldest first.
 *
 * The order matters beyond presentation: `entryLookup` gives a contested name to whoever
 * has carried it longest, so a new article called "Vael" cannot steal the links already
 * pointing at a character of that name. The A–Z sorting happens in the renderer, over the
 * same list, so the index and the search can never disagree.
 */
export function listWorldEntries(): WorldEntry[] {
  const db = getDb();
  const entries: WorldEntry[] = [];

  for (const row of db.prepare('SELECT * FROM world_articles').all() as ArticleRow[]) {
    entries.push(
      makeEntry('article', row.article_id, row.title, {
        aliases: akaNames(row.aka),
        summary: row.summary ?? firstLine(row.body),
        category: category(row.category),
        stub: !(row.body ?? '').trim() && !(row.summary ?? '').trim(),
        spoiler: row.spoiler === 1,
        updatedAt: row.updated_at,
      })
    );
  }

  // Characters. LEFT JOIN, always: the overlay row is never assumed to exist.
  const names = new Map<string, string[]>();
  for (const row of db.prepare('SELECT person_id, name FROM person_names').all() as {
    person_id: string;
    name: string;
  }[]) {
    names.set(row.person_id, [...(names.get(row.person_id) ?? []), row.name]);
  }
  for (const row of db
    .prepare(
      `SELECT p.person_id, p.display_name, p.biography, p.notes, p.updated_at,
              c.species, c.narrative_role, c.appearance, c.personality, c.backstory
         FROM persons p
         LEFT JOIN character_profiles c ON c.person_id = p.person_id`
    )
    .all() as {
    person_id: string;
    display_name: string;
    biography: string | null;
    notes: string | null;
    updated_at: string;
    species: string | null;
    narrative_role: string | null;
    appearance: string | null;
    personality: string | null;
    backstory: string | null;
  }[]) {
    const prose = [row.biography, row.backstory, row.appearance, row.personality].find((text) => (text ?? '').trim());
    entries.push(
      makeEntry('character', row.person_id, row.display_name, {
        aliases: (names.get(row.person_id) ?? []).filter((name) => name !== row.display_name),
        summary: firstLine(prose) ?? row.species,
        category: row.species ?? row.narrative_role,
        stub: !prose,
        updatedAt: row.updated_at,
      })
    );
  }

  for (const row of db
    .prepare(
      `SELECT pl.place_id, pl.name, pl.kind, pl.notes, pl.updated_at,
              pr.appearance, pr.atmosphere, pr.history
         FROM places pl
         LEFT JOIN place_profiles pr ON pr.place_id = pl.place_id`
    )
    .all() as {
    place_id: string;
    name: string;
    kind: string | null;
    notes: string | null;
    updated_at: string;
    appearance: string | null;
    atmosphere: string | null;
    history: string | null;
  }[]) {
    const prose = [row.appearance, row.atmosphere, row.history, row.notes].find((text) => (text ?? '').trim());
    entries.push(
      makeEntry('place', row.place_id, row.name, {
        summary: firstLine(prose),
        category: row.kind,
        stub: !prose,
        updatedAt: row.updated_at,
      })
    );
  }

  for (const row of db.prepare('SELECT group_id, name, kind, summary, description, updated_at FROM world_groups').all() as {
    group_id: string;
    name: string;
    kind: string;
    summary: string | null;
    description: string | null;
    updated_at: string;
  }[]) {
    entries.push(
      makeEntry('group', row.group_id, row.name, {
        summary: row.summary ?? firstLine(row.description),
        category: row.kind,
        stub: !(row.summary ?? '').trim() && !(row.description ?? '').trim(),
        updatedAt: row.updated_at,
      })
    );
  }

  for (const row of db.prepare('SELECT scene_id, title, summary, status, updated_at FROM world_scenes').all() as {
    scene_id: string;
    title: string;
    summary: string | null;
    status: string;
    updated_at: string;
  }[]) {
    entries.push(
      makeEntry('scene', row.scene_id, row.title, {
        summary: firstLine(row.summary),
        category: row.status,
        stub: !(row.summary ?? '').trim(),
        updatedAt: row.updated_at,
      })
    );
  }

  // Rules. A law is the most citable thing a world has — «según [[La sangre paga]]» is
  // exactly the sentence a writer wants to be able to write.
  for (const row of db
    .prepare('SELECT rule_id, title, statement, hardness, status, updated_at FROM world_rules')
    .all() as {
    rule_id: string;
    title: string;
    statement: string | null;
    hardness: string;
    status: string;
    updated_at: string;
  }[]) {
    entries.push(
      makeEntry('rule', row.rule_id, row.title, {
        summary: firstLine(row.statement),
        category: row.hardness,
        stub: !(row.statement ?? '').trim(),
        updatedAt: row.updated_at,
      })
    );
  }

  // Conflicts. A war is a thing the world contains and a reader can be told about, so it
  // gets an entry and `[[la Guerra de los Tres Ríos]]` resolves. An ARC does not: it is the
  // shape of a character's change, and indexing it would put the ending in the index.
  for (const row of db
    .prepare("SELECT thread_id, title, pitch, stakes, status, updated_at FROM world_threads WHERE kind = 'conflict'")
    .all() as {
    thread_id: string;
    title: string;
    pitch: string | null;
    stakes: string | null;
    status: string;
    updated_at: string;
  }[]) {
    entries.push(
      makeEntry('conflict', row.thread_id, row.title, {
        summary: firstLine(row.pitch),
        category: row.status,
        stub: !(row.pitch ?? '').trim() && !(row.stakes ?? '').trim(),
        updatedAt: row.updated_at,
      })
    );
  }

  for (const row of db.prepare('SELECT map_id, name, kind, notes, updated_at FROM world_maps').all() as {
    map_id: string;
    name: string;
    kind: string;
    notes: string | null;
    updated_at: string;
  }[]) {
    entries.push(
      makeEntry('map', row.map_id, row.name, {
        summary: firstLine(row.notes),
        category: row.kind,
        stub: !(row.notes ?? '').trim(),
        updatedAt: row.updated_at,
      })
    );
  }

  return entries.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

function findEntry(ref: WorldEntryRef, entries?: WorldEntry[]): WorldEntry | null {
  const all = entries ?? listWorldEntries();
  return all.find((entry) => entry.kind === ref.kind && entry.id === ref.id) ?? null;
}

// ── The prose of an entry ────────────────────────────────────────────────────

/** One block of an entry's text: the field it lives in and what is written there. */
interface ProseField {
  field: string;
  heading: string | null;
  text: string;
}

/**
 * Every piece of prose an entry carries. This is the ONE place that knows where the text
 * of each kind lives: the body composer, the link indexer and the full-text search all
 * read it, so a field added to a sheet becomes linkable, searchable and readable at once
 * instead of in three commits.
 */
export function entryProse(ref: WorldEntryRef): ProseField[] {
  const db = getDb();
  const fields: ProseField[] = [];
  const push = (field: string, heading: string | null, text: string | null | undefined) => {
    if ((text ?? '').trim()) fields.push({ field, heading, text: text as string });
  };

  if (ref.kind === 'article') {
    const row = db.prepare('SELECT * FROM world_articles WHERE article_id = ?').get(ref.id) as ArticleRow | undefined;
    if (!row) return [];
    push('summary', null, row.summary);
    push('body', null, row.body);
    push('notes', 'Notas', row.notes);
  } else if (ref.kind === 'character') {
    const row = db
      .prepare(
        `SELECT p.biography, p.notes, c.appearance, c.personality, c.backstory
           FROM persons p LEFT JOIN character_profiles c ON c.person_id = p.person_id
          WHERE p.person_id = ?`
      )
      .get(ref.id) as
      | { biography: string | null; notes: string | null; appearance: string | null; personality: string | null; backstory: string | null }
      | undefined;
    if (!row) return [];
    push('appearance', 'Apariencia', row.appearance);
    push('personality', 'Personalidad', row.personality);
    push('backstory', 'Trasfondo', row.backstory);
    push('biography', 'Biografía', row.biography);
    push('notes', 'Notas', row.notes);
  } else if (ref.kind === 'place') {
    const row = db
      .prepare(
        `SELECT pl.notes, pr.appearance, pr.atmosphere, pr.history
           FROM places pl LEFT JOIN place_profiles pr ON pr.place_id = pl.place_id
          WHERE pl.place_id = ?`
      )
      .get(ref.id) as
      | { notes: string | null; appearance: string | null; atmosphere: string | null; history: string | null }
      | undefined;
    if (!row) return [];
    push('appearance', 'Apariencia', row.appearance);
    push('atmosphere', 'Atmósfera', row.atmosphere);
    push('history', 'Historia', row.history);
    push('notes', 'Notas', row.notes);
  } else if (ref.kind === 'group') {
    const row = db.prepare('SELECT summary, description, notes FROM world_groups WHERE group_id = ?').get(ref.id) as
      | { summary: string | null; description: string | null; notes: string | null }
      | undefined;
    if (!row) return [];
    push('summary', null, row.summary);
    push('description', null, row.description);
    push('notes', 'Notas', row.notes);
  } else if (ref.kind === 'scene') {
    const row = db.prepare('SELECT summary, notes FROM world_scenes WHERE scene_id = ?').get(ref.id) as
      | { summary: string | null; notes: string | null }
      | undefined;
    if (!row) return [];
    push('summary', null, row.summary);
    push('notes', 'Notas', row.notes);
  } else if (ref.kind === 'map') {
    const row = db.prepare('SELECT notes FROM world_maps WHERE map_id = ?').get(ref.id) as
      | { notes: string | null }
      | undefined;
    if (!row) return [];
    push('notes', null, row.notes);
  } else if (ref.kind === 'rule') {
    const row = db.prepare('SELECT statement, cost, limits FROM world_rules WHERE rule_id = ?').get(ref.id) as
      | { statement: string | null; cost: string | null; limits: string | null }
      | undefined;
    if (!row) return [];
    push('statement', null, row.statement);
    push('cost', 'Qué cuesta romperla', row.cost);
    push('limits', 'Hasta dónde no llega', row.limits);
  } else if (ref.kind === 'conflict') {
    const row = db.prepare('SELECT pitch, stakes, outcome FROM world_threads WHERE thread_id = ?').get(ref.id) as
      | { pitch: string | null; stakes: string | null; outcome: string | null }
      | undefined;
    if (!row) return [];
    // `pitch` is indexed like any other prose, which is what makes a place's sheet say
    // "Disputado en:" without a bridge table between conflicts and places.
    push('pitch', null, row.pitch);
    push('stakes', 'Qué se pierde', row.stakes);
    push('outcome', 'Cómo acaba', row.outcome);
  }
  return fields;
}

/**
 * Everything the INDEXERS should see, which is the entry's prose plus its manuscript.
 *
 * A separate function on purpose, and the separation is load-bearing: `entryProse()` also
 * feeds the reading pane and the **world bible export**, so handing the manuscript to it
 * would turn "export my world bible" into "export my entire novel, with the encyclopedia
 * stapled to the front". The links, the full-text search and the scan for holes want the
 * novel; the two readers do not.
 */
export function entryIndexableProse(ref: WorldEntryRef): ProseField[] {
  const blocks = entryProse(ref);
  if (ref.kind !== 'scene') return blocks;
  const row = getDb().prepare('SELECT text FROM world_scene_text WHERE scene_id = ?').get(ref.id) as
    | { text: string | null }
    | undefined;
  return (row?.text ?? '').trim() ? [...blocks, { field: 'text', heading: null, text: row!.text as string }] : blocks;
}

/** The reading pane's Markdown. For a projection it is COMPOSED here and never stored:
 *  a second copy of a character's backstory would be a second thing to keep in step. */
function composeBody(ref: WorldEntryRef): string {
  return entryProse(ref)
    .map((block) => (block.heading ? `## ${block.heading}\n\n${block.text}` : block.text))
    .join('\n\n');
}

/** The infobox: the structured half of a sheet, which prose cannot carry. */
function entryFacts(ref: WorldEntryRef): { label: string; value: string }[] {
  const db = getDb();
  const facts: { label: string; value: string }[] = [];
  const push = (label: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && String(value).trim()) facts.push({ label, value: String(value) });
  };

  if (ref.kind === 'article') {
    const row = db.prepare('SELECT category, origin FROM world_articles WHERE article_id = ?').get(ref.id) as
      | { category: string; origin: string }
      | undefined;
    if (row) push('Categoría', ARTICLE_CATEGORY_LABEL[category(row.category)]);
  } else if (ref.kind === 'character') {
    const row = db
      .prepare(
        `SELECT p.birth_date, p.death_date, c.species, c.pronouns, c.life_status, c.narrative_role
           FROM persons p LEFT JOIN character_profiles c ON c.person_id = p.person_id
          WHERE p.person_id = ?`
      )
      .get(ref.id) as Record<string, string | null> | undefined;
    if (row) {
      push('Especie', row.species);
      push('Pronombres', row.pronouns);
      push('Nacimiento', row.birth_date);
      push('Muerte', row.death_date);
    }
  } else if (ref.kind === 'place') {
    const row = db
      .prepare('SELECT kind, parent_id FROM places WHERE place_id = ?')
      .get(ref.id) as { kind: string | null; parent_id: string | null } | undefined;
    if (row?.parent_id) {
      const parent = db.prepare('SELECT name FROM places WHERE place_id = ?').get(row.parent_id) as
        | { name: string }
        | undefined;
      push('Dentro de', parent?.name);
    }
  } else if (ref.kind === 'group') {
    const row = db.prepare('SELECT founded_year, ended_year FROM world_groups WHERE group_id = ?').get(ref.id) as
      | { founded_year: number | null; ended_year: number | null }
      | undefined;
    push('Fundación', row?.founded_year);
    push('Final', row?.ended_year);
  } else if (ref.kind === 'scene') {
    const row = db
      .prepare('SELECT world_year, narrative_order FROM world_scenes WHERE scene_id = ?')
      .get(ref.id) as { world_year: number | null; narrative_order: number } | undefined;
    push('Año del mundo', row?.world_year);
    push('Orden del relato', row ? row.narrative_order + 1 : null);
  } else if (ref.kind === 'rule') {
    const row = db
      .prepare('SELECT hardness, status, scope_kind FROM world_rules WHERE rule_id = ?')
      .get(ref.id) as { hardness: string; status: string; scope_kind: string } | undefined;
    if (row) {
      push('Dureza', RULE_HARDNESS_LABEL[row.hardness as keyof typeof RULE_HARDNESS_LABEL] ?? row.hardness);
      push('Ámbito', RULE_SCOPE_LABEL[row.scope_kind] ?? row.scope_kind);
    }
    const tests = db
      .prepare("SELECT COUNT(*) AS c FROM world_beats WHERE thread_kind = 'rule' AND thread_id = ?")
      .get(ref.id) as { c: number };
    push('Veces puesta a prueba', tests.c || null);
  } else if (ref.kind === 'conflict') {
    const scenes = db
      .prepare(
        `SELECT MIN(s.narrative_order) AS first_scene, MAX(s.narrative_order) AS last_scene
           FROM world_beats b JOIN world_scenes s ON s.scene_id = b.scene_id
          WHERE b.thread_kind = 'conflict' AND b.thread_id = ?`
      )
      .get(ref.id) as { first_scene: number | null; last_scene: number | null } | undefined;
    if (scenes?.first_scene != null) push('Primera escena', scenes.first_scene + 1);
    if (scenes?.last_scene != null) push('Última escena', scenes.last_scene + 1);
  }
  return facts;
}

/**
 * What the ontology already knows about an entry, as opposed to what its prose mentions.
 *
 * Kept apart from the backlinks on purpose: "appears in scene 4" is a fact the author
 * recorded structurally, while "is mentioned in the article on blood magic" is a sentence
 * somebody wrote. Merging them would make the second look as reliable as the first.
 */
function entryRelated(ref: WorldEntryRef): { ref: WorldEntryRef; title: string; relation: string }[] {
  const db = getDb();
  const related: { ref: WorldEntryRef; title: string; relation: string }[] = [];

  if (ref.kind === 'character') {
    for (const row of db
      .prepare(
        `SELECT g.group_id, g.name, a.rank FROM character_affiliations a
           JOIN world_groups g ON g.group_id = a.group_id WHERE a.person_id = ?`
      )
      .all(ref.id) as { group_id: string; name: string; rank: string | null }[]) {
      related.push({ ref: { kind: 'group', id: row.group_id }, title: row.name, relation: row.rank ?? 'Miembro' });
    }
    for (const row of db
      .prepare(
        `SELECT s.scene_id, s.title, sc.role FROM scene_characters sc
           JOIN world_scenes s ON s.scene_id = sc.scene_id WHERE sc.person_id = ?
          ORDER BY s.narrative_order`
      )
      .all(ref.id) as { scene_id: string; title: string; role: string | null }[]) {
      related.push({ ref: { kind: 'scene', id: row.scene_id }, title: row.title, relation: row.role ?? 'Aparece' });
    }
  } else if (ref.kind === 'place') {
    for (const row of db.prepare('SELECT place_id, name FROM places WHERE parent_id = ?').all(ref.id) as {
      place_id: string;
      name: string;
    }[]) {
      related.push({ ref: { kind: 'place', id: row.place_id }, title: row.name, relation: 'Contiene' });
    }
    for (const row of db.prepare('SELECT scene_id, title FROM world_scenes WHERE place_id = ?').all(ref.id) as {
      scene_id: string;
      title: string;
    }[]) {
      related.push({ ref: { kind: 'scene', id: row.scene_id }, title: row.title, relation: 'Escena aquí' });
    }
  } else if (ref.kind === 'group') {
    for (const row of db
      .prepare(
        `SELECT p.person_id, p.display_name, a.rank FROM character_affiliations a
           JOIN persons p ON p.person_id = a.person_id WHERE a.group_id = ?`
      )
      .all(ref.id) as { person_id: string; display_name: string; rank: string | null }[]) {
      related.push({
        ref: { kind: 'character', id: row.person_id },
        title: row.display_name,
        relation: row.rank ?? 'Miembro',
      });
    }
  } else if (ref.kind === 'scene') {
    for (const row of db
      .prepare(
        `SELECT p.person_id, p.display_name, sc.role FROM scene_characters sc
           JOIN persons p ON p.person_id = sc.person_id WHERE sc.scene_id = ?`
      )
      .all(ref.id) as { person_id: string; display_name: string; role: string | null }[]) {
      related.push({
        ref: { kind: 'character', id: row.person_id },
        title: row.display_name,
        relation: row.role ?? 'Reparto',
      });
    }
  } else if (ref.kind === 'rule') {
    // Exceptions are children, and a mother that lists them is how a writer sees that a
    // law has been eaten alive by its own carve-outs.
    for (const row of db.prepare('SELECT rule_id, title FROM world_rules WHERE parent_rule_id = ?').all(ref.id) as {
      rule_id: string;
      title: string;
    }[]) {
      related.push({ ref: { kind: 'rule', id: row.rule_id }, title: row.title, relation: 'Excepción' });
    }
    for (const row of db
      .prepare(
        `SELECT s.scene_id, s.title, b.mark FROM world_beats b
           JOIN world_scenes s ON s.scene_id = b.scene_id
          WHERE b.thread_kind = 'rule' AND b.thread_id = ? ORDER BY s.narrative_order`
      )
      .all(ref.id) as { scene_id: string; title: string; mark: string }[]) {
      related.push({ ref: { kind: 'scene', id: row.scene_id }, title: row.title, relation: row.mark });
    }
  } else if (ref.kind === 'conflict') {
    for (const row of db.prepare('SELECT party_kind, party_id, side FROM thread_parties WHERE thread_id = ?').all(ref.id) as {
      party_kind: string;
      party_id: string;
      side: string;
    }[]) {
      const kind = row.party_kind === 'group' ? 'group' : 'character';
      const name =
        kind === 'group'
          ? (db.prepare('SELECT name FROM world_groups WHERE group_id = ?').get(row.party_id) as { name: string } | undefined)?.name
          : (db.prepare('SELECT display_name FROM persons WHERE person_id = ?').get(row.party_id) as { display_name: string } | undefined)?.display_name;
      if (!name) continue;
      related.push({ ref: { kind, id: row.party_id }, title: name, relation: row.side });
    }
  }
  return related;
}

export function getWorldEntry(ref: WorldEntryRef): WorldEntryDetail | null {
  const entries = listWorldEntries();
  const entry = findEntry(ref, entries);
  if (!entry) return null;
  const titles = new Map(entries.map((item) => [item.key, item.title]));
  const article =
    ref.kind === 'article'
      ? (getDb().prepare('SELECT body_proposed, body_proposed_at FROM world_articles WHERE article_id = ?').get(ref.id) as
          | { body_proposed: string | null; body_proposed_at: string | null }
          | undefined)
      : undefined;

  return {
    entry,
    body: composeBody(ref),
    facts: entryFacts(ref),
    links: linksFrom(ref, titles),
    backlinks: worldBacklinks(ref, titles),
    related: entryRelated(ref),
    proposedBody: article?.body_proposed ?? null,
    proposedAt: article?.body_proposed_at ?? null,
  };
}

// ── The link graph ───────────────────────────────────────────────────────────

interface LinkRow {
  source_kind: string;
  source_id: string;
  source_field: string;
  target_key: string;
  label: string | null;
  occurrences: number;
}

function rowToLink(row: LinkRow, titles: Map<string, string>): WorldEntryLink {
  const target = parseEntryKey(row.target_key);
  return {
    source: { kind: row.source_kind as WorldEntryKind, id: row.source_id },
    sourceTitle: titles.get(`${row.source_kind}:${row.source_id}`) ?? row.source_id,
    sourceField: row.source_field,
    target,
    targetTitle: target ? titles.get(row.target_key) ?? null : null,
    pendingText: decodePendingText(row.target_key),
    label: row.label,
    occurrences: row.occurrences,
  };
}

function titleMap(entries?: WorldEntry[]): Map<string, string> {
  return new Map((entries ?? listWorldEntries()).map((entry) => [entry.key, entry.title]));
}

export function linksFrom(ref: WorldEntryRef, titles = titleMap()): WorldEntryLink[] {
  return (
    getDb()
      .prepare('SELECT * FROM world_links WHERE source_kind = ? AND source_id = ? ORDER BY source_field, target_key')
      .all(ref.kind, ref.id) as LinkRow[]
  ).map((row) => rowToLink(row, titles));
}

/** "Mentioned in". Self-links are dropped: an article that names itself is not a reference. */
export function worldBacklinks(ref: WorldEntryRef, titles = titleMap()): WorldEntryLink[] {
  return (
    getDb()
      .prepare('SELECT * FROM world_links WHERE target_key = ? ORDER BY occurrences DESC, source_id')
      .all(entryKey(ref)) as LinkRow[]
  )
    .filter((row) => !(row.source_kind === ref.kind && row.source_id === ref.id))
    .map((row) => rowToLink(row, titles));
}

/** Every `[[…]]` in the world that nobody has defined — the author's real to-do list. */
export function worldUnresolvedLinks(): WorldEntryLink[] {
  const titles = titleMap();
  return (
    getDb()
      // `substr` rather than LIKE: the pending prefix is a literal '?', and a question
      // mark inside a LIKE pattern is one keystroke away from looking like a bound
      // parameter to anyone reading this later.
      .prepare("SELECT * FROM world_links WHERE substr(target_key, 1, 2) = '?:' ORDER BY target_key")
      .all() as LinkRow[]
  ).map((row) => rowToLink(row, titles));
}

/**
 * Re-derive one entry's links from its own prose.
 *
 * The delete-then-insert is scoped to the fields this entry actually has, and the rows go
 * back under the SAME content-derived primary key, so an unchanged link re-inserts over
 * itself and the tombstone trigger pair nets to zero. With a surrogate id here, every save
 * would leave a permanent tombstone per link and sync a phantom deletion forever.
 */
export function indexEntryLinks(ref: WorldEntryRef): number {
  const db = getDb();
  const ts = now();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM world_links WHERE source_kind = ? AND source_id = ?').run(ref.kind, ref.id);
    let count = 0;
    for (const block of entryIndexableProse(ref)) {
      for (const { link, occurrences } of parseWorldLinks(block.text)) {
        const target = link.status === 'resolved' ? entryKey(link.target) : pendingKey(link.text);
        const label = link.status === 'resolved' ? link.label : link.text;
        db.prepare(
          `INSERT INTO world_links
             (source_kind, source_id, source_field, target_key, label, occurrences, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_kind, source_id, source_field, target_key)
             DO UPDATE SET label = excluded.label, occurrences = excluded.occurrences, updated_at = excluded.updated_at`
        ).run(ref.kind, ref.id, block.field, target, label, occurrences, ts, ts);
        count += 1;
      }
    }
    return count;
  });
  return run();
}

/**
 * Rebuild the whole graph. Idempotent, and called after a sync merge: the index travels in
 * the package, but the bodies it describes may have been merged from the other machine, so
 * reconciling the two is the only way the two halves cannot disagree.
 */
export function rebuildWorldLinks(): number {
  let total = 0;
  for (const entry of listWorldEntries()) total += indexEntryLinks({ kind: entry.kind, id: entry.id });
  return total;
}

/**
 * Point every pending `[[text]]` in the world at a real entry, rewriting the bodies that
 * carry it. Returns how many entries were repaired, which is what the reader reports back
 * — "3 menciones enlazadas" is the whole reason red links are worth having.
 *
 * Only articles are rewritten: a projection's prose belongs to its own sheet, and silently
 * editing a character's backstory from the encyclopedia would be a surprise. Their links
 * still resolve on the next save of that sheet.
 */
export function resolveWorldLink(text: string, target: WorldEntryRef): number {
  const db = getDb();
  const key = pendingKey(text);
  const normalized = decodePendingText(key) ?? normalizeTitle(text);
  const run = db.transaction(() => {
    const sources = db
      .prepare("SELECT DISTINCT source_kind, source_id FROM world_links WHERE target_key = ?")
      .all(key) as { source_kind: string; source_id: string }[];
    let repaired = 0;
    for (const source of sources) {
      if (source.source_kind !== 'article') continue;
      const row = db.prepare('SELECT body, summary, notes FROM world_articles WHERE article_id = ?').get(source.source_id) as
        | { body: string | null; summary: string | null; notes: string | null }
        | undefined;
      if (!row) continue;
      const resolve = (candidate: string) => (candidate === normalized ? target : null);
      const body = resolvePendingLinks(row.body ?? '', resolve);
      const summary = resolvePendingLinks(row.summary ?? '', resolve);
      const notes = resolvePendingLinks(row.notes ?? '', resolve);
      if (body.resolved + summary.resolved + notes.resolved === 0) continue;
      db.prepare('UPDATE world_articles SET body = ?, summary = ?, notes = ?, updated_at = ? WHERE article_id = ?').run(
        body.body,
        summary.body,
        notes.body,
        now(),
        source.source_id
      );
      indexEntryLinks({ kind: 'article', id: source.source_id });
      repaired += 1;
    }
    return repaired;
  });
  return run();
}

// ── Articles ─────────────────────────────────────────────────────────────────

export function getWorldArticle(articleId: string): WorldArticle | null {
  const row = getDb().prepare('SELECT * FROM world_articles WHERE article_id = ?').get(articleId) as
    | ArticleRow
    | undefined;
  return row ? rowToArticle(row) : null;
}

export function listWorldArticles(): WorldArticle[] {
  return (getDb().prepare('SELECT * FROM world_articles ORDER BY title').all() as ArticleRow[]).map(rowToArticle);
}

export function createWorldArticle(input: WorldArticleInput): WorldArticle {
  const title = (input.title ?? '').trim();
  if (!title) throw new Error('El artículo necesita un título.');
  const db = getDb();
  const id = newId('art');
  const ts = now();
  db.prepare(
    `INSERT INTO world_articles
       (article_id, title, title_key, category, summary, body, aka, origin, spoiler, sort_title, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    title,
    normalizeTitle(title),
    category(input.category),
    input.summary ?? null,
    input.body ?? null,
    input.aka ?? null,
    'author',
    input.spoiler ? 1 : 0,
    input.sortTitle ?? null,
    input.notes ?? null,
    ts,
    ts
  );
  saveArticleProse(id);
  return getWorldArticle(id) as WorldArticle;
}

export function updateWorldArticle(articleId: string, patch: WorldArticleInput): WorldArticle {
  const db = getDb();
  const current = getWorldArticle(articleId);
  if (!current) throw new Error('Artículo no encontrado.');
  const title = patch.title !== undefined ? patch.title.trim() || current.title : current.title;
  db.prepare(
    `UPDATE world_articles SET title = ?, title_key = ?, category = ?, summary = ?, body = ?, aka = ?,
        spoiler = ?, sort_title = ?, notes = ?, updated_at = ?
      WHERE article_id = ?`
  ).run(
    title,
    normalizeTitle(title),
    patch.category !== undefined ? category(patch.category) : current.category,
    patch.summary !== undefined ? patch.summary : current.summary,
    patch.body !== undefined ? patch.body : current.body,
    patch.aka !== undefined ? patch.aka : current.aka,
    (patch.spoiler !== undefined ? patch.spoiler : current.spoiler) ? 1 : 0,
    patch.sortTitle !== undefined ? patch.sortTitle : current.sortTitle,
    patch.notes !== undefined ? patch.notes : current.notes,
    now(),
    articleId
  );
  saveArticleProse(articleId);
  return getWorldArticle(articleId) as WorldArticle;
}

/**
 * Promote the `[[…]]` in one piece of prose to real links.
 *
 * Shared by every entry kind that has editable prose — articles and conflicts today —
 * because the promotion is what makes the two link forms invisible to the author: type a
 * name, save, and it is a link. A kind that indexed its prose without this would store
 * pending links forever and never appear in anybody's backlinks.
 */
export function promoteWorldLinks(
  text: string | null,
  self?: WorldEntryRef
): { text: string | null; resolved: number } {
  if (!(text ?? '').trim()) return { text, resolved: 0 };
  const lookup = entryLookup(listWorldEntries());
  const resolve = (normalized: string) => {
    const target = lookup.get(normalized) ?? null;
    // Nothing links to itself: a title that happens to match its own text would become a
    // circular reference.
    return target && !(self && target.kind === self.kind && target.id === self.id) ? target : null;
  };
  const result = resolvePendingLinks(text as string, resolve);
  return { text: result.body, resolved: result.resolved };
}

/**
 * Promote whatever `[[…]]` now names something real, then re-index.
 *
 * This runs on every save, which is what makes typing `[[Kaelen Vor]]` equivalent to
 * picking Kaelen from the autocomplete: the author never has to learn that there are two
 * link forms.
 */
function saveArticleProse(articleId: string): void {
  const db = getDb();
  const lookup = entryLookup(listWorldEntries());
  const row = db.prepare('SELECT body, summary, notes FROM world_articles WHERE article_id = ?').get(articleId) as
    | { body: string | null; summary: string | null; notes: string | null }
    | undefined;
  if (!row) return;
  const resolve = (normalized: string) => {
    const target = lookup.get(normalized) ?? null;
    // An article never links to itself: the autocomplete hides it, and a title that
    // happens to match its own text must not become a circular reference.
    return target && !(target.kind === 'article' && target.id === articleId) ? target : null;
  };
  const body = resolvePendingLinks(row.body ?? '', resolve);
  const summary = resolvePendingLinks(row.summary ?? '', resolve);
  const notes = resolvePendingLinks(row.notes ?? '', resolve);
  if (body.resolved + summary.resolved + notes.resolved > 0) {
    db.prepare('UPDATE world_articles SET body = ?, summary = ?, notes = ? WHERE article_id = ?').run(
      body.body,
      summary.body,
      notes.body,
      articleId
    );
  }
  indexEntryLinks({ kind: 'article', id: articleId });
}

/**
 * Delete an article and everything the schema does not delete for it.
 *
 * Its own links go, because they were sentences in a text that no longer exists. Links
 * POINTING at it stay, and degrade to unresolved: that is what shows the author, in red,
 * what they just orphaned, instead of quietly emptying three other entries.
 */
export function deleteWorldArticle(articleId: string): void {
  const db = getDb();
  const run = db.transaction(() => {
    const article = getWorldArticle(articleId);
    db.prepare('DELETE FROM world_links WHERE source_kind = ? AND source_id = ?').run('article', articleId);
    db.prepare("DELETE FROM world_images WHERE entity_kind = 'article' AND entity_id = ?").run(articleId);
    db.prepare('UPDATE world_entry_proposals SET article_id = NULL WHERE article_id = ?').run(articleId);
    if (article) {
      // OR REPLACE because the demotion can collide: a body that linked to this article
      // AND already carried a pending [[same name]] would end up with two rows sharing the
      // composite key, and a plain UPDATE would abort the whole deletion.
      db.prepare('UPDATE OR REPLACE world_links SET target_key = ? WHERE target_key = ?').run(
        pendingKey(article.title),
        entryKey({ kind: 'article', id: articleId })
      );
    }
    db.prepare('DELETE FROM world_articles WHERE article_id = ?').run(articleId);
  });
  run();
}

/** Articles only: the AI's draft, kept apart from the body until the author accepts it. */
export function setArticleProposedBody(articleId: string, body: string | null): void {
  getDb()
    .prepare('UPDATE world_articles SET body_proposed = ?, body_proposed_at = ? WHERE article_id = ?')
    .run(body, body ? now() : null, articleId);
}

export function acceptArticleProposedBody(articleId: string): WorldArticle {
  const current = getWorldArticle(articleId);
  if (!current) throw new Error('Artículo no encontrado.');
  const db = getDb();
  db.prepare('UPDATE world_articles SET body = ?, body_proposed = NULL, body_proposed_at = NULL, updated_at = ? WHERE article_id = ?').run(
    current.proposedBody,
    now(),
    articleId
  );
  saveArticleProse(articleId);
  return getWorldArticle(articleId) as WorldArticle;
}

// ── Missing entries ──────────────────────────────────────────────────────────

interface ProposalRow {
  proposal_id: string;
  term: string;
  term_key: string;
  category: string | null;
  rationale: string | null;
  suggested_summary: string | null;
  evidence: string | null;
  source: string;
  confidence: number | null;
  status: string;
  article_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProposal(row: ProposalRow): WorldEntryProposal {
  let evidence: WorldEntryProposal['evidence'] = [];
  try {
    const parsed = JSON.parse(row.evidence ?? '[]');
    if (Array.isArray(parsed)) evidence = parsed;
  } catch {
    // Hand-edited or half-written JSON must cost the caller a proposal, never the list.
  }
  return {
    proposalId: row.proposal_id,
    term: row.term,
    termKey: row.term_key,
    category: isArticleCategory(row.category) ? row.category : null,
    rationale: row.rationale,
    suggestedSummary: row.suggested_summary,
    evidence,
    source: row.source === 'unresolved_link' ? 'unresolved_link' : 'frequency',
    confidence: row.confidence,
    status: row.status === 'accepted' ? 'accepted' : row.status === 'dismissed' ? 'dismissed' : 'pending',
    articleId: row.article_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Every piece of prose in the world, for the candidate extractor and the scan for holes.
 *
 * The MANUSCRIPT is included, which is the point of M4: a `???` left mid-chapter is a
 * decision the author has not taken, and it should reach «Preguntas abiertas» without a
 * line of code written for it.
 */
export function allWorldBodies(): { key: string; title: string; field: string; text: string }[] {
  const bodies: { key: string; title: string; field: string; text: string }[] = [];
  for (const entry of listWorldEntries()) {
    for (const block of entryIndexableProse({ kind: entry.kind, id: entry.id })) {
      bodies.push({ key: entry.key, title: entry.title, field: block.field, text: block.text });
    }
  }
  return bodies;
}

export function listEntryProposals(status?: 'pending' | 'accepted' | 'dismissed'): WorldEntryProposal[] {
  const db = getDb();
  const rows = (
    status
      ? db
          .prepare('SELECT * FROM world_entry_proposals WHERE status = ? ORDER BY source, confidence DESC, term')
          .all(status)
      : db.prepare('SELECT * FROM world_entry_proposals ORDER BY status, source, confidence DESC, term').all()
  ) as ProposalRow[];
  return rows.map(rowToProposal);
}

/**
 * Record a round of analysis.
 *
 * A term the author already dismissed is NOT written again: the whole value of keeping
 * dismissed rows is that the next run stays quiet about what was already turned down. A
 * pending row is refreshed in place, so its evidence follows the text as it changes.
 */
export function saveEntryProposals(
  candidates: {
    term: string;
    termKey: string;
    source: 'unresolved_link' | 'frequency';
    category?: string | null;
    rationale?: string | null;
    suggestedSummary?: string | null;
    confidence?: number | null;
    evidence: { key: string; title: string; snippet: string }[];
  }[]
): WorldEntryProposal[] {
  const db = getDb();
  const ts = now();
  const run = db.transaction(() => {
    const settled = new Set(
      (db.prepare("SELECT term_key FROM world_entry_proposals WHERE status <> 'pending'").all() as {
        term_key: string;
      }[]).map((row) => row.term_key)
    );
    const fresh = candidates.filter((candidate) => !settled.has(candidate.termKey));
    const keep = new Set(fresh.map((candidate) => candidate.termKey));
    // Pending rows whose term no longer appears anywhere are dropped rather than left to
    // rot: the list must describe the world as it is now.
    for (const row of db.prepare("SELECT proposal_id, term_key FROM world_entry_proposals WHERE status = 'pending'").all() as {
      proposal_id: string;
      term_key: string;
    }[]) {
      if (!keep.has(row.term_key)) {
        db.prepare('DELETE FROM world_entry_proposals WHERE proposal_id = ?').run(row.proposal_id);
      }
    }
    for (const candidate of fresh) {
      const existing = db
        .prepare("SELECT proposal_id FROM world_entry_proposals WHERE term_key = ? AND status = 'pending'")
        .get(candidate.termKey) as { proposal_id: string } | undefined;
      const evidence = JSON.stringify(candidate.evidence);
      if (existing) {
        db.prepare(
          `UPDATE world_entry_proposals SET term = ?, category = ?, rationale = ?, suggested_summary = ?,
              evidence = ?, source = ?, confidence = ?, updated_at = ? WHERE proposal_id = ?`
        ).run(
          candidate.term,
          candidate.category ?? null,
          candidate.rationale ?? null,
          candidate.suggestedSummary ?? null,
          evidence,
          candidate.source,
          candidate.confidence ?? null,
          ts,
          existing.proposal_id
        );
      } else {
        db.prepare(
          `INSERT INTO world_entry_proposals
             (proposal_id, term, term_key, category, rationale, suggested_summary, evidence, source, confidence, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        ).run(
          newId('prp'),
          candidate.term,
          candidate.termKey,
          candidate.category ?? null,
          candidate.rationale ?? null,
          candidate.suggestedSummary ?? null,
          evidence,
          candidate.source,
          candidate.confidence ?? null,
          ts,
          ts
        );
      }
    }
  });
  run();
  return listEntryProposals('pending');
}

/** Turn a proposal into a real article, and link every mention that was waiting for it. */
export function acceptEntryProposal(proposalId: string): WorldArticle {
  const db = getDb();
  const row = db.prepare('SELECT * FROM world_entry_proposals WHERE proposal_id = ?').get(proposalId) as
    | ProposalRow
    | undefined;
  if (!row) throw new Error('Propuesta no encontrada.');
  const proposal = rowToProposal(row);
  const article = createWorldArticle({
    title: proposal.term,
    category: proposal.category ?? 'other',
    summary: proposal.suggestedSummary,
  });
  // `origin` marks what the author never typed themselves, so a world bible can be read
  // knowing which entries arrived by suggestion.
  db.prepare("UPDATE world_articles SET origin = 'ai_proposal' WHERE article_id = ?").run(article.articleId);
  db.prepare("UPDATE world_entry_proposals SET status = 'accepted', article_id = ?, updated_at = ? WHERE proposal_id = ?").run(
    article.articleId,
    now(),
    proposalId
  );
  resolveWorldLink(proposal.term, { kind: 'article', id: article.articleId });
  return getWorldArticle(article.articleId) as WorldArticle;
}

export function dismissEntryProposal(proposalId: string): void {
  getDb()
    .prepare("UPDATE world_entry_proposals SET status = 'dismissed', updated_at = ? WHERE proposal_id = ?")
    .run(now(), proposalId);
}

// ── Full-text search ─────────────────────────────────────────────────────────

/**
 * `%` and `_` are wildcards in LIKE, so a search for "50%" would otherwise ask SQLite for
 * every row in the world.
 *
 * Note what this is and is not: correctness is already guaranteed by the literal
 * `includes` check below, which is what decides the hit. Escaping here is about the QUERY,
 * not the result — without it a single `%` turns six indexed scans into six full scans
 * whose rows are then all thrown away. Exported so that can be asserted directly; through
 * `searchWorldBodies` the two behave identically and a test would prove nothing.
 */
export function likeParam(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * The on-demand half of the search: plain LIKE over every prose column of every kind.
 *
 * The instant half runs in the renderer over the already-loaded index; this one only fires
 * when the author asks for it, which is exactly the stance electron/db/searchRepo.ts takes
 * for the academic corpus. No FTS5: its shadow tables would need three triggers and would
 * land in the sync coverage report as unclassified, for a corpus of a few thousand short
 * rows.
 */
export function searchWorldBodies(query: string, limit = 200): WorldBodyHit[] {
  const needle = (query ?? '').trim();
  if (needle.length < 2) return [];
  const db = getDb();
  const like = likeParam(needle);
  const hits: WorldBodyHit[] = [];

  const collect = (
    kind: WorldEntryKind,
    sql: string,
    columns: { field: string; column: string }[]
  ) => {
    const conditions = columns.map((c) => `${c.column} LIKE ? ESCAPE '\\'`).join(' OR ');
    const rows = db.prepare(sql.replace('__WHERE__', conditions)).all(...columns.map(() => like)) as Record<
      string,
      string | null
    >[];
    for (const row of rows) {
      for (const { field, column } of columns) {
        const text = row[column.includes('.') ? column.split('.')[1] : column];
        if (!text || !text.toLowerCase().includes(needle.toLowerCase())) continue;
        hits.push({
          key: entryKey({ kind, id: row.id as string }),
          kind,
          id: row.id as string,
          title: row.title as string,
          field,
          snippet: extractSnippet(text, needle),
        });
        break;
      }
    }
  };

  collect(
    'article',
    `SELECT article_id AS id, title, body, notes, summary FROM world_articles WHERE __WHERE__`,
    [
      { field: 'body', column: 'body' },
      { field: 'summary', column: 'summary' },
      { field: 'notes', column: 'notes' },
    ]
  );
  collect(
    'character',
    `SELECT p.person_id AS id, p.display_name AS title, c.backstory, c.appearance, c.personality, p.biography, p.notes
       FROM persons p LEFT JOIN character_profiles c ON c.person_id = p.person_id WHERE __WHERE__`,
    [
      { field: 'backstory', column: 'c.backstory' },
      { field: 'appearance', column: 'c.appearance' },
      { field: 'personality', column: 'c.personality' },
      { field: 'biography', column: 'p.biography' },
      { field: 'notes', column: 'p.notes' },
    ]
  );
  collect(
    'place',
    `SELECT pl.place_id AS id, pl.name AS title, pr.appearance, pr.atmosphere, pr.history, pl.notes
       FROM places pl LEFT JOIN place_profiles pr ON pr.place_id = pl.place_id WHERE __WHERE__`,
    [
      { field: 'appearance', column: 'pr.appearance' },
      { field: 'atmosphere', column: 'pr.atmosphere' },
      { field: 'history', column: 'pr.history' },
      { field: 'notes', column: 'pl.notes' },
    ]
  );
  collect(
    'group',
    `SELECT group_id AS id, name AS title, description, summary, notes FROM world_groups WHERE __WHERE__`,
    [
      { field: 'description', column: 'description' },
      { field: 'summary', column: 'summary' },
      { field: 'notes', column: 'notes' },
    ]
  );
  collect(
    'scene',
    `SELECT s.scene_id AS id, s.title, s.summary, s.notes, t.text
       FROM world_scenes s LEFT JOIN world_scene_text t ON t.scene_id = s.scene_id WHERE __WHERE__`,
    [
      { field: 'summary', column: 's.summary' },
      { field: 'notes', column: 's.notes' },
      // The manuscript is searchable like anything else the author wrote. Last, because a
      // hit in the summary describes the scene and a hit in the prose is inside it.
      { field: 'text', column: 't.text' },
    ]
  );
  collect('map', `SELECT map_id AS id, name AS title, notes FROM world_maps WHERE __WHERE__`, [
    { field: 'notes', column: 'notes' },
  ]);

  return hits.slice(0, limit);
}
