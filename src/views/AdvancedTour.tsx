import { useEffect, useLayoutEffect, useState } from 'react';
import type { View } from '../navigation';
import { t } from '../i18n';

export interface AdvancedTourStep {
  /** A `data-tour="…"` value to spotlight. Omit for a centered, target-less step. */
  target?: string;
  /** Short eyebrow shown above the title (the workflow stage). */
  stage: string;
  title: string;
  body: string;
  /** Switch the app to this view before showing the step. */
  view?: View;
}

/**
 * Advanced, workflow-oriented walkthrough. Where {@link Tour} teaches the
 * mechanics (sync, scan, the graph), this tour follows the *arc of a research
 * project*: read with criterion → understand the corpus → find your contribution
 * → plan, converse, and write. It deliberately avoids repeating the basics and
 * is opt-in: launched from Settings, never auto-shown.
 *
 * Most stops are view-navigated, centered cards because the workflow is about
 * *when* to reach for each view, not about hunting a single button.
 */
const STEPS: AdvancedTourStep[] = [
  {
    stage: 'Flujo de investigación',
    title: 'De la biblioteca al manuscrito',
    body: 'Este recorrido avanzado asume que ya sabes escanear obras y moverte por el grafo. Ahora veremos cómo encadenar las vistas de Nodus para reproducir el ciclo real de una investigación: leer con criterio, comprender el corpus, encontrar tu aportación y escribir. Unos tres minutos; puedes salir cuando quieras.',
  },
  {
    stage: 'Paso 1 · Leer con criterio',
    view: 'library',
    title: 'Primero lee; luego deja que Nodus lea contigo',
    body: 'Nada sustituye tu lectura crítica de las fuentes. Marca como leídas las obras que ya dominas y lanza el «análisis profundo» sobre ellas: Nodus extrae temas, ideas y la evidencia textual que las sostiene. La regla de oro: solo confías en una idea del grafo cuando has visto su cita de origen.',
  },
  {
    stage: 'Paso 1 · Leer con criterio',
    view: 'ideas',
    title: 'Verifica cada idea contra su evidencia',
    body: 'En Ideas revisas, una a una, las afirmaciones que la IA ha destilado de tus lecturas. Abre el detalle de una idea para leer su evidencia y la cita exacta de la obra: así contrastas si la lectura automática coincide con la tuya. Corregir aquí tu criterio es lo que da fiabilidad a todo lo que viene después.',
  },
  {
    stage: 'Paso 2 · Comprender el corpus',
    view: 'graph',
    title: 'El Tutor te guía por el grafo',
    body: 'Cuando tengas decenas de ideas, no las leas en desorden. Activa el modo Tutor sobre el grafo: una IA de contexto largo traza recorridos —completos o a medida desde un objetivo— y te explica las ideas y sus conexiones paso a paso, como un colega que te pone al día del estado del arte sobre tu propio mapa.',
  },
  {
    stage: 'Paso 2 · Comprender el corpus',
    view: 'argument',
    title: 'Reconstruye la arquitectura de un argumento',
    body: 'Elige una idea central y traza su mapa de argumentos: por conectividad (sin IA, siguiendo las aristas) o dejando que la IA dibuje el esquema de premisas y conclusiones. Es la forma de pasar de «qué dicen las fuentes» a «cómo razonan», y de detectar saltos lógicos antes de apoyarte en ellos.',
  },
  {
    stage: 'Paso 3 · Encontrar tu aportación',
    view: 'gaps',
    title: 'Huecos y contradicciones: tu oportunidad',
    body: 'Aquí Nodus señala preguntas abiertas, limitaciones declaradas y tensiones entre fuentes. No son errores: son los espacios donde cabe una contribución original. Un buen objeto de investigación suele nacer de un hueco bien delimitado o de una contradicción que nadie ha resuelto. Marca los que conecten con tu interés.',
  },
  {
    stage: 'Paso 4 · Planificar',
    view: 'reading',
    title: 'Una ruta de lectura a la medida de tu pregunta',
    body: 'Describe tu pregunta, tus objetivos y tus prioridades, y Nodus ordena qué leer y en qué fase, justificando cada elección. Úsalo para cerrar los huecos que acabas de identificar: convierte la intuición «me falta base sobre X» en un plan de lectura concreto y priorizado.',
  },
  {
    stage: 'Paso 5 · Dialogar',
    title: 'El Asistente, anclado en tu corpus',
    body: 'Abre el Asistente (arriba a la derecha) para conversar con una IA que solo razona sobre tus fuentes, no sobre internet. Elige el contexto que le das —ideas, contradicciones, ruta de lectura, autores, el grafo entero— y pon a prueba hipótesis, pide síntesis o redacta argumentos. Cada respuesta es trazable hasta tus obras.',
  },
  {
    stage: 'Paso 6 · Escribir',
    view: 'writing',
    title: 'Del grafo a un borrador con fuentes verificables',
    body: 'El Taller de escritura convierte tus ideas y conexiones en un esquema y un borrador apartado por apartado, con citas que puedes comprobar contra el texto original. No escribe por ti: te da una estructura defendible y las referencias para sostenerla, de modo que mantienes el control intelectual del manuscrito.',
  },
  {
    stage: 'El ciclo se repite',
    view: 'home',
    title: 'Inicio: tu panel de mando',
    body: 'Inicio resume el estado de tu corpus, los análisis pendientes y el siguiente paso recomendado. La investigación es iterativa: escaneas más obras, vuelven a aparecer ideas y huecos, refinas la ruta y el borrador. Vuelve aquí entre vueltas. Puedes relanzar este recorrido cuando quieras desde Ajustes → Ayuda.',
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function AdvancedTour({ onClose, onNavigate }: { onClose: () => void; onNavigate: (v: View) => void }) {
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
        setRect(null); // present but not laid out → center
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
  const TT_W = 380;
  let ttStyle: React.CSSProperties;
  if (spotlight) {
    const below = spotlight.top + spotlight.height + 12;
    const placeBelow = below + 200 < window.innerHeight;
    const top = placeBelow ? below : Math.max(12, spotlight.top - 12 - 200);
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
            outline: '2px solid #34d399',
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
          <div className="text-[11px] uppercase tracking-wide text-emerald-400">
            {t('Tutorial avanzado')} · {i + 1}/{STEPS.length}
          </div>
          <button className="text-neutral-500 hover:text-white text-xs" onClick={onClose}>
            {t('Salir')} ✕
          </button>
        </div>
        <div className="text-[11px] uppercase tracking-wide text-neutral-500 mb-0.5">{t(step.stage)}</div>
        <h3 className="font-semibold text-base mb-1">{t(step.title)}</h3>
        <p className="text-neutral-300 leading-relaxed">{t(step.body)}</p>

        <div className="flex items-center justify-between mt-4">
          <div className="flex gap-1">
            {STEPS.map((_, n) => (
              <span
                key={n}
                className={`h-1.5 rounded-full transition-all ${n === i ? 'w-4 bg-emerald-500' : 'w-1.5 bg-neutral-700'}`}
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
                  {t('Empezar el recorrido')}
                </button>
              </>
            ) : isLast ? (
              <button className="btn btn-primary" onClick={onClose}>
                {t('Terminar')}
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
