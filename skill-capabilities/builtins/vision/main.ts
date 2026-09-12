import { validateVisionReviewResult } from '../../../packages/capability-api/src/vision';
import { serializeChatVisualPart, skillHasCapability } from '../../../shared/chatSkills';
import type { VisionSession } from '../../../electron/capabilities/vision/service';
import { assertChatSkillSession } from '../../registry/main';
import type { ChatSkillExecution } from '../../registry/types';

export async function executeVisionCapability(content:string, complete:boolean, execution:ChatSkillExecution, service:VisionSession, signal?:AbortSignal):Promise<string> {
  try {
    assertChatSkillSession(execution,signal);
    if(!complete || content.length>64000) throw new Error('Invalid or interrupted vision request.');
    const request=JSON.parse(content);
    if(!request || Object.keys(request).some(k=>!['skillId','capabilityId','toolId','input'].includes(k)) || request.capabilityId!=='nodus:vision' || request.toolId!=='review-images' || !execution.skills.some(skill=>skill.id===request.skillId && skillHasCapability(skill,'nodus:vision'))) throw new Error('Vision is not enabled for this Skill or the tool is unknown.');
    execution.beforeInvoke?.();
    const value=validateVisionReviewResult(await service.reviewImages(request.input,`skill:${request.skillId}`,3,signal));
    assertChatSkillSession(execution,signal);
    return serializeChatVisualPart({kind:'capability-result',complete:true,content:JSON.stringify({capabilityId:'nodus:vision',pluginId:'core',result:{kind:'json',value}})});
  } catch(error) {
    if(signal?.aborted || error instanceof Error && error.name==='AbortError') throw error;
    return `\n\nCapability error: ${String(error instanceof Error?error.message:error).replace(/[\r\n\x60*<>[\]]/g,' ').slice(0,500)}\n\n`;
  }
}
