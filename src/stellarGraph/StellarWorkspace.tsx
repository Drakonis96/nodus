import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { GraphData, IdeaDetail, EdgeDetail } from "@shared/types";
import type { StellarSession, StellarPosition } from "@shared/stellarGraph";
import {
  NodeDetailPanel,
  type DetailLoading,
} from "../components/NodeDetailPanel";
import { StellarCanvas, type StellarCanvasApi } from "./StellarCanvas";
import { Exploration } from "./exploration";
import type { StellarGraphSource } from "./source";
import { StellarSearch } from "./StellarSearch";
import { isLegacyLinearLayout, STELLAR_LAYOUT_VERSION } from "./layout";
import { relation, RELATIONS } from "./palette";
import { t } from "../i18n";
const EMPTY: GraphData = { nodes: [], edges: [] };
export interface StellarWorkspaceProps {
  source: StellarGraphSource;
  workId?: string;
  initialSeed?: string;
  initialEdge?: string;
  initialSearch?: string;
  author?: string;
  title?: string;
  toolbar?: ReactNode;
  onOpenIdea?(id: string): void;
  openEvidence?(ref: string, location: string | null): void;
  saveIdea?(detail: IdeaDetail): Promise<void>;
  saveEdge?(detail: EdgeDetail): Promise<void>;
  audit?: boolean;
  baseline?: boolean;
}
export function StellarWorkspace({
  source,
  workId,
  initialSeed,
  initialEdge,
  initialSearch,
  author,
  title,
  toolbar,
  onOpenIdea,
  openEvidence,
  saveIdea,
  saveEdge,
  audit,
}: StellarWorkspaceProps) {
  const [engine, setEngine] = useState<Exploration | null>(null),
    [data, setData] = useState<GraphData>(EMPTY);
  const [positions, setPositions] = useState<Record<string, StellarPosition>>(
      {},
    ),
    [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [limit, setLimit] = useState(25),
    [speed, setSpeed] = useState(1),
    [playing, setPlaying] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [animating, setAnimating] = useState(false),
    [showSources, setShowSources] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [activeEdge, setActiveEdge] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [idea, setIdea] = useState<IdeaDetail | null>(null),
    [edge, setEdge] = useState<EdgeDetail | null>(null),
    [detailLoading, setDetailLoading] = useState<DetailLoading | null>(null);
  const [playbackNotice, setPlaybackNotice] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const [width, setWidth] = useState(390),
    [font, setFont] = useState(14),
    [follow, setFollow] = useState(true),
    [reload, setReload] = useState(0);
  const selectionEpoch = useRef(0);
  const api = useRef<StellarCanvasApi | null>(null),
    detailSeq = useRef(0),
    life = useRef(0),
    stepping = useRef(false),
    count = useRef(0),
    fitOnce = useRef(false),
    latestSession = useRef<StellarSession | null>(null),
    ready = useRef(false);
  const bindApi = useCallback((value: StellarCanvasApi | null) => {
    api.current = value;
  }, []);
  const frameStep = useCallback((id: string | null) => {
    setActiveEdge(id);
    setFollow(true);
    // Transport intent must reframe even when the relation has not changed.
    setFocusRequest(value => value + 1);
  }, []);
  const manualCamera = useCallback(() => {
    setFollow(false);
    setPlaying(false);
    setAnimating(false);
    engine?.interrupt();
  }, [engine]);
  useEffect(() => {
    const generation = ++life.current;
    ready.current = false;
    setLoading(true);
    setPlaying(false);
    setEngine(null);
    setData(EMPTY);
    setError("");
    setPositions({});
    setActiveEdge(null);
    setFocusRequest(0);
    fitOnce.current = false;
    const e = new Exploration(source);
    void (async () => {
      const saved = await source.restore?.();
      if (generation !== life.current) return;
      if (workId) await e.baseline(workId);
      if (generation !== life.current) return;
      if (saved?.version === 1) {
        await e.restore(saved);
        if (generation !== life.current) return;
        const repairRow = workId && saved.layoutVersion !== STELLAR_LAYOUT_VERSION
          && isLegacyLinearLayout(e.visible().nodes.map(n => n.id), saved.positions || {});
        setPositions(repairRow ? {} : saved.positions || {});
        setCamera(repairRow ? { x: 0, y: 0, zoom: 1 } : saved.camera);
        setLimit(saved.limit);
        setSpeed(saved.speed);
        fitOnce.current = !repairRow;
      }
      if (initialSeed) {
        e.ingest(
          await source.page({ kind: "elements", nodeIds: [initialSeed] }),
        );
        e.start(initialSeed);
      }
      if (initialEdge) {
        const page = await source.page({
          kind: "elements",
          edgeIds: [initialEdge],
        });
        e.ingest(page);
        for (const n of page.nodes)
          if (!e.seeds.includes(n.id)) e.seeds.push(n.id);
        for (const edge of page.edges)
          if (!e.history.includes(edge.id)) e.history.push(edge.id);
        e.cursor = e.history.length;
      }
      if (generation !== life.current) return;
      setEngine(e);
      setData(e.visible());
      ready.current = true;
      setLoading(false);
    })().catch((err) => {
      if (generation === life.current) {
        setError(String(err));
        setLoading(false);
      }
    });
    return () => {
      e.cancel();
      life.current++;
      ready.current = false;
    };
  }, [source, workId, initialSeed, initialEdge, reload]);
  useEffect(() => {
    if (!engine || !ready.current) return;
    const state: StellarSession = {
      version: 1,
      layoutVersion: STELLAR_LAYOUT_VERSION,
      seeds: [...engine.seeds],
      history: [...engine.history],
      cursor: engine.cursor,
      activeSeed: engine.activeSeed,
      positions,
      camera,
      limit,
      speed,
    };
    latestSession.current = state;
    const timer = setTimeout(() => {
      void source
        .save?.(state)
        .catch((err) =>
          setError(`${t("No se pudo guardar el canvas")}: ${err}`),
        );
    }, 500);
    return () => clearTimeout(timer);
  }, [engine, data, positions, camera, limit, speed, source]);
  useEffect(
    () => () => {
      if (latestSession.current)
        void source.save?.(latestSession.current).catch(() => {});
    },
    [source],
  );
  useEffect(() => {
    if (
      !fitOnce.current &&
      data.nodes.length &&
      data.nodes.every((n) => positions[n.id])
    ) {
      fitOnce.current = true;
      if (!follow || !focusRequest) api.current?.fit();
    }
  }, [positions, data, follow, focusRequest]);
  const next = useCallback(async () => {
    if (!engine || stepping.current) return;
    stepping.current = true;
    setPlaybackNotice("");
    setBusy(true);
    const generation = life.current,
      selection = selectionEpoch.current;
    try {
      const e = await engine.next();
      if (generation !== life.current) return;
      setData(engine.visible());
      if (e === undefined) {
        setPlaying(false);
        return;
      }
      if (!e) {
        setPlaying(false);
        frameStep(engine.history[engine.cursor - 1] || null);
        setPlaybackNotice(t("Fin del recorrido"));
        setMessage(t("Has llegado al final de las conexiones disponibles."));
        return;
      }
      if (selection === selectionEpoch.current) {
        frameStep(e.id);
        setAnimating(true);
      }
      setMessage(
        `${engine.nodes.get(e.source)?.label} → ${t(relation(e.type).label)} → ${engine.nodes.get(e.target)?.label} · ${t(e.verdict === "confirmed" ? "Confirmada" : e.basis === "explicit" ? "Extraída de la fuente · Sin validar" : "Inferida · Sin validar")}`,
      );
      count.current++;
      if (limit > 0 && count.current >= limit) {
        setPlaying(false);
        setPlaybackNotice(t("Límite alcanzado"));
        setMessage(
          t(
            "Límite alcanzado. Puedes continuar con Siguiente o iniciar otra reproducción.",
          ),
        );
      }
    } catch (err) {
      setError(String(err));
      setPlaying(false);
    } finally {
      stepping.current = false;
      if (generation === life.current) setBusy(false);
    }
  }, [engine, limit, frameStep]);
  useEffect(() => {
    if (!animating) return;
    const timer = setTimeout(() => setAnimating(false), 1700);
    return () => clearTimeout(timer);
  }, [animating, activeEdge]);
  useEffect(() => {
    if (!playing || busy) return;
    const timer = setTimeout(() => void next(), 3500 / speed);
    return () => clearTimeout(timer);
  }, [playing, busy, next, speed, data]);
  const closeDetail = () => {
    detailSeq.current++;
    setSelected(null);
    setIdea(null);
    setEdge(null);
    setDetailLoading(null);
  };
  const openNode = useCallback(
    (id: string) => {
      if (!engine) return;
      selectionEpoch.current++;
      engine.interrupt();
      setPlaying(false);
      setAnimating(false);
      setSelected(id);
      setFollow(false);
      setActiveEdge(null);
      setEdge(null);
      setIdea(null);
      const n = engine.nodes.get(id);
      const seq = ++detailSeq.current;
      if (!source.idea) {
        onOpenIdea?.(id);
        return;
      }
      setDetailLoading({
        kind: "idea",
        id,
        label: n?.label || id,
        type: n?.type,
      });
      void source
        .idea(id)
        .then((d) => {
          if (seq === detailSeq.current) {
            setIdea(d);
            setDetailLoading(null);
          }
        })
        .catch((err) => {
          if (seq === detailSeq.current) {
            setError(String(err));
            setDetailLoading(null);
          }
        });
    },
    [engine, source, onOpenIdea],
  );
  const openEdge = (id: string) => {
    selectionEpoch.current++;
    engine?.interrupt();
    setPlaying(false);
    setAnimating(false);
    setSelected(null);
    setIdea(null);
    setEdge(null);
    frameStep(id);
    const seq = ++detailSeq.current,
      e = engine?.edges.get(id);
    setMessage(
      e
        ? `${engine?.nodes.get(e.source)?.label} · ${t(relation(e.type).label)} → ${engine?.nodes.get(e.target)?.label}`
        : "",
    );
    if (!source.edge) return;
    setDetailLoading({ kind: "edge", id, label: e?.type || id });
    void source
      .edge(id)
      .then((d) => {
        if (seq === detailSeq.current) {
          setEdge(d);
          setDetailLoading(null);
        }
      })
      .catch((err) => {
        if (seq === detailSeq.current) {
          setError(String(err));
          setDetailLoading(null);
        }
      });
  };
  const start = (id: string) => {
    if (!engine || busy) return;
    setPlaying(false);
    frameStep(null);
    setAnimating(false);
    setPlaybackNotice("");
    engine.start(id);
    count.current = 0;
    setData(engine.visible());
    setMessage(t("Pulsa Play o Siguiente para seguir sus conexiones."));
  };
  const connections = useMemo(
    () =>
      selected
        ? data.edges.filter(
            (e) => e.source === selected || e.target === selected,
          )
        : [],
    [data, selected],
  );
  const step = activeEdge ? data.edges.find(e => e.id === activeEdge) : undefined;
  return (
    <div className="stellar-workspace" data-testid="stellar-workspace">
      <header className="stellar-header">
        <div className="stellar-heading">
          <span className="stellar-eyebrow">NODUS / {t("CONSTELACIÓN")}</span>
          <h2>{title || t("Sigue una idea. Descubre sus conexiones.")}</h2>
        </div>
        <div className="stellar-header-actions">
          {toolbar}
          <StellarSearch source={source} author={author} initialQuery={initialSearch}
            disabled={busy || loading} onChoose={node => {
              engine?.ingest({ nodes: [node], edges: [] });
              closeDetail();
              start(node.id);
            }} />
        </div>
      </header>
      <div className="stellar-body">
        <div className="stellar-stage">
          <StellarCanvas
            data={data}
            positions={positions}
            camera={camera}
            selected={activeEdge ? null : selected}
            activeEdge={activeEdge}
            followActive={follow}
            focusRequest={focusRequest}
            focusSeed={engine?.activeSeed}
            animate={animating}
            onPositions={setPositions}
            onCamera={setCamera}
            onNode={openNode}
            onEdge={openEdge}
            onBackground={closeDetail}
            onApi={bindApi}
            onManualCamera={manualCamera}
            sources={
              showSources && idea
                ? Array.from(
                    new Map(
                      [
                        ...idea.occurrences.map((o) => ({
                          id: o.nodus_id,
                          label: o.work.title,
                        })),
                        ...idea.evidence.map((e) => ({
                          id: e.nodus_id,
                          label: e.source_ref || e.nodus_id,
                        })),
                      ].map((s) => [s.id, s]),
                    ).values(),
                  ).slice(0, 8)
                : []
            }
            onSource={(id) => {
              const ev = idea?.evidence.find((e) => e.nodus_id === id);
              if (openEvidence)
                openEvidence(ev?.source_ref || id, ev?.location || null);
              else if (window.nodus)
                void window.nodus.openEvidenceAtPage(id, {
                  location: ev?.location || null,
                  sourceRef: ev?.source_ref || null,
                  pageNumber: ev?.page_number || null,
                });
            }}
          />
          <div className="stellar-meta">
            <span className="stellar-live-dot" />
            {loading
              ? t("Preparando constelación…")
              : `${data.nodes.length.toLocaleString()} ${t("ideas")} · ${data.edges.length.toLocaleString()} ${t("relaciones")}`}{" "}
            {workId && <span> / {t("Obra completa")}</span>}
          </div>
          {!loading && !data.nodes.length && (
            <div className="stellar-empty stellar-empty-hint">
              {t(workId ? "Esta obra todavía no tiene ideas extraídas." : "Busca una idea arriba para empezar a explorar.")}
            </div>
          )}
          {error && (
            <div className="stellar-error" role="alert">
              {error}
              <button
                onClick={() => {
                  setError("");
                  setReload((v) => v + 1);
                }}
              >
                {t("Reintentar")}
              </button>
            </div>
          )}
          <div className="stellar-navigation">
            <button title={t("Alejar")} onClick={() => api.current?.zoom(0.8)}>
              −
            </button>
            <button
              title={t("Acercar")}
              onClick={() => api.current?.zoom(1.25)}
            >
              +
            </button>
            <button
              onClick={() => {
                manualCamera();
                api.current?.fit();
              }}
            >
              {t("Encuadrar")}
            </button>
            <button
              disabled={!engine?.activeSeed}
              onClick={() => {
                manualCamera();
                if (engine?.activeSeed) api.current?.focus(engine.activeSeed);
              }}
            >
              {t("Semilla")}
            </button>
            <button
              disabled={busy || loading || !data.nodes.length}
              title={t("Reorganizar las posiciones del canvas")}
              onClick={() => {
                engine?.interrupt();
                setPlaying(false);
                setAnimating(false);
                setFollow(false);
                fitOnce.current = false;
                setPositions({});
              }}
            >{t("Reorganizar")}</button>
          </div>
          <div className="stellar-player">
            <div className="stellar-player-line">
              <button
                disabled={!engine?.cursor || busy}
                onClick={() => {
                  setPlaying(false);
                  engine?.previous();
                  setData(engine!.visible());
                  frameStep(engine?.history[engine.cursor - 1] || null);
                  setAnimating(false);
                  setPlaybackNotice("");
                  setMessage(t("Pulsa Play o Siguiente para seguir sus conexiones."));
                }}
              >
                ← {t("Anterior")}
              </button>
              <button
                className="stellar-play"
                disabled={!engine?.activeSeed || loading || (busy && !playing)}
                onClick={() => {
                  if (!playing) {
                    count.current = 0;
                    frameStep(engine?.history[engine.cursor - 1] || null);
                    setPlaying(true);
                    void next();
                  } else {
                    setAnimating(false);
                    engine?.interrupt();
                    setPlaying(false);
                  }
                }}
              >
                {playing ? "Ⅱ" : "▶"} {playing ? t("Pausa") : t("Play")}
              </button>
              <button
                disabled={!engine?.activeSeed || busy}
                onClick={() => {
                  setPlaying(false);
                  void next();
                }}
              >
                {t("Siguiente")} →
              </button>
              <span className="stellar-divider" />
              <label>
                {t("Relaciones")}
                <input
                  aria-label={t("Límite de relaciones")}
                  type="number"
                  min="1"
                  max="1000000"
                  disabled={limit === 0}
                  value={limit || 25}
                  onChange={(e) =>
                    setLimit(
                      Math.max(
                        1,
                        Math.min(1000000, Number(e.target.value) || 25),
                      ),
                    )
                  }
                />
              </label>
              <button
                className={limit === 0 ? "active" : ""}
                aria-pressed={limit === 0}
                title={t("Sin límite")}
                onClick={() => setLimit((v) => (v === 0 ? 25 : 0))}
              >
                ∞
              </button>
              <select
                aria-label={t("Velocidad")}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                <option value={0.5}>0,5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
              </select>
            </div>
            {selected && !step ? (
              <div className="stellar-node-actions" aria-label={t("Acciones de la idea seleccionada")}>
                <span className="stellar-selected-name" title={engine?.nodes.get(selected)?.label}>
                  <i aria-hidden="true" />{engine?.nodes.get(selected)?.label}
                </span>
                <small title={t("conexiones visibles")}>{connections.length} {t("conexiones")}</small>
                <button className="stellar-primary" disabled={busy} onClick={() => start(selected)}
                  title={t("Expandir desde aquí")} aria-label={t("Expandir desde aquí")}>
                  {t("Expandir")} ↗
                </button>
                <button className={showSources ? "active" : ""} aria-pressed={showSources}
                  aria-label={t(showSources ? "Ocultar fuentes" : "Mostrar fuentes")}
                  title={t(showSources ? "Ocultar fuentes" : "Mostrar fuentes")}
                  onClick={() => setShowSources(value => !value)}>{t("Fuentes")}</button>
              </div>
            ) : step ? (
              <div className="stellar-step" aria-label={t("Conexión actual")} aria-live="polite">
                <div className="stellar-step-meta">
                  <span>{engine?.cursor ? `${t("Paso")} ${engine.cursor}` : t("Relación seleccionada")}</span>
                  <span>{t(step.verdict === "confirmed" ? "Confirmada" : step.basis === "explicit" ? "Extraída de la fuente" : "Inferida")}</span>
                  {playbackNotice && <span>{playbackNotice}</span>}
                  {!follow && <button onClick={() => frameStep(activeEdge)}>{t("Ver conexión")} ↗</button>}
                </div>
                <div className="stellar-step-ideas">
                  <button className="stellar-step-node" title={engine?.nodes.get(step.source)?.statement || engine?.nodes.get(step.source)?.label}
                    data-step-node={step.source} onClick={() => openNode(step.source)}>{engine?.nodes.get(step.source)?.label}</button>
                  <button className="stellar-step-relation" style={{ color: relation(step.type).color }} onClick={() => openEdge(step.id)}>
                    <span>{t(relation(step.type).label)}</span><span aria-hidden="true">⟶</span>
                  </button>
                  <button className="stellar-step-node" title={engine?.nodes.get(step.target)?.statement || engine?.nodes.get(step.target)?.label}
                    data-step-node={step.target} onClick={() => openNode(step.target)}>{engine?.nodes.get(step.target)?.label}</button>
                </div>
              </div>
            ) : <p aria-live="polite">
              {busy
                ? t("Descubriendo la siguiente conexión…")
                : message || t("Elige una idea para empezar a investigar.")}
              <span>{engine?.cursor || 0} / {engine?.history.length || 0}</span>
            </p>}

          </div>
          <details className="stellar-legend">
            <summary>{t("Relaciones y evidencia")}</summary>
            <div>
              {Object.entries(RELATIONS)
                .filter(([type]) => data.edges.some((e) => e.type === type))
                .map(([type, r]) => (
                  <span key={type}>
                    <i style={{ background: r.color }} />
                    {t(r.label)}
                  </span>
                ))}
              <small>
                {t("Trazo continuo: explícita · Discontinuo: inferida")}
              </small>
              <small>{t("Exploración por capas. Una conexión guardada no equivale a una afirmación validada; revisa su dirección y evidencia.")}</small>
            </div>
          </details>
        </div>
        {(idea || edge || detailLoading) && (
          <NodeDetailPanel
            readOnly={source.readOnly}
            edgeLabel={edge ? relation(engine?.edges.get(edge.edge.id)?.type || edge.edge.type).label : undefined}
            edgeContext={edge ? t(edge.feedback?.verdict === "confirmed" ? "Relación confirmada mediante revisión del usuario." : "Relación pendiente de validación. La confianza es una puntuación del sistema: comprueba la dirección, la justificación y los pasajes originales.") : undefined}
            ideaDetail={idea}
            edgeDetail={edge}
            loading={detailLoading}
            width={width}
            fontSize={font}
            onWidthChange={setWidth}
            onFontChange={(delta) =>
              setFont((f) => Math.max(12, Math.min(20, f + delta)))
            }
            onClose={closeDetail}
            relations={connections.map((e) => {
              const id = e.source === selected ? e.target : e.source;
              return {
                id,
                edgeId: e.id,
                direction: e.source === selected ? "outgoing" : "incoming",
                label: engine?.nodes.get(id)?.label || id,
                relLabel: t(relation(e.type).label),
                relColor: relation(e.type).color,
                isBridge: false,
              };
            })}
            onOpenIdea={openNode}
            onOpenEvidence={openEvidence}
            onSaveIdea={saveIdea}
            onSaveEdge={saveEdge}
            showEdgeAudit={audit}
            onEdgeFeedback={() => {
              closeDetail();
              setReload((v) => v + 1);
            }}
          />
        )}
      </div>
    </div>
  );
}
