import { refineChatSvg } from './chatSvgQuality';
import type { ModelRef } from '@shared/types';
import type { ChatSkill } from '@shared/chatSkills';
import { CHAT_IMAGE_ASPECT_RATIOS, serializeChatVisualPart, type ChatImageAspectRatio, splitChatVisuals } from '@shared/chatSkills';
import { callImageProvider, prepareGeneratedImage } from './decorativeImages';
import { getSettings } from '../db/settingsRepo';
import { chatAssetVersion, storeChatImage } from '../chatAssets';
import { resolveChemistryIntent } from './chemistryIdentity';
import { validateChemistryInUtility } from '../chemistryValidationHost';
import { isChemistrySvgRequest } from './chatChemistrySvg';

export interface ChatSkillExecution {
  skills: ChatSkill[];
  question?: string;
  model?: ModelRef | null;
  owner?: string;
  version: number;
  isCurrent: () => boolean;
}

export function assertChatSkillSession(execution: ChatSkillExecution, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  if (!execution.isCurrent() || (execution.owner && chatAssetVersion(execution.owner) !== execution.version)) {
    throw new DOMException('The chat was deleted or changed.', 'AbortError');
  }
}

/** Provider-independent tool adapter: only the current model answer may invoke it. */
export async function executeChatSkills(answer: string, execution: ChatSkillExecution, signal?: AbortSignal): Promise<string> {
  assertChatSkillSession(execution, signal);
  // Some providers surround a generic JSON intent with prose, or repeat it.
  // Promote one unique intent, discarding unchecked prose. Conflicting drafts
  // abstain; unrelated/incomplete JSON remains ordinary text. Every promoted
  // field still goes through the strict user-grounded resolver below.
  if (execution.skills.some(skill => skill.builtin === 'chemistry') && !splitChatVisuals(answer).some(p => p.kind === 'chemistry-plan')) {
    const candidates = new Map<string, string>();
    for (const match of answer.matchAll(/```json\s*\n([\s\S]*?)\n```/gi)) {
      try {
        const candidate = JSON.parse(match[1]);
        if (candidate?.version === 2 && ['skeletal', 'fischer', 'haworth', 'newman'].includes(candidate.depiction) && ['structure', 'comparison', 'mechanism', 'reaction'].includes(candidate.kind) && (Array.isArray(candidate.species) || candidate.kind === 'reaction' && typeof candidate.reactionSmiles === 'string')) candidates.set(JSON.stringify(candidate), match[1]);
      } catch { /* Not a complete JSON tool intent. */ }
    }
    if (candidates.size > 1) return 'Chemistry Studio — unsupported: conflicting chemical intents were returned. Request one explicit structure or mechanism.';
    if (candidates.size === 1) answer = serializeChatVisualPart({ kind: 'chemistry-plan', content: candidates.values().next().value!, complete: true });
  }
  const initialParts = splitChatVisuals(answer), initialIntent = initialParts.some(part => part.kind === 'chemistry-plan');
  if (!initialIntent && execution.skills.some(skill => skill.builtin === 'chemistry')) {
    const question = execution.question ?? '';
    const nonMolecular = /\b(?:orbital|energy diagram|energy profile|reaction coordinate|diagrama de energ[ií]a)\b/i.test(question);
    const verifiedDrawing = /\b(?:chemfig|smiles|fischer|haworth|newman|sn[12]|e[12]|aldol|nitration|nitraci[oó]n|diels.alder|molecular structure|chemical structure|estructura molecular|estructura qu[ií]mica)\b/i.test(question)
      && !nonMolecular;
    const bypass = initialParts.some(part => (verifiedDrawing && part.kind !== 'markdown' && part.kind !== 'image-error')
      || (!nonMolecular && part.kind === 'svg' && isChemistrySvgRequest(question, part.content)))
      || (verifiedDrawing && /!\[[^\]]*\]\(|<img\b/i.test(answer));
    // Unsupported chemistry must not escape through another drawing provider.
    // Drop the accompanying unvalidated product/prose claims too, before any
    // SVG repair or paid image generation can run.
    if (bypass) return 'Chemistry Studio — unsupported: no validated identity/projection/mechanism intent was returned. Unverified SVG, images and ChemFig cannot replace the requested chemical drawing. Use a supported projection or rule with an exact name, PubChem CID or isomeric SMILES.';
  }
  if (!initialIntent) answer = await refineChatSvg(answer, { question: execution.question ?? '', skills: execution.skills, model: execution.model, signal });
  const parts = splitChatVisuals(answer);
  const hasChemistryIntent = parts.some(part => part.kind === 'chemistry-plan');
  let requested = false;
  let chemistryRequested = false;
  const result: string[] = [];
  for (const part of parts) {
    // Model prose is not checked by graph validators and may contradict the
    // resolved structure. Only evidence-derived captions accompany new plans.
    if (hasChemistryIntent && part.kind !== 'chemistry-plan') continue;
    if (part.kind === 'chemistry-plan') {
      signal?.throwIfAborted();
      if (process.env.NODUS_CHEMFIG_QA_LOG === '1') console.log('[chemistry-plan]', part.content);
      try {
        if (chemistryRequested) throw new Error('Only one chemistry plan can be compiled per reply.');
        chemistryRequested = true;
        if (!execution.skills.some(skill => skill.builtin === 'chemistry')) throw new Error('Enable Chemistry Studio to render this plan.');
        if (!part.complete) throw new Error('The chemistry plan was interrupted. Retry the response.');
        const document = await resolveChemistryIntent(part.content, execution.question ?? '', {
          fetch: globalThis.fetch, validate: validateChemistryInUtility,
        }, signal);
        assertChatSkillSession(execution, signal);
        if (document.status !== 'verified') {
          result.push(`\n\nChemistry Studio — ${document.status}: ${document.reason.replace(/[\r\n`*<>[\]]/g, ' ').slice(0, 700)}\n\n`);
        } else {
          result.push(serializeChatVisualPart({ kind: 'chemistry-document', content: JSON.stringify(document), complete: true }));
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
        const message = error instanceof Error ? error.message : 'The chemistry plan could not be compiled.';
        result.push(`\n\n**Chemistry Studio:** ${message.replace(/[\r\n]+/g, ' ').slice(0, 700)}\n\n`);
      }
      continue;
    }
    if (['chemfig', 'smiles', 'lewis', 'chemistry-document'].includes(part.kind)) {
      result.push('\n\nChemistry Studio: las nuevas estructuras requieren un plan de identidad de versión 2. Los dibujos antiguos siguen siendo visibles, pero no se consideran verificados.\n\n');
      continue;
    }
    if (part.kind !== 'image-request') {
      result.push(serializeChatVisualPart(part));
      continue;
    }
    signal?.throwIfAborted();
    try {
      if (requested) throw new Error('Only one image can be generated per reply. Send another message to create a variation.');
      requested = true;
      if (!execution.skills.some(skill => skill.builtin === 'image')) throw new Error('Enable Image Atelier in Skills to generate images.');
      if (!execution.owner) throw new Error('Start a saved chat in Nodi or the assistant to generate an image.');
      if (!part.complete) throw new Error('The image brief was interrupted. Retry the response.');
      let value: { title?: unknown; alt?: unknown; prompt?: unknown; aspectRatio?: unknown };
      try { value = JSON.parse(part.content); } catch { throw new Error('The model returned an invalid image brief. Retry the response.'); }
      if (typeof value.prompt !== 'string' || value.prompt.trim().length < 20 || value.prompt.length > 12000) throw new Error('The model returned an invalid image brief. Retry the response.');
      const settings = getSettings();
      if (!settings.imageProvider || !settings.imageModel) throw new Error('Choose an image provider and model in Settings.');
      const title = String(value.title || 'Generated image').replace(/[[\]\n\r]/g, ' ').slice(0, 160);
      const alt = String(value.alt || title).replace(/[[\]\n\r]/g, ' ').slice(0, 500);
      const current = () => execution.isCurrent() && chatAssetVersion(execution.owner!) === execution.version;
      if (!current()) throw new DOMException('The chat was deleted or changed.', 'AbortError');
      const aspectRatio = CHAT_IMAGE_ASPECT_RATIOS.includes(value.aspectRatio as ChatImageAspectRatio) ? value.aspectRatio as ChatImageAspectRatio : undefined;
      const generated = await callImageProvider(settings.imageProvider, settings.imageModel, value.prompt.trim(), signal, aspectRatio);
      signal?.throwIfAborted();
      if (!current()) throw new DOMException('The chat was deleted or changed.', 'AbortError');
      const prepared = prepareGeneratedImage(generated);
      const source = storeChatImage(execution.owner, { bytes: prepared.image, mimeType: prepared.mimeType }, {
        ...(aspectRatio ? { aspectRatio } : {}), title, alt, prompt: value.prompt.trim(), provider: settings.imageProvider, model: settings.imageModel, createdAt: new Date().toISOString(),
      });
      result.push(`\n\n![${alt}](${source})\n\n`);
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      const message = error instanceof Error ? error.message : 'Image generation failed. Please retry.';
      result.push(`\n\n\`\`\`nodus-image-error\n${JSON.stringify({ message: message.replace(/[\r\n]+/g, ' ').slice(0, 500) })}\n\`\`\`\n\n`);
    }
  }
  assertChatSkillSession(execution, signal);
  return result.join('');
}
