import { useEffect, useMemo, useRef, useState } from "react";
import type { VaultType } from "@shared/vaultTypes";
import { Icon } from "../../components/ui";
import { api } from "../api";
import type { JsonRecord } from "../types";
import {
  AcademicDetailExplorer,
  type AcademicTarget,
} from "./AcademicDetailExplorer";
import { t, tx } from "../i18nShim";

type SearchMode = "text" | "semantic";
type SearchKind =
  | "note"
  | "idea"
  | "work"
  | "passage"
  | "gap"
  | "theme"
  | "author"
  | "person"
  | "event"
  | "archive"
  | "place"
  | "group"
  | "scene"
  | "article"
  | "thread"
  | "rule"
  | "question"
  | "course"
  | "material"
  | "studyQuestion"
  | "studyIdea"
  | "exam"
  | "rubric"
  | "interview"
  | "transcript"
  | "code"
  | "contrast"
  | "database"
  | "page"
  | "document"
  | "prosopStudy"
  | "prosopVariable"
  | "prosopSource"
  | "other";

const KIND_META_SOURCE: Record<SearchKind, { label: string; icon: string }> = {
  note: { label: "Notas", icon: "notebook" },
  idea: { label: "Ideas", icon: "bulb" },
  work: { label: "Obras", icon: "book" },
  passage: { label: "Pasajes", icon: "quote" },
  gap: { label: "Huecos", icon: "gap" },
  theme: { label: "Temas", icon: "tag" },
  author: { label: "Autores", icon: "graduation" },
  other: { label: "Otros", icon: "search" },
  person: { label: "Personas", icon: "users" },
  event: { label: "Eventos", icon: "clock" },
  archive: { label: "Documentos", icon: "archive" },
  place: { label: "Lugares", icon: "map" },
  group: { label: "Grupos", icon: "users" },
  scene: { label: "Escenas", icon: "image" },
  article: { label: "Artículos", icon: "book" },
  thread: { label: "Hilos", icon: "route" },
  rule: { label: "Reglas", icon: "lock" },
  question: { label: "Preguntas", icon: "help" },
  course: { label: "Cursos", icon: "graduation" },
  material: { label: "Materiales", icon: "book" },
  studyQuestion: { label: "Preguntas de estudio", icon: "help" },
  studyIdea: { label: "Ideas de estudio", icon: "bulb" },
  exam: { label: "Exámenes", icon: "notebook" },
  rubric: { label: "Rúbricas", icon: "table" },
  interview: { label: "Entrevistas", icon: "microphone" },
  transcript: { label: "Transcripciones", icon: "notebook" },
  code: { label: "Códigos", icon: "tag" },
  contrast: { label: "Contrastes", icon: "scale" },
  database: { label: "Bases de datos", icon: "table" },
  page: { label: "Páginas", icon: "notebook" },
  document: { label: "Documentos", icon: "book" },
  prosopStudy: { label: "Estudios", icon: "compass" },
  prosopVariable: { label: "Variables agregadas", icon: "chartBar" },
  prosopSource: { label: "Tipos de fuente", icon: "archive" },
};
// Resolve labels at render/access time so changing the server language updates
// existing search filters without rebuilding this module.
const KIND_META = new Proxy(KIND_META_SOURCE, {
  get(target, property: string) {
    const meta = target[property as SearchKind];
    return meta ? { ...meta, label: t(meta.label) } : undefined;
  },
});
const ACADEMIC_TEXT_KINDS: SearchKind[] = [
  "note",
  "idea",
  "work",
  "gap",
  "theme",
  "author",
  "passage",
];
function textKinds(vaultType: VaultType | undefined): SearchKind[] {
  if (vaultType === "genealogy")
    return ["person", "event", "archive", "place", "work", "note"];
  if (vaultType === "primary_sources")
    return [
      "person",
      "event",
      "archive",
      "place",
      "work",
      "idea",
      "author",
      "note",
    ];
  if (vaultType === "prosopography")
    return ["prosopStudy", "prosopVariable", "prosopSource", "note"];
  if (vaultType === "worldbuilding")
    return [
      "person",
      "place",
      "group",
      "scene",
      "article",
      "thread",
      "rule",
      "question",
      "note",
    ];
  if (vaultType === "databases") return ["database", "page", "note"];
  if (vaultType === "estudio")
    return [
      "course",
      "material",
      "document",
      "studyQuestion",
      "studyIdea",
      "event",
      "note",
    ];
  if (vaultType === "docencia")
    return ["course", "material", "studyQuestion", "exam", "rubric", "note"];
  if (vaultType === "testimonios")
    return ["interview", "transcript", "code", "contrast", "note"];
  return ACADEMIC_TEXT_KINDS;
}
const SEMANTIC_KINDS: SearchKind[] = ["idea", "passage", "work"];

