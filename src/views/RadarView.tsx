import { useEffect, useMemo, useRef, useState } from "react";
import type { LibraryItemMetadata } from "@shared/libraryTypes";
import type {
  RadarCadence,
  RadarFollow,
  RadarFollowType,
  RadarSnapshot,
  RadarSourceStatus,
  RadarUpdate,
} from "@shared/radar";
import { Icon } from "../components/ui";

type RadarTab = "inbox" | "following" | "sources";

const TYPE_META: Record<
  RadarFollowType,
  { label: string; icon: string; hint: string; placeholder: string }
> = {
  topic: {
    label: "Topic",
    icon: "bulb",
    hint: "New research around a subject",
    placeholder: "e.g. Digital humanities",
  },
  search: {
    label: "Saved search",
    icon: "search",
    hint: "Repeat a precise query",
    placeholder: 'e.g. "large language models" AND archives',
  },
  author: {
    label: "Author",
    icon: "user",
    hint: "New works by a researcher",
    placeholder: "Name, ORCID, or profile URL",
  },
  journal: {
    label: "Journal",
    icon: "book",
    hint: "New issues and articles",
    placeholder: "Journal title or ISSN",
  },
  paper: {
    label: "Paper / citations",
    icon: "quote",
    hint: "New citations and related work",
    placeholder: "Title, DOI, or paper URL",
  },
  rss: {
    label: "RSS feed",
    icon: "rss",
    hint: "Updates from any feed",
    placeholder: "https://example.org/feed.xml",
  },
  website: {
    label: "Website",
    icon: "globe",
    hint: "Meaningful changes to a page",
    placeholder: "https://example.org/research",
  },
};

const SOURCE_ICONS: Record<string, string> = {
  OpenAlex: "network",
  Crossref: "quote",
  ORCID: "user",
  "Semantic Scholar": "graduation",
  RSS: "rss",
  "Web monitor": "globe",
};
const EMPTY_SNAPSHOT: RadarSnapshot = {
  follows: [],
  updates: [],
  sources: [],
  unreadCount: 0,
  checking: false,
  lastCheckedAt: null,
  nextCheckAt: null,
  detectedThisWeek: 0,
};

function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return "Just now";
  if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)} min ago`;
  if (delta < 24 * 60 * 60_000)
    return `${Math.floor(delta / (60 * 60_000))} hr ago`;
  if (delta < 7 * 24 * 60 * 60_000)
    return `${Math.floor(delta / (24 * 60 * 60_000))} d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function nextCheckLabel(timestamp: number | null): string {
  if (!timestamp) return "No active follows";
  const date = new Date(timestamp);
  const day =
    date.toDateString() === new Date().toDateString()
      ? "Today"
      : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${day} at ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
}

