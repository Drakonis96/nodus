# `@nodusresearch/capability-api`

The contract shared by Nodus, the skill marketplace CI and every capability plugin.
One package so that the application, the packages it installs and the pipeline that
publishes them cannot drift apart about what a capability is.

It has no Electron dependency, and **no published plugin bundle depends on it at
runtime**: plugins consume it to build and to test.

## What is in here

| Module | What it owns |
| --- | --- |
| `limits` | Every number the host, the plugins and CI must agree on. |
| `json` | The JSON Schema subset a tool may declare, plus semver helpers. |
| `identifiers` | Capability ids, the reserved `nodus:` namespace, legacy short names. |
| `permissions` | `TrustedPermissionSetV2`, its fingerprint and expansion check. |
| `views` | `ViewDocumentV1` — declarative views, no HTML and no behaviour. |
| `artifacts` | The artifact envelope, model visibility and the projection sanitizer. |
| `chat` | The generic reply AST, chat contracts and the typed hook mutations. |
| `settings` | Plugin-declared configuration panels. |
| `manifest` | `PluginManifestV2` and `CapabilityManifestV2` validators. |
| `protocol` | The host ↔ worker wire format. |
| `signature` | Ed25519 release manifest verification. |
| `worker` | The `CapabilityWorkerV2` interface and the host proxy it is given. |
| `maps` | Bounded geographic inputs, approved provider queries, SVG maps and provenance. |
| `conformance` | Fixtures a plugin runs against its own worker in its own tests. |

## Two runtimes, one API

`javascript-sandbox-v1` (capability API 1) is unchanged and remains the only route for
community plugins: Chromium-isolated, no Node, no filesystem, no child processes.

`nodus-trusted-worker-v1` (capability API 2) runs in a `utilityProcess` and is reserved
to packages signed by NodusResearch.

> **The signature is the security boundary.** A v2 worker is first-party code with
> roughly the privilege of an application update. The separate process buys fault
> isolation, cancellation and hard limits — it is not a security sandbox and must not be
> documented as one.

A v1 package cannot select the privileged runtime, and no package other than a signed
NodusResearch one may provide `nodus:chemistry`, `nodus:legal` or `nodus:genomics`.
`nodus:svg`, `nodus:image`, `nodus:3d` and `nodus:maps` belong to the core: they can be depended on, never
provided.

## Authoring a capability

```ts
import { defineCapability, defineCapabilityManifest } from '@nodusresearch/capability-api';

export const manifest = defineCapabilityManifest({
  schemaVersion: 2,
  id: 'chemistry',
  provides: 'nodus:chemistry',
  version: '2.0.0',
  description: 'Verified chemistry identity, drawing and export.',
  runtime: { kind: 'nodus-trusted-worker-v1', protocol: 1, entry: 'worker.js' },
  requires: [{ id: 'nodus:svg', minVersion: '1.0.0', maxVersionExclusive: '2.0.0' }],
  tools: [/* … */],
  artifacts: [/* … */],
  permissions: { /* everything absent is denied */ },
});

export default defineCapability(host => ({
  async health() { return { status: 'ready', dataVersion: 1 }; },
  async invoke({ toolId, input }) { /* … */ },
  async renderArtifact({ data }) { /* returns a ViewDocumentV1 */ },
  async shutdown() {},
}));
```

Then, in the package's own tests:

```ts
import { conformanceFailures, runConformanceSuite } from '@nodusresearch/capability-api';

const findings = await runConformanceSuite(manifest, worker, { invocations, artifacts });
assert.deepEqual(conformanceFailures(findings), []);
```

## Versioning

Breaking changes to existing limits, wire formats or accepted contracts require a major
version and an updated `capabilityApi`. Optional host channels and schema features use
a minor version when existing valid packages remain compatible. The marketplace pins
the SDK at an exact version and consumes generated validators from the same source.

SDK 2.1 adds `host.maps.retrieve` / `host.maps.render`, explicit `maps` permissions,
and bounded array schemas (`minItems` / `maxItems`, camelCase field names). The wire
protocol and `compatibility.capabilityApi: 2` remain unchanged. Depend on `nodus:maps`
1.x to reject hosts that lack this service; this development implementation is not a
claim that an already published Nodus 5.3.2 contains it. See
[the map contract](../../docs/capability-maps.md) for inputs, provenance and restrictions.

## SDK 2.2: native visual review

`host.vision.prepareImages` and `host.vision.reviewImages` add a permission-gated, turn-scoped public/generated image relevance service. Declare `vision: { maxRounds: 1..3 }`; network sources require their own reviewed endpoints. See [the tool contract](../../docs/capability-vision.md). No API v1 network/model privileges change.
