import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  StudyAssistantSourceOption,
  StudyCognitiveLevel,
  StudyFlashcard,
  StudyFlashcardBulkAction,
  StudyFlashcardInput,
  StudyFlashcardSort,
  StudyFlashcardType,
  StudyMaterialSummary,
  StudyQuestion,
  StudyQuestionAnalytics,
  StudyQuestionBulkAction,
  StudyQuestionCollection,
  StudyQuestionDifficulty,
  StudyQuestionInput,
  StudyQuestionSort,
  StudyQuestionStatus,
  StudyQuestionSimilar,
  StudyQuestionType,
  StudyQuestionVersion,
  StudyWorkspace,
} from '@shared/types';
import { STUDY_GENERATABLE_QUESTION_TYPES, STUDY_QUESTION_SORTS, STUDY_QUESTION_TYPES } from '@shared/studyQuestions';
import type { StudyGeneratableQuestionType } from '@shared/studyQuestions';
import { STUDY_FLASHCARD_SORTS } from '@shared/studyFlashcards';
import { ConfirmModal } from '../components/ConfirmModal';
import { StudyInterchangeDialog } from '../components/StudyInterchangeDialog';
import { Icon, Spinner } from '../components/ui';
import { errorText, t } from '../i18n';
import { studyQuestionGenerationEmptyMessage } from '../studyQuestions';

const TYPE_LABELS: Record<StudyQuestionType, string> = {
  short: 'Respuesta breve', essay: 'Desarrollo', definition: 'Definición', relation: 'Relación', comparison: 'Comparación',
  commentary: 'Comentario', case: 'Caso práctico', true_false: 'Verdadero / falso', single_choice: 'Elección simple',
  multiple_choice: 'Respuesta múltiple', fill_blank: 'Completar', ordering: 'Ordenar', matching: 'Relacionar columnas',
};
const STATUS_LABELS: Record<StudyQuestionStatus, string> = { pending: 'Pendiente', approved: 'Aprobada', problematic: 'Problemática', discarded: 'Descartada' };
const DIFFICULTY_LABELS = { easy: 'Fácil', medium: 'Media', hard: 'Difícil', mixed: 'Mixta' } as const;
const COGNITIVE_LABELS: Record<StudyCognitiveLevel, string> = {
  remember: 'Recordar', understand: 'Comprender', analyze: 'Analizar', apply: 'Aplicar', synthesize: 'Sintetizar',
};
const CARD_TYPE_LABELS: Record<StudyFlashcardType, string> = {
  front_back: 'Anverso y reverso', term_definition: 'Término y definición', image_explanation: 'Imagen y explicación', cloze: 'Huecos ({{c1::…}})',
};
const QUESTION_SORT_LABELS: Record<StudyQuestionSort, string> = {
  updated: 'Actualización reciente', created: 'Creación reciente', prompt: 'Enunciado (A–Z)', difficulty: 'Dificultad',
  status: 'Estado', source: 'Fuente', usage: 'Más usadas', answered: 'Última respuesta',
};
const CARD_SORT_LABELS: Record<StudyFlashcardSort, string> = {
  due: 'Próxima revisión', created: 'Creación reciente', updated: 'Actualización reciente', front: 'Enunciado (A–Z)',
  difficulty: 'Dificultad', interval: 'Intervalo', lapses: 'Fallos',
};

function emptyDraft(): StudyQuestionInput {
  return {
    prompt: '', type: 'short', difficulty: 'medium', cognitiveLevel: 'understand', status: 'pending',
    answer: { text: '' }, explanation: '', tags: [], source: { title: 'Creación manual', excerpt: '' },
  };
}

function inputFromQuestion(question: StudyQuestion): StudyQuestionInput {
  return {
    prompt: question.prompt, type: question.type, difficulty: question.difficulty,
    cognitiveLevel: question.cognitiveLevel, status: question.status, answer: question.answer,
    options: question.options, explanation: question.explanation, rubric: question.rubric,
    competence: question.competence, tags: question.tags, courseId: question.courseId,
    subjectId: question.subjectId, topicId: question.topicId, documentId: question.documentId,
    materialId: question.materialId, recordingId: question.recordingId, transcriptId: question.transcriptId,
    source: question.source, model: question.model, generationPrompt: question.generationPrompt,
    favorite: question.favorite, locked: question.locked,
  };
}

function emptyCardDraft(): StudyFlashcardInput {
  return { type: 'front_back', front: '', back: '', hint: '', difficulty: 'medium', tags: [], sourceExcerpt: '', favorite: false };
}

function inputFromCard(card: StudyFlashcard): StudyFlashcardInput {
  return {
    type: card.type, front: card.front, back: card.back, hint: card.hint, tags: card.tags,
    courseId: card.courseId, subjectId: card.subjectId, topicId: card.topicId, documentId: card.documentId,
    materialId: card.materialId, transcriptId: card.transcriptId, questionId: card.questionId,
    sourceExcerpt: card.sourceExcerpt, difficulty: card.difficulty, favorite: card.favorite,
  };
}

