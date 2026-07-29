# Judgements that have already cost shots

Everything here really happened by doing the first four tutorials. They are ordered by how expensive
each one came out. Read it before recording.

---

## 1. What covers the app and swallows the clicks

An open modal turns each next click into a non-op **silent**: the recording ends, reports success,
and is twenty plans of a grey background.

| Open it. | How he shuts up |
|---|---|
| Modal de Novedades | `localStorage['nodus.lastSeenVersion']` = the actual version. It opens when it differs; putting `'9999.0.0'` always opens it, does not close it |
| Update mode when booting | `sessionStorage['nodus.startupUpdateChecked'] = '1'`. `NODUS_E2E_UPDATE_STATUS` **not** enough |
| Recovery Wizard | `recoverySetupVersion: 9999`. Uncovers `basicsTutorialVersion: 9999` |
| Election of Nodi | `mascotStyleChosen: true` |
| Backup Notice | click on `.backup-health-dismiss` |

The engine already does all this (`BASE_SETTINGS`) and also ** refuses to film** if something big
covers the app when it starts.

## 2. Close a modal: do not guess your button

Three successive attempts failed and all three reported success:

- Click on (24, 24) to "give to the bottom" → falls on the **macOS window buttons**.
- `button:has-text("✕")` → engages the monitoring chip, not the modal.
- Checking the closure at a point covered by the background itself → `closest('[role=dialog]')` from
  the background is `null`, so "there is no dialogue".

What works, and is in `closeAnyDialog`: Find the layer fixed to full screen with `z-index ≥ 40` and,
inside, **a small button near its top edge**. Searched by **form**, not by text: the ☆☆☆☆☆ is
usually an SVG with `textContent` empty.

## 3. The AI "does not work" and the app lies about why

Symptom: Scan is paused with *"This message could not be translated"*. Real cause:
`Missing AI key for Gemini`.

Nodus encrypts the keys with `safeStorage`, but decrypting them asks permission from the Keychain
and **nobody grants it** in an automated session. The UI says "saved key" and the engine cannot read
it. The output: write the file in readable format.

```js
await writeFile(path.join(userData, 'secrets', `ai_key_${provider}.bin`),
  `b64:${Buffer.from(key, 'utf8').toString('base64')}`, 'utf8');
```

The engine reflects the `stderr` of the main process so that the actual motif is seen.

## 4. Profile isolation is an illusion if you don't copy the Vault

`vaults.json` saves the **absolute path** of the Vault database. Copying the profile copies the
pointer, not the vault: all the shots read and write the same file, and the status is filtered from
one to the other. Thus a Vault already paired with Nodus Server appeared, without a connection form,
in a shot that had to start clean.

The engine copies the Vault and rewrites the log. If you add another store, check to see if it also
saves absolute routes.

## 5. Waiting for a job to end: an instant of calm is not the end

Scanning chains phases (light, deep, summary, embeddings, passages, bridges) and each glues the next
one. A momentary `done >= total` between two phases **is identical to having finished**. Filming
there gives an empty graph.

It demands calm **sustained**: 20 surveys of 3 s (one minute). 21 seconds were not enough.

And the reverse: a queue that remains empty at 45 s is a finished job, not a slope. Without that
output, a subsequent timer stays 45 minutes filming a still app.

## 6. Elements that exist but are not visible

The buttons in the Nodi radial menu (`.nodi-node`) are in the DOM **open or closed**: closed are
stacked under the orb. Counting them to know if the menu is always open gives "open", never opens,
and each click falls on the orb.

Look at the state (`.nodi-node.open`), not the existence. And prefer stable identifiers
(`[data-nodi-action="chat"]`) to positions.

## 7. `data-testid` does not always wrap what it looks like

`[data-testid="mcp-settings-card"]` wraps only the ChatGPT box; the box and the MCP buttons are
**hermans** yours. Search within the testid gives zero boxes and one button. The correct thing:
`section.card:has([data-testid="mcp-settings-card"])`.

## 8. Guards that check nothing

- Measure the **text of the page** to see if a search worked: the page is always long, so it happens
  even if nothing has been written. Check `inputValue()`.
- Register `current.state` when `current` only brings `{title, kind}`: a running scan is read as
  stopped.
- An assistant who does not verify its effect lets the take "triunfe" with the fault inside. Each
  assistant must affirm what he did and warn if he did not.

## 9. The AI language is a separate setting

`uiLanguage` **no** drags to `promptLanguage`, which comes in default Spanish. With English
interface, all the ideas extracted came out in Spanish. You can only see frames. `BASE_SETTINGS`
already fixes the two.

## 10. The camera points off-screen

`boundingBox()` returns coordinates of elements under the fold, and the zoom goes to an empty slot.
You have to do `scrollIntoViewIfNeeded` and check visibility before measuring.

## 11. ffmpeg: `crop` does not animate

`crop` evaluates `w`/`h` once: there is no camera movement. What it does animates is `zoompan`.

## 12. More blurring is as bad as blurring less.

Covering the entire element left unreadable the entire configuration block of Claude Desktop,
because the token lives inside. It wraps **only** the characters of the secret in an own `<span>`
(see `TOKEN_BLUR` in the mallet `mcp`).

And the other way around: a blur rule that doesn't fit the **mark makes no mistake**. In one shot
all the user's Zotero collections were read because the rule looked within a `[role="dialog"]` that
modal doesn't have. Check it by looking at frames.

## 13. `window.nodus` does not support reassignment

It comes from *contextBridge*. Overwrite `window.nodus.nodiChatStream` from the page fails **in
silence** and responds to the true model — at its cost. To script a response you have to replace the
IPC handler in the main **process**:

```js
await app.evaluate(({ ipcMain }, text) => {
  ipcMain.removeHandler('nodi:chatStream');
  ipcMain.handle('nodi:chatStream', async (event, requestId) => { /* … */ });
}, answer);
```

## 14. The voice and screen are broken without warning

Real cases: the voice said "each node is an idea" while 7 themes were seen; and it said "Gemini 2.5"
with 3.1 on screen. No log detects it.

As the narration commands the clock, **a line can be redone without re-recording**: it changes the
text, re-narrates (only that phrase, by the cache) and re-assembles.

## 15. Pipeline things that bite

- **Assembly does not rebuild the app.** If you change Nodus code, run `npm run build` before recording.
- **Each deck writes in its folder.** Before it was not so and the cards of one video overwrote the
  final video of another.
- **The voice cache is for text.** Without it, changing a word overturned the entire deck.
- **A notice visible in the recording is almost always visible in the video.** Do not assemble with pending notices
  without looking earlier at that moment of the footage.
