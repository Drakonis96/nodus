import { validateIsolatedRoot } from './isolatedProfile';

/** Test-only web: an isolated profile whose OS sandbox denies the internet can be
 * pointed at one loopback fixture that plays both SearXNG and the web pages.
 * Only a validated isolated profile honours it; normal startup never does. */
export function researchWebFixture(): { searchBase: string; token: string; origin: string } | null {
  const configured = process.env.NODUS_RESEARCH_WEB_FIXTURE;
  if (!configured) return null;
  const root = process.env.NODUS_ISOLATED_ROOT;
  if (!root || validateIsolatedRoot(root) !== process.env.NODUS_QA_ROOT) throw new Error('Unvalidated research web fixture');
  const endpoint = new URL(configured);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.port === '23119'
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !/^\/[a-f0-9-]{36}$/.test(endpoint.pathname)) throw new Error('Invalid research web fixture');
  return { searchBase: endpoint.href, token: endpoint.pathname.slice(1), origin: endpoint.origin };
}