export function StudyBankView({
  onOpenDocument,
  onOpenMaterial,
  onOpenRecording,
}: {
  onOpenDocument: (id: string) => void;
  onOpenMaterial: (id: string) => void;
  onOpenRecording: (id: string, timestamp?: number) => void;
}) {
  const [questions, setQuestions] = useState<StudyQuestion[]>([]);
  const [flashcards, setFlashcards] = useState<StudyFlashcard[]>([]);
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [sources, setSources] = useState<StudyAssistantSourceOption[]>([]);
  const [collections, setCollections] = useState<StudyQuestionCollection[]>([]);
  const [materials, setMaterials] = useState<StudyMaterialSummary[]>([]);
  const [questionTags, setQuestionTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [cardTags, setCardTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [tab, setTab] = useState<'questions' | 'flashcards'>('questions');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [semanticSearch, setSemanticSearch] = useState(false);
  const [type] = useState<StudyQuestionType | 'all'>('all');
  const [category, setCategory] = useState<'all' | 'test' | 'exam' | 'flashcards'>('all');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | 'all'>('all');
  const [status, setStatus] = useState<StudyQuestionStatus | 'all'>('all');
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [sourceKind, setSourceKind] = useState<'all' | 'document' | 'material' | 'recording'>('all');
  const [tag, setTag] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [questionSort, setQuestionSort] = useState<StudyQuestionSort>('updated');
  const [cardSort, setCardSort] = useState<StudyFlashcardSort>('due');
  const [bulkSubjectId, setBulkSubjectId] = useState('');
  const [bulkTopicId, setBulkTopicId] = useState('');
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkCollectionId, setBulkCollectionId] = useState('');
  const [bulkMessage, setBulkMessage] = useState('');
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<StudyQuestionInput | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [cardDraft, setCardDraft] = useState<StudyFlashcardInput | null>(null);
  const [cardDraftId, setCardDraftId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<StudyQuestionAnalytics | null>(null);
  const [similar, setSimilar] = useState<StudyQuestionSimilar[]>([]);
  const [versions, setVersions] = useState<StudyQuestionVersion[]>([]);
  const [showGenerator, setShowGenerator] = useState(false);
  const [generated, setGenerated] = useState<StudyQuestionInput[]>([]);
  const [sourceKeys, setSourceKeys] = useState<string[]>([]);
  const [generationType, setGenerationType] = useState<StudyGeneratableQuestionType>('single_choice');
  const [generationDifficulty, setGenerationDifficulty] = useState<StudyQuestionDifficulty>('mixed');
  const [generationCount, setGenerationCount] = useState(8);
  const [collectionName, setCollectionName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmCardDelete, setConfirmCardDelete] = useState<string | null>(null);
  const [showInterchange, setShowInterchange] = useState(false);
  const [interchangeBusy, setInterchangeBusy] = useState(false);
  const [interchangeResult, setInterchangeResult] = useState('');
  const [interchangeError, setInterchangeError] = useState('');

  const loadData = useCallback(async () => {
    const [nextWorkspace, nextSources, nextCollections, nextMaterials, nextQuestionTags, nextCardTags] = await Promise.all([
      window.nodus.getStudyWorkspace(), window.nodus.listStudyAssistantSources(), window.nodus.listStudyQuestionCollections(),
      window.nodus.listStudyMaterials(), window.nodus.listStudyQuestionTags(), window.nodus.listStudyFlashcardTags(),
    ]);
    setWorkspace(nextWorkspace); setSources(nextSources); setCollections(nextCollections);
    setMaterials(nextMaterials); setQuestionTags(nextQuestionTags); setCardTags(nextCardTags);
  }, []);

  const loadLists = useCallback(async () => {
    const [allQuestions, hybrid, allCards] = await Promise.all([
      window.nodus.listStudyQuestions({
        search: semanticSearch ? undefined : search, type, difficulty, status,
        subjectId: subjectId || undefined, topicId: topicId || undefined, materialId: materialId || undefined,
        sourceKind: sourceKind === 'all' ? undefined : sourceKind, tag: tag || undefined,
        favorite: favoritesOnly || undefined, sort: questionSort,
      }),
      semanticSearch && search.trim().length >= 2
        ? window.nodus.searchStudyCorpus(search, { kinds: ['question'], subjectId: subjectId || undefined, limit: 100 })
        : null,
      window.nodus.listStudyFlashcards({
        search: semanticSearch ? undefined : search, subjectId: subjectId || undefined, topicId: topicId || undefined,
        materialId: materialId || undefined, difficulty: difficulty === 'all' ? undefined : difficulty,
        tag: tag || undefined, favorite: favoritesOnly || undefined, sort: cardSort,
      }),
    ]);
    const resultIds = hybrid ? new Set(hybrid.results.map((result) => result.sourceId)) : null;
    const categoryTag = `nodus:${category}`;
    const categorized = category === 'all' || category === 'flashcards' ? (category === 'all' ? allQuestions : []) : allQuestions.filter((question) => question.tags.includes(categoryTag) || (!question.tags.some((entry) => entry.startsWith('nodus:')) && (category === 'test' ? ['single_choice', 'multiple_choice', 'true_false'].includes(question.type) : true)));
    const nextQuestions = resultIds ? categorized.filter((question) => resultIds.has(question.id)) : categorized;
    const nextCards = allCards;
    setQuestions(nextQuestions); setFlashcards(nextCards);
    setSelectedCardId((current) => current && nextCards.some((card) => card.id === current) ? current : null);
    setSelectedId((current) => current && nextQuestions.some((question) => question.id === current) ? current : (tab === 'questions' ? nextQuestions[0]?.id ?? null : null));
    setSelectedQuestionIds((current) => current.filter((id) => nextQuestions.some((question) => question.id === id)));
    setSelectedCardIds((current) => current.filter((id) => nextCards.some((card) => card.id === id)));
  }, [cardSort, category, difficulty, favoritesOnly, materialId, questionSort, search, semanticSearch, sourceKind, status, subjectId, tab, tag, type, topicId]);

  const load = useCallback(async () => { await Promise.all([loadLists(), loadData()]); }, [loadData, loadLists]);

  useEffect(() => { void loadData().catch((cause) => setError(errorText(cause))); }, [loadData]);
  useEffect(() => { void loadLists().catch((cause) => setError(errorText(cause))); }, [loadLists]);
  const selected = questions.find((question) => question.id === selectedId) ?? null;
  const selectedCard = flashcards.find((card) => card.id === selectedCardId) ?? null;
  const selectedCount = tab === 'questions' ? selectedQuestionIds.length : selectedCardIds.length;
  const selectedIds = tab === 'questions' ? selectedQuestionIds : selectedCardIds;
  const topics = useMemo(() => {
    const all = workspace?.topics ?? [];
    return subjectId ? all.filter((entry) => entry.subjectId === subjectId) : all;
  }, [subjectId, workspace?.topics]);
  const activeTags = tab === 'questions' ? questionTags : cardTags;
  const allVisibleSelected = tab === 'questions'
    ? questions.length > 0 && questions.every((question) => selectedQuestionIds.includes(question.id))
    : flashcards.length > 0 && flashcards.every((card) => selectedCardIds.includes(card.id));

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedCardId(null); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);
  useEffect(() => {
    if (!selectedId) { setAnalytics(null); setSimilar([]); setVersions([]); return; }
    void Promise.all([
      window.nodus.getStudyQuestionAnalytics(selectedId),
      window.nodus.findSimilarStudyQuestions(selectedId, 0.35),
      window.nodus.listStudyQuestionVersions(selectedId),
    ]).then(([nextAnalytics, nextSimilar, nextVersions]) => {
      setAnalytics(nextAnalytics); setSimilar(nextSimilar); setVersions(nextVersions);
    }).catch((cause) => setError(errorText(cause)));
  }, [selectedId]);

  const mutate = async (task: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await task(); await load(); } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };

  const toggleQuestionSelection = (id: string) => setSelectedQuestionIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  const toggleCardSelection = (id: string) => setSelectedCardIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  const toggleAllVisible = () => {
    if (tab === 'questions') setSelectedQuestionIds(allVisibleSelected ? [] : questions.map((question) => question.id));
    else setSelectedCardIds(allVisibleSelected ? [] : flashcards.map((card) => card.id));
  };
  const clearSelection = () => { if (tab === 'questions') setSelectedQuestionIds([]); else setSelectedCardIds([]); };

  const runQuestionBulk = async (action: StudyQuestionBulkAction, options: { note?: string; keepSelection?: boolean } = {}) => {
    if (!selectedQuestionIds.length) return;
    setBulkMessage('');
    await mutate(async () => {
      const affected = await window.nodus.bulkStudyQuestions(selectedQuestionIds, action);
      setBulkMessage(`${affected} ${t('elementos actualizados')}`);
      if (!options.keepSelection) clearSelection();
    });
  };
  const runCardBulk = async (action: StudyFlashcardBulkAction, options: { keepSelection?: boolean } = {}) => {
    if (!selectedCardIds.length) return;
    setBulkMessage('');
    await mutate(async () => {
      const affected = await window.nodus.bulkStudyFlashcards(selectedCardIds, action);
      setBulkMessage(`${affected} ${t('elementos actualizados')}`);
      if (!options.keepSelection) clearSelection();
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    const normalized: StudyQuestionInput = { ...draft, source: { ...draft.source, excerpt: draft.source?.excerpt || draft.explanation || draft.answer?.text || '' } };
    await mutate(async () => {
      const saved = draftId
        ? await window.nodus.updateStudyQuestion(draftId, normalized)
        : await window.nodus.createStudyQuestion(normalized);
      setDraft(null); setDraftId(null); setSelectedId(saved.id);
    });
  };

  const saveCard = async () => {
    if (!cardDraft) return;
    const normalized: StudyFlashcardInput = { ...cardDraft, sourceExcerpt: cardDraft.sourceExcerpt || cardDraft.front };
    await mutate(async () => {
      if (cardDraftId) {
        await window.nodus.updateStudyFlashcard(cardDraftId, normalized);
      } else {
        const created = await window.nodus.createStudyFlashcard(normalized);
        setSelectedCardId(created.id);
        setTab('flashcards');
      }
      setCardDraft(null); setCardDraftId(null);
    });
  };

  const generate = async () => {
    setBusy(true); setError('');
    try {
      const result = await window.nodus.generateStudyQuestions({
        sourceKeys, count: generationCount, difficulty: generationDifficulty, types: [generationType],
        cognitiveLevels: ['remember', 'understand', 'analyze', 'apply'], subjectId: subjectId || null,
      });
      setGenerated(result.questions);
      if (!result.questions.length) setError(studyQuestionGenerationEmptyMessage(result));
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };

  const saveGenerated = async () => {
    await mutate(async () => {
      for (const question of generated) await window.nodus.createStudyQuestion(question);
      setGenerated([]); setShowGenerator(false); setSourceKeys([]);
    });
  };

  const openSource = (question: StudyQuestion) => {
    if (question.documentId) onOpenDocument(question.documentId);
    else if (question.materialId) onOpenMaterial(question.materialId);
    else if (question.recordingId) onOpenRecording(question.recordingId, question.source.location?.timestampSeconds ?? undefined);
  };

  const exportInterchange = async (format: Parameters<typeof window.nodus.exportStudyInterchange>[1], options: Parameters<typeof window.nodus.exportStudyInterchange>[2]) => {
    setInterchangeBusy(true); setInterchangeError('');
    try {
      const written = await window.nodus.exportStudyInterchange(tab, format, options);
      if (written) setInterchangeResult(t('Exportación completada'));
    } catch (cause) { setInterchangeError(errorText(cause)); }
    finally { setInterchangeBusy(false); }
  };
  const importInterchange = async (options: Parameters<typeof window.nodus.importStudyInterchange>[1]) => {
    setInterchangeBusy(true); setInterchangeError('');
    try {
      const summary = await window.nodus.importStudyInterchange(tab, options);
      if (summary) {
        const warningText = summary.warnings.length ? ` · ${summary.warnings.length} ${t('Avisos')}` : '';
        setInterchangeResult(`${summary.imported} ${t('importados')} · ${summary.skipped} ${t('omitidos')}${warningText}`);
        await load();
      }
    } catch (cause) { setInterchangeError(errorText(cause)); }
    finally { setInterchangeBusy(false); }
  };

  const materialName = (id: string | null | undefined) => materials.find((entry) => entry.id === id)?.title ?? null;
  const documentName = (id: string | null | undefined) => workspace?.documents.find((entry) => entry.id === id)?.title ?? null;
  const subjectName = (id: string | null | undefined) => workspace?.subjects.find((entry) => entry.id === id)?.name ?? null;
  const topicName = (id: string | null | undefined) => workspace?.topics.find((entry) => entry.id === id)?.name ?? null;

  const renderBulkBar = () => (
    <section className="study-question-bulk mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-teal-800/60 bg-teal-950/20 px-3 py-2" data-testid="study-bank-bulk">
      <strong className="text-xs text-teal-200">{selectedCount} {t('seleccionados')}</strong>
      <button className="btn btn-ghost h-7 text-[10px]" onClick={clearSelection}>{t('Deseleccionar')}</button>
      <span className="ml-auto" />
      {tab === 'questions' ? <>
        <select data-testid="study-bank-bulk-status" className="input h-8 w-auto text-xs" value="" onChange={(event) => { if (event.target.value) void runQuestionBulk({ kind: 'status', status: event.target.value as StudyQuestionStatus }); }}>
          <option value="">{t('Cambiar estado')}</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select>
        <select data-testid="study-bank-bulk-difficulty" className="input h-8 w-auto text-xs" value="" onChange={(event) => { if (event.target.value) void runQuestionBulk({ kind: 'difficulty', difficulty: event.target.value as Exclude<StudyQuestionDifficulty, 'mixed'> }); }}>
          <option value="">{t('Cambiar dificultad')}</option>
          {(['easy', 'medium', 'hard'] as const).map((value) => <option key={value} value={value}>{t(DIFFICULTY_LABELS[value])}</option>)}
        </select>
        <select data-testid="study-bank-bulk-subject" className="input h-8 w-auto text-xs" value={bulkSubjectId} onChange={(event) => { setBulkSubjectId(event.target.value); setBulkTopicId(''); }}>
          <option value="">{t('Mover a…')}</option>
          {workspace?.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        </select>
        <select className="input h-8 w-auto text-xs" value={bulkTopicId} onChange={(event) => setBulkTopicId(event.target.value)} disabled={!bulkSubjectId}>
          <option value="">{t('Sin tema')}</option>
          {workspace?.topics.filter((entry) => entry.subjectId === bulkSubjectId).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
        <button data-testid="study-bank-bulk-move" className="btn btn-ghost h-7 text-[10px]" disabled={!bulkSubjectId} onClick={() => void runQuestionBulk({ kind: 'move', subjectId: bulkSubjectId, topicId: bulkTopicId || null, courseId: workspace?.subjects.find((entry) => entry.id === bulkSubjectId)?.courseId ?? null }, { keepSelection: true })}>{t('Mover')}</button>
        <input className="input h-8 w-40 text-xs" value={bulkTagInput} onChange={(event) => setBulkTagInput(event.target.value)} placeholder={t('Etiquetas separadas por comas')} />
        <button className="btn btn-ghost h-7 text-[10px]" disabled={!bulkTagInput.trim()} onClick={() => void runQuestionBulk({ kind: 'tags', add: bulkTagInput.split(',').map((entry) => entry.trim()).filter(Boolean) }, { keepSelection: true })}>{t('Añadir etiquetas')}</button>
        <button className="btn btn-ghost h-7 text-[10px]" disabled={!bulkTagInput.trim()} onClick={() => void runQuestionBulk({ kind: 'tags', remove: bulkTagInput.split(',').map((entry) => entry.trim()).filter(Boolean) }, { keepSelection: true })}>{t('Quitar etiquetas')}</button>
        <select className="input h-8 w-auto text-xs" value={bulkCollectionId} onChange={(event) => setBulkCollectionId(event.target.value)}>
          <option value="">{t('Colección')}</option>
          {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
        </select>
        <button className="btn btn-ghost h-7 text-[10px]" disabled={!bulkCollectionId} onClick={() => void runQuestionBulk({ kind: 'collections', add: [bulkCollectionId] }, { keepSelection: true })}>{t('Añadir a colección')}</button>
        <button data-testid="study-bank-bulk-cards" className="btn btn-ghost h-7 text-[10px]" onClick={() => void mutate(async () => { await window.nodus.createStudyFlashcardsFromQuestions(selectedQuestionIds); clearSelection(); setTab('flashcards'); })}><Icon name="flashcards" size={11} />{t('Crear flashcards')}</button>
        <button data-testid="study-bank-bulk-export" className="btn btn-ghost h-7 text-[10px]" onClick={() => { setInterchangeResult(''); setInterchangeError(''); setShowInterchange(true); }}><Icon name="download" size={11} />{t('Exportar selección')}</button>
        <button className="btn btn-ghost h-7 text-[10px]" onClick={() => void runQuestionBulk({ kind: 'lifecycle', action: 'archive' })}><Icon name="archive" size={11} />{t('Archivar')}</button>
        <button className="btn btn-ghost h-7 text-[10px] text-red-400" onClick={() => setConfirmBulkDelete(true)}><Icon name="trash" size={11} />{t('Eliminar')}</button>
      </> : <>
        <select data-testid="study-bank-bulk-difficulty" className="input h-8 w-auto text-xs" value="" onChange={(event) => { if (event.target.value) void runCardBulk({ kind: 'difficulty', difficulty: event.target.value as StudyFlashcard['difficulty'] }); }}>
          <option value="">{t('Cambiar dificultad')}</option>
          {(['easy', 'medium', 'hard'] as const).map((value) => <option key={value} value={value}>{t(DIFFICULTY_LABELS[value])}</option>)}
        </select>
        <select data-testid="study-bank-bulk-state" className="input h-8 w-auto text-xs" value="" onChange={(event) => {
          const value = event.target.value as '' | 'master' | 'reset' | 'exclude' | 'include' | 'archive' | 'delete';
          if (!value) return;
          if (value === 'delete') { setConfirmBulkDelete(true); return; }
          void runCardBulk({ kind: 'state', action: value });
        }}>
          <option value="">{t('Cambiar estado')}</option>
          <option value="master">{t('Marcar como dominada')}</option>
          <option value="reset">{t('Reiniciar repaso')}</option>
          <option value="exclude">{t('Excluir del repaso')}</option>
          <option value="include">{t('Incluir en el repaso')}</option>
          <option value="archive">{t('Archivar')}</option>
          <option value="delete">{t('Eliminar')}</option>
        </select>
        <select data-testid="study-bank-bulk-subject" className="input h-8 w-auto text-xs" value={bulkSubjectId} onChange={(event) => { setBulkSubjectId(event.target.value); setBulkTopicId(''); }}>
          <option value="">{t('Mover a…')}</option>
          {workspace?.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        </select>
        <select className="input h-8 w-auto text-xs" value={bulkTopicId} onChange={(event) => setBulkTopicId(event.target.value)} disabled={!bulkSubjectId}>
          <option value="">{t('Sin tema')}</option>
          {workspace?.topics.filter((entry) => entry.subjectId === bulkSubjectId).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
        <button className="btn btn-ghost h-7 text-[10px]" disabled={!bulkSubjectId} onClick={() => void runCardBulk({ kind: 'move', subjectId: bulkSubjectId, topicId: bulkTopicId || null, courseId: workspace?.subjects.find((entry) => entry.id === bulkSubjectId)?.courseId ?? null }, { keepSelection: true })}>{t('Mover')}</button>
        <input className="input h-8 w-40 text-xs" value={bulkTagInput} onChange={(event) => setBulkTagInput(event.target.value)} placeholder={t('Etiquetas separadas por comas')} />
        <button className="btn btn-ghost h-7 text-[10px]" disabled={!bulkTagInput.trim()} onClick={() => void runCardBulk({ kind: 'tags', add: bulkTagInput.split(',').map((entry) => entry.trim()).filter(Boolean) }, { keepSelection: true })}>{t('Añadir etiquetas')}</button>
        <button className="btn btn-ghost h-7 text-[10px]" disabled={!bulkTagInput.trim()} onClick={() => void runCardBulk({ kind: 'tags', remove: bulkTagInput.split(',').map((entry) => entry.trim()).filter(Boolean) }, { keepSelection: true })}>{t('Quitar etiquetas')}</button>
        <button data-testid="study-bank-bulk-export" className="btn btn-ghost h-7 text-[10px]" onClick={() => { setInterchangeResult(''); setInterchangeError(''); setShowInterchange(true); }}><Icon name="download" size={11} />{t('Exportar selección')}</button>
        <button className="btn btn-ghost h-7 text-[10px] text-red-400" onClick={() => setConfirmBulkDelete(true)}><Icon name="trash" size={11} />{t('Eliminar')}</button>
      </>}
    </section>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="study-question-bank">
      <header className="study-question-bank-header border-b border-neutral-800 bg-neutral-950/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto"><p className="text-[10px] font-medium uppercase tracking-[0.18em] text-teal-400">{t('Evaluación')}</p><h1 className="text-xl font-semibold">{t('Banco de preguntas')}</h1></div>
          <button className="btn btn-ghost" data-testid="study-bank-import" onClick={() => { setInterchangeResult(''); setInterchangeError(''); setShowInterchange(true); }}><Icon name="upload" />{t('Importar')}</button>
          <button className="btn btn-ghost" data-testid="study-bank-export" onClick={() => { setInterchangeResult(''); setInterchangeError(''); setShowInterchange(true); }}><Icon name="download" />{t('Exportar')}</button>
          <button data-testid="study-bank-flashcard-new" className="btn btn-secondary" onClick={() => { setCardDraft(emptyCardDraft()); setCardDraftId(null); setSelectedCardId(null); setTab('flashcards'); setDraft(null); setShowGenerator(false); }}><Icon name="flashcards" />{t('Nueva flashcard')}</button>
          <button data-testid="study-question-generate" className="btn btn-secondary" onClick={() => { setShowGenerator(!showGenerator); setDraft(null); setDraftId(null); }}><Icon name="wand" />{t('Generar')}</button>
          <button data-testid="study-question-new" className="btn btn-primary" onClick={() => { setDraft(emptyDraft()); setDraftId(null); setShowGenerator(false); setTab('questions'); }}><Icon name="plus" />{t('Nueva pregunta')}</button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label={t('Preguntas')} className="flex rounded-lg bg-neutral-900 p-0.5">
            <button data-testid="study-bank-tab-questions" role="tab" aria-selected={tab === 'questions'} className={`rounded-md px-3 py-1 text-xs ${tab === 'questions' ? 'bg-teal-900/60 text-teal-200' : 'text-neutral-500 hover:text-neutral-300'}`} onClick={() => { setTab('questions'); setQuestionSort('updated'); }}>{t('Preguntas')} · {questions.length}</button>
            <button data-testid="study-bank-tab-flashcards" role="tab" aria-selected={tab === 'flashcards'} className={`rounded-md px-3 py-1 text-xs ${tab === 'flashcards' ? 'bg-teal-900/60 text-teal-200' : 'text-neutral-500 hover:text-neutral-300'}`} onClick={() => { setTab('flashcards'); setCardSort('due'); setCategory('all'); }}>{t('Flashcards')} · {flashcards.length}</button>
          </div>
          <div className="relative min-w-[220px] flex-1"><Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" /><input className="input input-with-leading-icon w-full pr-20" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar enunciado, explicación o etiqueta…')} /><button data-testid="study-question-search-mode" type="button" className={`absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[9px] ${semanticSearch ? 'bg-teal-900/50 text-teal-200' : 'bg-neutral-800 text-neutral-400'}`} onClick={() => setSemanticSearch((value) => !value)}>{t(semanticSearch ? 'Híbrida' : 'Literal')}</button></div>
          <select data-testid="study-bank-category" className="input w-auto" value={category} onChange={(event) => { const value = event.target.value as typeof category; setCategory(value); if (value === 'flashcards') { setTab('flashcards'); setCardSort('due'); } else setTab('questions'); }}><option value="all">{t('Todos')}</option><option value="test">{t('Test')}</option><option value="exam">{t('Examen')}</option><option value="flashcards">{t('Flashcards')}</option></select>
          <select className="input w-auto" value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}><option value="all">{t('Toda dificultad')}</option>{(['easy', 'medium', 'hard'] as const).map((value) => <option key={value} value={value}>{t(DIFFICULTY_LABELS[value])}</option>)}</select>
          <select className="input w-auto" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">{t('Todos los estados')}</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select>
          <select className="input w-auto" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(''); }}><option value="">{t('Todas las asignaturas')}</option>{workspace?.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>
          <select data-testid="study-bank-topic-filter" className="input w-auto" value={topicId} onChange={(event) => setTopicId(event.target.value)}><option value="">{t('Todos los temas')}</option>{topics.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
          <select data-testid="study-bank-source-kind" className="input w-auto" value={sourceKind} onChange={(event) => setSourceKind(event.target.value as typeof sourceKind)}><option value="all">{t('Todas las fuentes')}</option><option value="document">{t('Documento')}</option><option value="material">{t('Material')}</option><option value="recording">{t('Grabación')}</option></select>
          <select data-testid="study-bank-material-filter" className="input w-auto max-w-48" value={materialId} onChange={(event) => setMaterialId(event.target.value)}><option value="">{t('Todos los materiales')}</option>{materials.map((material) => <option key={material.id} value={material.id}>{material.title}</option>)}</select>
          <select data-testid="study-bank-tag-filter" className="input w-auto max-w-40" value={tag} onChange={(event) => setTag(event.target.value)}><option value="">{t('Todas las etiquetas')}</option>{activeTags.map((entry) => <option key={entry.tag} value={entry.tag}>{entry.tag} ({entry.count})</option>)}</select>
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 px-2 py-1.5 text-xs text-neutral-400"><input data-testid="study-bank-favorite-filter" type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />{t('Favoritas')}</label>
          <select data-testid="study-bank-sort" className="input w-auto" value={tab === 'questions' ? questionSort : cardSort} onChange={(event) => { if (tab === 'questions') setQuestionSort(event.target.value as StudyQuestionSort); else setCardSort(event.target.value as StudyFlashcardSort); }} aria-label={t('Ordenar por')}>
            {(tab === 'questions' ? STUDY_QUESTION_SORTS.map((value) => [value, QUESTION_SORT_LABELS[value]] as const) : STUDY_FLASHCARD_SORTS.map((value) => [value, CARD_SORT_LABELS[value]] as const)).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
          </select>
          <button className="btn btn-ghost h-8 text-xs" onClick={() => { setSearch(''); setCategory('all'); setDifficulty('all'); setStatus('all'); setSubjectId(''); setTopicId(''); setMaterialId(''); setSourceKind('all'); setTag(''); setFavoritesOnly(false); setQuestionSort('updated'); setCardSort('due'); }}><Icon name="filter" size={12} />{t('Limpiar filtros')}</button>
        </div>
      </header>

      {error && <div className="mx-4 mt-3 rounded-lg border border-red-900/60 bg-red-950/25 px-3 py-2 text-xs text-red-300">{error}</div>}
      {bulkMessage && <div data-testid="study-bank-bulk-message" className="mx-4 mt-3 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{bulkMessage}</div>}
      {selectedCount > 0 && renderBulkBar()}

      {draft && <section className="m-4 grid gap-3 rounded-xl border border-teal-900/60 bg-teal-950/15 p-4 lg:grid-cols-2" data-testid="study-question-editor">
        <h2 className="lg:col-span-2 text-sm font-semibold text-teal-200">{t(draftId ? 'Editar pregunta' : 'Nueva pregunta')}</h2>
        <label className="lg:col-span-2 text-xs text-neutral-500">{t('Enunciado')}<textarea autoFocus className="input mt-1 min-h-20 w-full" value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} /></label>
        <label className="text-xs text-neutral-500">{t('Tipo')}<select className="input mt-1 w-full" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as StudyQuestionType })}>{STUDY_QUESTION_TYPES.map((value) => <option key={value} value={value}>{t(TYPE_LABELS[value])}</option>)}</select></label>
        <label className="text-xs text-neutral-500">{t('Dificultad')}<select className="input mt-1 w-full" value={draft.difficulty} onChange={(event) => setDraft({ ...draft, difficulty: event.target.value as 'easy' | 'medium' | 'hard' })}>{(['easy', 'medium', 'hard'] as const).map((value) => <option key={value} value={value}>{t(DIFFICULTY_LABELS[value])}</option>)}</select></label>
        <label className="text-xs text-neutral-500">{t('Respuesta correcta / modelo')}<textarea className="input mt-1 min-h-20 w-full" value={draft.answer?.text ?? ''} onChange={(event) => setDraft({ ...draft, answer: { ...draft.answer, text: event.target.value } })} /></label>
        <label className="text-xs text-neutral-500">{t('Explicación y justificación')}<textarea className="input mt-1 min-h-20 w-full" value={draft.explanation} onChange={(event) => setDraft({ ...draft, explanation: event.target.value, source: { ...draft.source, excerpt: event.target.value } })} /></label>
        <label className="text-xs text-neutral-500">{t('Nivel cognitivo')}<select data-testid="study-question-editor-cognitive" className="input mt-1 w-full" value={draft.cognitiveLevel ?? 'understand'} onChange={(event) => setDraft({ ...draft, cognitiveLevel: event.target.value as StudyCognitiveLevel })}>{Object.entries(COGNITIVE_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
        <label className="text-xs text-neutral-500">{t('Estado')}<select className="input mt-1 w-full" value={draft.status ?? 'pending'} onChange={(event) => setDraft({ ...draft, status: event.target.value as StudyQuestionStatus })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
        <label className="text-xs text-neutral-500">{t('Asignatura')}<select data-testid="study-question-editor-subject" className="input mt-1 w-full" value={draft.subjectId ?? ''} onChange={(event) => { const nextSubject = workspace?.subjects.find((entry) => entry.id === event.target.value); setDraft({ ...draft, subjectId: event.target.value || null, topicId: null, courseId: nextSubject?.courseId ?? draft.courseId ?? null }); }}><option value="">{t('Sin asignatura')}</option>{workspace?.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
        <label className="text-xs text-neutral-500">{t('Tema')}<select data-testid="study-question-editor-topic" className="input mt-1 w-full" value={draft.topicId ?? ''} onChange={(event) => setDraft({ ...draft, topicId: event.target.value || null })}><option value="">{t('Sin tema')}</option>{(workspace?.topics ?? []).filter((entry) => (draft.subjectId ? entry.subjectId === draft.subjectId : true)).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        <label className="text-xs text-neutral-500">{t('Título de la fuente')}<input className="input mt-1 w-full" value={draft.source?.title ?? ''} onChange={(event) => setDraft({ ...draft, source: { ...draft.source, title: event.target.value } })} /></label>
        <label className="text-xs text-neutral-500">{t('Fragmento o justificación')}<input className="input mt-1 w-full" value={draft.source?.excerpt ?? ''} onChange={(event) => setDraft({ ...draft, source: { ...draft.source, excerpt: event.target.value } })} /></label>
        {['single_choice', 'multiple_choice'].includes(draft.type) && <label className="lg:col-span-2 text-xs text-neutral-500">{t('Opciones (una por línea; anteponer * a las correctas)')}<textarea data-testid="study-question-options-editor" className="input mt-1 min-h-28 w-full font-mono" value={(draft.options ?? []).map((option) => `${option.correct ? '* ' : ''}${option.text}`).join('\n')} onChange={(event) => setDraft({ ...draft, options: event.target.value.split('\n').map((line, index) => ({ id: `O${index + 1}`, text: line.replace(/^\*\s*/, '').trim(), correct: /^\*\s*/.test(line) })).filter((option) => option.text) })} /></label>}
        <label className="lg:col-span-2 text-xs text-neutral-500">{t('Etiquetas (separadas por comas)')}<input className="input mt-1 w-full" value={draft.tags?.join(', ') ?? ''} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
        <div className="lg:col-span-2 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => { setDraft(null); setDraftId(null); }}>{t('Cancelar')}</button><button data-testid="study-question-save" className="btn btn-primary" disabled={busy || !draft.prompt.trim()} onClick={() => void saveDraft()}>{t(draftId ? 'Guardar cambios' : 'Guardar pregunta')}</button></div>
      </section>}

      {showGenerator && <section className="m-4 rounded-xl border border-indigo-900/60 bg-indigo-950/15 p-4" data-testid="study-question-generator">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-neutral-500">{t('Cantidad')}<input className="input mt-1 w-20" type="number" min="1" max="40" value={generationCount} onChange={(event) => setGenerationCount(Number(event.target.value))} /></label>
          {/* Only the types the generator can really produce: the rest stay available for
              a question written by hand above, but asking the AI for one used to return a
              single_choice question wearing the requested type's name. */}
          <label className="text-xs text-neutral-500">{t('Tipo')}<select data-testid="study-generation-type" className="input mt-1" value={generationType} onChange={(event) => setGenerationType(event.target.value as StudyGeneratableQuestionType)}>{STUDY_GENERATABLE_QUESTION_TYPES.map((value) => <option key={value} value={value}>{t(TYPE_LABELS[value])}</option>)}</select></label>
          <label className="text-xs text-neutral-500">{t('Dificultad')}<select className="input mt-1" value={generationDifficulty} onChange={(event) => setGenerationDifficulty(event.target.value as StudyQuestionDifficulty)}>{(['mixed', 'easy', 'medium', 'hard'] as const).map((value) => <option key={value} value={value}>{t(DIFFICULTY_LABELS[value])}</option>)}</select></label>
          <button className="btn btn-primary" disabled={busy || (!sourceKeys.length && !sources.length)} onClick={() => void generate()}>{busy ? <Spinner label={t('Generando…')} /> : <><Icon name="wand" />{t('Generar borradores')}</>}</button>
        </div>
        <p className="mt-3 text-[10px] text-neutral-500">{sourceKeys.length ? `${sourceKeys.length} ${t('fuentes seleccionadas')}` : t('Sin selección: se usará el ámbito filtrado disponible.')}</p>
        <div className="mt-2 grid max-h-40 gap-1 overflow-y-auto md:grid-cols-2">{sources.map((source) => <label key={source.sourceKey} className="flex items-start gap-2 rounded-lg border border-neutral-800 px-2 py-1.5 text-xs"><input type="checkbox" checked={sourceKeys.includes(source.sourceKey)} onChange={(event) => setSourceKeys(event.target.checked ? [...sourceKeys, source.sourceKey] : sourceKeys.filter((key) => key !== source.sourceKey))} /><span><span className="block text-neutral-300">{source.title}</span><span className="text-[10px] text-neutral-600">{source.subtitle}</span></span></label>)}</div>
        {generated.length > 0 && <div className="mt-3 space-y-2"><div className="flex items-center"><strong className="text-xs">{generated.length} {t('borradores para revisar')}</strong><button className="btn btn-primary ml-auto" onClick={() => void saveGenerated()}>{t('Aprobar y guardar todo')}</button></div>{generated.map((question, index) => <article key={`${question.prompt}-${index}`} className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3"><p className="text-sm">{question.prompt}</p><p className="mt-1 text-xs text-emerald-300">{question.answer?.text ?? String(question.answer?.value ?? '')}</p><p className="mt-1 text-[10px] text-neutral-600">{question.source?.title} · {question.explanation}</p></article>)}</div>}
      </section>}

      {!draft && !showGenerator && <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section className="study-question-table-shell overflow-hidden rounded-xl border border-neutral-800" data-testid="study-question-table">
          <div className="mb-3 flex items-center gap-2"><span className="text-xs text-neutral-500">{tab === 'questions' ? questions.length : flashcards.length} {t('elementos')}</span><span className="ml-auto text-[10px] text-neutral-700">{collections.length} {t('colecciones')}</span></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[920px] border-collapse text-left text-xs">
            <thead className="study-question-table-head border-y border-neutral-800 bg-neutral-900/60 text-[10px] uppercase tracking-wider text-neutral-500"><tr>
              <th className="w-10 px-3 py-2.5"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label={t('Seleccionar todo')} /></th>
              <th className="px-3 py-2.5">{t('Pregunta')}</th><th className="px-3 py-2.5">{t('Tipo')}</th><th className="px-3 py-2.5">{t('Dificultad')}</th><th className="px-3 py-2.5">{t('Estado')}</th><th className="px-3 py-2.5">{t('Asignatura')}</th><th className="px-3 py-2.5">{t('Fuente')}</th><th className="px-3 py-2.5">{t('Creada')}</th>
            </tr></thead>
            <tbody className="divide-y divide-neutral-800">{tab === 'questions' && questions.map((question) => {
              const subject = workspace?.subjects.find((entry) => entry.id === question.subjectId);
              return <tr data-testid={`study-question-${question.id}`} key={question.id} className={`study-question-table-row cursor-pointer ${selectedId === question.id ? 'is-selected bg-teal-950/25' : 'hover:bg-neutral-900/40'}`} onClick={() => { setSelectedId(question.id); setSelectedCardId(null); }}>
                <td className="px-3 py-3 text-center" onClick={(event) => event.stopPropagation()}><input data-testid={`study-question-select-${question.id}`} type="checkbox" checked={selectedQuestionIds.includes(question.id)} onChange={() => toggleQuestionSelection(question.id)} aria-label={t('Seleccionar elemento')} /></td>
                <td className="max-w-[420px] px-3 py-3"><p className="line-clamp-2 font-medium text-neutral-200">{question.prompt}</p><span className="mt-1 block text-[10px] text-neutral-600">{question.shortId}{question.favorite ? ` · ${t('Favorita')}` : ''}</span></td><td className="whitespace-nowrap px-3 py-3">{t(TYPE_LABELS[question.type])}</td><td className="whitespace-nowrap px-3 py-3">{t(DIFFICULTY_LABELS[question.difficulty])}</td><td className="whitespace-nowrap px-3 py-3"><span className="rounded-full bg-teal-900/30 px-2 py-1 text-[10px] text-teal-300">{t(STATUS_LABELS[question.status])}</span></td><td className="max-w-40 truncate px-3 py-3 text-neutral-400">{subject?.name ?? '—'}</td><td className="max-w-48 truncate px-3 py-3 text-neutral-400">{question.source.title || t('Sin fuente enlazada')}</td><td className="whitespace-nowrap px-3 py-3 text-neutral-500">{new Date(question.createdAt).toLocaleDateString()}</td>
              </tr>;
            })}{tab === 'flashcards' && flashcards.map((card) => {
              const subject = workspace?.subjects.find((entry) => entry.id === card.subjectId);
              return <tr data-testid={`study-flashcard-${card.id}`} key={card.id} className={`study-question-table-row cursor-pointer ${selectedCardId === card.id ? 'is-selected bg-teal-950/25' : 'hover:bg-neutral-900/40'}`} onClick={() => { setSelectedCardId(card.id); setSelectedId(null); }}>
                <td className="px-3 py-3 text-center" onClick={(event) => event.stopPropagation()}><input data-testid={`study-flashcard-select-${card.id}`} type="checkbox" checked={selectedCardIds.includes(card.id)} onChange={() => toggleCardSelection(card.id)} aria-label={t('Seleccionar elemento')} /></td>
                <td className="max-w-[420px] px-3 py-3"><p className="line-clamp-2 font-medium text-neutral-200">{card.front}</p><span className="mt-1 block text-[10px] text-neutral-600">{card.shortId}{card.favorite ? ` · ${t('Favorita')}` : ''}</span></td><td className="whitespace-nowrap px-3 py-3"><span className="inline-flex items-center gap-1 text-teal-300"><Icon name="flashcards" size={12} />{t('Flashcard')}</span></td><td className="whitespace-nowrap px-3 py-3">{t(DIFFICULTY_LABELS[card.difficulty])}</td><td className="whitespace-nowrap px-3 py-3"><span className="rounded-full bg-indigo-900/30 px-2 py-1 text-[10px] text-indigo-300">{t(card.srs.mastered ? 'Dominada' : 'En revisión')}</span></td><td className="max-w-40 truncate px-3 py-3 text-neutral-400">{subject?.name ?? '—'}</td><td className="max-w-48 truncate px-3 py-3 text-neutral-400">{card.sourceExcerpt || t('Sin fuente enlazada')}</td><td className="whitespace-nowrap px-3 py-3 text-neutral-500">{new Date(card.createdAt).toLocaleDateString()}</td>
              </tr>;
            })}</tbody>
          </table></div>
          {(tab === 'questions' ? !questions.length : !flashcards.length) && <div className="rounded-xl border border-dashed border-neutral-800 p-6 text-center text-xs text-neutral-600">{t('No hay elementos con estos filtros.')}</div>}
        </section>
        {tab === 'questions' && <main className="study-question-detail mt-4 rounded-xl border border-neutral-800 bg-white p-4 dark:bg-transparent" data-testid="study-question-detail">{selected ? <>
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-teal-900/30 px-2 py-1 text-[10px] text-teal-300">{t(STATUS_LABELS[selected.status])}</span><span className="rounded-full bg-neutral-900 px-2 py-1 text-[10px] text-neutral-400">{t(TYPE_LABELS[selected.type])}</span><span className="rounded-full bg-neutral-900 px-2 py-1 text-[10px] text-neutral-400">{t(DIFFICULTY_LABELS[selected.difficulty])}</span>{selected.locked && <span className="text-[10px] text-neutral-500"><Icon name="lock" size={10} /> {t('Validada y bloqueada')}</span>}<span className="ml-auto text-[10px] text-neutral-600">{selected.shortId}</span></div>
          <h2 className="mt-3 text-lg font-medium leading-7">{selected.prompt}</h2>
          <section className="study-question-metadata mt-3 flex flex-wrap items-center gap-1.5" data-testid="study-question-metadata">
            {selected.subjectId && <button className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600 hover:bg-teal-100 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-teal-950/40" onClick={() => { setSubjectId(selected.subjectId ?? ''); setTab('questions'); }}>{subjectName(selected.subjectId)}</button>}
            {selected.topicId && <button className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600 hover:bg-teal-100 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-teal-950/40" onClick={() => { setTopicId(selected.topicId ?? ''); setTab('questions'); }}>{topicName(selected.topicId)}</button>}
            {selected.materialId && <span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">{t('Material')}: {materialName(selected.materialId) ?? selected.materialId}</span>}
            {selected.documentId && <span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">{t('Documento')}: {documentName(selected.documentId) ?? selected.documentId}</span>}
            <span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">{t(COGNITIVE_LABELS[selected.cognitiveLevel])}</span>
            {selected.tags.map((entry) => <button key={entry} className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600 hover:bg-teal-100 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-teal-950/40" onClick={() => { setTag(entry); setTab('questions'); }}>#{entry}</button>)}
          </section>
          {selected.options.length > 0 && <div className="mt-4 space-y-2">{selected.options.map((option) => {
            const selection = analytics?.optionSelections.find((entry) => entry.optionId === option.id);
            return <div key={option.id} className={`flex items-center rounded-lg border px-3 py-2 text-sm ${option.correct ? 'border-emerald-800 bg-emerald-950/20 text-emerald-200' : 'border-neutral-800 text-neutral-400'}`}><span>{option.text}</span><span className="ml-auto text-[10px] text-neutral-600">{selection?.selectedCount ?? 0} {t('selecciones')}</span></div>;
          })}</div>}
          <section className="study-question-answer-card mt-5 rounded-xl border border-neutral-800 bg-neutral-900/30 p-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Respuesta y explicación')}</h3><p className="mt-2 whitespace-pre-wrap text-sm text-emerald-200">{selected.answer.text ?? String(selected.answer.value ?? '')}</p><p className="mt-2 whitespace-pre-wrap text-sm text-neutral-400">{selected.explanation}</p></section>
          {(selected.lastAnsweredAt || selected.lastResponse || selected.lastScore != null) && <section className="mt-3 rounded-xl border border-indigo-900/50 bg-indigo-950/15 p-4"><div className="flex items-center gap-2"><h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-300">{t('Último intento')}</h3>{selected.lastAnsweredAt && <time className="ml-auto text-[10px] text-neutral-600">{new Date(selected.lastAnsweredAt).toLocaleString()}</time>}</div><p className="mt-2 whitespace-pre-wrap text-sm text-neutral-300">{selected.lastResponse || t('Sin respuesta guardada')}</p><div className="mt-3 flex items-center gap-3"><strong className="text-lg text-indigo-200">{selected.lastScore == null ? '—' : `${selected.lastScore.toFixed(2)} / ${(selected.lastMaxScore ?? 0).toFixed(2)}`}</strong><span className="text-xs text-neutral-500">{t('Última calificación')}</span></div>{selected.lastFeedback && <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-400">{selected.lastFeedback}</p>}</section>}
          <section className="mt-3 rounded-xl border border-neutral-800 p-4"><div className="flex items-center gap-2"><h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Fuente justificativa')}</h3>{(selected.documentId || selected.materialId || selected.recordingId) && <button className="btn btn-ghost ml-auto h-7 text-xs" onClick={() => openSource(selected)}><Icon name="external" size={11} />{t('Abrir fuente')}</button>}</div><p className="mt-2 text-xs text-neutral-500">{selected.source.title}</p><blockquote className="mt-2 border-l-2 border-teal-800 pl-3 text-sm leading-6 text-neutral-300">{selected.source.excerpt}</blockquote></section>
          <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-5"><div className="rounded-lg bg-neutral-900 p-2"><b className="block text-base">{selected.usageCount}</b>{t('Usos')}</div><div className="rounded-lg bg-neutral-900 p-2"><b className="block text-base text-emerald-300">{selected.correctCount}</b>{t('Aciertos')}</div><div className="rounded-lg bg-neutral-900 p-2"><b className="block text-base text-red-300">{selected.incorrectCount}</b>{t('Errores')}</div><div className="rounded-lg bg-neutral-900 p-2"><b className="block text-base">{analytics?.successRate == null ? '—' : `${Math.round(analytics.successRate * 100)}%`}</b>{t(analytics?.observedDifficulty === 'too_easy' ? 'Demasiado fácil' : analytics?.observedDifficulty === 'too_hard' ? 'Demasiado difícil' : 'Dificultad real')}</div><div className="rounded-lg bg-neutral-900 p-2"><b className="block text-base">{analytics?.averageResponseMs ? `${Math.round(analytics.averageResponseMs / 1000)} s` : '—'}</b>{t('Tiempo medio')}</div></div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button data-testid="study-question-edit" className="btn btn-ghost" disabled={selected.locked} title={selected.locked ? t('Reabre la pregunta antes de editarla') : undefined} onClick={() => { setDraft(inputFromQuestion(selected)); setDraftId(selected.id); setShowGenerator(false); }}><Icon name="edit" />{t('Editar')}</button>
            <button className="btn btn-ghost" onClick={() => void mutate(() => window.nodus.updateStudyQuestion(selected.id, { favorite: !selected.favorite }))}><Icon name="star" />{t(selected.favorite ? 'Quitar favorito' : 'Favorita')}</button>
            <button className="btn btn-ghost" onClick={() => void mutate(() => window.nodus.updateStudyQuestion(selected.id, { status: selected.status === 'approved' ? 'pending' : 'approved', locked: selected.status !== 'approved' }))}><Icon name={selected.status === 'approved' ? 'unlock' : 'check'} />{t(selected.status === 'approved' ? 'Reabrir' : 'Aprobar y bloquear')}</button>
            <button className="btn btn-ghost" onClick={() => void mutate(() => window.nodus.duplicateStudyQuestion(selected.id))}><Icon name="copy" />{t('Crear variante')}</button>
            <button className="btn btn-ghost" onClick={() => void mutate(async () => { await window.nodus.createStudyFlashcardsFromQuestions([selected.id]); setTab('flashcards'); })}><Icon name="flashcards" />{t('Crear flashcard')}</button>
            <button className="btn btn-ghost" onClick={() => void mutate(() => window.nodus.setStudyQuestionLifecycle(selected.id, 'archive'))}><Icon name="archive" />{t('Archivar')}</button>
            {confirmDelete === selected.id ? <><button className="btn btn-ghost text-red-300" onClick={() => void mutate(() => window.nodus.setStudyQuestionLifecycle(selected.id, 'delete')).then(() => setConfirmDelete(null))}>{t('Confirmar eliminación')}</button><button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>{t('Cancelar')}</button></> : <button className="btn btn-ghost text-red-400" onClick={() => setConfirmDelete(selected.id)}><Icon name="trash" />{t('Eliminar')}</button>}
          </div>
          {similar.length > 0 && <section className="mt-5 rounded-xl border border-amber-900/50 bg-amber-950/10 p-4" data-testid="study-question-similar"><h3 className="text-xs font-semibold uppercase tracking-wider text-amber-500">{t('Preguntas similares')}</h3><div className="mt-2 space-y-1">{similar.map((entry) => <button key={entry.question.id} className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs hover:bg-neutral-900" onClick={() => { setSelectedId(entry.question.id); setSelectedCardId(null); }}><span className="truncate">{entry.question.prompt}</span><span className="ml-auto pl-2 text-amber-500">{Math.round(entry.similarity * 100)}%</span></button>)}</div></section>}
          {versions.length > 0 && <section className="mt-5 rounded-xl border border-neutral-800 p-4" data-testid="study-question-versions"><h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">{t('Historial de versiones')}</h3><div className="mt-2 space-y-1">{versions.map((version) => <div key={version.id} className="flex items-center rounded-lg bg-neutral-900/60 px-2 py-1.5 text-xs"><span>v{version.versionNo} · {t(version.reason)}</span><time className="ml-2 text-neutral-600">{new Date(version.createdAt).toLocaleString()}</time>{version.versionNo !== versions[0]?.versionNo && <button className="btn btn-ghost ml-auto h-7 text-[10px]" onClick={() => void mutate(() => window.nodus.restoreStudyQuestionVersion(selected.id, version.id))}>{t('Restaurar')}</button>}</div>)}</div></section>}
          <section className="mt-6 border-t border-neutral-800 pt-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">{t('Colecciones')}</h3><div className="mt-2 flex gap-2"><input className="input flex-1" value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder={t('Nueva colección')} /><button className="btn btn-ghost" disabled={!collectionName.trim()} onClick={() => void mutate(() => window.nodus.createStudyQuestionCollection(collectionName)).then(() => setCollectionName(''))}><Icon name="folderPlus" />{t('Crear')}</button></div>{collections.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{collections.map((collection) => {
            const included = collection.questionIds.includes(selected.id);
            return <button key={collection.id} className={`rounded px-2 py-1 text-[10px] ${included ? 'bg-teal-900/50 text-teal-200' : 'bg-neutral-900 text-neutral-400'}`} onClick={() => void mutate(() => window.nodus.setStudyQuestionCollectionItems(collection.id, included ? collection.questionIds.filter((id) => id !== selected.id) : [...collection.questionIds, selected.id]))}>{included ? '✓ ' : ''}{collection.name} · {collection.questionCount}</button>;
          })}</div>}</section>
        </> : <div className="flex h-full items-center justify-center text-sm text-neutral-600">{t('Selecciona o crea una pregunta.')}</div>}</main>}
      </div>}

      {(selectedCard || cardDraft) && createPortal(<div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4" data-testid="study-bank-flashcard-modal" role="dialog" aria-modal="true" aria-labelledby="study-bank-flashcard-title" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelectedCardId(null); setCardDraft(null); setCardDraftId(null); } }}>
        <div className="card max-h-[90vh] w-full max-w-3xl overflow-y-auto p-5 shadow-2xl">
          {cardDraft ? <section data-testid="study-bank-flashcard-editor">
            <div className="flex items-center gap-2"><h2 className="mr-auto text-base font-semibold text-teal-200">{t(cardDraftId ? 'Editar flashcard' : 'Nueva flashcard')}</h2><button type="button" className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Cerrar')} onClick={() => { setCardDraft(null); setCardDraftId(null); }}><Icon name="x" /></button></div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <label className="text-xs text-neutral-500">{t('Tipo de tarjeta')}<select className="input mt-1 w-full" value={cardDraft.type ?? 'front_back'} onChange={(event) => setCardDraft({ ...cardDraft, type: event.target.value as StudyFlashcardType })}>{Object.entries(CARD_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
              <label className="text-xs text-neutral-500">{t('Dificultad')}<select className="input mt-1 w-full" value={cardDraft.difficulty ?? 'medium'} onChange={(event) => setCardDraft({ ...cardDraft, difficulty: event.target.value as StudyFlashcard['difficulty'] })}>{(['easy', 'medium', 'hard'] as const).map((value) => <option key={value} value={value}>{t(DIFFICULTY_LABELS[value])}</option>)}</select></label>
              <label className="lg:col-span-2 text-xs text-neutral-500">{t('Anverso')}<textarea data-testid="study-bank-flashcard-front" className="input mt-1 min-h-20 w-full" value={cardDraft.front} onChange={(event) => setCardDraft({ ...cardDraft, front: event.target.value })} /></label>
              <label className="lg:col-span-2 text-xs text-neutral-500">{t('Reverso')}<textarea data-testid="study-bank-flashcard-back" className="input mt-1 min-h-20 w-full" value={cardDraft.back} onChange={(event) => setCardDraft({ ...cardDraft, back: event.target.value })} /></label>
              <label className="text-xs text-neutral-500">{t('Pista')}<input className="input mt-1 w-full" value={cardDraft.hint ?? ''} onChange={(event) => setCardDraft({ ...cardDraft, hint: event.target.value })} /></label>
              <label className="text-xs text-neutral-500">{t('Asignatura')}<select className="input mt-1 w-full" value={cardDraft.subjectId ?? ''} onChange={(event) => { const nextSubject = workspace?.subjects.find((entry) => entry.id === event.target.value); setCardDraft({ ...cardDraft, subjectId: event.target.value || null, topicId: null, courseId: nextSubject?.courseId ?? cardDraft.courseId ?? null }); }}><option value="">{t('Sin asignatura')}</option>{workspace?.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
              <label className="text-xs text-neutral-500">{t('Tema')}<select className="input mt-1 w-full" value={cardDraft.topicId ?? ''} onChange={(event) => setCardDraft({ ...cardDraft, topicId: event.target.value || null })}><option value="">{t('Sin tema')}</option>{(workspace?.topics ?? []).filter((entry) => (cardDraft.subjectId ? entry.subjectId === cardDraft.subjectId : true)).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
              <label className="lg:col-span-2 text-xs text-neutral-500">{t('Etiquetas (separadas por comas)')}<input className="input mt-1 w-full" value={cardDraft.tags?.join(', ') ?? ''} onChange={(event) => setCardDraft({ ...cardDraft, tags: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
              <label className="lg:col-span-2 text-xs text-neutral-500">{t('Fragmento o justificación')}<input className="input mt-1 w-full" value={cardDraft.sourceExcerpt ?? ''} onChange={(event) => setCardDraft({ ...cardDraft, sourceExcerpt: event.target.value })} /></label>
            </div>
            <div className="mt-4 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => { setCardDraft(null); setCardDraftId(null); }}>{t('Cancelar')}</button><button data-testid="study-bank-flashcard-save" className="btn btn-primary" disabled={busy || cardDraft.front.trim().length < 2 || !cardDraft.back.trim()} onClick={() => void saveCard()}>{t('Guardar flashcard')}</button></div>
          </section> : selectedCard && <section data-testid="study-bank-flashcard-detail">
            <div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-1 text-[10px] text-teal-700 dark:bg-teal-950 dark:text-teal-300"><Icon name="flashcards" size={11} />{t('Flashcard')}</span><span className="rounded-full bg-indigo-100 px-2 py-1 text-[10px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{t(selectedCard.srs.mastered ? 'Dominada' : 'En revisión')}</span>{selectedCard.srs.excluded && <span className="rounded-full bg-neutral-200 px-2 py-1 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">{t('Excluir del repaso')}</span>}<span className="ml-auto text-[10px] text-neutral-500">{selectedCard.shortId}</span><button type="button" className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Cerrar')} onClick={() => setSelectedCardId(null)}><Icon name="x" /></button></div>
            <section className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-7 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900/45"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400">{t('Anverso')}</p><h2 id="study-bank-flashcard-title" className="mt-4 text-xl font-semibold leading-8">{selectedCard.front}</h2><div className="mx-auto my-6 h-px max-w-md bg-neutral-200 dark:bg-neutral-700"/><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">{t('Reverso')}</p><p className="mt-4 whitespace-pre-wrap text-lg leading-7 text-emerald-700 dark:text-emerald-300">{selectedCard.back}</p>{selectedCard.hint && <p className="mt-5 text-sm text-neutral-500">{t('Pista')}: {selectedCard.hint}</p>}</section>
            {selectedCard.sourceExcerpt && <blockquote className="mt-4 rounded-xl border border-neutral-200 border-l-4 border-l-teal-500 bg-neutral-50 p-4 text-sm leading-6 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/30 dark:text-neutral-400">{selectedCard.sourceExcerpt}</blockquote>}
            <div className="mt-4 flex flex-wrap items-center gap-1.5">{selectedCard.subjectId && <span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">{subjectName(selectedCard.subjectId)}</span>}{selectedCard.topicId && <span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">{topicName(selectedCard.topicId)}</span>}{selectedCard.tags.map((entry) => <button key={entry} className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600 hover:bg-teal-100 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-teal-950/40" onClick={() => { setTag(entry); setTab('flashcards'); setSelectedCardId(null); }}>#{entry}</button>)}</div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4"><div className="rounded-lg bg-neutral-100 p-2 dark:bg-neutral-900"><b className="block text-base">{selectedCard.srs.repetitions}</b>{t('Repeticiones')}</div><div className="rounded-lg bg-neutral-100 p-2 dark:bg-neutral-900"><b className="block text-base">{selectedCard.srs.intervalDays}</b>{t('Días de intervalo')}</div><div className="rounded-lg bg-neutral-100 p-2 dark:bg-neutral-900"><b className="block text-base">{selectedCard.srs.lapses}</b>{t('Fallos')}</div><div className="rounded-lg bg-neutral-100 p-2 dark:bg-neutral-900"><b className="block text-base">{new Date(selectedCard.srs.dueAt).toLocaleDateString()}</b>{t('Próxima revisión')}</div></div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button data-testid="study-bank-flashcard-edit" className="btn btn-ghost" onClick={() => { setCardDraft(inputFromCard(selectedCard)); setCardDraftId(selectedCard.id); }}><Icon name="edit" />{t('Editar')}</button>
              <button className="btn btn-ghost" onClick={() => void mutate(() => window.nodus.updateStudyFlashcard(selectedCard.id, { favorite: !selectedCard.favorite }))}><Icon name="star" />{t(selectedCard.favorite ? 'Quitar favorito' : 'Favorita')}</button>
              <button className="btn btn-ghost" onClick={() => void mutate(() => window.nodus.setStudyFlashcardState(selectedCard.id, selectedCard.srs.mastered ? 'reset' : 'master'))}><Icon name="check" />{t(selectedCard.srs.mastered ? 'Reiniciar repaso' : 'Marcar como dominada')}</button>
              <button className="btn btn-ghost" onClick={() => void mutate(() => window.nodus.setStudyFlashcardState(selectedCard.id, selectedCard.srs.excluded ? 'include' : 'exclude'))}><Icon name="filter" />{t(selectedCard.srs.excluded ? 'Incluir en el repaso' : 'Excluir del repaso')}</button>
              <button className="btn btn-ghost" onClick={() => void mutate(() => window.nodus.setStudyFlashcardState(selectedCard.id, 'archive'))}><Icon name="archive" />{t('Archivar')}</button>
              {confirmCardDelete === selectedCard.id ? <><button className="btn btn-ghost text-red-300" onClick={() => void mutate(() => window.nodus.setStudyFlashcardState(selectedCard.id, 'delete')).then(() => { setConfirmCardDelete(null); setSelectedCardId(null); })}>{t('Confirmar eliminación')}</button><button className="btn btn-ghost" onClick={() => setConfirmCardDelete(null)}>{t('Cancelar')}</button></> : <button className="btn btn-ghost text-red-400" onClick={() => setConfirmCardDelete(selectedCard.id)}><Icon name="trash" />{t('Eliminar')}</button>}
            </div>
          </section>}
        </div>
      </div>, document.body)}

      {showInterchange && <StudyInterchangeDialog
        kind={tab}
        workspace={workspace}
        selectionCount={selectedCount}
        selectedIds={selectedIds}
        busy={interchangeBusy}
        result={interchangeResult}
        error={interchangeError}
        onClose={() => setShowInterchange(false)}
        onImport={(options) => void importInterchange(options)}
        onExport={(format, options) => void exportInterchange(format, options)}
      />}

      {confirmBulkDelete && <ConfirmModal
        title={t('Eliminar')}
        message={`${selectedCount} ${t('seleccionados')}`}
        confirmLabel={t('Confirmar eliminación')}
        danger
        onCancel={() => setConfirmBulkDelete(false)}
        onConfirm={() => {
          setConfirmBulkDelete(false);
          if (tab === 'questions') void runQuestionBulk({ kind: 'lifecycle', action: 'delete' });
          else void runCardBulk({ kind: 'state', action: 'delete' });
        }}
      />}
    </div>
  );
}
