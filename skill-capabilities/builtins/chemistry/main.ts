import { serializeChatVisualPart, skillHasCapability, splitChatVisuals, type ChemistryNotice } from '../../../shared/chatSkills';
import { resolveChemistryIntent } from '../../../electron/ai/chemistryIdentity';
import { validateChemistryInUtility } from '../../../electron/chemistryValidationHost';
import { isChemistrySvgRequest } from '../../../electron/ai/chatChemistrySvg';
import type { ChatSkillExecution } from '../../registry/types';

export interface PreparedChemistry {
  answer: string;
  initialIntent: boolean;
  /** Interface notices to render alongside the answer. They never replace it. */
  notices: ChemistryNotice[];
  /** The model produced a drawing intent we could not adopt; the SVG lane may still rescue it. */
  needsFallback: boolean;
}

export function prepareChemistry(answer: string, execution: ChatSkillExecution): PreparedChemistry {
  const notices: ChemistryNotice[] = [];
  if (execution.skills.some(skill => skillHasCapability(skill, 'nodus:chemistry')) && !splitChatVisuals(answer).some(part => part.kind === 'chemistry-plan')) {
    const candidates = new Map<string, string>();
    const blocks: Array<{ key: string; start: number; end: number; body: string }> = [];
    for (const match of answer.matchAll(/```json\s*\n([\s\S]*?)\n```/gi)) {
      try {
        const candidate = JSON.parse(match[1]);
        if (candidate?.version === 2 && ['skeletal','fischer','haworth','newman'].includes(candidate.depiction)
          && ['structure','comparison','mechanism','reaction','resonance'].includes(candidate.kind)
          && (Array.isArray(candidate.species) || candidate.kind === 'reaction' && typeof candidate.reactionSmiles === 'string')) {
          const key = JSON.stringify(candidate);
          candidates.set(key, match[1]);
          blocks.push({ key, start: match.index!, end: match.index! + match[0].length, body: match[1] });
        }
      } catch { /* Ordinary JSON. */ }
    }
    // Ambiguity is reported, never used as a reason to discard the reply.
    if (candidates.size > 1) notices.push({ code: 'conflicting-intents' });
    else if (candidates.size === 1) {
      // Substitute the intent block in place. Replacing the whole answer would
      // delete the explanation the model wrote around its own drawing.
      let rebuilt = '', cursor = 0, promoted = false;
      for (const block of blocks) {
        rebuilt += answer.slice(cursor, block.start);
        if (!promoted) { rebuilt += serializeChatVisualPart({ kind: 'chemistry-plan', content: block.body, complete: true }); promoted = true; }
        cursor = block.end;
      }
      answer = rebuilt + answer.slice(cursor);
    }
  }
  const parts = splitChatVisuals(answer), initialIntent = parts.some(part => part.kind === 'chemistry-plan');
  if (!initialIntent && execution.skills.some(skill => skillHasCapability(skill, 'nodus:chemistry'))) {
    const question = execution.question ?? '';
    const nonMolecular = /\b(?:orbital|energy diagram|energy profile|reaction coordinate|diagrama de energ[ií]a)\b/i.test(question);
    const molecularDrawing = /\b(?:chemfig|smiles|fischer|haworth|newman|sn[12]|e[12]|aldol|nitration|nitraci[oó]n|diels.alder|reaction mechanism|chemical reaction|molecular structure|chemical structure|estructura molecular|estructura qu[ií]mica)\b/i.test(question) && !nonMolecular;
    const bypass = parts.some(part => (molecularDrawing && part.kind !== 'markdown' && part.kind !== 'image-error')
      || (!nonMolecular && part.kind === 'svg' && isChemistrySvgRequest(question, part.content))) || (molecularDrawing && /!\[[^\]]*\]\(|<img\b/i.test(answer));
    if (bypass) {
      const hasSvgFallback = parts.some(part => part.kind === 'svg');
      const hasDisallowedFallback = parts.some(part => !['markdown', 'svg', 'image-error'].includes(part.kind))
        || /!\[[^\]]*\]\(|<img\b/i.test(answer);
      const svgEnabled = execution.skills.some(skill => skillHasCapability(skill, 'nodus:svg'));
      // Graceful degradation is restricted to the sanitized SVG path. Paid image
      // generation and legacy/model-authored chemistry formats are still not adopted
      // as chemistry, but they no longer cost the user the rest of the reply.
      if (svgEnabled && hasSvgFallback && !hasDisallowedFallback) return { answer, initialIntent, notices: [...notices, { code: 'unverified-svg' }], needsFallback: false };
      // A model-authored picture must never stand in for a verified structure, so the
      // image itself is removed — but only the image. Everything the model explained
      // around it is left alone.
      return { answer: stripModelAuthoredImages(answer), initialIntent, notices, needsFallback: true };
    }
  }
  return { answer, initialIntent, notices, needsFallback: false };
}

