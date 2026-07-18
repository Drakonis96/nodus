import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  StudyPlacementInput,
  StudyRecordingDetail,
  StudyRecordingSummary,
  StudyRecordingStatus,
  StudyTranscriptKind,
  StudyWorkspace,
} from '@shared/types';
import {
  correctedStudyTranscript,
  formatStudyTimestamp,
  normalizeStudyTranscriptSegments,
  structuredStudyNotes,
} from '@shared/studyRecordings';
import { STUDY_STT_LANGUAGES } from '@shared/sttModels';
import {
  audioBlobToWhisperWav,
  cancelLocalWhisper,
  isLocalWhisperModelReady,
  transcribeLocalWhisperDetailed,
} from '../lib/stt/localWhisper';
import { announceStudyWorkspaceChanged } from '../components/StudySidebar';
import { Icon, Spinner } from '../components/ui';
import { t, getActiveLang } from '../i18n';
import { AudioPanel } from '../components/AudioPanel';
import { ConfirmModal } from '../components/ConfirmModal';

type CaptureState = 'idle' | 'recording' | 'paused' | 'saving';

const STATUS_LABELS: Record<StudyRecordingStatus, string> = {
  pending: 'Pendiente de transcribir', transcribing: 'Transcribiendo', ready: 'Transcrita', cancelled: 'Pausada', error: 'Con error',
};
const TRANSCRIPT_LABELS: Record<StudyTranscriptKind, string> = { literal: 'Literal', corrected: 'Corregida', notes: 'Apuntes' };

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function bestRecorderMime(): string {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((mime) => MediaRecorder.isTypeSupported(mime)) ?? '';
}

function recordingName(): string {
  return `${t('Clase')} ${new Intl.DateTimeFormat(getActiveLang(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`;
}

