import type { ModelRef } from '../../shared/types';
import type { ChatSkill } from '../../shared/chatSkills';

export interface ChatSkillExecution {
  renderStoredArtifacts?: boolean;
  skills: ChatSkill[];
  question?: string;
  model?: ModelRef | null;
  owner?: string;
  version: number;
  isCurrent: () => boolean;
  locale?: string;
  pins?: import('../../electron/capabilities/registry').TurnPins;
  registry?: import('../../electron/capabilities/registry').CapabilityRegistrySnapshot;
  /** Document executions bind these to the durable per-skill ledger. */
  beforeInvoke?: () => void;
  beforePaidCall?: () => void;
  beforeRepair?: () => void;
  maxSvgRepairs?: number;
}

/** Calls already charged in this reply, split by lane. See SANDBOXED_CALL_LIMIT. */
export interface ChatCallBudget {
  sandboxed: number;
  metered: number;
}