export function RadarView({
  target,
}: {
  target?: { updateId?: string; nonce: number } | null;
}) {
  const [tab, setTab] = useState<RadarTab>("inbox");
  const [snapshot, setSnapshot] = useState<RadarSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [followingQuery, setFollowingQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);
  const [followType, setFollowType] = useState<RadarFollowType>("topic");
  const [followValue, setFollowValue] = useState("");
  const [followTitle, setFollowTitle] = useState("");
  const [followCadence, setFollowCadence] = useState<RadarCadence>("daily");
  const [editing, setEditing] = useState<RadarFollow | null>(null);
  const [removing, setRemoving] = useState<RadarFollow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<number | null>(null);

  const flash = (message: string) => {
    setNotice(message);
    if (noticeTimer.current != null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 4_000);
  };

  useEffect(() => {
    let active = true;
    void window.nodus
      .getRadarSnapshot()
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const dispose = window.nodus.onRadarChanged((next) => {
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
      dispose();
      if (noticeTimer.current != null) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!target) return;
    setTab("inbox");
    setUnreadOnly(false);
    if (!target.updateId) return;
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-radar-update-id="${CSS.escape(target.updateId!)}"]`,
        )
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(
        () => void window.nodus.markRadarUpdateRead(target.updateId!),
        600,
      );
    });
  }, [target?.nonce]);

  const visibleUpdates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return snapshot.updates.filter(
      (item) =>
        !(
          (unreadOnly && item.read) ||
          (normalized &&
            ![item.title, item.authors, item.followTitle, item.source].some(
              (value) => value.toLowerCase().includes(normalized),
            ))
        ),
    );
  }, [query, snapshot.updates, unreadOnly]);

  const visibleFollows = useMemo(() => {
    const normalized = followingQuery.trim().toLowerCase();
    return normalized
      ? snapshot.follows.filter((follow) =>
          [follow.title, follow.value, ...follow.sources].some((value) =>
            value.toLowerCase().includes(normalized),
          ),
        )
      : snapshot.follows;
  }, [followingQuery, snapshot.follows]);

  const openFollow = () => {
    setEditing(null);
    setFollowType("topic");
    setFollowValue("");
    setFollowTitle("");
    setFollowCadence("daily");
    setError("");
    setFollowOpen(true);
  };
  const openEdit = (follow: RadarFollow) => {
    setEditing(follow);
    setFollowType(follow.type);
    setFollowValue(follow.value);
    setFollowTitle(follow.title === follow.value ? "" : follow.title);
    setFollowCadence(follow.cadence);
    setError("");
    setFollowOpen(true);
  };

  const saveFollow = async () => {
    const value = followValue.trim();
    if (!value || saving) return;
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await window.nodus.updateRadarFollow(editing.id, {
          value,
          title: followTitle.trim() || value,
          cadence: followCadence,
        });
        flash("Follow updated.");
      } else {
        const created = await window.nodus.createRadarFollow({
          type: followType,
          value,
          title: followTitle.trim() || undefined,
          cadence: followCadence,
        });
        flash("Follow saved. Radar is checking for updates.");
        void window.nodus
          .checkRadar({ followIds: [created.id], reason: "created" })
          .catch((reason) =>
            flash(
              `Follow saved, but the first check needs attention: ${reason instanceof Error ? reason.message : String(reason)}`,
            ),
          );
      }
      setFollowOpen(false);
      setTab("following");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const checkNow = async () => {
    setError("");
    try {
      const result = await window.nodus.checkRadar({ reason: "manual" });
      flash(
        result.newItems
          ? `${result.newItems} new update${result.newItems === 1 ? "" : "s"} added to Inbox.`
          : result.errors
            ? "Check completed, but one or more sources need attention."
            : "Check complete. No meaningful changes found.",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const reviewUpdate = async (item: RadarUpdate) => {
    if (!item.read)
      await window.nodus.markRadarUpdateRead(item.id).catch(() => undefined);
    if (item.url) await window.nodus.openExternal(item.url);
  };

  const saveToLibrary = async (item: RadarUpdate) => {
    try {
      if (item.doi)
        await window.nodus.importGlobalLibraryIdentifier("doi", item.doi, []);
      else {
        const metadata: LibraryItemMetadata = {
          title: item.title,
          itemType: "journal-article",
          creators: [],
          abstract: item.summary || undefined,
          url: item.url || undefined,
          date: item.publishedAt,
          tags: ["Nodus Radar"],
          extra: { "Radar follow": item.followTitle, Source: item.source },
        };
        await window.nodus.createGlobalLibraryItem(metadata, []);
      }
      flash("Saved to the global library.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const activeFollows = snapshot.follows.filter(
    (follow) => !follow.paused,
  ).length;
  const connectedSources = snapshot.sources.filter(
    (source) => source.followCount > 0,
  ).length;

  return (
    <div
      data-testid="radar-view"
      className="relative flex h-full flex-col overflow-hidden bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
    >
      <header className="shrink-0 border-b border-neutral-200 bg-white px-6 pt-5 dark:border-neutral-800 dark:bg-neutral-950 max-md:px-4">
        <div className="mx-auto flex max-w-6xl items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/20">
            <Icon name="radar" size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold tracking-tight">
                Nodus Radar
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${snapshot.checking ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${snapshot.checking ? "animate-pulse bg-indigo-500" : "bg-emerald-500"}`}
                />{" "}
                {snapshot.checking ? "Checking" : "Monitoring"}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
              Research updates from everything you follow, across every vault.
            </p>
          </div>
          <button
            data-testid="radar-check-now"
            className="btn btn-ghost h-9 shrink-0 gap-2 text-xs"
            disabled={snapshot.checking || !activeFollows}
            onClick={() => void checkNow()}
          >
            <Icon
              name="refresh"
              size={14}
              className={snapshot.checking ? "animate-spin" : ""}
            />
            <span className="max-sm:hidden">
              {snapshot.checking ? "Checking…" : "Check now"}
            </span>
          </button>
          <button
            data-testid="radar-follow-open"
            className="btn btn-primary h-9 shrink-0 gap-1.5 bg-indigo-600 px-3 text-white hover:bg-indigo-500"
            onClick={openFollow}
          >
            <Icon name="plus" size={15} /> Follow
          </button>
        </div>
        <nav
          className="mx-auto mt-5 flex max-w-6xl items-center gap-6"
          aria-label="Radar sections"
        >
          {(
            [
              ["inbox", "inbox", "Inbox"],
              ["following", "bookmark", "Following"],
              ["sources", "plug", "Sources"],
            ] as const
          ).map(([id, icon, label]) => (
            <button
              key={id}
              data-testid={`radar-tab-${id}`}
              className={`relative flex h-10 items-center gap-2 text-sm font-medium transition-colors ${tab === id ? "text-indigo-700 dark:text-indigo-300" : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"}`}
              onClick={() => setTab(id)}
            >
              <Icon name={icon} size={15} /> {label}
              {id === "inbox" && snapshot.unreadCount > 0 && (
                <span
                  data-testid="radar-inbox-badge"
                  className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] leading-none text-white"
                >
                  {snapshot.unreadCount > 99 ? "99+" : snapshot.unreadCount}
                </span>
              )}
              {tab === id && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
              )}
            </button>
          ))}
        </nav>
      </header>

      <main
        data-nodi-view="radar"
        className="min-h-0 flex-1 overflow-y-auto px-6 py-5 max-md:px-4"
      >
        {loading ? (
          <RadarLoading />
        ) : tab === "inbox" ? (
          <InboxTab
            snapshot={snapshot}
            updates={visibleUpdates}
            query={query}
            setQuery={setQuery}
            unreadOnly={unreadOnly}
            setUnreadOnly={setUnreadOnly}
            activeFollows={activeFollows}
            connectedSources={connectedSources}
            targetId={target?.updateId}
            openFollow={openFollow}
            reviewUpdate={reviewUpdate}
            saveToLibrary={saveToLibrary}
          />
        ) : tab === "following" ? (
          <FollowingTab
            snapshot={snapshot}
            follows={visibleFollows}
            query={followingQuery}
            setQuery={setFollowingQuery}
            openFollow={openFollow}
            openEdit={openEdit}
            setRemoving={setRemoving}
          />
        ) : (
          <SourcesTab sources={snapshot.sources} />
        )}
      </main>

      {error && (
        <div
          data-testid="radar-error"
          role="alert"
          className="absolute bottom-5 left-1/2 z-[115] flex max-w-xl -translate-x-1/2 items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 text-xs text-red-700 shadow-xl dark:border-red-900 dark:bg-neutral-900 dark:text-red-300"
        >
          <Icon name="alert" size={14} />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")}>
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
      {notice && (
        <div
          data-testid="radar-notice"
          role="status"
          className="absolute bottom-5 left-1/2 z-[114] flex max-w-xl -translate-x-1/2 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-xs text-emerald-700 shadow-xl dark:border-emerald-900 dark:bg-neutral-900 dark:text-emerald-300"
        >
          <Icon name="check" size={14} />
          {notice}
        </div>
      )}
      {followOpen && (
        <FollowDialog
          editing={editing}
          followType={followType}
          setFollowType={setFollowType}
          value={followValue}
          setValue={setFollowValue}
          title={followTitle}
          setTitle={setFollowTitle}
          cadence={followCadence}
          setCadence={setFollowCadence}
          saving={saving}
          error={error}
          onClose={() => setFollowOpen(false)}
          onSave={saveFollow}
        />
      )}
      {removing && (
        <RemoveDialog
          follow={removing}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const id = removing.id;
            setRemoving(null);
            void window.nodus
              .removeRadarFollow(id)
              .then(() => flash("Follow removed."));
          }}
        />
      )}
    </div>
  );
}

