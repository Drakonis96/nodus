// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * The preload that runs inside a Nodus Browser page.
 *
 * It never calls contextBridge, and that is the whole design. Every other
 * preload in this repo exists to hand a renderer a bridge; this one exists to
 * make sure a remote website never gets one. A page loaded here has no
 * `window.nodus`, no `ipcRenderer`, no `require`, no `process` — there is no
 * name it can reach for.
 *
 * That is also why the file is nearly empty, and why that is a finished state
 * rather than an unfinished one. The DOM sensors it will eventually carry — page
 * text and selection for Ask Nodi and Add to Library, audio/video reporting for
 * the header media control — arrive together with their main-process consumers,
 * because scripts/test-ipc-contract.mjs refuses a channel that only one side
 * implements. A preload sending on a channel nobody listens to is exactly the
 * half-wired state that test exists to prevent.
 *
 * Two constraints apply when those sensors do arrive, and both are easy to miss:
 *
 *  - electron/tsconfig.json deliberately omits the DOM library, so the document
 *    has to be reached through narrow structural casts (electron/preload/api.ts
 *    reads `location` the same way).
 *  - Everything crossing to main must be length-capped and NUL-stripped. A page
 *    is untrusted input, and an uncapped read lets it choose our payload sizes.
 *
 * Because contextIsolation is on, whatever lands here runs in an isolated world:
 * it shares the DOM with the page but not the JavaScript globals, so a page
 * cannot patch a getter out from under it in a way that reaches this code.
 */

export {};
