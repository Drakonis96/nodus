import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GraphData } from "@shared/types";
import type { StellarPosition, StellarTheme } from "@shared/stellarGraph";
import { themeName, type StellarGraphSource } from "./source";
import { sortThemes, themeConstellation } from "./themes";
import { StellarCanvas, type StellarCanvasApi } from "./StellarCanvas";
import { errorText, t, tx } from "../i18n";
import { Icon } from "../components/ui";

const EMPTY: GraphData = { nodes: [], edges: [] };

/**
 * First stop of the graph: every theme of the vault — the ones a scan extracted and the
 * ones the user curated in "Temas principales" — drawn on the same canvas, with the same
 * stars and the same label cards as the ideas they open onto. Equal nodes: what a theme
 * holds is written under its name, not encoded in its size.
 */
export function ThemesOverview({
  source,
  onOpen,
  toolbar,
}: {
  /** A new source identity — a reprocess, a vault change — refetches the hubs. */
  source: StellarGraphSource;
  onOpen(theme: StellarTheme): void;
  toolbar?: ReactNode;
}) {
  const [themes, setThemes] = useState<StellarTheme[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [positions, setPositions] = useState<Record<string, StellarPosition>>({});
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const api = useRef<StellarCanvasApi | null>(null);
  const framed = useRef("");
  useEffect(() => {
    let live = true;
    setError("");
    setThemes(null);
    void source
      .themes?.()
      .then((list) => live && setThemes(list))
      .catch((err) => live && (setError(errorText(err)), setThemes([])));
    return () => {
      live = false;
    };
  }, [source]);

  const sorted = useMemo(() => sortThemes(themes || []), [themes]);
  const needle = query.trim().toLocaleLowerCase();
  const shown = useMemo(
    () => (needle ? sorted.filter((theme) => themeName(theme).toLocaleLowerCase().includes(needle)) : sorted),
    [sorted, needle],
  );
  const ideas = sorted.reduce((total, theme) => total + theme.ideaCount, 0);

  // A theme is a node like any other: the canvas draws it, we only say what it is.
  const data = useMemo<GraphData>(
    () => ({
      nodes: shown.map((theme) => ({
        id: theme.id,
        label: themeName(theme) || theme.id,
        type: "theme",
        statement: tx("{n} ideas en este tema", { n: theme.ideaCount.toLocaleString() }),
        workCount: theme.workCount,
        workIds: [],
        read: false,
        themes: [],
        years: [],
        authors: [],
        maxConfidence: 1,
      })),
      edges: [],
    }),
    [shown],
  );
  const byId = useMemo(() => new Map(shown.map((theme) => [theme.id, theme])), [shown]);

  // The rings are decided by the themes on screen, so filtering re-forms the constellation.
  const signature = shown.map((theme) => theme.id).join("|");
  useEffect(() => {
    setPositions(themeConstellation(shown));
    framed.current = "";
  }, [signature]);
  useEffect(() => {
    if (!data.nodes.length || framed.current === signature) return;
    if (!data.nodes.every((node) => positions[node.id])) return;
    framed.current = signature;
    // Centre the themes at full size rather than fitting them: zoomed out, a node shrinks
    // to a speck and stops looking like the graph node it is. "Fit all" is one click away.
    const points = data.nodes.map((node) => positions[node.id]);
    setCamera({
      x: Math.round((Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2),
      // Centre what is seen, not what is placed: a label hangs below its node, so the
      // constellation's visual mass sits lower than the nodes it is made of.
      y: Math.round((Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2) + 30,
      zoom: 1,
    });
  }, [data, positions, signature]);
  const bindApi = useCallback((value: StellarCanvasApi | null) => {
    api.current = value;
  }, []);

  return (
    <div className="stellar-workspace stellar-themes" data-testid="stellar-themes" data-theme-count={sorted.length}>
      <header className="stellar-header">
        <div className="stellar-heading">
          <span className="stellar-eyebrow">NODUS / {t("TEMAS")}</span>
          <h2>{t("Los temas de tu corpus. Entra en uno para ver su red.")}</h2>
        </div>
        <div className="stellar-header-actions">
          {toolbar}
          <div className="stellar-search">
            <div className="stellar-search-field">
              <Icon name="search" size={14} />
              <input
                className="stellar-themes-filter"
                type="search"
                value={query}
                placeholder={t("Filtrar temas…")}
                aria-label={t("Filtrar temas")}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
        </div>
      </header>
      <div className="stellar-body">
        <div className="stellar-stage">
          <StellarCanvas
            data={themes === null ? EMPTY : data}
            positions={positions}
            camera={camera}
            onPositions={setPositions}
            onCamera={setCamera}
            onApi={bindApi}
            onNode={(id) => {
              const theme = byId.get(id);
              if (theme) onOpen(theme);
            }}
            onEdge={() => {}}
            labelPolicy="all"
            nodeMeta={(node) => {
              const count = byId.get(node.id)?.ideaCount ?? 0;
              return `${t("Tema")} · ${count.toLocaleString()} ${t(count === 1 ? "idea" : "ideas")}`;
            }}
          />
          <div className="stellar-meta">
            <span className="stellar-live-dot" />
            {themes === null
              ? t("Reuniendo los temas…")
              : `${sorted.length.toLocaleString()} ${t(sorted.length === 1 ? "tema" : "temas")} · ${ideas.toLocaleString()} ${t("ideas")}`}
          </div>
          <div className="stellar-navigation">
            <button title={t("Alejar")} onClick={() => api.current?.zoom(1 / 1.55)}>
              −
            </button>
            <button title={t("Acercar")} onClick={() => api.current?.zoom(1.55)}>
              +
            </button>
            <button onClick={() => api.current?.fit()}>{t("Encuadrar")}</button>
          </div>
          {error && (
            <div className="stellar-error" role="alert">
              {error}
            </div>
          )}
          {themes !== null && !sorted.length && !error && (
            <div className="stellar-empty stellar-empty-hint">
              {t("Todavía no hay temas. Analiza obras o añade los tuyos en Herramientas › Temas.")}
            </div>
          )}
          {themes !== null && !!sorted.length && !shown.length && (
            <div className="stellar-empty stellar-empty-hint">{t("Ningún tema coincide con el filtro.")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
