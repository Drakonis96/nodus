import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/ui";
import { api } from "./api";
import type { JsonRecord, PageResponse } from "./types";
import { t } from "./i18nShim";

const text = (value: unknown, fallback = "—") =>
  value == null || value === "" ? fallback : String(value);
const rows = (page: PageResponse | undefined, key: string) =>
  Array.isArray(page?.[key])
    ? (page![key] as JsonRecord[])
    : Array.isArray(page?.items)
      ? page!.items
      : [];

/**
 * The archive's hierarchy mode is intentionally a different projection from
 * gallery mode.  Desktop users use it to scan a source's archival context
 * (unit/collection first, item second), so flattening the same cards into a
 * third grid loses both the navigation affordance and the provenance signal.
 */
function ArchiveHierarchy({
  items,
  units,
  folders,
  tree,
  onOpen,
}: {
  items: JsonRecord[];
  units: JsonRecord[];
  folders: JsonRecord[];
  tree: "provenance" | "collections";
  onOpen: (id: string) => void;
}) {
  type HierarchyGroup = {
    id: string;
    title: string;
    icon: "layers" | "folder";
    items: JsonRecord[];
  };
  const groups: HierarchyGroup[] =
    tree === "provenance"
      ? units.map((unit) => ({
          id: text(unit.unit_id, "unit:unknown"),
          title: text(unit.title, t("Unidad archivística")),
          icon: "layers" as const,
          items: items.filter(
            (item) =>
              String(item.unit_id ?? item.description_unit_id ?? "") ===
              text(unit.unit_id, ""),
          ),
        }))
      : folders.map((folder) => ({
          id: text(folder.folder_id, "folder:unknown"),
          title: text(folder.name, t("Colección")),
          icon: "folder" as const,
          items: items.filter((item) =>
            String(item.folder_id ?? "")
              .split(",")
              .includes(text(folder.folder_id, "")),
          ),
        }));
  const groupedIds = new Set(
    groups.flatMap((group) => group.items.map((item) => text(item.item_id))),
  );
  const ungrouped = items.filter((item) => !groupedIds.has(text(item.item_id)));
  if (ungrouped.length)
    groups.push({
      id: "ungrouped",
      title:
        tree === "provenance"
          ? t("Sin unidad archivística")
          : t("Sin colección"),
      icon: tree === "provenance" ? "layers" : "folder",
      items: ungrouped,
    });

  return (
    <div className="space-y-4" data-testid="primary-sources-archive-hierarchy">
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section
            key={group.id}
            className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
            data-testid="primary-source-hierarchy-group"
          >
            <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-800/60">
              <Icon name={group.icon} size={15} className="text-indigo-500" />
              <h2 className="text-sm font-semibold">{group.title}</h2>
              <span className="ml-auto text-xs text-neutral-500">
                {group.items.length}
              </span>
            </div>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {group.items.map((item) => (
                <button
                  key={text(item.item_id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
                  onClick={() => onOpen(text(item.item_id, ""))}
                >
                  <span className="mt-0.5 shrink-0 text-neutral-400">
                    <Icon name="file" size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">
                      {text(item.title, t("Fuente"))}
                    </strong>
                    <span className="mt-1 block line-clamp-2 text-xs text-neutral-500">
                      {text(item.description, t("Sin descripción publicada"))}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-neutral-400">
                    {text(item.date_display ?? item.created_at, "")}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      {groups.every((group) => group.items.length === 0) && (
        <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          {t("No hay fuentes publicadas con estos filtros.")}
        </div>
      )}
    </div>
  );
}

export function PrimarySourcesArchiveServerView({
  spaceId,
  onOpen,
}: {
  spaceId: string;
  onOpen: (id: string) => void;
}) {
  const [items, setItems] = useState<JsonRecord[]>([]);
  const [units, setUnits] = useState<JsonRecord[]>([]);
  const [folders, setFolders] = useState<JsonRecord[]>([]);
  const [query, setQuery] = useState("");
  const [tree, setTree] = useState<"provenance" | "collections">("provenance");
  const [unitFilter, setUnitFilter] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [mode, setMode] = useState<"table" | "gallery" | "hierarchy">("table");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      api.collection(spaceId, "archive-items", { limit: "200" }),
      api.collection(spaceId, "archive-units", { limit: "200" }),
    ])
      .then(([itemPage, unitPage]) => {
        if (!active) return;
        const nextItems = rows(itemPage, "items");
        setItems(nextItems);
        setUnits(rows(unitPage, "units"));
        setFolders(
          [
            ...new Map(
              nextItems.map((item) => [
                String(item.folder_id ?? ""),
                { folder_id: item.folder_id, name: item.folder_name },
              ]),
            ).values(),
          ].filter((folder) => folder.folder_id),
        );
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [spaceId]);
  const visible = useMemo(
    () =>
      items.filter((item) => {
        const needle = query.trim().toLocaleLowerCase();
        if (
          needle &&
          !`${item.title ?? ""} ${item.description ?? ""} ${item.date_display ?? ""} ${item.reference_code ?? ""}`
            .toLocaleLowerCase()
            .includes(needle)
        )
          return false;
        if (
          unitFilter &&
          String(item.unit_id ?? item.description_unit_id ?? "") !== unitFilter
        )
          return false;
        if (
          folderFilter &&
          !String(item.folder_id ?? "")
            .split(",")
            .includes(folderFilter)
        )
          return false;
        return true;
      }),
    [items, query, unitFilter, folderFilter],
  );
  return (
    <div
      className="flex h-full min-h-0 bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid="primary-sources-archive"
    >
      <aside
        className="hidden w-72 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 lg:flex"
        data-testid="primary-sources-archive-sidebar"
        data-tour="primary-sources-provenance-tree"
      >
        <div className="grid grid-cols-2 gap-1 border-b border-neutral-200 p-2 text-[10px] dark:border-neutral-800">
          <button
            className={`rounded px-2 py-2 ${tree === "provenance" ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200" : "text-neutral-500"}`}
            onClick={() => setTree("provenance")}
          >
            {t("Ubicación archivística")}
          </button>
          <button
            className={`rounded px-2 py-2 ${tree === "collections" ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200" : "text-neutral-500"}`}
            onClick={() => setTree("collections")}
          >
            {t("Colecciones de trabajo")}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <button
            className="mb-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
            onClick={() => {
              setUnitFilter("");
              setFolderFilter("");
            }}
          >
            <Icon name="archive" size={13} />
            {t("Todo el archivo")}{" "}
            <span className="ml-auto text-[10px] text-neutral-500">
              {items.length}
            </span>
          </button>
          {tree === "provenance"
            ? units.map((unit) => (
                <button
                  key={text(unit.unit_id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 ${unitFilter === text(unit.unit_id) ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200" : ""}`}
                  onClick={() => {
                    setUnitFilter(text(unit.unit_id, ""));
                    setFolderFilter("");
                  }}
                >
                  <Icon name="layers" size={13} />
                  {text(unit.title, t("Unidad"))}
                  <span className="ml-auto text-[10px] text-neutral-500">
                    {
                      items.filter(
                        (item) =>
                          String(item.unit_id ?? "") === text(unit.unit_id),
                      ).length
                    }
                  </span>
                </button>
              ))
            : folders.map((folder) => (
                <button
                  key={text(folder.folder_id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 ${folderFilter === text(folder.folder_id) ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200" : ""}`}
                  onClick={() => {
                    setFolderFilter(text(folder.folder_id, ""));
                    setUnitFilter("");
                  }}
                >
                  <Icon name="folder" size={13} />
                  {text(folder.name, t("Colección"))}
                </button>
              ))}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center gap-2">
            <Icon name="archive" className="text-indigo-500" />
            <h1 className="text-base font-semibold">{t("Archivo")}</h1>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800">
              {visible.length}
            </span>
            <label className="relative min-w-[14rem] flex-1">
              <Icon
                name="search"
                size={14}
                className="pointer-events-none absolute left-3 top-2.5 text-neutral-400"
              />
              <input
                className="input input-with-leading-icon h-9 w-full text-sm"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t(
                  "Buscar metadatos: título, signatura o descripción…",
                )}
                aria-label={t("Buscar fuentes por metadatos")}
              />
            </label>
            <div
              className="flex rounded border border-neutral-200 p-0.5 dark:border-neutral-700"
              data-tour="primary-sources-view-modes"
            >
              {(["table", "gallery", "hierarchy"] as const).map((entry) => (
                <button
                  key={entry}
                  className={`rounded p-2 text-[10px] ${mode === entry ? "bg-neutral-100 text-indigo-700 dark:bg-neutral-800 dark:text-indigo-200" : "text-neutral-400"}`}
                  aria-pressed={mode === entry}
                  aria-label={t(
                    entry === "table"
                      ? "Vista tabla"
                      : entry === "gallery"
                        ? "Vista galería"
                        : "Vista jerarquía",
                  )}
                  onClick={() => setMode(entry)}
                >
                  <Icon
                    name={
                      (entry === "table"
                        ? "table"
                        : entry === "gallery"
                          ? "grid"
                          : "network") as never
                    }
                    size={14}
                  />
                </button>
              ))}
            </div>
          </div>
        </header>
        {error && (
          <p
            role="alert"
            className="m-4 rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"
          >
            {error}
          </p>
        )}
        <section className="min-h-0 flex-1 overflow-auto p-4">
          {mode === "table" ? (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-100 text-[10px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-800">
                  <tr>
                    <th className="px-3 py-2">{t("Título")}</th>
                    <th className="px-3 py-2">{t("Descripción")}</th>
                    <th className="px-3 py-2">{t("Fecha")}</th>
                    <th className="px-3 py-2">{t("Tipo")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr
                      key={text(item.item_id)}
                      tabIndex={0}
                      className="cursor-pointer border-t border-neutral-100 hover:bg-indigo-50 dark:border-neutral-800 dark:hover:bg-indigo-950/30"
                      onClick={() => onOpen(text(item.item_id, ""))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter")
                          onOpen(text(item.item_id, ""));
                      }}
                    >
                      <td className="px-3 py-3 font-medium">
                        {text(item.title, t("Fuente"))}
                      </td>
                      <td className="px-3 py-3 text-neutral-500">
                        {text(item.description, "")}
                      </td>
                      <td className="px-3 py-3">
                        {text(item.date_display ?? item.created_at, "")}
                      </td>
                      <td className="px-3 py-3">
                        {text(item.kind ?? item.doc_type, "")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : mode === "hierarchy" ? (
            <ArchiveHierarchy
              items={visible}
              units={units}
              folders={folders}
              tree={tree}
              onOpen={onOpen}
            />
          ) : (
            <div
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
              data-testid="primary-sources-archive-gallery"
            >
              {visible.map((item) => (
                <button
                  key={text(item.item_id)}
                  className="rounded-xl border border-neutral-200 bg-white p-4 text-left hover:border-indigo-300 dark:border-neutral-800 dark:bg-neutral-900"
                  onClick={() => onOpen(text(item.item_id, ""))}
                >
                  <strong className="block truncate text-sm">
                    {text(item.title, t("Fuente"))}
                  </strong>
                  <span className="mt-2 block line-clamp-3 text-xs text-neutral-500">
                    {text(item.description, t("Sin descripción publicada"))}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
