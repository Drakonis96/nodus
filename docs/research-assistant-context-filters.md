# Research Assistant source filters

The **Sources** button sits between the context preset (Synthesis, Authors, etc.) and Skills. It opens a searchable author/work selector using the vault accent. Filters are off by default. Applying a filter to an existing conversation persists it immediately in `selection_json`; reopening that conversation restores it. A new conversation starts without restrictions. Context presets preserve the independently selected source filter.

Selection semantics:

- Any selected author may match, and any selected work may match.
- When both selectors contain IDs, their intersection is used.
- Authors resolve through canonical `work_authors` identities with the author role. Mentions, citations of an author and editorship alone do not count as authorship.
- Archived, missing or deleted sources cannot match. An enabled empty filter or an empty intersection retrieves no corpus context; it never falls back to the whole vault.
- Disabled filters retain the existing retrieval behavior.

The backend resolves the current permitted works independently of the UI and applies the boundary before top-K ranking to ideas, document profiles, summary vectors, lexical documents and semantic/lexical passages. Document-routed and exact-support passage retrieval remain inside that boundary. Unavailable embeddings and no semantic matches only trigger fallback inside the selected corpus.

The assembled context restricts occurrences and evidence too: a global idea shared by two works does not bring the excluded work's occurrence or quotation with it. Themes, author idea associations, gaps, source-backed edges, full texts and summaries are constrained to the selected works. Relations without work-level provenance are omitted while filters are active; filtered reading routes list the selected works chronologically instead of importing a plan ranked from the entire corpus. The prompt instructs the model to acknowledge insufficient evidence instead of supplementing it from other sources.

Conversation history uses a context key with normalized source IDs. Changing source restrictions prevents earlier messages with a different context key from being sent in the new request. Disabling a filter removes its draft IDs from that key. Research Assistant filters do not alter Nodi, global settings, the genealogy assistant, or other retrieval callers.

Validation (no paid inference):

- `node scripts/test-research-source-filters.mjs`: 15 complete context assemblies against a real temporary SQLite database. Covers higher-ranked excluded vectors, author/work intersection, shared ideas/evidence/themes, disallowed gap evidence, empty/missing/archived selections, lexical fallback, persistence, and disabled/Nodi parity. Network requests are forbidden.
- `node scripts/verify-research-source-filters.mjs`: production UI in the local harness, testing opt-in, searching, intersection counts, persistence/reload, history separation, Escape/cancel/focus return, new-conversation reset, accent and light/dark/compact layout.
- Existing hierarchical retrieval, document-profile persistence, IPC contracts and Research Assistant checks run alongside type checking and a production build.

The UI harness runs at `http://127.0.0.1:5198/visual-tests/research-assistant-harness.html`; screenshots are saved under `artifacts/research-assistant/source-filter-*.png`.
