import React from 'react';
import ReactDOM from 'react-dom/client';
import type { NodusApi } from '../shared/types';
import type {
  PrimarySourcePersonAssertion,
  PrimarySourcePersonDossier,
  PrimarySourcePersonSummary,
} from '../shared/primarySourcesTypes';
import { PrimarySourcesPersonsView } from '../src/views/PrimarySourcesPersonsView';
import '../src/index.css';

const createdAt = '2026-07-29T10:00:00.000Z';
const sources = [
  { itemId: 'source-1', excerptId: 'excerpt-1', title: 'Padrón de habitantes de 1860', ref: 'AHM/PAD/1860/14', locator: 'fol. 14r, línea 8', label: 'Ysabel de Roxas', date: '1842', role: 'supports' as const },
  { itemId: 'source-2', excerptId: 'excerpt-2', title: 'Registro parroquial de matrimonios', ref: 'APSM/MAT/1871/32', locator: 'libro 7, fol. 32v', label: 'Isabel Rojas', date: '1843', role: 'supports' as const },
  { itemId: 'source-3', excerptId: 'excerpt-3', title: 'Expediente de embarque', ref: 'AGI/PAS/1881/209', locator: 'exp. 209, hoja 3', label: 'Isabela de Rojas', date: '1842', role: 'contextualizes' as const },
  { itemId: 'source-4', excerptId: 'excerpt-4', title: 'Partida de defunción', ref: 'RC/CAD/1907/88', locator: 'tomo 2, asiento 88', label: 'Ysabel de Roxas', date: '1844', role: 'contradicts' as const },
];

const mentions = sources.map((source, index) => ({
  mentionId: `mention-${index + 1}`,
  itemId: source.itemId,
  excerptId: source.excerptId,
  personId: index === 1 || index === 2 ? 'person-variant' : 'person-preferred',
  originalLabel: source.label,
  role: index === 1 ? 'contrayente' : index === 2 ? 'pasajera' : 'residente',
  certainty: index === 3 ? 0.72 : 0.94,
  identityStatus: index === 1 || index === 2 ? 'provisional' as const : 'confirmed' as const,
  createdAt,
  updatedAt: createdAt,
  sourceTitle: source.title,
  referenceCode: source.ref,
  repositoryName: index === 2 ? 'Archivo General de Indias' : 'Archivo histórico local',
  excerptLocator: source.locator,
  quotedText: `${source.label}, natural de Cádiz, figura en este asiento documental.`,
  evidenceRole: source.role,
  evidenceId: `evidence-${index + 1}`,
}));

