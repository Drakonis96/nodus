import React from 'react';
import ReactDOM from 'react-dom/client';
import type { IdeaListItem, NodusApi } from '../shared/types';
import { IdeasView } from '../src/views/IdeasView';
import type { KnowledgeViewSource } from '../src/views/knowledgeViewSource';
import '../src/index.css';

const ideas: IdeaListItem[] = [
  ['abandono de la autarquía franquista', 'El fracaso de la autarquía económica y la necesidad de seguridad política forzaron al régimen a una apertura económica gradual a partir de 1951.', 'claim'],
  ['abandono de la restauración liberal-monárquica por la extrema derecha española', 'En 1933 la extrema derecha española había abandonado la expectativa de una restauración liberal-monárquica y orientaba su estrategia a sustituir la República.', 'claim'],
  ['abandono infantil por desestructuración familiar', 'La hambruna provocó la desintegración de los lazos familiares y comunitarios, resultando en el abandono de menores como estrategia de supervivencia.', 'claim'],
  ['abendland', 'El movimiento Abendland funcionó como un marco ideológico para la reconstrucción moral y política de la Alemania Occidental.', 'framework'],
  ['absentismo escolar', 'El trabajo infantil, especialmente en el sector agrario, fue la causa principal del absentismo escolar en la Granada de la posguerra.', 'finding'],
  ['absentismo escolar por trabajo infantil', 'El absentismo escolar en los pueblos de colonización fue un fenómeno generalizado debido a la necesidad de mano de obra infantil.', 'finding'],
  ['academia general militar', 'La dirección de la Academia General Militar en Zaragoza permitió a Franco formar una red de oficiales leales con experiencia en la guerra colonial.', 'finding'],
  ['acatamiento prudente de Franco ante la Segunda República', 'Franco adoptó una postura de acatamiento formal y prudente ante la proclamación de la Segunda República para preservar la disciplina militar.', 'claim'],
].map(([label, statement, type], index) => ({
  id: `idea-${index}`, label, statement, type: type as IdeaListItem['type'], workCount: index + 1,
  themes: ['franquismo', 'sociedad'], maxConfidence: 0.91, connectionCount: 4 + index,
}));

const source: KnowledgeViewSource = {
  key: 'ideas-spacing-harness',
  capabilities: { authors: true, readingState: true, tutor: true, manageThemes: true, audit: true, duplicates: true },
  listIdeasPage: async (request) => ({ items: ideas, total: 14_607, offset: request.offset, limit: request.limit }),
  getIdeaDetail: async () => null,
  listIdeaConnections: async () => [],
  getEdgeDetail: async () => null,
  getGraph: async () => ({ nodes: [], edges: [] }),
  deleteIdea: async () => undefined,
};

window.nodus = {
  onQueueProgress: () => () => undefined,
} as unknown as NodusApi;

document.documentElement.classList.add('light');
ReactDOM.createRoot(document.getElementById('root')!).render(
  <div className="h-screen bg-white text-neutral-900">
    <IdeasView vaultId="vault" onOpenGraph={() => undefined} onOpenAssistant={() => undefined} dataSource={source} />
  </div>,
);
