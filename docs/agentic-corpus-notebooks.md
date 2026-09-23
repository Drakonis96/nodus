# Layered documentary research and notebooks

## Development contract

This work extends academic Research Chat and Deep Research. Other vault engines
retain their contracts. Documents and compatible passage indexes are shared;
ideas, profiles and notebooks retain their vault ownership. Internet discovery
is outside this implementation.

The implementation starts from `f54995e7` on a dedicated branch. The pull request
must remain draft, with incremental verified commits and pushes. No release,
tag, merge or rewrite of published history is part of this work.

## Audit findings

- Library v2 already provides immutable canonical IDs, source identities and
  aliases. Zotero identity includes library type, library ID and item key.
- `hierarchicalRetrieval` already combines independent lexical/vector lanes and
  rank fusion. Some lower-level repositories still interpret an empty ID list
  as unscoped; those boundaries must fail closed.
- The passage embedding pipeline keeps its queue in memory. Documentary Index
  independently prepares passages and publishes them with the profile. Basic
  preparation must become durable and independent of enriched analysis.
- Research Chat has saved conversations and source filters; Deep Research also
  retrieves through writing-workshop snapshots. Both paths need the same scope.
- Nodus exposes an MCP server; consuming Zotero MCP requires a separate client.
- The old startup registered `nodus://` before its profile override. A bootstrap
  now applies the isolated profile before loading the application graph.

## Isolation

`NODUS_ISOLATED_ROOT` requires a canonical root and matching `isolation.json`.
The bootstrap configures Electron storage and private temporary directories
before dynamically loading the application. Isolated startup skips protocol
registration, automatic integrations, credential recovery, updates and deferred
plugin migration. The operating-system harness separately restricts writes for
the process tree; setting environment variables alone is not sufficient.

`scripts/research-isolation.mjs` creates only fresh synthetic profiles. Its macOS
sandbox test performs a real denied write against a disposable sentinel, never
against production. Production Nodus, Zotero and MCP directories are denied.
Application testing must not begin until this check succeeds.

Only encrypted DeepSeek and OpenRouter credentials may be copied by a separate,
read-only fixture helper, following the user's explicit authorization. Never
load the production vault registry, preferences, databases or document corpus.
Real-model tests are limited to `deepseek-flash` and `baai/bge-m3` and a combined
USD 5 ceiling. No paid inference has been performed at this stage.

## Delivery checklist

- [ ] Isolated Electron and synthetic Zotero fixtures verified
- [ ] Managed Zotero MCP packaging and third-party notices
- [ ] Identity, source scope, evidence and preparation contracts
- [ ] Durable preparation and compatible shared indexes
- [ ] Shared retrieval and strict source boundaries
- [ ] Read-only scoped MCP integration and coexistence
- [ ] Academic notebooks and persistent source selections
- [ ] Presets, UI states and all translations
- [ ] Migrations, real Electron regression and provider evaluation

Checked items must describe executable, tested functionality, not designs.
