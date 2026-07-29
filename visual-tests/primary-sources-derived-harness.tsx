import React from 'react';
import ReactDOM from 'react-dom/client';
import type { NodusApi } from '../shared/types';
import type {
  PrimarySourceEvidenceTrace,
  PrimarySourceMapWorkspace,
  PrimarySourceRelationsWorkspace,
  PrimarySourceTimelineWorkspace,
} from '../shared/primarySourcesTypes';
import { PrimarySourcesTimelineView } from '../src/views/PrimarySourcesTimelineView';
import { PrimarySourcesMapView } from '../src/views/PrimarySourcesMapView';
import { PrimarySourcesRelationsView } from '../src/views/PrimarySourcesRelationsView';
import '../src/index.css';

const trace = (
  id: string,
  itemId: string,
  title: string,
  quote: string,
  role: PrimarySourceEvidenceTrace['role'] = 'supports',
  targetKind: PrimarySourceEvidenceTrace['targetKind'] = 'event',
  targetId = 'event-1'
): PrimarySourceEvidenceTrace => ({
  evidenceId: id,
  targetKind,
  targetId,
  itemId,
  sourceTitle: title,
  referenceCode: `AHM/EXP/${itemId.slice(-1)}`,
  repositoryName: 'Archivo Histórico Municipal',
  excerptId: `excerpt-${id}`,
  locator: `expediente ${itemId.slice(-1)}, fol. 4r`,
  quote,
  role,
  certainty: role === 'contradicts' ? 0.74 : 0.94,
  reviewStatus: 'reviewed',
});

const eventEvidence = [
  trace('ev-1', 'source-1', 'Expediente de traslado de la familia Rojas', 'La familia de Isabel de Rojas trasladó su residencia entre 1894 y 1896.'),
  trace('ev-2', 'source-2', 'Declaración posterior de Tomás Rivera', 'El declarante recuerda que el traslado se produjo en 1898.', 'contradicts'),
];
const timeline: PrimarySourceTimelineWorkspace = {
  events: [
    {
      eventId: 'event-1',
      type: 'migration',
      label: 'Traslado de la familia Rojas',
      dateDisplay: 'entre 1894 y 1896',
      dateStartSort: '1894-01-01',
      dateEndSort: '1896-12-31',
      dateCertainty: 'between',
      reviewStatus: 'reviewed',
      placeId: 'place-1',
      placeName: 'Santa María del Río',
      notes: 'El intervalo aceptado mantiene visible una declaración discrepante.',
      participants: [
        { personId: 'person-1', displayName: 'Isabel de Rojas', role: 'principal' },
        { personId: 'person-2', displayName: 'Tomás Rivera', role: 'witness' },
      ],
      evidence: eventEvidence,
      sourceIds: ['source-1', 'source-2'],
      repositoryNames: ['Archivo Histórico Municipal'],
      hypothesis: false,
      hasContradiction: true,
      dateAlternatives: [
        { dateDisplay: 'entre 1894 y 1896', role: 'supports', evidenceId: 'ev-1' },
        { dateDisplay: '1898', role: 'contradicts', evidenceId: 'ev-2' },
      ],
    },
    {
      eventId: 'event-2',
      type: 'occupation',
      label: 'Nombramiento como maestra',
      dateDisplay: 'c. 1889',
      dateStartSort: '1889-01-01',
      dateEndSort: null,
      dateCertainty: 'circa',
      reviewStatus: 'reviewed',
      placeId: 'place-2',
      placeName: 'Cádiz',
      notes: null,
      participants: [{ personId: 'person-1', displayName: 'Isabel de Rojas', role: 'principal' }],
      evidence: [trace('ev-3', 'source-3', 'Libro de actas de la escuela', 'Doña Isabel de Rojas aparece como maestra desde aproximadamente 1889.')],
      sourceIds: ['source-3'],
      repositoryNames: ['Archivo Histórico Municipal'],
      hypothesis: false,
      hasContradiction: false,
      dateAlternatives: [],
    },
    {
      eventId: 'event-3',
      type: 'other',
      label: 'Posible viaje a Sevilla',
      dateDisplay: null,
      dateStartSort: null,
      dateEndSort: null,
      dateCertainty: 'unknown',
      reviewStatus: 'unreviewed',
      placeId: null,
      placeName: null,
      notes: 'Anotación de trabajo todavía no respaldada.',
      participants: [],
      evidence: [],
      sourceIds: [],
      repositoryNames: [],
      hypothesis: true,
      hasContradiction: false,
      dateAlternatives: [],
    },
  ],
  sources: [
    { id: 'source-1', label: 'Expediente de traslado de la familia Rojas' },
    { id: 'source-2', label: 'Declaración posterior de Tomás Rivera' },
    { id: 'source-3', label: 'Libro de actas de la escuela' },
  ],
  repositories: [{ id: 'Archivo Histórico Municipal', label: 'Archivo Histórico Municipal' }],
  persons: [
    { id: 'person-1', label: 'Isabel de Rojas' },
    { id: 'person-2', label: 'Tomás Rivera' },
  ],
  places: [
    { id: 'place-1', label: 'Santa María del Río' },
    { id: 'place-2', label: 'Cádiz' },
  ],
  eventTypes: ['migration', 'occupation'],
};

