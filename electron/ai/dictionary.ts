import { createHash } from "node:crypto";
import type {
  DictionaryAuthorView,
  DictionaryCitationRecord,
  DictionaryDuplicateMatch,
  DictionaryEntryDetail,
  DictionaryEvidenceItem,
  DictionaryGenerationRequest,
  DictionaryScope,
  DictionaryVersion,
} from "@shared/dictionary";
import type {
  IdeaType,
  ModelRef,
  WritingWorkshopSnapshot,
} from "@shared/types";
import { completeJson, embed, embedMany } from "./aiClient";
import { aiVerifyCitations } from "./deepResearch";
import {
  applyCitationPolicy,
  applyVerification,
  buildSnapshotMaps,
  extractCitationClaims,
} from "./deepResearchCore";
import { findSimilarIdeasPaged } from "../db/ideasRepo";
import {
  findSimilarPassagesPaged,
  type SimilarPassage,
} from "../db/passagesRepo";
import { expandCollectionKeys } from "../db/collectionsRepo";
import { getDb } from "../db/database";
import {
  currentDictionaryChangeSequence,
  detectDictionaryDuplicates,
  generationTrigger,
  getDictionaryEntry,
  getDictionaryEntryDetail,
  includedEvidence,
  entriesNeedingDictionaryScan,
  listDictionaryEntries,
  markDictionaryEvidenceScanned,
  normalizeDictionaryTerm,
  saveDictionaryVersion,
  upsertDictionaryEvidence,
  type DictionaryEvidenceUpsert,
} from "../db/dictionaryRepo";

type WorkRow = {
  nodus_id: string;
  title: string;
  authors_json: string;
  year: number | null;
  zotero_key: string | null;
};

type GeneratedDictionary = {
  descriptionMarkdown: string;
  authorSummaries: Array<{ authorName: string; summaryMarkdown: string }>;
};

const isGeneratedDictionary = (
  value: unknown,
): value is GeneratedDictionary => {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.descriptionMarkdown === "string" &&
    row.descriptionMarkdown.trim().length > 0 &&
    Array.isArray(row.authorSummaries) &&
    row.authorSummaries.every(
      (item) =>
        !!item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).authorName === "string" &&
        typeof (item as Record<string, unknown>).summaryMarkdown === "string",
    )
  );
};

function json<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === "string" ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(",");
}

