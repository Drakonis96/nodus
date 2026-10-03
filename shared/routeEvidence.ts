import type { ReactionPrecedent, RouteSpeciesLabel } from './moleculeInspection';

/** The per-step evidence brief of the route evidence pass (see electron/ai/routeEvidencePass.ts). */

export interface StepEvidence {
  step: number;
  /** "reactants → product", from the resolved names. */
  reaction: string;
  ord?: { recorded: number; classes: string[]; closest?: number };
  textbook?: { title: string; location: string; about: string; excerpt: string };
  web?: Array<{ title: string; url: string; snippet: string }>;
}

function names(labels: RouteSpeciesLabel[], role: 'reactant' | 'product'): string[] {
  return labels.filter((label) => label.role === role && !label.byproduct).map((label) => label.name || label.smiles);
}

export function stepReaction(labels: RouteSpeciesLabel[]): string {
  return `${names(labels, 'reactant').join(' + ')} → ${names(labels, 'product').join(' + ')}`;
}

/** The ORD half of each step: how often the step is recorded, its reaction classes, and the
 *  similarity of the closest recorded reaction when the step itself is not recorded. */
export function ordByStep(precedent: ReactionPrecedent, steps: number[]): Map<number, NonNullable<StepEvidence['ord']>> {
  const similar = new Map(precedent.similar.map((item) => [item.input, item]));
  const out = new Map<number, NonNullable<StepEvidence['ord']>>();
  precedent.reactions.forEach((entry, position) => {
    const step = steps[position];
    if (step === undefined) return;
    const best = Math.max(0, ...(similar.get(entry.input)?.neighbors ?? []).map((neighbor) => neighbor.similarity ?? 0));
    out.set(step, { recorded: entry.count, classes: entry.classes ?? [], ...(entry.count === 0 && best > 0 ? { closest: best } : {}) });
  });
  return out;
}

/** The evidence as a brief the model reads; empty when nothing was found for any step. */
export function formatEvidenceBrief(evidence: StepEvidence[]): string {
  const blocks = evidence.filter((item) => item.ord || item.textbook || item.web?.length).map((item) => {
    const lines = [`Step ${item.step + 1}: ${item.reaction}`];
    if (item.ord) {
      const classes = item.ord.classes.length ? `; classes: ${item.ord.classes.join(', ')}` : '';
      const recorded = item.ord.recorded > 0
        ? `recorded ${item.ord.recorded} time(s)`
        : `not recorded${item.ord.closest ? `; closest recorded reaction ${Math.round(item.ord.closest * 100)}% similar` : ''}`;
      lines.push(`- Open Reaction Database: ${recorded}${classes}`);
    }
    if (item.textbook) lines.push(`- Textbook (${[item.textbook.title, item.textbook.location].filter(Boolean).join(', ')}) on ${item.textbook.about}: "${item.textbook.excerpt}"`);
    for (const result of item.web ?? []) lines.push(`- Web: ${result.title} (${result.url}): ${result.snippet}`);
    return lines.join('\n');
  });
  return blocks.join('\n\n');
}

export const EVIDENCE_REVISION_RULE = [
  'ROUTE EVIDENCE REVIEW. Below is your draft route and, for each step, what the Open Reaction Database, the textbooks and a web search found.',
  'Revise the draft only where the evidence shows a step is doubtful: not recorded and with no close precedent, a textbook describing different conditions or reagents, or a web source describing a better-established way to the same intermediate. Keep every step the evidence supports unchanged.',
  'Do not cite the web results or the database as sources unless they appear in the supplied context. Return the complete route in the same format as the draft (all the required labelled lines per step), with no commentary about this review.',
].join('\n');

export function revisionUserMessage(user: string, draft: string, brief: string): string {
  return `${user}\n\n${EVIDENCE_REVISION_RULE}\n\n=== YOUR DRAFT ===\n${draft}\n\n=== PER-STEP EVIDENCE ===\n${brief}`;
}
