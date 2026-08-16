const REQUEST_TIMEOUT_MS = 60_000;

/** Network-only helpers that are safe to import from an Electron utility process. */
export function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export async function serverFetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}