function resolveScopeWorkIds(scope: DictionaryScope): {
  ids: string[];
  restricted: boolean;
} {
  const db = getDb();
  if (scope.kind === "vault") {
    return {
      ids: (
        db
          .prepare("SELECT nodus_id FROM works WHERE archived=0")
          .all() as Array<{ nodus_id: string }>
      ).map((row) => row.nodus_id),
      restricted: false,
    };
  }
  if (scope.kind === "works")
    return { ids: [...new Set(scope.workIds)], restricted: true };
  if (scope.kind === "authors") {
    if (!scope.authorIds.length) return { ids: [], restricted: true };
    return {
      ids: (
        db
          .prepare(
            `SELECT DISTINCT nodus_id FROM work_attributions WHERE author_id IN (${placeholders(scope.authorIds)})`,
          )
          .all(...scope.authorIds) as Array<{ nodus_id: string }>
      ).map((row) => row.nodus_id),
      restricted: true,
    };
  }
  const expanded = expandCollectionKeys(scope.collectionKeys);
  const clauses: string[] = [];
  const params: string[] = [];
  if (scope.zoteroTags.length) {
    clauses.push(`EXISTS (SELECT 1 FROM work_zotero_tags wt JOIN zotero_tags zt ON zt.tag_id=wt.tag_id
      WHERE wt.nodus_id=w.nodus_id AND lower(zt.label) IN (${placeholders(scope.zoteroTags)}))`);
    params.push(...scope.zoteroTags.map((tag) => tag.toLocaleLowerCase()));
  }
  if (expanded.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM work_collections wc WHERE wc.nodus_id=w.nodus_id AND wc.collection_key IN (${placeholders(expanded)}))`,
    );
    params.push(...expanded);
  }
  if (!clauses.length) return { ids: [], restricted: true };
  const rows = db
    .prepare(
      `SELECT w.nodus_id FROM works w WHERE w.archived=0 AND (${clauses.join(" OR ")})`,
    )
    .all(...params) as Array<{ nodus_id: string }>;
  return { ids: rows.map((row) => row.nodus_id), restricted: true };
}

function workRows(ids: string[]): Map<string, WorkRow> {
  if (!ids.length) return new Map();
  const rows = getDb()
    .prepare(
      `SELECT nodus_id,title,authors_json,year,zotero_key FROM works WHERE nodus_id IN (${placeholders(ids)})`,
    )
    .all(...ids) as WorkRow[];
  return new Map(rows.map((row) => [row.nodus_id, row]));
}

function canonicalAuthors(
  workIds: string[],
): Map<string, DictionaryEvidenceItem["authors"]> {
  if (!workIds.length) return new Map();
  const rows = getDb()
    .prepare(
      `SELECT wa.nodus_id,a.author_id,a.name,wa.basis FROM work_attributions wa
    JOIN authors a ON a.author_id=wa.author_id WHERE wa.nodus_id IN (${placeholders(workIds)}) ORDER BY a.name`,
    )
    .all(...workIds) as Array<{
    nodus_id: string;
    author_id: string;
    name: string;
    basis: "author" | "editor_only";
  }>;
  const map = new Map<string, DictionaryEvidenceItem["authors"]>();
  for (const row of rows)
    map.set(row.nodus_id, [
      ...(map.get(row.nodus_id) ?? []),
      { id: row.author_id, name: row.name, attributionBasis: row.basis },
    ]);
  return map;
}

function lexicalIdeaIds(
  query: string,
  workIds: string[],
  limit: number,
): Array<{ global_id: string; similarity: number }> {
  if (!workIds.length) return [];
  const terms = normalizeDictionaryTerm(query)
    .split(" ")
    .filter((term) => term.length >= 3)
    .slice(0, 8);
  if (!terms.length) return [];
  const termSql = terms
    .map(
      () =>
        `(lower(i.label) LIKE ? OR lower(i.statement) LIKE ? OR lower(io.development) LIKE ? OR lower(ev.quote) LIKE ?)`,
    )
    .join(" OR ");
  const params = terms.flatMap((term) => Array(4).fill(`%${term}%`));
  return getDb()
    .prepare(
      `SELECT i.global_id, COUNT(DISTINCT io.nodus_id) + COUNT(DISTINCT ev.id) AS hits
    FROM ideas i JOIN idea_occurrences io ON io.global_id=i.global_id
    LEFT JOIN evidence ev ON ev.global_id=i.global_id AND ev.nodus_id=io.nodus_id
    WHERE io.nodus_id IN (${placeholders(workIds)}) AND (${termSql})
    GROUP BY i.global_id ORDER BY hits DESC LIMIT ?`,
    )
    .all(...workIds, ...params, limit)
    .map((row: any) => ({
      global_id: String(row.global_id),
      similarity: Math.min(0.8, 0.25 + Number(row.hits) * 0.05),
    }));
}

function lexicalPassages(
  query: string,
  workIds: string[],
  limit: number,
): SimilarPassage[] {
  if (!workIds.length) return [];
  const terms = normalizeDictionaryTerm(query)
    .split(" ")
    .filter((term) => term.length >= 3)
    .slice(0, 8);
  if (!terms.length) return [];
  const clauses = terms.map(() => "lower(p.text) LIKE ?").join(" OR ");
  const rows = getDb()
    .prepare(
      `SELECT p.passage_id,p.nodus_id,p.text,p.page_label,w.title,w.authors_json,w.year,w.zotero_key
    FROM passages p JOIN works w ON w.nodus_id=p.nodus_id
    WHERE p.nodus_id IN (${placeholders(workIds)}) AND (${clauses})
      AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash = w.resolved_text_hash)
        OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash)))
    ORDER BY p.chunk_index LIMIT ?`,
    )
    .all(...workIds, ...terms.map((term) => `%${term}%`), limit) as Array<
    Omit<SimilarPassage, "similarity">
  >;
  return rows.map((row, index) => ({
    ...row,
    similarity: Math.max(0.2, 0.65 - index * 0.01),
  }));
}

function ideaEvidence(
  ids: Array<{ global_id: string; similarity: number }>,
  workIds: string[],
  restricted: boolean,
): DictionaryEvidenceUpsert[] {
  if (!ids.length || !workIds.length) return [];
  const db = getDb();
  const workMap = workRows(workIds);
  const authorMap = canonicalAuthors(workIds);
  const selectedIdeaIds = new Set(ids.map((item) => item.global_id));
  const out: DictionaryEvidenceUpsert[] = [];
  for (const hit of ids) {
    // `ideas` has never had an `updated_at` column. Retrieval must use the real
    // persisted shape: asking SQLite for the nonexistent field made every semantic
    // hit fail after the expensive embedding search had already completed.
    const idea = db
      .prepare(
        "SELECT type,label,statement,created_at FROM ideas WHERE global_id=?",
      )
      .get(hit.global_id) as
      | {
          type: IdeaType;
          label: string;
          statement: string;
          created_at?: string;
        }
      | undefined;
    if (!idea) continue;
    const occurrences = db
      .prepare(
        `SELECT nodus_id,development FROM idea_occurrences WHERE global_id=? AND nodus_id IN (${placeholders(workIds)})`,
      )
      .all(hit.global_id, ...workIds) as Array<{
      nodus_id: string;
      development: string;
    }>;
    if (!occurrences.length) continue;
    const scopedWorks = [...new Set(occurrences.map((row) => row.nodus_id))];
    const quotes = db
      .prepare(
        `SELECT quote,location,nodus_id FROM evidence WHERE global_id=? AND nodus_id IN (${placeholders(scopedWorks)}) ORDER BY rowid LIMIT 10`,
      )
      .all(hit.global_id, ...scopedWorks) as Array<{
      quote: string;
      location: string | null;
      nodus_id: string;
    }>;
    const themeRows = db
      .prepare(
        `SELECT DISTINCT t.label FROM idea_theme_links l JOIN themes t ON t.theme_id=l.theme_id
      WHERE l.global_id=? AND l.nodus_id IN (${placeholders(scopedWorks)}) ORDER BY t.label`,
      )
      .all(hit.global_id, ...scopedWorks) as Array<{ label: string }>;
    const relationRows = (
      db
        .prepare(
          `SELECT e.from_id,e.to_id,e.type,e.basis,e.confidence,e.source_work,related.label AS related_label
      FROM edges e JOIN ideas related ON related.global_id=CASE WHEN e.from_id=? THEN e.to_id ELSE e.from_id END
      WHERE e.from_id=? OR e.to_id=? ORDER BY e.confidence DESC LIMIT 24`,
        )
        .all(hit.global_id, hit.global_id, hit.global_id) as Array<{
        from_id: string;
        to_id: string;
        type: string;
        basis: string;
        confidence: number;
        source_work: string | null;
        related_label: string;
      }>
    )
      .filter((row) =>
        selectedIdeaIds.has(
          row.from_id === hit.global_id ? row.to_id : row.from_id,
        ),
      )
      .filter(
        (row) => !row.source_work || scopedWorks.includes(row.source_work),
      );
    const relationParts = relationRows.map((row) => {
      const currentIsSource = row.from_id === hit.global_id;
      const from = currentIsSource ? idea.label : row.related_label;
      const to = currentIsSource ? row.related_label : idea.label;
      return `Relación almacenada en el grafo: «${from}» ${row.type.replaceAll("_", " ")} «${to}» (${row.basis}, confianza ${row.confidence.toFixed(2)}).`;
    });
    const textParts = restricted
      ? [
          idea.label,
          ...occurrences.map((row) => row.development),
          ...quotes.map(
            (row) =>
              `“${row.quote}”${row.location ? ` (${row.location})` : ""}`,
          ),
          ...relationParts,
        ]
      : [
          idea.statement,
          ...occurrences.map((row) => row.development),
          ...quotes.map(
            (row) =>
              `“${row.quote}”${row.location ? ` (${row.location})` : ""}`,
          ),
          ...relationParts,
        ];
    const works = scopedWorks.map((id) => {
      const work = workMap.get(id);
      const authors = authorMap.get(id) ?? [];
      return {
        id,
        title: work?.title ?? id,
        zoteroKey: work?.zotero_key ?? null,
        authors: authors.map((author) => author.name),
        year: work?.year ?? null,
      };
    });
    const allAuthors = new Map<
      string,
      DictionaryEvidenceItem["authors"][number]
    >();
    for (const id of scopedWorks)
      for (const author of authorMap.get(id) ?? [])
        allAuthors.set(author.id ?? author.name, author);
    const primary = works[0];
    const text = textParts.filter((part) => part?.trim()).join("\n\n");
    out.push({
      kind: "idea",
      refId: hit.global_id,
      decision: "unused",
      score: hit.similarity,
      reason: relationParts.length
        ? "Idea recuperada por relevancia semántica con sus relaciones del grafo."
        : "Idea recuperada por relevancia semántica en el ámbito seleccionado.",
      label: idea.label,
      text,
      workId: primary?.id ?? "",
      workTitle: primary?.title ?? "",
      zoteroKey: primary?.zoteroKey ?? null,
      works,
      pageLabel: quotes[0]?.location ?? null,
      authors: [...allAuthors.values()],
      tags: themeRows.map((row) => row.label),
      sourceRevision: createHash("sha256").update(text).digest("hex"),
    });
  }
  return out;
}

function passageEvidence(hits: SimilarPassage[]): DictionaryEvidenceUpsert[] {
  const works = workRows(hits.map((hit) => hit.nodus_id));
  const authors = canonicalAuthors(hits.map((hit) => hit.nodus_id));
  return hits.map((hit) => {
    const work = works.get(hit.nodus_id);
    const workAuthors = authors.get(hit.nodus_id) ?? [];
    return {
      kind: "passage" as const,
      refId: hit.passage_id,
      decision: "unused" as const,
      score: hit.similarity,
      reason:
        "Pasaje recuperado por relevancia semántica en el ámbito seleccionado.",
      label: `${hit.title}${hit.page_label ? ` · ${hit.page_label}` : ""}`,
      text: hit.text,
      workId: hit.nodus_id,
      workTitle: hit.title,
      zoteroKey: hit.zotero_key || null,
      works: [
        {
          id: hit.nodus_id,
          title: hit.title,
          zoteroKey: hit.zotero_key || null,
          authors: workAuthors.map((author) => author.name),
          year: work?.year ?? hit.year,
        },
      ],
      pageLabel: hit.page_label,
      authors: workAuthors.length
        ? workAuthors
        : json<string[]>(hit.authors_json, []).map((name) => ({
            id: null,
            name,
          })),
      tags: [],
      sourceRevision: createHash("sha256").update(hit.text).digest("hex"),
    };
  });
}

export async function retrieveDictionaryEvidence(
  entryId: string,
  mode: "initial" | "scan" = "initial",
): Promise<DictionaryEntryDetail> {
  const entry = getDictionaryEntry(entryId);
  if (!entry) throw new Error("La entrada de Dictionary ya no existe.");
  const scope = resolveScopeWorkIds(entry.scope);
  if (scope.restricted && !scope.ids.length) {
    markDictionaryEvidenceScanned(entryId, currentDictionaryChangeSequence());
    return getDictionaryEntryDetail(entryId)!;
  }
  const query = [entry.name, ...entry.aliases, entry.focusPrompt]
    .filter(Boolean)
    .join(". ");
  let ideaHits: Array<{ global_id: string; similarity: number }> = [];
  let passageHits: SimilarPassage[] = [];
  try {
    const vector = await embed(query);
    if (!vector) throw new Error("No hay un modelo de embeddings disponible.");
    [ideaHits, passageHits] = await Promise.all([
      findSimilarIdeasPaged(vector, -1, 36, { nodusIds: scope.ids }),
      findSimilarPassagesPaged(vector, -1, 30, { nodusIds: scope.ids }),
    ]);
  } catch {
    ideaHits = lexicalIdeaIds(query, scope.ids, 36);
    passageHits = lexicalPassages(query, scope.ids, 30);
  }
  const existing = new Map(
    getDb()
      .prepare(
        "SELECT kind,ref_id,decision FROM dictionary_evidence WHERE entry_id=?",
      )
      .all(entryId)
      .map((row: any) => [`${row.kind}:${row.ref_id}`, String(row.decision)]),
  );
  const candidates = [
    ...ideaEvidence(ideaHits, scope.ids, scope.restricted),
    ...passageEvidence(passageHits),
  ].sort((a, b) => b.score - a.score);
  let selectedIdeas = 0;
  let selectedPassages = 0;
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.refId}`;
    const oldDecision = existing.get(key);
    candidate.isNew = mode === "scan" && !oldDecision;
    if (oldDecision)
      candidate.decision = oldDecision as DictionaryEvidenceUpsert["decision"];
    else if (
      mode === "initial" &&
      ((candidate.kind === "idea" && selectedIdeas < 12) ||
        (candidate.kind === "passage" && selectedPassages < 8))
    ) {
      candidate.decision = "included";
      if (candidate.kind === "idea") selectedIdeas += 1;
      else selectedPassages += 1;
    }
  }
  upsertDictionaryEvidence(entryId, candidates);
  markDictionaryEvidenceScanned(entryId, currentDictionaryChangeSequence());
  return getDictionaryEntryDetail(entryId)!;
}

