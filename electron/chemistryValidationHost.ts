import path from 'node:path';
import { utilityProcess } from 'electron';
import type { ChemistryValidationRequest, ChemistryValidationResult } from '@shared/chemistryDocument';

export function validateChemistryInUtility(request: ChemistryValidationRequest, signal?: AbortSignal): Promise<ChemistryValidationResult> {
  signal?.throwIfAborted();
  const child = utilityProcess.fork(path.join(__dirname, 'chemistryValidationWorker.js'), [], { serviceName: 'Nodus chemistry validation', stdio: 'ignore' });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: ChemistryValidationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      child.kill();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new DOMException('Chemical validation cancelled.', 'AbortError'));
    // Multi-panel rules compile each audited panel and the combined export.
    // Four C6 E2 alternatives can legitimately exceed the single-diagram budget.
    // Keep a hard, killable deadline; cancellation still terminates immediately.
    const budget = request.mechanism && ['e2', 'aldol', 'diels-alder'].includes(request.mechanism.rule) ? 30_000 : 15_000;
    const timeout = setTimeout(() => finish(new Error(`Chemical validation exceeded ${budget / 1000} seconds.`)), budget);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('message', (message: { error?: string; result?: ChemistryValidationResult }) => {
      if (message.error) finish(new Error(message.error));
      else if (message.result) finish(undefined, message.result);
      else finish(new Error('Invalid chemical worker response.'));
    });
    child.once('error', error => finish(new Error(String(error))));
    child.once('exit', () => finish(new Error('Chemical validator exited without a result.')));
    if (signal?.aborted) abort();
    else {
      try { child.postMessage(request); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    }
  });
}
