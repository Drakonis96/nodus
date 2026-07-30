import React from 'react';
import ReactDOM from 'react-dom/client';
import type { Character, CharacterChatConversation, NodusApi } from '../shared/types';
import { CharacterInterviewModal } from '../src/components/CharacterInterviewModal';
import '../src/index.css';

const createdAt = '2026-07-30T08:00:00.000Z';
const character: Character = {
  personId: 'character-ines',
  displayName: 'Inés Valcárcel',
  nationalId: null,
  sex: 'female',
  birthDate: 'Año 312 de la Concordia',
  deathDate: null,
  notes: null,
  names: [],
  portrait: null,
  frameStyle: null,
  biography: null,
  biographyAt: null,
  createdAt,
  updatedAt: createdAt,
  profile: {
    personId: 'character-ines',
    species: 'Humana',
    gender: 'Mujer',
    pronouns: 'ella',
    lifeStatus: 'alive',
    narrativeRole: 'protagonist',
    accent: 'violet',
    appearance: 'Cabello oscuro, mirada firme y abrigo de viaje.',
    personality: 'Observadora, directa y leal.',
    backstory: 'Custodia el último mapa del archipiélago.',
    visualSeed: null,
    birthYearSort: 312,
    deathYearSort: null,
    arc: { want: null, need: null, flaw: null, lie: null, wound: null },
    voice: { register: 'Sereno', tics: null, sample: null },
    biographyProposed: null,
    biographyProposedAt: null,
    createdAt,
    updatedAt: createdAt,
  },
};

const conversation: CharacterChatConversation = {
  id: 'chat-ines',
  personId: character.personId,
  title: 'El mapa y la tormenta',
  imageEnabled: true,
  messageCount: 4,
  imageCount: 0,
  createdAt,
  updatedAt: '2026-07-30T08:04:00.000Z',
  messages: [
    {
      id: 'message-1',
      role: 'author',
      content: '¿Por qué sigues guardando el mapa si ya no confías en el Consejo?',
      image: null,
      createdAt: '2026-07-30T08:01:00.000Z',
    },
    {
      id: 'message-2',
      role: 'character',
      content: 'Porque desconfiar de ellos no vuelve menos real lo que hay al otro lado del mar. El mapa no les pertenece.',
      image: null,
      createdAt: '2026-07-30T08:02:00.000Z',
    },
    {
      id: 'message-3',
      role: 'author',
      content: '¿Y a quién se lo entregarías?',
      image: null,
      createdAt: '2026-07-30T08:03:00.000Z',
    },
    {
      id: 'message-4',
      role: 'character',
      content: 'A alguien dispuesto a cruzar la tormenta sin convertir lo que encuentre en una conquista.',
      image: null,
      createdAt: '2026-07-30T08:04:00.000Z',
    },
  ],
};

const api = {
  listCharacterChatConversations: async () => [conversation],
  getCharacterChatConversation: async () => conversation,
  setCharacterChatImagesEnabled: async (_id: string, enabled: boolean) => ({
    ...conversation,
    imageEnabled: enabled,
  }),
  createCharacterChatConversation: async () => conversation,
  sendCharacterChatMessage: async () => ({ conversation, imageError: null }),
  deleteCharacterChatConversation: async () => undefined,
} as unknown as NodusApi;

window.nodus = api;
document.documentElement.classList.add('light', 'worldbuilding');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <main className="min-h-screen bg-gradient-to-br from-violet-100 via-neutral-100 to-white">
      <CharacterInterviewModal character={character} onClose={() => undefined} />
    </main>
  </React.StrictMode>
);