function makeSnapshot(
  entryId: string,
  evidence: DictionaryEvidenceItem[],
): WritingWorkshopSnapshot {
  const ideas = evidence
    .filter((item) => item.kind === "idea")
    .map((item) => ({
      id: item.id,
      label: item.label,
      summary: item.text,
      score: item.score,
      reason: item.reason,
      type: "construct" as IdeaType,
      statement: item.text,
      themes: item.tags,
      workCount: item.works.length,
      evidenceCount: 1,
      works: item.works.map((work) => ({
        nodus_id: work.id,
        title: work.title,
        authors: work.authors,
        year: work.year,
        zotero_key: work.zoteroKey ?? "",
      })),
    }));
  const passages = evidence
    .filter((item) => item.kind === "passage")
    .map((item) => ({
      id: item.id,
      label: item.label,
      summary: item.text,
      score: item.score,
      reason: item.reason,
      nodus_id: item.workId,
      pageLabel: item.pageLabel,
      authors: item.authors.map((author) => author.name),
      year: item.works[0]?.year ?? null,
      zotero_key: item.zoteroKey ?? "",
      citation: `nodus://passage/${encodeURIComponent(item.id)}`,
    }));
  const entry = getDictionaryEntry(entryId)!;
  return {
    generatedAt: new Date().toISOString(),
    brief: {
      kind: "deep_research",
      objective: `${entry.name}. ${entry.focusPrompt}`,
      language: entry.outputLanguage,
    },
    stats: {
      ideas: ideas.length,
      themes: 0,
      gaps: 0,
      contradictions: 0,
      works: 0,
      passages: passages.length,
      tutorRoutes: 0,
    },
    recommendedSelection: {
      ideaIds: ideas.map((item) => item.id),
      themeIds: [],
      gapIds: [],
      contradictionIds: [],
      workIds: [],
      passageIds: passages.map((item) => item.id),
      tutorRouteIds: [],
    },
    ideas,
    themes: [],
    gaps: [],
    contradictions: [],
    works: [],
    passages,
    tutorRoutes: [],
  };
}

