import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/ui";
import { api } from "./api";
import type { JsonRecord } from "./types";
import { errorText, t } from "./i18nShim";
import { getActiveLang } from "./i18nShim";
import { localizeDebateTension } from "@shared/uiLanguage";

type CoverageTab = "map" | "debate" | "gaps";
type StateOfArt = {
  questions: JsonRecord[];
  debates: JsonRecord[];
  gaps: JsonRecord[];
};

const TABS_SOURCE: ReadonlyArray<{
  id: CoverageTab;
  label: string;
  icon: string;
}> = [
  { id: "map", label: "Cobertura", icon: "help" },
  { id: "debate", label: "Debates", icon: "scale" },
  { id: "gaps", label: "Huecos", icon: "gap" },
];
const TABS = TABS_SOURCE.map((entry) => ({
  ...entry,
  get label() {
    return t(entry.label);
  },
}));

const COVERAGE_LABELS: Record<string, string> = {
  covered: "Cubierta",
  partial: "Parcial",
  uncovered: "Sin cubrir",
  disputed: "En disputa",
  unmapped: "Sin mapear",
};
const LOCALIZED_COVERAGE_LABELS = new Proxy(COVERAGE_LABELS, {
  get(target, property: string) {
    return t(target[property] ?? property);
  },
});

function value(input: unknown, fallback = "—"): string {
  return input == null || input === "" ? t(fallback) : String(input);
}
function list(input: unknown): JsonRecord[] {
  return Array.isArray(input)
    ? input.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object"),
      )
    : [];
}
function title(row: JsonRecord): string {
  return value(
    row.label ??
      row.title ??
      row.question ??
      row.text ??
      row.tension ??
      row.description ??
      row.name,
    "Sin título",
  );
}
function description(row: JsonRecord): string {
  return value(
    row.description ??
      row.statement ??
      row.rationale ??
      row.justification ??
      row.summary ??
      row.excerpt,
    "Sin descripción publicada",
  );
}

