// Renderer-only QA for Markdown + LaTeX inside questions and flashcards: the real
// StudyBankView and StudyReviewView, a fake bridge and synthetic content. Nothing here
// talks to a database, a model or the network.
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { StudyFlashcard, StudyQuestion, StudyWorkspace } from '../../../shared/types';
import { StudyBankView } from '../../../src/views/StudyBankView';
import { StudyReviewView } from '../../../src/views/StudyReviewView';
import { setActiveLang } from '../../../src/i18n';

setActiveLang('es');

const now = new Date().toISOString();

const question: StudyQuestion = {
  id: 'q-chem-1',
  shortId: 'PREG-0001',
  prompt: [
    '**Ácido etanoico** (`CH₃COOH`)',
    '',
    '¿Cuál de estas fórmulas generales representa un **ácido carboxílico saturado**?',
    '',
    '- $C_nH_{2n}O_2 \\quad (n \\geq 2)$',
    '- $C_nH_{2n+2}$',
    '- $C_nH_{2n}$',
    '',
    '| Compuesto | Fórmula |',
    '| --- | --- |',
    '| Etanol | $C_2H_6O$ |',
    '| Ácido etanoico | $C_2H_4O_2$ |',
    '',
    '```text',
    'R-COOH + NaOH → R-COONa + H₂O',
    '```',
  ].join('\n'),
  type: 'single_choice',
  difficulty: 'medium',
  cognitiveLevel: 'understand',
  status: 'pending',
  answer: { text: 'La opción correcta es $C_nH_{2n}O_2 \\quad (n \\geq 2)$.', value: 'O1' },
  options: [
    { id: 'O1', text: '$C_nH_{2n}O_2 \\quad (n \\geq 2)$', correct: true },
    { id: 'O2', text: '**$C_nH_{2n+2}$** (alcano)', correct: false },
    { id: 'O3', text: '$C_nH_{2n}$ (alqueno)', correct: false },
    { id: 'O4', text: '`CH₃-CH₂-OH` (alcohol)', correct: false },
  ],
  explanation: [
    'El grupo funcional es el **carboxilo** ($-\\mathrm{COOH}$):',
    '',
    '1. Un carbono unido a dos oxígenos.',
    '2. El grupo aporta dos oxígenos por molécula.',
  ].join('\n'),
  rubric: {},
  competence: '',
  tags: ['nodus:test', 'quimica'],
  courseId: null,
  subjectId: 's-1',
  folderId: null,
  topicId: 't-1',
  documentId: null,
  materialId: null,
  recordingId: null,
  transcriptId: null,
  source: { title: 'Formulación orgánica', excerpt: 'Los ácidos carboxílicos responden a la fórmula $C_nH_{2n}O_2$ con $n \\geq 2$.', location: undefined },
  model: null,
  generationPrompt: '',
  favorite: false,
  locked: false,
  usageCount: 12,
  correctCount: 8,
  incorrectCount: 4,
  omittedCount: 0,
  totalResponseMs: 96_000,
  lastResponse: '$C_nH_{2n+2}$',
  lastScore: 0,
  lastMaxScore: 1,
  lastFeedback: 'Repasa el **grupo carboxilo**: tiene dos oxígenos, no solo carbonos e hidrógenos.',
  lastAnsweredAt: now,
  position: 0,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
};

const flashcard: StudyFlashcard = {
  id: 'card-chem-1',
  shortId: 'FC-0001',
  type: 'term_definition',
  front: '**Fórmula general** de los ácidos carboxílicos saturados, $C_nH_{2n}O_2 \\quad (n \\geq 2)$',
  back: '$C_nH_{2n}O_2 \\quad (n \\geq 2)$\n\n- Un grupo carboxilo `-COOH`\n- Dos oxígenos por molécula',
  hint: 'Empieza por el grupo funcional $-\\mathrm{COOH}$.',
  tags: ['quimica'],
  courseId: null,
  subjectId: 's-1',
  topicId: 't-1',
  documentId: null,
  materialId: null,
  transcriptId: null,
  questionId: 'q-chem-1',
  sourceExcerpt: 'La fórmula general de los ácidos carboxílicos es $C_nH_{2n}O_2$ para $n \\geq 2$.',
  difficulty: 'medium',
  favorite: false,
  position: 0,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
  srs: {
    easeFactor: 2.5,
    intervalDays: 3,
    dueAt: now,
    repetitions: 2,
    lapses: 0,
    lastRating: 3,
    lastReviewedAt: now,
    confidence: null,
    mastered: false,
    excluded: false,
  },
};

const workspace: StudyWorkspace = {
  academicYears: [],
  courses: [],
  subjects: [{ id: 's-1', courseId: null, name: 'Química', color: null, icon: null, emoji: null, createdAt: now, updatedAt: now } as StudyWorkspace['subjects'][number]],
  topics: [{ id: 't-1', subjectId: 's-1', name: 'Formulación orgánica', createdAt: now, updatedAt: now } as StudyWorkspace['topics'][number]],
  folders: [],
  documents: [],
  placements: [],
  tags: [],
  documentTags: [],
  templates: [],
};

const bridge = {
  listStudyQuestions: async () => [question],
  getStudyWorkspace: async () => workspace,
  listStudyAssistantSources: async () => [],
  listStudyQuestionCollections: async () => [],
  listStudyFlashcards: async () => [flashcard],
  getStudyQuestionAnalytics: async () => ({
    successRate: 0.67,
    observedDifficulty: 'adequate',
    averageResponseMs: 8_000,
    optionSelections: [
      { optionId: 'O1', selectedCount: 8 },
      { optionId: 'O2', selectedCount: 4 },
    ],
  }),
  findSimilarStudyQuestions: async () => [],
  listStudyQuestionVersions: async () => [],
  importStudyQuestions: async () => [],
  exportStudyQuestions: async () => undefined,
  generateStudyQuestions: async () => ({ questions: [] }),
  createStudyQuestion: async (input: unknown) => ({ ...question, ...(input as object) }),
  updateStudyQuestion: async () => question,
  duplicateStudyQuestion: async () => question,
  setStudyQuestionLifecycle: async () => undefined,
  restoreStudyQuestionVersion: async () => question,
  createStudyQuestionCollection: async () => ({ id: 'c-1', name: 'Colección', questionIds: [], questionCount: 0 }),
  setStudyQuestionCollectionItems: async () => undefined,
  searchStudyCorpus: async () => ({ results: [] }),
  reviewStudyFlashcard: async () => undefined,
  createStudyFlashcardsFromQuestions: async () => [flashcard],
  verifyCitations: async () => ({}),
  openExternal: async () => undefined,
};

(window as unknown as { nodus: typeof bridge }).nodus = bridge;

const params = new URLSearchParams(window.location.search);
const view = params.get('view') ?? 'bank';
const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  view === 'review'
    ? React.createElement(StudyReviewView)
    : React.createElement(StudyBankView, {
        onOpenDocument: () => undefined,
        onOpenMaterial: () => undefined,
        onOpenRecording: () => undefined,
      })
);