function evidencePrompt(evidence: DictionaryEvidenceItem[]): string {
  return JSON.stringify(
    evidence.map((item) => ({
      type: item.kind,
      id: item.id,
      label: item.label,
      text: item.text,
      authors: item.authors.map((author) => author.name),
      works: item.works.map((work) => ({
        title: work.title,
        authors: work.authors,
        year: work.year,
      })),
      tags: item.tags,
      citation: `[fuente](nodus://${item.kind}/${encodeURIComponent(item.id)})`,
    })),
    null,
    2,
  );
}

function uncitedSubstantiveSentences(markdown: string): string[] {
  const body = markdown
    .replace(/^#{1,6} .*$/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    // Mask Nodus links before splitting into sentences. Citation labels are
    // bibliographic text and commonly contain author initials ("Strand, W.")
    // or years in parentheses; treating the period in an initial as a sentence
    // boundary falsely marks an otherwise fully cited claim as unsupported.
    .replace(/\[[^\]\n]*\]\(nodus:\/\/[^)\s]+\)/g, " CITATION ");
  return body
    .split(/(?<=[.!?])\s+|\n{2,}/u)
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.split(/\s+/).filter(Boolean).length >= 4,
    )
    .filter((part) => !part.includes("CITATION") && !part.includes("nodus://"));
}

