# Chat skills and visual answers

Open **Skills** in a chat to activate reusable instructions. Search by name or
description, create a personal skill, import a Markdown or JSON instruction file,
or edit/delete an existing skill. Restoring the initial library resets the built-in
skills while preserving personal skills.

The assistant, Library document sidebar, database chat, Study/Teaching chat,
world chat, and character interviews share the assistant activation settings.
Nodi has independent activation settings. Changes propagate to other open windows.
Tool-backed skills have a teal accent and a translated **Uses tools** label.

## Built-in skills

**SVG Studio** and **Image Atelier** start enabled. SVG Studio creates precise
vector diagrams, schematics and other editable drawings. Image Atelier prepares
an English production prompt and calls the image provider and model selected in
Settings. The chat's text model does not need native image-generation support.

**Socratic Tutor**, **Thought Partner**, **Brainstorm Studio**, **Make It Simple**,
**Action Planner**, **Compare & Choose**, **Constructive Critic**, **Writing Partner**,
and **Perspective Switcher** start disabled. Their instructions are editable.
Built-in names, descriptions and instructions are currently English; interface
controls follow all eight supported UI languages.

A skill supplies a method, not unrestricted code execution. The model chooses
relevant enabled skills for the current request. Original diagrams can be derived
from supported concepts without requiring a source to contain the finished SVG.
Explicit source-only constraints and truthful citation requirements still apply.
There is no web-search capability in this release.

## Visual output

Both complete fenced SVG and standalone SVG are detected. Previews sanitize SVG
and display it as an inert image, excluding scripts, foreign objects, event
handlers and external resources. Streaming output shows progress until the visual
is complete. Optional layout inspection can request up to two repairs per SVG
(for at most three SVGs in a response); inspection failures preserve the answer.
Citation repair does not rewrite SVG labels or image-generation instructions.

Generated images and SVGs can be enlarged, copied and downloaded. SVG source and
the generated image's prompt are accessible from the visual card. Image generation
is limited to one image per response. Missing configuration and provider failures
appear in the chat without discarding the accompanying answer.

Character interviews use the shared Skills control for new image generation.
Existing character-chat image attachments remain readable through their original
viewer and storage protocol.

## Storage, network access and compatibility

- The versioned skill library is stored in the application profile as
  `chat-skills.json`. It is included in global auxiliary backup files. Library
  upgrades preserve edits and activation settings and do not resurrect previously
  deleted defaults.
- Generated chat images and their metadata are stored under
  `chat-assets/<owner>/` in the application profile. Vault conversations use a
  vault-scoped owner; Library reader aliases resolve to the same document owner.
  Nodi conversation ownership remains global.
- Deleting or clearing a chat deletes its generated image files. Saving a pruned
  history removes unreferenced assets. Deletion, cancellation and vault changes
  invalidate pending generation so a late response cannot recreate deleted images.
- Chat image files are currently device-local. This change does not add them to
  backup archives or synchronization; an exported/restored conversation can
  therefore retain image links whose files are unavailable on another device.
- The selected text provider receives the existing chat context plus the enabled
  skill instructions. Image providers receive the generated production prompt and
  optional aspect ratio. SVG repair calls receive the user request, SVG and layout
  findings. Existing provider credentials and model selection are reused.
- Enabling a skill does not start a request. Tool execution follows a user chat
  turn and does not add background browsing, arbitrary commands, or new sources
  such as class rosters and grades to the chat context.
- No SQLite schema migration is required. External Office and Server Web clients
  are outside this desktop integration.

## Verification

`node --test scripts/test-chat-skills.mjs scripts/test-chat-skills-surfaces.mjs`
checks activation, CRUD, upgrades, visual parsing, provider routing, persistence,
pruning and invalidation. The cross-surface suite uses real repositories with
simulated model responses and no network calls.

`node scripts/verify-chat-svg-runtime.mjs` exercises the SVG sanitizer and layout
inspection in Electron. `scripts/verify-chat-skills.mjs` is an optional live-provider
QA harness: it requires an explicitly supplied disposable profile, makes model
calls, and writes local visual artifacts. Do not point it at a production profile
or publish its output if it contains private material.
