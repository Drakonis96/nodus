import { useEffect, useLayoutEffect, useState } from 'react';
import { t } from '../i18n';

type ViewId = 'library' | 'graph' | 'gaps' | 'reading' | 'settings' | 'search' | 'ideas' | 'notes';

export interface TourStep {
  /** A `data-tour="…"` value to spotlight. Omit for a centered, target-less step. */
  target?: string;
  title: string;
  body: string;
  /** Switch the app to this view before showing the step. */
  view?: ViewId;
}

/**
 * First-run usage tour. Distinct from the setup Onboarding: this teaches how to
 * *use* the app on the real UI — most importantly, how to add a work to the graph.
 * Steps spotlight live elements tagged with `data-tour`; target-less steps are centered.
 */
const STEPS: TourStep[] = [
  {
    title: '¡Bienvenido a Nodus!',
    body: '¿Es tu primera vez? En menos de un minuto te enseño cómo convertir tu biblioteca de Zotero en un grafo de ideas. Puedes saltártelo cuando quieras.',
  },
  {
    target: 'vaults',
    title: 'Bóvedas independientes',
    body: 'Cada bóveda es un espacio separado: biblioteca, grafo, notas, proyectos, chats, ajustes, embeddings y claves API pueden vivir aislados. Usa este selector para crear otra, cambiar de bóveda o cargar claves desde una bóveda anterior.',
  },
  {
    target: 'nav-graph',
    view: 'graph',
    title: 'El grafo de ideas',
    body: 'Es el corazón de Nodus. Cada nodo es una idea extraída de tus lecturas y cada arista una relación entre ellas. Empieza vacío: se llena a medida que escaneas obras a fondo.',
  },
  {
    target: 'sync',
    title: 'Actualizar desde Zotero',
    body: 'Este botón trae las obras de tus colecciones monitorizadas. Por defecto solo incorpora metadatos; puedes activar análisis automático en Ajustes.',
  },
  {
    target: 'collections',
    title: 'Elegir colecciones',
    body: 'Aquí decides qué colecciones o subcolecciones de Zotero vigila Nodus. Empieza con una pequeña para probar; sus subcolecciones se incluyen solas.',
  },
  {
    target: 'nav-library',
    view: 'library',
    title: 'Tu biblioteca',
    body: 'Aquí tienes todas tus obras con su estado de escaneo: ligero (temas) y profundo (ideas). Desde aquí decides qué llevar al grafo.',
  },
  {
    target: 'library-actions',
    view: 'library',
    title: 'Añadir una obra al grafo',
    body: 'Selecciona una obra o varias y pulsa «Analizar ideas». Nodus lee el texto, extrae temas padre, ideas con evidencia y relaciones, y las añade al grafo.',
  },
  {
    target: 'nav-ideas',
    view: 'ideas',
    title: 'Verificar ideas extraídas',
    body: 'Cada idea aparece con su tipo (afirmación, hallazgo, constructo, método o marco), la obra de la que procede y la cita textual que la sostiene. Abre el detalle para comprobar si la lectura automática coincide con la tuya.',
  },
  {
    target: 'queue',
    title: 'La cola de escaneo',
    body: 'Sigue aquí el progreso. Si falta el modelo de IA o la clave, la cola se pausa y te avisa en vez de fallar en silencio: lo arreglas en Ajustes y pulsas «Reanudar».',
  },
  {
    target: 'model',
    title: 'Modelo de IA',
    body: 'Comprueba que hay un modelo seleccionado: sin él, Nodus no puede escanear. Puedes cambiarlo aquí o en Ajustes, y marcar tus favoritos.',
  },
  {
    target: 'nav-search',
    view: 'search',
    title: 'Búsqueda global',
    body: 'Busca por palabras clave a través de ideas, obras, huecos, temas, autores y notas. Los resultados te llevan directamente al detalle correspondiente en cada vista.',
  },
  {
    target: 'nav-notes',
    view: 'notes',
    title: 'Tu espacio de notas',
    body: 'Crea carpetas y notas en Markdown. Captura respuestas del asistente, borradores del taller de escritura, síntesis de debates e ideas individuales. Las citas internas (nodus://) permanecen clicables.',
  },
  {
    title: 'Y hay mucho más',
    body: 'Esto es solo la mecánica básica. Nodus incluye también Autores (fichas y matriz de síntesis), un Laboratorio de hipótesis, Mapa de argumentos, Debates, Cobertura de tu pregunta, Ruta de lectura, un Taller de escritura con Deep Research y Proyectos de manuscrito con verificador de citas. ¿Quieres el recorrido completo de este flujo? Lánzalo desde Ajustes → Ayuda → Tutorial avanzado.',
  },
  {
    title: '¡Listo para empezar!',
    body: 'Explora el grafo, descubre huecos de investigación y sigue la ruta de lectura sugerida. Podrás volver a ver este recorrido desde Ajustes cuando quieras.',
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function Tour({ onClose, onNavigate }: { onClose: () => void; onNavigate: (v: ViewId) => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = STEPS[i];
  const isFirst = i === 0;
  const isLast = i === STEPS.length - 1;

  // Switch view first so the target element exists when we measure.
  useEffect(() => {
    if (step.view) onNavigate(step.view);
  }, [i, step.view, onNavigate]);

  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      if (!step.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        setRect(null); // element present but not laid out (e.g. empty queue bar) → center
        return;
      }
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    // Wait a frame for the (possibly just-switched) view to render.
    raf = requestAnimationFrame(() => requestAnimationFrame(measure));
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [i, step.target]);

  // Keyboard: Esc to skip, arrows/Enter to navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') setI((n) => Math.min(STEPS.length - 1, n + 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pad = 6;
  const spotlight: Rect | null = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;

  // Tooltip placement: below the target if there's room, else above; centered otherwise.
  const TT_W = 360;
  let ttStyle: React.CSSProperties;
  if (spotlight) {
    const below = spotlight.top + spotlight.height + 12;
    const placeBelow = below + 180 < window.innerHeight;
    const top = placeBelow ? below : Math.max(12, spotlight.top - 12 - 180);
    let left = spotlight.left + spotlight.width / 2 - TT_W / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - TT_W - 12));
    ttStyle = { position: 'fixed', top, left, width: TT_W };
  } else {
    ttStyle = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      width: TT_W,
      transform: 'translate(-50%, -50%)',
    };
  }

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Dim layer with a spotlight hole over the target (via a huge box-shadow). */}
      {spotlight ? (
        <div
          className="fixed rounded-lg transition-all duration-200 pointer-events-none"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.66)',
            outline: '2px solid #818cf8',
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/70" />
      )}

      {/* Tooltip card */}
      <div
        style={ttStyle}
        className="card bg-neutral-900 border border-neutral-700 p-4 shadow-2xl text-sm"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] uppercase tracking-wide text-indigo-400">
            {t('Tutorial')} · {i + 1}/{STEPS.length}
          </div>
          <button className="text-neutral-500 hover:text-white text-xs" onClick={onClose}>
            {t('Saltar')} ✕
          </button>
        </div>
        <h3 className="font-semibold text-base mb-1">{t(step.title)}</h3>
        <p className="text-neutral-300 leading-relaxed">{t(step.body)}</p>

        <div className="flex items-center justify-between mt-4">
          <div className="flex gap-1">
            {STEPS.map((_, n) => (
              <span
                key={n}
                className={`h-1.5 rounded-full transition-all ${n === i ? 'w-4 bg-indigo-500' : 'w-1.5 bg-neutral-700'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {!isFirst && (
              <button className="btn btn-ghost" onClick={() => setI((n) => Math.max(0, n - 1))}>
                {t('Atrás')}
              </button>
            )}
            {isFirst ? (
              <>
                <button className="btn btn-ghost" onClick={onClose}>
                  {t('Ahora no')}
                </button>
                <button className="btn btn-primary" onClick={() => setI(1)}>
                  {t('Sí, enséñame')}
                </button>
              </>
            ) : isLast ? (
              <button className="btn btn-primary" onClick={onClose}>
                {t('Empezar')}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => setI((n) => n + 1)}>
                {t('Siguiente')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