const nameAssertions: PrimarySourcePersonAssertion[] = sources.map((source, index) => ({
  assertionId: `mention:mention-${index + 1}`,
  field: 'name',
  value: source.label,
  personId: index === 1 || index === 2 ? 'person-variant' : 'person-preferred',
  itemId: source.itemId,
  excerptId: source.excerptId,
  sourceTitle: source.title,
  referenceCode: source.ref,
  excerptLocator: source.locator,
  quotedText: `${source.label}, natural de Cádiz, figura en este asiento documental.`,
  evidenceId: `evidence-${index + 1}`,
  evidenceRole: source.role,
  certainty: index === 3 ? 0.72 : 0.94,
}));
const dateAssertions: PrimarySourcePersonAssertion[] = sources.map((source, index) => ({
  ...nameAssertions[index],
  assertionId: `decision-${index + 1}:birth_date`,
  field: 'birth_date',
  value: source.date,
}));
const assertions = [...nameAssertions, ...dateAssertions];
const variants = [
  { value: 'Isabel de Rojas', kind: 'preferred' as const, mentionCount: 0 },
  { value: 'Ysabel de Roxas', kind: 'documentary_mention' as const, mentionCount: 2 },
  { value: 'Isabel Rojas', kind: 'documentary_mention' as const, mentionCount: 1 },
  { value: 'Isabela de Rojas', kind: 'documentary_mention' as const, mentionCount: 1 },
];
const summary: PrimarySourcePersonSummary = {
  personId: 'person-preferred',
  displayName: 'Isabel de Rojas',
  identityStatus: 'confirmed',
  variants,
  mentionCount: 4,
  sourceCount: 4,
  evidenceCount: 4,
  discrepancyCount: 1,
  identityMemberCount: 2,
  updatedAt: createdAt,
};
const dossier: PrimarySourcePersonDossier = {
  summary,
  identityMembers: [
    { personId: 'person-preferred', displayName: 'Isabel de Rojas', identityStatus: 'confirmed', isPreferred: true, sourceCount: 2, mentionCount: 2 },
    { personId: 'person-variant', displayName: 'Isabel Rojas', identityStatus: 'merged', isPreferred: false, sourceCount: 2, mentionCount: 2 },
  ],
  mentions,
  assertions,
  discrepancies: [{
    field: 'birth_date',
    alternatives: ['1842', '1843', '1844'].map((date) => ({
      value: date,
      assertions: dateAssertions.filter((assertion) => assertion.value === date),
    })),
  }],
  candidates: [{
    personId: 'person-candidate',
    displayName: 'Isabel de Rosas',
    variants: ['Isabel de Rosas', 'Ysabel Rosas'],
    sourceCount: 1,
    mentionCount: 1,
    score: 0.82,
    reasons: ['similar_name', 'compatible_dates'],
  }],
  resolutions: [{
    resolutionId: 'merge-1',
    entityKind: 'person',
    sourceEntityId: 'person-variant',
    targetEntityId: 'person-preferred',
    decision: 'merge',
    rationale: 'Coincidencia confirmada tras comparar cuatro fragmentos y tres formas del nombre.',
    status: 'active',
    createdBy: 'Investigadora',
    createdAt,
    revertedAt: null,
  }],
};
const candidateSummary: PrimarySourcePersonSummary = {
  personId: 'person-candidate',
  displayName: 'Isabel de Rosas',
  identityStatus: 'provisional',
  variants: [
    { value: 'Isabel de Rosas', kind: 'preferred', mentionCount: 1 },
    { value: 'Ysabel Rosas', kind: 'documentary_mention', mentionCount: 1 },
  ],
  mentionCount: 1,
  sourceCount: 1,
  evidenceCount: 1,
  discrepancyCount: 0,
  identityMemberCount: 1,
  updatedAt: createdAt,
};
const candidateMention = {
  ...mentions[0],
  mentionId: 'mention-candidate',
  itemId: 'source-candidate',
  excerptId: 'excerpt-candidate',
  personId: 'person-candidate',
  originalLabel: 'Ysabel Rosas',
  sourceTitle: 'Testamento de Josefa Rojas',
  referenceCode: 'AHP/CAD/1899/41',
  excerptLocator: 'protocolo 41, fol. 9r',
  quotedText: 'Comparece Ysabel Rosas como testigo.',
  evidenceId: 'evidence-candidate',
};
const candidateDossier: PrimarySourcePersonDossier = {
  summary: candidateSummary,
  identityMembers: [{
    personId: 'person-candidate',
    displayName: 'Isabel de Rosas',
    identityStatus: 'provisional',
    isPreferred: true,
    sourceCount: 1,
    mentionCount: 1,
  }],
  mentions: [candidateMention],
  assertions: [{
    ...nameAssertions[0],
    assertionId: 'mention:mention-candidate',
    value: 'Ysabel Rosas',
    personId: 'person-candidate',
    itemId: 'source-candidate',
    excerptId: 'excerpt-candidate',
    sourceTitle: 'Testamento de Josefa Rojas',
    referenceCode: 'AHP/CAD/1899/41',
    excerptLocator: 'protocolo 41, fol. 9r',
    quotedText: 'Comparece Ysabel Rosas como testigo.',
    evidenceId: 'evidence-candidate',
  }],
  discrepancies: [],
  candidates: [],
  resolutions: [],
};

const api = {
  listPrimarySourcePersons: async (search?: string, filter?: string) => {
    const rows = [summary, candidateSummary];
    return rows.filter((person) =>
      (!search || person.variants.some((variant) => variant.value.toLocaleLowerCase().includes(search.toLocaleLowerCase())))
      && (!filter || filter === 'all'
        || (filter === 'provisional' && person.identityStatus === 'provisional')
        || (filter === 'confirmed' && person.identityStatus === 'confirmed')
        || (filter === 'discrepant' && person.discrepancyCount > 0))
    );
  },
  getPrimarySourcePersonDossier: async (personId: string) =>
    personId === summary.personId ? dossier : candidateDossier,
  addPrimarySourcePersonVariant: async () => dossier,
  mergePrimarySourcePersons: async () => dossier,
  revertPrimarySourcePersonMerge: async () => dossier,
} as unknown as NodusApi;

window.nodus = api;
const dark = new URLSearchParams(window.location.search).get('theme') !== 'light';
document.documentElement.classList.toggle('dark', dark);
document.documentElement.classList.toggle('light', !dark);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div style={{ height: '100vh' }}>
      <PrimarySourcesPersonsView />
    </div>
  </React.StrictMode>
);
