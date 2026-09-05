import { routeConnection, type Obstacle } from "./routing";
import { useEffect, useRef, useState } from "react";
import type { GraphData } from "@shared/types";
import type { StellarPosition, StellarSession } from "@shared/stellarGraph";
import { StellarGPU } from "./gpu";
import { hash } from "./layout";
import { arrowGeometry, frameConnection, interpolateCamera } from "./presentation";
import { NODE_COLORS, NODE_LABELS, relation } from "./palette";
import { t } from "../i18n";
import "./stellar.css";
type Camera = StellarSession["camera"];
export interface StellarCanvasApi {
  fit(): void;
  focus(id: string): void;
  zoom(factor: number): void;
}
interface Props {
  data: GraphData;
  positions: Record<string, StellarPosition>;
  camera: Camera;
  selected?: string | null;
  activeEdge?: string | null;
  followActive?: boolean;
  focusRequest?: number;
  focusSeed?: string | null;
  animate?: boolean;
  onPositions(p: Record<string, StellarPosition>): void;
  onCamera(c: Camera): void;
  onNode(id: string): void;
  onEdge(id: string): void;
  onBackground?(): void;
  onApi?(api: StellarCanvasApi | null): void;
  onManualCamera?(): void;
  sources?: { id: string; label: string }[];
  onSource?(id: string): void;
}
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export function StellarCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    live = useRef(props);
  live.current = props;
  const [size, setSize] = useState({ w: 1000, h: 700, footer: 150 }),
    [error, setError] = useState(""),
    [generation, setGeneration] = useState(0);
  const worker = useRef<Worker>(),
    seq = useRef(0),
    paint = useRef<() => void>(() => {});
  const drag = useRef<{
    id: string | null;
    x: number;
    y: number;
    cx: number;
    cy: number;
    moved: boolean;
  } | null>(null);
  const boxes = useRef<Obstacle[]>([]);
  const routes = useRef<{ id: string; points: StellarPosition[] }[]>([]);
  const cameraFrame = useRef(0);
  const stopCamera = () => cancelAnimationFrame(cameraFrame.current);
  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    stopCamera();
    if (!props.followActive || (!props.activeEdge && !props.focusRequest)) return;
    const edge = props.data.edges.find(e => e.id === props.activeEdge);
    const seed = props.focusSeed && props.positions[props.focusSeed];
    const a = edge ? props.positions[edge.source] : seed, b = edge ? props.positions[edge.target] : seed;
    if (!a || !b) return;
    const from = live.current.camera, target = frameConnection(a, b, size.w, size.h, size.footer + 150);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      live.current.onCamera(target);
      return;
    }
    const started = performance.now();
    const tick = () => {
      const progress = Math.min(1, (performance.now()-started)/550);
      live.current.onCamera(interpolateCamera(from, target, progress));
      if (progress < 1) cameraFrame.current = requestAnimationFrame(tick);
    };
    cameraFrame.current = requestAnimationFrame(tick);
    return stopCamera;
  }, [props.activeEdge, props.followActive, props.focusRequest, props.focusSeed, props.positions, size.w, size.h, size.footer]);
  useEffect(() => {
    const el = host.current!;
    const player = el.parentElement?.querySelector(".stellar-player");
    const obs = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight, footer: player?.getBoundingClientRect().height || 0 });
    });
    obs.observe(el);
    if (player) obs.observe(player);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    const w = new Worker(new URL("./layout.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.request === seq.current)
        live.current.onPositions({
          ...data.positions,
          ...live.current.positions,
        });
    };
    w.onerror = () =>
      setError(
        t("No se pudo calcular la distribución. Vuelve a abrir el canvas."),
      );
    return () => {
      seq.current++;
      w.terminate();
    };
  }, []);
  useEffect(() => {
    if (props.data.nodes.some((n) => !props.positions[n.id]))
      worker.current?.postMessage({
        request: ++seq.current,
        ids: props.data.nodes.map((n) => n.id),
        edges: props.data.edges,
        positions: props.positions,
      });
  }, [props.data, props.positions]);
  useEffect(() => {
    const api: StellarCanvasApi = {
      fit() {
        stopCamera();
        const ps = live.current.data.nodes.flatMap((n) =>
          live.current.positions[n.id] ? [live.current.positions[n.id]] : [],
        );
        if (!ps.length) return;
        let x0 = Infinity,
          y0 = Infinity,
          x1 = -Infinity,
          y1 = -Infinity;
        for (const p of ps) {
          x0 = Math.min(x0, p.x);
          x1 = Math.max(x1, p.x);
          y0 = Math.min(y0, p.y);
          y1 = Math.max(y1, p.y);
        }
        live.current.onCamera({
          x: (x0 + x1) / 2,
          y: (y0 + y1) / 2,
          zoom: Math.min(
            1.1,
            (size.w - 260) / Math.max(400, x1 - x0 + 300),
            (size.h - 200) / Math.max(300, y1 - y0 + 200),
          ),
        });
      },
      focus(id) {
        stopCamera();
        const p = live.current.positions[id];
        if (p)
          live.current.onCamera({
            ...p,
            zoom: Math.max(0.8, live.current.camera.zoom),
          });
      },
      zoom(factor) {
        stopCamera();
        live.current.onManualCamera?.();
        const c = live.current.camera;
        live.current.onCamera({
          ...c,
          zoom: Math.max(0.025, Math.min(3, c.zoom * factor)),
        });
      },
    };
    props.onApi?.(api);
    return () => props.onApi?.(null);
  }, [size.w, size.h, props.onApi]);
  useEffect(() => {
    const el = canvas.current!;
    let gpu: StellarGPU;
    try {
      gpu = new StellarGPU(el);
    } catch (e) {
      setError(String(e));
      return;
    }
    let raf = 0, until = 0, revealAt = 0;
    let lastAnimatedEdge: string | null | undefined;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const render = () => {
      const p = live.current,
        dpr = Math.min(devicePixelRatio, 2),
        w = host.current!.clientWidth,
        h = host.current!.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      const screen = (pos: StellarPosition) => ({
        x: (pos.x - p.camera.x) * p.camera.zoom + w / 2,
        y: (pos.y - p.camera.y) * p.camera.zoom + h / 2,
      });
      const lines: number[] = [],
        stars: number[] = [],
        paths: typeof routes.current = [];
      const vertex = (
        out: number[],
        v: StellarPosition,
        color: number[],
        alpha: number,
        size = 1,
      ) => out.push(v.x * dpr, v.y * dpr, ...color, alpha, size * dpr);
      const neighborhood = new Set<string>(p.selected ? [p.selected] : []);
      const active = p.data.edges.find(e => e.id === p.activeEdge);
      if (active) { neighborhood.add(active.source); neighborhood.add(active.target); }
      for (const e of p.data.edges)
        if (e.source === p.selected || e.target === p.selected) {
          neighborhood.add(e.source);
          neighborhood.add(e.target);
        }
      for (let i = 0; i < 80; i++) {
        const x = hash(`sky-x${i}`) * w,
          y = hash(`sky-y${i}`) * h;
        vertex(
          stars,
          { x, y },
          [0.64, 0.69, 0.91],
          0.25,
          2 + hash(`s${i}`) * 3,
        );
      }
      for (const e of p.data.edges) {
        const a = p.positions[e.source],
          b = p.positions[e.target];
        if (!a || !b) continue;
        const s = screen(a),
          t = screen(b);
        if (
          Math.max(s.x, t.x) < -80 ||
          Math.min(s.x, t.x) > w + 80 ||
          Math.max(s.y, t.y) < -80 ||
          Math.min(s.y, t.y) > h + 80
        )
          continue;
        const hot =
          e.id === p.activeEdge ||
          e.source === p.selected ||
          e.target === p.selected;
        const current = e.id === p.activeEdge;
        const color = rgb(relation(e.type).color);
        const alpha = active ? current ? 1 : .08 : p.selected && !hot ? .08 : hot ? 1 : .55;
        const steps = current ? 32 : p.camera.zoom < 0.3 ? 1 : 20;
        const points = routeConnection(
          s,
          t,
          hash(e.id) > 0.5 ? 1 : -1,
          !current && p.camera.zoom > 0.12
            ? boxes.current.filter(
                (box) => box.id !== e.source && box.id !== e.target && box.id !== `label:${e.source}` && box.id !== `label:${e.target}`,
              )
            : [],
          steps,
        );
        for (let i = 1; i < points.length; i++) {
          if (e.basis === "inferred" && i % 3 === 0) continue;
          vertex(
            lines,
            points[i - 1],
            color,
            alpha, current ? 2.7 : 1,
          );
          vertex(
            lines,
            points[i],
            color,
            alpha, current ? 2.7 : 1,
          );
        }
        // Arrowhead retains the original direction even during reverse traversal.
        if (p.camera.zoom > 0.35 || hot) {
          const arrow = arrowGeometry(points)!;
          const { angle, tip } = arrow;
          for (const turn of [-0.55, 0.55]) {
            vertex(lines, tip, color, alpha, current ? 2.7 : 1);
            vertex(
              lines,
              {
                x: tip.x - Math.cos(angle + turn) * (current ? 12 : 8),
                y: tip.y - Math.sin(angle + turn) * (current ? 12 : 8),
              },
              color,
              alpha, current ? 2.7 : 1,
            );
          }
        }
        if (p.animate && e.id === p.activeEdge && !reduce.matches) {
          const phase = Math.max(0, Math.min(1, (performance.now()-revealAt)/1000)),
            idx = Math.max(0, Math.min(steps, Math.floor(phase * steps)));
          vertex(stars, points[idx], color, 1, 35);
        }
        paths.push({ id: e.id, points });
      }
      routes.current = paths;
      for (const n of p.data.nodes) {
        const pos = p.positions[n.id];
        if (!pos) continue;
        const s = screen(pos);
        if (s.x < -150 || s.x > w + 150 || s.y < -100 || s.y > h + 100)
          continue;
        const color = rgb(NODE_COLORS[n.type] || "#a4bbfa");
        const featured = active && (n.id === active.source || n.id === active.target);
        const alpha = (active || p.selected) && !neighborhood.has(n.id) ? 0.18 : 1;
        vertex(
          stars,
          s,
          color,
          alpha,
          (featured || n.id === p.selected ? 130 : 96) *
            (featured ? 1 : Math.max(0.4, Math.min(1.3, p.camera.zoom))),
        );
        vertex(stars, s, [1, 1, 1], alpha, featured ? 14 : 12 * Math.max(0.5, p.camera.zoom));
      }
      gpu.draw(el.width, el.height, lines, stars, p.camera.zoom < 0.3 && !active);
      if (performance.now() < until && !reduce.matches)
        raf = requestAnimationFrame(render);
    };
    paint.current = () => {
      cancelAnimationFrame(raf);
      if (live.current.animate && lastAnimatedEdge !== live.current.activeEdge) {
        lastAnimatedEdge = live.current.activeEdge;
        revealAt = performance.now() + (live.current.followActive ? 550 : 0);
        until = revealAt + 1000;
      }
      if (!live.current.animate) { until = 0; lastAnimatedEdge = null; }
      raf = requestAnimationFrame(render);
    };
    paint.current();
    const lost = (e: Event) => {
      e.preventDefault();
      stopCamera();
      setError(
        "Se ha interrumpido la aceleración gráfica. Recupera el canvas para continuar.",
      );
    };
    el.addEventListener("webglcontextlost", lost);
    return () => {
      cancelAnimationFrame(raf);
      gpu.dispose();
      el.removeEventListener("webglcontextlost", lost);
    };
  }, [generation]);
  useEffect(
    () => paint.current(),
    [
      props.data,
      props.positions,
      props.camera,
      props.selected,
      props.activeEdge,
      props.animate,
      size,
    ],
  );
  useEffect(() => {
    const el = host.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      stopCamera();
      props.onManualCamera?.();
      const c = live.current.camera,
        r = el.getBoundingClientRect(),
        x = e.clientX - r.left - size.w / 2,
        y = e.clientY - r.top - size.h / 2;
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= 40) {
        const zoom = Math.max(
          0.025,
          Math.min(3, c.zoom * Math.exp(-e.deltaY * 0.002)),
        );
        live.current.onCamera({
          x: c.x + x / c.zoom - x / zoom,
          y: c.y + y / c.zoom - y / zoom,
          zoom,
        });
      } else
        live.current.onCamera({
          ...c,
          x: c.x + e.deltaX / c.zoom,
          y: c.y + e.deltaY / c.zoom,
        });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [size, props.onManualCamera]);
  const local = (e: React.PointerEvent) => {
    const r = host.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const active = props.data.edges.find(e => e.id === props.activeEdge);
  const featured = new Set(active ? [active.source, active.target] : []);
  const closeNodes = new Set<string>(props.selected ? [props.selected] : featured);
  for (const e of props.data.edges)
    if (e.source === props.selected || e.target === props.selected) {
      closeNodes.add(e.source); closeNodes.add(e.target);
    }
  const labels = props.data.nodes.flatMap(n => {
    const p = props.positions[n.id];
    if (!p) return [];
    const x = (p.x-props.camera.x)*props.camera.zoom+size.w/2;
    const y = (p.y-props.camera.y)*props.camera.zoom+size.h/2;
    const labelX = featured.has(n.id) ? Math.max(Math.min(120, size.w/2), Math.min(size.w-Math.min(120, size.w/2), x)) : x;
    return x > -150 && x < size.w+150 && y > -80 && y < size.h+80 ? [{ n, x, y, labelX, labelY: y+22 }] : [];
  }).sort((a,b) => Number(featured.has(b.n.id))-Number(featured.has(a.n.id)) || Number(closeNodes.has(b.n.id))-Number(closeNodes.has(a.n.id)));
  const from = active && labels.find(n => n.n.id === active.source), to = active && labels.find(n => n.n.id === active.target);
  if (from && to && Math.abs(from.labelX-to.labelX)<250 && Math.abs(from.y-to.y)<125) {
    const upper = from.y <= to.y ? from : to, lower = upper === from ? to : from;
    upper.labelY = upper.y-100; lower.labelY = lower.y+25;
  }
  const occupied: { x: number; y: number }[] = [];
  const visibleLabels = labels.filter(({n,labelX,labelY}) => {
    if (props.camera.zoom < .12 && !closeNodes.has(n.id)) return false;
    if (!featured.has(n.id) && occupied.some(p => Math.abs(p.x-labelX)<245 && Math.abs(p.y-labelY)<100)) return false;
    occupied.push({x:labelX,y:labelY}); return true;
  });
  boxes.current = [
    ...visibleLabels.map(({ n, labelX, labelY }) => ({
      id: `label:${n.id}`,
      x: labelX - 115,
      y: labelY,
      width: 230,
      height: 85,
    })),
    ...labels.map(({ n, x, y }) => ({
      id: n.id,
      x: x - 15,
      y: y - 15,
      width: 30,
      height: 30,
    })),
  ];
  return (
    <div
      ref={host}
      className="stellar-canvas"
      data-testid="stellar-canvas"
      tabIndex={0}
      aria-label={t(
        "Canvas de ideas. Arrastra para navegar; usa la rueda para ampliar.",
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const button = (e.target as HTMLElement).closest<HTMLElement>(
          "[data-node]",
        );
        const pos = local(e);
        drag.current = {
          id:
            button?.dataset.node ||
            (props.camera.zoom < 0.3
              ? labels.reduce<{ id: string | null; distance: number }>(
                  (best, item) => {
                    const distance = Math.hypot(item.x - pos.x, item.y - pos.y);
                    return distance < best.distance
                      ? { id: item.n.id, distance }
                      : best;
                  },
                  { id: null, distance: 8 },
                ).id
              : null),
          ...pos,
          cx: props.camera.x,
          cy: props.camera.y,
          moved: false,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const p = local(e),
          dx = p.x - d.x,
          dy = p.y - d.y;
        if (Math.hypot(dx, dy) > 4) d.moved = true;
        if (!d.moved) return;
        stopCamera();
        props.onManualCamera?.();
        if (d.id) {
          props.onPositions({
            ...props.positions,
            [d.id]: {
              x: props.camera.x + (p.x - size.w / 2) / props.camera.zoom,
              y: props.camera.y + (p.y - size.h / 2) / props.camera.zoom,
            },
          });
        } else
          props.onCamera({
            ...props.camera,
            x: d.cx - dx / props.camera.zoom,
            y: d.cy - dy / props.camera.zoom,
          });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.moved) return;
        if (d.id) {
          props.onNode(d.id);
          return;
        }
        const p = local(e);
        let nearest: string | null = null,
          best = 9;
        for (const route of routes.current)
          for (let i = 1; i < route.points.length; i++) {
            const a = route.points[i - 1],
              b = route.points[i],
              dx = b.x - a.x,
              dy = b.y - a.y,
              u = Math.max(
                0,
                Math.min(
                  1,
                  ((p.x - a.x) * dx + (p.y - a.y) * dy) /
                    (dx * dx + dy * dy || 1),
                ),
              ),
              dist = Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
            if (dist < best) {
              best = dist;
              nearest = route.id;
            }
          }
        if (nearest) props.onEdge(nearest);
        else props.onBackground?.();
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <canvas ref={canvas} aria-hidden="true" />
      <div className="stellar-labels">
        {labels
          .filter(
            ({ n }) => props.camera.zoom >= 0.3 || n.id === props.selected || featured.has(n.id),
          )
          .map(({ n, x, y }) => (
            <button
              key={n.id}
              data-node={n.id}
              className={`stellar-hit ${n.id === props.selected ? "selected" : ""}`}
              style={{ left: x, top: y }}
              title={n.label}
              aria-label={n.label}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  props.onNode(n.id);
                }
              }}
            />
          ))}
        {visibleLabels.map(({ n, labelX, labelY }) => (
          <button
            key={`label:${n.id}`}
            data-node={n.id}
            className={`stellar-node-label ${featured.has(n.id) ? "featured" : (props.selected || active) && !closeNodes.has(n.id) ? "dim" : ""}`}
            data-endpoint={active?.source === n.id ? "source" : active?.target === n.id ? "target" : undefined}
            title={n.statement || n.label}
            style={
              {
                left: labelX,
                top: labelY,
                "--node-color": NODE_COLORS[n.type] || "#a4bbfa",
              } as React.CSSProperties
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                props.onNode(n.id);
              }
            }}
          >
            <small>
              {featured.has(n.id) ? t(active?.source === n.id ? "Origen" : "Destino") : t(NODE_LABELS[n.type] || n.type)} · {n.workCount} {t(n.workCount === 1 ? "fuente" : "fuentes")}
            </small>
            <span>{n.label}</span>
          </button>
        ))}
        {props.data.edges
          .filter(
            (e) =>
              props.activeEdge ? e.id === props.activeEdge :
              e.source === props.selected || e.target === props.selected,
          )
          .slice(0, 16)
          .map((e) => {
            const a = props.positions[e.source],
              b = props.positions[e.target];
            if (!a || !b) return null;
            const x =
                ((a.x + b.x) / 2 - props.camera.x) * props.camera.zoom +
                size.w / 2,
              y =
                ((a.y + b.y) / 2 - props.camera.y) * props.camera.zoom +
                size.h / 2;
            return (
              <button
                key={`edge:${e.id}`}
                className="stellar-edge-label"
                style={{ left: x, top: y, color: relation(e.type).color }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => props.onEdge(e.id)}
              >
                {t(relation(e.type).label)}
              </button>
            );
          })}
        {props.selected &&
          props.positions[props.selected] &&
          props.sources?.map((source, i) => {
            const p = props.positions[props.selected!],
              angle =
                -Math.PI * 0.9 +
                (i * Math.PI * 2) / Math.max(3, props.sources!.length),
              x =
                (p.x - props.camera.x) * props.camera.zoom +
                size.w / 2 +
                Math.cos(angle) * 180,
              y =
                (p.y - props.camera.y) * props.camera.zoom +
                size.h / 2 +
                Math.sin(angle) * 150;
            return (
              <button
                className="stellar-source-ring"
                key={source.id}
                style={{ left: x, top: y }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => props.onSource?.(source.id)}
                title={source.label}
              >
                <i />
                <span>{source.label}</span>
              </button>
            );
          })}
      </div>
      {error && (
        <div className="stellar-error" role="alert">
          {error}
          <button
            onClick={() => {
              setError("");
              setGeneration((g) => g + 1);
            }}
          >
            {t("Recuperar canvas")}
          </button>
        </div>
      )}
    </div>
  );
}