function substantiveWordCount(markdown: string): number {
  const body = markdown
    .replace(/^#{1,6} .*$/gm, " ")
    // Citation labels are bibliography, not synthesis. A citation-only response
    // must not become an apparently non-empty Dictionary definition.
    .replace(/\[[^\]\n]*\]\(nodus:\/\/(?:idea|passage)\/[^)\s]+\)/g, " ")
    .replace(/[^\p{L}\p{M}'’\s-]/gu, " ");
  return body.match(/\p{L}[\p{L}\p{M}'’-]*/gu)?.length ?? 0;
}

async function groundGeneratedDescription(
  generated: GeneratedDictionary,
  snapshot: WritingWorkshopSnapshot,
  verifyCitations: typeof aiVerifyCitations,
  model: ModelRef | null,
): Promise<{
  markdown: string;
  problems: string[];
  strippedSentences: string[];
}> {
  const maps = buildSnapshotMaps(snapshot);
  for (const id of [...maps.validIds])
    if (id.startsWith("work:")) maps.validIds.delete(id);
  let cleaned = applyCitationPolicy(generated.descriptionMarkdown, maps).markdown;
  const claims = extractCitationClaims(cleaned, maps);
  let strippedSentences: string[] = [];
  if (claims.length) {
    const outcome = applyVerification(
      cleaned,
      claims,
      await verifyCitations(claims, model),
    );
    cleaned = outcome.markdown;
    strippedSentences = outcome.strippedSentences;
  }

  const survivingClaims = extractCitationClaims(cleaned, maps);
  const uncited = uncitedSubstantiveSentences(cleaned);
  const problems: string[] = [];
  if (substantiveWordCount(cleaned) < 5)
    problems.push("la definición quedó vacía o era demasiado trivial");
  if (!survivingClaims.length)
    problems.push("no sobrevivió ninguna afirmación con una cita válida");
  if (uncited.length)
    problems.push(`${uncited.length} afirmaciones quedaron sin cita`);
  return { markdown: cleaned, problems, strippedSentences };
}

function decorateIdeaTags(
  markdown: string,
  evidence: DictionaryEvidenceItem[],
): string {
  const tags = new Map(
    evidence
      .filter((item) => item.kind === "idea")
      .map((item) => [item.id, item.tags]),
  );
  return markdown.replace(
    /(\[[^\]]+\]\(nodus:\/\/idea\/([^)]+)\))(?!\s*\([^\n)]*\))/g,
    (full, link: string, rawId: string) => {
      let id = rawId;
      try {
        id = decodeURIComponent(rawId);
      } catch {
        /* raw */
      }
      const values = tags.get(id) ?? [];
      return values.length ? `${link} (${values.join(", ")})` : full;
    },
  );
}

