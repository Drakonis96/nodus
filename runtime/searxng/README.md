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

`settings.yml` keeps a curated list: the general engines (`duckduckgo web`,
`brave`, `bing`, `yahoo`, `seznam`, `wikipedia`) and the scholarly ones (`arxiv`,
`semantic scholar`, `openalex`, `pubmed`, `europepmc`, `google scholar`;
`crossref` ships disabled). `qwant` is out (it returned nothing in every measured
campaign), `marginalia` needs an API key, and `mojeek` and `startpage` answered
with nothing at all.

The general engines are the fragile half, and that is a property of scraping
search engines rather than of this integration. Two measurements of 2026-09-26
shaped the list:

- The plain `duckduckgo` engine answered the first query of every session with a
  CAPTCHA and never returned a result, while `duckduckgo web` — the same index
  reached with a browser fingerprint through `curl_cffi` — returned ten results
  **in the same invocation**. The plain engine is therefore not in the list: it
  only contributed the CAPTCHA, the wait and a `web_engine_blocked` limitation on
  every run. Yahoo and Seznam answered throughout and stayed.
- Brave is the opposite: it serves one burst after a long idle and then
  rate-limits itself, and the API-backed engines never degrade at all. Two changes
  were tried and reverted because they made retrieval worse: putting the scholarly
  engines inside the general category (the academic consensus crowded the open web
  out of the answer) and rescuing an empty general query through them.

With the list as it stands, the question that had failed twice with no evidence at
all — the entry-into-application dates of the EU AI Act — was answered from six
real pages, including the European Commission's own service desk, in one round and
ten seconds.

## EU legal acts

EUR-Lex renders its pages client-side: a reader gets an empty document, which is
why the first campaigns cited a reprint of the AI Act instead of the regulation.
The Publications Office serves the same act as a document once it is asked for the
right content type and language, so `electron/websearch/webFetch.ts` maps an ELI
path (`/eli/reg/2024/1689/oj/spa`) or a `?uri=CELEX:…` reference to
`publications.europa.eu/resource/celex/32024R1689` with
`Accept: application/xhtml+xml` and the act's own language. The citation keeps the
EUR-Lex address, which the app's Browser renders normally.

## Verifying it

`node scripts/verify-managed-searxng.mjs` starts the staged runtime the way the
application does, checks that it answers only on loopback, that a request without
the token is refused, that a real search returns JSON results, and that killing
the parent with `SIGKILL` leaves no orphan. `--disposable-ci` uses a throwaway
session directory, which is what the platform workflow runs.

## Keeping the pin current

`node scripts/check-searxng-health.mjs` answers the two maintenance questions
together: it compares the pinned commit with the tip of upstream's default branch,
boots the staged runtime and fires three fixed queries (one humanities, one current
affairs, one scholarly), then reports per engine how many results it contributed and
why it was unresponsive.

**An engine that refuses, throttles or CAPTCHAs is reported and is not an error.**
That is what engines do, the application already surfaces it per turn, and no bump
fixes it. The check alerts only on the version signal and genuine breakage:

- the runtime does not boot, or none of the scholarly APIs answer at all;
- an engine reports a parsing error — the thing an upstream bump fixes;
- the pin has aged past `--max-pin-age-days` (default 90) while upstream has moved.

`.github/workflows/searxng-health.yml` runs it weekly, keeps the JSON as an artifact
and comments on one standing issue instead of opening a new one every week. A runner
is a datacenter address, which the scraped engines treat harshly, so nothing about
the engines themselves is concluded from a runner; `--min-engines N` (off by default)
is there for a maintainer who wants a stricter reading on a real machine.

**The bump itself is a reviewed change, never an automatic one.** The pinned commit
and the hashed lock are what make the shipped runtime reproducible and keep an
unvetted upstream release out of a signed application, so the procedure is: read the
canary's parser-rot signal, bump `manifest.json` (commit, date, tarball URL and its
SHA-256), run `npm run research:runtime`, re-run the canary on a real machine with
`--min-engines 3`, and open a pull request with the before/after table. The platform
workflow then re-verifies all four systems before anyone merges.

## Known gaps

- Run-to-run stability of the evidence set is still below the bar set for this
  work; the numbers and the experiment that would settle it are in
  `docs/research-evidence/web-search-acceptance.md`.
- The general engines can still all be blocked at once by an address that has
  searched a great deal; an optional API-keyed provider (Brave's own API serves
  the same index) is the durable fix, and it is a product decision.
- EU legal acts are covered; other official portals with client-side rendering
  (national gazettes, some ministries) are not, and would need the same kind of
  documented API route one at a time.
