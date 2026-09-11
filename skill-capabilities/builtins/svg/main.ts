import { chemistrySvgFallback, refineChatSvg } from '../../../electron/ai/chatSvgQuality';
import type { ChatSkillExecution } from '../../registry/types';

export const refineSvg = (answer: string, execution: ChatSkillExecution, signal?: AbortSignal) => refineChatSvg(answer, { question: execution.question ?? '', skills: execution.skills, model: execution.model, signal });

/** Last drawing attempt once the verified chemistry lane has abstained. */
export const rescueChemistryWithSvg = (reason: string, execution: ChatSkillExecution, signal?: AbortSignal) =>
  chemistrySvgFallback({ question: execution.question ?? '', reason, skills: execution.skills, model: execution.model, signal });
