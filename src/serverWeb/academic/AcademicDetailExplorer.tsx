import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "../../components/ui";
import { advancedRest } from "../advanced/api";
import type {
  AdvancedAuthorDossier,
  AdvancedIdeaDetail,
  AdvancedWorkDetail,
} from "../advanced/types";
import { errorText, getActiveLang, t, tx } from "../i18nShim";

export type AcademicTarget = {
  kind: "idea" | "work" | "author";
  id: string;
  label: string;
};

function value(source: unknown, fallback = "—"): string {
  if (source === null || source === undefined || source === "")
    return t(fallback);
  return typeof source === "string" ? source : String(source);
}

function recordId(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys)
    if (source[key] !== null && source[key] !== undefined && source[key] !== "")
      return String(source[key]);
  return "";
}

function FieldTable({
  record,
  omit = [],
}: {
  record: Record<string, unknown>;
  omit?: string[];
}) {
  const rows = Object.entries(record).filter(
    ([key, field]) =>
      !omit.includes(key) &&
      field !== null &&
      field !== undefined &&
      typeof field !== "object",
  );
  return (
    <dl className="divide-y divide-neutral-200 dark:divide-neutral-800">
      {rows.map(([key, field]) => (
        <div
          key={key}
          className="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 py-2.5 text-xs"
        >
          <dt className="font-semibold uppercase tracking-wide text-neutral-500">
            {key.replace(/_/g, " ")}
          </dt>
          <dd className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">
            {value(field)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="py-8 text-center text-xs text-neutral-500">{children}</p>
  );
}

function tabLabel(tab: string): string {
  const match = /^(.*?)(\s+\(\d+\))$/.exec(tab);
  return match ? `${t(match[1])}${match[2]}` : t(tab);
}

function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}) {
  return (
    <div
      className="flex gap-1 overflow-x-auto border-b border-neutral-200 dark:border-neutral-800"
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          role="tab"
          aria-selected={active === tab}
          className={`h-10 shrink-0 border-b-2 px-3 text-xs ${active === tab ? "border-indigo-500 font-medium text-indigo-600 dark:text-indigo-300" : "border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"}`}
          onClick={() => onChange(tab)}
        >
          {tabLabel(tab)}
        </button>
      ))}
    </div>
  );
}

function DetailHeader({
  icon,
  eyebrow,
  title,
  subtitle,
}: {
  icon: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="flex items-start gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
        <Icon name={icon} size={19} />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-indigo-600 dark:text-indigo-300">
          {t(eyebrow)}
        </p>
        <h2 className="mt-0.5 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-xs text-neutral-500">{subtitle}</p>
        )}
      </div>
    </header>
  );
}

