import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  TestimonyInterviewRow,
  TestimonyMedia,
  TestimonyParticipantRow,
  TestimonySession,
  TestimonyTranscript,
  TestimonyTranscriptKind,
  TestimonyTranscriptSegment,
} from '@shared/types';
import {
  allowedDerivations,
  correctedTranscriptText,
  formatDuration,
  isEditableTranscriptKind,
  segmentsFromWhisper,
} from '@shared/testimonies';
import {
  MEDIA_ROLE_LABEL,
  SESSION_STATUS_LABEL,
  TRANSCRIPT_KIND_HINT,
  TRANSCRIPT_KIND_LABEL,
  TRANSCRIPT_STATUS_LABEL,
} from '@shared/testimonyLabels';
import { STUDY_STT_LANGUAGES } from '@shared/sttModels';
import {
  audioBlobToWhisperWav,
  cancelLocalWhisper,
  isLocalWhisperModelReady,
  transcribeLocalWhisperDetailed,
} from '../../lib/stt/localWhisper';
import { Icon } from '../ui';
import { confirm, toast } from '../feedback';
import { LocalAudioRecorderPanel, useLocalAudioRecorder } from '../media/LocalAudioRecorder';
import { MediaPlayer } from '../media/MediaPlayer';
import { TranscriptionProgress } from '../media/TranscriptionProgress';
import { TranscriptSegmentEditor } from '../media/TranscriptSegmentEditor';
import { SpeakerDetection } from './SpeakerDetection';
import { TranscriptImprove } from './TranscriptImprove';
import { TESTIMONY_MEDIA_ACCENT, formatBytes } from '../media/mediaFormat';
import { TestimonyField } from './TestimonyField';
import { t, tx, getActiveLang } from '../../i18n';
import { localizeRuntimeError } from '@shared/uiLanguage';

/**
 * Sesiones, grabaciones y transcripción de una entrevista.
 *
 * VARIAS SESIONES, VARIOS ARCHIVOS, VARIAS VERSIONES. Es lo que separa este vertical de
 * Estudio: una historia de vida no cabe en una tarde, se hace en tres sesiones en tres
 * semanas, y cada una puede tener su grabación, su copia de consulta y su transcripción
 * con varias versiones.
 *
 * LA TRANSCRIPCIÓN CORRE EN ESTE EQUIPO, con el mismo motor que Estudio. La versión
 * literal que produce es INMUTABLE: corregir, revisar, aprobar, anonimizar o traducir
 * crea una versión nueva que recuerda de cuál viene, y al nacer se reanclan sus
 * fragmentos contra ella — los que no se pueden reanclar con seguridad quedan marcados y
 * se cuentan, nunca se mueven en silencio.
 *
 * Y NO HAY RECORTE DE SILENCIOS: en historia oral una pausa puede ser parte del sentido.
 */