function InboxTab({
  snapshot,
  updates,
  query,
  setQuery,
  unreadOnly,
  setUnreadOnly,
  activeFollows,
  connectedSources,
  targetId,
  openFollow,
  reviewUpdate,
  saveToLibrary,
}: {
  snapshot: RadarSnapshot;
  updates: RadarUpdate[];
  query: string;
  setQuery: (value: string) => void;
  unreadOnly: boolean;
  setUnreadOnly: (value: boolean) => void;
  activeFollows: number;
  connectedSources: number;
  targetId?: string;
  openFollow: () => void;
  reviewUpdate: (item: RadarUpdate) => Promise<void>;
  saveToLibrary: (item: RadarUpdate) => Promise<void>;
}) {
  return (
    <section data-testid="radar-inbox" className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[15rem] flex-1 sm:max-w-md">
          <Icon
            name="search"
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            data-testid="radar-inbox-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="input input-with-leading-icon h-9 w-full text-sm"
            placeholder="Search updates, follows, or sources"
          />
        </div>
        <button
          data-testid="radar-unread-toggle"
          aria-pressed={unreadOnly}
          className={`btn h-9 gap-2 text-xs ${unreadOnly ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "btn-ghost"}`}
          onClick={() => setUnreadOnly(!unreadOnly)}
        >
          <span
            className={`h-2 w-2 rounded-full ${unreadOnly ? "bg-indigo-600 dark:bg-indigo-400" : "bg-neutral-300 dark:bg-neutral-700"}`}
          />{" "}
          Unread
        </button>
        <button
          data-testid="radar-mark-all-read"
          className="btn btn-ghost h-9 gap-2 text-xs"
          disabled={!snapshot.unreadCount}
          onClick={() => void window.nodus.markAllRadarUpdatesRead()}
        >
          <Icon name="check" size={14} /> Mark all read
        </button>
      </div>
      {updates.length ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-1 text-xs text-neutral-500">
              <span>
                {snapshot.unreadCount
                  ? `${snapshot.unreadCount} new updates`
                  : "You are caught up"}
              </span>
              <span>Latest first</span>
            </div>
            {updates.map((item) => (
              <UpdateCard
                key={item.id}
                item={item}
                highlighted={targetId === item.id}
                reviewUpdate={reviewUpdate}
                saveToLibrary={saveToLibrary}
              />
            ))}
          </div>
          <aside
            data-testid="radar-summary-column"
            className="space-y-3 pt-[1.625rem] max-lg:hidden"
          >
            <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/55">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                This week
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <strong className="block text-xl font-semibold">
                    {snapshot.detectedThisWeek}
                  </strong>
                  <span className="text-[11px] text-neutral-500">
                    updates found
                  </span>
                </div>
                <div>
                  <strong className="block text-xl font-semibold">
                    {snapshot.unreadCount}
                  </strong>
                  <span className="text-[11px] text-neutral-500">
                    worth reviewing
                  </span>
                </div>
              </div>
              <div className="mt-4 border-t border-neutral-100 pt-3 text-[11px] leading-4 text-neutral-500 dark:border-neutral-800">
                Similar results and citation bursts are grouped automatically.
              </div>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/55">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">Next check</p>
                <span
                  className={`h-2 w-2 rounded-full ${activeFollows ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"}`}
                />
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">
                {nextCheckLabel(snapshot.nextCheckAt)} · {connectedSources}{" "}
                sources
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <RadarEmpty
          title={
            query
              ? "No updates match your search"
              : unreadOnly && snapshot.updates.length
                ? "You’re all caught up"
                : snapshot.follows.length
                  ? "No updates yet"
                  : "Your Radar inbox is ready"
          }
          description={
            query
              ? "Try a different title, follow, or source."
              : unreadOnly && snapshot.updates.length
                ? "New results from your follows will appear here."
                : snapshot.follows.length
                  ? "Radar will add meaningful changes here after the next source check."
                  : "Follow a topic, author, paper, feed, or website to start receiving focused research updates."
          }
          action={!query && !snapshot.follows.length ? openFollow : undefined}
        />
      )}
    </section>
  );
}