type SearchHit = {
  kind: SearchKind;
  type: string;
  id: string;
  title: string;
  subtitle: string;
  snippet: string;
  similarity?: number;
};
type SavedSearch = {
  id: string;
  name: string;
  query: string;
  mode: SearchMode;
  kinds: SearchKind[];
};
type PublishedAcademicTarget = {
  collection: "passages" | "themes" | "gaps";
  id: string;
  label: string;
};

function hitKind(type: unknown): SearchKind {
  const value = String(type ?? "").toLowerCase();
  if (value === "ideas") return "idea";
  if (value === "works") return "work";
  if (value === "notes") return "note";
  if (value === "passages") return "passage";
  if (value === "gaps") return "gap";
  if (value === "themes") return "theme";
  if (value === "authors") return "author";
  if (value === "persons" || value === "character_profiles") return "person";
  if (
    value === "events" ||
    value === "study_calendar_events" ||
    value === "study-calendar"
  )
    return "event";
  if (
    value === "archive_items" ||
    value === "archive-repositories" ||
    value === "archive_description_units" ||
    value === "archive_excerpts" ||
    value === "archive_source_analyses" ||
    value.startsWith("archive-")
  )
    return "archive";
  if (value === "places") return "place";
  if (value === "world_groups" || value === "world-groups") return "group";
  if (value === "world_scenes" || value === "world-scenes") return "scene";
  if (value === "world_articles" || value === "world-articles")
    return "article";
  if (value === "world_threads" || value === "world-threads") return "thread";
  if (value === "world_rules" || value === "world-rules") return "rule";
  if (value === "world_questions" || value === "world-questions")
    return "question";
  if (
    value === "study_courses" ||
    value === "study-courses" ||
    value === "study_subjects"
  )
    return "course";
  if (value === "study_materials" || value === "study-materials")
    return "material";
  if (value === "study_docs" || value === "study-docs") return "document";
  if (
    value === "study_questions" ||
    value === "study-questions" ||
    value === "study_flashcards"
  )
    return "studyQuestion";
  if (value === "study_ideas" || value === "study-ideas") return "studyIdea";
  if (value === "teaching_exams" || value === "teaching-exams") return "exam";
  if (value === "teaching_rubrics" || value === "teaching-rubrics")
    return "rubric";
  if (value === "testimony_interviews" || value === "testimony-interviews")
    return "interview";
  if (value === "testimony_transcripts" || value === "testimony-transcripts")
    return "transcript";
  if (value === "testimony_codes" || value === "testimony-codes") return "code";
  if (value === "testimony_contrasts" || value === "testimony-contrasts")
    return "contrast";
  if (value === "prosopography-public-population") return "prosopStudy";
  if (value === "prosopography-public-variables") return "prosopVariable";
  if (value === "prosopography-public-sources") return "prosopSource";
  if (value === "db_databases" || value === "databases") return "database";
  if (value === "db_rows") return "database";
  if (value === "pages" || value === "database-pages") return "page";
  return "other";
}

function normalize(row: JsonRecord): SearchHit {
  const kind =
    row.kind === "prosopStudy" ||
    row.kind === "prosopVariable" ||
    row.kind === "prosopSource"
      ? row.kind
      : hitKind(row.type);
  return {
    kind,
    type: String(row.type ?? ""),
    id: String(row.id ?? ""),
    title: String(
      row.title ??
        row.label ??
        row.name ??
        row.display_name ??
        row.full_name ??
        row.question ??
        row.prompt ??
        t("Resultado sin título"),
    ),
    subtitle: String(row.subtitle ?? ""),
    snippet: String(row.snippet ?? row.excerpt ?? ""),
    similarity: typeof row.similarity === "number" ? row.similarity : undefined,
  };
}

