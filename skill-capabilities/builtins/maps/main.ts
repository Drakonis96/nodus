import { serializeChatVisualPart, skillHasCapability } from '../../../shared/chatSkills';
import { storeCapabilityFile } from '../../../electron/chatAssets';
import { createMapService, type MapService } from '../../../electron/capabilities/maps/service';
import { MAP_PROVIDERS } from '../../../packages/capability-api/src/maps';
import { METERED_CALL_LIMIT, SANDBOXED_CALL_LIMIT } from '../../contracts';
import { assertChatSkillSession } from '../../registry/main';
import type { ChatCallBudget, ChatSkillExecution } from '../../registry/types';

export const createChatMapService = (budget: ChatCallBudget) => createMapService({providers:MAP_PROVIDERS,beforeRetrieve:()=>{if(++budget.metered>METERED_CALL_LIMIT) throw new Error('Map retrieval exceeds the reply network budget.');}});
export async function executeMapCapability(content: string, complete: boolean, execution: ChatSkillExecution, budget: ChatCallBudget, service: MapService, signal?: AbortSignal): Promise<string> {
  try {
    assertChatSkillSession(execution,signal);
    if(!complete || content.length>64000) throw new Error('Invalid or interrupted map request.');
    const request=JSON.parse(content);
    if(!request || Object.keys(request).some(k=>!['skillId','capabilityId','toolId','input'].includes(k)) || request.capabilityId!=='nodus:maps' || !execution.skills.some(skill=>skill.id===request.skillId && skillHasCapability(skill,'nodus:maps'))) throw new Error('Maps are not enabled for this Skill.');
    if(!['retrieve','render'].includes(request.toolId)) throw new Error('Unknown map tool.');
    if(++budget.sandboxed>SANDBOXED_CALL_LIMIT) throw new Error('Map tool budget exhausted.');
    execution.beforeInvoke?.();
    const abort=signal ?? new AbortController().signal;
    const result=await service[request.toolId as 'render'|'retrieve'](request.input,abort);
    assertChatSkillSession(execution,signal);
    const parts=[];
    if('svg' in result) parts.push(serializeChatVisualPart({kind:'capability-result',complete:true,content:JSON.stringify({capabilityId:'nodus:maps',pluginId:'core',result:{kind:'svg',svg:result.svg,title:request.input.title,provenance:result.provenance}})}));
    else parts.push(serializeChatVisualPart({kind:'capability-result',complete:true,content:JSON.stringify({capabilityId:'nodus:maps',pluginId:'core',result:{kind:'json',value:{datasetId:result.datasetId,source:result.source,features:result.geojson.features.map(f=>({id:f.id,...f.properties}))}}})}));
    if(execution.owner) {
      // Keep the existing 10 MB attachment ceiling: whitespace can otherwise make
      // a valid administrative dataset too large to save beside the rendered map.
      const bytes=Buffer.from(JSON.stringify(result));
      const source=storeCapabilityFile(execution.owner,{bytes,mimeType:'application/json',name:'map-data.json'});
      parts.push(serializeChatVisualPart({kind:'capability-result',complete:true,content:JSON.stringify({capabilityId:'nodus:maps',pluginId:'core',result:{kind:'file',source,mimeType:'application/json',name:'map-data.json',title:'Map geometry and provenance'}})}));
    }
    return parts.join('\n');
  } catch(error) {
    if(signal?.aborted || error instanceof Error && error.name==='AbortError') throw error;
    return `\n\nCapability error: ${String(error instanceof Error?error.message:error).replace(/[\r\n`*<>[\]]/g,' ').slice(0,500)}\n\n`;
  }
}
