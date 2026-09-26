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
import { addDays, isWeekend, toDayKey } from '@shared/teachingAttendance';
import { clearStudyAssistantDemoConversation, seedStudyAssistantDemoConversation } from '../ai/studyAssistant';
import { getDb } from './database';
import { getSettings, updateSettings } from './settingsRepo';
import { normalizeStudyIdeaLabel } from './studyKnowledgeRepo';
import { getActiveVault } from '../vaults/vaultRegistry';

type DemoLocale = 'es' | 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko';
type Localized = { es: string; en: string; 'zh-CN': string; 'zh-TW': string; ja: string; ko: string };

/** The demo speaks the interface language when it can, and English otherwise. */
function demoLocale(): DemoLocale {
  const language = getSettings().uiLanguage;
  if (language === 'zh-CN') return 'zh-CN';
  if (language === 'zh-TW') return 'zh-TW';
  if (language === 'ja') return 'ja';
  if (language === 'ko') return 'ko';
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
  { id: 'demo-teaching-student-1', givenNames: 'Lucía', surnames: 'Alonso Prieto', comments: { es: 'Participa con argumentos sólidos; conviene darle textos más exigentes.', en: 'Argues well in class; ready for more demanding sources.', 'zh-CN': '课堂发言论证扎实，可适当提供更具挑战性的资料。' ,
  'zh-TW': '課堂發言論證紮實，可適當提供更具挑戰性的資料。',
  ko: "수업 시간에 잘 논쟁합니다. 더욱 까다로운 소스에 대한 준비가 되어 있습니다.",
  ja: "授業中はよく議論する。より要求の厳しいソースに対応できるようになります。", } },
  { id: 'demo-teaching-student-2', givenNames: 'Adrián', surnames: 'Benítez Salas', comments: { es: 'Mejora mucho cuando trabaja con guion previo.', en: 'Improves markedly when he works from an outline.', 'zh-CN': '先写提纲再作答时进步明显。' ,
  'zh-TW': '先寫提綱再作答時進步明顯。',
  ko: "그가 개요에 따라 작업할 때 눈에 띄게 향상됩니다.",
  ja: "アウトラインに基づいて作業すると、著しく改善されます。", } },
  { id: 'demo-teaching-student-3', givenNames: 'Nerea', surnames: 'Cabrera Ruiz', comments: { es: 'Domina el vocabulario; le cuesta cerrar la conclusión.', en: 'Strong vocabulary; her conclusions still trail off.', 'zh-CN': '词汇掌握出色，但结论收尾仍显不足。' ,
  'zh-TW': '詞彙掌握出色，但結論收尾仍顯不足。',
  ko: "강력한 어휘; 그녀의 결론은 여전히 ​​​​끝나고 있습니다.",
  ja: "強力な語彙。彼女の結論はまだ尾を引いている。", } },
  { id: 'demo-teaching-student-4', givenNames: 'Iván', surnames: 'Domínguez Peña', comments: { es: 'Se incorporó en noviembre: pendiente de recuperar la unidad 1.', en: 'Joined in November: unit 1 still to be made up.', 'zh-CN': '11 月才入班，仍需补上第一单元。' ,
  'zh-TW': '11 月才入班，仍需補上第一單元。',
  ko: "11월에 가입: 1호기는 아직 구성 중입니다.",
  ja: "11月に加入：ユニット1はまだ構成中。", } },
  { id: 'demo-teaching-student-5', givenNames: 'Marta', surnames: 'Esteban Gil', comments: { es: 'Exenta de la prueba de mapas por adaptación curricular.', en: 'Exempt from the map test under a curricular adaptation.', 'zh-CN': '因课程调整免考地图测验。' ,
  'zh-TW': '因課程調整免考地圖測驗。',
  ko: "커리큘럼 조정에 따라 지도 시험이 면제됩니다.",
  ja: "カリキュラム適応により地図テストが免除される。", } },
  { id: 'demo-teaching-student-6', givenNames: 'Youssef', surnames: 'Fernández Amrani', comments: { es: 'Buen análisis oral; conviene reforzar la expresión escrita.', en: 'Analyses well out loud; written expression needs support.', 'zh-CN': '口头分析能力强，书面表达需要加强。' ,
  'zh-TW': '口頭分析能力強，書面表達需要加強。',
  ko: "소리내어 잘 분석합니다. 서면 표현에는 지원이 필요합니다.",
  ja: "大声でよく分析します。書かれた表現にはサポートが必要です。", } },
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
    name: { es: 'Contextualización histórica', en: 'Historical contextualisation', 'zh-CN': '历史语境化' ,
  'zh-TW': '歷史語境化',
  ko: "역사적 상황화",
  ja: "歴史的文脈化", },
    description: { es: 'Relación del documento con el momento en que se produce.', en: 'How the document is tied to the moment that produced it.', 'zh-CN': '将文献与其产生的时代相联系。' ,
  'zh-TW': '將文獻與其產生的時代相聯絡。',
  ko: "문서가 문서를 생성한 순간과 어떻게 연관되어 있는지.",
  ja: "文書がそれを作成した瞬間とどのように結びついているのか。", },
    weight: 30,
    cells: [
      { es: 'Sitúa el documento en su momento histórico preciso y explica cómo las circunstancias de esa época condicionan su contenido.', en: 'Places the document in its precise historical moment and explains how the circumstances of that period shape its content.', 'zh-CN': '将文献准确定位于其历史时刻，并说明当时的环境如何影响其内容。' ,
  'zh-TW': '將文獻準確定位於其歷史時刻，並說明當時的環境如何影響其內容。',
  ko: "문서를 정확한 역사적 순간에 배치하고 해당 기간의 상황이 문서의 내용을 어떻게 형성했는지 설명합니다.",
  ja: "文書をその正確な歴史的瞬間に置き、その時代の状況がその内容をどのように形成したかを説明します。", },
      { es: 'Identifica el periodo correspondiente y menciona los principales acontecimientos que rodean la redacción del documento.', en: 'Identifies the relevant period and mentions the main events surrounding the writing of the document.', 'zh-CN': '指出文献所属时期，并提及文献撰写前后的主要事件。' ,
  'zh-TW': '指出文獻所屬時期，並提及文獻撰寫前後的主要事件。',
  ko: "관련 기간을 식별하고 문서 작성과 관련된 주요 사건을 언급합니다.",
  ja: "関連する時代を特定し、文書の執筆を取り巻く主な出来事について言及します。", },
      { es: 'Ubica el texto en un marco temporal amplio y aporta algún dato del entorno en que surge.', en: 'Locates the text within a broad time frame and offers some detail about the setting it comes from.', 'zh-CN': '将文本置于宽泛的时间框架中，并提供其产生背景的若干信息。' ,
  'zh-TW': '將文本置於寬泛的時間框架中，並提供其產生背景的若干資訊。',
  ko: "광범위한 기간 내에서 텍스트를 찾고 해당 텍스트의 출처에 대한 세부 정보를 제공합니다.",
  ja: "広い時間枠内でテキストを特定し、そのテキストが由来する設定についての詳細を提供します。", },
      { es: 'Asocia el documento a una etapa general, con referencias todavía imprecisas sobre su origen.', en: 'Links the document to a general stage, with references to its origin that remain approximate.', 'zh-CN': '将文献归入大致阶段，对其来源的说明仍较模糊。' ,
  'zh-TW': '將文獻歸入大致階段，對其來源的說明仍較模糊。',
  ko: "대략적으로 유지되는 원본에 대한 참조를 사용하여 문서를 일반 단계에 연결합니다.",
  ja: "ドキュメントを一般的なステージにリンクしますが、その起源への参照は大まかなもののままです。", },
    ],
  },
  {
    id: 'C2',
    name: { es: 'Análisis del contenido', en: 'Analysis of the content', 'zh-CN': '内容分析' ,
  'zh-TW': '內容分析',
  ko: "내용 분석",
  ja: "内容の分析", },
    description: { es: 'Tratamiento de las ideas que el texto sostiene.', en: 'How the ideas the text puts forward are handled.', 'zh-CN': '对文本所持观点的处理。' ,
  'zh-TW': '對文本所持觀點的處理。',
  ko: "텍스트가 제시하는 아이디어가 어떻게 처리되는지.",
  ja: "テキストが提示するアイデアがどのように扱われるか。", },
    weight: 30,
    cells: [
      { es: 'Distingue las ideas principales de las secundarias y las relaciona entre sí construyendo una interpretación propia.', en: 'Tells main ideas from secondary ones and connects them into an interpretation of their own.', 'zh-CN': '区分主要观点与次要观点，并将其相互联系，形成自己的解读。' ,
  'zh-TW': '區分主要觀點與次要觀點，並將其相互聯絡，形成自己的解讀。',
  ko: "주요 아이디어와 보조 아이디어를 알려주고 이를 자신만의 해석으로 연결합니다.",
  ja: "主なアイデアと二次的なアイデアを伝え、それらを独自の解釈に結び付けます。", },
      { es: 'Extrae las ideas centrales del texto y las ordena siguiendo la estructura interna del propio documento.', en: 'Draws out the central ideas and arranges them following the internal structure of the document.', 'zh-CN': '提炼文本的核心观点，并依照文献自身的内部结构加以组织。' ,
  'zh-TW': '提煉文本的核心觀點，並依照文獻自身的內部結構加以組織。',
  ko: "중심 아이디어를 도출하고 문서 내부 구조에 따라 배열합니다.",
  ja: "中心的なアイデアを引き出し、文書の内部構造に従って配置します。", },
      { es: 'Reconoce algunas ideas relevantes y las expone de forma independiente, con conexiones todavía escasas.', en: 'Recognises several relevant ideas and sets them out separately, with connections still sparse.', 'zh-CN': '能识别若干相关观点并分别阐述，但彼此间的联系仍然不足。' ,
  'zh-TW': '能識別若干相關觀點並分別闡述，但彼此間的聯絡仍然不足。',
  ko: "몇 가지 관련 아이디어를 인식하고 이를 별도로 설명하지만 연결은 여전히 ​​희박합니다.",
  ja: "いくつかの関連するアイデアを認識し、それらを個別に設定しますが、関連性はまだまばらです。", },
      { es: 'Reproduce fragmentos del texto acompañados de comentarios breves sobre su significado literal.', en: 'Reproduces fragments of the text alongside brief remarks on their literal meaning.', 'zh-CN': '摘录文本片段，并附上关于其字面含义的简短说明。' ,
  'zh-TW': '摘錄文本片段，並附上關於其字面含義的簡短說明。',
  ko: "문자 그대로의 의미에 대한 간략한 설명과 함께 텍스트의 일부를 재현합니다.",
  ja: "テキストの断片を、文字通りの意味についての簡単な説明とともに再掲します。", },
    ],
  },
  {
    id: 'C3',
    name: { es: 'Vocabulario específico', en: 'Subject vocabulary', 'zh-CN': '学科词汇' ,
  'zh-TW': '學科詞彙',
  ko: "주제어휘",
  ja: "主題の語彙", },
    description: { es: 'Manejo de la terminología propia de la materia.', en: 'Command of the terminology proper to the subject.', 'zh-CN': '对学科专业术语的运用。' ,
  'zh-TW': '對學科專業術語的運用。',
  ko: "주제에 적합한 용어의 명령.",
  ja: "主題に応じた専門用語の管理。", },
    weight: 25,
    cells: [
      { es: 'Emplea con precisión los términos propios de la disciplina y aclara su significado cuando el contexto lo requiere.', en: 'Uses the discipline’s own terms precisely and clarifies their meaning when the context calls for it.', 'zh-CN': '准确使用学科术语，并在语境需要时说明其含义。' ,
  'zh-TW': '準確使用學科術語，並在語境需要時說明其含義。',
  ko: "해당 분야의 용어를 정확하게 사용하고 상황에 따라 그 의미를 명확히 합니다.",
  ja: "専門分野独自の用語を正確に使用し、文脈に応じてその意味を明確にします。", },
      { es: 'Utiliza terminología ajustada al tema tratado, con un manejo solvente de los conceptos fundamentales.', en: 'Uses terminology suited to the topic, handling the fundamental concepts confidently.', 'zh-CN': '使用与主题相符的术语，对基本概念的掌握较为熟练。' ,
  'zh-TW': '使用與主題相符的術語，對基本概念的掌握較為熟練。',
  ko: "주제에 적합한 용어를 사용하여 기본 개념을 자신있게 처리합니다.",
  ja: "トピックに適した用語を使用し、基本的な概念を自信を持って扱います。", },
      { es: 'Recurre a un léxico general salpicado de algunos términos técnicos aplicados de manera desigual.', en: 'Falls back on general wording sprinkled with technical terms applied unevenly.', 'zh-CN': '多用一般性词汇，夹杂若干运用不够一致的术语。' ,
  'zh-TW': '多用一般性詞彙，夾雜若干運用不夠一致的術語。',
  ko: "고르지 않게 적용된 기술 용어가 뿌려진 일반적인 표현으로 대체됩니다.",
  ja: "不均等に適用された専門用語が散りばめられた一般的な表現に頼っています。", },
      { es: 'Expresa las ideas mediante vocabulario cotidiano, apoyándose en expresiones tomadas del enunciado.', en: 'Expresses the ideas in everyday wording, leaning on phrases lifted from the prompt.', 'zh-CN': '用日常词汇表达观点，并借用题目中的表述。' ,
  'zh-TW': '用日常詞彙表達觀點，並借用題目中的表述。',
  ko: "프롬프트에서 나온 문구에 의지하여 아이디어를 일상적인 표현으로 표현합니다.",
  ja: "プロンプトから抜粋したフレーズを基に、日常的な言葉遣いでアイデアを表現します。", },
    ],
  },
  {
    id: 'C4',
    name: { es: 'Claridad expositiva', en: 'Clarity of exposition', 'zh-CN': '表达清晰度' ,
  'zh-TW': '表達清晰度',
  ko: "설명의 명확성",
  ja: "説明の明瞭さ", },
    description: { es: 'Organización del escrito y progresión del razonamiento.', en: 'How the writing is organised and the reasoning progresses.', 'zh-CN': '文章的组织与论证的推进。' ,
  'zh-TW': '文章的組織與論證的推進。',
  ko: "글이 어떻게 구성되고 추론이 진행되는지.",
  ja: "文章の構成と推論の進み方。", },
    weight: 15,
    cells: [
      { es: 'Organiza el escrito en párrafos progresivos que guían la lectura hasta una conclusión bien delimitada.', en: 'Organises the writing into progressive paragraphs that guide the reader to a clearly bounded conclusion.', 'zh-CN': '以层层递进的段落组织文章，引导读者走向明确的结论。' ,
  'zh-TW': '以層層遞進的段落組織文章，引導讀者走向明確的結論。',
  ko: "독자가 명확한 결론에 도달하도록 안내하는 점진적인 단락으로 글을 구성합니다.",
  ja: "文章を段階的に段落にまとめて、明確に区切られた結論に読者を導きます。", },
      { es: 'Presenta un discurso ordenado, con transiciones que permiten seguir el hilo del razonamiento.', en: 'Presents an ordered account, with transitions that let the reader follow the thread of the reasoning.', 'zh-CN': '行文有条理，过渡自然，便于读者跟上论证思路。' ,
  'zh-TW': '行文有條理，過渡自然，便於讀者跟上論證思路。',
  ko: "독자가 추론의 흐름을 따라갈 수 있도록 전환과 함께 순서가 지정된 설명을 제시합니다.",
  ja: "読者が推論の流れをたどることができる遷移を備えた、順序付けられた説明が表示されます。", },
      { es: 'Desarrolla el comentario de forma lineal, con párrafos desiguales y un cierre escueto.', en: 'Develops the commentary linearly, with uneven paragraphs and a terse ending.', 'zh-CN': '以线性方式展开评析，段落长短不一，结尾简略。' ,
  'zh-TW': '以線性方式展開評析，段落長短不一，結尾簡略。',
  ko: "고르지 못한 단락과 간결한 결말을 사용하여 해설을 선형적으로 전개합니다.",
  ja: "解説は直線的に展開され、段落は不均等で、結末は簡潔です。", },
      { es: 'Enlaza las observaciones de manera sucesiva, dejando el cierre implícito para el lector.', en: 'Strings the observations together in sequence, leaving the ending implicit for the reader.', 'zh-CN': '将各项观察依次罗列，结尾留给读者自行体会。' ,
  'zh-TW': '將各項觀察依次羅列，結尾留給讀者自行體會。',
  ko: "관찰 내용을 순서대로 연결하여 독자에게 암시적인 결말을 남깁니다.",
  ja: "観察を順番につなぎ合わせて、結末を読者に暗黙的に残します。", },
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
    name: { es: 'Pruebas escritas', en: 'Written tests', 'zh-CN': '笔试' ,
  'zh-TW': '筆試',
  ko: "필기 시험",
  ja: "筆記試験", },
    kind: 'block', weight: 50, weightAlt: 70, aggregation: 'weighted', entryMode: 'numeric', maxPoints: 10,
    isMandatory: 1, minToAverage: 0.35,
    children: [
      { id: 'demo-teaching-item-exam-unit3', name: { es: 'Examen de la unidad 3', en: 'Unit 3 exam', 'zh-CN': '第三单元考试' ,
  'zh-TW': '第三單元考試',
  ko: "3단원 시험",
  ja: "ユニット3の試験", }, kind: 'activity', weight: 60, weightAlt: 60, aggregation: 'weighted', entryMode: 'numeric', maxPoints: 10, isMandatory: 0, minToAverage: null, sourceExamId: ID.exam },
      { id: 'demo-teaching-item-maps', name: { es: 'Prueba de mapas', en: 'Map test', 'zh-CN': '地图测验' ,
  'zh-TW': '地圖測驗',
  ko: "지도 테스트",
  ja: "マップテスト", }, kind: 'activity', weight: 40, weightAlt: 40, aggregation: 'weighted', entryMode: 'numeric', maxPoints: 10, isMandatory: 0, minToAverage: null },
    ],
  },
  {
    id: 'demo-teaching-item-commentary',
    name: { es: 'Comentario de texto', en: 'Source commentary', 'zh-CN': '文本评析' ,
  'zh-TW': '文本評析',
  ko: "소스 해설",
  ja: "出典解説", },
    kind: 'block', weight: 30, weightAlt: 30, aggregation: 'weighted', entryMode: 'numeric', maxPoints: 10,
    isMandatory: 0, minToAverage: null,
    children: [
      { id: 'demo-teaching-item-commentary-guided', name: { es: 'Comentario guiado', en: 'Guided commentary', 'zh-CN': '引导式文本评析' ,
  'zh-TW': '引導式文本評析',
  ko: "해설 안내",
  ja: "ガイド付き解説", }, kind: 'activity', weight: 100, weightAlt: 100, aggregation: 'weighted', entryMode: 'rubric', maxPoints: 10, isMandatory: 0, minToAverage: null, sourceRubricId: ID.rubric },
    ],
  },
  {
    id: 'demo-teaching-item-classwork',
    name: { es: 'Trabajo de aula', en: 'Classwork', 'zh-CN': '课堂作业' ,
  'zh-TW': '課堂作業',
  ko: "수업 내용",
  ja: "授業", },
    kind: 'block', weight: 20, weightAlt: 0, aggregation: 'weighted', entryMode: 'numeric', maxPoints: 10,
    isMandatory: 0, minToAverage: null,
    children: [
      { id: 'demo-teaching-item-notebook', name: { es: 'Cuaderno de clase', en: 'Class notebook', 'zh-CN': '课堂笔记本' ,
  'zh-TW': '課堂筆記本',
  ko: "수업용 전자 필기장",
  ja: "授業ノート", }, kind: 'activity', weight: 50, weightAlt: 0, aggregation: 'weighted', entryMode: 'numeric', maxPoints: 10, isMandatory: 0, minToAverage: null },
      { id: 'demo-teaching-item-participation', name: { es: 'Participación argumentada', en: 'Reasoned participation', 'zh-CN': '有论据的课堂参与' ,
  'zh-TW': '有論據的課堂參與',
  ko: "합리적인 참여",
  ja: "合理的な参加", }, kind: 'activity', weight: 50, weightAlt: 0, aggregation: 'weighted', entryMode: 'numeric', maxPoints: 10, isMandatory: 0, minToAverage: null },
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
  // The seeder speaks the interface language; prompts speak the prompt union, where the
  // two Chinese scripts are `zh-Hans` / `zh-Hant` rather than the interface's zh-CN / zh-TW.
  const promptL = L === 'zh-CN' ? 'zh-Hans' : L === 'zh-TW' ? 'zh-Hant' : L;
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
        pick({ es: '3.º ESO · Geografía e Historia', en: 'Year 9 · Geography and History', 'zh-CN': '初三 · 地理与历史' ,
  'zh-TW': '初三 · 地理與歷史',
  ko: "9학년 · 지리와 역사",
  ja: "9年生 · 地理と歴史", }),
        pick({ es: 'Curso de ejemplo para explorar el vault de docencia.', en: 'Sample course for exploring the teaching vault.', 'zh-CN': '用于探索教学资料库的示例课程。' ,
  'zh-TW': '用於探索教學資料庫的示例課程。',
  ko: "Teaching Vault를 탐색하기 위한 샘플 코스입니다.",
  ja: "教育用ボールトを探索するためのサンプルコース。", }),
        '#ea580c', 'graduation', 1, 0, ID.academicYear, createdAt, updatedAt);

    const insertSubject = db.prepare(`INSERT INTO study_subjects
      (id,short_id,course_id,name,description,color,icon,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    insertSubject.run(ID.subjectHistory, 'SUB-DOC1', ID.course,
      pick({ es: 'Historia', en: 'History', 'zh-CN': '历史' ,
  'zh-TW': '歷史',
  ko: "역사",
  ja: "歴史", }),
      pick({ es: 'Del Antiguo Régimen a la sociedad industrial.', en: 'From the Ancien Régime to industrial society.', 'zh-CN': '从旧制度到工业社会。' ,
  'zh-TW': '從舊制度到工業社會。',
  ko: "앙시앙 레짐(Ancien Régime)에서 산업 사회까지.",
  ja: "アンシャン・レジームから産業社会へ。", }),
      '#ea580c', 'book', 1, 0, createdAt, updatedAt);
    insertSubject.run(ID.subjectGeography, 'SUB-DOC2', ID.course,
      pick({ es: 'Geografía', en: 'Geography', 'zh-CN': '地理' ,
  'zh-TW': '地理',
  ko: "지리학",
  ja: "地理", }),
      pick({ es: 'Población, territorio y actividad económica.', en: 'Population, territory and economic activity.', 'zh-CN': '人口、领土与经济活动。' ,
  'zh-TW': '人口、領土與經濟活動。',
  ko: "인구, 영토 및 경제 활동.",
  ja: "人口、領土、経済活動。", }),
      '#c2410c', 'map', 0, 1, createdAt, updatedAt);

    db.prepare(`INSERT INTO study_folders
      (id,short_id,course_id,subject_id,name,description,color,icon,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.folder, 'FLD-DOC1', ID.course, ID.subjectHistory,
        pick({ es: 'Unidad 3 · La revolución industrial', en: 'Unit 3 · The industrial revolution', 'zh-CN': '第三单元 · 工业革命' ,
  'zh-TW': '第三單元 · 工業革命',
  ko: "3단원 · 산업혁명",
  ja: "ユニット3 · 産業革命", }),
        pick({ es: 'Programación, materiales y evaluación de la unidad.', en: 'Planning, materials and assessment for the unit.', 'zh-CN': '本单元的课程规划、材料与评估。' ,
  'zh-TW': '本單元的課程規劃、材料與評估。',
  ko: "단위에 대한 계획, 재료 및 평가.",
  ja: "ユニットの計画、資料、評価。", }),
        '#ea580c', 'folder', 1, 0, createdAt, updatedAt);

    const insertTopic = db.prepare(`INSERT INTO study_topics
      (id,short_id,subject_id,folder_id,parent_id,name,description,color,icon,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insertTopic.run(ID.topicSources, 'TOP-DOC1', ID.subjectHistory, ID.folder, null,
      pick({ es: 'Comentario de fuentes', en: 'Working with sources', 'zh-CN': '史料解读' ,
  'zh-TW': '史料解讀',
  ko: "소스 작업",
  ja: "ソースの操作", }),
      pick({ es: 'Método de comentario de textos históricos.', en: 'Method for commenting on historical texts.', 'zh-CN': '历史文本的评析方法。' ,
  'zh-TW': '歷史文本的評析方法。',
  ko: "역사적 텍스트에 대한 논평 방법.",
  ja: "歴史的文書にコメントする方法。", }),
      '#fb923c', 'notebook', 1, 0, createdAt, updatedAt);
    insertTopic.run(ID.topicIndustrial, 'TOP-DOC2', ID.subjectHistory, ID.folder, null,
      pick({ es: 'Industrialización y sociedad', en: 'Industrialisation and society', 'zh-CN': '工业化与社会' ,
  'zh-TW': '工業化與社會',
  ko: "산업화와 사회",
  ja: "工業化と社会", }),
      pick({ es: 'Transformaciones económicas y sus efectos sociales.', en: 'Economic change and its social effects.', 'zh-CN': '经济变革及其社会影响。' ,
  'zh-TW': '經濟變革及其社會影響。',
  ko: "경제적 변화와 사회적 영향.",
  ja: "経済変化とその社会的影響。", }),
      '#f97316', 'layers', 0, 1, createdAt, updatedAt);

    const insertDoc = db.prepare(`INSERT INTO study_docs
      (id,short_id,title,kind,content_markdown,description,color,icon,favorite,pinned,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insertDoc.run(ID.docPlan, 'DOC-DOC1',
      pick({ es: 'Unidad 3 · guion de sesiones', en: 'Unit 3 · session outline', 'zh-CN': '第三单元 · 课时纲要' ,
  'zh-TW': '第三單元 · 課時綱要',
  ko: "3단원 · 세션 개요",
  ja: "ユニット3・セッション概要", }), 'apunte',
      pick({
        es: '# Unidad 3 · La revolución industrial\n\n## Sesiones\n\n1. Punto de partida: la sociedad agraria.\n2. Innovación técnica y fábrica.\n3. Comentario de texto guiado.\n4. Efectos sociales y movimiento obrero.\n5. Prueba escrita.\n\n## Evaluación\n\nLa nota se reparte entre pruebas escritas (50 %), comentario de texto (30 %) y trabajo de aula (20 %).',
        en: '# Unit 3 · The industrial revolution\n\n## Sessions\n\n1. Starting point: agrarian society.\n2. Technical innovation and the factory.\n3. Guided source commentary.\n4. Social effects and the labour movement.\n5. Written test.\n\n## Assessment\n\nThe mark splits between written tests (50 %), source commentary (30 %) and classwork (20 %).',
        'zh-CN': '# 第三单元 · 工业革命\n\n## 课时\n\n1. 起点：农业社会。\n2. 技术创新与工厂。\n3. 引导式文本评析。\n4. 社会影响与工人运动。\n5. 笔试。\n\n## 评估\n\n成绩由笔试（50 %）、文本评析（30 %）和课堂作业（20 %）构成。',
        'zh-TW': '# 第三單元 · 工業革命\n\n## 課時\n\n1. 起點：農業社會。\n2. 技術創新與工廠。\n3. 引導式文本評析。\n4. 社會影響與工人運動。\n5. 筆試。\n\n## 評估\n\n成績由筆試（50 %）、文本評析（30 %）和課堂作業（20 %）構成。',
        ko: "# 3과 · 산업혁명\n\n## 세션\n\n1. 출발점: 농업 사회.\n2. 기술 혁신과 공장.\n3. 안내된 소스 해설.\n4. 사회적 효과와 노동운동.\n5. 필기시험.\n\n## 평가\n\n점수는 필기 시험(50%), 원본 해설(30%), 수업 과제(20%)로 나뉩니다.",
        ja: "#ユニット3・産業革命\n\n## セッション1. 出発点：農耕社会。\n2. 技術革新と工場。\n3. ガイド付きソースの解説。\n4. 社会的影響と労働運動。\n5. 筆記試験。\n\n## 評価\n\n得点は筆記試験 (50 %)、原典の解説 (30 %)、授業 (20 %) に分割されます。",
      }),
      pick({ es: 'Guion de la unidad, editable como cualquier apunte.', en: 'Unit outline, editable like any note.', 'zh-CN': '单元纲要，可像普通笔记一样编辑。' ,
  'zh-TW': '單元綱要，可像普通筆記一樣編輯。',
  ko: "모든 메모처럼 편집 가능한 단위 개요입니다.",
  ja: "ユニットの概要。他のメモと同様に編集可能。", }),
      '#ea580c', 'notebook', 1, 1, 0, createdAt, updatedAt);
    insertDoc.run(ID.docCommentary, 'DOC-DOC2',
      pick({ es: 'Cómo comentar un texto histórico', en: 'How to comment on a historical text', 'zh-CN': '如何评析历史文本' ,
  'zh-TW': '如何評析歷史文本',
  ko: "역사적 텍스트에 대해 논평하는 방법",
  ja: "歴史的文書にコメントする方法", }), 'manual',
      pick({
        es: '# Comentario de texto histórico\n\n## Pasos\n\n1. Clasificar el documento: naturaleza, autoría, destinatario y fecha.\n2. Contextualizar el momento en que se escribe.\n3. Analizar las ideas y ordenarlas.\n4. Cerrar con una valoración razonada.\n\n> El comentario se evalúa con la rúbrica de la unidad.',
        en: '# Historical source commentary\n\n## Steps\n\n1. Classify the document: nature, authorship, audience and date.\n2. Set out the moment in which it was written.\n3. Analyse the ideas and order them.\n4. Close with a reasoned appraisal.\n\n> The commentary is marked with the unit rubric.',
        'zh-CN': '# 历史文本评析\n\n## 步骤\n\n1. 判定文献：类别、作者、受众与日期。\n2. 交代其撰写的历史背景。\n3. 分析观点并加以梳理。\n4. 以有理有据的评价收尾。\n\n> 评析依据本单元的评分标准进行评定。',
        'zh-TW': '# 歷史文本評析\n\n## 步驟\n\n1. 判定文獻：類別、作者、受眾與日期。\n2. 交代其撰寫的歷史背景。\n3. 分析觀點並加以梳理。\n4. 以有理有據的評價收尾。\n\n> 評析依據本單元的評分標準進行評定。',
        ko: "# 역사적 자료 해설\n\n## 단계\n\n1. 문서를 분류합니다: 성격, 저자, 대상, 날짜.\n2. 그것이 쓰여진 순간을 설명하십시오.\n3. 아이디어를 분석하고 주문하세요.\n4. 합리적인 평가로 마무리하세요.\n\n> 해설은 단위 루브릭으로 표시됩니다.",
        ja: "# 史料解説\n\n## ステップ1. 文書を分類します: 性質、作成者、対象者、日付。\n2. それが書かれた瞬間を記録します。\n3. アイデアを分析し、順序付けします。\n4. 根拠のある評価で締めくくります。\n\n> 解説には単元ルーブリックが付いています。",
      }),
      pick({ es: 'Material que se entrega al alumnado antes del comentario.', en: 'Handout given to students before the commentary.', 'zh-CN': '在评析之前发给学生的材料。' ,
  'zh-TW': '在評析之前發給學生的材料。',
  ko: "해설 전에 학생들에게 나눠준 유인물.",
  ja: "解説の前に生徒たちに配布されたプリント。", }),
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
      'zh-TW': '# 史料 · 工廠勞動調查報告（1832）\n\n「孩子們天不亮就進工廠，出來時天已經黑了。空氣中瀰漫著棉塵，噪音讓人無法交談。」\n\n## 評析要點\n\n- 作者是誰？意圖何在？\n- 文中描述了勞動的哪些變化？\n',
      ko: "# 출처 · 공장 노동에 관한 보고서(1832)\n\n\"아이들은 동이 트기 전에 방앗간에 들어와 어두워지면 떠납니다. 공기는 솜 먼지로 가득하고 소음으로 인해 대화가 불가능합니다.\"\n\n## 해설을 위해\n\n- 누가, 어떤 목적으로 글을 쓰고 있나요?\n- 직장 생활의 어떤 변화를 설명하는가?",
      ja: "# 出典 · 工場労働に関する報告書 (1832年)\n\n「子供たちは夜明け前に工場に入り、もう暗くなってから出ていきます。空気は綿埃で厚く、騒音で会話は不可能です。」\n\n## コメント用\n\n- 誰が何の目的で書いているのですか？\n- それは労働生活におけるどのような変化を表していますか?",
    });
    const materialBlob = Buffer.from(materialText, 'utf8');
    db.prepare(`INSERT INTO study_materials
      (id,short_id,title,description,file_name,mime_type,extension,content_blob,content_hash,extracted_text,extraction_status,metadata_json,bibliography_json,read_state,size_bytes,favorite,pinned,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.material, 'MAT-DOC1',
        pick({ es: 'Fuente · Informe fabril (1832)', en: 'Source · Factory report (1832)', 'zh-CN': '史料 · 工厂报告（1832）' ,
  'zh-TW': '史料 · 工廠報告（1832）',
  ko: "출처·공장보고서(1832)",
  ja: "出典・工場報告書（1832年）", }),
        pick({ es: 'Texto que se comenta en la sesión 3 y se evalúa con la rúbrica.', en: 'Text commented on in session 3 and marked with the rubric.', 'zh-CN': '在第 3 课时评析并用评分标准评定的文本。' ,
  'zh-TW': '在第 3 課時評析並用評分標準評定的文本。',
  ko: "세션 3에서 댓글을 달고 루브릭으로 표시된 텍스트입니다.",
  ja: "テキストはセッション3でコメントされ、ルーブリックが付けられています。", }),
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
        pick({ es: 'Sesión 3 · comentario guiado', en: 'Session 3 · guided commentary', 'zh-CN': '第 3 课时 · 引导式评析' ,
  'zh-TW': '第 3 課時 · 引導式評析',
  ko: "세션 3 · 해설 안내",
  ja: "セッション3 · ガイド付き解説", }),
        'sesion-3-demo.wav', 'audio/wav', audioBlob, 'demo-teaching-recording-v1', 2, audioBlob.length, promptL,
        ID.course, ID.subjectHistory, ID.topicSources, ID.docCommentary, ID.material,
        pick({ es: 'Sesión 3', en: 'Session 3', 'zh-CN': '第 3 课时' ,
  'zh-TW': '第 3 課時',
  ko: "세션 3",
  ja: "セッション3", }), 'ready', 1, 0, 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_transcripts
      (id,short_id,recording_id,kind,content_markdown,language,status,progress,version_no,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.transcript, 'TRN-DOC1', ID.recording, 'literal',
        pick({ es: 'Antes de analizar el contenido conviene clasificar el documento: quién lo escribe, para quién y cuándo.', en: 'Before analysing the content it helps to classify the document: who wrote it, for whom, and when.', 'zh-CN': '在分析内容之前，宜先判定文献：何人撰写、写给谁、何时写成。' ,
  'zh-TW': '在分析內容之前，宜先判定文獻：何人撰寫、寫給誰、何時寫成。',
  ko: "내용을 분석하기 전에 문서를 누가, 누구를 위해, 언제 작성했는지 분류하는 것이 도움이 됩니다.",
  ja: "内容を分析する前に、誰が、誰のために、いつ書いたかなど、文書を分類するのに役立ちます。", }),
        promptL, 'ready', 1, 1, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_transcript_segments
      (id,short_id,transcript_id,t_start,t_end,text,speaker,confidence,chapter,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.transcriptSegment, 'TSG-DOC1', ID.transcript, 0, 2,
        pick({ es: 'Clasificar el documento antes de analizarlo.', en: 'Classify the document before analysing it.', 'zh-CN': '先判定文献，再分析内容。' ,
  'zh-TW': '先判定文獻，再分析內容。',
  ko: "문서를 분석하기 전에 문서를 분류하세요.",
  ja: "文書を分析する前に分類します。", }),
        pick({ es: 'Docente', en: 'Teacher', 'zh-CN': '教师' ,
  'zh-TW': '教師',
  ko: "선생님",
  ja: "教師", }), 0.97,
        pick({ es: 'Método', en: 'Method', 'zh-CN': '方法' ,
  'zh-TW': '方法',
  ko: "방법",
  ja: "方法", }), 0, createdAt, updatedAt);

    // ── Question bank ────────────────────────────────────────────────────────
    db.prepare(`INSERT INTO study_questions
      (id,short_id,prompt,question_type,difficulty,cognitive_level,status,answer_json,options_json,explanation,tags_json,course_id,subject_id,topic_id,document_id,source_title,source_excerpt,source_location_json,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.question, 'QUE-DOC1',
        pick({ es: '¿Qué innovación permitió liberar a la industria de la energía hidráulica?', en: 'Which innovation freed industry from water power?', 'zh-CN': '哪项创新让工业摆脱了对水力的依赖？' ,
  'zh-TW': '哪項創新讓工業擺脫了對水力的依賴？',
  ko: "수력 발전으로부터 산업을 해방시킨 혁신은 무엇입니까?",
  ja: "産業を水力から解放したイノベーションはどれですか?", }),
        'single_choice', 'medium', 'understand', 'approved',
        JSON.stringify({ value: pick({ es: 'La máquina de vapor', en: 'The steam engine', 'zh-CN': '蒸汽机' ,
  'zh-TW': '蒸汽機',
  ko: "증기 기관",
  ja: "蒸気機関", }) }),
        JSON.stringify(L === 'es'
          ? ['El telar manual', 'La máquina de vapor', 'La rueda hidráulica', 'El horno de leña']
          : L === 'zh-CN'
            ? ['手动织布机', '蒸汽机', '水车', '燃木炉']
            : ['The handloom', 'The steam engine', 'The water wheel', 'The wood-fired furnace']),
        pick({ es: 'El vapor permitió situar las fábricas lejos de los cursos de agua.', en: 'Steam let factories be sited away from watercourses.', 'zh-CN': '蒸汽让工厂可以远离河道选址。' ,
  'zh-TW': '蒸汽讓工廠可以遠離河道選址。',
  ko: "증기로 인해 공장은 수로에서 멀리 떨어진 곳에 위치하게 됩니다.",
  ja: "蒸気のおかげで工場を水路から離れた場所に設置できます。", }),
        JSON.stringify(['industrialización', 'técnica']),
        ID.course, ID.subjectHistory, ID.topicIndustrial, ID.docPlan,
        pick({ es: 'Unidad 3 · guion de sesiones', en: 'Unit 3 · session outline', 'zh-CN': '第三单元 · 课时纲要' ,
  'zh-TW': '第三單元 · 課時綱要',
  ko: "3단원 · 세션 개요",
  ja: "ユニット3・セッション概要", }),
        pick({ es: 'Innovación técnica y fábrica.', en: 'Technical innovation and the factory.', 'zh-CN': '技术创新与工厂。' ,
  'zh-TW': '技術創新與工廠。',
  ko: "기술 혁신과 공장.",
  ja: "技術革新と工場。", }),
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
        label: { es: 'Máquina de vapor', en: 'Steam engine', 'zh-CN': '蒸汽机' ,
  'zh-TW': '蒸汽機',
  ko: "증기기관",
  ja: "蒸気機関", },
        statement: {
          es: 'La máquina de vapor libera a la fábrica de los cursos de agua y permite situarla junto a la mina o la ciudad.',
          en: 'The steam engine frees the factory from watercourses and lets it sit next to the mine or the city.',
          'zh-CN': '蒸汽机使工厂摆脱河道束缚，可以建在矿场或城市附近。',
          'zh-TW': '蒸汽機使工廠擺脫河道束縛，可以建在礦場或城市附近。',
          ko: "증기기관 덕분에 공장은 수로에서 벗어나 광산이나 도시 옆에 자리잡게 되었습니다.",
          ja: "蒸気エンジンは工場を水路から解放し、鉱山や都市の隣に置くことができます。",
        },
      },
      {
        id: ID.ideaFactory, type: 'concept',
        label: { es: 'Sistema fabril', en: 'Factory system', 'zh-CN': '工厂制度' ,
  'zh-TW': '工廠制度',
  ko: "공장 시스템",
  ja: "工場システム", },
        statement: {
          es: 'La producción se concentra en la fábrica, con maquinaria, división del trabajo y un horario impuesto.',
          en: 'Production concentrates in the factory, with machinery, division of labour and an imposed timetable.',
          'zh-CN': '生产集中于工厂，配备机器、分工和强制工时。',
          'zh-TW': '生產集中於工廠，配備機器、分工和強制工時。',
          ko: "생산은 기계, 노동 분업 및 정해진 시간표를 통해 공장에 집중됩니다.",
          ja: "生産は工場に集中しており、機械が使用され、分業され、スケジュールが課せられています。",
        },
      },
      {
        id: ID.ideaChildLabour, type: 'consequence',
        label: { es: 'Trabajo infantil', en: 'Child labour', 'zh-CN': '童工' ,
  'zh-TW': '童工',
  ko: "아동 노동",
  ja: "児童労働", },
        statement: {
          es: 'Las jornadas descritas en los informes fabriles incluyen menores desde antes del amanecer hasta la noche.',
          en: 'The working days described in the factory reports include children from before dawn until night.',
          'zh-CN': '工厂报告描述的工时中，未成年人从天不亮一直工作到夜晚。',
          'zh-TW': '工廠報告描述的工時中，未成年人從天不亮一直工作到夜晚。',
          ko: "공장 보고서에 설명된 근무일에는 새벽부터 밤까지 어린이가 포함됩니다.",
          ja: "工場報告書に記載されている勤務時間には、未明から夜間までの児童も含まれます。",
        },
      },
      {
        id: ID.ideaLabour, type: 'process',
        label: { es: 'Movimiento obrero', en: 'Labour movement', 'zh-CN': '工人运动' ,
  'zh-TW': '工人運動',
  ko: "노동운동",
  ja: "労働運動", },
        statement: {
          es: 'Las condiciones de la fábrica dan origen a formas de organización obrera y a las primeras leyes laborales.',
          en: 'Factory conditions give rise to forms of worker organisation and to the first labour laws.',
          'zh-CN': '工厂的条件催生了工人组织形式和最早的劳动法。',
          'zh-TW': '工廠的條件催生了工人組織形式和最早的勞動法。',
          ko: "공장 조건은 노동자 조직의 형태와 최초의 노동법을 낳는다.",
          ja: "工場の状況は、労働者組織の形態と最初の労働法を生み出します。",
        },
      },
      {
        id: ID.ideaCriticism, type: 'principle',
        label: { es: 'Crítica de fuentes', en: 'Source criticism', 'zh-CN': '史料批判' ,
  'zh-TW': '史料批判',
  ko: "소스 비평",
  ja: "情報源の批判", },
        statement: {
          es: 'Antes de analizar el contenido hay que clasificar el documento: quién escribe, para quién, cuándo y con qué intención.',
          en: 'Before analysing the content the document must be classified: who writes, for whom, when and to what end.',
          'zh-CN': '分析内容之前必须先判定文献：何人撰写、写给谁、何时写成、意图何在。',
          'zh-TW': '分析內容之前必須先判定文獻：何人撰寫、寫給誰、何時寫成、意圖何在。',
          ko: "내용을 분석하기 전에 문서는 누가, 누구를 위해, 언제, 무엇을 위해 작성하는지 분류해야 합니다.",
          ja: "内容を分析する前に、誰が、誰のために、いつ、どの目的で書いたのかを文書を分類する必要があります。",
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
        title: { es: 'Unidad 3 · guion de sesiones', en: 'Unit 3 · session outline', 'zh-CN': '第三单元 · 课时纲要' ,
  'zh-TW': '第三單元 · 課時綱要',
  ko: "3단원 · 세션 개요",
  ja: "ユニット3・セッション概要", },
        quote: { es: 'Innovación técnica y fábrica.', en: 'Technical innovation and the factory.', 'zh-CN': '技术创新与工厂。' ,
  'zh-TW': '技術創新與工廠。',
  ko: "기술 혁신과 공장.",
  ja: "技術革新と工場。", },
      },
      {
        ideaId: ID.ideaFactory, kind: 'document', sourceId: ID.docPlan, hash: 'demo-teaching-doc-plan-v1',
        title: { es: 'Unidad 3 · guion de sesiones', en: 'Unit 3 · session outline', 'zh-CN': '第三单元 · 课时纲要' ,
  'zh-TW': '第三單元 · 課時綱要',
  ko: "3단원 · 세션 개요",
  ja: "ユニット3・セッション概要", },
        quote: { es: 'Punto de partida: la sociedad agraria.', en: 'Starting point: agrarian society.', 'zh-CN': '起点：农业社会。' ,
  'zh-TW': '起點：農業社會。',
  ko: "출발점: 농업 사회.",
  ja: "出発点は農耕社会。", },
      },
      {
        ideaId: ID.ideaChildLabour, kind: 'material', sourceId: ID.material, hash: 'demo-teaching-material-v1',
        title: { es: 'Fuente · Informe fabril (1832)', en: 'Source · Factory report (1832)', 'zh-CN': '史料 · 工厂报告（1832）' ,
  'zh-TW': '史料 · 工廠報告（1832）',
  ko: "출처·공장보고서(1832)",
  ja: "出典・工場報告書（1832年）", },
        quote: {
          es: 'Los niños entran en la fábrica antes del amanecer y salen cuando ya ha oscurecido.',
          en: 'The children enter the mill before daybreak and leave when it is already dark.',
          'zh-CN': '孩子们天不亮就进工厂，出来时天已经黑了。',
          'zh-TW': '孩子們天不亮就進工廠，出來時天已經黑了。',
          ko: "아이들은 동이 트기 전에 물방앗간으로 들어갔다가 어두워지면 떠난다.",
          ja: "子どもたちは夜明け前に工場に入り、暗くなると工場を出ます。",
        },
      },
      {
        ideaId: ID.ideaLabour, kind: 'document', sourceId: ID.docPlan, hash: 'demo-teaching-doc-plan-v1',
        title: { es: 'Unidad 3 · guion de sesiones', en: 'Unit 3 · session outline', 'zh-CN': '第三单元 · 课时纲要' ,
  'zh-TW': '第三單元 · 課時綱要',
  ko: "3단원 · 세션 개요",
  ja: "ユニット3・セッション概要", },
        quote: { es: 'Efectos sociales y movimiento obrero.', en: 'Social effects and the labour movement.', 'zh-CN': '社会影响与工人运动。' ,
  'zh-TW': '社會影響與工人運動。',
  ko: "사회적 효과와 노동운동.",
  ja: "社会的影響と労働運動。", },
      },
      {
        ideaId: ID.ideaCriticism, kind: 'document', sourceId: ID.docCommentary, hash: 'demo-teaching-doc-commentary-v1',
        title: { es: 'Cómo comentar un texto histórico', en: 'How to comment on a historical text', 'zh-CN': '如何评析历史文本' ,
  'zh-TW': '如何評析歷史文本',
  ko: "역사적 텍스트에 대해 논평하는 방법",
  ja: "歴史的文書にコメントする方法", },
        quote: {
          es: 'Clasificar el documento: naturaleza, autoría, destinatario y fecha.',
          en: 'Classify the document: nature, authorship, audience and date.',
          'zh-CN': '判定文献：类别、作者、受众与日期。',
          'zh-TW': '判定文獻：類別、作者、受眾與日期。',
          ko: "문서를 분류합니다: 성격, 저자, 대상, 날짜.",
          ja: "文書を性質、作成者、対象者、日付などに分類します。",
        },
      },
    ];
    for (const item of evidence) {
      const occurrenceId = `${item.ideaId}-occurrence`;
      insertOccurrence.run(occurrenceId, item.ideaId, item.kind, item.sourceId, pick(item.title), item.hash, 'principal', 0.93, createdAt, updatedAt);
      insertEvidence.run(`${item.ideaId}-evidence`, occurrenceId, pick(item.quote), pick({ es: 'Material de demostración', en: 'Demo material', 'zh-CN': '演示材料' ,
  'zh-TW': '演示材料',
  ko: "데모 자료",
  ja: "デモ資料", }), 0, createdAt);
    }

    const insertEdge = db.prepare(`INSERT INTO study_idea_edges
      (id,subject_id,from_id,to_id,type,basis,confidence,source_kind,source_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const edges: Array<{ id: string; from: string; to: string; type: string; basis: Localized; confidence: number }> = [
      {
        id: 'demo-teaching-edge-steam-factory', from: ID.ideaSteam, to: ID.ideaFactory, type: 'causes', confidence: 0.94,
        basis: { es: 'La energía de vapor hace posible concentrar la producción en la fábrica.', en: 'Steam power makes it possible to concentrate production in the factory.', 'zh-CN': '蒸汽动力使生产得以集中于工厂。' ,
  'zh-TW': '蒸汽動力使生產得以集中於工廠。',
  ko: "증기력을 사용하면 공장에서 생산을 집중할 수 있습니다.",
  ja: "蒸気の力で工場内での集中生産が可能になります。", },
      },
      {
        id: 'demo-teaching-edge-factory-child', from: ID.ideaFactory, to: ID.ideaChildLabour, type: 'causes', confidence: 0.9,
        basis: { es: 'El horario y la maquinaria de la fábrica explican las jornadas que describe el informe.', en: 'The factory timetable and machinery explain the working days the report describes.', 'zh-CN': '工厂的工时与机器解释了报告所描述的劳动日程。' ,
  'zh-TW': '工廠的工時與機器解釋了報告所描述的勞動日程。',
  ko: "공장 시간표와 기계는 보고서에 설명된 근무일을 설명합니다.",
  ja: "工場の時刻表と機械は、レポートに記載されている稼働日を説明しています。", },
      },
      {
        id: 'demo-teaching-edge-child-labour', from: ID.ideaChildLabour, to: ID.ideaLabour, type: 'causes', confidence: 0.88,
        basis: { es: 'Las condiciones denunciadas están en el origen de la organización obrera.', en: 'The conditions denounced lie behind the rise of worker organisation.', 'zh-CN': '被揭露的恶劣条件是工人组织兴起的原因。' ,
  'zh-TW': '被揭露的惡劣條件是工人組織興起的原因。',
  ko: "비난받은 조건은 노동자 조직의 부상 뒤에 놓여 있다.",
  ja: "労働者組織の台頭の背後には、非難されている状況がある。", },
      },
      {
        id: 'demo-teaching-edge-criticism-child', from: ID.ideaCriticism, to: ID.ideaChildLabour, type: 'applies', confidence: 0.82,
        basis: { es: 'El método de comentario se aplica sobre este informe antes de dar por buenos sus datos.', en: 'The commentary method is applied to this report before its data are taken at face value.', 'zh-CN': '在采信报告数据之前，先对其运用评析方法。' ,
  'zh-TW': '在採信報告資料之前，先對其運用評析方法。',
  ko: "이 보고서는 데이터를 액면 그대로 받아들이기 전에 논평 방법을 적용했습니다.",
  ja: "このレポートには、データが額面通りに解釈される前に、解説手法が適用されます。", },
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
        title: { es: 'Punto de partida: la sociedad agraria', en: 'Starting point: agrarian society', 'zh-CN': '起点：农业社会' ,
  'zh-TW': '起點：農業社會',
  ko: "출발점: 농경사회",
  ja: "出発点：農耕社会", },
        purpose: { es: 'Situar el antes para que el cambio industrial se entienda como ruptura.', en: 'Establish the before so industrial change reads as a break.', 'zh-CN': '先交代此前的状况，使工业变革被理解为一次断裂。' ,
  'zh-TW': '先交代此前的狀況，使工業變革被理解為一次斷裂。',
  ko: "산업 변화가 휴식으로 읽히도록 이전을 확립하십시오.",
  ja: "産業の変化が区切りとなるように、以前を確立します。", },
        body: {
          es: 'Antes de hablar de fábricas conviene fijar el punto de partida: una sociedad en la que la mayoría vive del campo y el trabajo sigue el ritmo de las estaciones. El guion de la unidad abre precisamente ahí',
          en: 'Before talking about factories it helps to fix the starting point: a society where most people live off the land and work follows the rhythm of the seasons. The unit outline opens exactly there',
          'zh-CN': '在谈论工厂之前，宜先明确起点：这是一个多数人靠土地为生、劳作随季节更替的社会。单元纲要正是从这里开始',
          'zh-TW': '在談論工廠之前，宜先明確起點：這是一個多數人靠土地為生、勞作隨季節更替的社會。單元綱要正是從這裡開始',
          ko: "공장에 대해 이야기하기 전에 출발점을 정하는 것이 도움이 됩니다. 대부분의 사람들이 땅에서 생활하고 계절의 리듬을 따르는 사회입니다. 단위 개요가 정확히 거기에서 열립니다.",
          ja: "工場について話す前に、出発点を修正するのに役立ちます。つまり、ほとんどの人が土地で暮らし、季節のリズムに従って働く社会です。ユニットの概要はまさにそこに開きます",
        },
        source: 'doc',
      },
      {
        id: 'u2',
        title: { es: 'La fábrica y el trabajo infantil', en: 'The factory and child labour', 'zh-CN': '工厂与童工' ,
  'zh-TW': '工廠與童工',
  ko: "공장과 아동 노동",
  ja: "工場と児童労働", },
        purpose: { es: 'Trabajar la fuente de 1832 con el método de comentario ya visto.', en: 'Work the 1832 source with the commentary method already covered.', 'zh-CN': '运用已学的评析方法处理 1832 年的史料。' ,
  'zh-TW': '運用已學的評析方法處理 1832 年的史料。',
  ko: "이미 다룬 주석 방법을 사용하여 1832년 소스를 작업합니다.",
  ja: "すでに説明した解説方法を使用して1832年のソースを作業します。", },
        body: {
          es: 'El informe parlamentario describe jornadas que empiezan antes del amanecer y terminan de noche, con polvo de algodón y un ruido que impide hablar',
          en: 'The parliamentary report describes days that begin before dawn and end after dark, with cotton dust and noise that makes talking impossible',
          'zh-CN': '议会报告描述了从天不亮持续到夜晚的工时，空气中弥漫着棉尘，噪音让人无法交谈',
          'zh-TW': '議會報告描述了從天不亮持續到夜晚的工時，空氣中瀰漫著棉塵，噪音讓人無法交談',
          ko: "의회 보고서는 날이 동이 트기 전에 시작하여 어두워진 후에 끝나는 날, 솜 먼지와 소음으로 인해 대화가 불가능하다고 설명합니다.",
          ja: "議会報告書には、綿埃と騒音で会話が不可能な、夜明け前に始まり暗くなって終わる日々が記されている。",
        },
        source: 'material',
      },
      {
        id: 'u3',
        title: { es: 'Del malestar a la organización obrera', en: 'From grievance to worker organisation', 'zh-CN': '从不满到工人组织' ,
  'zh-TW': '從不滿到工人組織',
  ko: "고충처리부터 근로자 조직까지",
  ja: "苦情から労働者組織へ", },
        purpose: { es: 'Cerrar la unidad enlazando las condiciones descritas con sus consecuencias.', en: 'Close the unit by linking the described conditions to their consequences.', 'zh-CN': '收束本单元，将所描述的条件与其后果联系起来。' ,
  'zh-TW': '收束本單元，將所描述的條件與其後果聯絡起來。',
  ko: "설명된 조건을 해당 결과와 연결하여 단원을 닫습니다.",
  ja: "説明された状態をその結果に関連付けてユニットを閉じます。", },
        body: {
          es: 'La última sesión enlaza las condiciones descritas con las primeras formas de organización obrera y con la legislación que las siguió',
          en: 'The last session links the conditions described with the first forms of worker organisation and the legislation that followed',
          'zh-CN': '最后一课时将所描述的条件与最早的工人组织形式及其后的立法联系起来',
          'zh-TW': '最後一課時將所描述的條件與最早的工人組織形式及其後的立法聯絡起來',
          ko: "마지막 세션에서는 설명된 조건을 최초의 노동자 조직 형태와 그에 따른 법안과 연결합니다.",
          ja: "最後のセッションでは、労働者組織の最初の形態で説明された条件とその後の法律を結び付けます。",
        },
        source: 'doc',
      },
    ];
    const unitLink = (source: 'material' | 'doc'): string => (source === 'material'
      ? `[${pick({ es: 'Fuente · Informe fabril (1832)', en: 'Source · Factory report (1832)', 'zh-CN': '史料 · 工厂报告（1832）' ,
  'zh-TW': '史料 · 工廠報告（1832）',
  ko: "출처·공장보고서(1832)",
  ja: "出典・工場報告書（1832年）", })}](nodus://study/material/${ID.material})`
      : `[${pick({ es: 'Unidad 3 · guion de sesiones', en: 'Unit 3 · session outline', 'zh-CN': '第三单元 · 课时纲要' ,
  'zh-TW': '第三單元 · 課時綱要',
  ko: "3단원 · 세션 개요",
  ja: "ユニット3・セッション概要", })}](nodus://study/doc/${ID.docPlan})`);
    const unitTitle = pick({ es: 'Unidad 3 · La revolución industrial', en: 'Unit 3 · The industrial revolution', 'zh-CN': '第三单元 · 工业革命' ,
  'zh-TW': '第三單元 · 工業革命',
  ko: "3단원 · 산업혁명",
  ja: "ユニット3 · 産業革命", });
    const unitBrief = { kind: 'deep_research', objective: pick({ es: 'Diseñar la unidad sobre la revolución industrial para 3.º ESO', en: 'Design the industrial revolution unit for Year 9', 'zh-CN': '为初三设计工业革命单元' ,
  'zh-TW': '為初三設計工業革命單元',
  ko: "9학년을 위한 산업 혁명 유닛 설계",
  ja: "Year 9の産業革命単元を設計する", }), tone: 'academic', language: promptL };
    const unitDraft = {
      generatedAt: updatedAt,
      brief: unitBrief,
      selection: { ideaIds: [ID.ideaFactory, ID.ideaChildLabour], themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: [] },
      title: unitTitle,
      abstract: pick({
        es: 'Tres partes que llevan al alumnado de la sociedad agraria al movimiento obrero pasando por el comentario de una fuente de 1832.',
        en: 'Three parts taking students from agrarian society to the labour movement by way of a commentary on an 1832 source.',
        'zh-CN': '三个部分带领学生从农业社会出发，经由对 1832 年史料的评析，走向工人运动。',
        'zh-TW': '三個部分帶領學生從農業社會出發，經由對 1832 年史料的評析，走向工人運動。',
        ko: "1832년 자료에 대한 논평을 통해 농촌 사회의 학생들을 노동 운동으로 이끄는 세 부분.",
        ja: "1832年の資料の解説を通じて、学生たちを農業社会から労働運動に導く3部構成。",
      }),
      outline: unitSections.map((section) => ({ id: section.id, title: pick(section.title), purpose: pick(section.purpose), keyClaims: [], sources: [unitLink(section.source)] })),
      draftMarkdown: unitSections.map((section) => `## ${pick(section.title)}\n\n${pick(section.body)} ${unitLink(section.source)}.`).join('\n\n'),
      matrix: [],
      bibliography: [pick({ es: 'Fuente · Informe fabril (1832)', en: 'Source · Factory report (1832)', 'zh-CN': '史料 · 工厂报告（1832）' ,
  'zh-TW': '史料 · 工廠報告（1832）',
  ko: "출처·공장보고서(1832)",
  ja: "出典・工場報告書（1832年）", })],
      nextSteps: [pick({ es: 'Evaluar el comentario con la rúbrica de la unidad.', en: 'Mark the commentary with the unit rubric.', 'zh-CN': '依据本单元评分标准评定评析作业。' ,
  'zh-TW': '依據本單元評分標準評定評析作業。',
  ko: "단위 루브릭으로 해설을 표시하세요.",
  ja: "解説に単元のルーブリックを付けます。", })],
      limitations: [pick({ es: 'Los materiales disponibles no cubren el caso español.', en: 'The available materials do not cover the Spanish case.', 'zh-CN': '现有材料未涵盖西班牙的情况。' ,
  'zh-TW': '現有材料未涵蓋西班牙的情況。',
  ko: "사용 가능한 자료는 스페인어 사례를 다루지 않습니다.",
  ja: "利用可能な資料にはスペイン語のケースは含まれていません。", })],
      stats: { selectedIdeas: 2, selectedThemes: 0, selectedGaps: 0, selectedContradictions: 0, selectedWorks: 2, selectedPassages: 0, selectedTutorRoutes: 0, contextChars: 4_200, truncated: false },
    };
    db.prepare('INSERT INTO writing_saved_drafts (id,title,brief_json,selection_json,model_json,draft_json,created_at,updated_at) VALUES (?,?,?,?,NULL,?,?,?)')
      .run(ID.unit, unitTitle, JSON.stringify(unitBrief), JSON.stringify(unitDraft.selection), JSON.stringify(unitDraft), createdAt, updatedAt);

    // ── Timetable and calendar ───────────────────────────────────────────────
    const insertPeriod = db.prepare('INSERT INTO study_schedule_periods (id,section,label,start_time,end_time,position,academic_year_id) VALUES (?,?,?,?,?,?,?)');
    insertPeriod.run(ID.scheduleFirst, 'morning', pick({ es: 'Primera hora', en: 'First period', 'zh-CN': '第一节课' ,
  'zh-TW': '第一節課',
  ko: "첫 번째 기간",
  ja: "第一期", }), '08:30', '09:25', 0, ID.academicYear);
    insertPeriod.run(ID.scheduleThird, 'morning', pick({ es: 'Tercera hora', en: 'Third period', 'zh-CN': '第三节课' ,
  'zh-TW': '第三節課',
  ko: "3교시",
  ja: "第三期", }), '10:20', '11:15', 1, ID.academicYear);
    const insertCell = db.prepare('INSERT INTO study_schedule_cells (day,period_id,subject_id) VALUES (?,?,?)');
    insertCell.run('monday', ID.scheduleFirst, ID.subjectHistory);
    insertCell.run('tuesday', ID.scheduleThird, ID.subjectGeography);
    insertCell.run('thursday', ID.scheduleFirst, ID.subjectHistory);
    insertCell.run('friday', ID.scheduleThird, ID.subjectHistory);

    db.prepare(`INSERT INTO study_plans
      (id,short_id,title,description,course_id,subject_id,exam_at,available_minutes,config_json,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.plan, 'PLN-DOC1',
        pick({ es: 'Cierre de la unidad 3', en: 'Closing unit 3', 'zh-CN': '第三单元收尾' ,
  'zh-TW': '第三單元收尾',
  ko: "폐쇄 장치 3",
  ja: "クロージングユニット3", }),
        pick({ es: 'Sesiones restantes hasta la prueba escrita.', en: 'Sessions left before the written test.', 'zh-CN': '距离笔试剩余的课时。' ,
  'zh-TW': '距離筆試剩餘的課時。',
  ko: "필기 시험 전 남은 세션입니다.",
  ja: "筆記試験前に残ったセッション数。", }),
        ID.course, ID.subjectHistory, examAt, 180, '{}', 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_calendar_events
      (id,short_id,title,event_type,starts_at,all_day,course_id,subject_id,notes,reminder_minutes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.event, 'EVT-DOC1',
        pick({ es: 'Prueba escrita · unidad 3', en: 'Written test · unit 3', 'zh-CN': '笔试 · 第三单元' ,
  'zh-TW': '筆試 · 第三單元',
  ko: "필기시험 · 3단원",
  ja: "筆記試験・単元3", }), 'exam', examAt, 1,
        ID.course, ID.subjectHistory,
        pick({ es: 'Fecha de ejemplo editable.', en: 'Editable sample date.', 'zh-CN': '可编辑的示例日期。' ,
  'zh-TW': '可編輯的示例日期。',
  ko: "편집 가능한 샘플 날짜.",
  ja: "編集可能なサンプルの日付。", }), 1440, createdAt, updatedAt);

    // ── Student group ────────────────────────────────────────────────────────
    db.prepare(`INSERT INTO teaching_groups
      (id,short_id,name,subject_id,academic_year_id,expected_size,position,archived_at,deleted_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?)`)
      .run(ID.group, 'GRP-DOC1', pick({ es: '3.º ESO A', en: 'Year 9 A', 'zh-CN': '初三A班' ,
  'zh-TW': '初三A班',
  ko: "9학년 A",
  ja: "9年A", }), ID.subjectHistory, ID.academicYear, STUDENTS.length, 0, createdAt, updatedAt);

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

    // ── Attendance ───────────────────────────────────────────────────────────
    // The ten school days before today, or the first ten of the year when it has only
    // just begun — so the grid never opens on an empty fortnight. One is a holiday.
    const schoolDays = (from: string, step: 1 | -1) => {
      const days: string[] = [];
      for (let day = from; days.length < 10; day = addDays(day, step)) if (!isWeekend(day)) days.push(day);
      return days.sort();
    };
    let attendanceDays = schoolDays(addDays(toDayKey(now), -1), -1);
    if (attendanceDays[0] < yearRange.startDate) attendanceDays = schoolDays(yearRange.startDate, 1);
    const holiday = attendanceDays[6];
    db.prepare(`INSERT INTO teaching_attendance_holidays (id,group_id,date,label,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run('demo-teaching-holiday-1', ID.group, holiday, pick({ es: 'Fiesta local', en: 'Local holiday', 'zh-CN': '地方假日',
  'zh-TW': '地方假日',
  ko: "지역 공휴일",
  ja: "地域の祝日", }), createdAt, updatedAt);
    const insertAttendance = db.prepare(`INSERT INTO teaching_attendance (id,student_id,date,status,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`);
    const attendanceRng = seededRng(20_260_926);
    STUDENTS.forEach((student) => {
      attendanceDays.filter((day) => day !== holiday).forEach((day, index) => {
        const roll = attendanceRng();
        const status = roll < 0.8 ? 'present' : roll < 0.88 ? 'late' : roll < 0.95 ? 'justified' : 'unjustified';
        const note = status === 'justified'
          ? pick({ es: 'Justificante médico', en: 'Doctor’s note', 'zh-CN': '医生证明',
  'zh-TW': '醫生證明',
  ko: "진단서",
  ja: "診断書", })
          : '';
        insertAttendance.run(`${student.id}-attendance-${index}`, student.id, day, status, note, createdAt, updatedAt);
      });
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
        pick({ es: 'Comentario de texto histórico', en: 'Historical source commentary', 'zh-CN': '历史文本评析' ,
  'zh-TW': '歷史文本評析',
  ko: "역사적 자료 해설",
  ja: "史料解説", }),
        pick({ es: 'Rúbrica analítica ponderada para el comentario de la unidad 3.', en: 'Weighted analytic rubric for the unit 3 commentary.', 'zh-CN': '用于第三单元评析的加权分析式评分标准。' ,
  'zh-TW': '用於第三單元評析的加權分析式評分標準。',
  ko: "단원 3 해설에 대한 가중치 분석 루브릭입니다.",
  ja: "単元3の解説のための加重分析ルーブリック。", }),
        ID.subjectHistory, ID.course, promptL, 10, 1,
        JSON.stringify(levels), JSON.stringify(criteria), 0, createdAt, updatedAt);

    // ── Exam ─────────────────────────────────────────────────────────────────
    const header = {
      institution: pick({ es: 'IES de ejemplo', en: 'Sample secondary school', 'zh-CN': '示例中学' ,
  'zh-TW': '示例中學',
  ko: "샘플 중등 학교",
  ja: "サンプル中学校", }),
      subjectName: pick({ es: 'Geografía e Historia', en: 'Geography and History', 'zh-CN': '地理与历史' ,
  'zh-TW': '地理與歷史',
  ko: "지력",
  ja: "地理と歴史", }),
      teachers: pick({ es: 'Departamento de Ciencias Sociales', en: 'Social Sciences department', 'zh-CN': '社会科学教研组' ,
  'zh-TW': '社會科學教研組',
  ko: "사회과학부",
  ja: "社会科学部", }),
      groupLabel: pick({ es: '3.º ESO A', en: 'Year 9 A', 'zh-CN': '初三A班' ,
  'zh-TW': '初三A班',
  ko: "9학년 A",
  ja: "9年A", }),
      examTitle: pick({ es: 'Prueba escrita · unidad 3', en: 'Written test · unit 3', 'zh-CN': '笔试 · 第三单元' ,
  'zh-TW': '筆試 · 第三單元',
  ko: "필기시험 · 3단원",
  ja: "筆記試験・単元3", }),
      dateText: '',
      durationMinutes: 55,
      instructions: pick({
        es: 'Lee el enunciado completo antes de responder. Cuida la expresión y justifica siempre tus respuestas.',
        en: 'Read the whole paper before answering. Mind your expression and always justify your answers.',
        'zh-CN': '作答前请通读全卷。注意表达，并始终为你的答案提供理由。',
        'zh-TW': '作答前請通讀全卷。注意表達，並始終為你的答案提供理由。',
        ko: "답변하기 전에 논문 전체를 읽어보세요. 표현에 주의하고 항상 대답을 정당화하십시오.",
        ja: "回答する前に論文全体を読んでください。表現に気をつけて、常に自分の答えを正当化してください。",
      }),
      showStudentName: true, showStudentId: false, showGroup: true,
      showDate: true, showGradeBox: true, showPoints: true,
    };
    db.prepare(`INSERT INTO teaching_exams
      (id,short_id,title,subject_id,course_id,language,target_question_count,header_json,logos_json,position,archived_at,deleted_at,created_at,updated_at,language_locked)
      VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?)`)
      .run(ID.exam, 'EXM-DOC1',
        pick({ es: 'Prueba escrita · unidad 3', en: 'Written test · unit 3', 'zh-CN': '笔试 · 第三单元' ,
  'zh-TW': '筆試 · 第三單元',
  ko: "필기시험 · 3단원",
  ja: "筆記試験・単元3", }),
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
      pick({ es: 'Define «revolución industrial» e indica el periodo en que se desarrolla.', en: 'Define "industrial revolution" and state the period in which it unfolds.', 'zh-CN': '请为「工业革命」下定义，并指出其发生时期。' ,
  'zh-TW': '請為「工業革命」下定義，並指出其發生時期。',
  ko: "'산업혁명'을 정의하고 그것이 전개되는 기간을 기술하십시오.",
  ja: "「産業革命」を定義し、それが展開する時期を述べます。", }),
      1, 4,
      pick({ es: 'Proceso de transformación económica basado en la mecanización y la fábrica, iniciado en Gran Bretaña a finales del siglo XVIII.', en: 'Process of economic transformation based on mechanisation and the factory, beginning in Britain in the late eighteenth century.', 'zh-CN': '一场以机械化和工厂为基础的经济变革，18 世纪末始于英国。' ,
  'zh-TW': '一場以機械化和工廠為基礎的經濟變革，18 世紀末始於英國。',
  ko: "18세기 후반 영국에서 시작된 기계화와 공장을 기반으로 한 경제 변혁 과정.",
  ja: "18世紀後半にイギリスで始まった、機械化と工場に基づく経済変革のプロセス。", }));

    // A section statement plus the two questions that hang from it: this is what makes
    // the printed paper number them 2.1 and 2.2 while the statement itself scores
    // nothing of its own.
    q('demo-teaching-eq-section', 'EQU-DOC2', 1, 'section',
      pick({
        es: 'Lee el siguiente testimonio: «Los niños entran en la fábrica antes del amanecer y salen cuando ya ha oscurecido. El aire está cargado de polvo de algodón.» (Informe parlamentario, 1832)',
        en: 'Read the following testimony: "The children enter the mill before daybreak and leave when it is already dark. The air is thick with cotton dust." (Parliamentary report, 1832)',
        'zh-CN': '阅读以下证词：「孩子们天不亮就进工厂，出来时天已经黑了。空气中弥漫着棉尘。」（议会报告，1832）',
        'zh-TW': '閱讀以下證詞：「孩子們天不亮就進工廠，出來時天已經黑了。空氣中瀰漫著棉塵。」（議會報告，1832）',
        ko: "다음 간증을 읽어 보십시오. \"아이들은 동이 트기 전에 방앗간으로 들어가 이미 어두워졌을 때 떠납니다. 공기는 솜 먼지로 가득합니다.\" (의회 보고서, 1832)",
        ja: "次の証言を読んでください。「子供たちは夜明け前に工場に入り、もう暗くなってから出ていきます。空気は綿粉で厚いです。」 （議会報告書、1832年）",
      }),
      0, 0, '');
    q('demo-teaching-eq-2a', 'EQU-DOC3', 2, 'short_essay',
      pick({ es: 'Explica qué condiciones de trabajo describe el testimonio.', en: 'Explain which working conditions the testimony describes.', 'zh-CN': '请说明证词描述了哪些劳动条件。' ,
  'zh-TW': '請說明證詞描述了哪些勞動條件。',
  ko: "증언이 어떤 근무 조건을 설명하는지 설명하십시오.",
  ja: "証言でどのような労働条件が説明されているか説明してください。", }),
      1.5, 6,
      pick({ es: 'Jornadas de sol a sol, trabajo infantil y ambiente insalubre por el polvo de algodón.', en: 'Dawn-to-dusk shifts, child labour and an unhealthy atmosphere from cotton dust.', 'zh-CN': '起早贪黑的工时、童工，以及因棉尘而不健康的环境。' ,
  'zh-TW': '起早貪黑的工時、童工，以及因棉塵而不健康的環境。',
  ko: "새벽부터 황혼까지의 교대 근무, 아동 노동, 면 먼지로 인한 건강에 해로운 대기.",
  ja: "夜明けから夕暮れまでの勤務、児童労働、綿粉による不健康な雰囲気。", }),
      'demo-teaching-eq-section');
    q('demo-teaching-eq-2b', 'EQU-DOC4', 3, 'short_answer',
      pick({ es: '¿Qué respuesta social surge frente a estas condiciones?', en: 'What social response emerged in the face of these conditions?', 'zh-CN': '面对这些条件，出现了怎样的社会回应？' ,
  'zh-TW': '面對這些條件，出現了怎樣的社會回應？',
  ko: "이러한 상황에 직면하여 어떤 사회적 반응이 나타났습니까?",
  ja: "こうした状況に直面して、どのような社会的反応が現れたのでしょうか？", }),
      0.5, 2,
      pick({ es: 'El movimiento obrero y las primeras leyes de regulación laboral.', en: 'The labour movement and the first factory-regulation laws.', 'zh-CN': '工人运动和最早规范劳动的立法。' ,
  'zh-TW': '工人運動和最早規範勞動的立法。',
  ko: "노동운동과 최초의 공장규제법.",
  ja: "労働運動と最初の工場規制法。", }),
      'demo-teaching-eq-section');

    q('demo-teaching-eq-3', 'EQU-DOC5', 4, 'multiple_choice',
      pick({ es: '¿Qué fuente de energía caracteriza la primera industrialización?', en: 'Which energy source characterises the first industrialisation?', 'zh-CN': '第一次工业化的标志性能源是什么？' ,
  'zh-TW': '第一次工業化的標誌性能源是什麼？',
  ko: "최초의 산업화를 특징짓는 에너지원은 무엇입니까?",
  ja: "最初の工業化を特徴付けるエネルギー源はどれですか?", }),
      0.5, 0,
      pick({ es: 'El carbón.', en: 'Coal.', 'zh-CN': '煤炭。' ,
  'zh-TW': '煤炭。',
  ko: "석탄.",
  ja: "石炭。", }), null,
      opts(L === 'es'
        ? ['El carbón', 'El petróleo', 'La electricidad', 'El gas natural']
        : L === 'zh-CN'
          ? ['煤炭', '石油', '电力', '天然气']
          : ['Coal', 'Oil', 'Electricity', 'Natural gas'], 0));
    q('demo-teaching-eq-4', 'EQU-DOC6', 5, 'true_false',
      pick({ es: 'La industrialización llegó a toda Europa al mismo tiempo.', en: 'Industrialisation reached the whole of Europe at the same time.', 'zh-CN': '工业化同时波及了整个欧洲。' ,
  'zh-TW': '工業化同時波及了整個歐洲。',
  ko: "산업화는 유럽 전역에 동시에 도달했습니다.",
  ja: "工業化は同時にヨーロッパ全土に到達しました。", }),
      0.25, 0,
      pick({ es: 'Falso: fue un proceso desigual y escalonado.', en: 'False: it was an uneven, staggered process.', 'zh-CN': '错误：这是一个不均衡、分阶段的过程。' ,
  'zh-TW': '錯誤：這是一個不均衡、分階段的過程。',
  ko: "거짓: 고르지 않고 시차를 두고 진행되는 과정이었습니다.",
  ja: "誤り: それは不均一で時間差のあるプロセスでした。", }));
    q('demo-teaching-eq-5', 'EQU-DOC7', 6, 'matching',
      pick({ es: 'Relaciona cada invento con su ámbito de aplicación.', en: 'Match each invention with the field it applied to.', 'zh-CN': '将每项发明与其应用领域配对。' ,
  'zh-TW': '將每項發明與其應用領域配對。',
  ko: "각 발명품을 적용 분야와 연결하세요.",
  ja: "各発明をそれが適用される分野と照合してください。", }),
      1, 0,
      pick({ es: 'Vapor–transporte; telar mecánico–textil; convertidor–siderurgia.', en: 'Steam–transport; power loom–textiles; converter–steelmaking.', 'zh-CN': '蒸汽–运输；机械织机–纺织；转炉–炼钢。' ,
  'zh-TW': '蒸汽–運輸；機械織機–紡織；轉爐–煉鋼。',
  ko: "증기 운송; 동력 직기-섬유; 변환기-제철.",
  ja: "蒸気輸送。力織機 – 繊維。転炉 - 製鉄。", }),
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
        pick({ es: 'Historia · 3.º ESO A', en: 'History · Year 9 A', 'zh-CN': '历史 · 初三A班' ,
  'zh-TW': '歷史 · 初三A班',
  ko: "역사 · 9학년 A",
  ja: "歴史 · 9年A", }),
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
      not_submitted: { es: 'Sin entregar en el plazo acordado con el grupo.', en: 'Not handed in within the deadline agreed with the group.', 'zh-CN': '未在小组约定的期限内提交。' ,
  'zh-TW': '未在小組約定的期限內提交。',
  ko: "그룹과 합의한 기한 내에 제출되지 않았습니다.",
  ja: "グループと合意した期限内に提出されなかった場合。", },
      not_assessed: { es: 'Se incorporó al grupo después de esta prueba.', en: 'Joined the group after this test.', 'zh-CN': '在该测验之后才加入小组。' ,
  'zh-TW': '在該測驗之後才加入小組。',
  ko: "이번 테스트 후 그룹에 합류했습니다.",
  ja: "このテスト後にグループに加わりました。", },
      exempt: { es: 'Exenta por adaptación curricular.', en: 'Exempt under a curricular adaptation.', 'zh-CN': '因课程调整免考。' ,
  'zh-TW': '因課程調整免考。',
  ko: "커리큘럼 적응에 따라 면제됩니다.",
  ja: "カリキュラム適応により免除される。", },
    };

    for (const student of STUDENTS) {
      const marks = MARKS[student.id];
      leafIds.forEach((itemId, index) => {
        const [value, status] = marks[index];
        const entryId = `${student.id}-entry-${index}`;
        insertEntry.run(entryId, student.id, itemId, value, status, pick(STATUS_NOTE[status] ?? { es: '', en: '', 'zh-CN': '' ,
  'zh-TW': '',
  ko: "",
  ja: "", }), createdAt, updatedAt);
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
      DELETE FROM teaching_attendance WHERE id LIKE 'demo-teaching-%';
      DELETE FROM teaching_attendance_holidays WHERE id LIKE 'demo-teaching-%';
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
