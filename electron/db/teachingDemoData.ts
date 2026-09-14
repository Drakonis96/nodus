/**
 * Demo workspace for the teaching (`docencia`) vault.
 *
 * Same contract as the other four seeders: declarative constants written straight to
 * SQLite inside one transaction, every id prefixed `demo-teaching-` so `clear` can
 * remove exactly what was seeded and nothing else.
 *
 * Two things make this fixture different from the study one it borrows its organisation
 * tables from:
 *
 *  - It is DIDACTIC. The rubric, the exam and the assessment plan are the three things
 *    the tutorial teaches, so they are written as examples worth copying rather than as
 *    filler: the rubric is built to pass `rubricQualityWarnings()` with zero warnings
 *    (a sample rubric that trips the product's own quality checks would teach the
 *    opposite of what it is for), the exam carries a section statement with
 *    sub-questions so the printed numbering shows `2.1 / 2.2`, and the grade entries
 *    exercise four different statuses because "status is orthogonal to value" is the
 *    whole design of the gradebook and one column of numbers would hide it.
 *
 *  - It never flips the vault type. Genealogy and databases convert the active vault
 *    and stash the old type in the single `demoPriorVaultType` slot; this one refuses
 *    unless the vault is already `docencia`, so it cannot participate in that clash.
 */
import { DEFAULT_ACADEMIC_YEAR_START_MONTH, defaultAcademicYearRange, formatAcademicYearLabel } from '@shared/studyAcademicYears';
import { assessmentProfile } from '@shared/assessment/profiles';
import { buildRubricLevels } from '@shared/teachingRubrics';
import { generatePseudonymCode } from '@shared/studentPseudonyms';
import { clearStudyAssistantDemoConversation, seedStudyAssistantDemoConversation } from '../ai/studyAssistant';
import { getDb } from './database';
import { getSettings, updateSettings } from './settingsRepo';
import { normalizeStudyIdeaLabel } from './studyKnowledgeRepo';
import { getActiveVault } from '../vaults/vaultRegistry';

type DemoLocale = 'es' | 'en' | 'zh-CN';
type Localized = { es: string; en: string; 'zh-CN': string };

/** The demo speaks the interface language when it can, and English otherwise. */
function demoLocale(): DemoLocale {
  const language = getSettings().uiLanguage;
  if (language === 'zh-CN') return 'zh-CN';
  return language === 'es' ? 'es' : 'en';
}

const ID = {
  academicYear: 'demo-teaching-year',
  course: 'demo-teaching-course',
  subjectHistory: 'demo-teaching-subject-history',
  subjectGeography: 'demo-teaching-subject-geography',
  folder: 'demo-teaching-folder-unit3',
  topicSources: 'demo-teaching-topic-sources',
  topicIndustrial: 'demo-teaching-topic-industrial',
  docPlan: 'demo-teaching-doc-plan',
  docCommentary: 'demo-teaching-doc-commentary',
  placementPlan: 'demo-teaching-placement-plan',
  placementCommentary: 'demo-teaching-placement-commentary',
  material: 'demo-teaching-material-guide',
  materialPlacement: 'demo-teaching-material-placement',
  recording: 'demo-teaching-recording',
  transcript: 'demo-teaching-transcript',
  transcriptSegment: 'demo-teaching-transcript-segment',
  question: 'demo-teaching-question',
  ideaSteam: 'demo-teaching-idea-steam',
  ideaFactory: 'demo-teaching-idea-factory',
  ideaChildLabour: 'demo-teaching-idea-child-labour',
  ideaLabour: 'demo-teaching-idea-labour-movement',
  ideaCriticism: 'demo-teaching-idea-source-criticism',
  unit: 'demo-teaching-unit',
  scheduleFirst: 'demo-teaching-period-first',
  scheduleThird: 'demo-teaching-period-third',
  plan: 'demo-teaching-studyplan',
  event: 'demo-teaching-event-exam',
  group: 'demo-teaching-group',
  rubric: 'demo-teaching-rubric',
  exam: 'demo-teaching-exam',
  assessmentPlan: 'demo-teaching-plan',
} as const;

/**
 * A tiny valid WAV so the Recordings section has something that actually plays.
 * Mirrors `demoWav()` in studyDemoData.ts.
 */
function demoWav(): Buffer {
  const sampleRate = 8_000; const seconds = 2; const samples = sampleRate * seconds;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) pcm.writeInt16LE(Math.round(Math.sin((i / sampleRate) * Math.PI * 2 * 440) * 900), i * 2);
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44); return wav;
}

/**
 * Deterministic RNG for the pseudonym codes.
 *
 * The codes must be generated rather than hard-coded so they always satisfy the
 * alphabet `isPseudonym()` enforces, but a fixture that changed on every seed would
 * make the demo untestable — so the generator gets a fixed-seed LCG instead of
 * `Math.random`.
 */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

// ── Class list ───────────────────────────────────────────────────────────────
// Names stay Spanish in both locales, as they do in the genealogy demo: a person's
// name is not interface copy.
const STUDENTS: Array<{ id: string; givenNames: string; surnames: string; comments: Localized }> = [
  { id: 'demo-teaching-student-1', givenNames: 'Lucía', surnames: 'Alonso Prieto', comments: { es: 'Participa con argumentos sólidos; conviene darle textos más exigentes.', en: 'Argues well in class; ready for more demanding sources.', 'zh-CN': '课堂发言论证扎实，可适当提供更具挑战性的资料。' } },
  { id: 'demo-teaching-student-2', givenNames: 'Adrián', surnames: 'Benítez Salas', comments: { es: 'Mejora mucho cuando trabaja con guion previo.', en: 'Improves markedly when he works from an outline.', 'zh-CN': '先写提纲再作答时进步明显。' } },
  { id: 'demo-teaching-student-3', givenNames: 'Nerea', surnames: 'Cabrera Ruiz', comments: { es: 'Domina el vocabulario; le cuesta cerrar la conclusión.', en: 'Strong vocabulary; her conclusions still trail off.', 'zh-CN': '词汇掌握出色，但结论收尾仍显不足。' } },
  { id: 'demo-teaching-student-4', givenNames: 'Iván', surnames: 'Domínguez Peña', comments: { es: 'Se incorporó en noviembre: pendiente de recuperar la unidad 1.', en: 'Joined in November: unit 1 still to be made up.', 'zh-CN': '11 月才入班，仍需补上第一单元。' } },
  { id: 'demo-teaching-student-5', givenNames: 'Marta', surnames: 'Esteban Gil', comments: { es: 'Exenta de la prueba de mapas por adaptación curricular.', en: 'Exempt from the map test under a curricular adaptation.', 'zh-CN': '因课程调整免考地图测验。' } },
  { id: 'demo-teaching-student-6', givenNames: 'Youssef', surnames: 'Fernández Amrani', comments: { es: 'Buen análisis oral; conviene reforzar la expresión escrita.', en: 'Analyses well out loud; written expression needs support.', 'zh-CN': '口头分析能力强，书面表达需要加强。' } },
];

