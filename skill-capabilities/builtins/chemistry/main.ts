import { serializeChatVisualPart, skillHasCapability, splitChatVisuals } from '../../../shared/chatSkills';
import { resolveChemistryIntent } from '../../../electron/ai/chemistryIdentity';
import { validateChemistryInUtility } from '../../../electron/chemistryValidationHost';
import { isChemistrySvgRequest } from '../../../electron/ai/chatChemistrySvg';
import type { ChatSkillExecution } from '../../registry/types';

export function prepareChemistry(answer: string, execution: ChatSkillExecution): { answer: string; initialIntent: boolean; unverifiedSvg?: boolean; terminal?: string } {
  if (execution.skills.some(skill => skillHasCapability(skill, 'nodus:chemistry')) && !splitChatVisuals(answer).some(part => part.kind === 'chemistry-plan')) {
    const candidates = new Map<string, string>();
    for (const match of answer.matchAll(/```json\s*\n([\s\S]*?)\n```/gi)) {
      try {
        const candidate = JSON.parse(match[1]);
        if (candidate?.version === 2 && ['skeletal','fischer','haworth','newman'].includes(candidate.depiction)
          && ['structure','comparison','mechanism','reaction'].includes(candidate.kind)
          && (Array.isArray(candidate.species) || candidate.kind === 'reaction' && typeof candidate.reactionSmiles === 'string')) candidates.set(JSON.stringify(candidate), match[1]);
      } catch { /* Ordinary JSON. */ }
    }
    if (candidates.size > 1) return { answer, initialIntent: false, terminal: 'Chemistry Studio — unsupported: conflicting chemical intents were returned. Request one explicit structure or mechanism.' };
    if (candidates.size === 1) answer = serializeChatVisualPart({ kind: 'chemistry-plan', content: candidates.values().next().value!, complete: true });
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
      // generation and legacy/model-authored chemistry formats remain refused.
      if (svgEnabled && hasSvgFallback && !hasDisallowedFallback) return { answer, initialIntent, unverifiedSvg: true };
      return { answer, initialIntent, terminal: 'Chemistry Studio — unsupported: no validated identity, projection or mechanism intent was returned. A model-authored SVG fallback requires SVG Studio; generated images and legacy ChemFig are refused. Use a supported projection or rule with an exact name, PubChem CID or isomeric SMILES.' };
    }
  }
  return { answer, initialIntent };
}

export async function executeChemistryPlan(content: string, complete: boolean, execution: ChatSkillExecution, current: () => void, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  try {
    if (!execution.skills.some(skill => skillHasCapability(skill, 'nodus:chemistry'))) throw new Error('Enable Chemistry Studio to render this plan.');
    if (!complete) throw new Error('The chemistry plan was interrupted. Retry the response.');
    const document = await resolveChemistryIntent(content, execution.question ?? '', { fetch: globalThis.fetch, validate: validateChemistryInUtility }, signal); current();
    return document.status !== 'verified'
      ? `\n\nChemistry Studio — ${document.status}: ${document.reason.replace(/[\r\n`*<>[\]]/g, ' ').slice(0, 700)}\n\n`
      : serializeChatVisualPart({ kind: 'chemistry-document', content: JSON.stringify(document), complete: true });
  } catch (error) {
    if (signal?.aborted || error instanceof Error && error.name === 'AbortError') throw error;
    const message = error instanceof Error ? error.message : 'The chemistry plan could not be compiled.';
    return `\n\n**Chemistry Studio:** ${message.replace(/[\r\n]+/g, ' ').slice(0, 700)}\n\n`;
  }
}
