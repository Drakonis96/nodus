import { skillHasCapability } from '@shared/chatSkills';
import { sanitizeChatSvg } from '@shared/chatSvg';
import { serializeChatVisualPart, splitChatVisuals, type ChatSkill } from '@shared/chatSkills';
import type { ModelRef } from '@shared/types';
import { completeText } from './aiClient';
import { chemistrySvgAuditSystem, chemistrySvgMarkupIssues, chemistrySvgMode, isChemistrySvgRequest } from './chatChemistrySvg';
import { evaluateInSvgSandbox } from './svgSandboxWindow';

/** Inspect actual font metrics in an isolated, offscreen document whose CSP blocks page scripts. */
export async function inspectChatSvg(svg: string): Promise<string[]> {
  if (svg.length > 300_000) return ['SVG exceeds the 300 KB preview limit.'];
  return evaluateInSvgSandbox<string[]>(`(() => {
      const clean = (${sanitizeChatSvg.toString()})(${JSON.stringify(svg)});
      if (!clean) return ['Invalid or incomplete SVG XML. Return one complete valid SVG.'];
      const parsed = new DOMParser().parseFromString(clean.svg, 'image/svg+xml');
      const root = document.importNode(parsed.documentElement, true);
      document.body.append(root);
      const view = root.viewBox.baseVal;
      if (view.width <= 0 || view.height <= 0) return ['Add a positive viewBox with enough space for all labels.'];
      root.setAttribute('width', String(view.width)); root.setAttribute('height', String(view.height));
      const bounds = root.getBoundingClientRect();
      const labels = Array.from(root.querySelectorAll('text')).filter(node => !node.closest('defs, clipPath, mask')).map(node => ({ text: (node.textContent || '').trim(), rect: node.getBoundingClientRect() })).filter(item => item.text && item.rect.width && item.rect.height).slice(0, 300);
      const cards = Array.from(root.querySelectorAll('rect')).filter(node => !node.closest('defs, clipPath, mask') && !['none', 'transparent'].includes(getComputedStyle(node).fill)).map(node => node.getBoundingClientRect()).filter(rect => rect.width > 60 && rect.height > 24 && rect.width * rect.height < bounds.width * bounds.height * .85).sort((a,b) => a.width*a.height - b.width*b.height).slice(0, 200);
      const circles = Array.from(root.querySelectorAll('circle,ellipse')).filter(node => !node.closest('defs, clipPath, mask') && !['none', 'transparent'].includes(getComputedStyle(node).fill)).map(node => node.getBoundingClientRect()).filter(rect => rect.width > 60 && rect.height > 24 && rect.width * rect.height < bounds.width * bounds.height * .85).sort((a,b) => a.width*a.height - b.width*b.height).slice(0, 100);
      const insideEllipse = (shape, x, y) => Math.pow((x - (shape.left+shape.right)/2)/(shape.width/2),2) + Math.pow((y - (shape.top+shape.bottom)/2)/(shape.height/2),2) <= 1;
      const issues = [];
      const box = rect => '(' + [rect.left - bounds.left, rect.top - bounds.top, rect.width, rect.height].map(Math.round).join(', ') + ')';
      for (const label of labels) {
        const b = label.rect;
        if (b.left < bounds.left - 1 || b.top < bounds.top - 1 || b.right > bounds.right + 1 || b.bottom > bounds.bottom + 1) issues.push('Clipped label: ' + label.text.slice(0, 100) + ' at x,y,width,height ' + box(b) + '. Canvas ' + view.width + ' x ' + view.height + '.');
        const card = cards.find(a => Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1);
        if (card && (b.left < card.left - 1 || b.right > card.right + 1 || b.top < card.top - 1 || b.bottom > card.bottom + 1)) issues.push('Label crosses its box boundary: ' + label.text.slice(0,100) + '. Text x,y,width,height ' + box(b) + ', box ' + box(card) + '. Enlarge the containing box or wrap/move the label fully inside it, with padding.');
        const circle = circles.find(a => insideEllipse(a, (b.left+b.right)/2, (b.top+b.bottom)/2));
        if (circle && [[b.left,b.top],[b.right,b.top],[b.left,b.bottom],[b.right,b.bottom]].some(([x,y]) => !insideEllipse(circle,x,y))) issues.push('Label overflows a circular node: ' + label.text.slice(0,100) + '. Text x,y,width,height ' + box(b) + ', node ' + box(circle) + '. Replace crowded circular nodes with spacious rectangular cards or enlarge and reflow the layout. Preserve the complete connections and arrow directions.');
      }
      for (let i=0; i<labels.length; i++) for (let j=i+1; j<labels.length; j++) {
        const a=labels[i].rect, b=labels[j].rect;
        if (Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1) issues.push('Overlapping labels: ' + labels[i].text.slice(0,70) + ' / ' + labels[j].text.slice(0,70) + '. Measured x,y,width,height: ' + box(a) + ' / ' + box(b) + '. Move labels apart with at least 12 units of clear space.');
      }
      return issues.slice(0, 16);
    })()`);
}

/**
 * Ask for the drawing again in SVG, after the verified lane could not produce one.
 *
 * This is the step that keeps a failure from costing the user their answer. The
 * verified path is still tried first and still preferred; this only runs once it has
 * given up, and the result is labelled unverified because nothing checked it.
 * Returns an empty string when SVG Studio is not enabled or nothing usable comes back.
 */
