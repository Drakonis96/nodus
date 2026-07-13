import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings } from '@shared/types';
import type { StudyDictationAction, StudySttProvider } from '@shared/sttModels';
import {
  STUDY_STT_MODELS,
  buildStudySttPrompt,
  getStudySttModel,
  recommendStudySttModel,
  transformStudyDictation,
} from '@shared/sttModels';
import { Icon, Spinner } from '../ui';
import { ModelPicker } from '../ModelPicker';
import { t } from '../../i18n';
import {
  ensureLocalWhisperModel,
  isLocalWhisperModelReady,
  localWhisperStorageBytes,
  removeLocalWhisperModel,
  transcribeLocalWhisper,
} from '../../lib/stt/localWhisper';
import {
  deleteStudyDictationClip,
  listStudyDictationClips,
  saveStudyDictationClip,
  type StudyDictationClip,
} from '../../lib/stt/clipStore';

type CaptureState = 'idle' | 'recording' | 'paused' | 'transcribing' | 'error';
type InsertScope = 'cursor' | 'selection';

function bestRecorderMime(): string {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((mime) => MediaRecorder.isTypeSupported(mime)) ?? '';
}

function AudioClipRow({ clip, onDelete, onReprocess }: {
  clip: StudyDictationClip;
  onDelete: () => void;
  onReprocess: () => void;
}) {
  const url = useMemo(() => URL.createObjectURL(clip.blob), [clip.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-2">
      <div className="flex items-center gap-2">
        <audio className="h-7 min-w-0 flex-1" controls preload="metadata" src={url} />
        <button className="btn btn-ghost h-7 px-2" title={t('Reprocesar con el modelo actual')} onClick={onReprocess}><Icon name="refresh" size={11} /></button>
        <button className="btn btn-ghost h-7 px-2 text-red-400" title={t('Eliminar audio local')} onClick={onDelete}><Icon name="trash" size={11} /></button>
      </div>
      <p className="mt-1 line-clamp-2 text-[10px] text-neutral-600">{clip.transcript}</p>
      <p className="mt-1 text-[9px] text-neutral-700">{clip.provider === 'local' ? t('Local') : 'OpenAI'} · {clip.model} · {new Date(clip.createdAt).toLocaleString()}</p>
    </div>
  );
}

export function StudyDictation({
  documentId,
  language,
  vocabulary,
  customDictionary,
  onInsert,
  onAction,
}: {
  documentId: string;
  language: string;
  vocabulary: string[];
  customDictionary: string[];
  onInsert: (text: string, scope: InsertScope) => { from: number; to: number } | void;
  onAction: (action: Exclude<StudyDictationAction, null>) => void;
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [state, setState] = useState<CaptureState>('idle');
  const [provider, setProvider] = useState<StudySttProvider>('local');
  const [model, setModel] = useState(() => recommendStudySttModel({
    memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    logicalCores: navigator.hardwareConcurrency,
  }).id);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [level, setLevel] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [provisional, setProvisional] = useState('');
  const [scope, setScope] = useState<InsertScope>('cursor');
  const [autoStop, setAutoStop] = useState(true);
  const [silenceSeconds, setSilenceSeconds] = useState(3);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [removeFillers, setRemoveFillers] = useState(false);
  const [preserveAudio, setPreserveAudio] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [clips, setClips] = useState<StudyDictationClip[]>([]);
  const [modelBytes, setModelBytes] = useState<Record<string, number>>({});
  const [downloading, setDownloading] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const previewTimerRef = useRef<number | null>(null);
  const previewBusyRef = useRef(false);
  const animationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const stateRef = useRef<CaptureState>('idle');
  const silenceSinceRef = useRef<number | null>(null);
  const silenceStoppingRef = useRef(false);
  const configRef = useRef({ autoStop, silenceSeconds, provider, model, language, removeFillers });
  configRef.current = { autoStop, silenceSeconds, provider, model, language, removeFillers };
  stateRef.current = state;

  const prompt = useMemo(() => buildStudySttPrompt([...customDictionary, ...vocabulary]), [customDictionary, vocabulary]);

  const reloadClips = async () => setClips(await listStudyDictationClips(documentId));
  const refreshDevices = async () => {
    const listed = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput');
    setDevices(listed);
    if (!deviceId && listed[0]) setDeviceId(listed[0].deviceId);
  };
  const refreshModelStorage = async () => {
    const entries = await Promise.all(STUDY_STT_MODELS.map(async (entry) => [entry.id, await localWhisperStorageBytes(entry.id)] as const));
    setModelBytes(Object.fromEntries(entries));
  };

  useEffect(() => {
    void window.nodus.getSettings().then((next) => { setSettings(next); setProvider(next.sttProvider); });
    void reloadClips();
    void refreshDevices().catch(() => undefined);
    return () => {
      if (previewTimerRef.current) window.clearInterval(previewTimerRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void audioContextRef.current?.close();
    };
  }, [documentId]);

  const setBackend = async (next: StudySttProvider) => {
    setProvider(next);
    const updated = await window.nodus.updateSettings({ sttProvider: next });
    setSettings(updated);
  };

  const cleanupCapture = async () => {
    if (previewTimerRef.current) window.clearInterval(previewTimerRef.current);
    previewTimerRef.current = null;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setLevel(0);
    silenceSinceRef.current = null;
    silenceStoppingRef.current = false;
    if (audioContextRef.current) await audioContextRef.current.close().catch(() => undefined);
    audioContextRef.current = null;
  };

  const transcribe = async (blob: Blob, insert: boolean, existingClip?: StudyDictationClip) => {
    setState('transcribing');
    setProgress(0);
    setError('');
    try {
      let rawText = '';
      let usedModel = model;
      if (provider === 'local') {
        if (!isLocalWhisperModelReady(model)) await ensureLocalWhisperModel(model, setProgress);
        rawText = await transcribeLocalWhisper(blob, model, language, setProgress);
      } else {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const result = await window.nodus.transcribeStudyAudio({
          audioBytes: bytes,
          mimeType: blob.type || 'audio/webm',
          model: settings?.transcriptionModel?.provider === 'openai' ? settings.transcriptionModel.model : null,
          language,
          prompt,
        });
        rawText = result.text;
        usedModel = result.model;
      }
      const transformed = transformStudyDictation(rawText, { removeFillers, customDictionary });
      setProvisional(transformed.text);
      let anchor: { from: number; to: number } | undefined;
      if (transformed.action) onAction(transformed.action);
      else if (insert && transformed.text) {
        const inserted = onInsert(transformed.text, scope);
        if (inserted) anchor = inserted;
      }
      if (preserveAudio || existingClip) {
        const clip: StudyDictationClip = existingClip ? { ...existingClip, provider, model: usedModel, transcript: transformed.text } : {
          id: crypto.randomUUID(), documentId, createdAt: new Date().toISOString(), mimeType: blob.type || 'audio/webm',
          provider, model: usedModel, transcript: transformed.text, anchorText: transformed.text,
          anchorFrom: anchor?.from ?? null, anchorTo: anchor?.to ?? null, blob,
        };
        await saveStudyDictationClip(clip);
        await reloadClips();
      }
      setProgress(1);
      setState('idle');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState('error');
    }
  };

  const finishRecording = async (discard = false) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive' || silenceStoppingRef.current) return;
    silenceStoppingRef.current = true;
    if (!discard) setState('transcribing');
    const blob = await new Promise<Blob>((resolve) => {
      recorder.addEventListener('stop', () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })), { once: true });
      recorder.requestData();
      recorder.stop();
    });
    await cleanupCapture();
    if (discard) { setProvisional(''); setState('idle'); return; }
    await transcribe(blob, true);
  };

  const startLevelMeter = (stream: MediaStream) => {
    const context = new AudioContext();
    audioContextRef.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const values = new Uint8Array(analyser.fftSize);
    const frame = () => {
      analyser.getByteTimeDomainData(values);
      let sum = 0;
      for (const value of values) { const centered = (value - 128) / 128; sum += centered * centered; }
      const rms = Math.sqrt(sum / values.length);
      setLevel(Math.min(1, rms * 7));
      if (stateRef.current === 'recording' && configRef.current.autoStop) {
        if (rms < 0.018) silenceSinceRef.current ??= performance.now();
        else silenceSinceRef.current = null;
        if (silenceSinceRef.current && performance.now() - silenceSinceRef.current >= configRef.current.silenceSeconds * 1000) void finishRecording();
      }
      animationRef.current = requestAnimationFrame(frame);
    };
    frame();
  };

  const startRecording = async () => {
    setError(''); setProvisional(''); silenceStoppingRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        noiseSuppression,
        echoCancellation: noiseSuppression,
        autoGainControl: true,
      } });
      streamRef.current = stream;
      await refreshDevices();
      const mimeType = bestRecorderMime();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.start(1000);
      setState('recording');
      startLevelMeter(stream);
      previewTimerRef.current = window.setInterval(() => {
        const current = configRef.current;
        if (current.provider !== 'local' || !isLocalWhisperModelReady(current.model) || previewBusyRef.current || chunksRef.current.length < 4) return;
        previewBusyRef.current = true;
        const previewBlob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        void transcribeLocalWhisper(previewBlob, current.model, current.language)
          .then((text) => setProvisional(transformStudyDictation(text, { removeFillers: current.removeFillers, customDictionary }).text))
          .catch(() => undefined)
          .finally(() => { previewBusyRef.current = false; });
      }, 8000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState('error');
      await cleanupCapture();
    }
  };

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') { recorder.pause(); setState('paused'); }
    else if (recorder.state === 'paused') { recorder.resume(); setState('recording'); }
  };

  const downloadModel = async (id: string) => {
    setDownloading(id); setProgress(0); setError('');
    try { await ensureLocalWhisperModel(id, setProgress); await refreshModelStorage(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setDownloading(null); }
  };

  return (
    <div className="border-b border-neutral-800 bg-neutral-950/95 px-3 py-2" data-testid="study-dictation">
      <div className="flex flex-wrap items-center gap-2">
        {state === 'idle' || state === 'error' ? (
          <button data-testid="study-dictation-start" className="btn btn-primary h-8" onClick={() => void startRecording()}><span className="h-2.5 w-2.5 rounded-full bg-red-400" /> {t('Dictar')}</button>
        ) : state === 'transcribing' ? <Spinner label={t('Transcribiendo…')} /> : (
          <>
            <button className="btn btn-ghost h-8" onClick={togglePause}><Icon name={state === 'paused' ? 'play' : 'pause'} size={12} /> {t(state === 'paused' ? 'Reanudar' : 'Pausar')}</button>
            <button className="btn btn-primary h-8" onClick={() => void finishRecording()}><Icon name="stop" size={12} /> {t('Finalizar')}</button>
            <button data-testid="study-dictation-discard" className="btn btn-ghost h-8 text-red-400" onClick={() => void finishRecording(true)}><Icon name="x" size={12} /> {t('Descartar')}</button>
            <span className="flex h-5 w-24 items-end gap-px rounded bg-neutral-900 px-1 py-1" title={t('Nivel del micrófono')}>
              {Array.from({ length: 16 }, (_, index) => <span key={index} className={`w-1 rounded-sm ${index / 16 < level ? 'bg-emerald-400' : 'bg-neutral-800'}`} style={{ height: `${25 + (index % 5) * 18}%` }} />)}
            </span>
          </>
        )}
        <span className={`rounded-full px-2 py-1 text-[10px] ${provider === 'local' ? 'bg-emerald-900/30 text-emerald-300' : 'bg-sky-900/30 text-sky-300'}`}>
          {provider === 'local' ? `${t('Local y sin conexión')} · ${getStudySttModel(model).label}` : `OpenAI · ${settings?.transcriptionModel?.model ?? 'gpt-4o-transcribe'}`}
        </span>
        <select className="input h-8" value={scope} onChange={(event) => setScope(event.target.value as InsertScope)}>
          <option value="cursor">{t('Insertar en el cursor')}</option><option value="selection">{t('Sustituir selección/bloque')}</option>
        </select>
        <button className="btn btn-ghost ml-auto h-8 px-2" onClick={() => setShowSettings(!showSettings)}><Icon name="settings" size={12} /> {t('Dictado')}</button>
      </div>

      {(state === 'transcribing' || downloading) && <div className="mt-2 h-1 overflow-hidden rounded bg-neutral-800"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(4, progress * 100)}%` }} /></div>}
      {provisional && <div className="mt-2 flex items-start gap-2 rounded-lg border border-indigo-900/50 bg-indigo-950/20 px-3 py-2 text-xs text-indigo-200"><span className="min-w-0 flex-1"><span className="mr-2 text-[9px] uppercase text-indigo-500">{t('Texto provisional')}</span>{provisional}</span><button className="text-[10px] text-indigo-400" onClick={() => onInsert(provisional, scope)}>{t('Insertar')}</button></div>}
      {error && <p className="mt-2 rounded bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</p>}

      {showSettings && (
        <div className="mt-2 grid gap-3 rounded-xl border border-neutral-800 bg-neutral-900/30 p-3 lg:grid-cols-3">
          <div className="space-y-2">
            <label className="block text-[10px] text-neutral-500">{t('Motor de transcripción')}<select className="input mt-1 w-full" value={provider} onChange={(event) => void setBackend(event.target.value as StudySttProvider)}><option value="local">{t('Whisper local (offline)')}</option><option value="openai">OpenAI API</option></select></label>
            {provider === 'local' ? <label className="block text-[10px] text-neutral-500">{t('Modelo Whisper')}<select className="input mt-1 w-full" value={model} onChange={(event) => setModel(event.target.value)}>{STUDY_STT_MODELS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label} · ~{entry.sizeMb} MB</option>)}</select></label>
              : settings && <label className="block text-[10px] text-neutral-500">{t('Modelo externo')}<ModelPicker compact settings={settings} value={settings.transcriptionModel} emptyLabel="gpt-4o-transcribe (predeterminado)" onChange={(transcriptionModel) => void window.nodus.updateSettings({ transcriptionModel }).then(setSettings)} /></label>}
            <button className="text-[10px] text-indigo-400 hover:text-indigo-300" onClick={() => { setShowModels(!showModels); if (!showModels) void refreshModelStorage(); }}>{showModels ? t('Ocultar gestor de modelos') : t('Gestionar modelos locales')}</button>
          </div>
          <div className="space-y-2">
            <label className="block text-[10px] text-neutral-500">{t('Micrófono')}<select className="input mt-1 w-full" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${t('Micrófono')} ${index + 1}`}</option>)}</select></label>
            <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={noiseSuppression} onChange={(event) => setNoiseSuppression(event.target.checked)} />{t('Reducción de ruido y eco')}</label>
            <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={autoStop} onChange={(event) => setAutoStop(event.target.checked)} />{t('Parar tras silencio')}<input className="input h-7 w-16" type="number" min="1" max="15" value={silenceSeconds} onChange={(event) => setSilenceSeconds(Number(event.target.value))} />s</label>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={removeFillers} onChange={(event) => setRemoveFillers(event.target.checked)} />{t('Eliminar muletillas')}</label>
            <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={preserveAudio} onChange={(event) => setPreserveAudio(event.target.checked)} />{t('Conservar audio original local')}</label>
            <p className="text-[10px] leading-4 text-neutral-600">{t('El vocabulario del apunte y el diccionario personal se usan como contexto. Los audios se guardan solo en este dispositivo y se excluyen de sync y backups.')}</p>
          </div>

          {showModels && <div className="space-y-2 lg:col-span-3">{STUDY_STT_MODELS.map((entry) => {
            const ready = isLocalWhisperModelReady(entry.id);
            return <div key={entry.id} className="flex items-center gap-3 rounded-lg border border-neutral-800 px-3 py-2"><span className="min-w-0 flex-1"><span className="block text-xs text-neutral-300">{entry.label}</span><span className="text-[10px] text-neutral-600">{t(entry.speed)} · {t(entry.accuracy)} · ~{entry.ramMb} MB RAM · {modelBytes[entry.id] ? `${(modelBytes[entry.id] / 1024 / 1024).toFixed(0)} MB ${t('ocupados')}` : `~${entry.sizeMb} MB`}</span></span>{ready ? <button className="btn btn-ghost h-7 text-xs text-red-400" onClick={() => void removeLocalWhisperModel(entry.id).then(refreshModelStorage)}><Icon name="trash" size={11} /> {t('Eliminar')}</button> : <button disabled={downloading != null} className="btn btn-ghost h-7 text-xs" onClick={() => void downloadModel(entry.id)}><Icon name="download" size={11} /> {downloading === entry.id ? t('Descargando…') : t('Descargar')}</button>}</div>;
          })}</div>}

          {clips.length > 0 && <div className="space-y-2 lg:col-span-3"><h4 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Audios de dictado de este apunte')}</h4>{clips.map((clip) => <AudioClipRow key={clip.id} clip={clip} onDelete={() => void deleteStudyDictationClip(clip.id).then(reloadClips)} onReprocess={() => void transcribe(clip.blob, false, clip)} />)}</div>}
        </div>
      )}
    </div>
  );
}