export function InterviewSessions({
  row,
  people,
  onChanged,
}: {
  row: TestimonyInterviewRow;
  people: TestimonyParticipantRow[];
  onChanged: () => Promise<void>;
}) {
  const [sessions, setSessions] = useState<TestimonySession[]>([]);
  const [activeMediaId, setActiveMediaId] = useState<string | null>(null);
  const [activeTranscriptId, setActiveTranscriptId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TestimonyTranscriptSegment[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [partial, setPartial] = useState('');
  const [language, setLanguage] = useState('auto');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelledRef = useRef(false);
  const recordingSessionRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    setSessions(await window.nodus.listTestimonySessions(row.id));
  }, [row.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    setLanguage(row.language || 'auto');
  }, [row.language]);

  const allMedia = useMemo(() => sessions.flatMap((session) => session.media), [sessions]);
  const activeMedia = useMemo(
    () => allMedia.find((media) => media.id === activeMediaId) ?? allMedia[0] ?? null,
    [allMedia, activeMediaId],
  );
  const activeTranscript = useMemo(() => {
    if (!activeMedia) return null;
    return activeMedia.transcripts.find((entry) => entry.id === activeTranscriptId)
      ?? activeMedia.transcripts[activeMedia.transcripts.length - 1]
      ?? null;
  }, [activeMedia, activeTranscriptId]);

  useEffect(() => {
    if (!activeTranscript) {
      setSegments([]);
      return;
    }
    void window.nodus.listTestimonySegments(activeTranscript.id).then(setSegments);
  }, [activeTranscript?.id, activeTranscript?.segmentCount]);

  const speakerOptions = useMemo(
    () => row.participants.map((person) => ({ id: person.personId, label: person.workingName })),
    [row.participants],
  );

  const recorder = useLocalAudioRecorder({
    fileBaseName: 'entrevista',
    // Sin recorte de silencios: una pausa puede ser parte del testimonio.
    allowSilenceTrim: false,
    onError: setError,
    onSaved: async (audio) => {
      const sessionId = recordingSessionRef.current;
      if (!sessionId) return;
      const result = await window.nodus.importTestimonyMedia({
        sessionId,
        fileName: audio.fileName,
        mimeType: audio.mimeType,
        bytes: audio.bytes.slice().buffer as ArrayBuffer,
        durationSeconds: audio.durationSeconds,
      });
      recordingSessionRef.current = null;
      setActiveMediaId(result.media.id);
      await reload();
      await onChanged();
    },
  });

  const addSession = async (): Promise<void> => {
    await window.nodus.createTestimonySession({ interviewId: row.id, language: row.language, mode: row.interviewMode });
    await reload();
    await onChanged();
  };

  const importFiles = async (sessionId: string): Promise<void> => {
    setError('');
    const paths = await window.nodus.pickTestimonyMediaFiles();
    if (paths.length === 0) return;
    setBusy(true);
    try {
      const results = await window.nodus.importTestimonyMediaPaths(sessionId, paths);
      const duplicates = results.filter((result) => result.duplicateOf).length;
      if (duplicates > 0) {
        toast(tx('{n} archivos ya estaban en esta sesión y no se han duplicado.', { n: duplicates }));
      }
      if (results[0]) setActiveMediaId(results[0].media.id);
      await reload();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Transcribir en este equipo. El resultado se guarda como versión LITERAL, que después
   * nadie puede editar: es la única prueba de qué oyó el modelo frente a qué decidió el
   * investigador.
   */
  const transcribe = async (media: TestimonyMedia): Promise<void> => {
    cancelledRef.current = false;
    setError('');
    setPartial('');
    setProgress(0.01);
    setBusy(true);
    try {
      const [content, settings] = await Promise.all([
        window.nodus.getTestimonyMediaBlob(media.id),
        window.nodus.getSettings(),
      ]);
      if (!content) throw new Error(t('Este archivo ya no guarda su audio en la bóveda.'));
      const blob = new Blob([content.bytes], { type: content.mimeType });
      const provider = settings.sttProvider;
      let text = '';
      let model = '';
      let chunks: { text: string; timestamp: [number | null, number | null] | null }[] = [];
      if (provider === 'transformers') {
        model = settings.sttTransformersModel;
        if (!isLocalWhisperModelReady(model)) {
          throw new Error(t('Descarga el modelo ONNX seleccionado desde Ajustes antes de transcribir.'));
        }
        const result = await transcribeLocalWhisperDetailed(blob, model, language, setProgress, setPartial);
        text = result.text;
        chunks = result.chunks;
      } else {
        model = provider === 'whisper_cpp'
          ? settings.sttWhisperCppModel
          : settings.transcriptionModel?.provider === 'openai' ? settings.transcriptionModel.model : '';
        const audioBytes = provider === 'whisper_cpp'
          ? await audioBlobToWhisperWav(blob)
          : new Uint8Array(content.bytes);
        const result = await window.nodus.transcribeStudyAudio(
          { audioBytes, mimeType: provider === 'whisper_cpp' ? 'audio/wav' : content.mimeType, provider, model, language },
          { onProgress: setProgress, onPartial: setPartial },
        );
        text = result.text;
        model = result.model;
        chunks = result.chunks ?? [];
      }
      if (cancelledRef.current) return;
      if (!text.trim()) throw new Error(t('El modelo no devolvió texto para este archivo.'));
      const raw = segmentsFromWhisper(chunks, text, media.durationSeconds ?? 0);
      const transcript = await window.nodus.createTestimonyTranscript({
        mediaId: media.id,
        kind: 'machine_literal',
        language: language === 'auto' ? row.language : language,
        contentMarkdown: text.trim(),
        status: 'ready',
        modelProvider: provider,
        modelName: model,
        segments: raw.map((segment) => ({ tStart: segment.tStart, tEnd: segment.tEnd, text: segment.text })),
      });
      setProgress(1);
      setPartial('');
      setActiveTranscriptId(transcript.id);
      await reload();
      await onChanged();
    } catch (cause) {
      if (!cancelledRef.current) setError(localizeRuntimeError(cause instanceof Error ? cause.message : String(cause), getActiveLang()));
    } finally {
      setBusy(false);
    }
  };

  const cancelTranscription = async (): Promise<void> => {
    cancelledRef.current = true;
    cancelLocalWhisper();
    await window.nodus.cancelStudyTranscription();
    setBusy(false);
    setPartial('');
    setProgress(0);
  };

  const derive = async (source: TestimonyTranscript, kind: TestimonyTranscriptKind): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const result = await window.nodus.deriveTestimonyTranscript(source.id, kind);
      // Corregir es una operación CONSERVADORA: espacios, puntuación y mayúscula tras
      // punto. La forma de hablar no se toca — en historia oral es parte de lo que se
      // cuenta, y pulirla borra al narrador y deja al corrector.
      if (kind === 'corrected') {
        for (const segment of await window.nodus.listTestimonySegments(result.transcript.id)) {
          const next = correctedTranscriptText(segment.text);
          if (next !== segment.text) await window.nodus.updateTestimonySegment(segment.id, { text: next });
        }
      }
      if (result.needsReview > 0) {
        toast(tx('{n} fragmentos no se pudieron reanclar con seguridad y están pendientes de revisar.', { n: result.needsReview }));
      }
      setActiveTranscriptId(result.transcript.id);
      await reload();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const jumpTo = (seconds: number): void => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    void audioRef.current.play();
  };

  const dropBytes = async (media: TestimonyMedia): Promise<void> => {
    const ok = await confirm({
      title: t('Soltar el audio de este archivo'),
      message: t('La transcripción NO sustituye al original: es una interpretación de lo que se oyó. Nodus te pedirá exportar el maestro primero, porque después no se puede recuperar. La ficha, la huella y las transcripciones se conservan.'),
      confirmLabel: t('Exportar y soltar'),
      danger: true,
    });
    if (!ok) return;
    const saved = await window.nodus.exportTestimonyMaster(media.id);
    if (!saved) return;
    await window.nodus.dropTestimonyMediaBytes(media.id);
    await reload();
    await onChanged();
  };

  return (
    <div className="space-y-5" data-testid="testimony-sessions">
      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" data-testid="testimony-add-session" onClick={() => void addSession()}>
          <Icon name="plus" /> {t('Añadir sesión')}
        </button>
        <span className="text-xs text-neutral-500">
          {tx('{sessions} sesiones · {media} archivos · {duration}', {
            sessions: sessions.length,
            media: allMedia.length,
            duration: formatDuration(row.durationSeconds),
          })}
        </span>
      </div>

      <LocalAudioRecorderPanel recorder={recorder} accent={TESTIMONY_MEDIA_ACCENT} testid="testimony-recorder" />

      {sessions.length === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-800">
          {t('Todavía no hay sesiones. Una entrevista puede tener varias: añade la primera para grabar o importar su audio.')}
        </p>
      )}

      {sessions.map((session) => (
        <section
          key={session.id}
          className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
          data-testid={`testimony-session-${session.shortId}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
              {tx('Sesión {n}', { n: session.sequenceNo })} · {session.shortId}
            </span>
            <span className="text-[11px] text-neutral-500">{t(SESSION_STATUS_LABEL[session.status])}</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                className="btn btn-ghost text-xs"
                data-testid={`testimony-import-${session.shortId}`}
                disabled={busy}
                onClick={() => void importFiles(session.id)}
              >
                <Icon name="upload" /> {t('Importar audio')}
              </button>
              <button
                className="btn btn-ghost text-xs"
                data-testid={`testimony-record-${session.shortId}`}
                disabled={recorder.state !== 'idle'}
                onClick={() => { recordingSessionRef.current = session.id; void recorder.start(); }}
              >
                <Icon name="microphone" /> {t('Grabar')}
              </button>
              <button
                className="btn btn-ghost text-xs text-rose-500"
                title={t('Eliminar sesión')}
                onClick={async () => {
                  const ok = await confirm({
                    title: t('Eliminar sesión'),
                    message: t('Se eliminarán también sus archivos, transcripciones y los fragmentos que dependan de ellas.'),
                    confirmLabel: t('Eliminar'),
                    danger: true,
                  });
                  if (!ok) return;
                  await window.nodus.deleteTestimonySession(session.id);
                  await reload();
                  await onChanged();
                }}
              >
                <Icon name="trash" />
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <TestimonyField
              label="Título de la sesión"
              multiline={false}
              value={session.title}
              onSave={async (next) => { await window.nodus.updateTestimonySession(session.id, { title: next || null }); await reload(); }}
            />
            <TestimonyField
              label="Lugar"
              multiline={false}
              value={session.locationText}
              onSave={async (next) => { await window.nodus.updateTestimonySession(session.id, { locationText: next || null }); await reload(); }}
            />
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Fecha de grabación')}</span>
              <input
                type="date"
                className="input w-full"
                value={session.recordedAt?.slice(0, 10) ?? ''}
                onChange={async (event) => {
                  await window.nodus.updateTestimonySession(session.id, {
                    recordedAt: event.target.value ? new Date(event.target.value).toISOString() : null,
                  });
                  await reload();
                }}
              />
            </label>
          </div>

          <div className="mt-3">
            <TestimonyField
              label="Notas de campo"
              hint="Lo que no está en el audio: cómo se encontraba, quién más había en la sala, qué contó al apagar la grabadora."
              value={session.fieldNotes}
              rows={3}
              testid={`testimony-field-notes-${session.shortId}`}
              onSave={async (next) => { await window.nodus.updateTestimonySession(session.id, { fieldNotes: next || null }); await reload(); }}
            />
          </div>

          {session.media.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {session.media.map((media) => (
                <li
                  key={media.id}
                  className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 text-xs ${
                    activeMedia?.id === media.id
                      ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-700/60 dark:bg-indigo-950/30'
                      : 'border-neutral-200 dark:border-neutral-800'
                  }`}
                  data-testid={`testimony-media-${media.shortId}`}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => { setActiveMediaId(media.id); setActiveTranscriptId(null); }}
                  >
                    <Icon name="microphone" size={13} className="shrink-0 text-neutral-500" />
                    <span className="min-w-0 flex-1 truncate font-medium text-neutral-700 dark:text-neutral-200">{media.fileName}</span>
                  </button>
                  <span className="rounded-full border border-neutral-300 px-1.5 text-[10px] text-neutral-500 dark:border-neutral-700">
                    {t(MEDIA_ROLE_LABEL[media.role])}
                  </span>
                  <span className="text-neutral-500">{formatDuration(media.durationSeconds)}</span>
                  <span className="text-neutral-500">{formatBytes(media.sizeBytes ?? 0)}</span>
                  <span className="font-mono text-[10px] text-neutral-500" title={media.contentHash ?? ''}>
                    {media.contentHash ? `${media.contentHash.slice(0, 8)}…` : t('sin huella')}
                  </span>
                  <button
                    className="btn btn-ghost h-6 px-1.5 text-[11px]"
                    title={t('Comprobar la huella contra los bytes reales')}
                    data-testid={`testimony-verify-${media.shortId}`}
                    onClick={async () => {
                      const result = await window.nodus.verifyTestimonyMediaHash(media.id);
                      toast(result.ok
                        ? t('El archivo coincide con su huella.')
                        : t('La huella NO coincide: el archivo puede estar dañado. Restaura una copia de seguridad.'));
                    }}
                  >
                    <Icon name="shield" size={11} />
                  </button>
                  <button
                    className="btn btn-ghost h-6 px-1.5 text-[11px]"
                    title={t('Exportar el original')}
                    onClick={() => void window.nodus.exportTestimonyMaster(media.id)}
                  >
                    <Icon name="download" size={11} />
                  </button>
                  {media.sizeBytes ? (
                    <button
                      className="btn btn-ghost h-6 px-1.5 text-[11px] text-amber-500"
                      title={t('Soltar el audio conservando la ficha')}
                      onClick={() => void dropBytes(media)}
                    >
                      <Icon name="minus" size={11} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {activeMedia && (
        <section className="space-y-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800" data-testid="testimony-transcript-panel">
          <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{activeMedia.fileName}</h3>

          <MediaPlayer
            mediaId={activeMedia.id}
            accent={TESTIMONY_MEDIA_ACCENT}
            load={(id) => window.nodus.getTestimonyMediaBlob(id)}
            onAudioRef={(audio) => { audioRef.current = audio; }}
            testid="testimony-player"
          />

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              {t('Idioma del audio')}
              <select className="input h-8" data-testid="testimony-language" value={language} onChange={(event) => setLanguage(event.target.value)}>
                {STUDY_STT_LANGUAGES.map((entry) => <option key={entry.code} value={entry.code}>{t(entry.label)}</option>)}
              </select>
            </label>
            {!busy && (
              <button className="btn btn-primary" data-testid="testimony-transcribe" onClick={() => void transcribe(activeMedia)}>
                <Icon name="microphone" />
                {activeMedia.transcripts.length > 0 ? t('Transcribir otra vez') : t('Transcribir en este equipo')}
              </button>
            )}
            {busy && progress > 0 && (
              <button className="btn btn-secondary" onClick={() => void cancelTranscription()}>
                <Icon name="stop" /> {t('Cancelar')}
              </button>
            )}
            <span className="text-[11px] text-neutral-500">
              {t('La transcripción se procesa en este equipo. El audio no sale de aquí.')}
            </span>
          </div>

          {busy && progress > 0 && (
            <TranscriptionProgress accent={TESTIMONY_MEDIA_ACCENT} progress={progress} partial={partial} testid="testimony-transcription" />
          )}

          {activeMedia.transcripts.length > 0 && (
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800">
              <div className="flex flex-wrap items-center gap-1 border-b border-neutral-200 p-2 dark:border-neutral-800">
                {activeMedia.transcripts.map((transcript) => (
                  <button
                    key={transcript.id}
                    data-testid={`testimony-version-${transcript.kind}`}
                    onClick={() => setActiveTranscriptId(transcript.id)}
                    title={t(TRANSCRIPT_KIND_HINT[transcript.kind])}
                    className={`rounded-md px-2.5 py-1 text-xs ${
                      activeTranscript?.id === transcript.id
                        ? 'bg-indigo-600 text-white'
                        : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
                    }`}
                  >
                    {t(TRANSCRIPT_KIND_LABEL[transcript.kind])}
                    {transcript.versionNo > 1 && ` v${transcript.versionNo}`}
                  </button>
                ))}
                {activeTranscript && (
                  <span className="ml-2 text-[11px] text-neutral-500">
                    {t(TRANSCRIPT_STATUS_LABEL[activeTranscript.status])}
                    {activeTranscript.modelName ? ` · ${activeTranscript.modelName}` : ''}
                    {` · ${tx('{n} tramos', { n: activeTranscript.segmentCount })}`}
                  </span>
                )}
                <span className="ml-auto flex flex-wrap items-center gap-1">
                  {activeTranscript && allowedDerivations(activeTranscript.kind).map((kind) => (
                    <button
                      key={kind}
                      className="btn btn-ghost h-7 px-2 text-xs"
                      data-testid={`testimony-derive-${kind}`}
                      disabled={busy}
                      onClick={() => void derive(activeTranscript, kind)}
                    >
                      <Icon name="plus" size={12} /> {t(TRANSCRIPT_KIND_LABEL[kind])}
                    </button>
                  ))}
                </span>
              </div>

              {activeTranscript && !isEditableTranscriptKind(activeTranscript.kind) && (
                <p
                  className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] leading-5 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40"
                  data-testid="testimony-immutable-notice"
                >
                  {t(TRANSCRIPT_KIND_HINT[activeTranscript.kind])}
                </p>
              )}

              <TranscriptSegmentEditor
                className="max-h-[420px]"
                segments={segments.map((segment) => ({
                  id: segment.id,
                  tStart: segment.tStart,
                  tEnd: segment.tEnd,
                  text: segment.text,
                  speakerLabel: segment.speakerLabel,
                  speakerPersonId: segment.speakerPersonId,
                }))}
                accent={TESTIMONY_MEDIA_ACCENT}
                readOnly={!activeTranscript || !isEditableTranscriptKind(activeTranscript.kind)}
                speakerOptions={speakerOptions}
                onJump={jumpTo}
                onSaveText={async (segmentId, text) => {
                  await window.nodus.updateTestimonySegment(segmentId, { text });
                  if (activeTranscript) setSegments(await window.nodus.listTestimonySegments(activeTranscript.id));
                }}
                onSaveSpeaker={async (segmentId, value) => {
                  await window.nodus.updateTestimonySegment(segmentId, {
                    ...(value.personId !== undefined ? { speakerPersonId: value.personId } : {}),
                    ...(value.label !== undefined ? { speakerLabel: value.label } : {}),
                  });
                  if (activeTranscript) setSegments(await window.nodus.listTestimonySegments(activeTranscript.id));
                }}
                testid="testimony-segments"
              />

              {activeTranscript && allowedDerivations(activeTranscript.kind).includes('corrected') && (
                <TranscriptImprove
                  transcript={activeTranscript}
                  onCreated={async (transcriptId) => {
                    await onChanged();
                    setActiveTranscriptId(transcriptId);
                  }}
                />
              )}

              {activeTranscript && isEditableTranscriptKind(activeTranscript.kind) && (
                <SpeakerDetection
                  transcriptId={activeTranscript.id}
                  segments={segments}
                  editable
                  blob={async () => {
                    const content = await window.nodus.getTestimonyMediaBlob(activeMedia.id);
                    return content ? new Blob([content.bytes], { type: content.mimeType }) : null;
                  }}
                  onApplied={async () => {
                    setSegments(await window.nodus.listTestimonySegments(activeTranscript.id));
                    await onChanged();
                  }}
                />
              )}

              {activeTranscript && isEditableTranscriptKind(activeTranscript.kind) && (
                <SpeakerBulkAssign
                  transcriptId={activeTranscript.id}
                  people={people}
                  onAssigned={async () => {
                    setSegments(await window.nodus.listTestimonySegments(activeTranscript.id));
                    await onChanged();
                  }}
                />
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Atribuir en lote todos los tramos de una etiqueta a una persona.
 *
 * Es la operación real: nadie identifica «Voz 2» tramo a tramo en hora y media de
 * entrevista. La detección acústica separa las voces —eso sí lo hace la máquina—, pero
 * PONERLES NOMBRE sigue siendo manual: una atribución automática equivocada pone palabras
 * en la boca de alguien sin dejar rastro.
 */
function SpeakerBulkAssign({
  transcriptId,
  people,
  onAssigned,
}: {
  transcriptId: string;
  people: TestimonyParticipantRow[];
  onAssigned: () => Promise<void>;
}) {
  const [labels, setLabels] = useState<{ label: string | null; personId: string | null; segments: number }[]>([]);

  const reload = useCallback(async () => {
    setLabels(await window.nodus.testimonySpeakerLabels(transcriptId));
  }, [transcriptId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const pending = labels.filter((entry) => !entry.personId);
  if (pending.length === 0) return null;

  return (
    <div className="border-t border-neutral-200 p-3 dark:border-neutral-800" data-testid="testimony-speaker-assign">
      <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Atribuir hablantes')}</p>
      <p className="mt-0.5 text-[11px] leading-4 text-neutral-500">
        {t('Nodus separa las voces, pero no reconoce a las personas: decides tú quién habla en cada etiqueta. Se aplica a todos sus tramos de una vez.')}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {pending.map((entry) => (
          <label key={entry.label ?? 'none'} className="flex items-center gap-1.5 text-xs">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
              {entry.label ?? t('Sin identificar')} · {entry.segments}
            </span>
            <select
              className="input h-7 py-0 text-xs"
              data-testid={`testimony-assign-${(entry.label ?? 'none').replace(/\s+/g, '-')}`}
              defaultValue=""
              onChange={async (event) => {
                if (!event.target.value) return;
                await window.nodus.assignTestimonySpeaker(transcriptId, entry.label, event.target.value);
                await reload();
                await onAssigned();
              }}
            >
              <option value="">{t('Elegir persona…')}</option>
              {people.map((person) => (
                <option key={person.personId} value={person.personId}>{person.workingName}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
