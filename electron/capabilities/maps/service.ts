import { randomUUID } from 'node:crypto';
import { MAP_LIMITS, validateMapQuery, validateMapRenderRequest, type MapDataset, type MapProviderId, type MapRenderRequest } from '../../../packages/capability-api/src/maps';
import { retrieveMapSource, type MapSourceTransport } from './sources';
import { callerMapSource, renderMap } from './render';

/** A scope belongs to one reply/worker service context. Tokens cannot cross scopes;
 * counters include failures and parallel requests and never reset on a retry. */
export function createMapService(options: { providers: readonly MapProviderId[]; maxCalls?: number; transport?: MapSourceTransport; beforeRetrieve?: () => void }) {
  let calls=0, retrievals=0; const datasets=new Map<string,MapDataset>();
  const charge = (signal: AbortSignal) => { signal.throwIfAborted(); if(++calls>Math.min(options.maxCalls ?? MAP_LIMITS.calls,MAP_LIMITS.calls)) throw new Error('Map call budget exhausted.'); };
  const retrieve = async (input: unknown, signal: AbortSignal): Promise<MapDataset> => {
    const query=validateMapQuery(input);
    if(!options.providers.includes(query.provider)) throw new Error('This Skill has no permission for that map provider.');
    if(query.period) throw new Error('Historical retrieval is unsupported by this provider; no geography was substituted.');
    if(++retrievals>MAP_LIMITS.retrievals) throw new Error('Map retrieval budget exhausted.');
    options.beforeRetrieve?.();
    const result=await retrieveMapSource(query,signal,options.transport);
    signal.throwIfAborted(); const dataset={...result,datasetId:randomUUID()}; datasets.set(dataset.datasetId,dataset); return structuredClone(dataset);
  };
  return {
    async retrieve(input: unknown, signal: AbortSignal) { charge(signal); return retrieve(input,AbortSignal.any([signal,AbortSignal.timeout(MAP_LIMITS.timeoutMs)])); },
    async render(input: unknown, signal: AbortSignal) {
      charge(signal); const bounded=AbortSignal.any([signal,AbortSignal.timeout(MAP_LIMITS.timeoutMs)]);
      const request=validateMapRenderRequest(input);
      const layers=[];
      for(const layer of request.layers ?? []) {
        bounded.throwIfAborted();
        if(layer.query) layers.push(await retrieve(layer.query,bounded));
        else if(layer.datasetId) { const dataset=datasets.get(layer.datasetId); if(!dataset) throw new Error('Map dataset reference is unknown or belongs to another invocation scope.'); layers.push(structuredClone(dataset)); }
        else layers.push({geojson:layer.data!.geojson,source:callerMapSource(layer.data!.source,layer.data!.geojson)});
      }
      return renderMap(request,layers,bounded);
    },
  };
}
export type MapService = ReturnType<typeof createMapService>;
