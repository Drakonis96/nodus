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
retained in the runtime. `runtime.json` inventories the locked payload before
application code signing. Signing changes Mach-O signature bytes; packaged macOS
identity is verified separately through the installer hash, Developer ID signature
and stapled notarization. The development runtime alone is not signed.

## Installed-byte notices

The build collects each wheel's actual license files and rejects missing evidence.
The matching full python-build-standalone archive supplies `PYTHON.json` and native
library notices, with a SHA-256 pin for each supported platform. Build-only pip,
setuptools and wheel are removed before inventorying the shipped interpreter.

Two 0.3.0 py-key-value wheels omit their Apache notice. `license_overrides.json`
records the release commit and exact copied text. The standalone 20260901 archive
also references but omits `LICENSE.zlib-ng.txt`; the supplement comes from the
CPython source-deps zlib-ng 2.2.4 archive pinned by that build's download manifest:
SHA-256 `00bbd88709bc416cb96160ab61d3e1c8f76e106799af7328d0fe434dc7dd5004`.
Its license file hashes to
`6c9f0d975b41afaa34d22f55bb8986ce69e5cb7ad327cb2b28820cd425edf5ee`.
Native tests on a disposable hosted runner are identified separately from the
macOS OS write-boundary test; they are not installation/uninstallation evidence.

Intel macOS has no cryptography 50 wheel (upstream dropped the target in 49).
Its native build keeps 50.0.1, compiles with Rust 1.93.0 and a SHA-256-pinned
OpenSSL 4.0.2 archive, statically links OpenSSL, and enforces Cargo.lock through
Maturin. Locked build tools are separate from runtime dependencies. The legal
bundle retains native OpenSSL provenance and the exact Rust dependency source
archives with their embedded licenses. The CI installs this compiler only in its
disposable Intel runner. See [upstream platform change](https://cryptography.io/en/49.0.0/changelog/)
and [static build instructions](https://cryptography.io/en/stable/installation/).