export async function chemistrySvgFallback(options: { question: string; reason: string; skills: ChatSkill[]; model?: ModelRef | null; signal?: AbortSignal }): Promise<string> {
  const skill = options.skills.find(item => skillHasCapability(item, 'svg'));
  if (!skill) return '';
  options.signal?.throwIfAborted();
  try {
    const answer = await completeText({
      system: `${chemistrySvgAuditSystem(skill, chemistrySvgMode(options.question))}

Chemistry Studio could not produce a verified drawing for this request. Draw it yourself as one complete, self-contained SVG, using classical textbook notation with labelled atoms, explicit formal charges, and curved arrows where the request involves electron movement. Accompany nothing: return only the fenced svg block. Draw the chemistry the request actually asks for; do not narrow it to a simpler example, and do not refuse because a verified rule was unavailable.`,
      user: JSON.stringify({ request: options.question, verifiedLaneReported: options.reason.slice(0, 700) }),
      maxTokens: 12_000, temperature: 0, reasoning: 'off', plainContext: true, signal: options.signal,
    }, options.model);
    const svg = splitChatVisuals(answer).find(part => part.kind === 'svg' && part.complete);
    return svg ? serializeChatVisualPart(svg) : '';
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // A failed rescue must not become a second failure: the caller still has prose.
    return '';
  }
}

export async function refineChatSvg(answer: string, options: { question: string; skills: ChatSkill[]; model?: ModelRef | null; signal?: AbortSignal }): Promise<string> {
  const skill = options.skills.find(item => skillHasCapability(item, 'svg'));
  if (!skill) return answer;
  const parts = splitChatVisuals(answer);
  const chemistryMode = chemistrySvgMode(options.question);
  const audited = new Set<(typeof parts)[number]>();
  const chemistryParts = parts.filter(part => part.kind === 'svg' && isChemistrySvgRequest(options.question, part.content));
  if (chemistryParts.length > 1) {
    try {
      options.signal?.throwIfAborted();
      const repaired = await completeText({
        system: `${chemistrySvgAuditSystem(skill, chemistryMode)}\n\nThe draft split one requested answer across several SVGs. Combine every requested structure into one spacious SVG with one clearly labeled panel per item, a consistent scale and notation, and one shared accessible title and description. Preserve every requested molecule; do not omit or duplicate a panel. Return exactly one SVG.`,
        user: JSON.stringify({ request: options.question, requiredMode: chemistryMode, svgs: chemistryParts.map(part => part.content) }),
        maxTokens: 14_000, temperature: 0, reasoning: 'off', plainContext: true, signal: options.signal,
      }, options.model);
      const replacement = splitChatVisuals(repaired).find(item => item.kind === 'svg' && item.complete);
      if (replacement) {
        chemistryParts[0].content = replacement.content;
        chemistryParts[0].complete = true;
        audited.add(chemistryParts[0]);
        for (const redundant of chemistryParts.slice(1)) { redundant.kind = 'markdown'; redundant.content = ''; }
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // Preserve the original panels if optional consolidation fails.
    }
  }
  // Bound both browser work and model calls even if a weak model emits many blocks.
  let count = 0;
  for (const part of parts) {
    if (part.kind !== 'svg' || count++ >= 3) continue;
    options.signal?.throwIfAborted();
    try {
      const chemistry = isChemistrySvgRequest(options.question, part.content);
      if (!audited.has(part) && chemistry) {
        const repaired = await completeText({
          system: chemistrySvgAuditSystem(skill, chemistryMode),
          user: JSON.stringify({ request: options.question, requiredMode: chemistryMode, svg: part.content }),
          maxTokens: 12_000, temperature: 0, reasoning: 'off', plainContext: true, signal: options.signal,
        }, options.model);
        const replacement = splitChatVisuals(repaired).find(item => item.kind === 'svg' && item.complete);
        if (replacement) { part.content = replacement.content; part.complete = true; }
      }
      let issues = [...(chemistry ? chemistrySvgMarkupIssues(options.question, part.content) : []), ...await inspectChatSvg(part.content)];
      for (let attempt = 0; issues.length && attempt < 2; attempt++) {
        options.signal?.throwIfAborted();
        const repaired = await completeText({
          system: `${chemistry ? chemistrySvgAuditSystem(skill, chemistryMode) : `You are the visual quality editor for SVG Studio. Repair the supplied SVG, preserving the user's intended content and all correct relationships. Return only one complete fenced svg block.\n${skill.instructions}`}\nActual SVG checks found the issues listed below. Fix every listed issue with a simpler, more spacious layout. Prefer a vertical legend with one short explanation per row over a crowded horizontal legend. Increase canvas height or wrap text with tspan when needed; never hide, truncate, shrink to unreadable type, or delete required labels. Use explicit Arial, sans-serif typography. Preserve factual content. No external resources or scripts.`,
          user: JSON.stringify({ request: options.question, issues, svg: part.content }),
          maxTokens: 10_000, temperature: 0.2, reasoning: 'off', plainContext: true, signal: options.signal,
        }, options.model);
        const replacement = splitChatVisuals(repaired).find(item => item.kind === 'svg' && item.complete);
        if (!replacement) break;
        const nextIssues = [...(chemistry ? chemistrySvgMarkupIssues(options.question, replacement.content) : []), ...await inspectChatSvg(replacement.content)];
        // Never replace a drawing with a measurably worse repair.
        if (nextIssues.length <= issues.length) { part.content = replacement.content; part.complete = true; issues = nextIssues; }
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // A failed optional refinement must not discard a usable answer. Rendering
      // still sanitizes the result and exposes invalid markup as readable code.
    }
  }
  return parts.map(serializeChatVisualPart).join('');
}
