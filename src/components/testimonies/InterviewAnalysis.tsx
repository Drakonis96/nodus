import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  TestimonyAnnotation,
  TestimonyCode,
  TestimonyInterviewRow,
  TestimonySession,
  TestimonyTranscript,
  TestimonyTranscriptSegment,
} from '@shared/types';
import { preferredTranscript } from '@shared/testimonies';
import { CODE_KIND_LABEL, TRANSCRIPT_KIND_LABEL } from '@shared/testimonyLabels';
import { Icon } from '../ui';
import { confirm, promptText, toast } from '../feedback';
import { MediaPlayer } from '../media/MediaPlayer';
import { TESTIMONY_MEDIA_ACCENT } from '../media/mediaFormat';
import { AnalysisProposal } from './AnalysisProposal';
import { TranscriptAnnotationLayer } from './TranscriptAnnotationLayer';
import { t, tx } from '../../i18n';

/**
 * La pestaña Análisis: codificar la transcripción de esta entrevista.
 *
 * EL CATÁLOGO DE CÓDIGOS SE GESTIONA DESDE AQUÍ, y por eso no hay una sección «Temas y
 * códigos» en el menú. Renombrar, describir, colorear y fusionar se hacen en el panel de
 * la derecha, sobre el catálogo COMPARTIDO por toda la bóveda — que es lo que después
 * permite cruzarlos en Contrastes.
 *
 * Se codifica sobre la MEJOR versión disponible (aprobada > revisada > corregida > … >
 * literal), no sobre la última creada: citar un error de reconocimiento como palabras del
 * narrador es el fallo que este vault existe para evitar.
 */
