import type { ModelRef } from '../../../shared/types';
import { completeTextNeutral, resolveModelRef } from '../../ai/aiClient';
import { listModels, localBaseUrl } from '../../ai/providers';
import { getApiKey } from '../../secrets/secretStore';
import { currentPrivacyScope } from '../../ai/studentPrivacyContext';
import { VISION_LIMITS } from '../../../packages/capability-api/src/vision';
import { VisionSession, type VisionAdapter } from './service';
import { boundedVisionProvider, visionModelSupport } from './modelSupport';

export function createVisionAdapter(selected?:ModelRef|null, beforePaidCall?:()=>void): VisionAdapter {
  let model: ModelRef | null = null;
  try { model=structuredClone(resolveModelRef(selected)); } catch { /* no model configured */ }
  return {
    model,
    beforePaidCall,
    privacyBlocked:()=>Boolean(currentPrivacyScope()),
    async available(signal) {
      if(!model || !boundedVisionProvider(model.provider)) return {supported:false,reason:'No supported bounded vision provider is selected.'};
      try {
        signal.throwIfAborted();
        const key=getApiKey(model.provider);
        if(model.provider==='ollama') {
          const response=await fetch(`${localBaseUrl('ollama')}/api/show`,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({model:model.model}),signal});
          if(!response.ok) throw new Error();
          const data=await response.json() as {capabilities?:string[]};
          return visionModelSupport(model,{id:model.model,vision:Array.isArray(data.capabilities) && data.capabilities.includes('vision')});
        }
        const info=(await listModels(model.provider,key)).find(m=>m.id===model!.model);
        return visionModelSupport(model,info);
      } catch {signal.throwIfAborted();return {supported:false,reason:'Model image support could not be verified; use metadata ranking.'};}
    },
    complete: input => {
      if(!model) throw new Error('No model selected.');
      return completeTextNeutral({...input,temperature:0,reasoning:'off',plainContext:true,noRetry:true,timeoutMs:VISION_LIMITS.callMs},model);
    },
  };
}
export function createChatVisionSession(context:{question?:string;model?:ModelRef|null;beforePaidCall?:()=>void;signal?:AbortSignal;current?:()=>void}): VisionSession {
  return new VisionSession(context.question ?? '',createVisionAdapter(context.model,context.beforePaidCall),context.signal,context.current);
}