async function blobDuration(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<number>((resolve) => {
      const audio = new Audio();
      const done = (value: number) => resolve(Number.isFinite(value) ? value : 0);
      audio.onloadedmetadata = () => done(audio.duration);
      audio.onerror = () => done(0);
      audio.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function RecordingPlayer({ detail, onTime }: { detail: StudyRecordingDetail; onTime: (audio: HTMLAudioElement | null) => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    let active = true; let current = '';
    void window.nodus.getStudyRecordingContent(detail.id).then((content) => {
      if (!active) return;
      current = URL.createObjectURL(new Blob([content.bytes.slice().buffer as ArrayBuffer], { type: content.mimeType }));
      setUrl(current); setError('');
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    return () => { active = false; if (current) URL.revokeObjectURL(current); onTime(null); };
  }, [detail.id]);
  if (error) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">{error}</div>;
  if (!url) return <div className="flex h-20 items-center justify-center"><Spinner /></div>;
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/60" data-testid="study-recording-player">
      <audio ref={(node) => { audioRef.current = node; onTime(node); }} className="w-full" controls preload="metadata" src={url} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost h-7 px-2 text-xs" onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10); }}>−10 s</button>
        <button className="btn btn-ghost h-7 px-2 text-xs" onClick={() => { if (audioRef.current) audioRef.current.currentTime += 10; }}>+10 s</button>
        <label className="ml-auto flex items-center gap-1 text-[10px] text-neutral-500">{t('Velocidad')}
          <select className="input h-7 w-20 py-0 text-xs" defaultValue="1" onChange={(event) => { if (audioRef.current) audioRef.current.playbackRate = Number(event.target.value); }}>
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[10px] text-neutral-500">{t('Volumen')}
          <input className="w-20 accent-teal-500" type="range" min="0" max="1" step="0.05" defaultValue="1" onChange={(event) => { if (audioRef.current) audioRef.current.volume = Number(event.target.value); }} />
        </label>
      </div>
    </div>
  );
}

interface RecordingNoteLocation {
  courseId: string;
  subjectId: string;
  folderId: string;
  topicId: string;
}

function RecordingNoteDialog({ recording, transcriptId, workspace, onCreated, onCancel }: {
  recording: StudyRecordingDetail;
  transcriptId: string;
  workspace: StudyWorkspace;
  onCreated: (documentId: string) => void;
  onCancel: () => void;
}) {
  const [locations, setLocations] = useState<RecordingNoteLocation[]>([{
    courseId: recording.courseId ?? '', subjectId: recording.subjectId ?? '', folderId: '', topicId: recording.topicId ?? '',
  }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const updateLocation = (index: number, patch: Partial<RecordingNoteLocation>) => setLocations((current) => current.map((location, locationIndex) => locationIndex === index ? { ...location, ...patch } : location));
  const validLocations = locations.filter((location) => location.subjectId || location.folderId || location.topicId);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validLocations.length || busy) return;
    setBusy(true); setError('');
    try {
      const result = await window.nodus.createStudyNoteFromTranscript(recording.id, transcriptId, validLocations as StudyPlacementInput[]);
      onCreated(result.documentId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  };
  return createPortal(<div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/65 p-6" onClick={() => { if (!busy) onCancel(); }}>
    <form className="card-modal max-h-[88vh] w-full max-w-2xl overflow-y-auto p-5" role="dialog" aria-modal="true" aria-label={t('Crear apunte de la grabación')} data-testid="study-recording-note-dialog" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start gap-3"><div><h2 className="text-base font-semibold">{t('Crear apunte de la grabación')}</h2><p className="mt-1 text-xs text-neutral-500">{t('Elige una o varias ubicaciones. El apunte aparecerá en Apuntes y materiales dentro de cada sección.')}</p></div><button type="button" className="btn btn-ghost ml-auto px-2" onClick={onCancel} aria-label={t('Cerrar')}><Icon name="x" /></button></div>
      <div className="mt-4 space-y-3">{locations.map((location, index) => {
        const subjects = workspace.subjects.filter((subject) => !location.courseId || subject.courseId === location.courseId);
        const folders = workspace.folders.filter((folder) => !location.subjectId || folder.subjectId === location.subjectId);
        const topics = workspace.topics.filter((topic) => !location.subjectId || topic.subjectId === location.subjectId).filter((topic) => location.folderId ? topic.folderId === location.folderId : true);
        return <div key={index} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40" data-testid="study-recording-note-location">
          <div className="grid gap-2 sm:grid-cols-2">
            <select aria-label={t('Curso')} className="input w-full text-xs" value={location.courseId} onChange={(event) => updateLocation(index, { courseId: event.target.value, subjectId: '', folderId: '', topicId: '' })}><option value="">{t('Sin curso')}</option>{workspace.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select>
            <select aria-label={t('Asignatura')} className="input w-full text-xs" value={location.subjectId} onChange={(event) => updateLocation(index, { subjectId: event.target.value, folderId: '', topicId: '' })}><option value="">{t('Sin asignatura')}</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>
            <select aria-label={t('Carpeta')} className="input w-full text-xs" value={location.folderId} disabled={!location.subjectId} onChange={(event) => updateLocation(index, { folderId: event.target.value, topicId: '' })}><option value="">{t('Sin carpeta')}</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
            <select aria-label={t('Tema')} className="input w-full text-xs" value={location.topicId} disabled={!location.subjectId} onChange={(event) => updateLocation(index, { topicId: event.target.value })}><option value="">{t('Sin tema')}</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select>
          </div>
          {locations.length > 1 && <button type="button" className="mt-2 text-[11px] text-red-500" onClick={() => setLocations((current) => current.filter((_, locationIndex) => locationIndex !== index))}>{t('Quitar ubicación')}</button>}
        </div>;
      })}</div>
      <button type="button" className="btn btn-ghost mt-3 text-xs" onClick={() => setLocations((current) => [...current, { courseId: '', subjectId: '', folderId: '', topicId: '' }])}><Icon name="plus" size={12} />{t('Añadir ubicación')}</button>
      {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={busy || !validLocations.length}>{busy ? t('Creando…') : t('Crear apunte')}</button></div>
    </form>
  </div>, document.body);
}

function recordingScopeName(recording: StudyRecordingSummary, workspace: StudyWorkspace | null, kind: 'course' | 'subject' | 'topic'): string {
  if (!workspace) return '—';
  const id = kind === 'course' ? recording.courseId : kind === 'subject' ? recording.subjectId : recording.topicId;
  if (!id) return '—';
  const items = kind === 'course' ? workspace.courses : kind === 'subject' ? workspace.subjects : workspace.topics;
  return items.find((item) => item.id === id)?.name ?? '—';
}

export function StudyRecordingsView({ onOpenDocument, initialRecordingId, initialTimestamp }: { onOpenDocument: (id: string) => void; initialRecordingId?: string | null; initialTimestamp?: number | null }) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [recordings, setRecordings] = useState<StudyRecordingSummary[]>([]);
  const [selected, setSelected] = useState<StudyRecordingDetail | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StudyRecordingStatus | 'all'>('all');
  const [courseId, setCourseId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [captureState, setCaptureState] = useState<CaptureState>('idle');
  const [captureSeconds, setCaptureSeconds] = useState(0);
  const [captureLevel, setCaptureLevel] = useState(0);
  const [trimSilence, setTrimSilence] = useState(true);
  const [processProgress, setProcessProgress] = useState(0);
  const [processError, setProcessError] = useState('');
  const [processPartial, setProcessPartial] = useState('');
  const [transcriptionLanguage, setTranscriptionLanguage] = useState('auto');
  const [activeTranscriptKind, setActiveTranscriptKind] = useState<StudyTranscriptKind>('literal');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [noteTranscriptId, setNoteTranscriptId] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const silenceSinceRef = useRef<number | null>(null);
  const autoPausedRef = useRef(false);
  const manuallyPausedRef = useRef(false);
  const cancelledRef = useRef(false);
  const initialSeekConsumedRef = useRef(false);

  const reload = useCallback(async () => {
    const [nextWorkspace, nextRecordings] = await Promise.all([
      window.nodus.getStudyWorkspace(),
      window.nodus.listStudyRecordings({ search, status, courseId: courseId || undefined, subjectId: subjectId || undefined, topicId: topicId || undefined }),
    ]);
    setWorkspace(nextWorkspace); setRecordings(nextRecordings);
  }, [search, status, courseId, subjectId, topicId]);

  const open = useCallback(async (id: string) => {
    const detail = await window.nodus.getStudyRecording(id);
    const initialTranscript = detail.transcripts.find((entry) => entry.kind === 'literal') ?? detail.transcripts[0] ?? null;
    setSelected(detail); setNoteTranscriptId(null);
    setActiveTranscriptKind(initialTranscript?.kind ?? 'literal');
    setDraft(initialTranscript?.contentMarkdown ?? '');
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (initialRecordingId) { initialSeekConsumedRef.current = false; void open(initialRecordingId); } }, [initialRecordingId, open]);
  useEffect(() => {
    if (!selected) return;
    const transcript = selected.transcripts.find((entry) => entry.kind === activeTranscriptKind);
    setDraft(transcript?.contentMarkdown ?? '');
  }, [selected, activeTranscriptKind]);
  useEffect(() => { if (selected) setTranscriptionLanguage(selected.language || 'auto'); }, [selected?.id]);
  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void contextRef.current?.close();
    cancelLocalWhisper();
  }, []);

  const subjects = useMemo(() => workspace?.subjects.filter((subject) => !courseId || subject.courseId === courseId) ?? [], [workspace, courseId]);
  const topics = useMemo(() => workspace?.topics.filter((topic) => !subjectId || topic.subjectId === subjectId) ?? [], [workspace, subjectId]);
  const storageBytes = recordings.reduce((sum, recording) => sum + recording.sizeBytes, 0);
  const latestTranscript = (kind: StudyTranscriptKind) => selected?.transcripts.find((entry) => entry.kind === kind) ?? null;

  const cleanupCapture = async () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null; recorderRef.current = null; setCaptureLevel(0);
    if (contextRef.current) await contextRef.current.close().catch(() => undefined);
    contextRef.current = null; silenceSinceRef.current = null; autoPausedRef.current = false; manuallyPausedRef.current = false;
  };

  const startLevelMeter = (stream: MediaStream) => {
    const context = new AudioContext(); contextRef.current = context;
    const analyser = context.createAnalyser(); analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const values = new Uint8Array(analyser.fftSize);
    const frame = () => {
      analyser.getByteTimeDomainData(values);
      let sum = 0;
      for (const value of values) { const centered = (value - 128) / 128; sum += centered * centered; }
      const rms = Math.sqrt(sum / values.length); setCaptureLevel(Math.min(1, rms * 7));
      const recorder = recorderRef.current;
      if (trimSilence && recorder && !manuallyPausedRef.current) {
        if (rms < 0.014) silenceSinceRef.current ??= performance.now(); else silenceSinceRef.current = null;
        if (!autoPausedRef.current && silenceSinceRef.current && performance.now() - silenceSinceRef.current > 1800 && recorder.state === 'recording') {
          recorder.pause(); autoPausedRef.current = true;
        } else if (autoPausedRef.current && rms >= 0.02 && recorder.state === 'paused') {
          recorder.resume(); autoPausedRef.current = false; silenceSinceRef.current = null;
        }
      }
      animationRef.current = requestAnimationFrame(frame);
    };
    frame();
  };

  const startRecording = async () => {
    setProcessError(''); setCaptureSeconds(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true } });
      streamRef.current = stream;
      const mime = bestRecorderMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = recorder; chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.start(1000); setCaptureState('recording'); startLevelMeter(stream);
      timerRef.current = window.setInterval(() => setCaptureSeconds((value) => value + (recorder.state === 'recording' ? 1 : 0)), 1000);
    } catch (cause) {
      setProcessError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const toggleCapturePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (captureState === 'recording') { recorder.pause(); manuallyPausedRef.current = true; setCaptureState('paused'); }
    else { recorder.resume(); manuallyPausedRef.current = false; autoPausedRef.current = false; setCaptureState('recording'); }
  };

  const finishRecording = async (discard = false) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    setCaptureState('saving');
    const blob = await new Promise<Blob>((resolve) => {
      recorder.addEventListener('stop', () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })), { once: true });
      recorder.requestData(); recorder.stop();
    });
    await cleanupCapture();
    if (discard) { setCaptureState('idle'); setCaptureSeconds(0); return; }
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const result = await window.nodus.createStudyRecording({
        title: recordingName(), fileName: `clase-${Date.now()}.${blob.type.includes('ogg') ? 'ogg' : 'webm'}`,
        mimeType: blob.type || 'audio/webm', bytes, durationSeconds: await blobDuration(blob), language: 'auto',
        courseId: courseId || null, subjectId: subjectId || null, topicId: topicId || null,
      });
      await reload(); await open(result.recording.id);
    } catch (cause) { setProcessError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setCaptureState('idle'); setCaptureSeconds(0); }
  };

  const importAudio = async () => {
    setBusy(true); setProcessError(''); setProcessProgress(0);
    try {
      const results = await window.nodus.importStudyRecordings({ courseId: courseId || null, subjectId: subjectId || null, topicId: topicId || null, language: 'auto' });
      await reload(); if (results[0]) await open(results[0].recording.id);
    } catch (cause) { setProcessError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const transcribe = async () => {
    if (!selected) return;
    cancelledRef.current = false; setProcessError(''); setProcessPartial(''); setProcessProgress(0.01); setBusy(true);
    await window.nodus.updateStudyRecording(selected.id, { processingStatus: 'transcribing', processingProgress: 0.01 });
    try {
      const [content, settings] = await Promise.all([window.nodus.getStudyRecordingContent(selected.id), window.nodus.getSettings()]);
      const blob = new Blob([content.bytes.slice().buffer as ArrayBuffer], { type: content.mimeType });
      let text = ''; const provider = settings.sttProvider; let model = '';
      let chunks: Array<{ text: string; timestamp: [number | null, number | null] | null }> = [];
      if (provider === 'transformers') {
        model = settings.sttTransformersModel;
        if (!isLocalWhisperModelReady(model)) throw new Error(t('Descarga el modelo ONNX seleccionado desde Ajustes antes de transcribir.'));
        const result = await transcribeLocalWhisperDetailed(blob, model, transcriptionLanguage, setProcessProgress, setProcessPartial);
        text = result.text; chunks = result.chunks;
      } else {
        model = provider === 'whisper_cpp' ? settings.sttWhisperCppModel : settings.transcriptionModel?.provider === 'openai' ? settings.transcriptionModel.model : '';
        const audioBytes = provider === 'whisper_cpp' ? await audioBlobToWhisperWav(blob) : content.bytes;
        const result = await window.nodus.transcribeStudyAudio({ audioBytes, mimeType: provider === 'whisper_cpp' ? 'audio/wav' : content.mimeType, provider, model, language: transcriptionLanguage }, { onProgress: setProcessProgress, onPartial: setProcessPartial });
        text = result.text; model = result.model; chunks = result.chunks ?? [];
      }
      if (cancelledRef.current) return;
      if (!text.trim()) throw new Error(t('Whisper no devolvió texto para esta grabación.'));
      const segments = normalizeStudyTranscriptSegments(chunks, text, selected.durationSeconds);
      await window.nodus.saveStudyTranscript(selected.id, {
        kind: 'literal', contentMarkdown: text.trim(), language: transcriptionLanguage, modelProvider: provider, modelName: model,
        status: 'ready', progress: 1, segments,
      });
      await window.nodus.updateStudyRecording(selected.id, { language: transcriptionLanguage });
      setProcessProgress(1); setProcessPartial(''); await reload(); await open(selected.id); setActiveTranscriptKind('literal');
    } catch (cause) {
      if (!cancelledRef.current) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setProcessError(message);
        await window.nodus.updateStudyRecording(selected.id, { processingStatus: 'error', processingProgress: processProgress });
      }
    } finally { setBusy(false); }
  };

  const cancelTranscription = async () => {
    if (!selected) return;
    cancelledRef.current = true; cancelLocalWhisper(); await window.nodus.cancelStudyTranscription(); setBusy(false); setProcessPartial('');
    await window.nodus.updateStudyRecording(selected.id, { processingStatus: 'cancelled', processingProgress: processProgress });
    await reload(); await open(selected.id);
  };

  const addMarker = async () => {
    if (!selected) return;
    const time = audioRef.current?.currentTime ?? 0;
    await window.nodus.createStudyAudioMarker(selected.id, { tSeconds: time, label: `${t('Marca')} ${formatStudyTimestamp(time)}` });
    await open(selected.id);
  };

  const saveTranscript = async () => {
    const transcript = latestTranscript(activeTranscriptKind);
    if (!transcript) return;
    setBusy(true);
    try { await window.nodus.updateStudyTranscript(transcript.id, draft); await open(selected!.id); }
    finally { setBusy(false); }
  };

  const generateDerivedTranscript = async (kind: 'corrected' | 'notes') => {
    if (!selected) return;
    const literal = latestTranscript('literal');
    if (!literal) return;
    setBusy(true); setProcessError(''); setProcessProgress(0);
    try {
      const corrected = latestTranscript('corrected')?.contentMarkdown || correctedStudyTranscript(literal.contentMarkdown);
      await window.nodus.saveStudyTranscript(selected.id, {
        kind,
        contentMarkdown: kind === 'corrected' ? corrected : structuredStudyNotes(selected.title, corrected),
        language: literal.language,
        modelProvider: 'local',
        modelName: kind === 'corrected' ? 'normalización segura' : 'estructura determinista',
        status: 'ready', progress: 1, sourceTranscriptId: literal.id,
        segments: literal.segments,
      });
      await open(selected.id); setActiveTranscriptKind(kind);
    } catch (cause) { setProcessError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const jumpTo = (seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds; void audioRef.current.play();
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6" data-testid="study-recordings-view">
      <header className="mx-auto mb-5 flex max-w-7xl flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-teal-400">{t('Audio local')}</p><h1 className="text-2xl font-semibold">{t('Grabaciones y transcripciones')}</h1>
          <p className="mt-1 text-sm text-neutral-500">{t('El audio y Whisper local permanecen en este vault. Los audios grandes no se incluyen en sincronización.')}</p></div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => void importAudio()} disabled={busy}><Icon name="upload" />{t('Subir audio')}</button>
          {captureState === 'idle' ? <button className="btn btn-primary" onClick={() => void startRecording()}><Icon name="microphone" />{t('Grabar clase')}</button> : null}
        </div>
      </header>

      <section className="mx-auto mb-4 max-w-7xl rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/35">
        <div className="grid gap-2 md:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
          <div className="relative"><Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" /><input className="input input-with-leading-icon w-full" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar grabaciones o transcripciones…')} /></div>
          <select className="input" value={status} onChange={(event) => setStatus(event.target.value as StudyRecordingStatus | 'all')}><option value="all">{t('Todos los estados')}</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select>
          <select className="input" value={courseId} onChange={(event) => { setCourseId(event.target.value); setSubjectId(''); setTopicId(''); }}><option value="">{t('Todos los cursos')}</option>{workspace?.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select>
          <select className="input" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(''); }}><option value="">{t('Todas las asignaturas')}</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>
          <select className="input" value={topicId} onChange={(event) => setTopicId(event.target.value)}><option value="">{t('Todos los temas')}</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select>
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-600"><span>{recordings.length} {t('grabaciones')} · {bytesLabel(storageBytes)}</span><span>{t('Aviso al alcanzar 2 GB; puedes borrar el audio y conservar la transcripción.')}</span></div>
      </section>

      {captureState !== 'idle' && (
        <section className="mx-auto mb-4 max-w-7xl rounded-xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-800/60 dark:bg-teal-950/20" data-testid="study-class-recorder">
          <div className="flex flex-wrap items-center gap-3"><span className={`h-3 w-3 rounded-full ${captureState === 'recording' ? 'animate-pulse bg-red-500' : 'bg-amber-400'}`} /><strong>{formatStudyTimestamp(captureSeconds)}</strong>
            <div className="h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-teal-500 transition-[width] dark:bg-teal-400" style={{ width: `${captureLevel * 100}%` }} /></div>
            <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={trimSilence} onChange={(event) => setTrimSilence(event.target.checked)} />{t('Omitir silencios largos')}</label>
            {captureState !== 'saving' && <button className="btn btn-secondary" onClick={toggleCapturePause}><Icon name={captureState === 'paused' ? 'play' : 'pause'} />{captureState === 'paused' ? t('Reanudar') : t('Pausar')}</button>}
            <button className="btn btn-primary" disabled={captureState === 'saving'} onClick={() => void finishRecording()}><Icon name="stop" />{t('Guardar')}</button>
            <button className="btn btn-ghost" disabled={captureState === 'saving'} onClick={() => void finishRecording(true)}>{t('Descartar')}</button>
          </div>
        </section>
      )}

      {processError && <div className="mx-auto mb-4 max-w-7xl rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">{processError}</div>}

      <section className="mx-auto max-w-7xl overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950/35">
        {recordings.length ? <table className="w-full min-w-[1050px] border-collapse text-xs" data-testid="study-recordings-table">
          <thead className="bg-neutral-50 dark:bg-neutral-950"><tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800"><th className="w-[300px] px-4 py-2 font-medium">{t('Grabación')}</th><th className="px-3 py-2 font-medium">{t('Curso')}</th><th className="px-3 py-2 font-medium">{t('Asignatura')}</th><th className="px-3 py-2 font-medium">{t('Tema')}</th><th className="px-3 py-2 font-medium">{t('Fecha')}</th><th className="px-3 py-2 font-medium">{t('Duración')}</th><th className="px-3 py-2 font-medium">{t('Estado')}</th><th className="px-3 py-2 font-medium">{t('Tamaño')}</th><th className="px-3 py-2 text-right font-medium">{t('Acciones')}</th></tr></thead>
          <tbody>{recordings.map((recording) => <tr key={recording.id} data-testid={`study-recording-${recording.id}`} data-recording-row="" className="cursor-pointer border-b border-neutral-200/70 hover:bg-neutral-50 dark:border-neutral-800/60 dark:hover:bg-neutral-900/40" onClick={() => void open(recording.id)}>
            <td className="px-4 py-2.5"><div className="flex max-w-[290px] items-center gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300"><Icon name="microphone" size={15} /></span><span className="min-w-0"><span className="block truncate font-medium">{recording.title}</span><span className="block truncate text-[10px] text-neutral-500">{recording.fileName}</span>{recording.processingStatus === 'transcribing' && <span className="mt-1 block h-1 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800"><span className="block h-full bg-teal-500" style={{ width: `${recording.processingProgress * 100}%` }} /></span>}</span></div></td>
            <td className="max-w-[130px] truncate px-3 py-2.5 text-neutral-500">{recordingScopeName(recording, workspace, 'course')}</td><td className="max-w-[140px] truncate px-3 py-2.5 text-neutral-500">{recordingScopeName(recording, workspace, 'subject')}</td><td className="max-w-[130px] truncate px-3 py-2.5 text-neutral-500">{recordingScopeName(recording, workspace, 'topic')}</td><td className="whitespace-nowrap px-3 py-2.5 text-neutral-500">{new Intl.DateTimeFormat(getActiveLang(), { dateStyle: 'short' }).format(new Date(recording.createdAt))}</td><td className="px-3 py-2.5 text-neutral-500">{formatStudyTimestamp(recording.durationSeconds)}</td><td className="px-3 py-2.5"><span className="rounded-full border border-neutral-300 px-2 py-1 text-[10px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">{t(STATUS_LABELS[recording.processingStatus])}</span></td><td className="px-3 py-2.5 text-neutral-500">{bytesLabel(recording.sizeBytes)}</td>
            <td className="px-3 py-2.5"><div className="flex justify-end gap-1"><button className="btn btn-ghost h-7 px-2" title={t(recording.favorite ? 'Quitar de favoritos' : 'Marcar como favorito')} onClick={(event) => { event.stopPropagation(); void window.nodus.updateStudyRecording(recording.id, { favorite: !recording.favorite }).then(reload); }}><Icon name="star" size={12} className={recording.favorite ? 'text-amber-400' : 'text-neutral-500'} /></button><button data-testid={`study-recording-trash-${recording.id}`} className="btn btn-ghost h-7 px-2 text-red-400" title={t('Mover a la papelera')} onClick={(event) => { event.stopPropagation(); setConfirmDelete({ id: recording.id, title: recording.title }); }}><Icon name="trash" size={12} /></button></div></td>
          </tr>)}</tbody>
        </table> : <div className="p-12 text-center text-sm text-neutral-500">{t('Aún no hay grabaciones. Sube un audio o graba una clase.')}</div>}
      </section>

      {selected && createPortal(<div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/65 p-4 md:p-6" onClick={() => setSelected(null)}>
            <section className="card-modal max-h-[92vh] w-full max-w-6xl space-y-3 overflow-y-auto p-4" data-testid="study-recording-detail" role="dialog" aria-modal="true" aria-label={selected.title} onClick={(event) => event.stopPropagation()}>
              <div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><input className="input w-full text-base font-semibold" value={selected.title} onChange={(event) => setSelected({ ...selected, title: event.target.value })} onBlur={() => void window.nodus.updateStudyRecording(selected.id, { title: selected.title }).then(() => reload())} /><p className="mt-1 text-[10px] text-neutral-600">{selected.fileName} · {selected.mimeType}</p></div>
                <button className="btn btn-ghost" title={t('Favorita')} onClick={() => void window.nodus.updateStudyRecording(selected.id, { favorite: !selected.favorite }).then(() => open(selected.id)).then(reload)}><Icon name="star" className={selected.favorite ? 'text-amber-400' : ''} /></button>
                <button data-testid="study-recording-detail-trash" className="btn btn-ghost text-red-400" title={t('Mover a la papelera')} onClick={() => setConfirmDelete({ id: selected.id, title: selected.title })}><Icon name="trash" /></button>
                <button className="btn btn-ghost px-2" title={t('Cerrar')} aria-label={t('Cerrar')} onClick={() => setSelected(null)}><Icon name="x" /></button>
              </div>

              <RecordingPlayer detail={selected} onTime={(audio) => { audioRef.current = audio; if (audio && initialTimestamp != null && !initialSeekConsumedRef.current) { audio.currentTime = initialTimestamp; initialSeekConsumedRef.current = true; } }} />
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn btn-secondary" onClick={() => void addMarker()}><Icon name="plus" />{t('Añadir marcador')}</button>
                <label className="flex items-center gap-2 text-xs text-neutral-500">{t('Idioma del audio')}<select data-testid="study-recording-language" className="input h-8" value={transcriptionLanguage} onChange={(event) => setTranscriptionLanguage(event.target.value)}>{STUDY_STT_LANGUAGES.map((entry) => <option key={entry.code} value={entry.code}>{t(entry.label)}</option>)}</select></label>
                {!busy && <button className="btn btn-primary" onClick={() => void transcribe()}><Icon name="microphone" />{selected.processingStatus === 'cancelled' ? t('Reanudar transcripción') : selected.transcripts.length ? t('Reprocesar con Whisper') : t('Transcribir con Whisper')}</button>}
                {busy && processProgress > 0 && <button className="btn btn-secondary" onClick={() => void cancelTranscription()}><Icon name="stop" />{t('Cancelar transcripción')}</button>}
                <button className="btn btn-ghost ml-auto text-red-400" disabled={!selected.sizeBytes} onClick={() => void window.nodus.deleteStudyRecordingAudio(selected.id).then(() => open(selected.id)).then(reload)}>{t('Borrar solo audio')}</button>
              </div>
              {busy && processProgress > 0 && <div className="rounded-lg border border-teal-200 bg-teal-50 p-2 dark:border-teal-900/50 dark:bg-teal-950/20"><div className="mb-1 flex justify-between text-[10px] text-teal-700 dark:text-teal-300"><span>{t('La transcripción se procesa en segundo plano')}</span><span>{Math.round(processProgress * 100)}%</span></div><div className="h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-teal-500 dark:bg-teal-400" style={{ width: `${processProgress * 100}%` }} /></div>{processPartial && <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-neutral-700 dark:text-neutral-300" data-testid="study-transcription-stream">{processPartial}</p>}</div>}

              {selected.markers.length > 0 && <div className="flex flex-wrap gap-2">{selected.markers.map((marker) => <div key={marker.id} className="flex items-center rounded-full border border-neutral-200 bg-white text-xs dark:border-neutral-700 dark:bg-neutral-950"><button className="px-3 py-1.5 text-teal-700 dark:text-teal-300" onClick={() => jumpTo(marker.tSeconds)}>{formatStudyTimestamp(marker.tSeconds)} · {marker.label}</button><button className="px-2 text-neutral-500 hover:text-red-600 dark:text-neutral-600 dark:hover:text-red-400" onClick={() => void window.nodus.deleteStudyAudioMarker(marker.id).then(() => open(selected.id))}>×</button></div>)}</div>}

              {selected.transcripts.length > 0 && (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950/35">
                  <div className="flex flex-wrap items-center gap-1 border-b border-neutral-200 p-2 dark:border-neutral-800">{(['literal', 'corrected', 'notes'] as const).filter((kind) => latestTranscript(kind)).map((kind) => <button key={kind} className={`rounded-md px-3 py-1.5 text-xs ${activeTranscriptKind === kind ? 'bg-teal-700 text-white' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-500 dark:hover:bg-neutral-800'}`} onClick={() => setActiveTranscriptKind(kind)}>{t(TRANSCRIPT_LABELS[kind])}</button>)}
                    {!latestTranscript('corrected') && latestTranscript('literal') && <button data-testid="study-recording-generate-corrected" className="btn btn-ghost h-7 px-2 text-xs" disabled={busy} onClick={() => void generateDerivedTranscript('corrected')}><Icon name="wand" size={12} />{t('Generar versión corregida')}</button>}
                    {!latestTranscript('notes') && latestTranscript('literal') && <button data-testid="study-recording-generate-notes" className="btn btn-ghost h-7 px-2 text-xs" disabled={busy} onClick={() => void generateDerivedTranscript('notes')}><Icon name="notebook" size={12} />{t('Generar apuntes')}</button>}
                    <button className="btn btn-ghost ml-auto h-7 px-2 text-xs" disabled={!latestTranscript(activeTranscriptKind)} onClick={() => void saveTranscript()}><Icon name="save" size={12} />{t('Guardar edición')}</button>
                    <button className="btn btn-ghost h-7 px-2 text-xs" disabled={!latestTranscript(activeTranscriptKind)} onClick={() => { const transcript = latestTranscript(activeTranscriptKind); if (transcript) setNoteTranscriptId(transcript.id); }}><Icon name="notebook" size={12} />{t('Crear apunte')}</button>
                    <button className="btn btn-ghost h-7 px-2 text-xs text-red-400" disabled={!latestTranscript(activeTranscriptKind)} onClick={() => { const transcript = latestTranscript(activeTranscriptKind); if (transcript) void window.nodus.deleteStudyTranscript(transcript.id).then(() => open(selected.id)); }}><Icon name="trash" size={12} /></button>
                  </div>
                  <textarea className="min-h-48 w-full resize-y bg-transparent p-3 text-sm leading-relaxed text-neutral-900 outline-none dark:text-neutral-100" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t('La transcripción aparecerá aquí…')} />
                  {latestTranscript(activeTranscriptKind) && <div className="border-t border-neutral-200 p-2 dark:border-neutral-800" data-testid="study-transcript-audio"><AudioPanel
                    entityKind="study_transcript"
                    entityId={latestTranscript(activeTranscriptKind)!.id}
                    sourceMarkdown={draft}
                    title={`${selected.title} · ${t(TRANSCRIPT_LABELS[activeTranscriptKind])}`}
                    subjectId={selected.subjectId}
                    localOnly
                    compact
                  /></div>}
                  {latestTranscript(activeTranscriptKind)?.segments.length ? <div className="max-h-72 space-y-1 overflow-y-auto border-t border-neutral-200 p-2 dark:border-neutral-800" data-testid="study-transcript-segments">{latestTranscript(activeTranscriptKind)!.segments.map((segment) => (
                    <div key={segment.id} className="grid gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800/80 md:grid-cols-[64px_100px_1fr]">
                      <button className="text-left text-xs font-medium text-teal-400" onClick={() => jumpTo(segment.tStart)}>{formatStudyTimestamp(segment.tStart)}</button>
                      <input className="input h-7 py-0 text-xs" defaultValue={segment.speaker} placeholder={t('Hablante')} onBlur={(event) => void window.nodus.updateStudyTranscriptSegment(segment.id, { speaker: event.target.value }).then(() => open(selected.id))} />
                      <textarea className="min-h-7 resize-y bg-transparent text-xs text-neutral-700 outline-none dark:text-neutral-300" defaultValue={segment.text} onBlur={(event) => { if (event.target.value !== segment.text) void window.nodus.updateStudyTranscriptSegment(segment.id, { text: event.target.value }).then(() => open(selected.id)); }} />
                    </div>
                  ))}</div> : null}
                </div>
              )}
              <p className="text-[10px] text-neutral-600">{t('El literal nunca se sobrescribe: cada reprocesado crea una versión nueva. Puedes borrar el audio y mantener texto, marcas y apuntes.')}</p>
            </section>
          </div>, document.body)}
      {selected && noteTranscriptId && workspace && <RecordingNoteDialog key={noteTranscriptId} recording={selected} transcriptId={noteTranscriptId} workspace={workspace} onCancel={() => setNoteTranscriptId(null)} onCreated={(documentId) => { setNoteTranscriptId(null); announceStudyWorkspaceChanged(); onOpenDocument(documentId); }} />}
      {confirmDelete && <ConfirmModal
        title={t('Mover grabación a la papelera')}
        message={t('La grabación «{name}» dejará de aparecer. Podrás recuperarla desde la administración de datos.').replace('{name}', confirmDelete.title)}
        confirmLabel={t('Mover a la papelera')}
        danger
        zIndex={170}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => void window.nodus.setStudyRecordingLifecycle(confirmDelete.id, 'trash').then(async () => {
          if (selected?.id === confirmDelete.id) setSelected(null);
          setConfirmDelete(null);
          await reload();
        })}
      />}
    </div>
  );
}