const placeEvidence = [
  trace('pl-1', 'source-4', 'Inventario de custodia del legajo', 'El legajo permaneció en Sancta Maria del Río hasta su transferencia.', 'supports', 'place', 'place-1'),
];
const mapWorkspace: PrimarySourceMapWorkspace = {
  points: [
    {
      pointId: 'mention:place-mention-1',
      placeId: 'place-1',
      mentionId: 'place-mention-1',
      eventId: null,
      originalLabel: 'Sancta Maria del Río',
      normalizedName: 'Santa María del Río',
      role: 'custody',
      layer: 'custody',
      latitude: 40.4168,
      longitude: -3.7038,
      coordinatePrecision: 'municipality',
      authority: { provider: 'offline_gazetteer', gazetteerId: 'geonames:3117735' },
      historicalContext: 'Jurisdicción histórica del partido, denominación vigente en el siglo XIX.',
      validFromDisplay: '1801',
      validToDisplay: '1899',
      dateDisplay: null,
      dateStartSort: null,
      dateEndSort: null,
      certainty: 0.94,
      resolutionStatus: 'resolved',
      sensitivity: 'normal',
      hypothesis: false,
      evidence: placeEvidence,
      sourceIds: ['source-4'],
      personIds: ['person-1'],
      eventType: null,
      sourceTypes: ['inventory'],
      repositoryNames: ['Archivo Histórico Municipal'],
      collectionIds: ['collection-1'],
      resolution: {
        resolutionId: 'resolution-1',
        placeId: 'place-1',
        mentionId: 'place-mention-1',
        selectedCandidate: {
          gazetteerId: 'geonames:3117735',
          name: 'Santa María del Río',
          admin1: 'Comunidad histórica',
          country: 'España',
          countryCode: 'ES',
          latitude: 40.4168,
          longitude: -3.7038,
          population: 1000,
        },
        alternatives: [{
          gazetteerId: 'geonames:alt',
          name: 'Santa María de Río',
          admin1: 'Otra provincia',
          country: 'España',
          countryCode: 'ES',
          latitude: 41.2,
          longitude: -4.1,
          population: 400,
        }],
        coordinatePrecision: 'municipality',
        historicalContext: 'Jurisdicción histórica del partido.',
        validFromDisplay: '1801',
        validToDisplay: '1899',
        rationale: 'Coincidencia de jurisdicción y contexto.',
        status: 'active',
        createdBy: 'Investigadora',
        createdAt: '2026-07-29T10:00:00.000Z',
        revertedAt: null,
      },
    },
    {
      pointId: 'event:event-2',
      placeId: 'place-2',
      mentionId: null,
      eventId: 'event-2',
      originalLabel: 'Cádiz',
      normalizedName: 'Cádiz',
      role: 'event_location',
      layer: 'events',
      latitude: 36.5297,
      longitude: -6.2926,
      coordinatePrecision: 'locality',
      authority: { gazetteerId: 'geonames:2520600' },
      historicalContext: null,
      validFromDisplay: null,
      validToDisplay: null,
      dateDisplay: 'c. 1889',
      dateStartSort: '1889-01-01',
      dateEndSort: null,
      certainty: 0.9,
      resolutionStatus: 'resolved',
      sensitivity: 'normal',
      hypothesis: false,
      evidence: timeline.events[1].evidence,
      sourceIds: ['source-3'],
      personIds: ['person-1'],
      eventType: 'occupation',
      sourceTypes: ['minutes'],
      repositoryNames: ['Archivo Histórico Municipal'],
      collectionIds: ['collection-2'],
      resolution: null,
    },
  ],
  sources: [
    { id: 'source-4', label: 'Inventario de custodia del legajo' },
    { id: 'source-3', label: 'Libro de actas de la escuela' },
  ],
  persons: [{ id: 'person-1', label: 'Isabel de Rojas' }],
  events: [{ id: 'event-2', label: 'Nombramiento como maestra' }],
  sourceTypes: ['inventory', 'minutes'],
  repositories: [{ id: 'Archivo Histórico Municipal', label: 'Archivo Histórico Municipal' }],
  collections: [
    { id: 'collection-1', label: 'Custodia y transferencias' },
    { id: 'collection-2', label: 'Educación local' },
  ],
  roles: ['custody', 'event_location'],
  layers: ['custody', 'events'],
};

