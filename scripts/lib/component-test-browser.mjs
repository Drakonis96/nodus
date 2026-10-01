/** Own each fixture's browser process, including when Chrome ignores shutdown. */
async function bounded(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`browser shutdown exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function closeComponentBrowser(server, { timeoutMs = 10_000, killTimeoutMs = 15_000, diagnostic = console.warn } = {}) {
  try {
    await bounded(() => server.close(), timeoutMs);
  } catch (error) {
    diagnostic(`[component-browser] ${error.message}; terminating the owned browser process`);
    // Playwright kills the owned process tree and waits for exit on each platform.
    // A timeout or failed kill remains a test failure; never leave cleanup pending.
    try {
      await bounded(() => server.kill(), killTimeoutMs);
    } catch (failure) {
      const child = server.process();
      throw new Error(`Component browser termination failed (exit=${child.exitCode}, signal=${child.signalCode})`, { cause: failure });
    }
  }
  const child = server.process();
  if (child.exitCode === null && child.signalCode === null) throw new Error('Component browser process did not exit');
}

export async function launchComponentBrowser(browserType, options) {
  const server = await browserType.launchServer({ ...options, host: '127.0.0.1' });
  let closing;
  const close = () => closing ??= closeComponentBrowser(server);
  try {
    const browser = await browserType.connect(server.wsEndpoint(), { timeout: 30_000 });
    return { browser, close };
  } catch (error) {
    await close();
    throw error;
  }
}
