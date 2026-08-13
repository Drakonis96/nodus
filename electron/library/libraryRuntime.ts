// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

let closer: (() => void) | null = null;
const changeListeners = new Set<() => void>();

/** Keep backup/restore independent from the extraction engine's optional runtimes. */
export function registerGlobalLibraryCloser(value: () => void): void {
  closer = value;
}

export function closeGlobalLibraryRuntime(): void {
  closer?.();
}

/** Subscribe without coupling the library service to the server publisher. */
export function onGlobalLibraryChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function notifyGlobalLibraryChanged(): void {
  for (const listener of changeListeners) {
    try { listener(); } catch { /* one optional consumer cannot break a library write */ }
  }
}
