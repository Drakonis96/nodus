import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  DictionaryDuplicateMatch,
  DictionaryEntry,
  DictionaryEntryDetail,
  DictionaryEntryInput,
  DictionaryEntryPatch,
  DictionaryEntryStatus,
  DictionaryEntrySummary,
  DictionaryEvidenceDecision,
  DictionaryEvidenceItem,
  DictionaryFacets,
  DictionaryScope,
  DictionarySortKey,
  DictionaryProgress,
  DictionaryVersion,
} from "@shared/dictionary";
import type {
  AppSettings,
  AuthorSummary,
  CollectionFacet,
  ModelRef,
  PromptLanguage,
  WorkView,
  ZoteroTag,
} from "@shared/types";
import { PROMPT_LANGUAGES } from "@shared/types";
import { ConfirmModal } from "../components/ConfirmModal";
import { Markdown, type MarkdownCitation } from "../components/Markdown";
import { ModelPicker } from "../components/ModelPicker";
import {
  SourceCitationModal,
  type CitationTarget,
} from "../components/SourceCitationModal";
import { WorkspaceTabStrip } from "../components/library/LibraryWorkspaceTabs";
import { Icon, Spinner } from "../components/ui";
import { useFeatureModel } from "../hooks/useFeatureModel";
import { getActiveLang, pick, t as appT } from "../i18n";
import { DICTIONARY_TRANSLATIONS } from "../i18n.dictionary";

type DetailTab = "overview" | "evidence" | "authors" | "works" | "versions";
type DictionaryTranslationTable = Record<string, string>;
const t = (es: string): string => {
  const language = getActiveLang();
  if (language === "es") return es;
  return (
    (DICTIONARY_TRANSLATIONS[language] as DictionaryTranslationTable)[es] ??
    appT(es)
  );
};
const tx = (es: string, vars: Record<string, string | number>): string => {
  let translated = t(es);
  for (const [name, value] of Object.entries(vars)) {
    translated = translated.split(`{${name}}`).join(String(value));
  }
  return translated;
};
type CatalogData = {
  authors: AuthorSummary[];
  works: WorkView[];
  tags: ZoteroTag[];
  collections: CollectionFacet[];
};
const emptyCatalog: CatalogData = {
  authors: [],
  works: [],
  tags: [],
  collections: [],
};
const emptyInput = (): DictionaryEntryInput => ({
  name: "",
  aliases: [],
  focusPrompt: "",
  scope: { kind: "vault" },
  outputLanguage: "es",
  detailLevel: "standard",
});
const promptLanguageLabel = (language: PromptLanguage): string => {
  switch (language) {
    case "es":
      return t("Español");
    case "en":
      return t("English");
    case "fr":
      return t("Français");
    case "tr":
      return t("Türkçe");
    case "de":
      return t("Deutsch");
    case "pt":
      return t("Português");
    case "pt-BR":
      return t("Português (Brasil)");
    case "it":
      return t("Italiano");
  }
};
const dictionaryStatusLabel = (status: DictionaryEntryStatus): string => {
  if (status === "active") {
    return pick({
      es: "Activo",
      en: "Active",
      fr: "Actif",
      de: "Aktiv",
      pt: "Ativo",
      "pt-BR": "Ativo",
      it: "Attivo",
      tr: "Etkin",
    });
  }
  if (status === "archived") {
    return pick({
      es: "Archivado",
      en: "Archived",
      fr: "Archivé",
      de: "Archiviert",
      pt: "Arquivado",
      "pt-BR": "Arquivado",
      it: "Archiviato",
      tr: "Arşivlendi",
    });
  }
  return pick({
    es: "Borrador",
    en: "Draft",
    fr: "Brouillon",
    de: "Entwurf",
    pt: "Rascunho",
    "pt-BR": "Rascunho",
    it: "Bozza",
    tr: "Taslak",
  });
};
const panel =
  "rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950/70";

const csv = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(getActiveLang(), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs text-neutral-600 dark:text-neutral-400">
      {label}
      {children}
    </label>
  );
}

function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
    >
      {children}
    </p>
  );
}

function ButtonBusy({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 !text-white">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      {label}
    </span>
  );
}

function dictionaryProgressText(value: string): string {
  const known = new Set([
    "En cola",
    "Analizando corpus…",
    "Generando definición…",
    "Redactando definición…",
    "Comprobando…",
  ]);
  return known.has(value) ? t(value) : value;
}

function dictionaryVersionText(value: string): string {
  const key = value.replaceAll("_", " ");
  return t(key);
}