function IdeaPanel({
  detail,
  onOpen,
}: {
  detail: AdvancedIdeaDetail;
  onOpen: (target: AcademicTarget) => void;
}) {
  const [tab, setTab] = useState("Idea");
  const idea = detail.idea;
  const ideaId = recordId(idea, "global_id", "id");
  return (
    <div data-testid="academic-idea-detail">
      <DetailHeader
        icon="bulb"
        eyebrow={value(idea.type, "idea")}
        title={value(idea.label, "Idea sin título")}
        subtitle={`${detail.occurrences.length} ${t("Obras").toLocaleLowerCase(getActiveLang())} · ${detail.relations.length} ${t("Conexiones").toLocaleLowerCase(getActiveLang())}`}
      />
      <Tabs
        tabs={["Idea", "Obras y evidencia", "Relaciones", "Metadatos"]}
        active={tab}
        onChange={setTab}
      />
      <div className="p-5">
        {tab === "Idea" && (
          <div className="max-w-4xl">
            <p className="whitespace-pre-wrap text-sm leading-7 text-neutral-700 dark:text-neutral-300">
              {value(idea.statement, "Sin enunciado publicado")}
            </p>
            {detail.themes.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-1.5">
                {detail.themes.map((theme) => (
                  <span
                    key={theme}
                    className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                  >
                    {theme}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === "Obras y evidencia" && (
          <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="grid grid-cols-[minmax(240px,1.4fr)_minmax(300px,2fr)_7rem] bg-neutral-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
              <span>{t("Obra")}</span>
              <span>{t("Desarrollo / contexto")}</span>
              <span>{t("Rol")}</span>
            </div>
            {detail.occurrences.length ? (
              detail.occurrences.map((entry, index) => {
                const workId = recordId(entry, "nodus_id", "workId");
                const title = value(
                  entry.workTitle ?? entry.title ?? workId,
                  "Obra publicada",
                );
                return (
                  <button
                    key={`${workId}-${index}`}
                    className="grid min-h-16 w-full grid-cols-[minmax(240px,1.4fr)_minmax(300px,2fr)_7rem] items-start border-t border-neutral-200 px-3 py-3 text-left text-xs hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/55"
                    disabled={!workId}
                    onClick={() =>
                      onOpen({ kind: "work", id: workId, label: title })
                    }
                  >
                    <span className="font-medium text-neutral-900 dark:text-neutral-200">
                      {title}
                    </span>
                    <span className="line-clamp-3 pr-4 leading-5 text-neutral-500">
                      {value(
                        entry.development ?? entry.context,
                        "Sin desarrollo publicado",
                      )}
                    </span>
                    <span className="text-neutral-500">
                      {value(entry.role, "—")}
                    </span>
                  </button>
                );
              })
            ) : (
              <Empty>{t("No hay obras publicadas para esta idea.")}</Empty>
            )}{" "}
            {detail.evidence.length > 0 && (
              <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {t("Evidencia")}
                </h3>
                {detail.evidence.map((entry, index) => (
                  <blockquote
                    key={`${ideaId}-e-${index}`}
                    className="mb-2 border-l-2 border-indigo-400 pl-3 text-xs leading-5 text-neutral-600 dark:text-neutral-400"
                  >
                    {value(entry.quote ?? entry.text, "Evidencia sin texto")}
                  </blockquote>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === "Relaciones" && (
          <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            {detail.relations.length ? (
              detail.relations.map((entry, index) => {
                const from = value(entry.from_id, "");
                const to = value(entry.to_id, "");
                const oppositeId = from === ideaId ? to : from;
                const oppositeLabel = value(
                  entry.other_label ??
                    entry.target_label ??
                    entry.source_label ??
                    oppositeId,
                  oppositeId,
                );
                return (
                  <button
                    key={recordId(entry, "id") || `${from}-${to}-${index}`}
                    className="grid min-h-12 w-full grid-cols-[9rem_minmax(0,1fr)_2rem] items-center border-b border-neutral-200 px-3 text-left text-xs hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/55"
                    disabled={!oppositeId}
                    onClick={() =>
                      onOpen({
                        kind: "idea",
                        id: oppositeId,
                        label: oppositeLabel,
                      })
                    }
                  >
                    <span className="text-neutral-500">
                      {value(entry.type, "relación")}
                    </span>
                    <span className="font-medium text-neutral-900 dark:text-neutral-200">
                      {oppositeLabel}
                    </span>
                    <Icon
                      name="chevronRight"
                      size={13}
                      className="text-neutral-400"
                    />
                  </button>
                );
              })
            ) : (
              <Empty>{t("No hay relaciones publicadas.")}</Empty>
            )}
          </div>
        )}
        {tab === "Metadatos" && <FieldTable record={idea} />}
      </div>
    </div>
  );
}

function LibraryLink({ workId }: { workId: string }) {
  if (!workId) return null;
  return (
    <a
      className="btn btn-ghost gap-1.5 border border-neutral-300 text-xs dark:border-neutral-700"
      href={`/library/${encodeURIComponent(workId)}`}
      data-testid="academic-work-open-reader"
    >
      <Icon name="book" size={13} />
      {t("Abrir en Biblioteca")}
    </a>
  );
}

function WorkPanel({
  detail,
  onOpen,
}: {
  detail: AdvancedWorkDetail;
  onOpen: (target: AcademicTarget) => void;
}) {
  const [tab, setTab] = useState("Resumen");
  const work = detail.work;
  const summaryText =
    detail.summary &&
    value(
      detail.summary.summary ?? detail.summary.text ?? detail.summary.content,
      "",
    );
  const workId = recordId(work, "nodus_id", "id");
  return (
    <div data-testid="academic-work-detail">
      <DetailHeader
        icon="book"
        eyebrow={t("Obra")}
        title={value(work.title, "Obra sin título")}
        subtitle={[work.authors, work.year, work.itemType]
          .filter(Boolean)
          .map((entry) => value(entry))
          .join(" · ")}
      />
      <Tabs
        tabs={[
          "Resumen",
          `Ideas (${detail.ideas.length})`,
          "Perfil documental",
          "Metadatos",
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="p-5">
        {tab === "Resumen" && (
          <div className="max-w-4xl space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <LibraryLink workId={workId} />
              <span className="text-[11px] text-neutral-500">
                {t("Lectura publicada y sus versiones disponibles")}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-7 text-neutral-700 dark:text-neutral-300">
              {summaryText || value(work.abstract, "No hay resumen publicado.")}
            </p>
            {work.citation && (
              <p className="rounded-lg bg-neutral-50 p-3 text-xs leading-5 text-neutral-500 dark:bg-neutral-900">
                {value(work.citation)}
              </p>
            )}
            <p className="text-xs text-neutral-500">
              {detail.passages} {t("pasajes indexados")}
            </p>
          </div>
        )}
        {tab.startsWith("Ideas") && (
          <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="grid grid-cols-[9rem_minmax(260px,1fr)_minmax(320px,2fr)_2rem] bg-neutral-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
              <span>{t("Tipo")}</span>
              <span>{t("Idea")}</span>
              <span>{t("Enunciado")}</span>
              <span />
            </div>
            {detail.ideas.length ? (
              detail.ideas.map((idea, index) => {
                const id = recordId(idea, "global_id", "id");
                const label = value(idea.label, id);
                return (
                  <button
                    key={id || index}
                    className="grid min-h-16 w-full grid-cols-[9rem_minmax(260px,1fr)_minmax(320px,2fr)_2rem] items-start border-t border-neutral-200 px-3 py-3 text-left text-xs hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/55"
                    onClick={() => onOpen({ kind: "idea", id, label })}
                  >
                    <span className="text-neutral-500">
                      {value(idea.type, "—")}
                    </span>
                    <span className="font-medium text-neutral-900 dark:text-neutral-200">
                      {label}
                    </span>
                    <span className="line-clamp-3 pr-3 leading-5 text-neutral-500">
                      {value(idea.statement, "—")}
                    </span>
                    <Icon
                      name="chevronRight"
                      size={13}
                      className="text-neutral-400"
                    />
                  </button>
                );
              })
            ) : (
              <Empty>{t("No hay ideas publicadas para esta obra.")}</Empty>
            )}
          </div>
        )}
        {tab === "Perfil documental" &&
          (detail.documentProfile ? (
            <div className="space-y-5">
              <FieldTable record={detail.documentProfile.version ?? {}} />
              {(detail.documentProfile.sections?.length ?? 0) > 0 && (
                <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
                  {detail.documentProfile.sections!.map((section, index) => (
                    <div
                      key={recordId(section, "section_id", "id") || index}
                      className="border-b border-neutral-200 p-3 dark:border-neutral-800"
                    >
                      <strong className="text-sm text-neutral-900 dark:text-neutral-200">
                        {value(section.title, tx("Sección {n}", { n: index + 1 }))}
                      </strong>
                      <p className="mt-1 text-xs leading-5 text-neutral-500">
                        {value(section.summary, "")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Empty>{t("No hay perfil documental publicado.")}</Empty>
          ))}
        {tab === "Metadatos" && <FieldTable record={work} />}
      </div>
    </div>
  );
}

function AuthorPanel({
  dossier,
  onOpen,
}: {
  dossier: AdvancedAuthorDossier;
  onOpen: (target: AcademicTarget) => void;
}) {
  const [tab, setTab] = useState("Síntesis");
  const editedWorks = dossier.editedWorks || [];
  return (
    <div data-testid="academic-author-detail">
      <DetailHeader
        icon="graduation"
        eyebrow={t("Autor")}
        title={value(
          dossier.fullName || dossier.author.name,
          "Autor sin nombre",
        )}
        subtitle={`${dossier.works.length} ${t("Obras").toLocaleLowerCase(getActiveLang())} · ${dossier.ideas.length} ${t("Ideas").toLocaleLowerCase(getActiveLang())} · ${dossier.relations.length} ${t("Conexiones").toLocaleLowerCase(getActiveLang())}`}
      />
      <Tabs
        tabs={[
          "Síntesis",
          `Obras (${dossier.works.length})`,
          ...(editedWorks.length ? [`Editados (${editedWorks.length})`] : []),
          `Ideas (${dossier.ideas.length})`,
          `Relaciones (${dossier.relations.length})`,
          "Metadatos",
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="p-5">
        {tab === "Síntesis" &&
          (dossier.synthesis ? (
            <div className="max-w-4xl space-y-4 text-sm leading-7 text-neutral-700 dark:text-neutral-300">
              <p>{dossier.synthesis.thesis}</p>
              {dossier.synthesis.remember.length > 0 && (
                <ul className="list-disc pl-5">
                  {dossier.synthesis.remember.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-neutral-500">
                {dossier.synthesis.positioning}
              </p>
            </div>
          ) : (
            <Empty>{t("No hay síntesis publicada para este autor.")}</Empty>
          ))}
        {tab.startsWith("Obras") && (
          <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="grid grid-cols-[minmax(300px,2fr)_7rem_9rem_6rem_2rem] bg-neutral-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
              <span>{t("Título")}</span>
              <span>{t("Año")}</span>
              <span>{t("Tipo")}</span>
              <span>{t("Estado")}</span>
              <span />
            </div>
            {dossier.works.length ? (
              dossier.works.map((work) => (
                <button
                  key={work.nodus_id}
                  className="grid min-h-12 w-full grid-cols-[minmax(300px,2fr)_7rem_9rem_6rem_2rem] items-center border-t border-neutral-200 px-3 text-left text-xs hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/55"
                  onClick={() =>
                    onOpen({
                      kind: "work",
                      id: work.nodus_id,
                      label: work.title,
                    })
                  }
                >
                  <span className="font-medium text-neutral-900 dark:text-neutral-200">
                    {work.title}
                  </span>
                  <span className="text-neutral-500">{value(work.year)}</span>
                  <span className="text-neutral-500">
                    {value(work.itemType)}
                  </span>
                  <span className="text-neutral-500">
                    {work.read ? t("Leída") : "—"}
                  </span>
                  <Icon
                    name="chevronRight"
                    size={13}
                    className="text-neutral-400"
                  />
                </button>
              ))
            ) : (
              <Empty>{t("No hay obras publicadas.")}</Empty>
            )}
          </div>
        )}
        {tab.startsWith("Editados") && (
          <div
            className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800"
            data-testid="academic-author-edited-works"
          >
            <div className="grid grid-cols-[minmax(300px,2fr)_7rem_9rem_6rem_2rem] bg-neutral-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
              <span>{t("Volumen")}</span>
              <span>{t("Año")}</span>
              <span>{t("Tipo")}</span>
              <span>{t("Estado")}</span>
              <span />
            </div>
            {editedWorks.map((work) => (
              <button
                key={work.nodus_id}
                className="grid min-h-12 w-full grid-cols-[minmax(300px,2fr)_7rem_9rem_6rem_2rem] items-center border-t border-neutral-200 px-3 text-left text-xs hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/55"
                onClick={() =>
                  onOpen({ kind: "work", id: work.nodus_id, label: work.title })
                }
              >
                <span className="font-medium text-neutral-900 dark:text-neutral-200">
                  {work.title}
                </span>
                <span className="text-neutral-500">{value(work.year)}</span>
                <span className="text-cyan-600 dark:text-cyan-300">
                  {t("Editado")}
                </span>
                <span className="text-neutral-500">
                  {work.attributed
                    ? t("Atribución provisional")
                    : t("Sin ideas atribuidas")}
                </span>
                <Icon
                  name="chevronRight"
                  size={13}
                  className="text-neutral-400"
                />
              </button>
            ))}
          </div>
        )}
        {tab.startsWith("Ideas") && (
          <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            {dossier.ideas.length ? (
              dossier.ideas.map((idea) => (
                <button
                  key={`${idea.global_id}-${idea.workId}`}
                  className="grid min-h-16 w-full grid-cols-[9rem_minmax(240px,1fr)_minmax(300px,2fr)_2rem] items-start border-b border-neutral-200 px-3 py-3 text-left text-xs hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/55"
                  onClick={() =>
                    onOpen({
                      kind: "idea",
                      id: idea.global_id,
                      label: idea.label,
                    })
                  }
                >
                  <span className="text-neutral-500">{idea.type}</span>
                  <span className="font-medium text-neutral-900 dark:text-neutral-200">
                    {idea.label}
                    <small className="mt-1 block font-normal text-neutral-500">
                      {idea.workTitle}
                    </small>
                  </span>
                  <span className="line-clamp-3 pr-3 leading-5 text-neutral-500">
                    {idea.statement || idea.development}
                  </span>
                  <Icon
                    name="chevronRight"
                    size={13}
                    className="text-neutral-400"
                  />
                </button>
              ))
            ) : (
              <Empty>{t("No hay ideas publicadas.")}</Empty>
            )}
          </div>
        )}
        {tab.startsWith("Relaciones") && (
          <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            {dossier.relations.length ? (
              dossier.relations.map((relation) => (
                <button
                  key={`${relation.author_id}-${relation.type}`}
                  className="grid min-h-12 w-full grid-cols-[minmax(240px,1fr)_9rem_7rem_minmax(220px,1.2fr)_2rem] items-center border-b border-neutral-200 px-3 text-left text-xs hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/55"
                  onClick={() =>
                    onOpen({
                      kind: "author",
                      id: relation.author_id,
                      label: relation.name,
                    })
                  }
                >
                  <span className="font-medium text-neutral-900 dark:text-neutral-200">
                    {relation.name}
                  </span>
                  <span className="text-neutral-500">{relation.type}</span>
                  <span className="text-neutral-500">{relation.weight}</span>
                  <span className="truncate text-neutral-500">
                    {relation.sharedThemes.join(", ")}
                  </span>
                  <Icon
                    name="chevronRight"
                    size={13}
                    className="text-neutral-400"
                  />
                </button>
              ))
            ) : (
              <Empty>{t("No hay relaciones autorales publicadas.")}</Empty>
            )}
          </div>
        )}
        {tab === "Metadatos" && <FieldTable record={dossier.author} />}
      </div>
    </div>
  );
}

export function AcademicDetailExplorer({
  spaceId,
  origin,
  initialTarget,
  onOrigin,
  onOpenTarget,
  className = "",
}: {
  spaceId: string;
  origin: string;
  initialTarget: AcademicTarget;
  onOrigin: () => void;
  onOpenTarget?: (target: AcademicTarget) => void;
  className?: string;
}) {
  const [history, setHistory] = useState<AcademicTarget[]>([initialTarget]);
  const [index, setIndex] = useState(0);
  const [payload, setPayload] = useState<
    AdvancedIdeaDetail | AdvancedWorkDetail | AdvancedAuthorDossier | null
  >(null);
  const [error, setError] = useState<unknown>();
  const requestRef = useRef(0);
  const target = history[index] ?? initialTarget;

  useEffect(() => {
    setHistory([initialTarget]);
    setIndex(0);
    setPayload(null);
    setError(undefined);
  }, [initialTarget.kind, initialTarget.id]);
  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setPayload(null);
    setError(undefined);
    try {
      const next =
        target.kind === "idea"
          ? await advancedRest.idea(spaceId, target.id)
          : target.kind === "work"
            ? await advancedRest.work(spaceId, target.id)
            : await advancedRest.authorDossier(spaceId, target.id);
      if (request === requestRef.current) setPayload(next);
    } catch (cause) {
      if (request === requestRef.current) setError(cause);
    }
  }, [spaceId, target.kind, target.id]);
  useEffect(() => {
    void load();
  }, [load]);
  // Clear the previous payload synchronously. Otherwise React renders the new target with
  // the old target's shape for one frame (e.g. an idea payload has no `work`), which used to
  // crash the entire search view when clicking an idea's first work.
  const open = (next: AcademicTarget) => {
    if (!next.id) return;
    if (onOpenTarget) {
      onOpenTarget(next);
      return;
    }
    setPayload(null);
    setError(undefined);
    setHistory((current) => [...current.slice(0, index + 1), next]);
    setIndex(index + 1);
  };
  return (
    <div
      className={`flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 ${className}`}
      data-testid="academic-detail-explorer"
    >
      <nav
        className="flex h-10 shrink-0 items-center gap-1 border-b border-neutral-200 px-3 dark:border-neutral-800"
        aria-label={t("Historial de navegación")}
      >
        <button
          className="btn btn-ghost h-7 w-7 p-0"
          aria-label={t("Atrás")}
          disabled={index === 0}
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
        >
          <Icon name="arrowLeft" size={13} />
        </button>
        <button
          className="btn btn-ghost h-7 w-7 p-0"
          aria-label={t("Adelante")}
          disabled={index >= history.length - 1}
          onClick={() =>
            setIndex((current) => Math.min(history.length - 1, current + 1))
          }
        >
          <Icon name="arrowRight" size={13} />
        </button>
        <button
          className="btn btn-ghost h-7 px-2 text-xs"
          title={t("Volver al registro de origen")}
          disabled={index === 0}
          onClick={() => setIndex(0)}
        >
          <Icon name="home" size={12} /> {t("Origen")}
        </button>
        <span className="mx-1 text-neutral-300 dark:text-neutral-700">/</span>
        <button
          className="min-w-0 shrink-0 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
          onClick={onOrigin}
        >
          {origin}
        </button>
        <span className="text-neutral-300 dark:text-neutral-700">/</span>
        <span className="min-w-0 truncate text-xs text-neutral-500">
          {target.label}
        </span>
        <span className="ml-auto rounded-full border border-neutral-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
          {t("Solo lectura")}
        </span>
      </nav>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="m-5 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            <strong>{t("No se ha podido cargar este registro.")}</strong>
            <p className="mt-1 text-xs opacity-80">
              {errorText(error)}
            </p>
            <button
              className="btn btn-ghost mt-3 text-xs"
              onClick={() => void load()}
            >
              {t("Reintentar")}
            </button>
          </div>
        ) : !payload ? (
          <div className="grid h-48 place-items-center text-sm text-neutral-500">
            {t("Cargando…")}
          </div>
        ) : target.kind === "idea" ? (
          <IdeaPanel detail={payload as AdvancedIdeaDetail} onOpen={open} />
        ) : target.kind === "work" ? (
          <WorkPanel detail={payload as AdvancedWorkDetail} onOpen={open} />
        ) : (
          <AuthorPanel
            dossier={payload as AdvancedAuthorDossier}
            onOpen={open}
          />
        )}
      </div>
    </div>
  );
}
