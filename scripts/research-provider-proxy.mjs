/** Offline Electron talks only to this loopback gate. The gate is the sole
 * owner of paid network dispatch and reserves a conservative bound first. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ResearchCostLedger } from './research-cost-ledger.mjs';

const ENDPOINTS = {
  deepseek: { model: 'deepseek-flash', route: '/chat/completions', url: 'https://api.deepseek.com/chat/completions', input: .3, output: 1.2 },
  openrouter: { model: 'baai/bge-m3', route: '/embeddings', url: 'https://openrouter.ai/api/v1/embeddings', input: .01, output: 0 },
};
// Peak/cache-miss prices verified 2026-09-23. Reservation adds 25% and $0.002.
// https://api-docs.deepseek.com/quick_start/pricing/
// https://openrouter.ai/baai/bge-m3
export async function startResearchProviderProxy(root, { dispatch = fetch, port = 0 } = {}) {
  const canonical = fs.realpathSync(root);
  const marker = JSON.parse(fs.readFileSync(path.join(canonical, 'isolation.json'), 'utf8'));
  if (marker.format !== 'nodus.isolated-research-profile/1' || marker.root !== canonical) throw new Error('Invalid campaign root');
  const ledger = new ResearchCostLedger(path.join(canonical, 'artifacts/cost-ledger.json'));
  const log = path.join(canonical, 'artifacts/provider-metrics.jsonl');
  const nonce = randomUUID();
  let stopped = false, running = 0;
  const controllers = new Set();
  // At most two paid calls in flight. Further calls wait for a slot rather than being
  // refused: a refusal is a 403, which the application rightly reads as a bad credential.
  const waiting = [];
  const acquireSlot = async () => {
    while (running >= 2) {
      if (stopped) throw new Error('research_dispatch_not_authorized');
      await new Promise(resolve => waiting.push(resolve));
    }
    if (stopped) throw new Error('research_dispatch_not_authorized');
    running++;
  };
  const server = http.createServer(async (request, response) => {
    let reservation, provider, started, firstByteMs;
    const controller = new AbortController();
    let admitted = false;
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const match = new RegExp(`^/${nonce}/(deepseek|openrouter)(/.*)$`).exec(url.pathname);
      if (stopped || request.method !== 'POST' || !match || url.search) throw new Error('research_dispatch_not_authorized');
      provider = match[1];
      const target = ENDPOINTS[provider];
      if (match[2] !== target.route) throw new Error('research_dispatch_not_authorized');
      if (!request.headers.authorization?.startsWith('Bearer ')) throw new Error('research_credential_missing');
      await acquireSlot(); admitted = true; controllers.add(controller);
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 512000) throw new Error('research_request_too_large'); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks);
      const body = JSON.parse(bytes.toString('utf8'));
      if (body.max_tokens !== undefined && body.max_completion_tokens !== undefined) throw new Error('research_ambiguous_output_bound');
      if (body.model !== target.model || body.tools?.length || body.web_search_options || body.plugins?.length || (body.n !== undefined && body.n !== 1)) throw new Error('research_model_or_tool_not_authorized');
      const output = provider === 'deepseek' ? body.max_tokens ?? body.max_completion_tokens : 0;
      if (!Number.isSafeInteger(output) || output < 0 || output > 16384 || (provider === 'deepseek' && output === 0)) throw new Error('research_output_bound_required');
      if (provider === 'deepseek' && (!Array.isArray(body.messages) || body.messages.some(message => typeof message.content !== 'string'))) throw new Error('research_text_only');
      if (provider === 'openrouter' && !(typeof body.input === 'string' || (Array.isArray(body.input) && body.input.length && body.input.every(input => typeof input === 'string')))) throw new Error('research_text_only');
      const maximumUsd = ((bytes.length * target.input + output * target.output) / 1e6) * 1.25 + .002;
      reservation = ledger.reserve({ provider, model: target.model, maximumUsd });
      started = performance.now();
      response.once('close', () => { if (!response.writableFinished) controller.abort(); });
      const upstream = await dispatch(target.url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: request.headers.authorization },
        body: bytes, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]) });
      response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
      const outputChunks = []; let outputBytes = 0;
      for await (const chunk of upstream.body ?? []) {
        firstByteMs ??= performance.now() - started;
        outputBytes += chunk.length;
        if (outputBytes > 8 * 1024 * 1024) throw new Error('research_response_too_large');
        outputChunks.push(Buffer.from(chunk)); response.write(chunk);
      }
      const text = Buffer.concat(outputChunks).toString('utf8');
      let usage;
      try { usage = JSON.parse(text).usage; } catch {
        for (const line of text.split('\n')) if (line.startsWith('data: ')) try { usage = JSON.parse(line.slice(6)).usage ?? usage; } catch { /* SSE sentinel. */ }
      }
      const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens;
      const outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? (provider === 'openrouter' ? 0 : undefined);
      let accountedUsd = null;
      if (upstream.ok && [inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) {
        accountedUsd = typeof usage.cost === 'number' ? usage.cost : (inputTokens * target.input + outputTokens * target.output) / 1e6;
        try { ledger.settle(reservation, { actualUsd: accountedUsd, inputTokens, outputTokens }); }
        catch { stopped = true; throw new Error('research_accounting_bound_exceeded'); }
      }
      fs.appendFileSync(log, JSON.stringify({ reservation, provider, model: target.model, requestHash: createHash('sha256').update(bytes).digest('hex'),
        status: upstream.status, latencyMs: performance.now() - started, firstByteMs, inputTokens, outputTokens, accountedUsd, maximumUsd,
        accounting: typeof usage?.cost === 'number' ? 'provider_cost' : accountedUsd === null ? 'reservation_retained' : 'peak_price_upper_bound' }) + '\n', { mode: 0o600 });
      response.end();
    } catch (error) {
      // Test-only simulated upstreams can ask for a real connection reset instead
      // of an error body; a paid upstream never raises this code.
      if (error?.code === 'SIMULATED_RESET' && !response.headersSent) {
        if (reservation) fs.appendFileSync(log, JSON.stringify({ reservation, provider, failed: true, simulatedReset: true }) + '\n', { mode: 0o600 });
        request.socket.destroy();
        return;
      }
      if (reservation) fs.appendFileSync(log, JSON.stringify({ reservation, provider, failed: true, reservationRetained: true, latencyMs: performance.now() - started }) + '\n', { mode: 0o600 });
      if (!response.headersSent) response.writeHead(403, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: error instanceof Error && error.message.startsWith('research_') ? error.message : 'research_dispatch_blocked' } }));
    } finally { if (admitted) { running--; waiting.shift()?.(); } controllers.delete(controller); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/${nonce}`, ledger, close: async () => {
    stopped = true; for (const controller of controllers) controller.abort();
    for (const resolve of waiting.splice(0)) resolve();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}
