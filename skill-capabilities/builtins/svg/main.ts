import { refineChatSvg } from '../../../electron/ai/chatSvgQuality';
import type { ChatSkillExecution } from '../../registry/types';

export const refineSvg = (answer: string, execution: ChatSkillExecution, signal?: AbortSignal) =>
  refineChatSvg(answer, { question: execution.question ?? '', skills: execution.skills, model: execution.model, signal, beforeRepair: execution.beforeRepair, maxRepairs: execution.maxSvgRepairs });