/** Published snapshot tables use SQLite snake_case names; REST collections use the
 * same Desktop-facing kebab-case names as the catalogue endpoints. */
function restCollection(type: string): string {
  const aliases: Record<string, string> = {
    world_groups: "world-groups",
    world_scenes: "world-scenes",
    world_articles: "world-articles",
    world_threads: "world-threads",
    world_rules: "world-rules",
    world_questions: "world-questions",
    study_courses: "study-courses",
    study_subjects: "study-subjects",
    study_topics: "study-topics",
    study_docs: "study-docs",
    study_materials: "study-materials",
    study_flashcards: "study-flashcards",
    study_questions: "study-questions",
    study_ideas: "study-ideas",
    study_plans: "study-plans",
    study_goals: "study-goals",
    study_calendar_events: "study-calendar",
    teaching_exams: "teaching-exams",
    teaching_rubrics: "teaching-rubrics",
    archive_items: "archive-items",
    archive_repositories: "archive-repositories",
    archive_description_units: "archive-units",
    archive_excerpts: "archive-excerpts",
    archive_source_analyses: "source-analyses",
    testimony_interviews: "testimony-interviews",
    testimony_transcripts: "testimony-transcripts",
    testimony_codes: "testimony-codes",
    testimony_contrasts: "testimony-contrasts",
    db_databases: "databases",
    db_rows: "databases",
    prosopography_public_population: "prosopography-public-population",
    prosopography_public_variables: "prosopography-public-variables",
    prosopography_public_sources: "prosopography-public-sources",
    prosopography_public_analysis: "prosopography-public-analysis",
    prosopography_public_networks: "prosopography-public-networks",
  };
  return aliases[type] ?? type;
}

function storageKey(spaceId: string) {
  return `nodus.server.savedSearches.${spaceId}`;
}
function readSaved(spaceId: string): SavedSearch[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(spaceId)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry): SavedSearch[] => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as Partial<SavedSearch>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.name !== "string" ||
        typeof candidate.query !== "string"
      )
        return [];
      const mode: SearchMode =
        candidate.mode === "semantic" ? "semantic" : "text";
      const kinds = Array.isArray(candidate.kinds)
        ? candidate.kinds.filter(
            (kind): kind is SearchKind =>
              typeof kind === "string" && kind in KIND_META,
          )
        : [];
      return [
        {
          id: candidate.id,
          name: candidate.name,
          query: candidate.query,
          mode,
          kinds,
        },
      ];
    });
  } catch {
    return [];
  }
}

function writeSaved(spaceId: string, value: SavedSearch[]): void {
  try {
    localStorage.setItem(storageKey(spaceId), JSON.stringify(value));
  } catch {
    /* A blocked quota must not break global search. */
  }
}