export interface ChemistryPlanOutcome {
  /** Rendered document, or an empty string when nothing could be drawn. */
  rendered: string;
  notices: ChemistryNotice[];
}

/** Structural rejections name a JSON field and are worth one more attempt; chemical ones are not. */
const REPAIR_ATTEMPTS = 2;

export async function executeChemistryPlan(content: string, complete: boolean, execution: ChatSkillExecution, current: () => void, signal?: AbortSignal): Promise<ChemistryPlanOutcome> {
  signal?.throwIfAborted();
  try {
    const skill = execution.skills.find(item => skillHasCapability(item, 'nodus:chemistry'));
    if (!skill) throw new Error('Enable Chemistry Studio to render this plan.');
    if (!complete) throw new Error('The chemistry plan was interrupted. Retry the response.');
    const question = execution.question ?? '';
    const deps = { fetch: globalThis.fetch, validate: validateChemistryInUtility };
    let source = content;
    for (let attempt = 0; ; attempt++) {
      const document = await resolveChemistryIntent(source, question, deps, signal); current();
      if (document.status === 'verified' || document.status === 'partial') {
        const notices: ChemistryNotice[] = [];
        if (document.status === 'partial') notices.push({ code: 'partial-validation', detail: sanitizeDetail(document.reason) });
        if (document.assumedIdentity) notices.push({ code: 'assumed-identity', detail: sanitizeDetail(document.assumedIdentity) });
        return { rendered: serializeChatVisualPart({ kind: 'chemistry-document', content: JSON.stringify(document), complete: true }), notices };
      }
      // `unsupported` means the intent's shape was wrong and the error says which field.
      // `needs-clarification` means the chemistry itself is underdetermined, and no
      // amount of re-prompting will make the reference say something it does not say.
      if (document.status !== 'unsupported' || attempt >= REPAIR_ATTEMPTS) {
        return { rendered: '', notices: [{ code: 'not-drawn', detail: sanitizeDetail(document.reason) }] };
      }
      // Loaded on demand: the repair path reaches the AI client, and pulling that whole
      // dependency chain into the registry's static graph costs every consumer of it.
      const { repairChemistryIntent } = await import('../../../electron/ai/chemistryRepair');
      const repaired = await repairChemistryIntent({
        question, rejected: source, problem: document.reason, instructions: skill.instructions,
        final: attempt === REPAIR_ATTEMPTS - 1, model: execution.model, signal,
      });
      current();
      if (!repaired) return { rendered: '', notices: [{ code: 'not-drawn', detail: sanitizeDetail(document.reason) }] };
      source = repaired;
    }
  } catch (error) {
    if (signal?.aborted || error instanceof Error && error.name === 'AbortError') throw error;
    const message = error instanceof Error ? error.message : 'The chemistry plan could not be compiled.';
    return { rendered: '', notices: [{ code: 'not-drawn', detail: sanitizeDetail(message) }] };
  }
}

/**
 * Remove markdown and HTML images from prose so a remote picture cannot pose as a
 * verified chemical structure. Fenced blocks are left untouched: an image inside a
 * code sample is text the user asked to see, not a drawing being passed off as one.
 */
function stripModelAuthoredImages(answer: string): string {
  return splitChatVisuals(answer).map(part => part.kind === 'markdown'
    ? part.content.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<img\b[^>]*>/gi, '')
    : serializeChatVisualPart(part)).join('');
}

/** Notices are rendered as data, so only control characters and length are constrained. */
function sanitizeDetail(reason?: string): string | undefined {
  return reason?.replace(/[\r\n]+/g, ' ').slice(0, 700);
}
