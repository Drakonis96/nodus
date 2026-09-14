# Read-only data and native models from sandboxed plugins

This extension keeps Capability API v1 runtimes in the existing ephemeral Chromium sandbox.
It adds no network, secret, writable storage or arbitrary filesystem permission. The same
contract is exported to marketplace validation from the Capability API SDK.

A capability may declare `assets` in `capability.json`:

```json
{"id":"reference-data","path":"assets/reference-data.json","mimeType":"application/json","bytes":1234,"sha256":"<64 lowercase hexadecimal characters>"}
```

Each path is exactly `assets/<slug>.json`, `.gltf`, or `.glb`, with the corresponding MIME type
`application/json`, `model/gltf+json`, or `model/gltf-binary`. Paths are capability-relative,
not user input. IDs and paths are unique. There are at most 64 assets per capability, bounded
by 2 MB per JSON, 16 MiB per glTF and 64 MiB per GLB, and 128 MiB total. Source scans keep the
existing 12 MB code budget and a separate 128 MiB asset budget. Executables, HTML, SVG,
symlinks, traversal, external references and unlisted files are not asset mechanisms.

Directory import and GitHub catalog retrieval read only declared regular files and verify
the exact byte length and SHA-256. Installed asset files are read-only. The runtime resolver
binds an asset reader to the capability's installed version/digest; callers supply only an
asset ID. Every read rechecks paths, regular-file status and SHA-256. Unknown IDs and assets
belonging to another capability cannot be read. No path is supplied to sandbox code.

`PluginPackage.files` retains its existing string transport: text assets are UTF-8, binary
GLB assets are canonical base64 **only in the transport**. On disk they are actual GLB bytes.
The runtime source never embeds binary data. The install path preserves exact manifest bytes,
including formatting, so an import/export round trip retains the package digest.

The sandbox API is `await host.assets.read(id)`. It only returns declared JSON under its
2 MB bound. Model bytes never enter sandbox or model context. Asset access has no write,
list, URL or path operation; undeclared/oversized/corrupted assets fail without fallback.

For native 3D output, the skill also declares `nodus:3d`, the tool declares result kind
`model`, and the runtime returns:

```json
{
  "kind":"model",
  "panels":[{"assetId":"objects","nodeIds":["object-a"],"title":"Objects","alt":"Two reference objects in their original frame."}],
  "metadata":{"provenance":"Package-defined inert source metadata"}
}
```

There may be 1–12 panels and 1–2,000 distinct stable IDs per panel, within the existing
256,000-character result bound. Each ID matches `nodes[].extras.id` in the selected asset.
Unknown, duplicate/ambiguous, cyclic or unreachable nodes fail. Parent transforms and
hierarchy are preserved; unselected mesh instances are removed from the active scene. Other
scenes are removed. Animated or skinned subsets are refused because their dependencies need
additional mapping. Geometry and provenance extras are preserved; there is no domain-specific
inference, mesh authoring or plugin-supplied viewer. Different coordinate frames remain in
separate panels. Future generic layer controls may use node IDs and inert extras.

The main process verifies every selected asset and checks every panel before writing any
attachment. It validates the selected GLB/glTF with `nodus:3d`, stores it alongside the saved
conversation, and returns attachment references to the existing `ChatModelViewer`. The viewer
uses the same model IPC and validation as trusted packages. Model attachments use the existing
64 MiB native model limit; ordinary file attachments retain their 10 MB limit. Saved-chat
reconciliation retains these model references. Disabled capabilities, stale/deleted chats,
invalid input, cancellation and missing assets never yield a claimed model.

Model-result history is projected to a static completion marker at the existing inference
boundary. Individual source contributor credits stay in application-managed presentation
and immutable model metadata; they are not sent back to a language model. Semantic queries
and non-personal registry metadata remain available separately.

The generic JSON-schema property validator also accepts bounded camelCase keys, alongside
legacy hyphenated keys, so tools can use names such as `labelMode`. Prototype-related property
names remain disallowed. No reply budgets or capability permissions were widened: the
application's existing sandboxed and metered call lanes remain in force.

Validation: `scripts/test-plugin-assets.mjs` tests declarations, hashes, model identities,
subsets and malformed inputs. `scripts/verify-anatomy-atlas.mjs` is an optional integration
fixture using `NODUS_MARKETPLACE_CHECKOUT`: it imports the actual marketplace package, executes
all four tools in real Chromium through two synthetic chat contexts, verifies native stored
models and digest round trips, and tests disabled capabilities, cancellation, symlinks and
corruption. The existing capability, store, chat, sandbox and worker suites remain required.

`scripts/verify-anatomy-viewer.mjs` additionally exercises the actual React result component
and existing native viewer in Chromium: selected-model Khronos validation, open, rotate,
reset and close. It refuses external requests and optionally saves visual QA captures under
`NODUS_ATLAS_QA_OUTPUT`. It uses the same marketplace checkout environment variable.