function UpdateCard({
  item,
  highlighted,
  reviewUpdate,
  saveToLibrary,
}: {
  item: RadarUpdate;
  highlighted: boolean;
  reviewUpdate: (item: RadarUpdate) => Promise<void>;
  saveToLibrary: (item: RadarUpdate) => Promise<void>;
}) {
  return (
    <article
      data-testid={`radar-update-${item.id}`}
      data-radar-update-id={item.id}
      className={`group relative overflow-hidden rounded-xl border bg-white p-4 transition-all hover:border-indigo-300 dark:bg-neutral-900/55 dark:hover:border-indigo-700 ${item.read ? "border-neutral-200 dark:border-neutral-800" : "border-indigo-200 shadow-sm shadow-indigo-100/40 dark:border-indigo-900 dark:shadow-none"} ${highlighted ? "ring-2 ring-indigo-400 ring-offset-2 dark:ring-offset-neutral-950" : ""}`}
    >
      {!item.read && (
        <span className="absolute inset-y-0 left-0 w-0.5 bg-indigo-500" />
      )}
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg ${item.read ? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800" : "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300"}`}
        >
          <Icon name={TYPE_META[item.followType].icon} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">
              {item.followTitle}
            </span>
            <span>·</span>
            <span>{item.source}</span>
            <span>·</span>
            <span>{relativeTime(item.detectedAt)}</span>
            {item.signal && (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                {item.signal}
              </span>
            )}
          </div>
          <h2
            className={`mt-1.5 text-sm leading-5 ${item.read ? "font-medium" : "font-semibold"}`}
          >
            {item.title}
          </h2>
          {item.authors && (
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {item.authors}
            </p>
          )}
          {item.summary && (
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
              {item.summary}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              data-testid={`radar-review-${item.id}`}
              className="btn btn-ghost h-7 gap-1.5 px-2 text-[11px] text-indigo-700 dark:text-indigo-300"
              onClick={() => void reviewUpdate(item)}
            >
              Review update <Icon name="arrowRight" size={12} />
            </button>
            <button
              data-testid={`radar-save-${item.id}`}
              className="btn btn-ghost h-7 px-2 text-[11px]"
              onClick={() => void saveToLibrary(item)}
            >
              Save to library
            </button>
            {!item.read ? (
              <button
                data-testid={`radar-mark-read-${item.id}`}
                className="ml-auto h-7 text-[11px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                onClick={() => void window.nodus.markRadarUpdateRead(item.id)}
              >
                Mark read
              </button>
            ) : (
              <button
                className="ml-auto h-7 text-[11px] text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                onClick={() => void window.nodus.removeRadarUpdate(item.id)}
                title="Dismiss update"
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function FollowingTab({
  snapshot,
  follows,
  query,
  setQuery,
  openFollow,
  openEdit,
  setRemoving,
}: {
  snapshot: RadarSnapshot;
  follows: RadarFollow[];
  query: string;
  setQuery: (value: string) => void;
  openFollow: () => void;
  openEdit: (follow: RadarFollow) => void;
  setRemoving: (follow: RadarFollow) => void;
}) {
  const active = snapshot.follows.filter((follow) => !follow.paused).length;
  return (
    <section data-testid="radar-following" className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Following</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            {active} active · {snapshot.follows.length - active} paused
          </p>
        </div>
        <div className="relative w-56 max-sm:hidden">
          <Icon
            name="search"
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            data-testid="radar-following-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="input input-with-leading-icon h-8 w-full text-xs"
            placeholder="Search following"
          />
        </div>
      </div>
      {follows.length ? (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/55">
          {follows.map((item, index) => (
            <article
              key={item.id}
              data-testid={`radar-follow-${item.id}`}
              className={`flex items-center gap-3 p-4 ${index ? "border-t border-neutral-100 dark:border-neutral-800" : ""}`}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                <Icon name={TYPE_META[item.type].icon} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-medium">{item.title}</h3>
                  {item.paused && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                      Paused
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-neutral-500">
                  {item.detail}
                </p>
                <p className="mt-1 text-[11px] text-neutral-400">
                  {item.sources.join(" + ")} ·{" "}
                  {item.cadence === "daily" ? "Daily" : "Weekly"}
                  {item.lastCheckedAt
                    ? ` · checked ${relativeTime(item.lastCheckedAt)}`
                    : " · not checked yet"}
                </p>
              </div>
              <div className="hidden text-right sm:block">
                <strong className="block text-sm font-medium">
                  {item.updateCount}
                </strong>
                <span className="text-[10px] text-neutral-500">updates</span>
              </div>
              <button
                data-testid={`radar-follow-pause-${item.id}`}
                className="btn btn-ghost h-8 w-8 p-0"
                title={item.paused ? "Resume" : "Pause"}
                onClick={() =>
                  void window.nodus.updateRadarFollow(item.id, {
                    paused: !item.paused,
                  })
                }
              >
                <Icon name={item.paused ? "play" : "pause"} size={13} />
              </button>
              <button
                data-testid={`radar-follow-edit-${item.id}`}
                className="btn btn-ghost h-8 w-8 p-0"
                title="Edit"
                onClick={() => openEdit(item)}
              >
                <Icon name="edit" size={13} />
              </button>
              <button
                data-testid={`radar-follow-remove-${item.id}`}
                className="btn btn-ghost h-8 w-8 p-0 text-neutral-400 hover:text-red-500"
                title="Remove"
                onClick={() => setRemoving(item)}
              >
                <Icon name="trash" size={13} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <RadarEmpty
          title={
            snapshot.follows.length
              ? "No follows match your search"
              : "Follow your first research signal"
          }
          description={
            snapshot.follows.length
              ? "Try a different title or source."
              : "Topics, authors, journals, papers, feeds, and websites all live in one quiet monitoring list."
          }
          action={!snapshot.follows.length ? openFollow : undefined}
        />
      )}
    </section>
  );
}

function SourcesTab({ sources }: { sources: RadarSourceStatus[] }) {
  return (
    <section data-testid="radar-sources" className="mx-auto max-w-6xl">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Sources</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Radar chooses the best available sources for each follow and shows
          their current status.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sources.map((source) => (
          <SourceCard key={source.name} source={source} />
        ))}
      </div>
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-500/5 dark:text-indigo-200">
        <span className="mt-0.5">
          <Icon name="shield" size={15} />
        </span>
        <div>
          <p className="text-xs font-medium">
            No setup needed for public research sources
          </p>
          <p className="mt-1 text-[11px] leading-4 opacity-70">
            Radar checks sources responsibly, blocks private-network URLs, and
            reduces frequency automatically when a public service is temporarily
            limited.
          </p>
        </div>
      </div>
    </section>
  );
}

function FollowDialog({
  editing,
  followType,
  setFollowType,
  value,
  setValue,
  title,
  setTitle,
  cadence,
  setCadence,
  saving,
  error,
  onClose,
  onSave,
}: {
  editing: RadarFollow | null;
  followType: RadarFollowType;
  setFollowType: (type: RadarFollowType) => void;
  value: string;
  setValue: (value: string) => void;
  title: string;
  setTitle: (value: string) => void;
  cadence: RadarCadence;
  setCadence: (value: RadarCadence) => void;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  return (
    <div
      data-testid="radar-follow-dialog"
      className="fixed inset-0 z-[120] grid place-items-center bg-black/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="flex max-h-[min(43rem,92vh)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="radar-follow-title"
      >
        <div className="flex items-start gap-3 border-b border-neutral-100 p-5 dark:border-neutral-800">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
            <Icon name={editing ? "edit" : "plus"} size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="radar-follow-title" className="text-base font-semibold">
              {editing ? "Edit follow" : "Follow something new"}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Choose what matters. Radar will find the right sources and keep
              the noise low.
            </p>
          </div>
          <button
            data-testid="radar-follow-close"
            className="btn btn-ghost h-8 w-8 p-0"
            disabled={saving}
            onClick={onClose}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 md:grid-cols-[13rem_minmax(0,1fr)]">
          <div className="overflow-y-auto border-b border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40 md:border-b-0 md:border-r">
            <div className="grid grid-cols-2 gap-1 md:grid-cols-1">
              {(Object.keys(TYPE_META) as RadarFollowType[]).map((type) => {
                const meta = TYPE_META[type];
                return (
                  <button
                    key={type}
                    disabled={Boolean(editing)}
                    data-testid={`radar-follow-type-${type}`}
                    className={`flex items-center gap-2.5 rounded-lg p-2.5 text-left transition-colors disabled:cursor-default ${followType === type ? "bg-white text-indigo-700 shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-800 dark:text-indigo-300 dark:ring-neutral-700" : "text-neutral-600 hover:bg-white/70 dark:text-neutral-400 dark:hover:bg-neutral-800/60"}`}
                    onClick={() => {
                      setFollowType(type);
                      setValue("");
                      setTitle("");
                    }}
                  >
                    <Icon name={meta.icon} size={15} />
                    <span>
                      <b className="block text-xs font-medium">{meta.label}</b>
                      <small className="hidden text-[10px] text-neutral-400 md:block">
                        {meta.hint}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <form
            className="flex min-h-0 flex-col p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void onSave();
            }}
          >
            <div className="flex-1">
              <label className="text-xs font-medium">
                What do you want to follow?
              </label>
              <input
                data-testid="radar-follow-value"
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className="input mt-2 h-10 w-full text-sm"
                placeholder={TYPE_META[followType].placeholder}
              />
              <label className="mt-4 block text-xs font-medium">
                Display name{" "}
                <span className="font-normal text-neutral-400">(optional)</span>
              </label>
              <input
                data-testid="radar-follow-title-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="input mt-2 h-9 w-full text-sm"
                placeholder="A short, recognisable label"
              />
              <label className="mt-4 block text-xs font-medium">
                Check cadence
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="radar-cadence-daily"
                  className={`rounded-lg border p-3 text-left ${cadence === "daily" ? "border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-500/10" : "border-neutral-200 dark:border-neutral-700"}`}
                  onClick={() => setCadence("daily")}
                >
                  <b className="block text-xs">Daily</b>
                  <span className="text-[10px] text-neutral-500">
                    Best for active topics
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="radar-cadence-weekly"
                  className={`rounded-lg border p-3 text-left ${cadence === "weekly" ? "border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-500/10" : "border-neutral-200 dark:border-neutral-700"}`}
                  onClick={() => setCadence("weekly")}
                >
                  <b className="block text-xs">Weekly</b>
                  <span className="text-[10px] text-neutral-500">
                    A quieter digest
                  </span>
                </button>
              </div>
              <div className="mt-4 rounded-lg bg-neutral-50 p-3 text-[11px] leading-4 text-neutral-500 dark:bg-neutral-800/50">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  Sources selected automatically:
                </span>{" "}
                {sourcePreview(followType, value)}
              </div>
              <p className="mt-3 flex items-start gap-2 text-[11px] leading-4 text-neutral-400">
                <Icon name="sparkles" size={13} className="mt-0.5" /> Radar
                groups related results and won’t notify you when nothing
                meaningful changed.
              </p>
              {error && (
                <p className="mt-3 text-xs text-red-600 dark:text-red-300">
                  {error}
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                data-testid="radar-follow-cancel"
                type="button"
                className="btn btn-ghost h-9 px-4 text-xs"
                disabled={saving}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                data-testid="radar-follow-save"
                type="submit"
                disabled={!value.trim() || saving}
                className="btn btn-primary h-9 bg-indigo-600 px-4 text-xs text-white hover:bg-indigo-500"
              >
                {saving
                  ? "Saving…"
                  : editing
                    ? "Save changes"
                    : "Start following"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

function RemoveDialog({
  follow,
  onCancel,
  onConfirm,
}: {
  follow: RadarFollow;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[125] grid place-items-center bg-black/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        data-testid="radar-remove-dialog"
        className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
        role="dialog"
        aria-modal="true"
      >
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300">
          <Icon name="trash" size={17} />
        </span>
        <h2 className="mt-4 text-base font-semibold">
          Stop following “{follow.title}”?
        </h2>
        <p className="mt-2 text-xs leading-5 text-neutral-500">
          Its existing Radar updates will be removed, and future checks will no
          longer include it.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost h-9 px-4 text-xs" onClick={onCancel}>
            Cancel
          </button>
          <button
            data-testid="radar-remove-confirm"
            className="btn h-9 bg-red-600 px-4 text-xs text-white hover:bg-red-500"
            onClick={onConfirm}
          >
            Remove
          </button>
        </div>
      </section>
    </div>
  );
}

function sourcePreview(type: RadarFollowType, value: string): string {
  if (type === "rss") return "RSS";
  if (type === "website") return "Web monitor";
  if (type === "journal") return "Crossref";
  if (type === "author")
    return /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/i.test(value)
      ? "ORCID + Crossref"
      : "OpenAlex + Crossref";
  if (type === "paper") return "OpenAlex + Crossref";
  return "OpenAlex + Semantic Scholar";
}

function SourceCard({ source }: { source: RadarSourceStatus }) {
  const healthy = source.state === "active" || source.state === "ready";
  const label =
    source.state === "active"
      ? "Active"
      : source.state === "ready"
        ? "Ready"
        : source.state === "limited"
          ? "Rate limited"
          : "Needs attention";
  const statusColor = healthy
    ? "bg-emerald-500"
    : source.state === "limited"
      ? "bg-amber-500"
      : "bg-red-500";
  return (
    <article
      data-testid={`radar-source-${source.name.toLowerCase().replace(/\s+/g, "-")}`}
      className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/55"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          <Icon name={SOURCE_ICONS[source.name] || "plug"} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{source.name}</h3>
            <span
              className={`inline-flex items-center gap-1.5 text-[10px] font-medium ${healthy ? "text-emerald-700 dark:text-emerald-300" : source.state === "limited" ? "text-amber-700 dark:text-amber-300" : "text-red-700 dark:text-red-300"}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
              {label}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-neutral-500">
            {source.description}
          </p>
          <p className="mt-2 text-[10px] text-neutral-400">
            {source.followCount
              ? `${source.followCount} follow${source.followCount === 1 ? "" : "s"}`
              : "No follows yet"}
            {source.lastCheckedAt
              ? ` · checked ${relativeTime(source.lastCheckedAt)}`
              : ""}
          </p>
          {source.error && (
            <p
              className="mt-1 line-clamp-2 text-[10px] text-amber-700 dark:text-amber-300"
              title={source.error}
            >
              {source.error}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function RadarLoading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse">
      <div className="h-9 w-80 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
      <div className="mt-4 space-y-3">
        {[1, 2, 3].map((key) => (
          <div
            key={key}
            className="h-36 rounded-xl bg-white ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
          />
        ))}
      </div>
    </div>
  );
}
function RadarEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: () => void;
}) {
  return (
    <div
      data-testid="radar-empty-state"
      className="grid min-h-[24rem] place-items-center rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-8 text-center dark:border-neutral-700 dark:bg-neutral-900/30"
    >
      <div className="max-w-sm">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
          <Icon name="radar" size={25} />
        </span>
        <h2 className="mt-4 text-base font-semibold">{title}</h2>
        <p className="mt-2 text-xs leading-5 text-neutral-500">{description}</p>
        {action && (
          <button
            className="btn btn-primary mt-5 h-9 gap-1.5 bg-indigo-600 px-4 text-xs text-white hover:bg-indigo-500"
            onClick={action}
          >
            <Icon name="plus" size={14} /> Follow something
          </button>
        )}
      </div>
    </div>
  );
}
