import type { WritingWorkshopDraft, ImmersionPlan } from './types';
import { documentBodyForPanels } from './writingDocument';

export function researchVisualFields(draft: WritingWorkshopDraft): Record<string, string> {
  return { body: documentBodyForPanels(draft.draftMarkdown, draft.abstract) };
}
export function immersionVisualFields(plan: ImmersionPlan): Record<string, string> {
  return Object.fromEntries([
    ['overview', plan.overview],
    ...plan.stations.flatMap(station => [[`station-${station.id}-context`, station.context], [`station-${station.id}-synthesis`, station.synthesis]]),
    ['contrasts', plan.contrasts.rows.map(row => `${row.question}\n\n${row.cells.map(cell => `${cell.author}: ${cell.stance}`).join('\n')}`).join('\n\n')],
  ]);
}
