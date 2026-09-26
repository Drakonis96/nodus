# Web search in Research Chat — acceptance record

The web step turns Research Chat into a pipeline that can leave the library when
it needs to: a packaged SearXNG discovers candidate pages, Nodus merges and
deduplicates them, reads the ones worth reading, extracts passages, keeps their
provenance, and shows every step in the activity balloon. This file records what
was measured, what the numbers say, and what is still open. It is written to be
read with the code: the promises live in `electron/websearch/`,
`shared/webResearchRanking.ts` and `runtime/searxng/`.

## How it is measured

`scripts/research-web-quality-campaign.mjs` runs the application's own pipeline —
the planning prompts, the managed SearXNG, the bounded fetch, the extraction, the
ranking and the passage selection — over a fixed question set, with DeepSeek flash
as the model, bge-m3 embeddings and a second model pass that rates every chosen
passage 0–2 ("would an expert writing a careful answer use it?"). It reports, per
question: precision (share of passages rated ≥1), strong (share rated 2), distinct
relevant sources, domains, the share of the evidence a single page supplies,
redundancy, latency per phase and the health of every engine. Paid calls go
through a durable ledger with a hard limit.

Keys come from the installed profile, never from the repository:

```
./node_modules/.bin/electron scripts/with-nodus-keys.cjs --providers deepseek,openrouter -- \
  node scripts/research-web-quality-campaign.mjs --out artifacts/web-campaign/<name> \
  --repeats 1 --only 1 --depth balanced
```

Two lessons about the harness, learned the hard way:

- **Pace it.** A campaign that fires every question back to back issues hundreds of
  queries per minute and burns the engines; the results then describe the harness,
  not the product. One question per invocation with a pause between them is what a
  person does.
- **Do not compare across hours.** The material available decays as a machine
  hammers the engines: for the same four questions, the documents found fell from
  309/174/126 to 168/98/77 in about two hours. Single-run noise on precision and
  strong is ±0.4. Any comparison of quality needs the configurations alternating
  *within* one session and at least three repeats per question.

## What was measured

**Burst runs (2026-09-25, `artifacts/web-campaign/run-1|run-2`).** Twelve questions
× three repeats, fired without pause: 288 queries in 6.3 minutes (~46/min, ~500
engine requests per minute). The scraped engines collapsed — DuckDuckGo with 50
CAPTCHAs and 125 suspensions, Brave with 0 results and 204 suspensions, PubMed and
Semantic Scholar throttled — while the API-backed engines never degraded. Precision
by question ranged 0.38–1.00, strong 0.00–0.67, and the same question repeated
minutes apart shared no passage URLs at all.

**Paced baseline (2026-09-26, `paced-*`).** The same pipeline, one question per
invocation, three minutes apart, right after the burst: precision 1.00 / 1.00 /
1.00 / 1.00 for q1 / q3 / q5 / q12, strong 0.88 / 1.00 / 0.75 / 1.00, relevant
sources 4 / 2 / 3 / 1, the dominant page 0.38 / 0.75 / 0.50 / 1.00, latency 19.5 /
20.1 / 12.9 / 11.0 s. The ceiling was high; the distribution was not. Half the read
budget went to hosts that answer with a login wall or a bot check, and one page
often supplied most of the evidence.

**What the fixes changed (`stage1-*` … `final-*`, then the rounds below).** The
changes that survived their own measurement:

- a site that refuses (a bot check) or fails twice keeps none of the remaining read
  budget in the same step, and walled aggregators (JSTOR, SSRN, ScienceDirect,
  ResearchGate, academia.edu) are listed as found but never read — they produced
  zero passages or a block every time they were tried;
- a slot left by a failed read goes to the next candidate from another site, within
  the round's own budget (an earlier version of this loop over-read, and diluting
  the shortlist cost more than the extra pages gave);
- evidence spreads across pages and domains instead of piling on one, with the
  passages that merely give background capped at a third of the answer;
- SciELO and Redalyc count as scholarly under any country domain — `scielo.org.mx`,
  which carried the best answer of the night, scored zero before this — while the
  bibliographic indexes (Dialnet, Latindex) are listed but never read: their pages
  are records, not text, and promoting them put two unquotable passages into an
  answer before the rounds caught it;
- the citation rules of all fifteen packs state that `pasajes_web` are pages read
  from the open Internet in this turn, not the library, to be cited with their own
  citation and named against the library when they disagree.