// ── Rubric ───────────────────────────────────────────────────────────────────
// Four criteria at 30/30/25/15 = 100 %, four levels, descriptors written to satisfy
// every rule in `rubricQualityWarnings()`: criterion names name a QUALITY (never a
// submission requirement, never two dimensions joined by "y"), descriptors describe
// what the work does rather than what it lacks, adjacent levels differ in substance
// and not in adverbs, and all sixteen cells keep a comparable length.
const RUBRIC_CRITERIA: Array<{ id: string; name: Localized; description: Localized; weight: number; cells: Localized[] }> = [
  {
    id: 'C1',
    name: { es: 'Contextualización histórica', en: 'Historical contextualisation', 'zh-CN': '历史语境化' },
    description: { es: 'Relación del documento con el momento en que se produce.', en: 'How the document is tied to the moment that produced it.', 'zh-CN': '将文献与其产生的时代相联系。' },
    weight: 30,
    cells: [
      { es: 'Sitúa el documento en su momento histórico preciso y explica cómo las circunstancias de esa época condicionan su contenido.', en: 'Places the document in its precise historical moment and explains how the circumstances of that period shape its content.', 'zh-CN': '将文献准确定位于其历史时刻，并说明当时的环境如何影响其内容。' },
      { es: 'Identifica el periodo correspondiente y menciona los principales acontecimientos que rodean la redacción del documento.', en: 'Identifies the relevant period and mentions the main events surrounding the writing of the document.', 'zh-CN': '指出文献所属时期，并提及文献撰写前后的主要事件。' },
      { es: 'Ubica el texto en un marco temporal amplio y aporta algún dato del entorno en que surge.', en: 'Locates the text within a broad time frame and offers some detail about the setting it comes from.', 'zh-CN': '将文本置于宽泛的时间框架中，并提供其产生背景的若干信息。' },
      { es: 'Asocia el documento a una etapa general, con referencias todavía imprecisas sobre su origen.', en: 'Links the document to a general stage, with references to its origin that remain approximate.', 'zh-CN': '将文献归入大致阶段，对其来源的说明仍较模糊。' },
    ],
  },
  {
    id: 'C2',
    name: { es: 'Análisis del contenido', en: 'Analysis of the content', 'zh-CN': '内容分析' },
    description: { es: 'Tratamiento de las ideas que el texto sostiene.', en: 'How the ideas the text puts forward are handled.', 'zh-CN': '对文本所持观点的处理。' },
    weight: 30,
    cells: [
      { es: 'Distingue las ideas principales de las secundarias y las relaciona entre sí construyendo una interpretación propia.', en: 'Tells main ideas from secondary ones and connects them into an interpretation of their own.', 'zh-CN': '区分主要观点与次要观点，并将其相互联系，形成自己的解读。' },
      { es: 'Extrae las ideas centrales del texto y las ordena siguiendo la estructura interna del propio documento.', en: 'Draws out the central ideas and arranges them following the internal structure of the document.', 'zh-CN': '提炼文本的核心观点，并依照文献自身的内部结构加以组织。' },
      { es: 'Reconoce algunas ideas relevantes y las expone de forma independiente, con conexiones todavía escasas.', en: 'Recognises several relevant ideas and sets them out separately, with connections still sparse.', 'zh-CN': '能识别若干相关观点并分别阐述，但彼此间的联系仍然不足。' },
      { es: 'Reproduce fragmentos del texto acompañados de comentarios breves sobre su significado literal.', en: 'Reproduces fragments of the text alongside brief remarks on their literal meaning.', 'zh-CN': '摘录文本片段，并附上关于其字面含义的简短说明。' },
    ],
  },
  {
    id: 'C3',
    name: { es: 'Vocabulario específico', en: 'Subject vocabulary', 'zh-CN': '学科词汇' },
    description: { es: 'Manejo de la terminología propia de la materia.', en: 'Command of the terminology proper to the subject.', 'zh-CN': '对学科专业术语的运用。' },
    weight: 25,
    cells: [
      { es: 'Emplea con precisión los términos propios de la disciplina y aclara su significado cuando el contexto lo requiere.', en: 'Uses the discipline’s own terms precisely and clarifies their meaning when the context calls for it.', 'zh-CN': '准确使用学科术语，并在语境需要时说明其含义。' },
      { es: 'Utiliza terminología ajustada al tema tratado, con un manejo solvente de los conceptos fundamentales.', en: 'Uses terminology suited to the topic, handling the fundamental concepts confidently.', 'zh-CN': '使用与主题相符的术语，对基本概念的掌握较为熟练。' },
      { es: 'Recurre a un léxico general salpicado de algunos términos técnicos aplicados de manera desigual.', en: 'Falls back on general wording sprinkled with technical terms applied unevenly.', 'zh-CN': '多用一般性词汇，夹杂若干运用不够一致的术语。' },
      { es: 'Expresa las ideas mediante vocabulario cotidiano, apoyándose en expresiones tomadas del enunciado.', en: 'Expresses the ideas in everyday wording, leaning on phrases lifted from the prompt.', 'zh-CN': '用日常词汇表达观点，并借用题目中的表述。' },
    ],
  },
  {
    id: 'C4',
    name: { es: 'Claridad expositiva', en: 'Clarity of exposition', 'zh-CN': '表达清晰度' },
    description: { es: 'Organización del escrito y progresión del razonamiento.', en: 'How the writing is organised and the reasoning progresses.', 'zh-CN': '文章的组织与论证的推进。' },
    weight: 15,
    cells: [
      { es: 'Organiza el escrito en párrafos progresivos que guían la lectura hasta una conclusión bien delimitada.', en: 'Organises the writing into progressive paragraphs that guide the reader to a clearly bounded conclusion.', 'zh-CN': '以层层递进的段落组织文章，引导读者走向明确的结论。' },
      { es: 'Presenta un discurso ordenado, con transiciones que permiten seguir el hilo del razonamiento.', en: 'Presents an ordered account, with transitions that let the reader follow the thread of the reasoning.', 'zh-CN': '行文有条理，过渡自然，便于读者跟上论证思路。' },
      { es: 'Desarrolla el comentario de forma lineal, con párrafos desiguales y un cierre escueto.', en: 'Develops the commentary linearly, with uneven paragraphs and a terse ending.', 'zh-CN': '以线性方式展开评析，段落长短不一，结尾简略。' },
      { es: 'Enlaza las observaciones de manera sucesiva, dejando el cierre implícito para el lector.', en: 'Strings the observations together in sequence, leaving the ending implicit for the reader.', 'zh-CN': '将各项观察依次罗列，结尾留给读者自行体会。' },
    ],
  },
];

// ── Assessment plan ──────────────────────────────────────────────────────────
// Three blocks at 50/30/20 with their leaves. `weightAlt` is the non-continuous
// column of a guía docente over the SAME tree: a student who loses continuous
// assessment is examined on the written tests alone, so there the exam block carries
// everything and classwork carries nothing.
interface PlanNode {
  id: string;
  name: Localized;
  kind: 'block' | 'activity';
  weight: number;
  weightAlt: number;
  aggregation: string;
  entryMode: string;
  maxPoints: number;
  isMandatory: number;
  minToAverage: number | null;
  sourceExamId?: string;
  sourceRubricId?: string;
  children?: PlanNode[];
}

const PLAN_TREE: PlanNode[] = [
  {
    id: 'demo-teaching-item-written',
    name: { es: 'Pruebas escritas', en: 'Written tests', 'zh-CN': '笔试' },
    kind: 'block', weight: 50, weightAlt: 70, aggregation: 'weighted', entryMode: 'numeric', maxPoints: 10,
    isMandatory: 1, minToAverage: 0.35,
    children: [
      { id: 'demo-teaching-item-exam-unit3', name: { es: 'Examen de la unidad 3', en: 'Unit 3 exam', 'zh-CN': '第三单元考试' }, kind: 'activity', weight: 60, weightAlt: 60, aggregation: 'weighted', entryMode: 'numeric', maxPoints: 10, isMandatory: 0, minToAverage: null, sourceExamId: ID.exam },
      { id: 'demo-teaching-item-maps', name: { es: 'Prueba de mapas', en: 'Map test', 'zh-CN': '地图测验' }, kind: 'activity', weight: 40, weightAlt: 40, aggregation: 'weighted', entryMode: 'numeric', maxPoints: 10, isMandatory: 0, minToAverage: null },
    ],
  },
  {
    id: 'demo-teaching-item-commentary',
    name: { es: 'Comentario de texto', en: 'Source commentary', 'zh-CN': '文本评析' },
    kind: 'block', weight: 30, weightAlt: 30, aggregation: 'weighted', entryMode: 'numeric', maxPoints: 10,
    isMandatory: 0, minToAverage: null,
    children: [
      { id: 'demo-teaching-item-commentary-guided', name: { es: 'Comentario guiado', en: 'Guided commentary', 'zh-CN': '引导式文本评析' }, kind: 'activity', weight: 100, weightAlt: 100, aggregation: 'weighted', entryMode: 'rubric', maxPoints: 10, isMandatory: 0, minToAverage: null, sourceRubricId: ID.rubric },
    ],
  },
  {
    id: 'demo-teaching-item-classwork',
    name: { es: 'Trabajo de aula', en: 'Classwork', 'zh-CN': '课堂作业' },
    kind: 'block', weight: 20, weightAlt: 0, aggregation: 'weighted', entryMode: 'numeric', maxPoints: 10,
    isMandatory: 0, minToAverage: null,
    children: [
      { id: 'demo-teaching-item-notebook', name: { es: 'Cuaderno de clase', en: 'Class notebook', 'zh-CN': '课堂笔记本' }, kind: 'activity', weight: 50, weightAlt: 0, aggregation: 'weighted', entryMode: 'numeric', maxPoints: 10, isMandatory: 0, minToAverage: null },
      { id: 'demo-teaching-item-participation', name: { es: 'Participación argumentada', en: 'Reasoned participation', 'zh-CN': '有论据的课堂参与' }, kind: 'activity', weight: 50, weightAlt: 0, aggregation: 'weighted', entryMode: 'numeric', maxPoints: 10, isMandatory: 0, minToAverage: null },
    ],
  },
];

/**
 * Marks per student, per leaf. `null` with a status other than `evaluated` is the
 * point of the fixture: a blank cell is not a zero, and each of the four statuses
 * renormalises the tree differently.
 */