async function synthesize(
  entryId: string,
  evidence: DictionaryEvidenceItem[],
  model: ModelRef | null,
  prior: string,
  correction = "",
): Promise<GeneratedDictionary> {
  const entry = getDictionaryEntry(entryId)!;
  const system = `Eres el redactor del Dictionary académico de Nodus. Redacta exclusivamente a partir de EVIDENCE. No uses conocimiento externo ni inventes autores, obras, páginas, citas, etiquetas, ideas o pasajes. El FOCO es una instrucción editorial: nunca lo copies ni lo presentes como definición. Abre con una definición sustantiva del concepto y desarróllala de acuerdo con DETALLE. Cada frase sustantiva debe terminar con una o más citas Markdown exactamente en el formato nodus://idea/ID o nodus://passage/ID ofrecido. Cada fuente citada debe respaldar la frase completa: si dos fuentes sostienen cláusulas distintas, escribe frases separadas, cada una con su propia cita. Compara autores y obras mediante atribuciones separadas; identifica acuerdos, desacuerdos, contradicciones y cambios temporales solo cuando EVIDENCE lo sostenga. Di explícitamente qué no permite establecer la evidencia. Devuelve JSON {"descriptionMarkdown":"...","authorSummaries":[{"authorName":"...","summaryMarkdown":"..."}]}. Los resúmenes de autor también deben estar citados.`;
  const user = `CONCEPTO: ${entry.name}\nALIASES: ${entry.aliases.join(", ")}\nFOCO: ${entry.focusPrompt || "(sin foco adicional)"}\nDETALLE: ${entry.detailLevel}\nIDIOMA DE SALIDA: ${entry.outputLanguage}\n${prior ? `VERSIÓN ACTUAL A ACTUALIZAR SIN COPIAR AFIRMACIONES NO RESPALDADAS:\n${prior}\n` : ""}${correction ? `CORRECCIÓN OBLIGATORIA DE LA SALIDA ANTERIOR:\n${correction}\n` : ""}EVIDENCE:\n${evidencePrompt(evidence)}`;
  let generated = await completeJson<GeneratedDictionary>(
    {
      system,
      user,
      temperature: 0.1,
      maxTokens:
        entry.detailLevel === "detailed"
          ? 6500
          : entry.detailLevel === "concise"
            ? 1800
            : 3800,
    },
    isGeneratedDictionary,
    model,
  );
  if (uncitedSubstantiveSentences(generated.descriptionMarkdown).length) {
    generated = await completeJson<GeneratedDictionary>(
      {
        system: `${system}\nLa versión anterior dejó frases sin cita. Reescríbela: divide o elimina esas frases; ninguna afirmación sustantiva puede quedar sin una cita de EVIDENCE.`,
        user: `${user}\nBORRADOR A REPARAR:\n${JSON.stringify(generated)}`,
        temperature: 0,
        maxTokens: entry.detailLevel === "detailed" ? 6500 : 3800,
      },
      isGeneratedDictionary,
      model,
    );
  }
  return generated;
}

