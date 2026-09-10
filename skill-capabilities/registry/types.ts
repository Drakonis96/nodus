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
