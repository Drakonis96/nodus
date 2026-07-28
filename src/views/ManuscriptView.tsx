import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ManuscriptProgress, ManuscriptSpine, SceneAppearance, WorldEntry, WorldScene } from '@shared/types';
import type { SpineScene } from '@shared/worldManuscript';
import { countWords } from '@shared/worldManuscript';
import type { View } from '../navigation';
import { Icon } from '../components/ui';
import { SceneThreadsPanel } from '../components/world/SceneThreadsPanel';
import { SceneQuestionBand } from '../components/world/SceneQuestionBand';
import { RulesInPlay } from '../components/world/RulesInPlay';
import { ContinuityBadge } from '../components/world/ContinuityBadge';
import { WorldAnchorProvider } from '../components/world/questionCapture';
import { useWorldLinkAutocomplete, WorldLinkCandidates } from '../components/world/worldLinkAutocomplete';
import { notifyDataChanged } from '../hooks';
import { toast } from '../components/feedback';
import { t, tx } from '../i18n';

/** Where the author left off. Reopening the manuscript on the scene you closed it at is
 *  the whole difference between a section you come back to and one you re-navigate. */
const LAST_SCENE_KEY = 'nodus.manuscript.scene';

const STATUS_TONE: Record<string, string> = {
  outline: 'bg-neutral-700',
  draft: 'bg-amber-500',
  written: 'bg-emerald-500',
};

/**
 * El manuscrito: **no es un documento nuevo, es la columna que le faltaba a la escena.**
 *
 * Una novela son sus escenas en orden de relato, y este vault ya sabe cuáles son, en qué
 * orden van, qué día ocurren, quién sale, qué se mueve en cada una y qué decisiones las
 * bloquean. Lo único que no sabía es qué dice el texto.
 *
 * De ahí sale la pantalla entera: a la izquierda la espina (que es la tabla de contenidos y
 * el navegador), en el centro el texto, y a la derecha **lo que esta escena tiene que
 * hacer** — los latidos, las leyes en juego, las decisiones que la bloquean y los avisos de
 * continuidad. Ese margen derecho es la única razón para escribir aquí en vez de en un
 * procesador de textos, y por eso son los mismos componentes que ya calcula «Analizar» y no
 * una segunda versión suya.
 */