export function InterviewAnalysis({ row, onChanged }: { row: TestimonyInterviewRow; onChanged: () => Promise<void> }) {
  const [sessions, setSessions] = useState<TestimonySession[]>([]);
  const [transcriptId, setTranscriptId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TestimonyTranscriptSegment[]>([]);
  const [annotations, setAnnotations] = useState<TestimonyAnnotation[]>([]);
  const [codes, setCodes] = useState<TestimonyCode[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const reloadCodes = useCallback(async () => {
    setCodes(await window.nodus.listTestimonyCodes());
  }, []);

  const reload = useCallback(async () => {
    const [nextSessions, nextAnnotations] = await Promise.all([
      window.nodus.listTestimonySessions(row.id),
      window.nodus.listTestimonyAnnotations(row.id),
    ]);
    setSessions(nextSessions);
    setAnnotations(nextAnnotations);
    await reloadCodes();
  }, [row.id, reloadCodes]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const media = useMemo(() => sessions.flatMap((session) => session.media), [sessions]);
  const transcripts = useMemo(() => media.flatMap((entry) => entry.transcripts), [media]);

  const activeTranscript = useMemo<TestimonyTranscript | null>(() => {
    if (transcriptId) return transcripts.find((entry) => entry.id === transcriptId) ?? null;
    return preferredTranscript(transcripts);
  }, [transcripts, transcriptId]);

  const activeMedia = useMemo(
    () => media.find((entry) => entry.id === activeTranscript?.mediaId) ?? null,
    [media, activeTranscript],
  );

  useEffect(() => {
    if (!activeTranscript) {
      setSegments([]);
      return;
    }
    void window.nodus.listTestimonySegments(activeTranscript.id).then(setSegments);
  }, [activeTranscript?.id]);

  const speakerNames = useMemo(
    () => new Map(row.participants.map((person) => [person.personId, person.displayName])),
    [row.participants],
  );

  const jumpTo = (seconds: number): void => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    void audioRef.current.play();
  };

  const needsReview = annotations.filter((annotation) => annotation.linkStatus === 'needs_review');

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="testimony-analysis">
      <div className="flex min-h-0 flex-col gap-3">
        {transcripts.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-neutral-500">
            {t('Versión sobre la que codificar')}
            <select
              className="input h-8"
              data-testid="testimony-analysis-version"
              value={activeTranscript?.id ?? ''}
              onChange={(event) => setTranscriptId(event.target.value)}
            >
              {transcripts.map((transcript) => (
                <option key={transcript.id} value={transcript.id}>
                  {t(TRANSCRIPT_KIND_LABEL[transcript.kind])}
                  {transcript.versionNo > 1 ? ` v${transcript.versionNo}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        {activeMedia && (
          <MediaPlayer
            mediaId={activeMedia.id}
            accent={TESTIMONY_MEDIA_ACCENT}
            load={(id) => window.nodus.getTestimonyMediaBlob(id)}
            onAudioRef={(audio) => { audioRef.current = audio; }}
            testid="testimony-analysis-player"
          />
        )}

        {needsReview.length > 0 && (
          <div
            className="rounded-lg border border-amber-400 bg-amber-50 p-2 text-[11px] leading-5 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-300"
            data-testid="testimony-needs-review-banner"
          >
            {tx('{n} fragmentos quedaron pendientes de revisar al crearse una versión nueva. Nodus no los ha movido: comprueba que la cita sigue siendo la misma.', { n: needsReview.length })}
          </div>
        )}

        {activeTranscript && (
          <AnalysisProposal
            interviewId={row.id}
            segments={segments}
            codes={codes}
            onChanged={async () => { await reload(); await onChanged(); }}
          />
        )}

        {activeTranscript ? (
          <TranscriptAnnotationLayer
            interviewId={row.id}
            transcriptId={activeTranscript.id}
            segments={segments}
            annotations={annotations.filter((annotation) => annotation.transcriptId === activeTranscript.id)}
            codes={codes}
            speakerNames={speakerNames}
            onJump={jumpTo}
            onChanged={async () => { await reload(); await onChanged(); }}
            onCatalogChanged={reloadCodes}
          />
        ) : (
          <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-800">
            {t('Para codificar hace falta una transcripción. Añádela en «Sesiones y transcripción».')}
          </p>
        )}
      </div>

      <CodeCatalogPanel codes={codes} onChanged={async () => { await reload(); await onChanged(); }} />
    </div>
  );
}

/**
 * El catálogo de códigos de la bóveda, gestionado desde dentro de la entrevista.
 *
 * FUSIONAR es la operación que salva un catálogo. Dos nombres para lo mismo aparecen
 * inevitablemente —«Hambre» y «Hambruna de 1946» escritas con seis meses de diferencia— y
 * sin fusión el investigador acaba con doscientos códigos que no cruzan nada. La fusión no
 * pierde ninguna anotación, ni siquiera cuando un fragmento llevaba los dos, que es el
 * caso más probable de todos.
 */
function CodeCatalogPanel({ codes, onChanged }: { codes: TestimonyCode[]; onChanged: () => Promise<void> }) {
  const [search, setSearch] = useState('');
  const [mergeSource, setMergeSource] = useState<TestimonyCode | null>(null);

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return codes.filter((code) => !needle || code.label.toLocaleLowerCase().includes(needle));
  }, [codes, search]);

  const rename = async (code: TestimonyCode): Promise<void> => {
    const next = await promptText({ title: t('Renombrar código'), initial: code.label });
    if (next === null) return;
    try {
      await window.nodus.updateTestimonyCode(code.id, { label: next });
      await onChanged();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const merge = async (target: TestimonyCode): Promise<void> => {
    if (!mergeSource || mergeSource.id === target.id) return;
    const ok = await confirm({
      title: t('Fusionar códigos'),
      message: tx('Todos los fragmentos de «{source}» pasarán a «{target}», y «{source}» dejará de existir. No se pierde ninguna anotación.', {
        source: mergeSource.label,
        target: target.label,
      }),
      confirmLabel: t('Fusionar'),
    });
    if (!ok) return;
    await window.nodus.mergeTestimonyCodes(mergeSource.id, target.id);
    setMergeSource(null);
    await onChanged();
  };

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-neutral-200 p-3 dark:border-neutral-800" data-testid="testimony-code-catalog">
      <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{t('Códigos y temas')}</h3>
      <p className="mt-0.5 text-[11px] leading-4 text-neutral-500">
        {t('El catálogo es de toda la bóveda: un código creado aquí se puede aplicar en cualquier entrevista y cruzar en Contrastes.')}
      </p>
      <input
        className="input mt-2 w-full text-xs"
        placeholder={t('Buscar en el catálogo…')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {mergeSource && (
        <p className="mt-2 rounded border border-indigo-400 bg-indigo-50 p-2 text-[11px] text-indigo-700 dark:border-indigo-700/60 dark:bg-indigo-950/30 dark:text-indigo-300">
          {tx('Elige en qué código se funde «{name}».', { name: mergeSource.label })}
          <button className="ml-2 underline" onClick={() => setMergeSource(null)}>{t('Cancelar')}</button>
        </p>
      )}
      <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {visible.length === 0 && (
          <li className="py-4 text-center text-[11px] text-neutral-500">
            {t('Todavía no hay códigos. Se crean seleccionando un pasaje de la transcripción.')}
          </li>
        )}
        {visible.map((code) => (
          <li
            key={code.id}
            className={`flex items-center gap-1.5 rounded border px-1.5 py-1 text-[11px] ${
              mergeSource && mergeSource.id !== code.id
                ? 'cursor-pointer border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30'
                : 'border-neutral-200 dark:border-neutral-800'
            }`}
            data-testid={`testimony-code-${code.normalizedLabel.replace(/\s+/g, '-')}`}
            onClick={() => { if (mergeSource && mergeSource.id !== code.id) void merge(code); }}
          >
            <input
              type="color"
              className="h-4 w-4 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
              aria-label={tx('Color de {name}', { name: code.label })}
              value={code.color ?? '#0891b2'}
              onChange={(event) => void window.nodus.updateTestimonyCode(code.id, { color: event.target.value }).then(onChanged)}
            />
            <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-200">{code.label}</span>
            {code.kind === 'theme' && <span className="shrink-0 text-[10px] text-neutral-500">{t(CODE_KIND_LABEL.theme)}</span>}
            <span className="shrink-0 text-[10px] text-neutral-500" title={t('Fragmentos · entrevistas')}>
              {code.usageCount}·{code.interviewCount}
            </span>
            <button className="btn btn-ghost h-5 px-1" title={t('Renombrar')} onClick={() => void rename(code)}>
              <Icon name="edit" size={10} />
            </button>
            <button
              className="btn btn-ghost h-5 px-1"
              title={code.kind === 'theme' ? t('Convertir en código') : t('Convertir en tema')}
              onClick={() => void window.nodus.updateTestimonyCode(code.id, { kind: code.kind === 'theme' ? 'code' : 'theme' }).then(onChanged)}
            >
              <Icon name="layers" size={10} />
            </button>
            <button
              className="btn btn-ghost h-5 px-1"
              title={t('Fusionar con otro')}
              data-testid={`testimony-merge-${code.normalizedLabel.replace(/\s+/g, '-')}`}
              onClick={(event) => { event.stopPropagation(); setMergeSource(code); }}
            >
              <Icon name="swap" size={10} />
            </button>
            <button
              className="btn btn-ghost h-5 px-1 text-rose-500"
              title={t('Eliminar del catálogo')}
              onClick={async (event) => {
                event.stopPropagation();
                const ok = await confirm({
                  title: t('Eliminar código'),
                  message: tx('«{name}» dejará de existir y se quitará de los {n} fragmentos que lo llevan. Los fragmentos se conservan.', {
                    name: code.label,
                    n: code.usageCount,
                  }),
                  confirmLabel: t('Eliminar'),
                  danger: true,
                });
                if (!ok) return;
                await window.nodus.deleteTestimonyCode(code.id);
                await onChanged();
              }}
            >
              <Icon name="trash" size={10} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