export async function generateDictionaryEntry(
  request: DictionaryGenerationRequest,
): Promise<DictionaryVersion> {
  return generateDictionaryEntryUsing(request, synthesize, aiVerifyCitations);
}

export async function __generateDictionaryEntryForTesting(
  request: DictionaryGenerationRequest,
  generator: typeof synthesize,
  verifyCitations: typeof aiVerifyCitations = aiVerifyCitations,
): Promise<DictionaryVersion> {
  return generateDictionaryEntryUsing(request, generator, verifyCitations);
}

async function generateDictionaryEntryUsing(
  request: DictionaryGenerationRequest,
  generator: typeof synthesize,
  verifyCitations: typeof aiVerifyCitations,
): Promise<DictionaryVersion> {
  const entry = getDictionaryEntry(request.entryId);
  if (!entry) throw new Error("La entrada de Dictionary ya no existe.");
  const evidence = includedEvidence(request.entryId).filter(
    (item) => !item.unavailable && item.text.trim(),
  );
  if (!evidence.length) {
    throw new Error(
      "No se encontró evidencia relevante suficiente en el ámbito seleccionado para generar la definición.",
    );
  }
  const insufficient = evidence.length < 2;
  let markdown: string;
  let authorSummaries: DictionaryAuthorView[] = [];
  if (insufficient) {
    const citation = evidence[0]
      ? ` [evidencia disponible](nodus://${evidence[0].kind}/${encodeURIComponent(evidence[0].id)})`
      : "";
    markdown = `## Evidencia insuficiente\n\nLa evidencia seleccionada es insuficiente para ofrecer una síntesis verificable del concepto.${citation}\n\nNo es posible comparar interpretaciones, establecer acuerdos o desacuerdos, ni describir cambios en el tiempo con el material disponible.`;
  } else {
    const snapshot = makeSnapshot(request.entryId, evidence);
    const maps = buildSnapshotMaps(snapshot);
    for (const id of [...maps.validIds])
      if (id.startsWith("work:")) maps.validIds.delete(id);
    let generated!: GeneratedDictionary;
    let grounded!: Awaited<ReturnType<typeof groundGeneratedDescription>>;
    let correction = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      generated = await generator(
        request.entryId,
        evidence,
        request.model ?? null,
        request.mode === "update" ? entry.contentMarkdown : "",
        correction,
      );
      grounded = await groundGeneratedDescription(
        generated,
        snapshot,
        verifyCitations,
        request.model ?? null,
      );
      if (!grounded.problems.length) break;
      correction = [
        `La salida fue rechazada porque ${grounded.problems.join("; ")}.`,
        "Reescribe desde cero una definición sustantiva. No copies el FOCO.",
        "Haz afirmaciones atómicas y coloca en cada frase solo citas que respalden la frase completa.",
        grounded.strippedSentences.length
          ? `Estas frases no superaron la verificación y no deben repetirse sin estrecharlas: ${grounded.strippedSentences.slice(0, 4).join(" | ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    if (grounded.problems.length)
      throw new Error(
        `El proveedor no produjo una síntesis sustantiva respaldada por citas válidas (${grounded.problems.join("; ")}). La versión anterior se conserva.`,
      );
    markdown = decorateIdeaTags(grounded.markdown, evidence);
    const summaries = new Map(
      generated.authorSummaries.map((item) => [
        normalizeDictionaryTerm(item.authorName),
        item.summaryMarkdown,
      ]),
    );
    const authors = new Map<
      string,
      {
        id: string;
        name: string;
        ideas: Set<string>;
        works: Set<string>;
        basis?: "author" | "editor_only";
      }
    >();
    for (const item of evidence)
      for (const author of item.authors) {
        const id = author.id ?? normalizeDictionaryTerm(author.name);
        const value = authors.get(id) ?? {
          id,
          name: author.name,
          ideas: new Set(),
          works: new Set(),
          basis: author.attributionBasis,
        };
        if (item.kind === "idea") value.ideas.add(item.id);
        for (const work of item.works) value.works.add(work.id);
        authors.set(id, value);
      }
    authorSummaries = [...authors.values()].map((author) => ({
      id: author.id,
      name: author.name,
      ideaCount: author.ideas.size,
      workCount: author.works.size,
      summaryMarkdown: (() => {
        const cleaned = applyCitationPolicy(
          summaries.get(normalizeDictionaryTerm(author.name)) ?? "",
          maps,
        ).markdown;
        // Author cards must not become a side channel for uncited model prose.
        if (
          !extractCitationClaims(cleaned, maps).length ||
          uncitedSubstantiveSentences(cleaned).length
        )
          return "";
        return decorateIdeaTags(cleaned, evidence);
      })(),
      attributionBasis: author.basis,
    }));
  }
  const cited = new Map<string, DictionaryCitationRecord>();
  for (const match of markdown.matchAll(
    /\[([^\]]*)\]\(nodus:\/\/(idea|passage)\/([^)]+)\)/g,
  )) {
    let id = match[3];
    try {
      id = decodeURIComponent(id);
    } catch {
      /* raw */
    }
    const item = evidence.find(
      (candidate) => candidate.kind === match[2] && candidate.id === id,
    );
    if (!item) continue;
    cited.set(`${item.kind}:${id}`, {
      kind: item.kind,
      id,
      label: match[1],
      tags: item.kind === "idea" ? item.tags : [],
    });
  }
  return saveDictionaryVersion({
    entryId: request.entryId,
    contentMarkdown: markdown,
    evidence: evidence.map((item) => ({ kind: item.kind, id: item.id })),
    citations: [...cited.values()],
    authorSummaries,
    model: request.model ?? null,
    trigger: generationTrigger(request),
    state: request.mode === "creation" ? "applied" : "proposed",
    insufficientEvidence: insufficient,
  });
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export async function detectDictionaryDuplicatesSemantic(
  name: string,
  aliases: string[],
): Promise<DictionaryDuplicateMatch[]> {
  const exact = detectDictionaryDuplicates(name, aliases);
  const exactIds = new Set(exact.map((item) => item.entry.id));
  const entries = listDictionaryEntries({
    offset: 0,
    limit: 500,
    sort: { key: "name", dir: "asc" },
  }).items.filter((entry) => !exactIds.has(entry.id));
  if (!name.trim() || !entries.length) return exact;
  try {
    const vectors = await embedMany([
      [name, ...aliases].join(". "),
      ...entries.map((entry) => [entry.name, ...entry.aliases].join(". ")),
    ]);
    const query = vectors[0];
    if (!query) return exact;
    return [
      ...exact,
      ...entries
        .map((entry, index) => ({
          entry,
          match: "semantic" as const,
          similarity: vectors[index + 1]
            ? cosine(query, vectors[index + 1]!)
            : 0,
        }))
        .filter((item) => item.similarity >= 0.78)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 8),
    ];
  } catch {
    return exact;
  }
}

export function dictionaryEntryNeedsScan(entryId: string): boolean {
  const entry = getDictionaryEntry(entryId);
  return (
    !!entry &&
    entry.lastEvidenceScanAt !== null &&
    entry.newEvidenceCount === 0 &&
    (
      getDb()
        .prepare(
          "SELECT COALESCE(MAX(seq),0) AS seq FROM dictionary_corpus_changes",
        )
        .get() as { seq: number }
    ).seq >
      (
        getDb()
          .prepare("SELECT last_change_seq FROM dictionary_entries WHERE id=?")
          .get(entryId) as { last_change_seq: number }
      ).last_change_seq
  );
}

export async function scanChangedDictionaryEntries(
  limit = 4,
): Promise<string[]> {
  const ids = entriesNeedingDictionaryScan(limit);
  for (const id of ids) await retrieveDictionaryEvidence(id, "scan");
  return ids;
}
