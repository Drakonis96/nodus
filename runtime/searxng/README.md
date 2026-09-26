# Managed SearXNG

Research Chat's web step discovers pages through a SearXNG instance that ships
with the application. Nothing here is installed by the user, nothing listens
outside the loopback interface, and no request leaves the machine except the
searches themselves.

## What is pinned here

| File | What it pins |
| --- | --- |
| `manifest.json` | The upstream SearXNG commit, its date, its tarball URL and the SHA-256 of that tarball. |
| `requirements.in` | The direct Python dependencies, by version. |
| `requirements.lock` | The universal resolution for CPython 3.12 with hashes (`--only-binary :all:`), so a build cannot silently take a different wheel. |
| `settings.yml` | The base instance: loopback, JSON only, no limiter, no metrics, no autocomplete, no image proxy, and the curated engine list. |
| `serve.py` | The service Nodus starts: per-launch token, `127.0.0.1` only, port chosen by the kernel, exits when its parent closes stdin. |
| `shims/pwd.py` | Windows only: `searx.valkey` imports the Unix-only `pwd` module at import time. Valkey is disabled; the shim satisfies the import. |
| `license_inventory.py` | Collects the installed distributions' licence files and declared licences into `legal/` while staging. |

`runtime.json` (generated, next to the staged runtime) carries the upstream
commit and the adapter version, so a mismatch between what was built and what the
application expects is detected at start-up instead of at the first search.

## How it is staged

`npm run research:runtime` (and the packaging hook, `build/beforePack.cjs`) runs
`scripts/prepare-zotero-mcp.mjs`, which calls `stageSearxng()` from
`scripts/lib/prepare-searxng.mjs`. That phase:

1. downloads the pinned tarball (cached under `artifacts/zotero-mcp-downloads/`)
   and checks its SHA-256 against `manifest.json`;
2. installs `requirements.lock` into `build/zotero-mcp/searxng/dependencies`
   — a target of its own, independent of the Zotero MCP lock;
3. copies `searx/` from the tarball, writes `searx/version_frozen.py`, applies the
   Windows patches, records them in `searx/NODUS_MODIFICATIONS.txt`, and
   precompiles `.pyc` so start-up does not pay for compilation;
4. runs `license_inventory.py` and adds the section to `runtime.json` and to the
   build fingerprint.

The whole tree travels inside `extraResources` as `resources/zotero-mcp/searxng`.

## How it runs

`serve.py` starts under the private interpreter with `-I -B`, adds
`dependencies/` and its own directory to `sys.path`, writes a per-launch
`settings.yml` with a random `secret_key`, and serves the WSGI app through a
middleware that demands the `X-Nodus-Token` header. It prints
`{"ready": true, "port": N}` on stdout; `electron/websearch/searxngService.ts`
reads that line, keeps the token private to the process, and stops the child on
idle or when the application quits. A watch thread exits the process as soon as
stdin reaches EOF, so a crashed parent cannot leave an orphaned server behind.

The search API is `GET /search?q=…&format=json&categories=general|science` with
the token header. `unresponsive_engines` is reported to the caller and surfaced
as a limitation in the activity panel; a bot check is never worked around.

## Engines

`settings.yml` keeps a curated list: the general engines (`duckduckgo`, `brave`,
`bing`, `wikipedia`) and the scholarly ones (`arxiv`, `semantic scholar`,
`openalex`, `pubmed`, `europepmc`, `google scholar`; `crossref` ships disabled).
Startpage, Mojeek and `qwant` are out: upstream disables the first two for test
CAPTCHAs, and Qwant returned nothing in every measured campaign.

The general engines are the fragile half, and that is a property of scraping
search engines rather than of this integration. In the campaigns of 2026-09-26,
DuckDuckGo answered the first query of every session with a CAPTCHA and Brave
served one burst after a long idle and then rate-limited itself, while the
API-backed engines (arXiv, OpenAlex, EuropePMC, Google Scholar) never degraded —
including while the machine fired thousands of queries. Two changes were tried
and reverted because they made retrieval worse: putting the scholarly engines
inside the general category (the academic consensus crowded the open web out of
the answer) and rescuing an empty general query through them.

## Verifying it

`node scripts/verify-managed-searxng.mjs` starts the staged runtime the way the
application does, checks that it answers only on loopback, that a request without
the token is refused, that a real search returns JSON results, and that killing
the parent with `SIGKILL` leaves no orphan. `--disposable-ci` uses a throwaway
session directory, which is what the platform workflow runs.

## Known gaps

- Official legal portals (EUR-Lex) often extract to nothing: their text is
  rendered client-side, so the answer falls back to a reprint elsewhere.
- Questions about current affairs rest on few sources while the scraped general
  engines are blocked; an API-keyed search provider is the only real fix.
- Run-to-run stability of the evidence set is still below the bar set for this
  work; the numbers and the experiment that would settle it are in
  `docs/research-evidence/web-search-acceptance.md`.
