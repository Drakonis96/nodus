import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioClip, AudioEntityKind } from '@shared/types';
import { findVoice, getEngine } from '../lib/audio';
import type { AudioProvider } from '@shared/types';
import { t, tx } from '../i18n';

/**
 * Reusable narration panel for a Deep Research report or an immersion. It asks
 * the main process for the speakable segments (sections / stages), synthesises
 * each one locally in the renderer (Piper via WebAssembly), and hands the WAV
 * bytes back to be persisted. It shows live progress, plays clips back (one at a
 * time or the whole thing sequentially), and manages (deletes) them. Audio never
 * leaves the machine.
 */
interface RunProgress {
  done: number;
  total: number;
  label: string;
}

export function AudioPanel({
  entityKind,
  entityId,
  compact,
}: {
  entityKind: AudioEntityKind;
  entityId: string;
  compact?: boolean;
}) {
  const [clips, setClips] = useState<AudioClip[]>([]);
  const [run, setRun] = useState<RunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const autoplay = useRef(false);
  const cancelRef = useRef(false);
  const clipsDoneRef = useRef(0);
  const urlCache = useRef<Map<string, string>>(new Map());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mounted = useRef(true);

  const generating = run != null;

  const refreshClips = async () => {
    const list = await window.nodus.listAudioClips(entityKind, entityId);
    if (mounted.current) setClips(list);
  };

  const checkVoice = async (): Promise<{ provider: AudioProvider; voiceId: string } | null> => {
    const settings = await window.nodus.getSettings();
    setSpeed(settings.audioSpeed ?? 1);
    const provider = settings.audioProvider ?? 'piper';
    const chosen = settings.audioVoice;
    if (!chosen) {
      if (mounted.current) setVoiceReady(false);
      return null;
    }
    const ready = (await getEngine(provider).ready()).has(chosen);
    if (mounted.current) setVoiceReady(ready);
    return ready ? { provider, voiceId: chosen } : null;
  };

  useEffect(() => {
    mounted.current = true;
    void refreshClips();
    void checkVoice();
    return () => {
      mounted.current = false;
      cancelRef.current = true;
      for (const url of urlCache.current.values()) URL.revokeObjectURL(url);
      urlCache.current.clear();
    };
  }, [entityKind, entityId]);

  const totalDuration = useMemo(() => clips.reduce((acc, c) => acc + c.durationSec, 0), [clips]);

  const generate = async () => {
    setError(null);
    const chosen = await checkVoice();
    const voice = chosen ? findVoice(chosen.provider, chosen.voiceId) : undefined;
    if (!chosen || !voice) {
      setError(t('Elige y descarga una voz en Ajustes → IA → Audio y voz.'));
      return;
    }
    const engine = getEngine(chosen.provider);
    let segments;
    try {
      segments = await window.nodus.getAudioSegments(entityKind, entityId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!segments.length) {
      setError(t('No hay texto narrable en este contenido.'));
      return;
    }

    cancelRef.current = false;
    stop();
    await window.nodus.clearAudioClips(entityKind, entityId);
    for (const url of urlCache.current.values()) URL.revokeObjectURL(url);
    urlCache.current.clear();
    setClips([]);
    setRun({ done: 0, total: segments.length, label: t('Preparando…') });

    try {
      for (const segment of segments) {
        if (cancelRef.current) break;
        setRun({ done: clipsDoneRef.current, total: segments.length, label: segment.label });
        const bytes = await engine.synthesize(segment.text, chosen.voiceId);
        if (cancelRef.current) break;
        const clip = await window.nodus.saveAudioClip(entityKind, entityId, {
          segmentIndex: segment.index,
          segmentLabel: segment.label,
          provider: chosen.provider,
          voice: chosen.voiceId,
          language: voice.language,
          bytes,
        });
        clipsDoneRef.current += 1;
        if (mounted.current) setClips((prev) => [...prev, clip]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      clipsDoneRef.current = 0;
      if (mounted.current) setRun(null);
      await refreshClips();
    }
  };

  const cancel = () => {
    cancelRef.current = true;
  };

  const clipUrl = async (clip: AudioClip): Promise<string | null> => {
    const cached = urlCache.current.get(clip.id);
    if (cached) return cached;
    const dataUrl = await window.nodus.getAudioClipDataUrl(clip.id);
    if (!dataUrl) return null;
    const blob = await (await fetch(dataUrl)).blob();
    const url = URL.createObjectURL(blob);
    urlCache.current.set(clip.id, url);
    return url;
  };

  const playClip = async (clip: AudioClip, chain = false) => {
    if (clip.missing) return;
    const url = await clipUrl(clip);
    const el = audioRef.current;
    if (!url || !el) return;
    el.src = url;
    el.playbackRate = speed;
    // Preserve pitch when the user speeds up / slows down playback.
    (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    autoplay.current = chain;
    setPlayingId(clip.id);
    void el.play().catch(() => setPlayingId(null));
  };

  const playAll = async () => {
    const first = clips.find((c) => !c.missing);
    if (first) await playClip(first, true);
  };

  const onEnded = () => {
    if (!autoplay.current) {
      setPlayingId(null);
      return;
    }
    const idx = clips.findIndex((c) => c.id === playingId);
    const next = clips.slice(idx + 1).find((c) => !c.missing);
    if (next) void playClip(next, true);
    else setPlayingId(null);
  };

  const stop = () => {
    audioRef.current?.pause();
    autoplay.current = false;
    setPlayingId(null);
  };

  const deleteClip = async (id: string) => {
    await window.nodus.deleteAudioClip(id);
    const url = urlCache.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urlCache.current.delete(id);
    }
    await refreshClips();
  };

  const deleteAll = async () => {
    stop();
    await window.nodus.deleteEntityAudioClips(entityKind, entityId);
    for (const url of urlCache.current.values()) URL.revokeObjectURL(url);
    urlCache.current.clear();
    await refreshClips();
  };

  const hasClips = clips.length > 0;
  const anyMissing = clips.some((c) => c.missing);
  const pct = run && run.total > 0 ? Math.round((run.done / run.total) * 100) : 0;

  return (
    <div className={`rounded-lg border border-neutral-800 bg-neutral-900/40 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
          <span aria-hidden>🎧</span>
          {t('Audio')}
          {hasClips && !generating && (
            <span className="text-[11px] font-normal text-neutral-500">
              {tx('{n} pistas', { n: clips.length })} · {formatDuration(totalDuration)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasClips && !generating && (
            <>
              <button className="btn btn-ghost border border-neutral-700 text-xs" onClick={() => void playAll()}>
                ▶ {t('Reproducir todo')}
              </button>
              <button className="btn btn-ghost text-xs text-red-400" onClick={() => void deleteAll()}>
                {t('Eliminar audio')}
              </button>
            </>
          )}
          {generating ? (
            <button className="btn btn-ghost border border-neutral-700 text-xs" onClick={cancel}>
              {t('Cancelar')}
            </button>
          ) : (
            <button className="btn btn-primary text-xs" onClick={() => void generate()}>
              {hasClips ? t('Regenerar') : t('Generar audio')}
            </button>
          )}
        </div>
      </div>

      {voiceReady === false && !generating && (
        <div className="mt-2 text-xs text-amber-400/90">
          {t('Elige y descarga una voz en Ajustes → IA → Audio y voz para poder narrar.')}
        </div>
      )}

      {generating && run && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] text-neutral-400">
            <span className="truncate">{run.label}</span>
            <span className="shrink-0 font-mono">{Math.min(run.done + 1, run.total)}/{run.total}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-neutral-800">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(pct, 4)}%` }} />
          </div>
        </div>
      )}

      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}

      {anyMissing && !generating && (
        <div className="mt-2 text-[11px] text-neutral-500">
          {t('Faltan algunos archivos de audio (no se guardan en las copias de seguridad). Pulsa Regenerar para recuperarlos.')}
        </div>
      )}

      {hasClips && (
        <ul className="mt-3 space-y-1">
          {clips.map((clip) => {
            const isPlaying = playingId === clip.id;
            return (
              <li
                key={clip.id}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${isPlaying ? 'bg-indigo-950/40' : 'hover:bg-neutral-900/60'}`}
              >
                <button
                  className="shrink-0 text-neutral-300 disabled:text-neutral-600"
                  title={clip.missing ? t('Archivo no disponible') : isPlaying ? t('Detener') : t('Reproducir')}
                  disabled={clip.missing}
                  onClick={() => (isPlaying ? stop() : void playClip(clip))}
                >
                  {clip.missing ? '⚠' : isPlaying ? '⏸' : '▶'}
                </button>
                <span className="min-w-0 flex-1 truncate text-neutral-300" title={clip.segmentLabel}>
                  {clip.segmentLabel}
                </span>
                {clip.missing ? (
                  <span className="shrink-0 text-[10px] text-amber-500/80">{t('sin archivo')}</span>
                ) : (
                  <span className="shrink-0 font-mono text-[10px] text-neutral-500">{formatDuration(clip.durationSec)}</span>
                )}
                <button
                  className="shrink-0 text-neutral-600 hover:text-red-400"
                  title={t('Eliminar pista')}
                  onClick={() => void deleteClip(clip.id)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <audio ref={audioRef} onEnded={onEnded} className="hidden" />
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
