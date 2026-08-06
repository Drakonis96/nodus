/**
 * Announcements: the one channel that can reach every install between releases.
 *
 * A release note explains a version that has already shipped. This is for everything
 * that cannot wait for one — a survey worth answering, a provider that broke overnight,
 * a warning about a build. The list is published as a static JSON next to the website
 * (see {@link ANNOUNCEMENTS_URL}), so adding a notice is a pull request and merging it
 * is the deployment.
 *
 * Everything below treats that file as UNTRUSTED input, because it arrives over the
 * network and is rendered in the app's own chrome. Ids are slugs, dates have a fixed
 * shape, links must be https, every string is length-capped, and a notice that fails
 * any of it is dropped rather than repaired. Bodies are rendered as plain text — never
 * as markup — which is enforced at the call site, not here.
 *
 * Copy is carried per language rather than as t() keys: a notice written after this
 * build shipped has no key for t() to look up. Spanish and English are required (English
 * is the fallback every other language already leans on); the remaining six are enforced
 * by scripts/test-announcements.mjs on the PR that adds the notice, so publishing in one
 * language alone fails CI rather than reaching users half-translated.
 */

/** Where the published list lives. Served by GitHub Pages from `site/data/`. */
export const ANNOUNCEMENTS_URL = 'https://drakonis96.github.io/nodus/data/announcements.json';

/** Every language a notice must be written in before it may be published. */
export const ANNOUNCEMENT_LANGUAGES = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'] as const;
export type AnnouncementLanguage = (typeof ANNOUNCEMENT_LANGUAGES)[number];

/**
 * The two languages a notice cannot render without. Spanish is the source and English
 * is the fallback for every other interface language, so a notice carrying both is
 * readable by everyone even if a translation is missing. CI still demands all eight.
 */
export const REQUIRED_ANNOUNCEMENT_LANGUAGES: readonly AnnouncementLanguage[] = ['es', 'en'];

/** 'warning' earns the amber dot and sorts above 'info' on the same day. */
export type AnnouncementSeverity = 'info' | 'warning';

export interface AnnouncementCopy {
  title: string;
  body: string;
  /** Label for {@link Announcement.url}; falls back to a generic "Open link". */
  linkLabel?: string;
}

export interface Announcement {
  /** Stable, never reused: it is the identity the read mark hangs off. */
  id: string;
  /** ISO date (YYYY-MM-DD) the notice was published. */
  date: string;
  severity: AnnouncementSeverity;
  /** An https link — a survey, an issue, a release. Optional. */
  url?: string;
  /** ISO date (YYYY-MM-DD) after which the notice disappears on its own. */
  expiresAt?: string;
  /** Lowest app version the notice applies to, inclusive. */
  minVersion?: string;
  /** Highest app version the notice applies to, inclusive. */
  maxVersion?: string;
  copy: Partial<Record<AnnouncementLanguage, AnnouncementCopy>>;
}

/** An announcement as the renderer needs it: the notice plus this install's read mark. */
export interface AnnouncementEntry extends Announcement {
  read: boolean;
}

const MAX_ANNOUNCEMENTS = 50;
const MAX_TITLE = 120;
const MAX_BODY = 600;
const MAX_LINK_LABEL = 60;
const MAX_URL = 300;
const ID_SHAPE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_SHAPE = /^\d+(\.\d+){0,3}$/;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // Collapse whitespace so a stray newline in the JSON cannot fake a paragraph break
  // or pad a title past its cap after trimming.
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function cleanDate(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE_SHAPE.test(value)) return null;
  // Shape is not validity: 2026-02-31 matches the pattern and is not a day.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function cleanVersion(value: unknown): string | undefined {
  return typeof value === 'string' && VERSION_SHAPE.test(value) ? value : undefined;
}

/**
 * Only https, and only a URL the platform's parser agrees is one. This is the single
 * place a published file gets to influence where a click goes, so `javascript:`,
 * `file:` and a bare hostname all have to fail here.
 */
function cleanUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_URL) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function cleanCopy(value: unknown): AnnouncementCopy | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const title = cleanText(raw.title, MAX_TITLE);
  const body = cleanText(raw.body, MAX_BODY);
  if (!title || !body) return null;
  const linkLabel = cleanText(raw.linkLabel, MAX_LINK_LABEL);
  return linkLabel ? { title, body, linkLabel } : { title, body };
}

function parseAnnouncement(value: unknown): Announcement | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  const id = typeof raw.id === 'string' && ID_SHAPE.test(raw.id) ? raw.id : null;
  const date = cleanDate(raw.date);
  if (!id || !date) return null;

  const copy: Partial<Record<AnnouncementLanguage, AnnouncementCopy>> = {};
  for (const language of ANNOUNCEMENT_LANGUAGES) {
    const parsed = cleanCopy((raw.copy as Record<string, unknown> | undefined)?.[language]);
    if (parsed) copy[language] = parsed;
  }
  if (REQUIRED_ANNOUNCEMENT_LANGUAGES.some((language) => !copy[language])) return null;

  const expiresAt = cleanDate(raw.expiresAt) ?? undefined;
  const url = cleanUrl(raw.url);
  return {
    id,
    date,
    severity: raw.severity === 'warning' ? 'warning' : 'info',
    ...(url ? { url } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(cleanVersion(raw.minVersion) ? { minVersion: cleanVersion(raw.minVersion) } : {}),
    ...(cleanVersion(raw.maxVersion) ? { maxVersion: cleanVersion(raw.maxVersion) } : {}),
    copy,
  };
}

export interface AnnouncementsParse {
  announcements: Announcement[];
  /** How many entries were dropped, so a malformed file is logged rather than silent. */
  rejected: number;
}

/**
 * Read the published file. Accepts either a bare array or `{ notices: [...] }`, and
 * never throws: a truncated or hostile file yields an empty list, which the caller
 * treats the same as "nothing to announce".
 */
export function parseAnnouncements(raw: unknown): AnnouncementsParse {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { notices?: unknown }).notices)
      ? (raw as { notices: unknown[] }).notices
      : null;
  if (!list) return { announcements: [], rejected: 0 };

  const announcements: Announcement[] = [];
  let rejected = 0;
  for (const item of list.slice(0, MAX_ANNOUNCEMENTS)) {
    const parsed = parseAnnouncement(item);
    if (parsed && !announcements.some((existing) => existing.id === parsed.id)) announcements.push(parsed);
    else rejected += 1;
  }
  return { announcements, rejected };
}

/** Numeric-segment comparison; both sides have already matched VERSION_SHAPE. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** Does this notice still apply to this build, on this day? */
export function isAnnouncementVisible(
  announcement: Announcement,
  context: { now: number; version: string },
): boolean {
  if (announcement.expiresAt) {
    const today = new Date(context.now).toISOString().slice(0, 10);
    if (today > announcement.expiresAt) return false;
  }
  // An unparseable app version must not silently hide every targeted notice, so the
  // version gates only apply when there is a version to compare against.
  const version = cleanVersion(context.version);
  if (version) {
    if (announcement.minVersion && compareVersions(version, announcement.minVersion) < 0) return false;
    if (announcement.maxVersion && compareVersions(version, announcement.maxVersion) > 0) return false;
  }
  return true;
}

/** Newest first; a warning outranks an info published the same day. */
export function sortAnnouncements<T extends Announcement>(list: readonly T[]): T[] {
  const weight = (item: Announcement) => (item.severity === 'warning' ? 0 : 1);
  return [...list].sort((a, b) => (
    b.date.localeCompare(a.date)
    || weight(a) - weight(b)
    || a.id.localeCompare(b.id)
  ));
}

/**
 * The copy to render, falling back English-then-Spanish. The parser guarantees both
 * exist, so this never returns undefined for a notice that got this far.
 */
export function announcementCopyFor(
  announcement: Announcement,
  language: string,
): AnnouncementCopy {
  const copy = announcement.copy as Record<string, AnnouncementCopy | undefined>;
  return copy[language] ?? copy.en ?? copy.es!;
}
