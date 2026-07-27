import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TutorialLanguage } from '@shared/tutorialPreferences';
import {
  TUTORIAL_CATEGORIES,
  TUTORIAL_VIDEOS,
  tutorialVideoCopy,
  tutorialVideoShelves,
  videoCopyFor,
  youtubeEmbedUrl,
  youtubeWatchUrl,
  type TutorialCategory,
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
            <span>{copy.categories[video.category]}</span>
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
        {/* The shelf, not a number: the published titles stopped being numbered, and a
            catalogue that grows by category would renumber itself every time. */}
        <span className="tutorial-video-order">{copy.categories[video.category]}</span>
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

/**
 * The first-run screen: ONE tutorial, large, and a plain statement of where the rest
 * are met.
 *
 * A brand-new user has no vault yet, so the vault tutorials would be nine cards about
 * places they cannot go — the introduction is the only one that applies on day one.
 * The others are not hidden, they are deferred and *said out loud*: each vault's video
 * is offered by its own tour the first time that vault is opened, and Settings → Help
 * holds all four shelves with search and filters.
 */
export function TutorialVideoFeature({
  video,
  language,
}: {
  video: TutorialVideo;
  language: TutorialLanguage;
}) {
  const copy = tutorialVideoCopy(language);
  const meta = videoCopyFor(video, language);
  const [watched, setWatched] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.nodus.getSettings().then((settings) => {
      if (cancelled) return;
      setWatched(Array.isArray(settings.tutorialVideosWatched) ? settings.tutorialVideosWatched : []);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="tutorial-videos tutorial-videos-cinema tutorial-video-feature" data-testid="tutorial-video-feature">
      <header className="tutorial-videos-heading">
        <h2>{copy.startHere}</h2>
        <p>{copy.startHereLede}</p>
      </header>
      <article className="tutorial-video-feature-card">
        <button
          className="tutorial-video-poster tutorial-video-feature-poster"
          style={posterStyle(video)}
          onClick={() => setPlaying(true)}
          aria-label={`${copy.play}: ${meta.title}`}
          data-testid={`tutorial-video-play-${video.id}`}
        >
          <span className="tutorial-video-order">{copy.categories[video.category]}</span>
          <Icon name={video.icon} size={46} className="tutorial-video-poster-icon" />
          <span className="tutorial-video-play" aria-hidden="true"><Icon name="play" size={22} /></span>
          {watched.includes(video.id) && <span className="tutorial-video-watched"><Icon name="check" size={12} />{copy.watched}</span>}
        </button>
        <div className="tutorial-video-body">
          <h3>{meta.title}</h3>
          <p>{meta.body}</p>
          <div className="tutorial-video-card-actions">
            <button className="btn btn-primary" onClick={() => setPlaying(true)}><Icon name="play" size={14} />{copy.play}</button>
            <button className="btn btn-ghost" title={copy.openExternal} aria-label={copy.openExternal} onClick={() => void window.nodus.openExternal(youtubeWatchUrl(video))}>
              <Icon name="external" size={14} />
            </button>
          </div>
        </div>
      </article>
      <div className="tutorial-video-where" data-testid="tutorial-video-where">
        <div>
          <Icon name="layers" size={18} />
          <div><b>{copy.whereVaults.title}</b><small>{copy.whereVaults.body}</small></div>
        </div>
        <div>
          <Icon name="settings" size={18} />
          <div><b>{copy.whereSettings.title}</b><small>{copy.whereSettings.body}</small></div>
        </div>
      </div>
      <p className="tutorial-videos-hosting">{copy.hosting}</p>
      {playing && (
        <TutorialVideoPlayer
          video={video}
          language={language}
          onClose={(next) => { setPlaying(false); if (next) setWatched(next); }}
        />
      )}
    </div>
  );
}

/**
 * The published catalogue, plus the watched flags and the player.
 *
 * The list arrives from the main process, so the built-in one paints first and offline.
 * `showFilters` adds the Settings toolbar: one tab per shelf and a search box. Both are
 * additive — nothing is hidden until the reader asks for it, which is why the default
 * state is "All" with an empty query.
 */
export function TutorialVideoGrid({
  language,
  variant = 'cinema',
  videos,
  showHeading = true,
  showFilters = false,
}: {
  language: TutorialLanguage;
  /** `cinema` sits on the tutorial's dark stage; `panel` on a Settings card. */
  variant?: 'cinema' | 'panel';
  /** Render exactly these instead of the published catalogue. */
  videos?: readonly TutorialVideo[];
  showHeading?: boolean;
  /** Category tabs and a search box above the shelves. */
  showFilters?: boolean;
}) {
  const copy = tutorialVideoCopy(language);
  const [watched, setWatched] = useState<string[]>([]);
  const [playing, setPlaying] = useState<TutorialVideo | null>(null);
  const [category, setCategory] = useState<TutorialCategory | null>(null);
  const [query, setQuery] = useState('');
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

  const shelves = useMemo(
    () => tutorialVideoShelves(shown, { language, category: showFilters ? category : null, query: showFilters ? query : '' }),
    [shown, language, category, query, showFilters],
  );
  // A tab whose shelf is empty in the current catalogue would be a dead end; the ones
  // filtered out by the *search* stay, so clearing a query is always one click away.
  const tabs = useMemo(
    () => TUTORIAL_CATEGORIES.filter((shelf) => shown.some((video) => video.category === shelf)),
    [shown],
  );

  return (
    <div className={`tutorial-videos tutorial-videos-${variant}`} data-testid="tutorial-video-grid">
      {showHeading && (
        <header className="tutorial-videos-heading">
          <h2>{copy.gridTitle}</h2>
          <p>{copy.gridLede}</p>
        </header>
      )}
      {showFilters && (
        <div className="tutorial-videos-toolbar" data-testid="tutorial-videos-toolbar">
          <div className="tutorial-videos-tabs" role="tablist" aria-label={copy.gridTitle}>
            <button
              type="button"
              role="tab"
              aria-selected={category === null}
              className={category === null ? 'active' : ''}
              data-testid="tutorial-videos-tab-all"
              onClick={() => setCategory(null)}
            >
              {copy.allCategories}
            </button>
            {tabs.map((shelf) => (
              <button
                key={shelf}
                type="button"
                role="tab"
                aria-selected={category === shelf}
                className={category === shelf ? 'active' : ''}
                data-testid={`tutorial-videos-tab-${shelf}`}
                // Clicking the active tab clears the filter, so a tab is never a trap.
                onClick={() => setCategory((current) => (current === shelf ? null : shelf))}
              >
                {copy.categories[shelf]}
              </button>
            ))}
          </div>
          <div className="tutorial-videos-search">
            <Icon name="search" size={14} />
            <input
              type="search"
              value={query}
              placeholder={copy.searchPlaceholder}
              aria-label={copy.searchLabel}
              data-testid="tutorial-videos-search"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
      )}
      {shelves.map((shelf) => (
        <section key={shelf.category} className="tutorial-videos-shelf" data-testid={`tutorial-videos-shelf-${shelf.category}`}>
          {/* The heading is the shelf name even when a tab already says it: the tabs are
              optional and the grid is read top to bottom without them. */}
          <h3 className="tutorial-videos-shelf-title">{copy.categories[shelf.category]}</h3>
          <div className="tutorial-video-grid">
            {shelf.videos.map((video) => (
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
        </section>
      ))}
      {shelves.length === 0 && <p className="tutorial-videos-empty" data-testid="tutorial-videos-empty">{copy.noMatches}</p>}
      <footer className="tutorial-videos-footer">
        <p className="tutorial-videos-more" data-testid="tutorial-videos-more"><Icon name="sparkles" size={13} />{copy.more}</p>
        <p className="tutorial-videos-hosting">{copy.hosting} {copy.catalogueNote}</p>
      </footer>
      {playing && <TutorialVideoPlayer video={playing} language={language} onClose={closePlayer} />}
    </div>
  );
}
