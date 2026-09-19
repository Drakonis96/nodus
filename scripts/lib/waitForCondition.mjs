// Poll asynchronous IPC probes from Node; keep Playwright renderer waits synchronous.
export async function waitForCondition(label, probe, { timeout = 30_000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
      lastError = null;
    } catch (cause) {
      lastError = cause;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  const detail = lastError instanceof Error ? ` Último error: ${lastError.message}` : '';
  throw new Error(`Tiempo agotado esperando: ${label}.${detail}`);
}
