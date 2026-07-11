import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';

// A single app-wide audio player. One <audio> element and one bottom "strip" of
// controls serve every narration, so playback survives navigation between views
// and there is never more than one clip playing at once. Feature panels (the
// Deep Research reader, the immersion player) just hand it a playlist.

export interface PlayerTrack {
  id: string;
  label: string;
}

interface PlayerApi {
  visible: boolean;
  isPlaying: boolean;
  currentTrackId: string | null;
  /** Start a playlist at `startIndex` (defaults to 0) and show the strip. */
  play(tracks: PlayerTrack[], startIndex?: number): void;
  toggle(): void;
  /** Stop and hide the strip. */
  stop(): void;
}

const PlayerContext = createContext<PlayerApi | null>(null);

export function useAudioPlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('useAudioPlayer must be used within AudioPlayerProvider');
  return ctx;
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlCache = useRef<Map<string, string>>(new Map());
  const tracksRef = useRef<PlayerTrack[]>([]);
  const indexRef = useRef(0);
  const rateRef = useRef(1);

  const [visible, setVisible] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [tracks, setTracks] = useState<PlayerTrack[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);

  // Seed the playback rate from the saved default once.
  useEffect(() => {
    void window.nodus.getSettings().then((s) => {
      const r = s.audioSpeed ?? 1;
      rateRef.current = r;
      setRate(r);
      if (audioRef.current) audioRef.current.playbackRate = r;
    });
  }, []);

  const clipUrl = useCallback(async (id: string): Promise<string | null> => {
    const cached = urlCache.current.get(id);
    if (cached) return cached;
    // Use the data: URL directly as the media source (allowed by media-src). We
    // deliberately do NOT fetch()→objectURL it: fetching a data: URL is blocked by
    // the app's connect-src CSP, which silently broke playback.
    const dataUrl = await window.nodus.getAudioClipDataUrl(id);
    if (!dataUrl) return null;
    urlCache.current.set(id, dataUrl);
    return dataUrl;
  }, []);

  const loadAndPlay = useCallback(
    async (i: number) => {
      const el = audioRef.current;
      const track = tracksRef.current[i];
      if (!el || !track) return;
      const url = await clipUrl(track.id);
      if (!url) return;
      indexRef.current = i;
      setIndex(i);
      el.src = url;
      el.playbackRate = rateRef.current;
      (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
      try {
        await el.play();
      } catch {
        setIsPlaying(false);
      }
    },
    [clipUrl]
  );

  const play = useCallback(
    (next: PlayerTrack[], startIndex = 0) => {
      if (next.length === 0) return;
      tracksRef.current = next;
      setTracks(next);
      setVisible(true);
      void loadAndPlay(Math.max(0, Math.min(startIndex, next.length - 1)));
    },
    [loadAndPlay]
  );

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setVisible(false);
    setIsPlaying(false);
  }, []);

  const seek = useCallback((tSec: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = tSec;
    setCurrentTime(tSec);
  }, []);

  const changeRate = useCallback((r: number) => {
    rateRef.current = r;
    setRate(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
    void window.nodus.updateSettings({ audioSpeed: r });
  }, []);

  const goto = useCallback(
    (delta: number) => {
      const target = indexRef.current + delta;
      if (target >= 0 && target < tracksRef.current.length) void loadAndPlay(target);
    },
    [loadAndPlay]
  );

  const onEnded = useCallback(() => {
    const target = indexRef.current + 1;
    if (target < tracksRef.current.length) void loadAndPlay(target);
    else setIsPlaying(false);
  }, [loadAndPlay]);

  // Drop cached data URLs on unmount.
  useEffect(() => {
    const cache = urlCache.current;
    return () => cache.clear();
  }, []);

  const api = useMemo<PlayerApi>(
    () => ({
      visible,
      isPlaying,
      currentTrackId: tracks[index]?.id ?? null,
      play,
      toggle,
      stop,
    }),
    [visible, isPlaying, tracks, index, play, toggle, stop]
  );

  const current = tracks[index];

  return (
    <PlayerContext.Provider value={api}>
      <div className="h-full min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
        {visible && current && (
          <PlayerStrip
            label={current.label}
            index={index}
            total={tracks.length}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            rate={rate}
            onToggle={toggle}
            onStop={stop}
            onSeek={seek}
            onRate={changeRate}
            onPrev={() => goto(-1)}
            onNext={() => goto(1)}
          />
        )}
      </div>
      <audio
        ref={audioRef}
        className="hidden"
        onEnded={onEnded}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
      />
    </PlayerContext.Provider>
  );
}

function PlayerStrip({
  label,
  index,
  total,
  isPlaying,
  currentTime,
  duration,
  rate,
  onToggle,
  onStop,
  onSeek,
  onRate,
  onPrev,
  onNext,
}: {
  label: string;
  index: number;
  total: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  rate: number;
  onToggle: () => void;
  onStop: () => void;
  onSeek: (t: number) => void;
  onRate: (r: number) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const multi = total > 1;
  return (
    <div className="shrink-0 border-t border-neutral-800 bg-neutral-950/95 px-4 py-2 backdrop-blur">
      <div className="flex items-center gap-3">
        <span aria-hidden className="text-neutral-400">🎧</span>

        {/* Transport */}
        <div className="flex items-center gap-1">
          {multi && (
            <button className="rounded p-1 text-neutral-400 hover:text-neutral-200 disabled:opacity-30" title={t('Anterior')} disabled={index === 0} onClick={onPrev}>
              ⏮
            </button>
          )}
          <button className="rounded-full bg-indigo-600 px-2.5 py-1 text-sm text-white hover:bg-indigo-500" title={isPlaying ? t('Pausa') : t('Reproducir')} onClick={onToggle}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          {multi && (
            <button className="rounded p-1 text-neutral-400 hover:text-neutral-200 disabled:opacity-30" title={t('Siguiente')} disabled={index >= total - 1} onClick={onNext}>
              ⏭
            </button>
          )}
        </div>

        {/* Label + scrubber */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-400">
            <span className="truncate" title={label}>{label}{multi ? ` · ${index + 1}/${total}` : ''}</span>
            <span className="shrink-0 font-mono">{fmt(currentTime)} / {fmt(duration)}</span>
          </div>
          <input
            type="range"
            className="mt-1 w-full accent-indigo-500"
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(e) => onSeek(Number(e.target.value))}
          />
        </div>

        {/* Speed */}
        <div className="flex items-center gap-2" title={t('Velocidad de reproducción')}>
          <span className="text-[10px] text-neutral-500">{t('Velocidad')}</span>
          <input
            type="range"
            className="w-24 accent-indigo-500"
            min={0.25}
            max={2}
            step={0.05}
            value={rate}
            onChange={(e) => onRate(Number(e.target.value))}
          />
          <span className="w-10 shrink-0 font-mono text-xs text-neutral-400">{rate.toFixed(2)}×</span>
        </div>

        {/* Stop closes the strip */}
        <button className="rounded p-1 text-neutral-500 hover:text-red-400" title={t('Detener y cerrar')} onClick={onStop}>
          ✕
        </button>
      </div>
    </div>
  );
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
