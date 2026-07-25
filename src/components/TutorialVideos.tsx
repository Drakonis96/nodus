import { useCallback, useEffect, useState } from 'react';
import type { TutorialLanguage } from '@shared/tutorialPreferences';
import {
  TUTORIAL_VIDEOS,
  tutorialVideoCopy,
  videoCopyFor,
  youtubeEmbedUrl,
  youtubeWatchUrl,
  type TutorialVideo,
} from '@shared/tutorialVideos';
import { Icon, ModalBackdrop } from './ui';
import './tutorialVideos.css';

/**
 * Optional local poster frames: drop `<video id>.webp` into src/assets/tutorials/ and
 * the matching card uses it instead of its gradient. Local on purpose — a remote
 * thumbnail would make the mere sight of the grid a request to Google.
 */
const POSTERS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../assets/tutorials/*.{webp,png,jpg}', { eager: true, query: '?url', import: 'default' }))
    .map(([file, url]) => [file.replace(/^.*\/(.+)\.\w+$/, '$1'), url]),
);

function posterStyle(video: TutorialVideo): React.CSSProperties {
  const image = POSTERS[video.id];
  return image
    ? { backgroundImage: `url(${image})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: video.poster };
}

/**
 * The video tutorials, as a grid of cards plus an in-app player.
 *
 * Used from three places — the cinematic guide's video mode, Settings → Tutorials and
 * the per-vault tours — so the component owns everything the hosts would otherwise
 * duplicate: the watched flags, the player and the note about where the videos live.
 *
 * Nothing here touches the network until the user opens a video: the cards are drawn
 * from a local gradient and an icon rather than a remote thumbnail, so an unopened
 * grid makes no request at all.
 */

/** The player sits above the cinematic guide (z-190) and below its skip dialog (z-220). */
const PLAYER_Z_INDEX = 210;

async function markWatched(id: string): Promise<string[]> {
  const settings = await window.nodus.getSettings();
  const current = Array.isArray(settings.tutorialVideosWatched) ? settings.tutorialVideosWatched : [];
  if (current.includes(id)) return current;
  const next = [...current, id];
  await window.nodus.updateSettings({ tutorialVideosWatched: next });
  return next;
}

async function unmarkWatched(id: string): Promise<string[]> {
  const settings = await window.nodus.getSettings();
  const current = Array.isArray(settings.tutorialVideosWatched) ? settings.tutorialVideosWatched : [];
  const next = current.filter((watched) => watched !== id);
  await window.nodus.updateSettings({ tutorialVideosWatched: next });
  return next;
}

/**
 * The in-app player. The iframe carries YouTube's own controls, which is what gives
 * pause, seeking, captions, playback speed and fullscreen; Escape or the close button
 * leaves at any point. Opening it is what marks the tutorial as watched — tracking
 * real playback progress would mean loading YouTube's iframe API script, i.e. another
 * remote script in the CSP for a flag nobody audits.
 */
export function TutorialVideoPlayer({
  video,
  language,
  onClose,
}: {
  video: TutorialVideo;
  language: TutorialLanguage;
  onClose: (watched: string[] | null) => void;
}) {
  const copy = tutorialVideoCopy(language);
  const meta = videoCopyFor(video, language);
  const [watched, setWatched] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void markWatched(video.id).then((next) => {
      if (!cancelled) setWatched(next);
    });
    return () => { cancelled = true; };
  }, [video.id]);

  // `watched` is read through a ref-free closure on every render, so the latest value
  // reaches the host whether the user closes before or after the write lands.
  const close = () => onClose(watched);

  return (
    <ModalBackdrop onClose={close} zIndex={PLAYER_Z_INDEX}>
      <div className="tutorial-video-player" data-testid="tutorial-video-player" role="dialog" aria-modal="true" aria-label={meta.title}>
        <header className="tutorial-video-player-bar">
          <div>
            <span>{copy.tutorialWord} {video.order}</span>
            <b>{meta.title}</b>
          </div>
          <div className="tutorial-video-player-actions">
            <button className="btn btn-ghost" onClick={() => void window.nodus.openExternal(youtubeWatchUrl(video))}>
              <Icon name="external" size={14} />{copy.openExternal}
            </button>
            <button className="btn btn-ghost" data-testid="tutorial-video-close" onClick={close}>
              <Icon name="x" size={14} />{copy.close}
            </button>
          </div>
        </header>
        <div className="tutorial-video-frame">
          <iframe
            src={youtubeEmbedUrl(video, language)}
            title={meta.title}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
        <p className="tutorial-video-hosting">{copy.hosting}</p>
      </div>
    </ModalBackdrop>
  );
}

