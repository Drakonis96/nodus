# Managed Zotero MCP

Nodus pins Zotero MCP 0.13.0 at `62335504262f4239961c4e782e342bd3bab4d5b2`.
`manifest.json` records the upstream source archive and the four CPython 3.12.14
python-build-standalone 20260901 artifact hashes. Builds run on the target OS/CPU.
No global Python installation, user configuration or semantic model download is required.

Run `node scripts/prepare-zotero-mcp.mjs` to build the current native target.
Runtime dependencies are hash locked with `uv pip compile requirements.in --universal
--python-version 3.12 --generate-hashes --output-file requirements.lock`.
The build tools are locked separately. bibtexparser 1.4.4 only publishes an sdist;
it is built with those tools and disabled build isolation, so pip cannot resolve
unlocked build dependencies. Other dependencies require wheels.

`serve.py` deliberately does not import upstream's CLI, server registration,
configuration, local SQLite discovery, lifespan, update or semantic-index code.
It uses upstream's PDF extraction implementation and FastMCP to expose exactly
four bounded read operations over stdio. Nodus supplies an immutable manifest
with explicit loopback `/api` endpoint, library identity, item/attachment versions
and hashes of staged PDF files. Unknown identities fail before any HTTP request.
No library search, writes, notes enumeration or arbitrary path parameter exists.
This is an adapted distribution, not the default upstream server.

`node scripts/verify-managed-zotero-mcp.mjs` checks the real private Python process
under macOS Seatbelt against a synthetic HTTP fixture. It does not represent
integration with a running Zotero application or testing of another platform.

Upstream MIT license, dependency license files and CPython's license files are
retained in the runtime. `runtime.json` inventories the exact distributed files
and their SHA-256 hashes. Licensing review and native installer/signing checks
remain release gates; the development bundle is not a signed distribution.