const relationEvidence = [
  trace('rel-1', 'source-5', 'Protocolo notarial de 1890', 'Tomás Rivera actuó como notario de Isabel de Rojas.', 'supports', 'social_relation', 'relation-1'),
  trace('rel-2', 'source-6', 'Nota marginal del protocolo', 'La nota niega que Rivera interviniese como notario.', 'contradicts', 'social_relation', 'relation-1'),
];
const relations: PrimarySourceRelationsWorkspace = {
  nodes: [
    { nodeId: 'person-1', displayName: 'Isabel de Rojas', status: 'confirmed' },
    { nodeId: 'person-2', displayName: 'Tomás Rivera', status: 'confirmed' },
    { nodeId: 'person-3', displayName: 'Ángela Moreno', status: 'provisional' },
  ],
  edges: [
    {
      edgeId: 'relation-1',
      edgeKind: 'social',
      fromId: 'person-1',
      toId: 'person-2',
      fromName: 'Isabel de Rojas',
      toName: 'Tomás Rivera',
      relationType: 'cliente de',
      historicalLabel: 'cliente de',
      direction: 'directed',
      dateDisplay: 'entre 1888 y 1891',
      dateStartSort: '1888-01-01',
      dateEndSort: '1891-12-31',
      certainty: 0.84,
      status: 'confirmed',
      notes: 'Relación profesional documentada, con nota marginal contradictoria.',
      hypothesis: false,
      hasContradiction: true,
      evidence: relationEvidence,
      sourceIds: ['source-5', 'source-6'],
    },
    {
      edgeId: 'relation-2',
      edgeKind: 'social',
      fromId: 'person-2',
      toId: 'person-3',
      fromName: 'Tomás Rivera',
      toName: 'Ángela Moreno',
      relationType: 'corresponsal de',
      historicalLabel: 'corresponsal de',
      direction: 'mutual',
      dateDisplay: '1892',
      dateStartSort: '1892-01-01',
      dateEndSort: null,
      certainty: 0.91,
      status: 'confirmed',
      notes: null,
      hypothesis: false,
      hasContradiction: false,
      evidence: [trace('rel-3', 'source-7', 'Libro copiador de cartas', 'Rivera y Moreno mantuvieron correspondencia en 1892.', 'supports', 'social_relation', 'relation-2')],
      sourceIds: ['source-7'],
    },
  ],
  sources: [
    { id: 'source-5', label: 'Protocolo notarial de 1890' },
    { id: 'source-6', label: 'Nota marginal del protocolo' },
    { id: 'source-7', label: 'Libro copiador de cartas' },
  ],
  relationTypes: ['cliente de', 'corresponsal de'],
};

const api = {
  getPrimarySourceTimelineWorkspace: async () => timeline,
  getPrimarySourceMapWorkspace: async () => mapWorkspace,
  resolvePrimarySourceToponym: async () => mapWorkspace,
  revertPrimarySourceToponymResolution: async () => mapWorkspace,
  getPrimarySourceRelationsWorkspace: async () => relations,
  searchGazetteer: async () => mapWorkspace.points[0].resolution?.selectedCandidate
    ? [
      mapWorkspace.points[0].resolution.selectedCandidate,
      ...mapWorkspace.points[0].resolution.alternatives,
    ]
    : [],
  openExternal: async () => undefined,
} as unknown as NodusApi;

window.nodus = api;
const params = new URLSearchParams(window.location.search);
const dark = params.get('theme') !== 'light';
document.documentElement.classList.toggle('dark', dark);
document.documentElement.classList.toggle('light', !dark);
const view = params.get('view') ?? 'timeline';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div style={{ height: '100vh' }}>
      {view === 'map'
        ? <PrimarySourcesMapView />
        : view === 'relations'
          ? <PrimarySourcesRelationsView />
          : <PrimarySourcesTimelineView />}
    </div>
  </React.StrictMode>
);
