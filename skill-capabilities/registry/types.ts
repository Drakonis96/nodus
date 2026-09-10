import type { ModelRef } from '../../shared/types';
import type { ChatSkill } from '../../shared/chatSkills';

export interface ChatSkillExecution {
  skills: ChatSkill[];
  question?: string;
  model?: ModelRef | null;
  owner?: string;
  version: number;
  isCurrent: () => boolean;
}

/** Calls already charged in this reply, split by lane. See SANDBOXED_CALL_LIMIT. */
export interface ChatCallBudget {
  sandboxed: number;
  metered: number;
}
