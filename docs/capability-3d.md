# `nodus:3d` — interactive models in a conversation

A core capability, alongside `nodus:svg` and `nodus:image`. A package hands over a glTF or
GLB asset; Nodus validates it, stores it beside the conversation, and draws it. The package
never ships a renderer, a shader or a script, and there is no route by which it could.

It is generic on purpose. A molecule, a bone, a pot and a building are the same thing to
it, and no discipline is named anywhere in it — a `nodus:anatomy` would be exactly the
coupling that capability API v2 exists to remove. Anatomy, chemistry, archaeology and
heritage packages are expected to depend on this one rather than each carrying a viewer.

## What a package does

```jsonc
// capability.json
{
  "requires": [{ "id": "nodus:3d", "minVersion": "1.0.0", "maxVersionExclusive": "2.0.0" }],
  "permissions": { "models": true }
}
```

```js
// in the worker
const { attachmentId, bytes, info } = await host.models.store({
  bytes: glbBytes,            // Uint8Array
  mimeType: 'model/gltf-binary',
  name: 'scan.glb',
});

return {
  view: {
    schemaVersion: 1,
    summary: `A ${info.meshes}-mesh scan.`,
    nodes: [{
      kind: 'model',
      attachmentId,
      title: 'Scanned object',
      alt: 'A three-dimensional scan, rotatable in place.',
      name: 'scan.glb',
      mimeType: 'model/gltf-binary',
      bytes,
    }],
  },
};
```

`host.models.validate(...)` does the same checks without storing anything, for a package
that wants to reject an asset before it builds a whole result around it.

`alt` is required, not optional: a model is a picture, and a reader who cannot see it is
entitled to the same sentence a sighted reader gets from looking.

## What is accepted

`model/gltf-binary` (`.glb`) and `model/gltf+json` (`.gltf`), glTF 2.0, containing at
least one mesh, under the published size ceiling, and requiring no extension the viewer
does not implement — a required extension that is silently ignored draws something that
looks like the model and is not.

And, the rule that matters most: **the asset must be self-contained.** glTF can reference
buffers, images and shaders by URI. A viewer that honoured those would fetch whatever a
document named, from wherever it named, whenever anyone reopened an old conversation. So
every URI must be an inline `data:` one. This is checked three times — when the capability
hands the asset over, when the marketplace validates the package, and again when the bytes
are read back before the viewer sees them — because it is the one property that turns a
document into a request.

## The viewer

`src/lib/modelViewer.ts`, loaded the first time a model is actually opened, so a
conversation containing none never pays for it. Rotate with the left button, zoom with the
wheel, pan with the right, plus **Starting view** and **Fit to view**. A model opens on
request rather than on sight: a conversation with ten of them would otherwise start ten
WebGL contexts, which browsers cap and then begin discarding.

Three things the viewer does not do. It does not fetch: the asset is parsed from bytes
already in memory, with a resource path that resolves nowhere. It does not execute
anything a package supplied — there is no HTML, no script and no CSS in the contract. And
it does not keep what it drew: geometries, materials and textures are released when the
model is closed, or the GPU would accumulate them every time a conversation was reopened.

## Where each piece lives

| Piece | File |
| --- | --- |
| Format rule, shared with the marketplace | `packages/capability-api/src/models.ts` |
| Result kind | `packages/capability-api/src/views.ts` (`model`) |
| Permission and host channel | `permissions.ts`, `protocol.ts` (`models`) |
| Host implementation | `electron/capabilities/hostServices.ts` |
| Reading an asset back | `capabilityFiles:model` in `electron/ipc.ts` |
| Viewer | `src/lib/modelViewer.ts`, `src/components/ChatModelViewer.tsx` |
| Tests | `scripts/test-capability-3d.mjs`, `scripts/verify-capability-worker-host.mjs`, `scripts/test-capability-view-layout.mjs` |