function PublishedAcademicDetail({
  spaceId,
  target,
  onBack,
}: {
  spaceId: string;
  target: PublishedAcademicTarget;
  onBack: () => void;
}) {
  const [data, setData] = useState<JsonRecord>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let alive = true;
    setData(undefined);
    setError(undefined);
    api
      .detail(spaceId, target.collection, target.id)
      .then((next) => {
        if (alive) setData(next);
      })
      .catch((cause) => {
        if (alive) setError(cause);
      });
    return () => {
      alive = false;
    };
  }, [spaceId, target.collection, target.id]);
  const primaryKey =
    target.collection === "passages"
      ? "passage"
      : target.collection === "themes"
        ? "theme"
        : "gap";
  const primary = data?.[primaryKey] as JsonRecord | undefined;
  const related = data
    ? Object.entries(data).filter(
        ([key, value]) => key !== primaryKey && Array.isArray(value),
      )
    : [];
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid="academic-search-record-detail"
    >
      <nav className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800">
        <button
          className="btn btn-ghost h-7 gap-1 px-2 text-xs"
          onClick={onBack}
        >
          <Icon name="chevronLeft" size={13} />
          {t("Buscar")}
        </button>
        <span className="text-xs text-neutral-400">/</span>
        <span className="truncate text-xs text-neutral-500">
          {target.label}
        </span>
        <span className="ml-auto rounded-full border border-neutral-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
          {t("Solo lectura")}
        </span>
      </nav>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="mx-auto max-w-5xl">
          {error ? (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {t("No se ha podido cargar este registro.")}
            </div>
          ) : !data ? (
            <div className="grid h-48 place-items-center text-sm text-neutral-500">
              {t("Cargando…")}
            </div>
          ) : (
            <>
              <header className="mb-5 border-b border-neutral-200 pb-4 dark:border-neutral-800">
                <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-indigo-600 dark:text-indigo-300">
                  {target.collection === "passages"
                    ? t("Pasaje")
                    : target.collection === "themes"
                      ? t("Tema")
                      : t("Hueco")}
                </p>
                <h1 className="mt-1 text-xl font-semibold">{target.label}</h1>
                <p className="mt-1 text-xs text-neutral-500">
                  {t("Registro publicado")} ·{" "}
                  {t("contexto y evidencia disponibles")}
                </p>
              </header>
              <article className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                <dl className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {Object.entries(primary || {})
                    .filter(
                      ([, value]) =>
                        value !== null &&
                        value !== undefined &&
                        typeof value !== "object",
                    )
                    .map(([key, value]) => (
                      <div
                        key={key}
                        className="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 py-2.5 text-xs"
                      >
                        <dt className="font-semibold uppercase tracking-wide text-neutral-500">
                          {key.replace(/_/g, " ")}
                        </dt>
                        <dd className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">
                          {String(value)}
                        </dd>
                      </div>
                    ))}
                </dl>
              </article>
              {related.map(([key, value]) => (
                <section key={key} className="mt-5">
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    {key.replace(/_/g, " ")}
                  </h2>
                  <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
                    <table className="w-full text-left text-xs">
                      <tbody>
                        {(value as JsonRecord[]).map((entry, index) => (
                          <tr
                            key={String(entry.id || entry.global_id || index)}
                            className="border-t border-neutral-200 first:border-t-0 dark:border-neutral-800"
                          >
                            <td className="px-3 py-2 font-medium">
                              {String(
                                entry.title ||
                                  entry.label ||
                                  entry.name ||
                                  entry.global_id ||
                                  entry.id ||
                                  t("Registro"),
                              )}
                            </td>
                            <td className="px-3 py-2 text-neutral-500">
                              {String(
                                entry.statement ||
                                  entry.description ||
                                  entry.text ||
                                  entry.nodus_id ||
                                  "",
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function SearchServerView({
  spaceId,
  vaultType,
  onNavigate,
}: {
  spaceId: string;
  vaultType?: VaultType;
  onNavigate?: (collection: string, id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("text");
  const [activeKinds, setActiveKinds] = useState<Set<SearchKind>>(
    () => new Set(textKinds(vaultType)),
  );
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [saved, setSaved] = useState<SavedSearch[]>(() => readSaved(spaceId));
  const [tabs, setTabs] = useState<AcademicTarget[]>([]);
  const [active, setActive] = useState<AcademicTarget | null>(null);
  const [record, setRecord] = useState<PublishedAcademicTarget | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    setSaved(readSaved(spaceId));
  }, [spaceId]);
  useEffect(() => {
    setActiveKinds(new Set(textKinds(vaultType)));
  }, [vaultType]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      request.current += 1;
      setResults([]);
      setSearched(false);
      setUnavailable(false);
      setLoading(false);
      return;
    }
    const id = ++request.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void api
        .search(spaceId, q)
        .then((response) => {
          if (id !== request.current) return;
          const serverMode = String(response.mode ?? "lexical");
          setUnavailable(mode === "semantic" && serverMode !== "semantic");
          setResults((response.results ?? []).map(normalize));
          setSearched(true);
        })
        .catch(() => {
          if (id === request.current) {
            setResults([]);
            setSearched(true);
          }
        })
        .finally(() => {
          if (id === request.current) setLoading(false);
        });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [mode, query, spaceId]);

  const availableKinds =
    mode === "semantic" ? SEMANTIC_KINDS : textKinds(vaultType);
  const visible = useMemo(
    () => results.filter((result) => activeKinds.has(result.kind)),
    [activeKinds, results],
  );
  const grouped = useMemo(
    () =>
      availableKinds
        .map((kind) => ({
          kind,
          items: visible.filter((item) => item.kind === kind),
        }))
        .filter((group) => group.items.length > 0),
    [availableKinds, visible],
  );
  const persist = (next: SavedSearch[]) => {
    setSaved(next);
    writeSaved(spaceId, next);
  };
  const switchMode = (next: SearchMode) => {
    setMode(next);
    setActiveKinds(
      new Set(next === "semantic" ? SEMANTIC_KINDS : textKinds(vaultType)),
    );
  };
  const toggleKind = (kind: SearchKind) =>
    setActiveKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next.size ? next : new Set(availableKinds);
    });
  const open = (hit: SearchHit) => {
    const academic =
      hit.kind === "idea" || hit.kind === "work" || hit.kind === "author"
        ? ({ kind: hit.kind, id: hit.id, label: hit.title } as AcademicTarget)
        : null;
    if (hit.kind === "passage" || hit.kind === "theme" || hit.kind === "gap") {
      const collection =
        hit.kind === "passage"
          ? "passages"
          : hit.kind === "theme"
            ? "themes"
            : "gaps";
      setRecord({ collection, id: hit.id, label: hit.title });
      return;
    }
    if (!academic) {
      onNavigate?.(restCollection(hit.type), hit.id);
      return;
    }
    setTabs((current) =>
      current.some(
        (tab) => tab.kind === academic.kind && tab.id === academic.id,
      )
        ? current
        : [...current, academic],
    );
    setActive(academic);
  };
  const closeTab = (target: AcademicTarget) => {
    setTabs((current) =>
      current.filter(
        (tab) => !(tab.kind === target.kind && tab.id === target.id),
      ),
    );
    if (active?.kind === target.kind && active.id === target.id)
      setActive(null);
  };

  if (record)
    return (
      <PublishedAcademicDetail
        spaceId={spaceId}
        target={record}
        onBack={() => setRecord(null)}
      />
    );

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid="academic-search-view"
    >
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name="search" size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">{t("Búsqueda global")}</h1>
            <p className="text-[11px] text-neutral-500">
              {t("Busca en todo el espacio publicado.")}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 items-end gap-1 overflow-x-auto">
          <button
            className={`flex h-9 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs ${!active ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900" : "border-transparent text-neutral-500"}`}
            onClick={() => setActive(null)}
          >
            <Icon name="search" size={13} /> {t("Buscar")}
          </button>
          {tabs.map((tab) => (
            <div
              key={`${tab.kind}:${tab.id}`}
              className={`flex h-9 shrink-0 items-center rounded-t-lg border border-b-0 ${active?.kind === tab.kind && active.id === tab.id ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900" : "border-transparent text-neutral-500"}`}
            >
              <button
                className="flex h-full max-w-72 min-w-0 items-center gap-2 px-3 text-xs"
                onClick={() => setActive(tab)}
              >
                <Icon name={KIND_META[tab.kind].icon} size={13} />
                <span className="truncate">{tab.label}</span>
              </button>
              <button
                className="mr-1 grid h-6 w-6 place-items-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-800"
                aria-label={`${t("Cerrar")} ${tab.label}`}
                onClick={() => closeTab(tab)}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>
      </header>
      {active ? (
        <div className="min-h-0 flex-1">
          <AcademicDetailExplorer
            key={`${active.kind}:${active.id}`}
            spaceId={spaceId}
            origin={t("Buscar")}
            initialTarget={active}
            onOrigin={() => setActive(null)}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col p-6">
          <div className="mx-auto w-full max-w-3xl shrink-0">
            <div className="mb-4 flex items-center gap-3">
              <Icon
                name="search"
                size={22}
                className="text-indigo-500 dark:text-indigo-300"
              />
              <h2 className="text-xl font-semibold">{t("Búsqueda global")}</h2>
              <div className="ml-auto inline-flex overflow-hidden rounded-md border border-neutral-300 text-xs dark:border-neutral-700">
                <button
                  className={`px-3 py-1.5 ${mode === "text" ? "bg-indigo-600 text-white" : "text-neutral-500"}`}
                  onClick={() => switchMode("text")}
                >
                  {t("Texto")}
                </button>
                <button
                  className={`px-3 py-1.5 ${mode === "semantic" ? "bg-indigo-600 text-white" : "text-neutral-500"}`}
                  onClick={() => switchMode("semantic")}
                >
                  {t("Significado")}
                </button>
              </div>
            </div>
            <div className="relative">
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
              />
              <input
                ref={input}
                className="input input-with-leading-icon w-full"
                placeholder={t(
                  mode === "semantic"
                    ? "Describe una idea o pregunta; busca por significado en ideas, pasajes y obras…"
                    : "Busca en notas, ideas, obras, huecos, temas y autores…",
                )}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {loading && (
                <span className="absolute right-3 top-1/2 flex -translate-y-1/2">
                  <Icon
                    name="sync"
                    size={15}
                    className="animate-spin text-neutral-500"
                  />
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {availableKinds.map((kind) => (
                <button
                  key={kind}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${activeKinds.has(kind) ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200" : "border-neutral-300 text-neutral-500 dark:border-neutral-700"}`}
                  onClick={() => toggleKind(kind)}
                >
                  <Icon name={KIND_META[kind].icon} size={12} />
                  {KIND_META[kind].label}
                </button>
              ))}
              {query.trim().length >= 2 && (
                <button
                  className="ml-auto inline-flex items-center gap-1 rounded-full border border-neutral-300 px-2.5 py-1 text-xs text-neutral-500 dark:border-neutral-700"
                  onClick={() =>
                    persist([
                      ...saved,
                      {
                        id: crypto.randomUUID(),
                        name: query.trim(),
                        query: query.trim(),
                        mode,
                        kinds: [...activeKinds],
                      },
                    ])
                  }
                >
                  <Icon name="star" size={12} /> {t("Guardar")}
                </button>
              )}
            </div>
            {saved.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-neutral-500">
                  {t("Guardadas:")}
                </span>
                {saved.map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 pl-2.5 pr-1 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <button
                      onClick={() => {
                        setMode(item.mode);
                        setActiveKinds(new Set(item.kinds));
                        setQuery(item.query);
                      }}
                    >
                      {item.name}
                    </button>
                    <button
                      className="ml-1 text-neutral-500 hover:text-red-500"
                      onClick={() =>
                        persist(saved.filter((entry) => entry.id !== item.id))
                      }
                    >
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {unavailable && (
              <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                {t(
                  "La búsqueda por significado necesita embeddings. Configura el proveedor y la clave de embeddings en Ajustes e indexa la biblioteca.",
                )}
              </p>
            )}
            {searched && !unavailable && (
              <p className="mt-2 text-xs text-neutral-500">
                {tx("{n} resultado(s) en {g} categoría(s).", {
                  n: visible.length,
                  g: grouped.length,
                })}
              </p>
            )}
          </div>
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl space-y-5">
              {query.trim().length < 2 && (
                <p className="py-10 text-center text-sm text-neutral-500">
                  {t(
                    "Escribe al menos dos caracteres para buscar en todo el espacio de trabajo.",
                  )}
                </p>
              )}
              {searched && !unavailable && visible.length === 0 && (
                <p className="py-10 text-center text-sm text-neutral-500">
                  {t("Sin resultados.")}
                </p>
              )}
              {!unavailable &&
                grouped.map(({ kind, items }) => (
                  <section key={kind}>
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      <Icon name={KIND_META[kind].icon} size={14} />
                      {KIND_META[kind].label}
                      <span>({items.length})</span>
                    </div>
                    <div className="divide-y divide-neutral-200 overflow-hidden rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
                      {items.map((hit) => (
                        <button
                          key={`${hit.type}:${hit.id}`}
                          className="grid min-h-14 w-full grid-cols-[1.5rem_minmax(0,1fr)_2rem] items-start gap-2 px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900"
                          onClick={() => open(hit)}
                        >
                          <Icon
                            name={KIND_META[kind].icon}
                            size={15}
                            className="mt-0.5 text-neutral-500"
                          />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <strong className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                {hit.title}
                              </strong>
                              {hit.subtitle && (
                                <small className="truncate text-xs font-normal text-neutral-500">
                                  {hit.subtitle}
                                </small>
                              )}
                            </span>
                            {hit.snippet && (
                              <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-neutral-500">
                                {hit.snippet}
                              </span>
                            )}
                          </span>
                          <Icon
                            name="chevronRight"
                            size={13}
                            className="mt-1 text-neutral-400"
                          />
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
