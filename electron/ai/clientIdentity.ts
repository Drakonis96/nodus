import { randomUUID } from 'node:crypto';

/**
 * How Nodus identifies itself to third-party HTTP APIs.
 *
 * The version is registered once from `app.getVersion()` instead of importing
 * `electron` here: this module is reached from `electron/ai/providers.ts`, which
 * the `node --test` harnesses bundle as an esbuild entry point, and there
 * `electron` resolves to a path string with no `app` on it. Hard-coding the
 * number is not an option either — `libraryCslStyles.ts` announced `Nodus/4.2.3`
 * to GitHub for eleven releases because the string was typed in by hand.
 */
let clientVersion = process.env.npm_package_version?.trim() || '0.0.0-dev';

/** Called once at startup from main.ts, so the User-Agent tracks package.json. */
export function registerNodusClientVersion(version: string): void {
  const trimmed = version.trim();
  if (trimmed) clientVersion = trimmed;
}

/** `Nodus/5.1.6`. Product name and running version — nothing about the user. */
export function nodusUserAgent(): string {
  return `Nodus/${clientVersion}`;
}

/**
 * `x-opencode-session`: the grouping key OpenCode Go asks every client to send so
 * it can optimise its service. Requests missing it may be rejected from
 * 2026-09-06, which would take down the whole OpenCode Go provider — inference on
 * all three protocols plus the unauthenticated catalogue call in Settings.
 *
 * Nodus has no chat conversations, so the closest equivalent is a unit of work:
 * one deep scan of a work, one Deep Research report, one Nodi thread. Job ids are
 * shaped `<root>:<stage>:<chunk>…`, so the root is what groups a run's many
 * chunked calls under a single session; calls with no job id share one id for the
 * running process.
 *
 * What travels is always a fresh random UUID, never the job id itself: job ids are
 * content-free but they still spell out which Nodus pipeline is running, and that
 * is not OpenCode's business. Nothing is persisted, so no id survives a restart
 * and none can act as a stable identifier for the user.
 */
const SESSION_LIMIT = 256;
const sessions = new Map<string, string>();
const processSession = randomUUID();

export function openCodeGoSessionId(jobId?: string | null): string {
  const root = jobId?.split(':')[0]?.trim();
  if (!root) return processSession;
  const existing = sessions.get(root);
  if (existing) return existing;
  const id = randomUUID();
  sessions.set(root, id);
  // Bounded: a corpus-wide run opens one root per work.
  if (sessions.size > SESSION_LIMIT) {
    const oldest = sessions.keys().next().value;
    if (oldest !== undefined) sessions.delete(oldest);
  }
  return id;
}