export function ManuscriptView({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const [spine, setSpine] = useState<ManuscriptSpine | null>(null);
  const [scenes, setScenes] = useState<WorldScene[]>([]);
  const [entries, setEntries] = useState<WorldEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => localStorage.getItem(LAST_SCENE_KEY));
  const [draft, setDraft] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cast, setCast] = useState<SceneAppearance[]>([]);
  const [railOpen, setRailOpen] = useState(() => localStorage.getItem('nodus.manuscript.rail') !== '0');
  const [progress, setProgress] = useState<ManuscriptProgress | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const reloadSpine = useCallback(async () => {
    const [next, allScenes, today] = await Promise.all([
      window.nodus.manuscriptSpine(),
      window.nodus.listScenes('narrative'),
      window.nodus.manuscriptProgress(),
    ]);
    setSpine(next);
    setScenes(allScenes);
    setProgress(today);
    setSelectedId((current) => {
      if (current && allScenes.some((scene) => scene.sceneId === current)) return current;
      return allScenes[0]?.sceneId ?? null;
    });
  }, []);

  useEffect(() => {
    void reloadSpine();
    void window.nodus.listWorldEntries().then(setEntries);
  }, [reloadSpine]);

  const ordered = useMemo(
    () => (spine ? spine.chapters.flatMap((chapter) => chapter.scenes) : []),
    [spine]
  );
  const selected = scenes.find((scene) => scene.sceneId === selectedId) ?? null;

  // Load the prose of ONE scene, and only when the selection actually changes. This is the
  // only read in the section that touches a word of the manuscript.
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void window.nodus.getSceneText(selectedId).then((text) => {
      if (!active) return;
      setDraft(text.text ?? '');
      setLoadedFor(selectedId);
      localStorage.setItem(LAST_SCENE_KEY, selectedId);
    });
    return () => {
      active = false;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    void window.nodus.listSceneCharacters(selectedId).then(setCast);
  }, [selectedId]);

  /**
   * Commit on blur and when leaving the scene — never on a debounce.
   *
   * A debounce fires a write per pause in a sentence; over a chapter that is hundreds of
   * writes and a sync history nobody can read. `loadedFor` guards the one dangerous case:
   * saving the previous scene's text into the scene that has just been selected.
   */
  const commit = useCallback(
    async (sceneId: string | null, text: string) => {
      if (!sceneId || loadedFor !== sceneId) return;
      setSaving(true);
      try {
        await window.nodus.saveSceneText(sceneId, text);
        await reloadSpine();
        notifyDataChanged();
      } finally {
        setSaving(false);
      }
    },
    [loadedFor, reloadSpine]
  );

  const select = async (sceneId: string) => {
    if (sceneId === selectedId) return;
    await commit(selectedId, draft);
    setSelectedId(sceneId);
  };

  const step = (delta: number) => {
    const index = ordered.findIndex((scene) => scene.sceneId === selectedId);
    const next = ordered[index + delta];
    if (next) void select(next.sceneId);
  };

  const links = useWorldLinkAutocomplete({ entries, value: draft, onChange: setDraft, areaRef });
  const liveWords = countWords(draft);

  if (!spine) return <p className="p-6 text-sm text-neutral-500">{t('Cargando…')}</p>;

  if (ordered.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" data-testid="manuscript-empty">
        <Icon name="edit" size={32} className="text-neutral-700" />
        <p className="max-w-md text-sm text-neutral-400">
          {t('El manuscrito son tus escenas en orden de relato. Crea la primera en Escenas y aquí la escribes.')}
        </p>
        <button className="btn btn-primary" onClick={() => onNavigate?.('scenes')}>
          {t('Ir a Escenas')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="manuscript-view">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <Icon name="edit" size={20} className="text-indigo-300" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{t('Manuscrito')}</h1>
          <p className="text-[10px] text-neutral-500">
            {tx('{words} palabras · {scenes} escenas · {chapters} capítulos', {
              words: spine.totals.words.toLocaleString(),
              scenes: String(spine.totals.scenes),
              chapters: String(spine.totals.chapters),
            })}
          </p>
        </div>
        <span className="ml-auto flex items-center gap-2">
          {saving && <span className="text-[10px] text-neutral-500">{t('Guardando…')}</span>}
          <CompileButton title={t('Manuscrito')} />
          <button
            className={`btn h-8 gap-1.5 border border-neutral-700 px-2 text-xs ${railOpen ? 'btn-secondary' : 'btn-ghost'}`}
            data-testid="manuscript-rail-toggle"
            onClick={() =>
              setRailOpen((open) => {
                localStorage.setItem('nodus.manuscript.rail', open ? '0' : '1');
                return !open;
              })
            }
          >
            <Icon name="layers" size={13} /> {t('Lo que tiene que hacer')}
          </button>
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* La espina: tabla de contenidos y navegador a la vez. */}
        <div className="flex w-64 shrink-0 flex-col border-r border-neutral-800">
        <nav className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="manuscript-spine">
          {spine.chapters.map((chapter, index) => (
            <section key={chapter.startSceneId ?? `head-${index}`} className="mb-3">
              <h2 className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
                {chapter.title || (chapter.startSceneId ? t('Capítulo sin título') : t('Sin capítulo'))}
                <span className="ml-1 text-neutral-700">{chapter.wordCount.toLocaleString()}</span>
              </h2>
              <ul className="space-y-0.5">
                {chapter.scenes.map((scene) => (
                  <li key={scene.sceneId}>
                    <SpineRow
                      scene={scene}
                      selected={scene.sceneId === selectedId}
                      onOpen={() => void select(scene.sceneId)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        {progress && <Progress spine={spine} progress={progress} />}
        </div>

        {/* El texto. Medida cómoda y serifa: no es decoración, es la diferencia entre
            escribir aquí y no hacerlo. */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selected && (
            <div className="flex items-baseline gap-2 border-b border-neutral-800 px-6 py-2">
              <h2 className="min-w-0 truncate text-sm font-medium text-neutral-200">{selected.title}</h2>
              <span className="shrink-0 text-[10px] text-neutral-600">
                {tx('{count} palabras', { count: liveWords.toLocaleString() })}
              </span>
              <ChapterControl
                sceneId={selected.sceneId}
                chapter={ordered.find((scene) => scene.sceneId === selected.sceneId)?.chapter ?? null}
                onChanged={reloadSpine}
              />
              <span className="ml-auto flex shrink-0 gap-1">
                <button
                  className="btn btn-ghost h-7 w-7 p-0"
                  title={t('Escena anterior')}
                  aria-label={t('Escena anterior')}
                  onClick={() => step(-1)}
                >
                  <Icon name="chevronUp" size={14} />
                </button>
                <button
                  className="btn btn-ghost h-7 w-7 p-0"
                  title={t('Escena siguiente')}
                  aria-label={t('Escena siguiente')}
                  onClick={() => step(1)}
                >
                  <Icon name="chevronDown" size={14} />
                </button>
              </span>
            </div>
          )}
          <div className="relative min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <textarea
              ref={areaRef}
              data-testid="manuscript-editor"
              className="mx-auto block w-full max-w-[65ch] resize-none border-0 bg-transparent font-serif text-[15px] leading-8 text-neutral-100 outline-none placeholder:text-neutral-700"
              style={{ minHeight: '100%' }}
              value={draft}
              placeholder={t('Escribe la escena. [[ enlaza con cualquier cosa del mundo.')}
              onChange={(event) => {
                setDraft(event.target.value);
                links.sync(event.target.value, event.target.selectionStart);
              }}
              onClick={(event) => links.sync(draft, event.currentTarget.selectionStart)}
              onKeyDown={(event) => {
                if (links.handleKeyDown(event)) return;
                if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowDown') {
                  event.preventDefault();
                  step(1);
                } else if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
                  event.preventDefault();
                  step(-1);
                }
              }}
              onBlur={() => void commit(selectedId, draft)}
            />
            <WorldLinkCandidates
              candidates={links.candidates}
              highlight={links.highlight}
              onChoose={links.choose}
              className="left-6 top-6"
            />
          </div>
        </div>

        {/* Lo que esta escena tiene que hacer. Los mismos componentes de «Analizar»: una
            segunda versión suya sería una segunda respuesta a la misma pregunta. */}
        {railOpen && selected && (
          <aside className="w-80 shrink-0 space-y-3 overflow-y-auto border-l border-neutral-800 p-3" data-testid="manuscript-rail">
            <WorldAnchorProvider anchor={{ kind: 'scene', id: selected.sceneId, title: selected.title }}>
              <SceneQuestionBand
                sceneId={selected.sceneId}
                onOpenQuestions={onNavigate ? () => onNavigate('questions') : undefined}
              />
              <ContinuityBadge entity={{ kind: 'scene', id: selected.sceneId }} />
              <section className="rounded-xl border border-neutral-800 p-3">
                <SceneThreadsPanel scene={selected} cast={cast} onChanged={reloadSpine} />
              </section>
              <section className="rounded-xl border border-neutral-800 p-3">
                <RulesInPlay scene={selected} onChanged={reloadSpine} />
              </section>
            </WorldAnchorProvider>
          </aside>
        )}
      </div>
    </div>
  );
}

function SpineRow({ scene, selected, onOpen }: { scene: SpineScene; selected: boolean; onOpen: () => void }) {
  return (
    <button
      data-testid="manuscript-spine-row"
      data-selected={selected ? 'true' : undefined}
      onClick={onOpen}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
        selected ? 'bg-indigo-600/20 text-indigo-100' : 'text-neutral-300 hover:bg-neutral-800/60'
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_TONE[scene.status]}`} />
      <span className="min-w-0 flex-1 truncate">{scene.title}</span>
      <span className="shrink-0 text-[10px] text-neutral-600">{scene.wordCount || ''}</span>
    </button>
  );
}

/**
 * «Aquí empieza un capítulo».
 *
 * Un capítulo es DÓNDE empieza, no una fila con su propio orden: eso sería un segundo eje
 * de ordenación junto a `narrative_order`, y los dos discreparían el primer día que alguien
 * mueva una escena. Quitar la marca funde el tramo con el capítulo de arriba, que es lo
 * único que puede significar: un capítulo es siempre el trecho entre dos marcas.
 */
function ChapterControl({
  sceneId,
  chapter,
  onChanged,
}: {
  sceneId: string;
  chapter: { title: string | null; epigraph: string | null } | null;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(chapter?.title ?? '');
  const [epigraph, setEpigraph] = useState(chapter?.epigraph ?? '');

  useEffect(() => {
    setTitle(chapter?.title ?? '');
    setEpigraph(chapter?.epigraph ?? '');
  }, [chapter?.title, chapter?.epigraph, sceneId]);

  const save = async () => {
    await window.nodus.setChapterBreak(sceneId, { title: title.trim() || null, epigraph: epigraph.trim() || null });
    setOpen(false);
    await onChanged();
  };

  if (!chapter && !open) {
    return (
      <button
        className="shrink-0 text-[10px] text-neutral-600 hover:text-indigo-300"
        data-testid="manuscript-start-chapter"
        onClick={() => setOpen(true)}
      >
        {t('Empieza capítulo aquí')}
      </button>
    );
  }

  return (
    <span className="relative shrink-0">
      <button
        className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700"
        data-testid="manuscript-chapter-pill"
        onClick={() => setOpen((value) => !value)}
      >
        {chapter?.title || t('Capítulo sin título')}
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-30 w-72 rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-xl">
          <input
            className="input h-8 w-full text-xs"
            placeholder={t('Título del capítulo')}
            aria-label={t('Título del capítulo')}
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void save()}
          />
          <textarea
            className="input mt-1 w-full resize-y text-xs"
            style={{ minHeight: '3rem' }}
            placeholder={t('Epígrafe (opcional)')}
            aria-label={t('Epígrafe (opcional)')}
            value={epigraph}
            onChange={(event) => setEpigraph(event.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <button className="btn btn-primary h-7 flex-1 text-[11px]" onClick={() => void save()}>
              {t('Guardar')}
            </button>
            {chapter && (
              <button
                className="btn btn-ghost h-7 border border-neutral-700 px-2 text-[11px] text-red-300"
                data-testid="manuscript-remove-chapter"
                onClick={async () => {
                  await window.nodus.setChapterBreak(sceneId, null);
                  setOpen(false);
                  await onChanged();
                }}
              >
                {t('Quitar')}
              </button>
            )}
          </div>
          <p className="mt-1 text-[9px] leading-3 text-neutral-600">
            {t('El capítulo va de aquí a la siguiente marca. Para moverlo, mueve sus escenas.')}
          </p>
        </div>
      )}
    </span>
  );
}

/**
 * El avance, con los números que el autor puede comprobar.
 *
 * El reparto por estado es **lo que el autor declaró**, nunca lo que sugieren las palabras:
 * nada en esta bóveda recalcula a su espalda. Y el contador del día lleva su signo — un día
 * de podar es un día de trabajo, y un contador que sólo sabe sumar convierte cortar en un
 * castigo.
 */
function Progress({ spine, progress }: { spine: ManuscriptSpine; progress: ManuscriptProgress }) {
  const { byStatus, scenes } = spine.totals;
  const share = (count: number) => (scenes > 0 ? `${(count / scenes) * 100}%` : '0%');
  return (
    <div className="shrink-0 border-t border-neutral-800 p-2" data-testid="manuscript-progress">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-neutral-900">
        <span className="bg-emerald-500" style={{ width: share(byStatus.written) }} />
        <span className="bg-amber-500" style={{ width: share(byStatus.draft) }} />
        <span className="bg-neutral-700" style={{ width: share(byStatus.outline) }} />
      </div>
      <p className="mt-1.5 text-[10px] leading-4 text-neutral-500">
        {tx('{written} escritas · {draft} en borrador · {outline} en esbozo', {
          written: String(byStatus.written),
          draft: String(byStatus.draft),
          outline: String(byStatus.outline),
        })}
      </p>
      <p className={`text-[10px] leading-4 ${progress.today < 0 ? 'text-amber-500' : 'text-neutral-400'}`} data-testid="manuscript-today">
        {progress.today >= 0
          ? tx('Hoy: +{count} palabras', { count: progress.today.toLocaleString() })
          : tx('Hoy: {count} palabras podadas', { count: Math.abs(progress.today).toLocaleString() })}
      </p>
      {spine.totals.writtenButEmpty > 0 && (
        <p className="text-[10px] leading-4 text-neutral-600">
          {tx('{count} marcadas como escritas y todavía vacías', {
            count: String(spine.totals.writtenButEmpty),
          })}
        </p>
      )}
    </div>
  );
}

/**
 * Compilar: el manuscrito en un solo archivo.
 *
 * Un archivo y no una carpeta, porque un manuscrito es algo que se manda. Las opciones son
 * las dos que un autor usa de verdad —sólo lo escrito, y marcar los huecos— y no una hoja
 * de preferencias tipográficas.
 */
function CompileButton({ title }: { title: string }) {
  const [open, setOpen] = useState(false);
  const [onlyWritten, setOnlyWritten] = useState(false);
  const [includeOutlines, setIncludeOutlines] = useState(true);
  const [busy, setBusy] = useState(false);

  const run = async (format: 'md' | 'pdf') => {
    setBusy(true);
    try {
      const result = await window.nodus.exportManuscript({ title, onlyWritten, includeOutlines, format });
      if (result) toast(tx('Manuscrito exportado a {path}', { path: result.path }));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="relative">
      <button
        className="btn btn-ghost h-8 gap-1.5 border border-neutral-700 px-2 text-xs"
        data-testid="manuscript-compile"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="download" size={13} /> {t('Compilar')}
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-72 rounded-lg border border-neutral-700 bg-neutral-900 p-3 shadow-xl">
          <label className="flex items-center gap-2 text-xs text-neutral-300">
            <input type="checkbox" checked={onlyWritten} onChange={(event) => setOnlyWritten(event.target.checked)} />
            {t('Sólo las escenas marcadas como escritas')}
          </label>
          <label className="mt-1.5 flex items-center gap-2 text-xs text-neutral-300">
            <input
              type="checkbox"
              checked={includeOutlines}
              onChange={(event) => setIncludeOutlines(event.target.checked)}
            />
            {t('Marcar los huecos con su resumen')}
          </label>
          <p className="mt-2 text-[10px] leading-4 text-neutral-600">
            {t('Los enlaces internos del mundo se quedan en su texto: lo que sale es prosa, no una bóveda.')}
          </p>
          <div className="mt-2 flex gap-2">
            <button className="btn btn-primary h-7 flex-1 text-[11px]" disabled={busy} onClick={() => void run('md')}>
              {t('Markdown')}
            </button>
            <button className="btn btn-ghost h-7 flex-1 border border-neutral-700 text-[11px]" disabled={busy} onClick={() => void run('pdf')}>
              {t('PDF')}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
