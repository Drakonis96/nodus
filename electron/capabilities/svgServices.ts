import { sanitizeChatSvg } from '@shared/chatSvg';
import { splitChatVisuals } from '@shared/chatSkills';
import type { ModelRef } from '@shared/types';
import { completeText } from '../ai/aiClient';
import { evaluateInSvgSandbox } from '../ai/svgSandboxWindow';

/** The generic SVG services a capability may use. No disciplinary knowledge lives here:
 *  this is the same sanitizer, the same offscreen measurement and the same model call the
 *  core uses for any drawing. What a molecule is supposed to look like belongs to the
 *  package that draws molecules. */

export async function validateCapabilitySvg(svg: string): Promise<{ ok: boolean; errors: string[] }> {
  if (typeof svg !== 'string' || !svg.trim()) return { ok: false, errors: ['The SVG is empty.'] };
  if (svg.length > 300_000) return { ok: false, errors: ['SVG exceeds the 300 KB limit.'] };
  const result = await evaluateInSvgSandbox<{ ok: boolean; errors: string[] }>(`(() => {
    const clean = (${sanitizeChatSvg.toString()})(${JSON.stringify(svg)});
    if (!clean) return { ok: false, errors: ['Invalid or incomplete SVG XML.'] };
    const parsed = new DOMParser().parseFromString(clean.svg, 'image/svg+xml');
    const root = parsed.documentElement;
    const errors = [];
    // The sanitizer drops what it cannot allow rather than failing, so a caller that
    // wants to know what it lost has to be told which elements did not survive.
    const before = (${JSON.stringify(svg)}.match(/<([a-zA-Z][\\w:-]*)/g) || []).length;
    const after = root.querySelectorAll('*').length + 1;
    if (after < before) errors.push('The sanitizer removed ' + (before - after) + ' element(s) that are not allowed in a chat drawing.');
    if (!root.viewBox || root.viewBox.baseVal.width <= 0 || root.viewBox.baseVal.height <= 0) errors.push('Add a positive viewBox.');
    return { ok: errors.length === 0, errors };
  })()`);
  return result;
}

export async function inspectCapabilitySvg(svg: string): Promise<{ width?: number; height?: number; elements: number }> {
  if (typeof svg !== 'string' || svg.length > 300_000) throw new Error('The SVG is empty or exceeds the 300 KB limit.');
  return evaluateInSvgSandbox(`(() => {
    const clean = (${sanitizeChatSvg.toString()})(${JSON.stringify(svg)});
    if (!clean) return { elements: 0 };
    const parsed = new DOMParser().parseFromString(clean.svg, 'image/svg+xml');
    const root = parsed.documentElement;
    const view = root.viewBox && root.viewBox.baseVal;
    return {
      ...(view && view.width > 0 ? { width: view.width, height: view.height } : {}),
      elements: root.querySelectorAll('*').length + 1,
    };
  })()`);
}

/** One refinement pass over one drawing. The instruction comes from the caller; the core
 *  contributes only the rules every chat drawing obeys. */
export async function refineCapabilitySvg(
  request: { svg: string; instruction: string },
  model: ModelRef | null | undefined,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (typeof request.svg !== 'string' || !request.svg.trim()) throw new Error('There is no SVG to refine.');
  if (typeof request.instruction !== 'string' || !request.instruction.trim() || request.instruction.length > 4_000) throw new Error('The refinement instruction is empty or too long.');
  const answer = await completeText({
    system: 'You improve one SVG drawing. Return exactly one complete, self-contained SVG in a fenced svg block and nothing else. Keep a positive viewBox, keep every element legible and inside the canvas, and preserve the meaning of what is already drawn: this is a revision, not a new drawing.',
    user: JSON.stringify({ instruction: request.instruction.slice(0, 4_000), svg: request.svg }),
    maxTokens: 12_000, temperature: 0, reasoning: 'off', plainContext: true, signal,
  }, model);
  const part = splitChatVisuals(answer).find(item => item.kind === 'svg' && item.complete);
  if (!part) throw new Error('The refinement did not return a complete SVG.');
  return part.content;
}
