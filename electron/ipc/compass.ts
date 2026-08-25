import type { IpcContext } from './context';
import type { CompassImportRequest, CompassSearchRequest, CompassProviderId } from '@shared/compass';
import { compassService } from '../compass/compassService';

/** Compass handlers deliberately return normalized summaries only; provider raw
 * responses are consumed and discarded in the main process/worker boundary. */
export function registerCompassIpc({ h }: IpcContext): void {
  const service = compassService();
  h('compass:search:start', async (_event, request: CompassSearchRequest) => service.start(request));
  h('compass:search:loadMore', async (_event, searchId: string, requestId: string, generation: number, offset?: number) => service.loadMore(String(searchId), String(requestId), Number(generation), Number(offset ?? 0)));
  h('compass:search:cancel', async (_event, searchId?: string, requestId?: string) => { service.cancel(searchId ? String(searchId) : undefined, requestId ? String(requestId) : undefined); });
  h('compass:search:get', async (_event, searchId: string) => service.get(String(searchId)));
  h('compass:results:list', async (_event, searchId: string, offset?: number, limit?: number) => service.listResults(String(searchId), Number(offset ?? 0), Number(limit ?? 25)));
  h('compass:history:list', async (_event, limit?: number) => service.history(Number(limit ?? 50)));
  h('compass:history:delete', async (_event, searchId: string) => { service.deleteHistory(String(searchId)); });
  h('compass:history:clear', async () => { service.clearHistory(); });
  h('compass:candidate:save', async (_event, searchId: string, key: string) => { service.save(String(searchId), String(key)); });
  h('compass:candidate:listSaved', async (_event, limit?: number) => service.saved(Number(limit ?? 100)));
  h('compass:candidate:dismiss', async (_event, searchId: string, key: string) => { service.dismiss(String(searchId), String(key)); });
  h('compass:candidate:restore', async (_event, searchId: string, key: string) => { service.restore(String(searchId), String(key)); });
  h('compass:selection:update', async (_event, searchId: string, keys: string[], revision: number) => { if (!Array.isArray(keys) || keys.length > 10_000) throw new Error('Compass selection is too large.'); service.setSelection(String(searchId), keys.map(String), Number(revision)); });
  h('compass:selection:get', async (_event, searchId: string) => service.selection(String(searchId)));
  h('compass:import:start', async (_event, request: CompassImportRequest) => service.import(request));
  h('compass:import:get', async (_event, jobId: string) => service.importProgress(String(jobId)));
  h('compass:import:cancel', async (_event, jobId: string) => { service.cancelImport(String(jobId)); });
  h('compass:import:retry', async (_event, jobId: string) => service.retryImport(String(jobId)));
  h('compass:providers:status', async () => service.providerStatus());
  h('compass:providers:setKey', async (_event, provider: string, key: string) => { service.setKey(provider as CompassProviderId, String(key)); });
  h('compass:providers:clearKey', async (_event, provider: string) => { service.clearKey(provider as CompassProviderId); });
}