const MARKS: Record<string, Array<[number | null, string]>> = {
  // exam · maps · commentary · notebook · participation
  'demo-teaching-student-1': [[9.1, 'evaluated'], [8.5, 'evaluated'], [9.3, 'evaluated'], [9, 'evaluated'], [9.5, 'evaluated']],
  'demo-teaching-student-2': [[6.4, 'evaluated'], [7, 'evaluated'], [6.1, 'evaluated'], [7.5, 'evaluated'], [6, 'evaluated']],
  'demo-teaching-student-3': [[7.8, 'evaluated'], [6.2, 'evaluated'], [8.4, 'evaluated'], [8, 'evaluated'], [7, 'evaluated']],
  // Joined late: the first test was never sat, and the notebook has not been handed in.
  'demo-teaching-student-4': [[5.2, 'evaluated'], [null, 'not_assessed'], [4.8, 'evaluated'], [null, 'not_submitted'], [6.5, 'evaluated']],
  // Curricular adaptation: the map test never counts, either way.
  'demo-teaching-student-5': [[7.1, 'evaluated'], [null, 'exempt'], [7.6, 'evaluated'], [8.5, 'evaluated'], [8, 'evaluated']],
  'demo-teaching-student-6': [[4.6, 'evaluated'], [5.5, 'evaluated'], [5.9, 'evaluated'], [6, 'evaluated'], [7.5, 'evaluated']],
};

/** Level chosen per criterion for the students whose commentary was marked with the rubric. */
const RUBRIC_CHOICES: Record<string, string[]> = {
  'demo-teaching-student-1': ['L1', 'L1', 'L1', 'L2'],
  'demo-teaching-student-2': ['L2', 'L3', 'L2', 'L3'],
  'demo-teaching-student-3': ['L1', 'L2', 'L1', 'L2'],
  'demo-teaching-student-4': ['L3', 'L3', 'L3', 'L4'],
  'demo-teaching-student-5': ['L2', 'L2', 'L2', 'L2'],
  'demo-teaching-student-6': ['L3', 'L2', 'L3', 'L3'],
};

/** Detect an already-loaded sample workspace without treating user data as a blocker. */
export function hasTeachingDemoBlockingData(): boolean {
  return Number((getDb().prepare('SELECT COUNT(*) AS value FROM study_courses WHERE id = ?').get(ID.course) as { value: number }).value) > 0;
}