Three changes were measured and reverted because the data refused them:

- putting the scholarly engines inside the general category: the academic consensus
  crowds the open web out of the answer (the EU AI Act question fell to precision
  0.00);
- rescuing an empty general query through the scholarly engines, in both variants:
  the same question ended with no evidence, and a sociology question with a single
  domain;
- demoting commercial publishers below open repositories: reads shifted to
  biomedical APIs and a humanities question fell from precision 1.00 to 0.60.

## What the numbers say today

With the finished change set, over two paced rounds (four questions each, one
question per invocation with three minutes between them and four minutes between
rounds), plus the two runs that confirmed the last correction:

| Question | Round | Precision | Strong | Relevant sources | Domains | Dominant page | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Represión franquista | A | 0.50 | 0.50 | 2 | 3 | 0.50 | 24.8 s |
| Halbwachs / memoria colectiva | A | 1.00 | 0.75 | 4 | 3 | 0.25 | 30.8 s |
| Críticas a Putnam | A | 1.00 | 0.67 | 2 | 1 | 0.67 | 13.1 s |
| AI Act: plazos | A | — | — | 0 | 0 | — | 28.3 s |
| Represión franquista | B | 1.00 | 0.67 | 3 | 2 | 0.33 | 24.9 s |
| Halbwachs / memoria colectiva | B | 0.75 | 0.25 | 2 | 3 | 0.50 | 25.3 s |
| Críticas a Putnam | B | 0.67 | 0.67 | 1 | 2 | 0.67 | 17.1 s |
| AI Act: plazos | B | — | — | 0 | 0 | — | 14.8 s |
| Represión franquista (after the record-index fix) | — | 1.00 | 0.67 | 3 | 3 | 0.33 | 14.3 s |
| AI Act: plazos (same run) | — | 1.00 | 0.00 | 1 | 1 | 1.00 | 10.9 s |

Run-to-run stability of the evidence set, the same question in rounds A and B:
Jaccard 0.50 (q1), 0.17 (q3), 0.33 (q5) — better than the 0.00 the burst runs
produced, still below the 0.6 this work set as its bar.

Against the bar this work set for itself:

| Bar | State |
| --- | --- |
| ≥80 % of passages relevant | Met in 5 of the 8 round runs and in the last two; the current-affairs question is the exception |
| ≥3 distinct relevant sources on non-trivial questions | **Not met**: 2 of 8 round runs |
| No page supplies >40 % of the evidence | **Not met**: 2 of 8 round runs (0.25–0.67 across them) |
| Run-to-run stability (URL Jaccard ≥0.6) | **Not met**: 0.17–0.50 |
| p50 web step <15 s in balanced | **Not met**: 10.9–30.8 s, median ~22 s |

The two rounds also recorded the engine health that produced them: Brave
rate-limited itself in every invocation, DuckDuckGo answered with a CAPTCHA in
every one, Google Scholar began refusing as well, and Bing alone supplied 10–50
results per question while OpenAlex, EuropePMC and Semantic Scholar carried the
rest. The AI Act question read only academic landing pages — the pages the
official sources would have been found on never reached the pool — and the
passage rater rejected everything it saw there, twice.

## What is still open

1. **Stability.** The same question asked twice still assembles a different set of
   pages. The mechanism is understood (discovery depends on which engines answer,
   and the reformulation round depends on what the first round found) but not
   solved. The experiment that would settle it: alternate the two configurations
   within one session, three repeats per question, and compare the evidence sets.
2. **Current affairs.** With DuckDuckGo answering CAPTCHA and Brave rate-limiting
   itself, the open-web layer is Bing alone, so a question about today's rules
   rests on one source. An API-keyed search provider is the only real fix, and it
   is a product decision.
3. **Official portals.** EUR-Lex returns no text through the extractor, so the
   answer leans on a reprint of the regulation elsewhere. This is an extraction
   gap, not a ranking one.
4. **The packaged runtime on every platform.** `scripts/verify-managed-searxng.mjs`
   passes on macOS arm64 (ready, loopback only, 403 without the token, real JSON
   results, clean stop, no orphan after `SIGKILL` of the parent). The workflow step
   and the installer checks for Windows, Linux and Intel macOS are written but have
   not run: that needs the branch pushed.
