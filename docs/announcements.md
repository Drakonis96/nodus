# Publishing an announcement

Announcements are the only channel that reaches installed copies of Nodus between
releases: a survey worth answering, a provider that broke overnight, a warning about a
specific build. They appear in the notifications panel, above the activity feed, and
stay unread until the reader opens them.

Adding a notice is a pull request. Merging it is the deployment.

## Where it lives

| | |
| --- | --- |
| Source of truth | [`site/data/announcements.json`](../site/data/announcements.json) |
| Published at | `https://nodusresearch.com/data/announcements.json` |
| Deployed by | [`.github/workflows/pages.yml`](../.github/workflows/pages.yml), on push to `main` touching `site/**` |
| Validated by | `scripts/test-announcements.mjs` (part of `npm test`) |
| Read by | [`electron/announcements.ts`](../electron/announcements.ts) |

## How to add one

Append an object to `notices`. Newest last or first does not matter — the app sorts by
date, newest first, with warnings ahead of infos published the same day.

```jsonc
{
  "id": "2026-09-teaching-survey",   // stable slug, NEVER reused
  "date": "2026-09-01",              // YYYY-MM-DD
  "severity": "info",                // "info" | "warning"
  "url": "https://forms.gle/…",      // optional, https only
  "expiresAt": "2026-10-15",         // optional; the notice vanishes on its own after this day
  "minVersion": "3.2.0",             // optional, inclusive
  "maxVersion": "3.3.1",             // optional, inclusive
  "copy": {
    "es": { "title": "…", "body": "…", "linkLabel": "Responder la encuesta" },
    "en": { "title": "…", "body": "…", "linkLabel": "Answer the survey" },
    "fr": { … }, "de": { … }, "pt": { … }, "pt-BR": { … }, "it": { … }, "tr": { … }
  }
}
```

**All eight languages are required.** `scripts/test-announcements.mjs` fails the PR if
one is missing, so a notice cannot reach users half-translated. At runtime the app is
more forgiving than CI — it needs only `es` and `en`, and falls back English-then-Spanish
— but that leniency exists for resilience, not as a way around the test.

Caps, enforced both by the test and by the parser: title 120 characters, body 600,
`linkLabel` 60, URL 300, and at most 50 notices in the file.

## What the app does with it

One conditional `GET` at startup (delayed, so it never competes with boot) and one on
each tick of the existing four-hour update timer. The response's `ETag` is stored and
sent back as `If-None-Match`, so the usual answer is a `304` with no body. The last good
payload is cached in `userData`, so the panel works offline.

Users can turn the whole thing off in **Settings › Updates and news**. When it is off,
no request is made at all.

## Rules worth keeping

- **Never reuse an `id`.** It is what the read mark hangs off; reusing one silently
  marks a new notice as already read for everyone who read the old one.
- **Never edit a notice's meaning in place.** Publish a new one. Editing changes what
  people who already read it think they read.
- **Prefer `expiresAt` to deleting.** Deleting an entry makes it vanish mid-read;
  expiry retires it predictably. Delete only once it has expired for everyone.
- **Bodies are plain text.** Markup is not rendered — it will show as literal
  characters.
- **Links open in the system browser**, and only `https:` ones survive the parser.

## Testing without publishing

Point the app at any URL, including a local file server:

```bash
NODUS_ANNOUNCEMENTS_URL=http://localhost:8080/announcements.json npm run dev
```