function CoverageView({
  questions,
}: {
  questions: JsonRecord[];
  spaceId?: string;
  csrfToken?: string;
}) {
  const [selectedId, setSelectedId] = useState(() =>
    value(questions[0]?.id, ""),
  );
  useEffect(() => {
    if (!questions.some((question) => value(question.id, "") === selectedId))
      setSelectedId(value(questions[0]?.id, ""));
  }, [questions, selectedId]);
  const selected =
    questions.find((question) => value(question.id, "") === selectedId) ||
    questions[0];
  if (!selected)
    return (
      <Empty
        icon="help"
        title="Todavía no hay una pregunta de investigación publicada"
        detail="Cuando se mapee en Desktop aparecerán aquí sus subpreguntas, fuentes y cobertura real."
      />
    );
  const subQuestions = list(selected.subQuestions);
  const summary =
    selected.summary && typeof selected.summary === "object"
      ? (selected.summary as JsonRecord)
      : {};
  return (
    <div className="flex h-full min-h-0">
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-neutral-200 p-3 dark:border-neutral-800">
        <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          {t("Preguntas de investigación")}
        </div>
        {questions.map((question) => {
          const active = value(question.id, "") === value(selected.id, "");
          const count = list(question.subQuestions).length;
          return (
            <button
              key={value(question.id)}
              className={`mb-1 w-full rounded-lg px-3 py-2.5 text-left text-xs ${active ? "bg-indigo-600 text-white" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"}`}
              onClick={() => setSelectedId(value(question.id, ""))}
            >
              <strong className="line-clamp-3 font-medium">
                {title(question)}
              </strong>
              <span
                className={`mt-1 block text-[10px] ${active ? "text-indigo-100" : "text-neutral-500"}`}
              >
                {count} {t("subpreguntas")} ·{" "}
                {question.stale
                  ? t("requiere actualizar")
                  : value(question.status, "borrador")}
              </span>
            </button>
          );
        })}
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="max-w-3xl text-lg font-semibold">
              {title(selected)}
            </h2>
            {Boolean(selected.notes) && (
              <p className="mt-2 text-sm text-neutral-500">
                {value(selected.notes)}
              </p>
            )}
          </div>
          {Boolean(selected.stale) && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              {t("El corpus ha cambiado")}
            </span>
          )}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {Object.entries(COVERAGE_LABELS).map(([key]) => (
            <div
              key={key}
              className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
            >
              <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                {LOCALIZED_COVERAGE_LABELS[key]}
              </div>
              <strong className="mt-1 block text-xl tabular-nums">
                {Number(summary[key]) || 0}
              </strong>
            </div>
          ))}
        </div>
        <div className="mt-5 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
          <div className="grid grid-cols-[minmax(260px,1.3fr)_8rem_minmax(220px,1fr)] gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/60">
            <span>{t("Subpregunta")}</span>
            <span>{t("Cobertura")}</span>
            <span>{t("Fuentes enlazadas")}</span>
          </div>
          {subQuestions.map((question, index) => {
            const links = list(question.links);
            const status = value(question.coverageStatus, "unmapped");
            return (
              <article
                key={value(question.id, String(index))}
                className="grid grid-cols-[minmax(260px,1.3fr)_8rem_minmax(220px,1fr)] gap-3 border-b border-neutral-100 px-4 py-3 text-xs last:border-b-0 dark:border-neutral-900"
              >
                <div>
                  <strong className="font-medium">{title(question)}</strong>
                  {Boolean(question.justification) && (
                    <p className="mt-1 line-clamp-2 leading-5 text-neutral-500">
                      {value(question.justification)}
                    </p>
                  )}
                </div>
                <span>
                  <span className={`coverage-status coverage-${status}`}>
                    {LOCALIZED_COVERAGE_LABELS[status] || status}
                  </span>
                </span>
                <div className="flex flex-wrap gap-1">
                  {links.length ? (
                    links.slice(0, 6).map((link, linkIndex) => (
                      <span
                        key={value(link.id, String(linkIndex))}
                        className="rounded-md bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
                      >
                        {value(link.label ?? link.refId)}
                      </span>
                    ))
                  ) : (
                    <span className="text-neutral-500">{t("Sin enlaces")}</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DebateSide({
  side,
  accent,
}: {
  side: JsonRecord;
  accent: "indigo" | "rose";
}) {
  const works = list(side.works);
  const authors = Array.isArray(side.authors) ? side.authors.map(String) : [];
  return (
    <section className="p-5">
      <span
        className={`text-[10px] font-semibold uppercase tracking-wider ${accent === "indigo" ? "text-indigo-600 dark:text-indigo-300" : "text-rose-600 dark:text-rose-300"}`}
      >
        {t("Posición")}
      </span>
      <h3 className="mt-1 font-semibold">{title(side)}</h3>
      <p className="mt-2 text-xs leading-5 text-neutral-500">
        {description(side)}
      </p>
      {authors.length > 0 && (
        <p className="mt-3 text-[11px] text-neutral-500">
          {authors.join(" · ")}
        </p>
      )}
      <div className="mt-3 grid gap-1">
        {works.slice(0, 3).map((work, index) => (
          <div
            key={value(work.nodus_id, String(index))}
            className="rounded-lg bg-neutral-50 px-3 py-2 text-xs dark:bg-neutral-950"
          >
            <strong className="line-clamp-1 font-medium">{title(work)}</strong>
            <span className="text-[10px] text-neutral-500">
              {value(work.year, "s. f.")}
              {Array.isArray(work.authors)
                ? ` · ${work.authors.map(String).join(", ")}`
                : ""}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DebateView({
  debates,
  query,
  spaceId: _spaceId,
  csrfToken: _csrfToken,
}: {
  debates: JsonRecord[];
  query: string;
  spaceId?: string;
  csrfToken?: string;
}) {
  const [basis, setBasis] = useState("all");
  const [status, setStatus] = useState("all");
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return debates.filter(
      (entry) =>
        (!needle ||
          JSON.stringify(entry).toLocaleLowerCase().includes(needle)) &&
        (basis === "all" || value(entry.basis, "") === basis) &&
        (status === "all" || value(entry.status, "open") === status),
    );
  }, [basis, debates, query, status]);
  if (!visible.length)
    return (
      <Empty
        icon="scale"
        title="No hay debates publicados"
        detail="Las contradicciones y refutaciones validadas del grafo aparecerán enfrentadas aquí."
      />
    );
  return (
    <div className="grid gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900/50">
        <label className="flex items-center gap-2 text-neutral-500">
          {t("Base")}
          <select
            className="input h-8 text-xs"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          >
            <option value="all">{t("Todas")}</option>
            <option value="explicit">{t("Explícita")}</option>
            <option value="inferred">{t("Inferida")}</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-neutral-500">
          {t("Estado")}
          <select
            className="input h-8 text-xs"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">{t("Todos")}</option>
            <option value="open">{t("Abierto")}</option>
            <option value="leaning">{t("Con tendencia")}</option>
          </select>
        </label>
        <span className="ml-auto text-[11px] text-neutral-500">
          {visible.length} {t("debates")}
        </span>
      </div>
      {visible.map((debate, index) => {
        const a =
          debate.sideA && typeof debate.sideA === "object"
            ? (debate.sideA as JsonRecord)
            : {};
        const b =
          debate.sideB && typeof debate.sideB === "object"
            ? (debate.sideB as JsonRecord)
            : {};
        const id = value(debate.id, String(index));
        const tension = localizeDebateTension(
          debate.tensionKey,
          debate.tensionParams && typeof debate.tensionParams === "object"
            ? (debate.tensionParams as { left?: string; right?: string })
            : undefined,
          getActiveLang(),
        ) ?? value(debate.tension, `${title(a)} ↔ ${title(b)}`);
        const graphId = value(debate.idea_id ?? a.idea_id ?? b.idea_id, "");
        return (
          <article
            key={id}
            className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/35"
          >
            <header className="border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{tension}</h2>
                <span className="text-[10px] uppercase tracking-wide text-neutral-500">
                  {value(debate.status, "abierto")} ·{" "}
                  {Math.round((Number(debate.confidence) || 0) * 100)}%
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {graphId && (
                  <a
                    className="btn btn-ghost h-7 text-[11px]"
                    href={`/view/graph?seed=${encodeURIComponent(graphId)}`}
                  >
                    <Icon name="share" size={11} />
                    {t("Abrir en grafo")}
                  </a>
                )}
              </div>
            </header>
            <div className="grid md:grid-cols-[1fr_auto_1fr]">
              <DebateSide side={a} accent="indigo" />
              <div className="grid place-items-center border-y border-neutral-200 px-3 py-2 text-[10px] font-bold text-neutral-400 md:border-x md:border-y-0 dark:border-neutral-800">
                VS
              </div>
              <DebateSide side={b} accent="rose" />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function GapsView({
  gaps,
  query,
  spaceId: _spaceId,
  csrfToken: _csrfToken,
}: {
  gaps: JsonRecord[];
  query: string;
  spaceId?: string;
  csrfToken?: string;
}) {
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return gaps.filter(
      (entry) =>
        (!needle ||
          JSON.stringify(entry).toLocaleLowerCase().includes(needle)) &&
        (kind === "all" || value(entry.kind, "") === kind) &&
        (status === "all" || value(entry.status, "open") === status),
    );
  }, [gaps, kind, query, status]);
  if (!visible.length)
    return (
      <Empty
        icon="gap"
        title="No hay huecos publicados"
        detail="Los límites y oportunidades detectados en las obras aparecerán aquí con su trazabilidad."
      />
    );
  return (
    <div className="min-w-[760px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900/50">
        <label className="flex items-center gap-2 text-neutral-500">
          {t("Tipo")}
          <select
            className="input h-8 text-xs"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="all">{t("Todos")}</option>
            {[
              ...new Set(gaps.map((entry) => value(entry.kind, "general"))),
            ].map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-neutral-500">
          {t("Estado")}
          <select
            className="input h-8 text-xs"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">{t("Todos")}</option>
            <option value="open">{t("Abierto")}</option>
            <option value="resolved">{t("Resuelto")}</option>
          </select>
        </label>
        <span className="ml-auto text-[11px] text-neutral-500">
          {visible.length} {t("huecos")}
        </span>
      </div>
      <div className="grid h-10 grid-cols-[minmax(280px,1.2fr)_minmax(320px,1.5fr)_minmax(190px,.8fr)] items-center border-b border-neutral-200 px-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
        <span>{t("Hueco de investigación")}</span>
        <span>{t("Contexto")}</span>
        <span>{t("Obra / idea de origen")}</span>
      </div>
      {visible.map((gap, index) => {
        const work =
          gap.work && typeof gap.work === "object"
            ? (gap.work as JsonRecord)
            : {};
        const idea =
          gap.idea && typeof gap.idea === "object"
            ? (gap.idea as JsonRecord)
            : {};
        const id = value(gap.id ?? gap.gap_id, String(index));
        const gapTitle = title(gap);
        const queryUrl = encodeURIComponent(`${gapTitle} ${description(gap)}`);
        const graphId = value(idea.id ?? idea.idea_id, "");
        return (
          <article
            key={id}
            className="grid min-h-[112px] grid-cols-[minmax(280px,1.2fr)_minmax(320px,1.5fr)_minmax(190px,.8fr)] items-start border-b border-neutral-100 px-4 py-3 text-xs dark:border-neutral-900"
          >
            <div>
              <strong className="block pr-4 font-medium">{gapTitle}</strong>
              <span className="mt-1 block text-[10px] uppercase text-neutral-500">
                {value(gap.kind, "general")} · {value(gap.status, "abierto")}
              </span>
            </div>
            <span className="line-clamp-3 pr-4 leading-5 text-neutral-500">
              {description(gap)}
            </span>
            <div className="text-neutral-500">
              <b className="block font-medium text-neutral-700 dark:text-neutral-300">
                {title(work)}
              </b>
              <span>{title(idea)}</span>
              <div className="mt-2 flex flex-wrap gap-1">
                {graphId && (
                  <a
                    className="btn btn-ghost h-7 text-[10px]"
                    href={`/view/graph?seed=${encodeURIComponent(graphId)}`}
                  >
                    <Icon name="share" size={10} />
                    {t("Grafo")}
                  </a>
                )}
                <a
                  className="btn btn-ghost h-7 text-[10px]"
                  href={`https://scholar.google.com/scholar?q=${queryUrl}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Buscar fuentes")}
                </a>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Empty({
  icon,
  title: heading,
  detail,
}: {
  icon: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="grid h-full min-h-64 place-items-center p-8 text-center">
      <div>
        <Icon name={icon} size={28} className="mx-auto text-neutral-400" />
        <h2 className="mt-3 font-semibold">{t(heading)}</h2>
        <p className="mt-1 max-w-md text-xs leading-5 text-neutral-500">
          {t(detail)}
        </p>
      </div>
    </div>
  );
}

/** Same three-tab workspace as Desktop, backed by one coherent published contract. */
export function StateOfArtServerView({
  spaceId,
  csrfToken,
  initialTab = "map",
}: {
  spaceId: string;
  csrfToken?: string;
  initialTab?: CoverageTab;
}) {
  const [tab, setTab] = useState<CoverageTab>(initialTab);
  const [data, setData] = useState<StateOfArt>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  // Private artifacts belong to Desktop/Workspace and must not be merged into
  // the published state-of-art questions or shown as dossier overlays.
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    api
      .stateOfArt(spaceId)
      .then((response) => {
        if (current)
          setData({
            questions: response.questions || [],
            debates: response.debates || [],
            gaps: response.gaps || [],
          });
      })
      .catch((cause) => {
        if (current)
          setError(errorText(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [spaceId]);
  const questions = data?.questions || [];
  return (
    <div
      data-testid="coverage-workspace"
      className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
    >
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name="strata" size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">
              {t("Estado de la cuestión")}
            </h1>
            <p className="text-[11px] text-neutral-500">
              {t("Cobertura")} · {t("Debates")} · {t("Huecos")}
            </p>
          </div>
        </div>
        <nav
          data-testid="coverage-tabs"
          className="flex min-w-0 items-end gap-1 overflow-x-auto"
          role="tablist"
          aria-label={t("Estado de la cuestión")}
        >
          {TABS.map((entry, index) => (
            <button
              key={entry.id}
              id={`coverage-tab-${entry.id}`}
              role="tab"
              data-testid={`coverage-tab-${entry.id}`}
              aria-selected={tab === entry.id}
              tabIndex={tab === entry.id ? 0 : -1}
              className={`flex h-9 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs ${tab === entry.id ? "border-neutral-300 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" : "border-transparent text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900/60"}`}
              onClick={() => {
                setTab(entry.id);
                setQuery("");
              }}
              onKeyDown={(event) => {
                const delta =
                  event.key === "ArrowRight"
                    ? 1
                    : event.key === "ArrowLeft"
                      ? -1
                      : 0;
                if (!delta) return;
                event.preventDefault();
                const next = TABS[(index + delta + TABS.length) % TABS.length];
                setTab(next.id);
                const tabButtons =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  );
                tabButtons?.[TABS.indexOf(next)]?.focus();
              }}
            >
              <Icon name={entry.icon} size={13} />
              {entry.label}
              <span className="rounded-full bg-neutral-100 px-1.5 text-[9px] tabular-nums dark:bg-neutral-800">
                {entry.id === "map"
                  ? questions.length
                  : entry.id === "debate"
                    ? data?.debates.length || 0
                    : data?.gaps.length || 0}
              </span>
            </button>
          ))}
        </nav>
      </header>

      {tab !== "map" && (
        <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
          <div className="relative max-w-xl flex-1">
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
            />
            <input
              className="input input-with-leading-icon w-full text-sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`${t("Buscar en")} ${t(tab === "debate" ? "debates" : "huecos")}…`}
            />
          </div>
        </div>
      )}
      <section
        className="min-h-0 flex-1 overflow-auto"
        role="tabpanel"
        aria-labelledby={`coverage-tab-${tab}`}
      >
        {loading ? (
          <div className="grid h-full place-items-center text-sm text-neutral-500">
            {t("Cargando estado de la cuestión…")}
          </div>
        ) : error ? (
          <div className="m-5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        ) : tab === "map" ? (
          <CoverageView
            questions={questions}
            spaceId={spaceId}
            csrfToken={csrfToken}
          />
        ) : tab === "debate" ? (
          <DebateView debates={data?.debates || []} query={query} />
        ) : (
          <GapsView gaps={data?.gaps || []} query={query} />
        )}
      </section>
    </div>
  );
}