function StatusPill({ status }: { status: string }) {
  const classes =
    status === "active"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
      : status === "archived"
        ? "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
        : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${classes}`}
    >
      {dictionaryStatusLabel(
        status === "active" || status === "archived" ? status : "draft",
      )}
    </span>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
      {children}
    </span>
  );
}

function ScopeEditor({
  value,
  onChange,
  catalog,
}: {
  value: DictionaryScope;
  onChange: (value: DictionaryScope) => void;
  catalog: CatalogData;
}) {
  const toggle = (values: string[], id: string) =>
    values.includes(id)
      ? values.filter((value) => value !== id)
      : [...values, id];
  return (
    <div className="space-y-3">
      <Field label={t("Ámbito")}>
        <select
          className="input mt-1 w-full"
          value={value.kind}
          onChange={(event) => {
            const kind = event.target.value as DictionaryScope["kind"];
            onChange(
              kind === "vault"
                ? { kind }
                : kind === "authors"
                  ? { kind, authorIds: [] }
                  : kind === "works"
                    ? { kind, workIds: [] }
                    : { kind, zoteroTags: [], collectionKeys: [] },
            );
          }}
        >
          <option value="vault">{t("Toda la bóveda")}</option>
          <option value="authors">{t("Autores seleccionados")}</option>
          <option value="works">{t("Obras seleccionadas")}</option>
          <option value="tags_collections">
            {t("Etiquetas o colecciones")}
          </option>
        </select>
      </Field>
      {value.kind === "authors" && (
        <ChoiceGrid
          items={catalog.authors.map((author) => ({
            id: author.author_id,
            label: author.fullName || author.name,
          }))}
          selected={value.authorIds}
          onToggle={(id) =>
            onChange({ ...value, authorIds: toggle(value.authorIds, id) })
          }
        />
      )}
      {value.kind === "works" && (
        <ChoiceGrid
          items={catalog.works.map((work) => ({
            id: work.nodus_id,
            label: work.title,
          }))}
          selected={value.workIds}
          onToggle={(id) =>
            onChange({ ...value, workIds: toggle(value.workIds, id) })
          }
        />
      )}
      {value.kind === "tags_collections" && (
        <div className="grid gap-3 md:grid-cols-2">
          <ChoiceGrid
            title={t("Etiquetas")}
            items={catalog.tags.map((tag) => ({
              id: tag.label,
              label: `${tag.label} (${tag.workCount})`,
            }))}
            selected={value.zoteroTags}
            onToggle={(id) =>
              onChange({ ...value, zoteroTags: toggle(value.zoteroTags, id) })
            }
          />
          <ChoiceGrid
            title={t("Colecciones")}
            items={catalog.collections.map((item) => ({
              id: item.key,
              label: `${"· ".repeat(item.depth)}${item.name} (${item.workCount})`,
            }))}
            selected={value.collectionKeys}
            onToggle={(id) =>
              onChange({
                ...value,
                collectionKeys: toggle(value.collectionKeys, id),
              })
            }
          />
        </div>
      )}
    </div>
  );
}

function ChoiceGrid({
  items,
  selected,
  onToggle,
  title,
}: {
  items: Array<{ id: string; label: string }>;
  selected: string[];
  onToggle: (id: string) => void;
  title?: string;
}) {
  return (
    <div>
      {title && (
        <p className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">
          {title}
        </p>
      )}
      <div className="max-h-36 overflow-auto rounded-lg border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-950/60">
        {items.length ? (
          items.map((item) => (
            <label
              key={item.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-neutral-700 hover:bg-white dark:text-neutral-400 dark:hover:bg-neutral-900"
            >
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={() => onToggle(item.id)}
              />
              <span className="truncate">{item.label}</span>
            </label>
          ))
        ) : (
          <p className="px-2 py-3 text-xs text-neutral-500">
            {t("No hay opciones disponibles.")}
          </p>
        )}
      </div>
    </div>
  );
}

function CreationDialog({
  catalog,
  settings,
  model,
  onModel,
  onClose,
  onOpenExisting,
  onQueued,
}: {
  catalog: CatalogData;
  settings: AppSettings;
  model: ModelRef | null;
  onModel: (model: ModelRef | null) => void;
  onClose: () => void;
  onOpenExisting: (entry: DictionaryEntrySummary) => void;
  onQueued: (id: string, name: string) => void;
}) {
  const [input, setInput] = useState(emptyInput);
  const [aliases, setAliases] = useState("");
  const [duplicates, setDuplicates] = useState<
    DictionaryDuplicateMatch[] | null
  >(null);
  const [relateTo, setRelateTo] = useState<string | null>(null);
  const [created, setCreated] = useState<DictionaryEntry | null>(null);
  const [relationAdded, setRelationAdded] = useState(false);
  const [phase, setPhase] = useState<"checking" | "creating" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createAndQueue = async () => {
    setPhase("creating");
    setError(null);
    try {
      const entry =
        created ??
        (await window.nodus.createDictionaryEntry({
          ...input,
          aliases: csv(aliases),
        }));
      if (!created) setCreated(entry);
      if (relateTo && !relationAdded) {
        await window.nodus.addDictionaryRelation(entry.id, relateTo, "related");
        setRelationAdded(true);
      }
      await window.nodus.startDictionaryGeneration({
        entryId: entry.id,
        mode: "creation",
        model,
      });
      onQueued(entry.id, entry.name);
    } catch (reason) {
      setError(message(reason));
      setPhase(null);
    }
  };
  const check = async () => {
    if (!input.name.trim()) return;
    setPhase("checking");
    setError(null);
    try {
      const matches = await window.nodus.detectDictionaryDuplicates(
        input.name,
        csv(aliases),
      );
      if (matches.length) {
        setDuplicates(matches);
        setPhase(null);
      } else await createAndQueue();
    } catch (reason) {
      setError(message(reason));
      setPhase(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-2xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name="thesaurus" />
          </span>
          <div>
            <h2 className="font-semibold">
              {t("Nueva entrada de Dictionary")}
            </h2>
            <p className="text-xs text-neutral-500">
              {t(
                "Nodus buscará la evidencia más relevante y generará la definición automáticamente.",
              )}
            </p>
          </div>
          <button
            className="btn btn-ghost ml-auto"
            disabled={phase !== null}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>
        {duplicates ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/70 dark:bg-amber-950/20">
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                {t("Posibles conceptos duplicados")}
              </h3>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300/70">
                {t("No se fusionará nada automáticamente.")}
              </p>
            </div>
            {duplicates.map((match) => (
              <div
                key={match.entry.id}
                className="flex items-center gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {match.entry.name}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                    {t(match.match)}
                    {match.similarity
                      ? ` · ${Math.round(match.similarity * 100)}%`
                      : ""}
                  </p>
                </div>
                <button
                  className="btn btn-ghost"
                  onClick={() => onOpenExisting(match.entry)}
                >
                  {t("Abrir")}
                </button>
                <button
                  className={`btn ${relateTo === match.entry.id ? "btn-primary" : "btn-ghost"}`}
                  onClick={() =>
                    setRelateTo(
                      relateTo === match.entry.id ? null : match.entry.id,
                    )
                  }
                >
                  {t("Relacionar")}
                </button>
              </div>
            ))}
            {error && <ErrorNotice>{error}</ErrorNotice>}
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-ghost"
                disabled={phase !== null}
                onClick={() => setDuplicates(null)}
              >
                {t("Volver")}
              </button>
              <button
                className="btn btn-primary !text-white disabled:!text-white"
                disabled={phase !== null}
                onClick={() => void createAndQueue()}
              >
                {phase === "creating" ? (
                  <ButtonBusy label={t("Preparando definición…")} />
                ) : (
                  t("Generar de todos modos")
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("Concepto")}>
                <input
                  autoFocus
                  className="input mt-1 w-full"
                  value={input.name}
                  onChange={(event) =>
                    setInput({ ...input, name: event.target.value })
                  }
                />
              </Field>
              <Field label={t("Aliases o términos alternativos")}>
                <input
                  className="input mt-1 w-full"
                  placeholder={t("Separados por comas")}
                  value={aliases}
                  onChange={(event) => setAliases(event.target.value)}
                />
              </Field>
            </div>
            <Field label={t("Prompt de enfoque")}>
              <textarea
                className="input mt-1 min-h-24 w-full resize-y"
                value={input.focusPrompt}
                onChange={(event) =>
                  setInput({ ...input, focusPrompt: event.target.value })
                }
                placeholder={t(
                  "Qué aspecto del concepto debe priorizar la síntesis",
                )}
              />
            </Field>
            <ScopeEditor
              value={input.scope}
              onChange={(scope) => setInput({ ...input, scope })}
              catalog={catalog}
            />
            <div className="grid items-end gap-4 md:grid-cols-3">
              <Field label={t("Idioma de salida")}>
                <select
                  className="input mt-1 w-full"
                  value={input.outputLanguage}
                  onChange={(event) =>
                    setInput({
                      ...input,
                      outputLanguage: event.target.value as PromptLanguage,
                    })
                  }
                >
                  {PROMPT_LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {promptLanguageLabel(lang)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Nivel de detalle")}>
                <select
                  className="input mt-1 w-full"
                  value={input.detailLevel}
                  onChange={(event) =>
                    setInput({
                      ...input,
                      detailLevel: event.target
                        .value as DictionaryEntryInput["detailLevel"],
                    })
                  }
                >
                  <option value="concise">{t("Conciso")}</option>
                  <option value="standard">{t("Estándar")}</option>
                  <option value="detailed">{t("Detallado")}</option>
                </select>
              </Field>
              <Field label={t("Modelo de síntesis")}>
                <ModelPicker
                  className="mt-1 w-full"
                  settings={settings}
                  value={model}
                  onChange={onModel}
                  compact
                  allowEmpty={false}
                />
              </Field>
            </div>
            {error && <ErrorNotice>{error}</ErrorNotice>}
            <div className="flex items-center justify-end gap-2">
              {created && (
                <span className="mr-auto text-xs text-neutral-500">
                  {t(
                    "La entrada ya está guardada; reintentar no creará un duplicado.",
                  )}
                </span>
              )}
              <button
                className="btn btn-ghost"
                disabled={phase !== null}
                onClick={onClose}
              >
                {t("Cancelar")}
              </button>
              <button
                className="btn btn-primary !text-white disabled:!text-white"
                disabled={phase !== null || !input.name.trim()}
                onClick={() => void (created ? createAndQueue() : check())}
              >
                {phase === "checking" ? (
                  <ButtonBusy label={t("Comprobando duplicados…")} />
                ) : phase === "creating" ? (
                  <ButtonBusy label={t("Preparando definición…")} />
                ) : created ? (
                  t("Reintentar generación")
                ) : (
                  t("Generar definición")
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function DictionaryView({
  settings,
  onOpenIdea,
  onOpenAuthor,
  onOpenLibraryWork,
}: {
  settings: AppSettings;
  onOpenIdea: (id: string) => void;
  onOpenAuthor: (id: string, name: string) => void;
  onOpenLibraryWork: (id: string) => void;
}) {
  const [model, setModel] = useFeatureModel(settings, "dictionaryModel");
  const [entries, setEntries] = useState<DictionaryEntrySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<DictionaryFacets>({
    letters: [],
    tags: [],
    authors: [],
    works: [],
  });
  const [catalog, setCatalog] = useState<CatalogData>(emptyCatalog);
  const [openEntries, setOpenEntries] = useState<
    Array<{ id: string; title: string }>
  >([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [letter, setLetter] = useState("");
  const [status, setStatus] = useState("");
  const [tag, setTag] = useState("");
  const [authorId, setAuthorId] = useState("");
  const [workId, setWorkId] = useState("");
  const [newOnly, setNewOnly] = useState(false);
  const [insufficientOnly, setInsufficientOnly] = useState(false);
  const [sortKey, setSortKey] = useState<DictionarySortKey>("updated");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<"list" | "table">("list");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generationJobs, setGenerationJobs] = useState<
    Map<string, DictionaryProgress>
  >(new Map());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(
    async (foreground = true) => {
      if (foreground) setLoading(true);
      setError(null);
      try {
        const [page, nextFacets] = await Promise.all([
          window.nodus.listDictionaryEntries({
            query,
            letter: letter || undefined,
            tags: tag ? [tag] : undefined,
            authorIds: authorId ? [authorId] : undefined,
            workIds: workId ? [workId] : undefined,
            statuses: status ? [status as DictionaryEntryStatus] : undefined,
            hasNewEvidence: newOnly || undefined,
            insufficientEvidence: insufficientOnly || undefined,
            sort: { key: sortKey, dir: sortDir },
            offset: 0,
            limit: 500,
          }),
          window.nodus.listDictionaryFacets(),
        ]);
        setEntries(page.items);
        setTotal(page.total);
        setFacets(nextFacets);
      } catch (reason) {
        setError(message(reason));
      } finally {
        if (foreground) setLoading(false);
      }
    },
    [
      authorId,
      insufficientOnly,
      letter,
      newOnly,
      query,
      sortDir,
      sortKey,
      status,
      tag,
      workId,
    ],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 180);
    return () => window.clearTimeout(timer);
  }, [reload]);
  useEffect(() => {
    void Promise.all([
      window.nodus.listAuthors(),
      window.nodus.listWorks(),
      window.nodus.listZoteroTags(),
      window.nodus.listCollectionFacets(),
    ]).then(([authors, works, tags, collections]) =>
      setCatalog({ authors, works, tags, collections }),
    );
  }, []);
  useEffect(() => {
    void window.nodus
      .scanChangedDictionaryEntries(20)
      .then((ids) => {
        if (ids.length) void reload(false);
      })
      .catch(() => undefined);
  }, []);
  useEffect(
    () =>
      window.nodus.onDictionaryChanged(() => {
        void reload(false);
      }),
    [reload],
  );
  useEffect(
    () =>
      window.nodus.onDictionaryProgress((progress) => {
        setGenerationJobs((current) => {
          const next = new Map(current);
          next.set(progress.entryId, progress);
          return next;
        });
        if (progress.phase === "done") void reload(false);
      }),
    [reload],
  );
  const openEntry = (entry: Pick<DictionaryEntrySummary, "id" | "name">) => {
    setOpenEntries((current) =>
      current.some((item) => item.id === entry.id)
        ? current
        : [...current, { id: entry.id, title: entry.name }],
    );
    setActiveId(entry.id);
  };
  const closeEntry = (id: string) => {
    const index = openEntries.findIndex((entry) => entry.id === id);
    const next = openEntries.filter((entry) => entry.id !== id);
    setOpenEntries(next);
    if (activeId === id)
      setActiveId(next[Math.min(index, next.length - 1)]?.id ?? null);
  };
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const remove = async (ids: string[]) => {
    if (!ids.length) return;
    setPendingDeleteIds(null);
    try {
      await window.nodus.deleteDictionaryEntries(ids);
      const deleted = new Set(ids);
      setOpenEntries((current) =>
        current.filter((entry) => !deleted.has(entry.id)),
      );
      setActiveId((current) =>
        current && deleted.has(current) ? null : current,
      );
      setSelected(new Set());
      await reload();
    } catch (reason) {
      setError(message(reason));
    }
  };

  return (
    <div
      data-testid="dictionary-workspace"
      className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
    >
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name="thesaurus" size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">{t("Dictionary")}</h1>
            <p className="text-[11px] text-neutral-500">
              {t(
                "Conceptos sintetizados exclusivamente desde la evidencia de la bóveda.",
              )}
            </p>
          </div>
          <div className="flex-1" />
          <span className="text-xs text-neutral-500">
            {t("Modelo de síntesis")}
          </span>
          <ModelPicker
            settings={settings}
            value={model}
            onChange={setModel}
            compact
            allowEmpty={false}
          />
          {selected.size > 0 && (
            <button
              className="btn btn-ghost border border-red-200 text-red-600 dark:border-red-900/70 dark:text-red-400"
              onClick={() => setPendingDeleteIds([...selected])}
            >
              <Icon name="trash" /> {tx("Eliminar ({n})", { n: selected.size })}
            </button>
          )}
          <button
            className="btn btn-primary !text-white"
            data-testid="dictionary-new"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" /> {t("Nueva entrada")}
          </button>
        </div>
        <WorkspaceTabStrip
          homeLabel={tx("Dictionary ({n})", { n: total })}
          homeIcon="list"
          homeTestId="dictionary-tab-home"
          tabTestId={(tab) => `dictionary-tab-${tab.key}`}
          closeTestId={(tab) => `dictionary-close-${tab.key}`}
          tabs={openEntries.map((entry) => ({
            key: entry.id,
            title: entry.title,
            icon: "thesaurus",
          }))}
          activeKey={activeId}
          onActivateHome={() => setActiveId(null)}
          onActivateTab={setActiveId}
          onCloseTab={closeEntry}
        />
      </header>
      {activeId ? (
        <DictionaryEntryView
          key={activeId}
          entryId={activeId}
          settings={settings}
          model={model}
          catalog={catalog}
          onRename={(title) =>
            setOpenEntries((current) =>
              current.map((entry) =>
                entry.id === activeId ? { ...entry, title } : entry,
              ),
            )
          }
          onOpenIdea={onOpenIdea}
          onOpenAuthor={onOpenAuthor}
          onOpenLibraryWork={onOpenLibraryWork}
        />
      ) : (
        <main className="min-h-0 flex-1 overflow-auto p-5">
          <div className="mx-auto max-w-[110rem]">
            <div className="mb-3 flex flex-wrap gap-2">
              <div className="relative min-w-72 flex-1">
                <Icon
                  name="search"
                  size={13}
                  className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                />
                <input
                  className="input input-with-leading-icon w-full"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t(
                    "Buscar concepto, alias, descripción, etiqueta, autor u obra…",
                  )}
                />
              </div>
              <select
                className="input"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">{t("Todos los estados")}</option>
                <option value="draft">{dictionaryStatusLabel("draft")}</option>
                <option value="active">{dictionaryStatusLabel("active")}</option>
                <option value="archived">{dictionaryStatusLabel("archived")}</option>
              </select>
              <select
                className="input max-w-44"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
              >
                <option value="">{t("Todas las etiquetas")}</option>
                {facets.tags.map((item) => (
                  <option key={item.label}>{item.label}</option>
                ))}
              </select>
              <select
                className="input max-w-44"
                value={authorId}
                onChange={(event) => setAuthorId(event.target.value)}
              >
                <option value="">{t("Todos los autores")}</option>
                {facets.authors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                className="input max-w-44"
                value={workId}
                onChange={(event) => setWorkId(event.target.value)}
              >
                <option value="">{t("Todas las obras")}</option>
                {facets.works.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1">
                <button
                  className={`btn btn-ghost h-7 px-2 ${!letter ? "text-indigo-600 dark:text-indigo-300" : ""}`}
                  onClick={() => setLetter("")}
                >
                  {t("Todas")}
                </button>
                {["#", ...facets.letters.filter((item) => item !== "#")].map(
                  (item) => (
                    <button
                      key={item}
                      className={`btn btn-ghost h-7 w-7 p-0 ${letter === item ? "text-indigo-600 dark:text-indigo-300" : ""}`}
                      onClick={() => setLetter(letter === item ? "" : item)}
                    >
                      {item}
                    </button>
                  ),
                )}
              </div>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500">
                <input
                  type="checkbox"
                  checked={newOnly}
                  onChange={(event) => setNewOnly(event.target.checked)}
                />{" "}
                {t("Evidencia nueva")}
              </label>
              <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                <input
                  type="checkbox"
                  checked={insufficientOnly}
                  onChange={(event) =>
                    setInsufficientOnly(event.target.checked)
                  }
                />{" "}
                {t("Evidencia insuficiente")}
              </label>
              <select
                className="input h-8"
                value={sortKey}
                onChange={(event) =>
                  setSortKey(event.target.value as DictionarySortKey)
                }
              >
                <option value="name">{t("Nombre")}</option>
                <option value="created">{t("Creación")}</option>
                <option value="updated">{t("Actualización")}</option>
                <option value="authors">{t("Autores")}</option>
                <option value="works">{t("Obras")}</option>
                <option value="evidence">{t("Evidencia")}</option>
              </select>
              <button
                className="btn btn-ghost h-8 px-2"
                onClick={() =>
                  setSortDir((current) => (current === "asc" ? "desc" : "asc"))
                }
              >
                <Icon name={sortDir === "asc" ? "arrowUp" : "arrowDown"} />
              </button>
              <button
                className={`btn btn-ghost h-8 px-2 ${viewMode === "list" ? "text-indigo-600 dark:text-indigo-300" : ""}`}
                onClick={() => setViewMode("list")}
              >
                <Icon name="list" />
              </button>
              <button
                className={`btn btn-ghost h-8 px-2 ${viewMode === "table" ? "text-indigo-600 dark:text-indigo-300" : ""}`}
                onClick={() => setViewMode("table")}
              >
                <Icon name="table" />
              </button>
            </div>
            {error ? (
              <ErrorNotice>{error}</ErrorNotice>
            ) : loading ? (
              <div className="grid h-48 place-items-center">
                <Spinner label={t("Cargando Dictionary…")} />
              </div>
            ) : !entries.length ? (
              <div className="rounded-2xl border border-dashed border-neutral-300 p-12 text-center dark:border-neutral-800">
                <Icon
                  name="thesaurus"
                  size={30}
                  className="mx-auto text-neutral-400"
                />
                <p className="mt-3 text-sm text-neutral-500">
                  {t("No hay entradas con este filtro.")}
                </p>
              </div>
            ) : (
              <DictionaryRows
                entries={entries}
                generationJobs={generationJobs}
                compact={viewMode === "table"}
                selected={selected}
                onToggle={toggle}
                onOpen={openEntry}
                onSelectAll={() =>
                  setSelected(
                    entries.every((entry) => selected.has(entry.id))
                      ? new Set()
                      : new Set(entries.map((entry) => entry.id)),
                  )
                }
              />
            )}
          </div>
        </main>
      )}
      {creating && (
        <CreationDialog
          catalog={catalog}
          settings={settings}
          model={model}
          onModel={setModel}
          onClose={() => setCreating(false)}
          onOpenExisting={(entry) => {
            setCreating(false);
            openEntry(entry);
          }}
          onQueued={(id) => {
            setCreating(false);
            setActiveId(null);
            setGenerationJobs((current) => {
              if (current.has(id)) return current;
              const next = new Map(current);
              next.set(id, {
                entryId: id,
                phase: "queued",
                message: t("En cola"),
              });
              return next;
            });
            void reload(false);
          }}
        />
      )}
      {pendingDeleteIds && (
        <ConfirmModal
          title={
            pendingDeleteIds.length === 1
              ? t("Eliminar entrada de Dictionary")
              : tx("Eliminar {n} entradas de Dictionary", {
                  n: pendingDeleteIds.length,
                })
          }
          message={t(
            "Se eliminarán también todas sus versiones y relaciones. Esta acción no se puede deshacer.",
          )}
          confirmLabel={
            pendingDeleteIds.length === 1
              ? t("Eliminar entrada")
              : tx("Eliminar {n} entradas", { n: pendingDeleteIds.length })
          }
          danger
          onCancel={() => setPendingDeleteIds(null)}
          onConfirm={() => void remove(pendingDeleteIds)}
        />
      )}
    </div>
  );
}

function DictionaryRows({
  entries,
  generationJobs,
  compact,
  selected,
  onToggle,
  onOpen,
  onSelectAll,
}: {
  entries: DictionaryEntrySummary[];
  generationJobs: ReadonlyMap<string, DictionaryProgress>;
  compact: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (entry: DictionaryEntrySummary) => void;
  onSelectAll: () => void;
}) {
  const columns =
    "grid-cols-[2.25rem_minmax(300px,2.4fr)_minmax(150px,0.8fr)_5rem_5rem_6rem_minmax(180px,1fr)_8rem_2rem]";
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950/40">
      <div
        className={`grid min-w-[960px] ${columns} items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/65`}
      >
        <input
          type="checkbox"
          checked={entries.every((entry) => selected.has(entry.id))}
          onChange={onSelectAll}
        />
        <span>{t("Concepto")}</span>
        <span>{t("Estado")}</span>
        <span>{t("Autores")}</span>
        <span>{t("Obras")}</span>
        <span>{t("Evidencia")}</span>
        <span>{t("Etiquetas")}</span>
        <span>{t("Actualización")}</span>
        <span />
      </div>
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`grid min-w-[960px] ${columns} items-center gap-3 border-b border-neutral-100 px-3 transition-colors last:border-b-0 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/55 ${compact ? "py-2" : "py-3"} ${selected.has(entry.id) ? "bg-indigo-50/60 dark:bg-indigo-950/20" : ""}`}
        >
          <input
            type="checkbox"
            checked={selected.has(entry.id)}
            onChange={() => onToggle(entry.id)}
          />
          <button className="min-w-0 text-left" onClick={() => onOpen(entry)}>
            <span className="flex items-center gap-2">
              <strong className="truncate text-sm font-medium hover:text-indigo-600 dark:hover:text-indigo-300">
                {entry.name}
              </strong>
              {entry.newEvidenceCount > 0 && (
                <span className="shrink-0 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
                  {tx("{n} nuevas", { n: entry.newEvidenceCount })}
                </span>
              )}
            </span>
            {entry.aliases.length > 0 && (
              <span className="mt-0.5 block truncate text-[10px] text-neutral-500">
                {entry.aliases.join(" · ")}
              </span>
            )}
            {!compact && (
              <span className="mt-1 line-clamp-2 block text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                {entry.shortDescription ||
                  t("Aún no se ha generado una descripción.")}
              </span>
            )}
            {entry.insufficientEvidence && (
              <span className="mt-1 block text-[10px] text-amber-600 dark:text-amber-400">
                {t("Evidencia insuficiente")}
              </span>
            )}
          </button>
          <DictionaryGenerationState
            progress={generationJobs.get(entry.id)}
            status={entry.status}
          />
          <span className="text-xs text-neutral-500">{entry.authorCount}</span>
          <span className="text-xs text-neutral-500">{entry.workCount}</span>
          <span className="text-xs text-neutral-500">
            {entry.evidenceCount}
          </span>
          <div className="flex flex-wrap gap-1">
            {entry.tags.slice(0, compact ? 2 : 5).map((item) => (
              <Tag key={item}>{item}</Tag>
            ))}
          </div>
          <span className="text-[10px] text-neutral-500">
            {date(entry.updatedAt)}
          </span>
          <button
            className="grid h-7 w-7 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-200 hover:text-indigo-600 dark:hover:bg-neutral-800 dark:hover:text-indigo-300"
            onClick={() => onOpen(entry)}
          >
            <Icon name="chevronRight" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function DictionaryGenerationState({
  progress,
  status,
}: {
  progress?: DictionaryProgress;
  status: DictionaryEntryStatus;
}) {
  if (!progress) return <StatusPill status={status} />;
  if (progress.phase === "failed") {
    return (
      <span
        className="min-w-0 text-xs text-red-600 dark:text-red-400"
        title={progress.error}
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Icon name="x" size={12} /> {t("Error al generar")}
        </span>
        <span className="mt-0.5 block truncate text-[10px] opacity-80">
          {progress.error || t("La generación no pudo completarse.")}
        </span>
      </span>
    );
  }
  if (progress.phase === "done") {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <Icon name="check" size={12} /> {t("Generada")}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-300">
      <Icon name="refresh" size={13} className="animate-spin" />
      {dictionaryProgressText(progress.message)}
    </span>
  );
}

function DictionaryEntryView({
  entryId,
  settings,
  model,
  catalog,
  onRename,
  onOpenIdea,
  onOpenAuthor,
  onOpenLibraryWork,
}: {
  entryId: string;
  settings: AppSettings;
  model: ModelRef | null;
  catalog: CatalogData;
  onRename: (name: string) => void;
  onOpenIdea: (id: string) => void;
  onOpenAuthor: (id: string, name: string) => void;
  onOpenLibraryWork: (id: string) => void;
}) {
  const [detail, setDetail] = useState<DictionaryEntryDetail | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [citation, setCitation] = useState<CitationTarget>(null);
  const choseTab = useRef(false);
  const load = useCallback(
    async () => setDetail(await window.nodus.getDictionaryEntry(entryId)),
    [entryId],
  );
  useEffect(() => {
    void load();
    return window.nodus.onDictionaryChanged((changed) => {
      if (!changed || changed === entryId) void load();
    });
  }, [entryId, load]);
  useEffect(() => {
    if (!detail || choseTab.current) return;
    choseTab.current = true;
    if (!detail.entry.currentVersionId) setTab("evidence");
  }, [detail]);
  const run = async (
    name: string,
    action: () => Promise<unknown>,
    next?: DetailTab,
  ) => {
    setBusy(name);
    setError(null);
    try {
      await action();
      await load();
      if (next) setTab(next);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy("");
    }
  };
  if (!detail)
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner label={t("Abriendo entrada…")} />
      </div>
    );
  const entry = detail.entry;
  const hasEvidence = detail.coverage.used > 0;
  const mode = entry.currentVersionId ? "regeneration" : "creation";
  const generate = (generation: "creation" | "regeneration" | "update") => {
    if (!hasEvidence) {
      setError(
        t(
          "No hay evidencia incluida. Revisa la pestaña Evidencia, incluye al menos un elemento y vuelve a intentarlo.",
        ),
      );
      setTab("evidence");
      return;
    }
    void run(
      generation,
      () =>
        window.nodus.generateDictionaryEntry({
          entryId,
          mode: generation,
          model,
        }),
      generation === "creation" ? "overview" : "versions",
    );
  };
  const tabs: Array<{
    id: DetailTab;
    label: string;
    icon: string;
    count?: number;
  }> = [
    { id: "overview", label: t("Resumen"), icon: "file" },
    {
      id: "evidence",
      label: t("Evidencia"),
      icon: "quote",
      count: entry.evidenceCount,
    },
    {
      id: "authors",
      label: t("Autores"),
      icon: "user",
      count: entry.authorCount,
    },
    { id: "works", label: t("Obras"), icon: "book", count: entry.workCount },
    { id: "versions", label: t("Versiones"), icon: "history" },
  ];
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto p-5"
      data-testid="dictionary-entry-detail"
    >
      <div className="mx-auto max-w-[1480px] space-y-4">
        <section className="rounded-2xl border border-indigo-100 bg-indigo-50/80 p-5 dark:border-neutral-800 dark:bg-neutral-900/35">
          <div className="flex flex-wrap items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
              <Icon name="thesaurus" size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={entry.status} />
                {entry.insufficientEvidence && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400">
                    {t("Evidencia insuficiente")}
                  </span>
                )}
              </div>
              <h2 className="mt-2 text-xl font-semibold">{entry.name}</h2>
              <p className="mt-1 text-xs text-neutral-500">
                {entry.aliases.length
                  ? entry.aliases.join(" · ")
                  : t("Sin aliases")}
              </p>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                {entry.focusPrompt || t("Sin foco adicional.")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                <span className="rounded-full bg-white px-2 py-1 dark:bg-neutral-800">
                  {tx("{n} evidencias", { n: entry.evidenceCount })}
                </span>
                <span className="rounded-full bg-white px-2 py-1 dark:bg-neutral-800">
                  {tx("{n} autores", { n: entry.authorCount })}
                </span>
                <span className="rounded-full bg-white px-2 py-1 dark:bg-neutral-800">
                  {tx("{n} obras", { n: entry.workCount })}
                </span>
                {entry.newEvidenceCount > 0 && (
                  <span className="rounded-full bg-cyan-100 px-2 py-1 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
                    {tx("{n} nuevas", { n: entry.newEvidenceCount })}
                  </span>
                )}
              </div>
            </div>
            <div className="flex max-w-xl flex-wrap items-center justify-end gap-2">
              <ModelPicker
                settings={settings}
                value={model}
                onChange={() => undefined}
                compact
                disabled
                ariaLabel={t("Modelo de Dictionary")}
              />
              <button
                className="btn btn-ghost h-9 w-[220px] shrink-0 justify-center whitespace-nowrap border border-neutral-300 text-xs dark:border-neutral-700"
                disabled={!!busy}
                onClick={() =>
                  void run(
                    "scan",
                    () => window.nodus.scanDictionaryNewEvidence(entryId),
                    "evidence",
                  )
                }
              >
                <Icon name="search" size={13} />{" "}
                {busy === "scan"
                  ? t("Buscando…")
                  : entry.lastEvidenceScanAt
                    ? t("Buscar evidencia nueva")
                    : t("Recuperar evidencia")}
              </button>
              <button
                className="btn btn-primary !text-white disabled:!text-white h-9 w-[112px] shrink-0 justify-center whitespace-nowrap text-xs"
                disabled={!!busy || !hasEvidence}
                onClick={() => generate(mode)}
              >
                {busy === mode ? (
                  <ButtonBusy label={t("Generando…")} />
                ) : (
                  <>
                    <Icon name="sparkles" size={13} />
                    {entry.currentVersionId ? t("Regenerar") : t("Generar")}
                  </>
                )}
              </button>
              <button
                className="btn btn-ghost h-9 w-[112px] shrink-0 justify-center whitespace-nowrap border border-neutral-300 text-xs dark:border-neutral-700"
                disabled={
                  !!busy ||
                  !entry.currentVersionId ||
                  entry.newEvidenceCount === 0 ||
                  !hasEvidence
                }
                onClick={() => generate("update")}
              >
                <Icon name="refresh" size={13} />{" "}
                {busy === "update" ? t("Actualizando…") : t("Actualizar")}
              </button>
            </div>
          </div>
        </section>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {!hasEvidence && (
          <button
            className="flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-800 hover:border-amber-300 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
            onClick={() => setTab("evidence")}
          >
            <Icon name="info" />{" "}
            {t(
              "No se encontró evidencia suficiente para generar automáticamente. Puedes inspeccionar la búsqueda en Evidencia.",
            )}
            <Icon name="chevronRight" className="ml-auto" />
          </button>
        )}
        <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-neutral-200 dark:border-neutral-800">
          {tabs.map((item) => (
            <button
              key={item.id}
              className={`flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-xs ${tab === item.id ? "border-indigo-500 text-indigo-700 dark:text-indigo-300" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300"}`}
              onClick={() => setTab(item.id)}
            >
              <Icon name={item.icon} size={13} /> {item.label}
              {item.count !== undefined && (
                <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800">
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="pb-8">
          {tab === "overview" ? (
            <OverviewTab
              detail={detail}
              catalog={catalog}
              onSaved={(next) => {
                onRename(next.name);
                void load();
              }}
              onCitation={setCitation}
            />
          ) : tab === "evidence" ? (
            <EvidenceTab
              detail={detail}
              onChanged={load}
              onGenerate={(next) => generate(next)}
              onCitation={setCitation}
              onOpenIdea={onOpenIdea}
              onOpenAuthor={onOpenAuthor}
              onOpenLibraryWork={onOpenLibraryWork}
            />
          ) : tab === "authors" ? (
            <AuthorsTab
              detail={detail}
              onOpenAuthor={onOpenAuthor}
              onCitation={setCitation}
            />
          ) : tab === "works" ? (
            <WorksTab detail={detail} onOpenLibraryWork={onOpenLibraryWork} />
          ) : (
            <VersionsTab
              detail={detail}
              onChanged={load}
              onCitation={setCitation}
            />
          )}
        </div>
      </div>
      <SourceCitationModal
        target={citation}
        onClose={() => setCitation(null)}
        onOpenLibraryWork={(id) => onOpenLibraryWork(id)}
      />
    </div>
  );
}

function OverviewTab({
  detail,
  catalog,
  onSaved,
  onCitation,
}: {
  detail: DictionaryEntryDetail;
  catalog: CatalogData;
  onSaved: (entry: DictionaryEntry) => void;
  onCitation: (citation: MarkdownCitation) => void;
}) {
  const entry = detail.entry;
  const [editing, setEditing] = useState(false);
  const [patch, setPatch] = useState<DictionaryEntryPatch>({});
  const [aliases, setAliases] = useState(entry.aliases.join(", "));
  const [tags, setTags] = useState(entry.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setPatch({
      name: entry.name,
      focusPrompt: entry.focusPrompt,
      scope: entry.scope,
      contentMarkdown: entry.contentMarkdown,
      notes: entry.notes,
      status: entry.status,
      outputLanguage: entry.outputLanguage,
      detailLevel: entry.detailLevel,
    });
    setAliases(entry.aliases.join(", "));
    setTags(entry.tags.join(", "));
  }, [entry]);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await window.nodus.updateDictionaryEntry(
        entry.id,
        { ...patch, aliases: csv(aliases), tags: csv(tags) },
        entry.updatedAt,
      );
      onSaved(next);
      setEditing(false);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  };
  if (editing)
    return (
      <section className={`${panel} p-5`}>
        <div className="mb-4 flex items-center">
          <h2 className="font-semibold">{t("Editar entrada")}</h2>
          <button
            className="btn btn-ghost ml-auto"
            onClick={() => setEditing(false)}
          >
            {t("Cancelar")}
          </button>
          <button
            className="btn btn-primary !text-white disabled:!text-white"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? (
              <ButtonBusy label={t("Guardando…")} />
            ) : (
              t("Guardar versión manual")
            )}
          </button>
        </div>
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("Nombre")}>
              <input
                className="input mt-1 w-full"
                value={patch.name ?? ""}
                onChange={(event) =>
                  setPatch({ ...patch, name: event.target.value })
                }
              />
            </Field>
            <Field label={t("Aliases")}>
              <input
                className="input mt-1 w-full"
                value={aliases}
                onChange={(event) => setAliases(event.target.value)}
              />
            </Field>
          </div>
          <Field label={t("Prompt de enfoque")}>
            <textarea
              className="input mt-1 min-h-20 w-full"
              value={patch.focusPrompt ?? ""}
              onChange={(event) =>
                setPatch({ ...patch, focusPrompt: event.target.value })
              }
            />
          </Field>
          <ScopeEditor
            value={patch.scope ?? entry.scope}
            onChange={(scope) => setPatch({ ...patch, scope })}
            catalog={catalog}
          />
          <div className="grid gap-4 md:grid-cols-4">
            <Field label={t("Etiquetas")}>
              <input
                className="input mt-1 w-full"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
              />
            </Field>
            <Field label={t("Estado")}>
              <select
                className="input mt-1 w-full"
                value={patch.status}
                onChange={(event) =>
                  setPatch({
                    ...patch,
                    status: event.target.value as DictionaryEntryStatus,
                  })
                }
              >
                <option value="draft">{dictionaryStatusLabel("draft")}</option>
                <option value="active">{dictionaryStatusLabel("active")}</option>
                <option value="archived">{dictionaryStatusLabel("archived")}</option>
              </select>
            </Field>
            <Field label={t("Idioma de salida")}>
              <select
                className="input mt-1 w-full"
                value={patch.outputLanguage}
                onChange={(event) =>
                  setPatch({
                    ...patch,
                    outputLanguage: event.target.value as PromptLanguage,
                  })
                }
              >
                {PROMPT_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {promptLanguageLabel(lang)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Nivel de detalle")}>
              <select
                className="input mt-1 w-full"
                value={patch.detailLevel}
                onChange={(event) =>
                  setPatch({
                    ...patch,
                    detailLevel: event.target
                      .value as DictionaryEntryInput["detailLevel"],
                  })
                }
              >
                <option value="concise">{t("Conciso")}</option>
                <option value="standard">{t("Estándar")}</option>
                <option value="detailed">{t("Detallado")}</option>
              </select>
            </Field>
          </div>
          <Field label={t("Descripción Markdown")}>
            <textarea
              className="input mt-1 min-h-80 w-full font-mono text-xs leading-5"
              value={patch.contentMarkdown ?? ""}
              onChange={(event) =>
                setPatch({ ...patch, contentMarkdown: event.target.value })
              }
            />
          </Field>
          <Field label={t("Notas")}>
            <textarea
              className="input mt-1 min-h-28 w-full"
              value={patch.notes ?? ""}
              onChange={(event) =>
                setPatch({ ...patch, notes: event.target.value })
              }
            />
          </Field>
          {error && <ErrorNotice>{error}</ErrorNotice>}
        </div>
      </section>
    );
  return (
    <div className="grid items-start gap-4 xl:grid-cols-12">
      <section className={`${panel} p-5 xl:col-span-8`}>
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest text-neutral-500">
              {t("Síntesis del concepto")}
            </p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {entry.focusPrompt || t("Sin foco adicional.")}
            </p>
          </div>
          <button
            className="btn btn-ghost border border-neutral-300 text-xs dark:border-neutral-700"
            onClick={() => setEditing(true)}
          >
            <Icon name="edit" /> {t("Editar")}
          </button>
        </div>
        {entry.contentMarkdown ? (
          <Markdown content={entry.contentMarkdown} onCitation={onCitation} />
        ) : (
          <p className="rounded-lg bg-neutral-50 py-12 text-center text-sm text-neutral-500 dark:bg-neutral-900/45">
            {t(
              "No se pudo generar todavía una definición. Vuelve a intentarlo desde el botón Generar.",
            )}
          </p>
        )}
      </section>
      <div className="space-y-4 xl:col-span-4">
        <section className={`${panel} p-4`}>
          <div className="mb-3 flex items-center gap-2">
            <Icon name="chart" size={15} className="text-indigo-500" />
            <h3 className="font-semibold">{t("Cobertura")}</h3>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              [t("Incluida"), detail.coverage.used],
              [t("Citada"), detail.coverage.cited],
              [t("No usada"), detail.coverage.unused],
              [t("Excluida"), detail.coverage.excluded],
              [t("Nueva"), detail.coverage.newEvidence],
              [t("No disponible"), detail.coverage.unavailable],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-900/55"
              >
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  {label}
                </p>
                <p className="mt-1 text-base font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </section>
        <section className={`${panel} p-4`}>
          <div className="mb-3 flex items-center gap-2">
            <Icon name="info" size={15} className="text-indigo-500" />
            <h3 className="font-semibold">{t("Ficha")}</h3>
          </div>
          <dl className="space-y-2 text-xs text-neutral-500">
            <div className="flex justify-between gap-3">
              <dt>{t("Creación")}</dt>
              <dd>{date(entry.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t("Actualización")}</dt>
              <dd>{date(entry.updatedAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t("Último escaneo")}</dt>
              <dd>{date(entry.lastEvidenceScanAt)}</dd>
            </div>
          </dl>
        </section>
        {entry.tags.length > 0 && (
          <section className={`${panel} p-4`}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("Etiquetas")}
            </h3>
            <div className="flex flex-wrap gap-1">
              {entry.tags.map((item) => (
                <Tag key={item}>{item}</Tag>
              ))}
            </div>
          </section>
        )}
        {entry.notes && (
          <section className={`${panel} p-4`}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("Notas")}
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-400">
              {entry.notes}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function EvidenceTab({
  detail,
  onChanged,
  onGenerate,
  onCitation,
  onOpenIdea,
  onOpenAuthor,
  onOpenLibraryWork,
}: {
  detail: DictionaryEntryDetail;
  onChanged: () => Promise<void>;
  onGenerate: (mode: "creation" | "regeneration") => void;
  onCitation: (citation: MarkdownCitation) => void;
  onOpenIdea: (id: string) => void;
  onOpenAuthor: (id: string, name: string) => void;
  onOpenLibraryWork: (id: string) => void;
}) {
  const entryId = detail.entry.id;
  const [items, setItems] = useState<DictionaryEvidenceItem[]>([]);
  const [all, setAll] = useState<DictionaryEvidenceItem[]>([]);
  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState("");
  const [newOnly, setNewOnly] = useState(false);
  const [authorId, setAuthorId] = useState("");
  const [workId, setWorkId] = useState("");
  const [tag, setTag] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await window.nodus.listDictionaryEvidence({
        entryId,
        query,
        decisions: decision
          ? [decision as DictionaryEvidenceDecision]
          : undefined,
        newOnly,
        authorIds: authorId ? [authorId] : undefined,
        workIds: workId ? [workId] : undefined,
        tags: tag ? [tag] : undefined,
        offset: 0,
        limit: 500,
      });
      setItems(page.items);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setLoading(false);
    }
  }, [authorId, decision, entryId, newOnly, query, tag, workId]);
  const loadAll = useCallback(
    async () =>
      setAll(
        (
          await window.nodus.listDictionaryEvidence({
            entryId,
            offset: 0,
            limit: 500,
          })
        ).items,
      ),
    [entryId],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 150);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    void loadAll();
  }, [loadAll]);
  const authors = useMemo(
    () =>
      [
        ...new Map(
          all
            .flatMap((item) => item.authors)
            .filter((author) => author.id)
            .map((author) => [author.id!, author.name]),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [all],
  );
  const works = useMemo(
    () =>
      [
        ...new Map(
          all
            .flatMap((item) => item.works)
            .map((work) => [work.id, work.title]),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [all],
  );
  const tags = useMemo(
    () => [...new Set(all.flatMap((item) => item.tags))].sort(),
    [all],
  );
  const included = all.filter(
    (item) => item.decision === "included" && !item.unavailable,
  ).length;
  const decide = async (
    item: DictionaryEvidenceItem,
    next: DictionaryEvidenceDecision,
  ) => {
    try {
      await window.nodus.setDictionaryEvidenceDecision(
        entryId,
        [{ kind: item.kind, id: item.id }],
        next,
      );
      await Promise.all([load(), loadAll(), onChanged()]);
    } catch (reason) {
      setError(message(reason));
    }
  };
  return (
    <div>
      <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/20">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
              {t("Evidencia recuperada")}
            </h2>
            <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-300/70">
              {tx(
                "Nodus seleccionó automáticamente {n} elementos para la definición. Aquí puedes inspeccionarlos o ajustar una regeneración.",
                { n: included },
              )}
            </p>
          </div>
          <button
            className="btn btn-primary ml-auto !text-white disabled:!text-white"
            disabled={!included}
            onClick={() =>
              onGenerate(
                detail.entry.currentVersionId ? "regeneration" : "creation",
              )
            }
          >
            <Icon name="sparkles" />{" "}
            {detail.entry.currentVersionId
              ? t("Regenerar con ajustes")
              : t("Reintentar generación")}
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-4">
          <ErrorNotice>{error}</ErrorNotice>
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-72 flex-1">
          <Icon
            name="search"
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
          />
          <input
            className="input input-with-leading-icon w-full"
            placeholder={t("Buscar en la evidencia…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          className="input"
          value={decision}
          onChange={(event) => setDecision(event.target.value)}
        >
          <option value="">{t("Todas las decisiones")}</option>
          <option value="included">{t("Usada")}</option>
          <option value="unused">{t("Relevante no usada")}</option>
          <option value="excluded">{t("Excluida")}</option>
        </select>
        <select
          className="input max-w-44"
          value={authorId}
          onChange={(event) => setAuthorId(event.target.value)}
        >
          <option value="">{t("Todos los autores")}</option>
          {authors.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          className="input max-w-44"
          value={workId}
          onChange={(event) => setWorkId(event.target.value)}
        >
          <option value="">{t("Todas las obras")}</option>
          {works.map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
        <select
          className="input max-w-40"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
        >
          <option value="">{t("Todas las etiquetas")}</option>
          {tags.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          <input
            type="checkbox"
            checked={newOnly}
            onChange={(event) => setNewOnly(event.target.checked)}
          />{" "}
          {t("Solo nueva")}
        </label>
      </div>
      {loading ? (
        <div className="grid h-40 place-items-center">
          <Spinner label={t("Cargando evidencia…")} />
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <EvidenceCard
              key={`${item.kind}:${item.id}`}
              item={item}
              onDecision={(next) => void decide(item, next)}
              onCitation={onCitation}
              onOpenIdea={onOpenIdea}
              onOpenAuthor={onOpenAuthor}
              onOpenLibraryWork={onOpenLibraryWork}
            />
          ))}
          {!items.length && (
            <p className="rounded-xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-800">
              {t("No hay evidencia con estos filtros.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EvidenceCard({
  item,
  onDecision,
  onCitation,
  onOpenIdea,
  onOpenAuthor,
  onOpenLibraryWork,
}: {
  item: DictionaryEvidenceItem;
  onDecision: (decision: DictionaryEvidenceDecision) => void;
  onCitation: (citation: MarkdownCitation) => void;
  onOpenIdea: (id: string) => void;
  onOpenAuthor: (id: string, name: string) => void;
  onOpenLibraryWork: (id: string) => void;
}) {
  const color =
    item.decision === "included"
      ? "border-emerald-300 dark:border-emerald-900/60"
      : item.decision === "excluded"
        ? "border-red-200 opacity-70 dark:border-red-950"
        : "border-neutral-200 dark:border-neutral-800";
  return (
    <article
      className={`rounded-xl border bg-white p-4 dark:bg-neutral-950/55 ${color}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={`rounded px-2 py-1 text-[10px] uppercase ${item.kind === "idea" ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" : "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"}`}
        >
          {t(item.kind === "idea" ? "IDEA" : "PASSAGE")}
        </span>
        <div className="min-w-0 flex-1">
          <button
            className="text-left text-sm font-medium hover:text-indigo-600 dark:hover:text-indigo-300"
            onClick={() => onCitation({ kind: item.kind, id: item.id })}
          >
            {item.label}
          </button>
          <p className="mt-2 line-clamp-5 whitespace-pre-line text-xs leading-5 text-neutral-600 dark:text-neutral-400">
            {item.text}
          </p>
        </div>
        {item.isNew && (
          <span className="rounded-full bg-cyan-100 px-2 py-1 text-[10px] text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
            {t("Nueva")}
          </span>
        )}
        {item.usedInCurrentVersion && (
          <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {t("Versión actual")}
          </span>
        )}
        <select
          className="input h-8"
          value={item.decision}
          onChange={(event) =>
            onDecision(event.target.value as DictionaryEvidenceDecision)
          }
        >
          <option value="included">{t("Incluir")}</option>
          <option value="unused">{t("No usar")}</option>
          <option value="excluded">{t("Excluir")}</option>
        </select>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800/60">
        <button
          className="text-[10px] text-neutral-500 hover:text-indigo-600"
          onClick={() =>
            item.kind === "idea"
              ? onOpenIdea(item.id)
              : onCitation({ kind: "passage", id: item.id })
          }
        >
          {item.kind === "idea" ? t("Abrir idea") : t("Abrir pasaje original")}
        </button>
        {item.works.map((work) => (
          <button
            key={work.id}
            className="text-[10px] text-neutral-500 hover:text-indigo-600"
            onClick={() => onOpenLibraryWork(work.id)}
          >
            {work.title}
          </button>
        ))}
        {item.authors.map((author) => (
          <button
            key={author.id ?? author.name}
            className="text-[10px] text-neutral-500 hover:text-indigo-600 disabled:opacity-50"
            disabled={!author.id}
            onClick={() => author.id && onOpenAuthor(author.id, author.name)}
          >
            {author.name}
          </button>
        ))}
        {item.tags.map((itemTag) => (
          <Tag key={itemTag}>{itemTag}</Tag>
        ))}
      </div>
    </article>
  );
}

function AuthorsTab({
  detail,
  onOpenAuthor,
  onCitation,
}: {
  detail: DictionaryEntryDetail;
  onOpenAuthor: (id: string, name: string) => void;
  onCitation: (citation: MarkdownCitation) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {detail.authors.map((author) => (
        <article key={author.id} className={`${panel} p-4`}>
          <button
            className="flex w-full items-center gap-3 text-left"
            onClick={() => onOpenAuthor(author.id, author.name)}
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
              <Icon name="user" />
            </span>
            <div>
              <h3 className="text-sm font-medium">{author.name}</h3>
              <p className="text-[10px] text-neutral-500">
                {tx("{ideas} ideas · {works} obras", {
                  ideas: author.ideaCount,
                  works: author.workCount,
                })}
                {author.attributionBasis === "editor_only"
                  ? ` · ${t("atribución editorial")}`
                  : ""}
              </p>
            </div>
            <Icon
              name="external"
              size={12}
              className="ml-auto text-neutral-400"
            />
          </button>
          {author.summaryMarkdown ? (
            <Markdown
              content={author.summaryMarkdown}
              onCitation={onCitation}
              className="mt-3 text-xs"
            />
          ) : (
            <p className="mt-3 text-xs text-neutral-500">
              {t("Sin resumen específico en la versión actual.")}
            </p>
          )}
        </article>
      ))}
      {!detail.authors.length && (
        <p className="text-sm text-neutral-500">
          {t("La versión actual no relaciona autores.")}
        </p>
      )}
    </div>
  );
}

function WorksTab({
  detail,
  onOpenLibraryWork,
}: {
  detail: DictionaryEntryDetail;
  onOpenLibraryWork: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {detail.works.map((work) => (
        <article
          key={work.id}
          className={`${panel} flex flex-wrap items-start gap-3 p-4`}
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <Icon name="book" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">{work.title}</h3>
            <p className="mt-1 text-xs text-neutral-500">
              {work.authors.join(", ") || t("Autor no disponible")} ·{" "}
              {tx("{n} evidencias", { n: work.evidenceCount })}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {work.tags.map((item) => (
                <Tag key={item}>{item}</Tag>
              ))}
            </div>
          </div>
          <button
            className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
            onClick={() => onOpenLibraryWork(work.id)}
          >
            <Icon name="bookOpen" /> {t("Nodus Library")}
          </button>
          {work.zoteroKey && (
            <button
              className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
              onClick={() => void window.nodus.openInZotero(work.zoteroKey!)}
            >
              <Icon name="external" /> {t("Zotero")}
            </button>
          )}
        </article>
      ))}
      {!detail.works.length && (
        <p className="text-sm text-neutral-500">
          {t("La versión actual no relaciona obras.")}
        </p>
      )}
    </div>
  );
}

function VersionsTab({
  detail,
  onChanged,
  onCitation,
}: {
  detail: DictionaryEntryDetail;
  onChanged: () => Promise<void>;
  onCitation: (citation: MarkdownCitation) => void;
}) {
  const [versions, setVersions] = useState<DictionaryVersion[]>([]);
  const [open, setOpen] = useState<string | null>(
    detail.entry.proposedVersionId,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async () =>
      setVersions(await window.nodus.listDictionaryVersions(detail.entry.id)),
    [detail.entry.id],
  );
  useEffect(() => {
    void load();
  }, [load, detail.entry.proposedVersionId]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await Promise.all([load(), onChanged()]);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {detail.proposedVersion && (
        <div className="rounded-xl border border-cyan-300 bg-cyan-50 p-4 dark:border-cyan-900 dark:bg-cyan-950/20">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h3 className="text-sm font-semibold text-cyan-800 dark:text-cyan-200">
                {t("Actualización propuesta")}
              </h3>
              <p className="text-xs text-cyan-700 dark:text-cyan-400/70">
                {t(
                  "La versión actual permanece intacta hasta que aceptes esta propuesta.",
                )}
              </p>
            </div>
            <button
              className="btn btn-primary ml-auto !text-white disabled:!text-white"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  window.nodus.acceptDictionaryVersion(
                    detail.entry.id,
                    detail.proposedVersion!.id,
                    detail.entry.currentVersionId,
                  ),
                )
              }
            >
              {t("Aceptar propuesta")}
            </button>
          </div>
        </div>
      )}
      {versions.map((version) => (
        <article
          key={version.id}
          className={`${panel} p-4 ${version.id === detail.entry.currentVersionId ? "!border-emerald-300 dark:!border-emerald-900" : version.state === "proposed" ? "!border-cyan-300 dark:!border-cyan-900" : ""}`}
        >
          <button
            className="flex w-full items-center gap-3 text-left"
            onClick={() => setOpen(open === version.id ? null : version.id)}
          >
            <Icon name="history" className="text-neutral-500" />
            <div>
              <p className="text-sm font-medium">
                {dictionaryVersionText(version.trigger)}
              </p>
              <p className="text-[10px] text-neutral-500">
                {date(version.generatedAt)} ·{" "}
                {tx("{n} evidencias", { n: version.evidence.length })} ·{" "}
                {dictionaryVersionText(version.state)}
              </p>
            </div>
            {version.insufficientEvidence && (
              <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-400">
                {t("Insuficiente")}
              </span>
            )}
            <Icon
              name={open === version.id ? "chevronUp" : "chevronDown"}
              className={version.insufficientEvidence ? "" : "ml-auto"}
            />
          </button>
          {open === version.id && (
            <div className="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
              <Markdown
                content={version.contentMarkdown}
                onCitation={onCitation}
              />
              <div className="mt-4 flex justify-end">
                {version.id !== detail.entry.currentVersionId &&
                  version.state !== "proposed" && (
                    <button
                      className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          window.nodus.restoreDictionaryVersion(
                            detail.entry.id,
                            version.id,
                            detail.entry.currentVersionId,
                          ),
                        )
                      }
                    >
                      <Icon name="undo" /> {t("Restaurar como nueva versión")}
                    </button>
                  )}
              </div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
