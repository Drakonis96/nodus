// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

let closer: (() => void) | null = null;

/** Keep backup/restore independent from the extraction engine's optional runtimes. */
export function registerGlobalLibraryCloser(value: () => void): void {
  closer = value;
}

export function closeGlobalLibraryRuntime(): void {
  closer?.();
}
