import type { ResearchContextLayers, ResearchContextSelection } from './types';

/*
 * The context balloon offers layers, not sections. A layer maps onto the sections the
 * retrieval already understands, so every path that reads sections (the vaults without
 * a documentary corpus) keeps working unchanged, while the academic corpus run reads
 * the layers themselves.
 */

/** The layers a selection chooses. One saved before layers existed is read from its
 * sections; in an academic vault its documents were always read, so they stay on. */
export function researchContextLayers(selection: ResearchContextSelection, academic = false): ResearchContextLayers {
  if (selection.layers) return { ideas: !!selection.layers.ideas, documents: !!selection.layers.documents };
  return {
    ideas: selection.ideas || selection.themes || selection.contradictions || selection.gaps || selection.readingPath || selection.authors || selection.graph,
    documents: academic || selection.documents || selection.passages !== false,
  };
}

/** A selection choosing exactly these layers, with its sections set to match. */
export function withResearchContextLayers(selection: ResearchContextSelection, layers: ResearchContextLayers): ResearchContextSelection {
  const ideas = !!layers.ideas;
  const documents = !!layers.documents;
  return {
    ...selection,
    layers: { ideas, documents },
    ideas, themes: ideas, contradictions: ideas, gaps: ideas, readingPath: ideas, authors: ideas, graph: ideas,
    graphParts: { ideaNodes: ideas, themeNodes: ideas, ideaEdges: ideas, authorGraph: ideas },
    documents, passages: documents,
  };
}

/** Whether a turn may consult nothing of the corpus and no web: it answers from general knowledge. */
export function researchContextIsEmpty(layers: ResearchContextLayers, webEnabled: boolean): boolean {
  return !layers.ideas && !layers.documents && !webEnabled;
}