export function seedTeachingDemoData(): boolean {
  if (getActiveVault().type !== 'docencia' || hasTeachingDemoBlockingData()) return false;
  const db = getDb();
  const L = demoLocale();
  // Rubrics and exams key their presets off `zh-Hans`, not the interface tag `zh-CN`.
  const promptL = L === 'zh-CN' ? 'zh-Hans' : L;
  const pick = (value: Localized): string => value[L];

  const now = new Date();
  const createdAt = new Date(now.getTime() - 21 * 86_400_000).toISOString();
  const updatedAt = now.toISOString();
  const publishedAt = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const examAt = new Date(now.getTime() + 9 * 86_400_000).toISOString();

  // Derived from today so the sample vault always opens on a current academic year.
  const yearStart = now.getMonth() + 1 >= DEFAULT_ACADEMIC_YEAR_START_MONTH ? now.getFullYear() : now.getFullYear() - 1;
  const yearRange = defaultAcademicYearRange(yearStart);

  db.transaction(() => {
    // ── Organisation ─────────────────────────────────────────────────────────
    db.prepare(`INSERT INTO study_academic_years
      (id,short_id,label,start_date,end_date,color,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(ID.academicYear, 'ACY-DOC1', formatAcademicYearLabel(yearStart), yearRange.startDate, yearRange.endDate, '#ea580c', 0, createdAt, updatedAt);

    db.prepare(`INSERT INTO study_courses
      (id,short_id,name,description,color,icon,favorite,position,academic_year_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.course, 'CRS-DOC1',
        pick({ es: '3.º ESO · Geografía e Historia', en: 'Year 9 · Geography and History', 'zh-CN': '初三 · 地理与历史' }),
        pick({ es: 'Curso de ejemplo para explorar el vault de docencia.', en: 'Sample course for exploring the teaching vault.', 'zh-CN': '用于探索教学资料库的示例课程。' }),
        '#ea580c', 'graduation', 1, 0, ID.academicYear, createdAt, updatedAt);

    const insertSubject = db.prepare(`INSERT INTO study_subjects
      (id,short_id,course_id,name,description,color,icon,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    insertSubject.run(ID.subjectHistory, 'SUB-DOC1', ID.course,
      pick({ es: 'Historia', en: 'History', 'zh-CN': '历史' }),
      pick({ es: 'Del Antiguo Régimen a la sociedad industrial.', en: 'From the Ancien Régime to industrial society.', 'zh-CN': '从旧制度到工业社会。' }),
      '#ea580c', 'book', 1, 0, createdAt, updatedAt);
    insertSubject.run(ID.subjectGeography, 'SUB-DOC2', ID.course,
      pick({ es: 'Geografía', en: 'Geography', 'zh-CN': '地理' }),
      pick({ es: 'Población, territorio y actividad económica.', en: 'Population, territory and economic activity.', 'zh-CN': '人口、领土与经济活动。' }),
      '#c2410c', 'map', 0, 1, createdAt, updatedAt);

    db.prepare(`INSERT INTO study_folders
      (id,short_id,course_id,subject_id,name,description,color,icon,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.folder, 'FLD-DOC1', ID.course, ID.subjectHistory,
        pick({ es: 'Unidad 3 · La revolución industrial', en: 'Unit 3 · The industrial revolution', 'zh-CN': '第三单元 · 工业革命' }),
        pick({ es: 'Programación, materiales y evaluación de la unidad.', en: 'Planning, materials and assessment for the unit.', 'zh-CN': '本单元的课程规划、材料与评估。' }),
        '#ea580c', 'folder', 1, 0, createdAt, updatedAt);

    const insertTopic = db.prepare(`INSERT INTO study_topics
      (id,short_id,subject_id,folder_id,parent_id,name,description,color,icon,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insertTopic.run(ID.topicSources, 'TOP-DOC1', ID.subjectHistory, ID.folder, null,
      pick({ es: 'Comentario de fuentes', en: 'Working with sources', 'zh-CN': '史料解读' }),
      pick({ es: 'Método de comentario de textos históricos.', en: 'Method for commenting on historical texts.', 'zh-CN': '历史文本的评析方法。' }),
      '#fb923c', 'notebook', 1, 0, createdAt, updatedAt);
    insertTopic.run(ID.topicIndustrial, 'TOP-DOC2', ID.subjectHistory, ID.folder, null,
      pick({ es: 'Industrialización y sociedad', en: 'Industrialisation and society', 'zh-CN': '工业化与社会' }),
      pick({ es: 'Transformaciones económicas y sus efectos sociales.', en: 'Economic change and its social effects.', 'zh-CN': '经济变革及其社会影响。' }),
      '#f97316', 'layers', 0, 1, createdAt, updatedAt);

    const insertDoc = db.prepare(`INSERT INTO study_docs
      (id,short_id,title,kind,content_markdown,description,color,icon,favorite,pinned,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insertDoc.run(ID.docPlan, 'DOC-DOC1',
      pick({ es: 'Unidad 3 · guion de sesiones', en: 'Unit 3 · session outline', 'zh-CN': '第三单元 · 课时纲要' }), 'apunte',
      pick({
        es: '# Unidad 3 · La revolución industrial\n\n## Sesiones\n\n1. Punto de partida: la sociedad agraria.\n2. Innovación técnica y fábrica.\n3. Comentario de texto guiado.\n4. Efectos sociales y movimiento obrero.\n5. Prueba escrita.\n\n## Evaluación\n\nLa nota se reparte entre pruebas escritas (50 %), comentario de texto (30 %) y trabajo de aula (20 %).',
        en: '# Unit 3 · The industrial revolution\n\n## Sessions\n\n1. Starting point: agrarian society.\n2. Technical innovation and the factory.\n3. Guided source commentary.\n4. Social effects and the labour movement.\n5. Written test.\n\n## Assessment\n\nThe mark splits between written tests (50 %), source commentary (30 %) and classwork (20 %).',
        'zh-CN': '# 第三单元 · 工业革命\n\n## 课时\n\n1. 起点：农业社会。\n2. 技术创新与工厂。\n3. 引导式文本评析。\n4. 社会影响与工人运动。\n5. 笔试。\n\n## 评估\n\n成绩由笔试（50 %）、文本评析（30 %）和课堂作业（20 %）构成。',
      }),
      pick({ es: 'Guion de la unidad, editable como cualquier apunte.', en: 'Unit outline, editable like any note.', 'zh-CN': '单元纲要，可像普通笔记一样编辑。' }),
      '#ea580c', 'notebook', 1, 1, 0, createdAt, updatedAt);
    insertDoc.run(ID.docCommentary, 'DOC-DOC2',
      pick({ es: 'Cómo comentar un texto histórico', en: 'How to comment on a historical text', 'zh-CN': '如何评析历史文本' }), 'manual',
      pick({
        es: '# Comentario de texto histórico\n\n## Pasos\n\n1. Clasificar el documento: naturaleza, autoría, destinatario y fecha.\n2. Contextualizar el momento en que se escribe.\n3. Analizar las ideas y ordenarlas.\n4. Cerrar con una valoración razonada.\n\n> El comentario se evalúa con la rúbrica de la unidad.',
        en: '# Historical source commentary\n\n## Steps\n\n1. Classify the document: nature, authorship, audience and date.\n2. Set out the moment in which it was written.\n3. Analyse the ideas and order them.\n4. Close with a reasoned appraisal.\n\n> The commentary is marked with the unit rubric.',
        'zh-CN': '# 历史文本评析\n\n## 步骤\n\n1. 判定文献：类别、作者、受众与日期。\n2. 交代其撰写的历史背景。\n3. 分析观点并加以梳理。\n4. 以有理有据的评价收尾。\n\n> 评析依据本单元的评分标准进行评定。',
      }),
      pick({ es: 'Material que se entrega al alumnado antes del comentario.', en: 'Handout given to students before the commentary.', 'zh-CN': '在评析之前发给学生的材料。' }),
      '#fb923c', 'book', 0, 0, 1, createdAt, updatedAt);

    const insertPlacement = db.prepare(`INSERT INTO study_placements
      (id,short_id,document_id,course_id,subject_id,topic_id,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    insertPlacement.run(ID.placementPlan, 'PLC-DOC1', ID.docPlan, ID.course, ID.subjectHistory, ID.topicIndustrial, 0, createdAt, updatedAt);
    insertPlacement.run(ID.placementCommentary, 'PLC-DOC2', ID.docCommentary, ID.course, ID.subjectHistory, ID.topicSources, 0, createdAt, updatedAt);

    // ── Materials ────────────────────────────────────────────────────────────
    const materialText = pick({
      es: '# Fuente · Informe sobre el trabajo en las fábricas (1832)\n\n«Los niños entran en la fábrica antes del amanecer y salen cuando ya ha oscurecido. El aire está cargado de polvo de algodón y el ruido impide toda conversación.»\n\n## Para el comentario\n\n- ¿Quién escribe y con qué intención?\n- ¿Qué transformaciones del trabajo describe?\n',
      en: '# Source · Report on factory labour (1832)\n\n"The children enter the mill before daybreak and leave when it is already dark. The air is thick with cotton dust and the noise makes conversation impossible."\n\n## For the commentary\n\n- Who is writing, and to what end?\n- Which changes in working life does it describe?\n',
      'zh-CN': '# 史料 · 工厂劳动调查报告（1832）\n\n「孩子们天不亮就进工厂，出来时天已经黑了。空气中弥漫着棉尘，噪音让人无法交谈。」\n\n## 评析要点\n\n- 作者是谁？意图何在？\n- 文中描述了劳动的哪些变化？\n',
    });
    const materialBlob = Buffer.from(materialText, 'utf8');
    db.prepare(`INSERT INTO study_materials
      (id,short_id,title,description,file_name,mime_type,extension,content_blob,content_hash,extracted_text,extraction_status,metadata_json,bibliography_json,read_state,size_bytes,favorite,pinned,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.material, 'MAT-DOC1',
        pick({ es: 'Fuente · Informe fabril (1832)', en: 'Source · Factory report (1832)', 'zh-CN': '史料 · 工厂报告（1832）' }),
        pick({ es: 'Texto que se comenta en la sesión 3 y se evalúa con la rúbrica.', en: 'Text commented on in session 3 and marked with the rubric.', 'zh-CN': '在第 3 课时评析并用评分标准评定的文本。' }),
        'informe-fabril-1832.md', 'text/markdown', 'md', materialBlob, 'demo-teaching-material-v1', materialText, 'ready',
        JSON.stringify({ author: 'Comisión parlamentaria', language: promptL, pages: 1 }),
        JSON.stringify({ type: 'report', title: 'Report on factory labour', year: 1832 }),
        'reading', materialBlob.length, 1, 1, 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_material_placements
      (id,short_id,material_id,course_id,subject_id,topic_id,folder_id,document_id,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.materialPlacement, 'MPL-DOC1', ID.material, ID.course, ID.subjectHistory, ID.topicSources, ID.folder, ID.docCommentary, 0, createdAt, updatedAt);

    // ── Recording ────────────────────────────────────────────────────────────
    const audioBlob = demoWav();
    db.prepare(`INSERT INTO study_recordings
      (id,short_id,title,file_name,mime_type,audio_blob,content_hash,duration_seconds,size_bytes,language,course_id,subject_id,topic_id,document_id,material_id,session_label,processing_status,processing_progress,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.recording, 'REC-DOC1',
        pick({ es: 'Sesión 3 · comentario guiado', en: 'Session 3 · guided commentary', 'zh-CN': '第 3 课时 · 引导式评析' }),
        'sesion-3-demo.wav', 'audio/wav', audioBlob, 'demo-teaching-recording-v1', 2, audioBlob.length, promptL,
        ID.course, ID.subjectHistory, ID.topicSources, ID.docCommentary, ID.material,
        pick({ es: 'Sesión 3', en: 'Session 3', 'zh-CN': '第 3 课时' }), 'ready', 1, 0, 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_transcripts
      (id,short_id,recording_id,kind,content_markdown,language,status,progress,version_no,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.transcript, 'TRN-DOC1', ID.recording, 'literal',
        pick({ es: 'Antes de analizar el contenido conviene clasificar el documento: quién lo escribe, para quién y cuándo.', en: 'Before analysing the content it helps to classify the document: who wrote it, for whom, and when.', 'zh-CN': '在分析内容之前，宜先判定文献：何人撰写、写给谁、何时写成。' }),
        promptL, 'ready', 1, 1, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_transcript_segments
      (id,short_id,transcript_id,t_start,t_end,text,speaker,confidence,chapter,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.transcriptSegment, 'TSG-DOC1', ID.transcript, 0, 2,
        pick({ es: 'Clasificar el documento antes de analizarlo.', en: 'Classify the document before analysing it.', 'zh-CN': '先判定文献，再分析内容。' }),
        pick({ es: 'Docente', en: 'Teacher', 'zh-CN': '教师' }), 0.97,
        pick({ es: 'Método', en: 'Method', 'zh-CN': '方法' }), 0, createdAt, updatedAt);

    // ── Question bank ────────────────────────────────────────────────────────
    db.prepare(`INSERT INTO study_questions
      (id,short_id,prompt,question_type,difficulty,cognitive_level,status,answer_json,options_json,explanation,tags_json,course_id,subject_id,topic_id,document_id,source_title,source_excerpt,source_location_json,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.question, 'QUE-DOC1',
        pick({ es: '¿Qué innovación permitió liberar a la industria de la energía hidráulica?', en: 'Which innovation freed industry from water power?', 'zh-CN': '哪项创新让工业摆脱了对水力的依赖？' }),
        'single_choice', 'medium', 'understand', 'approved',
        JSON.stringify({ value: pick({ es: 'La máquina de vapor', en: 'The steam engine', 'zh-CN': '蒸汽机' }) }),
        JSON.stringify(L === 'es'
          ? ['El telar manual', 'La máquina de vapor', 'La rueda hidráulica', 'El horno de leña']
          : L === 'zh-CN'
            ? ['手动织布机', '蒸汽机', '水车', '燃木炉']
            : ['The handloom', 'The steam engine', 'The water wheel', 'The wood-fired furnace']),
        pick({ es: 'El vapor permitió situar las fábricas lejos de los cursos de agua.', en: 'Steam let factories be sited away from watercourses.', 'zh-CN': '蒸汽让工厂可以远离河道选址。' }),
        JSON.stringify(['industrialización', 'técnica']),
        ID.course, ID.subjectHistory, ID.topicIndustrial, ID.docPlan,
        pick({ es: 'Unidad 3 · guion de sesiones', en: 'Unit 3 · session outline', 'zh-CN': '第三单元 · 课时纲要' }),
        pick({ es: 'Innovación técnica y fábrica.', en: 'Technical innovation and the factory.', 'zh-CN': '技术创新与工厂。' }),
        JSON.stringify({ from: 0, to: 40 }), 1, 0, createdAt, updatedAt);

    // ── Ideas and graph ──────────────────────────────────────────────────────
    // What the AI extraction would have produced from the unit's note and source, so
    // the Analizar group opens on a real network instead of an empty canvas. Both
    // surfaces read the same rows: Ideas lists them, the graph draws the edges. Only
    // History carries ideas — Geography has no materials in this fixture, and an
    // idea whose subject holds no source would be evidence pointing nowhere.
    const insertIdea = db.prepare(`INSERT INTO study_ideas
      (id,subject_id,type,label,normalized_label,statement,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
    const ideas: Array<{ id: string; type: string; label: Localized; statement: Localized }> = [
      {
        id: ID.ideaSteam, type: 'concept',
        label: { es: 'Máquina de vapor', en: 'Steam engine', 'zh-CN': '蒸汽机' },
        statement: {
          es: 'La máquina de vapor libera a la fábrica de los cursos de agua y permite situarla junto a la mina o la ciudad.',
          en: 'The steam engine frees the factory from watercourses and lets it sit next to the mine or the city.',
          'zh-CN': '蒸汽机使工厂摆脱河道束缚，可以建在矿场或城市附近。',
        },
      },
      {
        id: ID.ideaFactory, type: 'concept',
        label: { es: 'Sistema fabril', en: 'Factory system', 'zh-CN': '工厂制度' },
        statement: {
          es: 'La producción se concentra en la fábrica, con maquinaria, división del trabajo y un horario impuesto.',
          en: 'Production concentrates in the factory, with machinery, division of labour and an imposed timetable.',
          'zh-CN': '生产集中于工厂，配备机器、分工和强制工时。',
        },
      },
      {
        id: ID.ideaChildLabour, type: 'consequence',
        label: { es: 'Trabajo infantil', en: 'Child labour', 'zh-CN': '童工' },
        statement: {
          es: 'Las jornadas descritas en los informes fabriles incluyen menores desde antes del amanecer hasta la noche.',
          en: 'The working days described in the factory reports include children from before dawn until night.',
          'zh-CN': '工厂报告描述的工时中，未成年人从天不亮一直工作到夜晚。',
        },
      },
      {
        id: ID.ideaLabour, type: 'process',
        label: { es: 'Movimiento obrero', en: 'Labour movement', 'zh-CN': '工人运动' },
        statement: {
          es: 'Las condiciones de la fábrica dan origen a formas de organización obrera y a las primeras leyes laborales.',
          en: 'Factory conditions give rise to forms of worker organisation and to the first labour laws.',
          'zh-CN': '工厂的条件催生了工人组织形式和最早的劳动法。',
        },
      },
      {
        id: ID.ideaCriticism, type: 'principle',
        label: { es: 'Crítica de fuentes', en: 'Source criticism', 'zh-CN': '史料批判' },
        statement: {
          es: 'Antes de analizar el contenido hay que clasificar el documento: quién escribe, para quién, cuándo y con qué intención.',
          en: 'Before analysing the content the document must be classified: who writes, for whom, when and to what end.',
          'zh-CN': '分析内容之前必须先判定文献：何人撰写、写给谁、何时写成、意图何在。',
        },
      },
    ];
    for (const idea of ideas) {
      insertIdea.run(idea.id, ID.subjectHistory, idea.type, pick(idea.label), normalizeStudyIdeaLabel(pick(idea.label)), pick(idea.statement), createdAt, updatedAt);
    }

    const insertOccurrence = db.prepare(`INSERT INTO study_idea_occurrences
      (id,idea_id,source_kind,source_id,source_title,source_hash,role,confidence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const insertEvidence = db.prepare(`INSERT INTO study_idea_evidence
      (id,occurrence_id,quote,location,position,created_at) VALUES (?,?,?,?,?,?)`);
    const evidence: Array<{ ideaId: string; kind: 'document' | 'material'; sourceId: string; title: Localized; hash: string; quote: Localized }> = [
      {
        ideaId: ID.ideaSteam, kind: 'document', sourceId: ID.docPlan, hash: 'demo-teaching-doc-plan-v1',
        title: { es: 'Unidad 3 · guion de sesiones', en: 'Unit 3 · session outline', 'zh-CN': '第三单元 · 课时纲要' },
        quote: { es: 'Innovación técnica y fábrica.', en: 'Technical innovation and the factory.', 'zh-CN': '技术创新与工厂。' },
      },
      {
        ideaId: ID.ideaFactory, kind: 'document', sourceId: ID.docPlan, hash: 'demo-teaching-doc-plan-v1',
        title: { es: 'Unidad 3 · guion de sesiones', en: 'Unit 3 · session outline', 'zh-CN': '第三单元 · 课时纲要' },
        quote: { es: 'Punto de partida: la sociedad agraria.', en: 'Starting point: agrarian society.', 'zh-CN': '起点：农业社会。' },
      },
      {
        ideaId: ID.ideaChildLabour, kind: 'material', sourceId: ID.material, hash: 'demo-teaching-material-v1',
        title: { es: 'Fuente · Informe fabril (1832)', en: 'Source · Factory report (1832)', 'zh-CN': '史料 · 工厂报告（1832）' },
        quote: {
          es: 'Los niños entran en la fábrica antes del amanecer y salen cuando ya ha oscurecido.',
          en: 'The children enter the mill before daybreak and leave when it is already dark.',
          'zh-CN': '孩子们天不亮就进工厂，出来时天已经黑了。',
        },
      },
      {
        ideaId: ID.ideaLabour, kind: 'document', sourceId: ID.docPlan, hash: 'demo-teaching-doc-plan-v1',
        title: { es: 'Unidad 3 · guion de sesiones', en: 'Unit 3 · session outline', 'zh-CN': '第三单元 · 课时纲要' },
        quote: { es: 'Efectos sociales y movimiento obrero.', en: 'Social effects and the labour movement.', 'zh-CN': '社会影响与工人运动。' },
      },
      {
        ideaId: ID.ideaCriticism, kind: 'document', sourceId: ID.docCommentary, hash: 'demo-teaching-doc-commentary-v1',
        title: { es: 'Cómo comentar un texto histórico', en: 'How to comment on a historical text', 'zh-CN': '如何评析历史文本' },
        quote: {
          es: 'Clasificar el documento: naturaleza, autoría, destinatario y fecha.',
          en: 'Classify the document: nature, authorship, audience and date.',
          'zh-CN': '判定文献：类别、作者、受众与日期。',
        },
      },
    ];
    for (const item of evidence) {
      const occurrenceId = `${item.ideaId}-occurrence`;
      insertOccurrence.run(occurrenceId, item.ideaId, item.kind, item.sourceId, pick(item.title), item.hash, 'principal', 0.93, createdAt, updatedAt);
      insertEvidence.run(`${item.ideaId}-evidence`, occurrenceId, pick(item.quote), pick({ es: 'Material de demostración', en: 'Demo material', 'zh-CN': '演示材料' }), 0, createdAt);
    }

    const insertEdge = db.prepare(`INSERT INTO study_idea_edges
      (id,subject_id,from_id,to_id,type,basis,confidence,source_kind,source_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const edges: Array<{ id: string; from: string; to: string; type: string; basis: Localized; confidence: number }> = [
      {
        id: 'demo-teaching-edge-steam-factory', from: ID.ideaSteam, to: ID.ideaFactory, type: 'causes', confidence: 0.94,
        basis: { es: 'La energía de vapor hace posible concentrar la producción en la fábrica.', en: 'Steam power makes it possible to concentrate production in the factory.', 'zh-CN': '蒸汽动力使生产得以集中于工厂。' },
      },
      {
        id: 'demo-teaching-edge-factory-child', from: ID.ideaFactory, to: ID.ideaChildLabour, type: 'causes', confidence: 0.9,
        basis: { es: 'El horario y la maquinaria de la fábrica explican las jornadas que describe el informe.', en: 'The factory timetable and machinery explain the working days the report describes.', 'zh-CN': '工厂的工时与机器解释了报告所描述的劳动日程。' },
      },
      {
        id: 'demo-teaching-edge-child-labour', from: ID.ideaChildLabour, to: ID.ideaLabour, type: 'causes', confidence: 0.88,
        basis: { es: 'Las condiciones denunciadas están en el origen de la organización obrera.', en: 'The conditions denounced lie behind the rise of worker organisation.', 'zh-CN': '被揭露的恶劣条件是工人组织兴起的原因。' },
      },
      {
        id: 'demo-teaching-edge-criticism-child', from: ID.ideaCriticism, to: ID.ideaChildLabour, type: 'applies', confidence: 0.82,
        basis: { es: 'El método de comentario se aplica sobre este informe antes de dar por buenos sus datos.', en: 'The commentary method is applied to this report before its data are taken at face value.', 'zh-CN': '在采信报告数据之前，先对其运用评析方法。' },
      },
    ];
    for (const edge of edges) {
      insertEdge.run(edge.id, ID.subjectHistory, edge.from, edge.to, edge.type, pick(edge.basis), edge.confidence, 'document', ID.docPlan, createdAt, updatedAt);
    }

    // The jobs table is what the Ideas view reads to say a source is already analysed;
    // without these rows the demo would offer to re-extract what is already there.
    const insertKnowledgeJob = db.prepare(`INSERT INTO study_knowledge_jobs
      (subject_id,source_kind,source_id,status,phase,source_hash,updated_at) VALUES (?,?,?,?,?,?,?)`);
    insertKnowledgeJob.run(ID.subjectHistory, 'document', ID.docPlan, 'done', 'done', 'demo-teaching-doc-plan-v1', updatedAt);
    insertKnowledgeJob.run(ID.subjectHistory, 'document', ID.docCommentary, 'done', 'done', 'demo-teaching-doc-commentary-v1', updatedAt);
    insertKnowledgeJob.run(ID.subjectHistory, 'material', ID.material, 'done', 'done', 'demo-teaching-material-v1', updatedAt);

    // ── Unit design ──────────────────────────────────────────────────────────
    // A saved unit, so the gallery opens on something real. Written as a fixed-outline
    // unit would come out: three parts in the order a teacher would fix, each citing a
    // material through the same nodus:// links the generator emits, so the reader, the
    // citation modal and the export all exercise real data.
    const unitSections: Array<{ id: string; title: Localized; purpose: Localized; body: Localized; source: 'material' | 'doc' }> = [
      {
        id: 'u1',
        title: { es: 'Punto de partida: la sociedad agraria', en: 'Starting point: agrarian society', 'zh-CN': '起点：农业社会' },
        purpose: { es: 'Situar el antes para que el cambio industrial se entienda como ruptura.', en: 'Establish the before so industrial change reads as a break.', 'zh-CN': '先交代此前的状况，使工业变革被理解为一次断裂。' },
        body: {
          es: 'Antes de hablar de fábricas conviene fijar el punto de partida: una sociedad en la que la mayoría vive del campo y el trabajo sigue el ritmo de las estaciones. El guion de la unidad abre precisamente ahí',
          en: 'Before talking about factories it helps to fix the starting point: a society where most people live off the land and work follows the rhythm of the seasons. The unit outline opens exactly there',
          'zh-CN': '在谈论工厂之前，宜先明确起点：这是一个多数人靠土地为生、劳作随季节更替的社会。单元纲要正是从这里开始',
        },
        source: 'doc',
      },
      {
        id: 'u2',
        title: { es: 'La fábrica y el trabajo infantil', en: 'The factory and child labour', 'zh-CN': '工厂与童工' },
        purpose: { es: 'Trabajar la fuente de 1832 con el método de comentario ya visto.', en: 'Work the 1832 source with the commentary method already covered.', 'zh-CN': '运用已学的评析方法处理 1832 年的史料。' },
        body: {
          es: 'El informe parlamentario describe jornadas que empiezan antes del amanecer y terminan de noche, con polvo de algodón y un ruido que impide hablar',
          en: 'The parliamentary report describes days that begin before dawn and end after dark, with cotton dust and noise that makes talking impossible',
          'zh-CN': '议会报告描述了从天不亮持续到夜晚的工时，空气中弥漫着棉尘，噪音让人无法交谈',
        },
        source: 'material',
      },
      {
        id: 'u3',
        title: { es: 'Del malestar a la organización obrera', en: 'From grievance to worker organisation', 'zh-CN': '从不满到工人组织' },
        purpose: { es: 'Cerrar la unidad enlazando las condiciones descritas con sus consecuencias.', en: 'Close the unit by linking the described conditions to their consequences.', 'zh-CN': '收束本单元，将所描述的条件与其后果联系起来。' },
        body: {
          es: 'La última sesión enlaza las condiciones descritas con las primeras formas de organización obrera y con la legislación que las siguió',
          en: 'The last session links the conditions described with the first forms of worker organisation and the legislation that followed',
          'zh-CN': '最后一课时将所描述的条件与最早的工人组织形式及其后的立法联系起来',
        },
        source: 'doc',
      },
    ];
    const unitLink = (source: 'material' | 'doc'): string => (source === 'material'
      ? `[${pick({ es: 'Fuente · Informe fabril (1832)', en: 'Source · Factory report (1832)', 'zh-CN': '史料 · 工厂报告（1832）' })}](nodus://study/material/${ID.material})`
      : `[${pick({ es: 'Unidad 3 · guion de sesiones', en: 'Unit 3 · session outline', 'zh-CN': '第三单元 · 课时纲要' })}](nodus://study/doc/${ID.docPlan})`);
    const unitTitle = pick({ es: 'Unidad 3 · La revolución industrial', en: 'Unit 3 · The industrial revolution', 'zh-CN': '第三单元 · 工业革命' });
    const unitBrief = { kind: 'deep_research', objective: pick({ es: 'Diseñar la unidad sobre la revolución industrial para 3.º ESO', en: 'Design the industrial revolution unit for Year 9', 'zh-CN': '为初三设计工业革命单元' }), tone: 'academic', language: promptL };
    const unitDraft = {
      generatedAt: updatedAt,
      brief: unitBrief,
      selection: { ideaIds: [ID.ideaFactory, ID.ideaChildLabour], themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: [] },
      title: unitTitle,
      abstract: pick({
        es: 'Tres partes que llevan al alumnado de la sociedad agraria al movimiento obrero pasando por el comentario de una fuente de 1832.',
        en: 'Three parts taking students from agrarian society to the labour movement by way of a commentary on an 1832 source.',
        'zh-CN': '三个部分带领学生从农业社会出发，经由对 1832 年史料的评析，走向工人运动。',
      }),
      outline: unitSections.map((section) => ({ id: section.id, title: pick(section.title), purpose: pick(section.purpose), keyClaims: [], sources: [unitLink(section.source)] })),
      draftMarkdown: unitSections.map((section) => `## ${pick(section.title)}\n\n${pick(section.body)} ${unitLink(section.source)}.`).join('\n\n'),
      matrix: [],
      bibliography: [pick({ es: 'Fuente · Informe fabril (1832)', en: 'Source · Factory report (1832)', 'zh-CN': '史料 · 工厂报告（1832）' })],
      nextSteps: [pick({ es: 'Evaluar el comentario con la rúbrica de la unidad.', en: 'Mark the commentary with the unit rubric.', 'zh-CN': '依据本单元评分标准评定评析作业。' })],
      limitations: [pick({ es: 'Los materiales disponibles no cubren el caso español.', en: 'The available materials do not cover the Spanish case.', 'zh-CN': '现有材料未涵盖西班牙的情况。' })],
      stats: { selectedIdeas: 2, selectedThemes: 0, selectedGaps: 0, selectedContradictions: 0, selectedWorks: 2, selectedPassages: 0, selectedTutorRoutes: 0, contextChars: 4_200, truncated: false },
    };
    db.prepare('INSERT INTO writing_saved_drafts (id,title,brief_json,selection_json,model_json,draft_json,created_at,updated_at) VALUES (?,?,?,?,NULL,?,?,?)')
      .run(ID.unit, unitTitle, JSON.stringify(unitBrief), JSON.stringify(unitDraft.selection), JSON.stringify(unitDraft), createdAt, updatedAt);

    // ── Timetable and calendar ───────────────────────────────────────────────
    const insertPeriod = db.prepare('INSERT INTO study_schedule_periods (id,section,label,start_time,end_time,position,academic_year_id) VALUES (?,?,?,?,?,?,?)');
    insertPeriod.run(ID.scheduleFirst, 'morning', pick({ es: 'Primera hora', en: 'First period', 'zh-CN': '第一节课' }), '08:30', '09:25', 0, ID.academicYear);
    insertPeriod.run(ID.scheduleThird, 'morning', pick({ es: 'Tercera hora', en: 'Third period', 'zh-CN': '第三节课' }), '10:20', '11:15', 1, ID.academicYear);
    const insertCell = db.prepare('INSERT INTO study_schedule_cells (day,period_id,subject_id) VALUES (?,?,?)');
    insertCell.run('monday', ID.scheduleFirst, ID.subjectHistory);
    insertCell.run('tuesday', ID.scheduleThird, ID.subjectGeography);
    insertCell.run('thursday', ID.scheduleFirst, ID.subjectHistory);
    insertCell.run('friday', ID.scheduleThird, ID.subjectHistory);

    db.prepare(`INSERT INTO study_plans
      (id,short_id,title,description,course_id,subject_id,exam_at,available_minutes,config_json,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.plan, 'PLN-DOC1',
        pick({ es: 'Cierre de la unidad 3', en: 'Closing unit 3', 'zh-CN': '第三单元收尾' }),
        pick({ es: 'Sesiones restantes hasta la prueba escrita.', en: 'Sessions left before the written test.', 'zh-CN': '距离笔试剩余的课时。' }),
        ID.course, ID.subjectHistory, examAt, 180, '{}', 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_calendar_events
      (id,short_id,title,event_type,starts_at,all_day,course_id,subject_id,notes,reminder_minutes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.event, 'EVT-DOC1',
        pick({ es: 'Prueba escrita · unidad 3', en: 'Written test · unit 3', 'zh-CN': '笔试 · 第三单元' }), 'exam', examAt, 1,
        ID.course, ID.subjectHistory,
        pick({ es: 'Fecha de ejemplo editable.', en: 'Editable sample date.', 'zh-CN': '可编辑的示例日期。' }), 1440, createdAt, updatedAt);

    // ── Student group ────────────────────────────────────────────────────────
    db.prepare(`INSERT INTO teaching_groups
      (id,short_id,name,subject_id,academic_year_id,expected_size,position,archived_at,deleted_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?)`)
      .run(ID.group, 'GRP-DOC1', pick({ es: '3.º ESO A', en: 'Year 9 A', 'zh-CN': '初三A班' }), ID.subjectHistory, ID.academicYear, STUDENTS.length, 0, createdAt, updatedAt);

    const rng = seededRng(20_260_719);
    const taken = new Set<string>();
    const insertStudent = db.prepare(`INSERT INTO teaching_students
      (id,group_id,given_names,surnames,comments,pseudonym_code,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    STUDENTS.forEach((student, index) => {
      const code = generatePseudonymCode(taken, rng);
      taken.add(code);
      insertStudent.run(student.id, ID.group, student.givenNames, student.surnames, pick(student.comments), code, index, createdAt, updatedAt);
    });

    // ── Rubric ───────────────────────────────────────────────────────────────
    const levels = buildRubricLevels('achievement4', promptL, 10);
    const criteria = RUBRIC_CRITERIA.map((criterion) => ({
      id: criterion.id,
      name: pick(criterion.name),
      description: pick(criterion.description),
      weight: criterion.weight,
      cells: Object.fromEntries(levels.map((level, index) => [level.id, pick(criterion.cells[index])])),
    }));
    db.prepare(`INSERT INTO teaching_rubrics
      (id,short_id,title,description,subject_id,course_id,language,scale_max,weighted,levels_json,criteria_json,position,archived_at,deleted_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)`)
      .run(ID.rubric, 'RUB-DOC1',
        pick({ es: 'Comentario de texto histórico', en: 'Historical source commentary', 'zh-CN': '历史文本评析' }),
        pick({ es: 'Rúbrica analítica ponderada para el comentario de la unidad 3.', en: 'Weighted analytic rubric for the unit 3 commentary.', 'zh-CN': '用于第三单元评析的加权分析式评分标准。' }),
        ID.subjectHistory, ID.course, promptL, 10, 1,
        JSON.stringify(levels), JSON.stringify(criteria), 0, createdAt, updatedAt);

    // ── Exam ─────────────────────────────────────────────────────────────────
    const header = {
      institution: pick({ es: 'IES de ejemplo', en: 'Sample secondary school', 'zh-CN': '示例中学' }),
      subjectName: pick({ es: 'Geografía e Historia', en: 'Geography and History', 'zh-CN': '地理与历史' }),
      teachers: pick({ es: 'Departamento de Ciencias Sociales', en: 'Social Sciences department', 'zh-CN': '社会科学教研组' }),
      groupLabel: pick({ es: '3.º ESO A', en: 'Year 9 A', 'zh-CN': '初三A班' }),
      examTitle: pick({ es: 'Prueba escrita · unidad 3', en: 'Written test · unit 3', 'zh-CN': '笔试 · 第三单元' }),
      dateText: '',
      durationMinutes: 55,
      instructions: pick({
        es: 'Lee el enunciado completo antes de responder. Cuida la expresión y justifica siempre tus respuestas.',
        en: 'Read the whole paper before answering. Mind your expression and always justify your answers.',
        'zh-CN': '作答前请通读全卷。注意表达，并始终为你的答案提供理由。',
      }),
      showStudentName: true, showStudentId: false, showGroup: true,
      showDate: true, showGradeBox: true, showPoints: true,
    };
    db.prepare(`INSERT INTO teaching_exams
      (id,short_id,title,subject_id,course_id,language,target_question_count,header_json,logos_json,position,archived_at,deleted_at,created_at,updated_at,language_locked)
      VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?)`)
      .run(ID.exam, 'EXM-DOC1',
        pick({ es: 'Prueba escrita · unidad 3', en: 'Written test · unit 3', 'zh-CN': '笔试 · 第三单元' }),
        ID.subjectHistory, ID.course, promptL, 6, JSON.stringify(header), '[]', 0, createdAt, updatedAt, 0);

    const insertQuestion = db.prepare(`INSERT INTO teaching_exam_questions
      (id,short_id,exam_id,position,type,prompt,points,options_json,pairs_json,items_json,image_data_url,image_caption,answer_lines,solution,ai_prompt,generated_by,created_at,updated_at,parent_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,NULL,'',?,?,'','manual',?,?,?)`);
    // Options and pairs are objects with their own ids — the answer key keys off
    // `correct`, and a bare string would leave the key with nothing to mark.
    const opts = (labels: string[], correctIndex: number) => labels.map((text, index) => ({ id: `O${index + 1}`, text, correct: index === correctIndex }));
    const prs = (rows: Array<[string, string]>) => rows.map(([left, right], index) => ({ id: `P${index + 1}`, left, right }));
    const q = (id: string, shortId: string, position: number, type: string, prompt: string, points: number, answerLines: number, solution: string, parentId: string | null = null, options: unknown[] = [], pairs: unknown[] = [], items: string[] = []) =>
      insertQuestion.run(id, shortId, ID.exam, position, type, prompt, points, JSON.stringify(options), JSON.stringify(pairs), JSON.stringify(items), answerLines, solution, createdAt, updatedAt, parentId);

    q('demo-teaching-eq-1', 'EQU-DOC1', 0, 'definition',
      pick({ es: 'Define «revolución industrial» e indica el periodo en que se desarrolla.', en: 'Define "industrial revolution" and state the period in which it unfolds.', 'zh-CN': '请为「工业革命」下定义，并指出其发生时期。' }),
      1, 4,
      pick({ es: 'Proceso de transformación económica basado en la mecanización y la fábrica, iniciado en Gran Bretaña a finales del siglo XVIII.', en: 'Process of economic transformation based on mechanisation and the factory, beginning in Britain in the late eighteenth century.', 'zh-CN': '一场以机械化和工厂为基础的经济变革，18 世纪末始于英国。' }));

    // A section statement plus the two questions that hang from it: this is what makes
    // the printed paper number them 2.1 and 2.2 while the statement itself scores
    // nothing of its own.
    q('demo-teaching-eq-section', 'EQU-DOC2', 1, 'section',
      pick({
        es: 'Lee el siguiente testimonio: «Los niños entran en la fábrica antes del amanecer y salen cuando ya ha oscurecido. El aire está cargado de polvo de algodón.» (Informe parlamentario, 1832)',
        en: 'Read the following testimony: "The children enter the mill before daybreak and leave when it is already dark. The air is thick with cotton dust." (Parliamentary report, 1832)',
        'zh-CN': '阅读以下证词：「孩子们天不亮就进工厂，出来时天已经黑了。空气中弥漫着棉尘。」（议会报告，1832）',
      }),
      0, 0, '');
    q('demo-teaching-eq-2a', 'EQU-DOC3', 2, 'short_essay',
      pick({ es: 'Explica qué condiciones de trabajo describe el testimonio.', en: 'Explain which working conditions the testimony describes.', 'zh-CN': '请说明证词描述了哪些劳动条件。' }),
      1.5, 6,
      pick({ es: 'Jornadas de sol a sol, trabajo infantil y ambiente insalubre por el polvo de algodón.', en: 'Dawn-to-dusk shifts, child labour and an unhealthy atmosphere from cotton dust.', 'zh-CN': '起早贪黑的工时、童工，以及因棉尘而不健康的环境。' }),
      'demo-teaching-eq-section');
    q('demo-teaching-eq-2b', 'EQU-DOC4', 3, 'short_answer',
      pick({ es: '¿Qué respuesta social surge frente a estas condiciones?', en: 'What social response emerged in the face of these conditions?', 'zh-CN': '面对这些条件，出现了怎样的社会回应？' }),
      0.5, 2,
      pick({ es: 'El movimiento obrero y las primeras leyes de regulación laboral.', en: 'The labour movement and the first factory-regulation laws.', 'zh-CN': '工人运动和最早规范劳动的立法。' }),
      'demo-teaching-eq-section');

    q('demo-teaching-eq-3', 'EQU-DOC5', 4, 'multiple_choice',
      pick({ es: '¿Qué fuente de energía caracteriza la primera industrialización?', en: 'Which energy source characterises the first industrialisation?', 'zh-CN': '第一次工业化的标志性能源是什么？' }),
      0.5, 0,
      pick({ es: 'El carbón.', en: 'Coal.', 'zh-CN': '煤炭。' }), null,
      opts(L === 'es'
        ? ['El carbón', 'El petróleo', 'La electricidad', 'El gas natural']
        : L === 'zh-CN'
          ? ['煤炭', '石油', '电力', '天然气']
          : ['Coal', 'Oil', 'Electricity', 'Natural gas'], 0));
    q('demo-teaching-eq-4', 'EQU-DOC6', 5, 'true_false',
      pick({ es: 'La industrialización llegó a toda Europa al mismo tiempo.', en: 'Industrialisation reached the whole of Europe at the same time.', 'zh-CN': '工业化同时波及了整个欧洲。' }),
      0.25, 0,
      pick({ es: 'Falso: fue un proceso desigual y escalonado.', en: 'False: it was an uneven, staggered process.', 'zh-CN': '错误：这是一个不均衡、分阶段的过程。' }));
    q('demo-teaching-eq-5', 'EQU-DOC7', 6, 'matching',
      pick({ es: 'Relaciona cada invento con su ámbito de aplicación.', en: 'Match each invention with the field it applied to.', 'zh-CN': '将每项发明与其应用领域配对。' }),
      1, 0,
      pick({ es: 'Vapor–transporte; telar mecánico–textil; convertidor–siderurgia.', en: 'Steam–transport; power loom–textiles; converter–steelmaking.', 'zh-CN': '蒸汽–运输；机械织机–纺织；转炉–炼钢。' }),
      null, [],
      prs(L === 'es'
        ? [['Máquina de vapor', 'Transporte'], ['Telar mecánico', 'Industria textil'], ['Convertidor Bessemer', 'Siderurgia']]
        : L === 'zh-CN'
          ? [['蒸汽机', '运输'], ['机械织机', '纺织业'], ['贝塞麦转炉', '炼钢业']]
          : [['Steam engine', 'Transport'], ['Power loom', 'Textile industry'], ['Bessemer converter', 'Steelmaking']]));

    // ── Assessment plan ──────────────────────────────────────────────────────
    // Published on purpose: a frozen plan is what a grade can be defended against, and
    // it is the state the tutorial explains.
    db.prepare(`INSERT INTO teaching_assessment_plans
      (id,short_id,name,subject_id,academic_year_id,profile,rules_json,published_at,version,parent_version_id,archived_at,deleted_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,?)`)
      .run(ID.assessmentPlan, 'PLA-DOC1',
        pick({ es: 'Historia · 3.º ESO A', en: 'History · Year 9 A', 'zh-CN': '历史 · 初三A班' }),
        ID.subjectHistory, ID.academicYear, 'secundaria-mixta',
        JSON.stringify(assessmentProfile('secundaria-mixta').rules), publishedAt, 1, createdAt, updatedAt);

    const insertItem = db.prepare(`INSERT INTO teaching_assessment_items
      (id,plan_id,parent_id,name,kind,position,weight,weight_alt,aggregation,entry_mode,max_points,min_to_average,is_mandatory,is_recoverable,target,best_of,conditional_min,source_exam_id,source_exam_question_id,source_rubric_id,competency_code,criterion_code,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,NULL,NULL,NULL,?,NULL,?,?,?,?,?)`);
    const writeNode = (node: PlanNode, parentId: string | null, position: number, competency: string | null, criterion: string | null) => {
      insertItem.run(node.id, ID.assessmentPlan, parentId, pick(node.name), node.kind, position,
        node.weight, node.weightAlt, node.aggregation, node.entryMode, node.maxPoints,
        node.minToAverage, node.isMandatory, node.sourceExamId ?? null, node.sourceRubricId ?? null,
        competency, criterion, createdAt, updatedAt);
      node.children?.forEach((child, index) => writeNode(child, node.id, index, competency, criterion));
    };
    // LOMLOE traceability on the blocks, which is where an inspection looks for it.
    const codes: Array<[string, string]> = [['CE.3.1', 'CR.3.1.2'], ['CE.3.2', 'CR.3.2.1'], ['CE.3.4', 'CR.3.4.3']];
    PLAN_TREE.forEach((node, index) => writeNode(node, null, index, codes[index][0], codes[index][1]));

    // ── Grade entries ────────────────────────────────────────────────────────
    const leafIds = PLAN_TREE.flatMap((block) => (block.children ?? []).map((leaf) => leaf.id));
    const insertEntry = db.prepare(`INSERT INTO teaching_grade_entries
      (id,student_id,item_id,convocatoria,raw_value,status,is_override,note,created_at,updated_at)
      VALUES (?,?,?,'ordinaria',?,?,0,?,?,?)`);
    const insertRubricEval = db.prepare(`INSERT INTO teaching_rubric_evaluations
      (id,entry_id,criterion_id,level_id,created_at,updated_at) VALUES (?,?,?,?,?,?)`);
    const STATUS_NOTE: Record<string, Localized> = {
      not_submitted: { es: 'Sin entregar en el plazo acordado con el grupo.', en: 'Not handed in within the deadline agreed with the group.', 'zh-CN': '未在小组约定的期限内提交。' },
      not_assessed: { es: 'Se incorporó al grupo después de esta prueba.', en: 'Joined the group after this test.', 'zh-CN': '在该测验之后才加入小组。' },
      exempt: { es: 'Exenta por adaptación curricular.', en: 'Exempt under a curricular adaptation.', 'zh-CN': '因课程调整免考。' },
    };

    for (const student of STUDENTS) {
      const marks = MARKS[student.id];
      leafIds.forEach((itemId, index) => {
        const [value, status] = marks[index];
        const entryId = `${student.id}-entry-${index}`;
        insertEntry.run(entryId, student.id, itemId, value, status, pick(STATUS_NOTE[status] ?? { es: '', en: '', 'zh-CN': '' }), createdAt, updatedAt);
        // The commentary leaf is marked with the rubric, so it also carries the level
        // chosen for each criterion.
        if (itemId === 'demo-teaching-item-commentary-guided' && status === 'evaluated') {
          RUBRIC_CHOICES[student.id].forEach((levelId, criterionIndex) => {
            insertRubricEval.run(`${entryId}-crit-${criterionIndex}`, entryId, RUBRIC_CRITERIA[criterionIndex].id, levelId, createdAt, updatedAt);
          });
        }
      });
    }

    // Loading the sample workspace must not re-open a completed/dismissed tutorial.
    updateSettings({ demoMode: true });
  })();
  // Outside the transaction: the chat history is a file in the vault directory, not a
  // table, so it cannot take part in the SQLite rollback.
  seedStudyAssistantDemoConversation('teaching');
  return true;
}

export function clearTeachingDemoData(): void {
  const db = getDb();
  const hasRows = Number((db.prepare("SELECT COUNT(*) value FROM study_courses WHERE id LIKE 'demo-teaching-%'").get() as { value: number }).value) > 0;
  if (!hasRows && !getSettings().demoMode) return;
  db.transaction(() => {
    db.exec(`
      DELETE FROM teaching_rubric_evaluations WHERE id LIKE 'demo-teaching-%';
      DELETE FROM teaching_grade_entries WHERE id LIKE 'demo-teaching-%';
      DELETE FROM teaching_assessment_items WHERE id LIKE 'demo-teaching-%';
      DELETE FROM teaching_assessment_plans WHERE id LIKE 'demo-teaching-%';
      DELETE FROM teaching_exam_questions WHERE id LIKE 'demo-teaching-%';
      DELETE FROM teaching_exams WHERE id LIKE 'demo-teaching-%';
      DELETE FROM teaching_rubrics WHERE id LIKE 'demo-teaching-%';
      DELETE FROM teaching_students WHERE id LIKE 'demo-teaching-%';
      DELETE FROM teaching_groups WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_schedule_cells WHERE period_id LIKE 'demo-teaching-%';
      DELETE FROM study_schedule_periods WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_calendar_events WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_plans WHERE id LIKE 'demo-teaching-%';
      DELETE FROM writing_saved_drafts WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_questions WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_knowledge_jobs WHERE source_id LIKE 'demo-teaching-%';
      DELETE FROM study_idea_edges WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_idea_evidence WHERE occurrence_id LIKE 'demo-teaching-%';
      DELETE FROM study_idea_occurrences WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_ideas WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_transcript_segments WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_transcripts WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_recordings WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_material_placements WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_materials WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_placements WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_docs WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_topics WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_folders WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_subjects WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_courses WHERE id LIKE 'demo-teaching-%';
      DELETE FROM study_academic_years WHERE id LIKE 'demo-teaching-%';
    `);
  })();
  clearStudyAssistantDemoConversation('teaching');
}
