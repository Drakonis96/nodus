import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioClip, AudioEntityKind, AudioProvider } from '@shared/types';
import { findVoice, getEngine } from '../lib/audio';
import { synthesizeSegment } from '../lib/audio/synth';
import { useAudioPlayer, type PlayerTrack } from './AudioPlayer';
import { t, tx } from '../i18n';

/**
 * Reusable narration panel for a Deep Research report or an immersion. It asks
 * the main process for the speakable segments (sections / stages), synthesises
 * each one with the active voice provider, and hands the WAV bytes back to be
 * persisted. Playback is delegated to the app-wide player (the bottom strip), so
 * there is a single audio stream across the whole app.
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
  const player = useAudioPlayer();
  const [clips, setClips] = useState<AudioClip[]>([]);
  const [run, setRun] = useState<RunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const cancelRef = useRef(false);
  const clipsDoneRef = useRef(0);
  const mounted = useRef(true);

  const generating = run != null;

  const refreshClips = async () => {
    const list = await window.nodus.listAudioClips(entityKind, entityId);
    if (mounted.current) setClips(list);
  };

  const checkVoice = async (): Promise<{ provider: AudioProvider; voiceId: string } | null> => {
    const settings = await window.nodus.getSettings();
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
    };
    // eslint-disable-next-line
  }, [entityKind, entityId]);

  const totalDuration = useMemo(() => clips.reduce((acc, c) => acc + c.durationSec, 0), [clips]);
  const playable = useMemo<PlayerTrack[]>(
    () => clips.filter((c) => !c.missing).map((c) => ({ id: c.id, label: c.segmentLabel })),
    [clips]
  );

  const generate = async () => {
    setError(null);
    const chosen = await checkVoice();
    if (!chosen) {
      setError(t('Elige y prepara una voz en Ajustes → IA → Audio y voz.'));
      return;
    }
    // Local voices carry static metadata; cloud (Hume) voices are dynamic, so the
    // language is best-effort and defaults to empty.
    const language = findVoice(chosen.provider, chosen.voiceId)?.language ?? '';
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
    player.stop();
    await window.nodus.clearAudioClips(entityKind, entityId);
    setClips([]);
    setRun({ done: 0, total: segments.length, label: t('Preparando…') });

    try {
      for (const segment of segments) {
        if (cancelRef.current) break;
        setRun({ done: clipsDoneRef.current, total: segments.length, label: segment.label });
        const bytes = await synthesizeSegment(chosen.provider, chosen.voiceId, segment.text);
        if (cancelRef.current) break;
        const clip = await window.nodus.saveAudioClip(entityKind, entityId, {
          segmentIndex: segment.index,
          segmentLabel: segment.label,
          provider: chosen.provider,
          voice: chosen.voiceId,
          language,
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

  const playFrom = (clip: AudioClip) => {
    const idx = playable.findIndex((tk) => tk.id === clip.id);
    if (idx >= 0) player.play(playable, idx);
  };

  const deleteClip = async (id: string) => {
    if (player.currentTrackId === id) player.stop();
    await window.nodus.deleteAudioClip(id);
    await refreshClips();
  };

  const deleteAll = async () => {
    player.stop();
    await window.nodus.deleteEntityAudioClips(entityKind, entityId);
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
              <button className="btn btn-ghost border border-neutral-700 text-xs" onClick={() => player.play(playable, 0)} disabled={playable.length === 0}>
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
          {t('Elige y prepara una voz en Ajustes → IA → Audio y voz para poder narrar.')}
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
            const isCurrent = player.currentTrackId === clip.id;
            const isPlaying = isCurrent && player.isPlaying;
            return (
              <li
                key={clip.id}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${isCurrent ? 'bg-indigo-950/40' : 'hover:bg-neutral-900/60'}`}
              >
                <button
                  className="shrink-0 text-neutral-300 disabled:text-neutral-600"
                  title={clip.missing ? t('Archivo no disponible') : isPlaying ? t('Pausa') : t('Reproducir')}
                  disabled={clip.missing}
                  onClick={() => (isCurrent ? player.toggle() : playFrom(clip))}
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
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
