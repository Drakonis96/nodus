import type { IpcContext } from './context';
import type { CompassImportRequest, CompassProviderId, CompassRangeSelectionRequest, CompassSearchRequest, CompassViewRequest } from '@shared/compass';
import { compassService } from '../compass/compassService';
import { listProviderDescriptors } from '../compass/providers/catalog';

/** Compass handlers deliberately return normalized summaries only; provider raw
 * responses are consumed and discarded in the main process/worker boundary. */
export function registerCompassIpc({ h }: IpcContext): void {
  const service = compassService();
  const ownSearch = (event: Electron.IpcMainInvokeEvent, searchId: string) => service.claimSearch(String(searchId), event.sender.id);
  const ownImport = (event: Electron.IpcMainInvokeEvent, jobId: string) => service.claimImport(String(jobId), event.sender.id);
  h('compass:search:start', async (event, request: CompassSearchRequest) => service.start(request, event.sender.id));
  h('compass:search:loadMore', async (event, searchId: string, requestId: string, generation: number, offset?: number) => { ownSearch(event, searchId); return service.loadMore(String(searchId), String(requestId), Number(generation), Number(offset ?? 0)); });
  h('compass:search:cancel', async (event, searchId?: string, requestId?: string) => { if (searchId) ownSearch(event, searchId); service.cancel(searchId ? String(searchId) : undefined, requestId ? String(requestId) : undefined); });
  h('compass:search:get', async (event, searchId: string) => { ownSearch(event, searchId); return service.get(String(searchId)); });
  h('compass:result:detail', async (event, searchId: string, key: string) => { ownSearch(event, searchId); return service.detail(String(searchId), String(key)); });
  h('compass:view:update', async (event, request: CompassViewRequest) => { ownSearch(event, request.searchId); return service.updateView(request); });
  h('compass:provider:retry', async (event, searchId: string, provider: CompassProviderId) => { ownSearch(event, searchId); return service.retryProvider(String(searchId), provider); });
  h('compass:search:retry', async (event, searchId: string) => { ownSearch(event, searchId); return service.retrySearch(String(searchId)); });
  h('compass:results:list', async (event, searchId: string, offset?: number, limit?: number) => { ownSearch(event, searchId); return service.listResults(String(searchId), Number(offset ?? 0), Number(limit ?? 25)); });
  h('compass:history:list', async (_event, limit?: number) => service.history(Number(limit ?? 50)));
  h('compass:history:delete', async (event, searchId: string) => { ownSearch(event, searchId); service.deleteHistory(String(searchId)); });
  h('compass:history:clear', async () => { service.clearHistory(); });
  h('compass:candidate:save', async (event, searchId: string, key: string) => { ownSearch(event, searchId); service.save(String(searchId), String(key)); });
  h('compass:candidate:listSaved', async (_event, limit?: number) => service.saved(Number(limit ?? 100)));
  h('compass:candidate:dismiss', async (event, searchId: string, key: string) => { ownSearch(event, searchId); service.dismiss(String(searchId), String(key)); });
  h('compass:candidate:restore', async (event, searchId: string, key: string) => { ownSearch(event, searchId); service.restore(String(searchId), String(key)); });
  h('compass:selection:update', async (event, searchId: string, keys: string[], revision: number) => { ownSearch(event, searchId); if (!Array.isArray(keys) || keys.length > 10_000) throw new Error('Compass selection is too large.'); service.setSelection(String(searchId), keys.map(String), Number(revision)); });
  h('compass:selection:range', async (event, request: CompassRangeSelectionRequest) => { ownSearch(event, request.searchId); return service.selectRange(request); });
  h('compass:selection:get', async (event, searchId: string) => { ownSearch(event, searchId); return service.selection(String(searchId)); });
  h('compass:import:start', async (event, request: CompassImportRequest) => { ownSearch(event, request.searchId); return service.import(request, event.sender.id); });
  h('compass:import:get', async (event, jobId: string) => { ownImport(event, jobId); return service.importProgress(String(jobId)); });
  h('compass:import:cancel', async (event, jobId: string) => { ownImport(event, jobId); service.cancelImport(String(jobId)); });
  h('compass:import:retry', async (event, jobId: string) => { ownImport(event, jobId); return service.retryImport(String(jobId)); });
  h('compass:providers:status', async () => service.providerStatus());
  h('compass:providers:list', async () => listProviderDescriptors());
}
