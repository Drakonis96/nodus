const CANONICAL_HOST = 'nodusresearch.com';
const INDEX_DOCUMENT = 'index.html';

export function canonicalRequestUrl(requestUrl) {
  const canonical = new URL(requestUrl);
  let changed = false;

  if (canonical.protocol !== 'https:') {
    canonical.protocol = 'https:';
    changed = true;
  }

  if (canonical.hostname === `www.${CANONICAL_HOST}`) {
    canonical.hostname = CANONICAL_HOST;
    changed = true;
  }

  if (canonical.pathname.endsWith(`/${INDEX_DOCUMENT}`)) {
    canonical.pathname = canonical.pathname.slice(0, -INDEX_DOCUMENT.length);
    changed = true;
  }

  return changed ? canonical : null;
}

export default {
  async fetch(request) {
    const canonical = canonicalRequestUrl(request.url);
    if (canonical) {
      return Response.redirect(canonical.toString(), 308);
    }

    return fetch(request);
  },
};