function TutorialVideoCard({
  video,
  language,
  watched,
  onPlay,
  onUnwatch,
}: {
  video: TutorialVideo;
  language: TutorialLanguage;
  watched: boolean;
  onPlay: () => void;
  onUnwatch: () => void;
}) {
  const copy = tutorialVideoCopy(language);
  const meta = videoCopyFor(video, language);
  return (
    <article className="tutorial-video-card" data-testid={`tutorial-video-card-${video.id}`} data-watched={watched ? 'true' : 'false'}>
      <button
        className="tutorial-video-poster"
        style={posterStyle(video)}
        onClick={onPlay}
        aria-label={`${copy.play}: ${meta.title}`}
        data-testid={`tutorial-video-play-${video.id}`}
      >
        <span className="tutorial-video-order">{copy.tutorialWord} {video.order}</span>
        <Icon name={video.icon} size={34} className="tutorial-video-poster-icon" />
        <span className="tutorial-video-play" aria-hidden="true"><Icon name="play" size={18} /></span>
        {watched && <span className="tutorial-video-watched"><Icon name="check" size={12} />{copy.watched}</span>}
      </button>
      <div className="tutorial-video-body">
        <h3>{meta.title}</h3>
        <p>{meta.body}</p>
        <div className="tutorial-video-card-actions">
          <button className="btn btn-primary" onClick={onPlay}><Icon name="play" size={14} />{copy.play}</button>
          <button className="btn btn-ghost" title={copy.openExternal} aria-label={copy.openExternal} onClick={() => void window.nodus.openExternal(youtubeWatchUrl(video))}>
            <Icon name="external" size={14} />
          </button>
          {watched && (
            <button className="btn btn-ghost tutorial-video-unwatch" onClick={onUnwatch}>{copy.markUnwatched}</button>
          )}
        </div>
      </div>
    </article>
  );
}

export function TutorialVideoGrid({
  language,
  variant = 'cinema',
  videos,
  showHeading = true,
}: {
  language: TutorialLanguage;
  /** `cinema` sits on the tutorial's dark stage; `panel` on a Settings card. */
  variant?: 'cinema' | 'panel';
  /** Render exactly these instead of the published catalogue. */
  videos?: readonly TutorialVideo[];
  showHeading?: boolean;
}) {
  const copy = tutorialVideoCopy(language);
  const [watched, setWatched] = useState<string[]>([]);
  const [playing, setPlaying] = useState<TutorialVideo | null>(null);
  // Starts as this build's list, so the grid paints immediately and offline; the main
  // process then answers with anything published since. `videos` overrides both when a
  // caller wants a specific subset.
  const [published, setPublished] = useState<readonly TutorialVideo[]>(TUTORIAL_VIDEOS);
  const shown = videos ?? published;

  useEffect(() => {
    let cancelled = false;
    void window.nodus.getSettings().then((settings) => {
      if (cancelled) return;
      setWatched(Array.isArray(settings.tutorialVideosWatched) ? settings.tutorialVideosWatched : []);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (videos) return; // an explicit list was passed in; nothing to look up
    let cancelled = false;
    void window.nodus.getTutorialCatalogue().then((next) => {
      if (cancelled || !Array.isArray(next) || next.length === 0) return;
      setPublished(next);
    }).catch(() => { /* the built-in list is already on screen */ });
    return () => { cancelled = true; };
  }, [videos]);

  const closePlayer = useCallback((next: string[] | null) => {
    setPlaying(null);
    if (next) setWatched(next);
  }, []);

  return (
    <div className={`tutorial-videos tutorial-videos-${variant}`} data-testid="tutorial-video-grid">
      {showHeading && (
        <header className="tutorial-videos-heading">
          <h2>{copy.gridTitle}</h2>
          <p>{copy.gridLede}</p>
        </header>
      )}
      <div className="tutorial-video-grid">
        {shown.map((video) => (
          <TutorialVideoCard
            key={video.id}
            video={video}
            language={language}
            watched={watched.includes(video.id)}
            onPlay={() => setPlaying(video)}
            onUnwatch={() => void unmarkWatched(video.id).then(setWatched)}
          />
        ))}
      </div>
      <footer className="tutorial-videos-footer">
        <p className="tutorial-videos-more" data-testid="tutorial-videos-more"><Icon name="sparkles" size={13} />{copy.more}</p>
        <p className="tutorial-videos-hosting">{copy.hosting} {copy.catalogueNote}</p>
      </footer>
      {playing && <TutorialVideoPlayer video={playing} language={language} onClose={closePlayer} />}
    </div>
  );
}
