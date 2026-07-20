import { getDb } from './database';
import { getSettings, updateSettings } from './settingsRepo';
import { clearGenealogyDemoData } from './genealogyDemoData';
import { clearDatabasesDemoData } from './databasesDemoData';
import { clearStudyDemoData } from './studyDemoData';
import { clearTeachingDemoData } from './teachingDemoData';

// A self-consistent corpus on the science of learning. It exists so a
// first-time user can see every static view (graph, ideas, debates, gaps, notes,
// library, search) populated and connected, without a Zotero library or an API
// key. Every id is prefixed with `demo-` so the data can be removed surgically
// and can never collide with real, scanned content.
//
// Demo data is only ever seeded into an empty database and is wiped wholesale
// when the user leaves demo mode. The AI-driven views (reading path, writing
// workshop, tutor, coverage) still require a configured model — the demo seeds
// the inputs they consume, not their generated output.
//
// All reader-facing text is bilingual: seedDemoData picks Spanish or English
// from the interface language (uiLanguage) so the demo matches the app. Verbatim
// `quote` fields stay in their original (English) source language by convention.

const DEMO_PREFIX = 'demo-';

type DemoLocale = 'es' | 'en';
type Localized = { es: string; en: string };

/** The demo language follows the interface language; anything but Spanish gets English. */
function demoLocale(): DemoLocale {
  return getSettings().uiLanguage === 'es' ? 'es' : 'en';
}

interface DemoWork {
  id: string;
  title: Localized;
  authors: string[];
  year: number;
  read: boolean;
}

interface DemoIdea {
  id: string;
  type: 'claim' | 'finding' | 'construct' | 'method' | 'framework';
  label: Localized;
  statement: Localized;
  workId: string;
  themeId: string;
  role: 'support' | 'contrast' | 'gap' | 'method' | 'definition' | 'context';
  development: Localized;
  confidence: number;
  evidence: { quote: string; location: string; kind: 'explicit' | 'paraphrased' };
}

interface DemoEdge {
  from: string;
  to: string;
  type:
    | 'extends'
    | 'contradicts'
    | 'applies_to'
    | 'shares_method'
    | 'precondition_of'
    | 'supports'
    | 'refines';
  basis: 'explicit' | 'inferred';
  confidence: number;
  sourceWork: string;
}

interface DemoGap {
  id: string;
  workId: string;
  relatedIdea: string;
  kind: 'future_work' | 'limitation' | 'open_question' | 'unresolved_contradiction';
  statement: Localized;
  confidence: number;
}

const WORKS: DemoWork[] = [
  { id: 'demo-w1', title: { es: 'Práctica de recuperación y retención a largo plazo', en: 'Retrieval practice and long-term retention' }, authors: ['Roediger, H. L.', 'Karpicke, J. D.'], year: 2006, read: true },
  { id: 'demo-w2', title: { es: 'Teoría de la carga cognitiva y diseño instruccional', en: 'Cognitive load theory and instructional design' }, authors: ['Sweller, J.'], year: 1988, read: true },
  { id: 'demo-w3', title: { es: 'Efectos del espaciado en el aprendizaje y la consolidación', en: 'Spacing effects on learning and consolidation' }, authors: ['Cepeda, N. J.', 'Pashler, H.'], year: 2006, read: true },
  { id: 'demo-w4', title: { es: 'Ansiedad ante los exámenes y rendimiento académico', en: 'Test anxiety and academic performance' }, authors: ['Putwain, D. W.'], year: 2008, read: false },
  { id: 'demo-w5', title: { es: 'Autorregulación del aprendizaje: una visión general', en: 'Self-regulated learning: an overview' }, authors: ['Zimmerman, B. J.'], year: 2002, read: true },
  { id: 'demo-w6', title: { es: 'El efecto de generación en la memoria', en: 'The generation effect in memory' }, authors: ['Slamecka, N. J.', 'Graf, P.'], year: 1978, read: false },
  { id: 'demo-w7', title: { es: 'Mejorar el aprendizaje con técnicas eficaces', en: 'Improving learning with effective techniques' }, authors: ['Dunlosky, J.', 'Rawson, K. A.'], year: 2013, read: true },
  { id: 'demo-w8', title: { es: 'Aprendizaje inductivo mediante práctica intercalada', en: 'Inductive learning through interleaved practice' }, authors: ['Kornell, N.', 'Bjork, R. A.'], year: 2008, read: true },
  { id: 'demo-w9', title: { es: 'El poder de la retroalimentación', en: 'The power of feedback' }, authors: ['Hattie, J.', 'Timperley, H.'], year: 2007, read: true },
  { id: 'demo-w10', title: { es: 'Mecanismos de autoeficacia en la agencia humana', en: 'Self-efficacy mechanisms in human agency' }, authors: ['Bandura, A.'], year: 1982, read: true },
  { id: 'demo-w11', title: { es: 'Aprendizaje multimedia', en: 'Multimedia learning' }, authors: ['Mayer, R. E.'], year: 2009, read: false },
  { id: 'demo-w12', title: { es: 'Aprendizaje cooperativo y rendimiento', en: 'Cooperative learning and achievement' }, authors: ['Johnson, D. W.', 'Johnson, R. T.'], year: 2009, read: true },
  { id: 'demo-w13', title: { es: '¿Cuándo y dónde aplicamos lo aprendido?', en: 'When and where do we apply what we learn?' }, authors: ['Barnett, S. M.', 'Ceci, S. J.'], year: 2002, read: false },
  { id: 'demo-w14', title: { es: 'Psicología educativa: una perspectiva cognitiva', en: 'Educational psychology: a cognitive view' }, authors: ['Ausubel, D. P.'], year: 1968, read: true },
  { id: 'demo-w15', title: { es: 'El papel de la práctica deliberada en el rendimiento experto', en: 'The role of deliberate practice in expert performance' }, authors: ['Ericsson, K. A.', 'Krampe, R. T.', 'Tesch-Römer, C.'], year: 1993, read: true },
];

const THEMES: { id: string; label: Localized }[] = [
  { id: 'demo-t1', label: { es: 'Consolidación de la memoria', en: 'Memory consolidation' } },
  { id: 'demo-t2', label: { es: 'Práctica de recuperación', en: 'Retrieval practice' } },
  { id: 'demo-t3', label: { es: 'Carga cognitiva', en: 'Cognitive load' } },
  { id: 'demo-t4', label: { es: 'Metacognición', en: 'Metacognition' } },
  { id: 'demo-t5', label: { es: 'Práctica intercalada', en: 'Interleaved practice' } },
  { id: 'demo-t6', label: { es: 'Retroalimentación', en: 'Feedback' } },
  { id: 'demo-t7', label: { es: 'Motivación y autoeficacia', en: 'Motivation and self-efficacy' } },
  { id: 'demo-t8', label: { es: 'Aprendizaje multimedia', en: 'Multimedia learning' } },
  { id: 'demo-t9', label: { es: 'Aprendizaje colaborativo', en: 'Collaborative learning' } },
  { id: 'demo-t10', label: { es: 'Transferencia del aprendizaje', en: 'Learning transfer' } },
  { id: 'demo-t11', label: { es: 'Conocimientos previos', en: 'Prior knowledge' } },
  { id: 'demo-t12', label: { es: 'Práctica deliberada', en: 'Deliberate practice' } },
];

const IDEAS: DemoIdea[] = [
  {
    id: 'demo-i1', type: 'finding',
    label: { es: 'El efecto de prueba refuerza la retención', en: 'The testing effect strengthens retention' },
    statement: {
      es: 'Recuperar información en una prueba produce mejor retención a largo plazo que volver a estudiarla.',
      en: 'Retrieving information on a test produces better long-term retention than restudying it.',
    },
    workId: 'demo-w1', themeId: 'demo-t2', role: 'support', confidence: 0.92,
    development: {
      es: 'En un seguimiento a una semana, el grupo que se autoevaluó retuvo notablemente más que el grupo que releyó el material.',
      en: 'At a one-week follow-up, the group that tested itself retained markedly more than the group that reread the material.',
    },
    evidence: { quote: 'Taking a test on studied material promotes better long-term retention than restudying the same material.', location: 'p. 250', kind: 'explicit' },
  },
  {
    id: 'demo-i2', type: 'claim',
    label: { es: 'La recuperación activa supera a la relectura', en: 'Active retrieval beats rereading' },
    statement: {
      es: 'El esfuerzo de recuperar desde la memoria deja una huella más duradera que la exposición repetida y pasiva.',
      en: 'The effort of retrieving from memory leaves a more durable trace than repeated, passive exposure.',
    },
    workId: 'demo-w1', themeId: 'demo-t2', role: 'context', confidence: 0.84,
    development: {
      es: 'La dificultad deseable de la recuperación es justamente lo que fortalece la traza mnémica.',
      en: 'The desirable difficulty of retrieval is precisely what strengthens the memory trace.',
    },
    evidence: { quote: 'The act of retrieval is itself a memory modifier.', location: 'p. 252', kind: 'paraphrased' },
  },
  {
    id: 'demo-i3', type: 'finding',
    label: { es: 'El espaciado mejora la retención frente al estudio masivo', en: 'Spacing improves retention over massed study' },
    statement: {
      es: 'Distribuir las sesiones de estudio en el tiempo produce más retención que concentrarlas.',
      en: 'Distributing study sessions over time produces more retention than massing them together.',
    },
    workId: 'demo-w3', themeId: 'demo-t1', role: 'support', confidence: 0.9,
    development: {
      es: 'El beneficio del espaciado crece con el intervalo de retención objetivo.',
      en: 'The spacing benefit grows with the target retention interval.',
    },
    evidence: { quote: 'Spaced practice yielded reliably higher retention than massed practice across retention intervals.', location: 'p. 354', kind: 'explicit' },
  },
  {
    id: 'demo-i4', type: 'construct',
    label: { es: 'Carga cognitiva intrínseca frente a extrínseca', en: 'Intrinsic versus extraneous cognitive load' },
    statement: {
      es: 'La memoria de trabajo soporta una carga intrínseca a la tarea y una carga extrínseca impuesta por el diseño del material.',
      en: 'Working memory bears a load intrinsic to the task and an extraneous load imposed by how the material is designed.',
    },
    workId: 'demo-w2', themeId: 'demo-t3', role: 'definition', confidence: 0.88,
    development: {
      es: 'Distinguir ambos tipos de carga permite rediseñar materiales sin simplificar el contenido en sí.',
      en: 'Distinguishing the two kinds of load makes it possible to redesign materials without simplifying the content itself.',
    },
    evidence: { quote: 'Extraneous cognitive load is imposed by the manner in which information is presented.', location: 'p. 261', kind: 'explicit' },
  },
  {
    id: 'demo-i5', type: 'claim',
    label: { es: 'Reducir la carga extrínseca libera memoria de trabajo', en: 'Reducing extraneous load frees working memory' },
    statement: {
      es: 'Eliminar elementos de diseño superfluos deja capacidad de memoria de trabajo para el aprendizaje genuino.',
      en: 'Removing superfluous design elements leaves working-memory capacity for genuine learning.',
    },
    workId: 'demo-w2', themeId: 'demo-t3', role: 'support', confidence: 0.81,
    development: {
      es: 'De aquí se derivan principios como evitar la atención dividida y la redundancia.',
      en: 'Principles such as avoiding split attention and redundancy follow from this.',
    },
    evidence: { quote: 'Reducing extraneous load frees working memory resources for schema construction.', location: 'p. 263', kind: 'paraphrased' },
  },
  {
    id: 'demo-i6', type: 'finding',
    label: { es: 'La ansiedad ante los exámenes reduce el rendimiento', en: 'Test anxiety lowers performance' },
    statement: {
      es: 'Niveles altos de ansiedad ante la evaluación se asocian con un peor rendimiento en las pruebas.',
      en: 'High levels of test anxiety are associated with poorer performance on examinations.',
    },
    workId: 'demo-w4', themeId: 'demo-t2', role: 'contrast', confidence: 0.79,
    development: {
      es: 'La preocupación consume recursos de memoria de trabajo durante la prueba.',
      en: 'Worry consumes working-memory resources during the test.',
    },
    evidence: { quote: 'Test anxiety was negatively associated with examination performance.', location: 'p. 142', kind: 'explicit' },
  },
  {
    id: 'demo-i7', type: 'framework',
    label: { es: 'Ciclo de autorregulación: planificar, monitorizar, evaluar', en: 'Self-regulation cycle: plan, monitor, evaluate' },
    statement: {
      es: 'El aprendizaje autorregulado se organiza en fases de previsión, ejecución con automonitorización y autorreflexión.',
      en: 'Self-regulated learning is organized into phases of forethought, performance with self-monitoring, and self-reflection.',
    },
    workId: 'demo-w5', themeId: 'demo-t1', role: 'definition', confidence: 0.86,
    development: {
      es: 'Las estrategias de estudio eficaces dependen de que el estudiante regule su propio proceso.',
      en: 'Effective study strategies depend on students regulating their own process.',
    },
    evidence: { quote: 'Self-regulation unfolds across forethought, performance, and self-reflection phases.', location: 'p. 67', kind: 'paraphrased' },
  },
  {
    id: 'demo-i8', type: 'finding',
    label: { es: 'Generar la respuesta mejora el recuerdo frente a leerla', en: 'Generating the answer improves recall over reading it' },
    statement: {
      es: 'Producir activamente una respuesta deja mejor recuerdo que leer esa misma respuesta ya dada.',
      en: 'Actively producing an answer yields better recall than reading that same answer already given.',
    },
    workId: 'demo-w6', themeId: 'demo-t2', role: 'support', confidence: 0.83,
    development: {
      es: 'El efecto de generación es un caso particular del beneficio del esfuerzo de recuperación.',
      en: 'The generation effect is a special case of the retrieval-effort benefit.',
    },
    evidence: { quote: 'Items generated by the subject were better remembered than items merely read.', location: 'p. 592', kind: 'explicit' },
  },
  {
    id: 'demo-i9', type: 'claim',
    label: { es: 'El espaciado favorece la consolidación durante el sueño', en: 'Spacing supports consolidation during sleep' },
    statement: {
      es: 'Separar las sesiones permite procesos de consolidación, ligados al sueño, entre repeticiones.',
      en: 'Separating sessions allows sleep-linked consolidation processes to occur between repetitions.',
    },
    workId: 'demo-w3', themeId: 'demo-t1', role: 'context', confidence: 0.74,
    development: {
      es: 'Es una de las explicaciones propuestas para el efecto del espaciado.',
      en: 'It is one of the proposed explanations for the spacing effect.',
    },
    evidence: { quote: 'Intervening sleep may support consolidation between spaced sessions.', location: 'p. 357', kind: 'paraphrased' },
  },
  {
    id: 'demo-i10', type: 'method',
    label: { es: 'La autoevaluación calibra el conocimiento', en: 'Self-testing calibrates knowledge' },
    statement: {
      es: 'Comprobar lo que se recuerda revela lagunas que la relectura familiar puede ocultar.',
      en: 'Checking what can be recalled reveals gaps that familiar rereading can conceal.',
    },
    workId: 'demo-w7', themeId: 'demo-t4', role: 'method', confidence: 0.87,
    development: {
      es: 'La recuperación funciona a la vez como estrategia de aprendizaje y como diagnóstico metacognitivo.',
      en: 'Retrieval works both as a learning strategy and as a metacognitive diagnostic.',
    },
    evidence: { quote: 'Practice testing helps learners identify what they know and what still requires study.', location: 'p. 37', kind: 'paraphrased' },
  },
  {
    id: 'demo-i11', type: 'finding',
    label: { es: 'La sensación de fluidez puede engañar', en: 'A feeling of fluency can mislead' },
    statement: {
      es: 'La facilidad inmediata al estudiar no predice necesariamente una retención duradera.',
      en: 'Immediate ease during study does not necessarily predict durable retention.',
    },
    workId: 'demo-w7', themeId: 'demo-t4', role: 'contrast', confidence: 0.82,
    development: {
      es: 'Las estrategias que parecen más difíciles durante la práctica pueden producir mejores resultados demorados.',
      en: 'Strategies that feel harder during practice can produce better delayed outcomes.',
    },
    evidence: { quote: 'Learners often prefer techniques that increase fluency without improving long-term learning.', location: 'p. 45', kind: 'paraphrased' },
  },
  {
    id: 'demo-i12', type: 'finding',
    label: { es: 'Intercalar ejemplos mejora la discriminación', en: 'Interleaving examples improves discrimination' },
    statement: {
      es: 'Mezclar categorías durante la práctica ayuda a distinguir cuándo aplicar cada concepto.',
      en: 'Mixing categories during practice helps learners distinguish when each concept applies.',
    },
    workId: 'demo-w8', themeId: 'demo-t5', role: 'support', confidence: 0.89,
    development: {
      es: 'El contraste continuo entre casos refuerza los rasgos que separan unas categorías de otras.',
      en: 'Continual comparison between cases strengthens the features that separate categories.',
    },
    evidence: { quote: 'Interleaving exemplars improved later classification compared with blocking them by category.', location: 'p. 585', kind: 'explicit' },
  },
  {
    id: 'demo-i13', type: 'claim',
    label: { es: 'La práctica por bloques sobrestima el dominio', en: 'Blocked practice overstates mastery' },
    statement: {
      es: 'Agrupar ejercicios idénticos aumenta la fluidez aparente pero reduce la necesidad de elegir una estrategia.',
      en: 'Grouping identical problems increases apparent fluency but reduces the need to choose a strategy.',
    },
    workId: 'demo-w8', themeId: 'demo-t5', role: 'contrast', confidence: 0.8,
    development: {
      es: 'La dificultad del intercalado es informativa: obliga a reconocer el tipo de problema antes de resolverlo.',
      en: 'The difficulty of interleaving is informative: it forces learners to recognize the problem type before solving it.',
    },
    evidence: { quote: 'Blocked practice was easier during acquisition but less effective on the delayed test.', location: 'p. 587', kind: 'paraphrased' },
  },
  {
    id: 'demo-i14', type: 'framework',
    label: { es: 'La retroalimentación cierra la distancia hacia la meta', en: 'Feedback closes the gap to the goal' },
    statement: {
      es: 'La retroalimentación es útil cuando aclara la meta, el progreso actual y el siguiente paso.',
      en: 'Feedback is useful when it clarifies the goal, current progress, and the next step.',
    },
    workId: 'demo-w9', themeId: 'demo-t6', role: 'definition', confidence: 0.91,
    development: {
      es: 'Un buen mensaje responde adónde voy, cómo voy y qué debo hacer después.',
      en: 'A good message answers where am I going, how am I going, and what should I do next.',
    },
    evidence: { quote: 'Effective feedback answers three questions: Where am I going? How am I going? Where to next?', location: 'p. 86', kind: 'explicit' },
  },
  {
    id: 'demo-i15', type: 'claim',
    label: { es: 'Comentar la tarea supera a elogiar a la persona', en: 'Task feedback beats personal praise' },
    statement: {
      es: 'La información sobre la tarea y el proceso orienta mejor la mejora que los juicios generales sobre la persona.',
      en: 'Information about the task and process guides improvement better than general judgments about the person.',
    },
    workId: 'demo-w9', themeId: 'demo-t6', role: 'support', confidence: 0.86,
    development: {
      es: 'El feedback procesable dirige la atención hacia decisiones que el estudiante puede revisar.',
      en: 'Actionable feedback directs attention toward decisions the learner can revise.',
    },
    evidence: { quote: 'Feedback about the self is usually less effective than feedback about the task or process.', location: 'p. 96', kind: 'paraphrased' },
  },
  {
    id: 'demo-i16', type: 'construct',
    label: { es: 'La autoeficacia sostiene el esfuerzo', en: 'Self-efficacy sustains effort' },
    statement: {
      es: 'Creer que una tarea es abordable influye en la elección, la persistencia y la recuperación ante errores.',
      en: 'Believing a task is manageable influences choice, persistence, and recovery from errors.',
    },
    workId: 'demo-w10', themeId: 'demo-t7', role: 'definition', confidence: 0.9,
    development: {
      es: 'La expectativa de eficacia no sustituye la habilidad, pero determina si se moviliza y se mantiene.',
      en: 'Efficacy expectations do not replace skill, but they influence whether it is mobilized and sustained.',
    },
    evidence: { quote: 'Perceived self-efficacy affects how much effort people expend and how long they persist.', location: 'p. 123', kind: 'explicit' },
  },
  {
    id: 'demo-i17', type: 'method',
    label: { es: 'Las metas alcanzables construyen autoeficacia', en: 'Attainable goals build self-efficacy' },
    statement: {
      es: 'Dividir una tarea compleja en logros próximos aporta experiencias de dominio que refuerzan la confianza.',
      en: 'Breaking a complex task into proximal accomplishments provides mastery experiences that strengthen confidence.',
    },
    workId: 'demo-w10', themeId: 'demo-t7', role: 'method', confidence: 0.83,
    development: {
      es: 'El progreso visible convierte una meta distante en una secuencia de evidencias de capacidad.',
      en: 'Visible progress turns a distant goal into a sequence of evidence of capability.',
    },
    evidence: { quote: 'Proximal goals provide evidence of growing capability and strengthen perceived efficacy.', location: 'p. 136', kind: 'paraphrased' },
  },
  {
    id: 'demo-i18', type: 'claim',
    label: { es: 'La coherencia multimedia reduce carga innecesaria', en: 'Multimedia coherence reduces needless load' },
    statement: {
      es: 'Eliminar palabras, imágenes y sonidos irrelevantes evita que compitan por recursos cognitivos limitados.',
      en: 'Removing irrelevant words, images, and sounds prevents them from competing for limited cognitive resources.',
    },
    workId: 'demo-w11', themeId: 'demo-t8', role: 'support', confidence: 0.88,
    development: {
      es: 'La decoración no siempre ayuda: puede desviar el procesamiento que debería integrar la explicación.',
      en: 'Decoration does not always help: it can divert processing that should integrate the explanation.',
    },
    evidence: { quote: 'People learn better when extraneous material is excluded rather than included.', location: 'p. 89', kind: 'explicit' },
  },
  {
    id: 'demo-i19', type: 'framework',
    label: { es: 'Palabras e imágenes forman modelos integrados', en: 'Words and pictures form integrated models' },
    statement: {
      es: 'El aprendizaje multimedia exige seleccionar, organizar e integrar representaciones verbales y visuales.',
      en: 'Multimedia learning requires selecting, organizing, and integrating verbal and visual representations.',
    },
    workId: 'demo-w11', themeId: 'demo-t8', role: 'definition', confidence: 0.85,
    development: {
      es: 'La combinación funciona cuando cada canal aporta información relevante y ambos pueden conectarse.',
      en: 'The combination works when each channel contributes relevant information and the two can be connected.',
    },
    evidence: { quote: 'Meaningful learning involves building connections between verbal and pictorial representations.', location: 'p. 74', kind: 'paraphrased' },
  },
  {
    id: 'demo-i20', type: 'finding',
    label: { es: 'La cooperación estructurada mejora el rendimiento', en: 'Structured cooperation improves achievement' },
    statement: {
      es: 'Trabajar en grupos con interdependencia positiva produce mejores resultados que agrupar sin estructura.',
      en: 'Working in groups with positive interdependence produces better outcomes than grouping without structure.',
    },
    workId: 'demo-w12', themeId: 'demo-t9', role: 'support', confidence: 0.87,
    development: {
      es: 'La colaboración eficaz combina una meta compartida con responsabilidad individual.',
      en: 'Effective collaboration combines a shared goal with individual accountability.',
    },
    evidence: { quote: 'Cooperative structures produced higher achievement than competitive or individualistic structures.', location: 'p. 371', kind: 'explicit' },
  },
  {
    id: 'demo-i21', type: 'method',
    label: { es: 'La responsabilidad individual evita la pasividad', en: 'Individual accountability prevents passivity' },
    statement: {
      es: 'Cada integrante debe demostrar su aportación para que la actividad grupal genere aprendizaje distribuido.',
      en: 'Each member must demonstrate a contribution for group activity to produce distributed learning.',
    },
    workId: 'demo-w12', themeId: 'demo-t9', role: 'method', confidence: 0.81,
    development: {
      es: 'Roles claros y comprobaciones individuales reducen que unas pocas personas resuelvan toda la tarea.',
      en: 'Clear roles and individual checks reduce the chance that a few people complete the whole task.',
    },
    evidence: { quote: 'Individual accountability is essential if every group member is to learn.', location: 'p. 373', kind: 'paraphrased' },
  },
  {
    id: 'demo-i22', type: 'framework',
    label: { es: 'La transferencia depende del contexto', en: 'Transfer depends on context' },
    statement: {
      es: 'Aplicar lo aprendido cambia según la distancia entre el contexto de aprendizaje y la situación objetivo.',
      en: 'Applying prior learning varies with the distance between the learning context and the target situation.',
    },
    workId: 'demo-w13', themeId: 'demo-t10', role: 'definition', confidence: 0.86,
    development: {
      es: 'La transferencia no es una propiedad única: puede cambiar de dominio, tiempo, espacio, función y modalidad.',
      en: 'Transfer is not a single property: it can vary across domain, time, space, function, and modality.',
    },
    evidence: { quote: 'Transfer can be characterized along multiple dimensions of contextual distance.', location: 'p. 621', kind: 'explicit' },
  },
  {
    id: 'demo-i23', type: 'method',
    label: { es: 'Variar la práctica favorece la aplicación flexible', en: 'Varied practice supports flexible application' },
    statement: {
      es: 'Practicar un principio en ejemplos diversos ayuda a reconocer su estructura fuera del caso original.',
      en: 'Practicing a principle across diverse examples helps learners recognize its structure beyond the original case.',
    },
    workId: 'demo-w13', themeId: 'demo-t10', role: 'method', confidence: 0.78,
    development: {
      es: 'La variación separa el principio general de los detalles accidentales del ejercicio inicial.',
      en: 'Variation separates the general principle from accidental details of the initial exercise.',
    },
    evidence: { quote: 'Exposure to varied contexts can broaden the range over which knowledge is transferred.', location: 'p. 629', kind: 'paraphrased' },
  },
  {
    id: 'demo-i24', type: 'construct',
    label: { es: 'Los conocimientos previos organizan lo nuevo', en: 'Prior knowledge organizes new learning' },
    statement: {
      es: 'La información nueva se comprende al relacionarla con conceptos que ya forman parte de la estructura cognitiva.',
      en: 'New information is understood by relating it to concepts already present in cognitive structure.',
    },
    workId: 'demo-w14', themeId: 'demo-t11', role: 'definition', confidence: 0.9,
    development: {
      es: 'Activar ideas relevantes antes de una explicación ofrece puntos de anclaje para integrarla.',
      en: 'Activating relevant ideas before an explanation provides anchors for integrating it.',
    },
    evidence: { quote: 'The most important single factor influencing learning is what the learner already knows.', location: 'p. vi', kind: 'explicit' },
  },
  {
    id: 'demo-i25', type: 'claim',
    label: { es: 'Las concepciones erróneas filtran la evidencia nueva', en: 'Misconceptions filter new evidence' },
    statement: {
      es: 'Un conocimiento previo inexacto puede distorsionar una explicación en vez de facilitarla.',
      en: 'Inaccurate prior knowledge can distort an explanation instead of supporting it.',
    },
    workId: 'demo-w14', themeId: 'demo-t11', role: 'contrast', confidence: 0.79,
    development: {
      es: 'Diagnosticar los modelos iniciales es necesario antes de intentar sustituirlos o refinarlos.',
      en: 'Diagnosing initial models is necessary before attempting to replace or refine them.',
    },
    evidence: { quote: 'Existing cognitive structure may facilitate or interfere with the acquisition of new meanings.', location: 'p. 155', kind: 'paraphrased' },
  },
  {
    id: 'demo-i26', type: 'method',
    label: { es: 'La práctica deliberada apunta a debilidades concretas', en: 'Deliberate practice targets specific weaknesses' },
    statement: {
      es: 'La mejora experta exige tareas diseñadas para superar aspectos específicos del rendimiento actual.',
      en: 'Expert improvement requires tasks designed to overcome specific aspects of current performance.',
    },
    workId: 'demo-w15', themeId: 'demo-t12', role: 'method', confidence: 0.91,
    development: {
      es: 'Repetir lo que ya resulta cómodo no equivale a practicar en el límite de la competencia.',
      en: 'Repeating what is already comfortable is not the same as practicing at the edge of competence.',
    },
    evidence: { quote: 'Deliberate practice includes activities specifically designed to improve the current level of performance.', location: 'p. 368', kind: 'explicit' },
  },
  {
    id: 'demo-i27', type: 'claim',
    label: { es: 'La mejora experta requiere feedback y repetición', en: 'Expert improvement requires feedback and repetition' },
    statement: {
      es: 'Los intentos enfocados necesitan retroalimentación inmediata y oportunidades de corrección repetida.',
      en: 'Focused attempts need immediate feedback and repeated opportunities for correction.',
    },
    workId: 'demo-w15', themeId: 'demo-t12', role: 'support', confidence: 0.88,
    development: {
      es: 'El ciclo de actuar, recibir información y ajustar convierte la dificultad en progreso acumulativo.',
      en: 'The cycle of acting, receiving information, and adjusting turns difficulty into cumulative progress.',
    },
    evidence: { quote: 'Learners require informative feedback and repeated opportunities to correct errors.', location: 'p. 367', kind: 'paraphrased' },
  },
];

const EDGES: DemoEdge[] = [
  { from: 'demo-i2', to: 'demo-i1', type: 'supports', basis: 'explicit', confidence: 0.88, sourceWork: 'demo-w1' },
  { from: 'demo-i8', to: 'demo-i2', type: 'supports', basis: 'inferred', confidence: 0.8, sourceWork: 'demo-w6' },
  { from: 'demo-i9', to: 'demo-i3', type: 'extends', basis: 'explicit', confidence: 0.76, sourceWork: 'demo-w3' },
  { from: 'demo-i5', to: 'demo-i4', type: 'refines', basis: 'explicit', confidence: 0.82, sourceWork: 'demo-w2' },
  { from: 'demo-i6', to: 'demo-i1', type: 'contradicts', basis: 'inferred', confidence: 0.7, sourceWork: 'demo-w4' },
  { from: 'demo-i5', to: 'demo-i2', type: 'shares_method', basis: 'inferred', confidence: 0.62, sourceWork: 'demo-w2' },
  { from: 'demo-i10', to: 'demo-i7', type: 'supports', basis: 'inferred', confidence: 0.79, sourceWork: 'demo-w7' },
  { from: 'demo-i11', to: 'demo-i10', type: 'contradicts', basis: 'inferred', confidence: 0.72, sourceWork: 'demo-w7' },
  { from: 'demo-i12', to: 'demo-i3', type: 'extends', basis: 'explicit', confidence: 0.84, sourceWork: 'demo-w8' },
  { from: 'demo-i13', to: 'demo-i12', type: 'supports', basis: 'explicit', confidence: 0.81, sourceWork: 'demo-w8' },
  { from: 'demo-i12', to: 'demo-i8', type: 'shares_method', basis: 'inferred', confidence: 0.7, sourceWork: 'demo-w8' },
  { from: 'demo-i14', to: 'demo-i10', type: 'supports', basis: 'inferred', confidence: 0.76, sourceWork: 'demo-w9' },
  { from: 'demo-i15', to: 'demo-i14', type: 'refines', basis: 'explicit', confidence: 0.86, sourceWork: 'demo-w9' },
  { from: 'demo-i16', to: 'demo-i7', type: 'precondition_of', basis: 'inferred', confidence: 0.74, sourceWork: 'demo-w10' },
  { from: 'demo-i17', to: 'demo-i16', type: 'supports', basis: 'explicit', confidence: 0.83, sourceWork: 'demo-w10' },
  { from: 'demo-i18', to: 'demo-i5', type: 'applies_to', basis: 'explicit', confidence: 0.88, sourceWork: 'demo-w11' },
  { from: 'demo-i19', to: 'demo-i18', type: 'refines', basis: 'explicit', confidence: 0.8, sourceWork: 'demo-w11' },
  { from: 'demo-i21', to: 'demo-i20', type: 'precondition_of', basis: 'explicit', confidence: 0.85, sourceWork: 'demo-w12' },
  { from: 'demo-i20', to: 'demo-i16', type: 'supports', basis: 'inferred', confidence: 0.65, sourceWork: 'demo-w12' },
  { from: 'demo-i22', to: 'demo-i3', type: 'applies_to', basis: 'inferred', confidence: 0.73, sourceWork: 'demo-w13' },
  { from: 'demo-i23', to: 'demo-i22', type: 'supports', basis: 'explicit', confidence: 0.8, sourceWork: 'demo-w13' },
  { from: 'demo-i23', to: 'demo-i12', type: 'extends', basis: 'inferred', confidence: 0.76, sourceWork: 'demo-w13' },
  { from: 'demo-i24', to: 'demo-i19', type: 'precondition_of', basis: 'inferred', confidence: 0.77, sourceWork: 'demo-w14' },
  { from: 'demo-i25', to: 'demo-i24', type: 'contradicts', basis: 'inferred', confidence: 0.71, sourceWork: 'demo-w14' },
  { from: 'demo-i26', to: 'demo-i10', type: 'applies_to', basis: 'inferred', confidence: 0.74, sourceWork: 'demo-w15' },
  { from: 'demo-i27', to: 'demo-i26', type: 'supports', basis: 'explicit', confidence: 0.9, sourceWork: 'demo-w15' },
  { from: 'demo-i14', to: 'demo-i27', type: 'precondition_of', basis: 'inferred', confidence: 0.82, sourceWork: 'demo-w9' },
  { from: 'demo-i16', to: 'demo-i26', type: 'precondition_of', basis: 'inferred', confidence: 0.69, sourceWork: 'demo-w10' },
];

const GAPS: DemoGap[] = [
  { id: 'demo-g1', workId: 'demo-w4', relatedIdea: 'demo-i6', kind: 'unresolved_contradiction', confidence: 0.72, statement: { es: 'No está resuelto si la práctica de recuperación frecuente ayuda o perjudica a estudiantes con alta ansiedad ante los exámenes.', en: 'It remains unresolved whether frequent retrieval practice helps or harms students with high test anxiety.' } },
  { id: 'demo-g2', workId: 'demo-w2', relatedIdea: 'demo-i4', kind: 'limitation', confidence: 0.68, statement: { es: 'Buena parte de la evidencia sobre carga cognitiva procede de tareas de laboratorio, no de aulas reales.', en: 'Much of the evidence on cognitive load comes from laboratory tasks rather than real classrooms.' } },
  { id: 'demo-g3', workId: 'demo-w3', relatedIdea: 'demo-i3', kind: 'open_question', confidence: 0.7, statement: { es: '¿Cuál es el intervalo de espaciado óptimo para retener material conceptual durante un semestre completo?', en: 'What is the optimal spacing interval for retaining conceptual material across a full semester?' } },
  { id: 'demo-g4', workId: 'demo-w1', relatedIdea: 'demo-i1', kind: 'future_work', confidence: 0.66, statement: { es: 'Faltan estudios longitudinales que midan el efecto de prueba más allá de unas pocas semanas.', en: 'Longitudinal studies measuring the testing effect beyond a few weeks are lacking.' } },
  { id: 'demo-g5', workId: 'demo-w8', relatedIdea: 'demo-i12', kind: 'open_question', confidence: 0.69, statement: { es: '¿Qué grado de intercalado conserva el beneficio sin sobrecargar a principiantes?', en: 'How much interleaving preserves the benefit without overloading beginners?' } },
  { id: 'demo-g6', workId: 'demo-w9', relatedIdea: 'demo-i14', kind: 'limitation', confidence: 0.71, statement: { es: 'La eficacia del feedback depende del momento y de si el estudiante puede actuar sobre él.', en: 'The effectiveness of feedback depends on timing and whether the learner can act on it.' } },
  { id: 'demo-g7', workId: 'demo-w12', relatedIdea: 'demo-i20', kind: 'future_work', confidence: 0.65, statement: { es: 'Falta comparar estructuras colaborativas en entornos híbridos y asíncronos.', en: 'Collaborative structures still need comparison in hybrid and asynchronous settings.' } },
  { id: 'demo-g8', workId: 'demo-w13', relatedIdea: 'demo-i22', kind: 'open_question', confidence: 0.75, statement: { es: '¿Qué señales ayudan a reconocer espontáneamente que un principio se aplica en otro contexto?', en: 'Which cues help learners spontaneously recognize that a principle applies in another context?' } },
  { id: 'demo-g9', workId: 'demo-w14', relatedIdea: 'demo-i25', kind: 'unresolved_contradiction', confidence: 0.7, statement: { es: 'No está claro cuándo conviene confrontar una concepción errónea o construir primero un modelo alternativo.', en: 'It is unclear when to confront a misconception or first build an alternative model.' } },
  { id: 'demo-g10', workId: 'demo-w15', relatedIdea: 'demo-i26', kind: 'limitation', confidence: 0.73, statement: { es: 'La práctica deliberada exige tiempo, feedback experto y recursos que no están igualmente disponibles.', en: 'Deliberate practice requires time, expert feedback, and resources that are not equally available.' } },
];

const AUTHORS: { id: string; name: string }[] = [
  { id: 'demo-a1', name: 'Roediger, H. L.' },
  { id: 'demo-a2', name: 'Karpicke, J. D.' },
  { id: 'demo-a3', name: 'Sweller, J.' },
  { id: 'demo-a4', name: 'Cepeda, N. J.' },
  { id: 'demo-a5', name: 'Pashler, H.' },
  { id: 'demo-a6', name: 'Putwain, D. W.' },
  { id: 'demo-a7', name: 'Zimmerman, B. J.' },
  { id: 'demo-a8', name: 'Slamecka, N. J.' },
  { id: 'demo-a9', name: 'Graf, P.' },
  { id: 'demo-a10', name: 'Dunlosky, J.' },
  { id: 'demo-a11', name: 'Rawson, K. A.' },
  { id: 'demo-a12', name: 'Kornell, N.' },
  { id: 'demo-a13', name: 'Bjork, R. A.' },
  { id: 'demo-a14', name: 'Hattie, J.' },
  { id: 'demo-a15', name: 'Timperley, H.' },
  { id: 'demo-a16', name: 'Bandura, A.' },
  { id: 'demo-a17', name: 'Mayer, R. E.' },
  { id: 'demo-a18', name: 'Johnson, D. W.' },
  { id: 'demo-a19', name: 'Johnson, R. T.' },
  { id: 'demo-a20', name: 'Barnett, S. M.' },
  { id: 'demo-a21', name: 'Ceci, S. J.' },
  { id: 'demo-a22', name: 'Ausubel, D. P.' },
  { id: 'demo-a23', name: 'Ericsson, K. A.' },
  { id: 'demo-a24', name: 'Krampe, R. T.' },
  { id: 'demo-a25', name: 'Tesch-Römer, C.' },
];

const WORK_AUTHORS: { workId: string; authorId: string }[] = [
  { workId: 'demo-w1', authorId: 'demo-a1' }, { workId: 'demo-w1', authorId: 'demo-a2' },
  { workId: 'demo-w2', authorId: 'demo-a3' },
  { workId: 'demo-w3', authorId: 'demo-a4' }, { workId: 'demo-w3', authorId: 'demo-a5' },
  { workId: 'demo-w4', authorId: 'demo-a6' },
  { workId: 'demo-w5', authorId: 'demo-a7' },
  { workId: 'demo-w6', authorId: 'demo-a8' }, { workId: 'demo-w6', authorId: 'demo-a9' },
  { workId: 'demo-w7', authorId: 'demo-a10' }, { workId: 'demo-w7', authorId: 'demo-a11' },
  { workId: 'demo-w8', authorId: 'demo-a12' }, { workId: 'demo-w8', authorId: 'demo-a13' },
  { workId: 'demo-w9', authorId: 'demo-a14' }, { workId: 'demo-w9', authorId: 'demo-a15' },
  { workId: 'demo-w10', authorId: 'demo-a16' },
  { workId: 'demo-w11', authorId: 'demo-a17' },
  { workId: 'demo-w12', authorId: 'demo-a18' }, { workId: 'demo-w12', authorId: 'demo-a19' },
  { workId: 'demo-w13', authorId: 'demo-a20' }, { workId: 'demo-w13', authorId: 'demo-a21' },
  { workId: 'demo-w14', authorId: 'demo-a22' },
  { workId: 'demo-w15', authorId: 'demo-a23' }, { workId: 'demo-w15', authorId: 'demo-a24' }, { workId: 'demo-w15', authorId: 'demo-a25' },
];

const AUTHOR_RELATIONS: { from: string; to: string; type: string; weight: number }[] = [
  { from: 'demo-a1', to: 'demo-a2', type: 'coauthor', weight: 1 },
  { from: 'demo-a4', to: 'demo-a5', type: 'coauthor', weight: 1 },
  { from: 'demo-a8', to: 'demo-a9', type: 'coauthor', weight: 1 },
  { from: 'demo-a10', to: 'demo-a11', type: 'coauthor', weight: 1 },
  { from: 'demo-a12', to: 'demo-a13', type: 'coauthor', weight: 1 },
  { from: 'demo-a14', to: 'demo-a15', type: 'coauthor', weight: 1 },
  { from: 'demo-a18', to: 'demo-a19', type: 'coauthor', weight: 1 },
  { from: 'demo-a20', to: 'demo-a21', type: 'coauthor', weight: 1 },
  { from: 'demo-a23', to: 'demo-a24', type: 'coauthor', weight: 1 },
  { from: 'demo-a23', to: 'demo-a25', type: 'coauthor', weight: 1 },
  { from: 'demo-a24', to: 'demo-a25', type: 'coauthor', weight: 1 },
];

interface DemoNote {
  id: string;
  folderId: string | null;
  title: Localized;
  body: { es: string[]; en: string[] };
  order: number;
}

const FOLDER = {
  id: 'demo-folder-1',
  name: { es: 'Marco teórico (demo)', en: 'Theoretical framework (demo)' } as Localized,
  summary: {
    es: 'Notas de ejemplo que sintetizan las ideas del corpus de demostración sobre la ciencia del aprendizaje.',
    en: 'Sample notes that synthesize the ideas of the demo corpus on the science of learning.',
  } as Localized,
};

const NOTES: DemoNote[] = [
  {
    id: 'demo-note-1', folderId: null, order: 0,
    title: { es: 'Bienvenido al modo demo', en: 'Welcome to demo mode' },
    body: {
      es: [
        '# Estás viendo Nodus con datos de ejemplo',
        '',
        'Este corpus de demostración reúne quince obras sobre la **ciencia del aprendizaje** para que puedas recorrer la app sin conectar Zotero ni configurar una clave de IA.',
        '',
        '- **Grafo** e **Ideas**: veintisiete ideas con su evidencia, agrupadas en doce temas.',
        '- **Debates**: una contradicción real entre el efecto de prueba y la ansiedad ante los exámenes.',
        '- **Huecos**: diez huecos de investigación derivados de las obras.',
        '- **Notas**: estas notas y la carpeta «Marco teórico».',
        '',
        'Para empezar con tu propia biblioteca, sal del modo demo desde la cabecera o en Ajustes → Datos. Se borrará todo lo de ejemplo.',
      ],
      en: [
        '# You are viewing Nodus with sample data',
        '',
        'This demo corpus gathers fifteen works on the **science of learning** so you can explore the app without connecting Zotero or configuring an AI key.',
        '',
        '- **Graph** and **Ideas**: twenty-seven ideas with their evidence, grouped into twelve themes.',
        '- **Debates**: a real contradiction between the testing effect and test anxiety.',
        '- **Gaps**: ten research gaps derived from the works.',
        '- **Notes**: these notes and the “Theoretical framework” folder.',
        '',
        'To start with your own library, leave demo mode from the header or in Settings → Data. All sample data will be removed.',
      ],
    },
  },
  {
    id: 'demo-note-2', folderId: 'demo-folder-1', order: 0,
    title: { es: 'Por qué funciona la recuperación', en: 'Why retrieval works' },
    body: {
      es: [
        '## Síntesis',
        '',
        'La **práctica de recuperación** (Roediger & Karpicke, 2006) mejora la retención porque el esfuerzo de recordar modifica la traza de memoria. El **efecto de generación** (Slamecka & Graf, 1978) apunta en la misma dirección: producir la respuesta supera a leerla.',
        '',
        'El **espaciado** (Cepeda & Pashler, 2006) añade un segundo mecanismo: distribuir las sesiones permite consolidar entre repeticiones.',
        '',
        '> Tensión a resolver: la recuperación frecuente podría no convenir a estudiantes con alta ansiedad ante los exámenes (Putwain, 2008).',
      ],
      en: [
        '## Synthesis',
        '',
        '**Retrieval practice** (Roediger & Karpicke, 2006) improves retention because the effort of recalling modifies the memory trace. The **generation effect** (Slamecka & Graf, 1978) points in the same direction: producing the answer beats reading it.',
        '',
        '**Spacing** (Cepeda & Pashler, 2006) adds a second mechanism: distributing sessions allows consolidation between repetitions.',
        '',
        '> Tension to resolve: frequent retrieval may not suit students with high test anxiety (Putwain, 2008).',
      ],
    },
  },
  {
    id: 'demo-note-3', folderId: 'demo-folder-1', order: 1,
    title: { es: 'Preguntas abiertas para la tesis', en: 'Open questions for the thesis' },
    body: {
      es: [
        '## Candidatas a pregunta de investigación',
        '',
        '1. ¿Cuál es el intervalo de espaciado óptimo a lo largo de un semestre?',
        '2. ¿Cómo interactúan la práctica de recuperación y la ansiedad ante los exámenes?',
        '3. ¿Se sostiene el efecto de carga cognitiva fuera del laboratorio?',
      ],
      en: [
        '## Candidate research questions',
        '',
        '1. What is the optimal spacing interval across a semester?',
        '2. How do retrieval practice and test anxiety interact?',
        '3. Does the cognitive-load effect hold outside the laboratory?',
      ],
    },
  },
];

/** True when the database holds any user content (real or demo). Gates the demo offer. */
export function hasAnyData(): boolean {
  const db = getDb();
  const count = (table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return (
    count('works') > 0 ||
    count('notes') > 0 ||
    count('note_folders') > 0 ||
    count('ideas') > 0 ||
    // Genealogy content (the records-lens demo lives here, not in works/ideas).
    count('persons') > 0 ||
    count('archive_items') > 0 ||
    count('events') > 0 ||
    // Databases-mode content.
    count('db_databases') > 0 ||
    // Study-vault content is first-class data too; without these checks an
    // existing study workspace could incorrectly be offered another demo.
    count('study_courses') > 0 ||
    count('study_docs') > 0 ||
    count('study_materials') > 0 ||
    count('study_recordings') > 0 ||
    count('study_questions') > 0 ||
    // Teaching-vault content. A teacher can have a full class list, rubrics, exams and
    // a gradebook without ever creating a study_* row, so leaving these out reported an
    // established workspace as empty and offered to seed the demo on top of it.
    count('teaching_groups') > 0 ||
    count('teaching_rubrics') > 0 ||
    count('teaching_exams') > 0 ||
    count('teaching_assessment_plans') > 0
  );
}

/**
 * Seed the curated demo corpus. No-op (returns false) if any data already exists,
 * so it can never overwrite a real library. Sets the `demoMode` flag on success.
 * Reader-facing text follows the current interface language (Spanish or English).
 */
export function seedDemoData(): boolean {
  const db = getDb();
  if (hasAnyData()) return false;

  const L = demoLocale();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const insWork = db.prepare(
      `INSERT INTO works (nodus_id, zotero_key, title, authors_json, year, item_type, read_tag, manual_deep,
         source_type, light_status, light_at, deep_status, deep_at, summary_status, archived)
       VALUES (?, ?, ?, ?, ?, 'journalArticle', ?, 1, 'abstract_only', 'done', ?, 'done', ?, 'none', 0)`
    );
    for (const w of WORKS) {
      insWork.run(w.id, `${DEMO_PREFIX}${w.id}`, w.title[L], JSON.stringify(w.authors), w.year, w.read ? 1 : 0, now, now);
    }

    const insTheme = db.prepare('INSERT INTO themes (theme_id, label, created_at, pinned) VALUES (?, ?, ?, 0)');
    const insWorkTheme = db.prepare('INSERT OR IGNORE INTO work_themes (nodus_id, theme_id) VALUES (?, ?)');
    for (const th of THEMES) insTheme.run(th.id, th.label[L], now);

    const insIdea = db.prepare('INSERT INTO ideas (global_id, type, label, statement, created_at) VALUES (?, ?, ?, ?, ?)');
    const insOcc = db.prepare(
      'INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence) VALUES (?, ?, ?, ?, ?)'
    );
    const insEvidence = db.prepare(
      'INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insThemeLink = db.prepare(
      'INSERT OR IGNORE INTO idea_theme_links (nodus_id, global_id, theme_id, confidence, basis) VALUES (?, ?, ?, ?, ?)'
    );
    for (const idea of IDEAS) {
      insIdea.run(idea.id, idea.type, idea.label[L], idea.statement[L], now);
      insOcc.run(idea.id, idea.workId, idea.role, idea.development[L], idea.confidence);
      insEvidence.run(`${idea.id}-ev`, idea.id, idea.workId, idea.evidence.quote, idea.evidence.location, idea.evidence.kind);
      insThemeLink.run(idea.workId, idea.id, idea.themeId, idea.confidence, 'explicit');
      insWorkTheme.run(idea.workId, idea.themeId);
    }

    const insEdge = db.prepare(
      'INSERT OR IGNORE INTO edges (id, from_id, to_id, type, basis, confidence, source_work) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    EDGES.forEach((e, i) => {
      insEdge.run(`demo-e${i + 1}`, e.from, e.to, e.type, e.basis, e.confidence, e.sourceWork);
    });

    const insGap = db.prepare(
      'INSERT INTO gaps (id, nodus_id, related_idea, kind, statement, confidence, evidence_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const g of GAPS) insGap.run(g.id, g.workId, g.relatedIdea, g.kind, g.statement[L], g.confidence, `${g.relatedIdea}-ev`);

    const insAuthor = db.prepare('INSERT INTO authors (author_id, name, affiliation) VALUES (?, ?, NULL)');
    const insWorkAuthor = db.prepare('INSERT OR IGNORE INTO work_authors (nodus_id, author_id) VALUES (?, ?)');
    const insAuthorRel = db.prepare(
      'INSERT OR IGNORE INTO author_relations (from_author, to_author, type, weight) VALUES (?, ?, ?, ?)'
    );
    for (const a of AUTHORS) insAuthor.run(a.id, a.name);
    for (const wa of WORK_AUTHORS) insWorkAuthor.run(wa.workId, wa.authorId);
    for (const ar of AUTHOR_RELATIONS) insAuthorRel.run(ar.from, ar.to, ar.type, ar.weight);

    const insFolder = db.prepare(
      'INSERT INTO note_folders (id, parent_id, name, order_idx, created_at, updated_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    insFolder.run(FOLDER.id, null, FOLDER.name[L], 0, now, now, FOLDER.summary[L]);

    const insNote = db.prepare(
      'INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)'
    );
    for (const note of NOTES) {
      insNote.run(note.id, note.folderId, note.title[L], 'markdown', note.body[L].join('\n'), note.order, now, now);
    }

    // Persisted examples for the sections that otherwise only show a composer.
    db.prepare(`INSERT INTO research_questions
      (id,question,notes,model_json,status,corpus_ideas,corpus_works,created_at,updated_at,mapped_at)
      VALUES (?,?,?,NULL,'mapped',?,?,?,?,?)`)
      .run('demo-research-question', L === 'es' ? '¿Cómo se combinan el espaciado y la práctica de recuperación para mejorar la retención?' : 'How do spacing and retrieval practice combine to improve retention?', L === 'es' ? 'Mapa de cobertura de ejemplo, editable y respaldado por el corpus demo.' : 'Editable sample coverage map backed by the demo corpus.', IDEAS.length, WORKS.length, now, now, now);
    const insertSubQuestion = db.prepare('INSERT INTO research_subquestions (id,rq_id,text,rationale,order_idx,coverage_status,justification,created_at) VALUES (?,?,?,?,?,?,?,?)');
    insertSubQuestion.run('demo-research-subq-1', 'demo-research-question', L === 'es' ? '¿Qué evidencia compara recuperación y relectura?' : 'What evidence compares retrieval and rereading?', L === 'es' ? 'Establece el efecto principal.' : 'Establishes the main effect.', 0, 'covered', L === 'es' ? 'Dos ideas y una obra ofrecen evidencia directa.' : 'Two ideas and one work provide direct evidence.', now);
    insertSubQuestion.run('demo-research-subq-2', 'demo-research-question', L === 'es' ? '¿Qué intervalo de espaciado es óptimo a largo plazo?' : 'What spacing interval is optimal in the long term?', L === 'es' ? 'Identifica la frontera del corpus.' : 'Identifies the corpus frontier.', 1, 'partial', L === 'es' ? 'Hay evidencia del beneficio, pero no un intervalo universal.' : 'There is evidence of benefit, but no universal interval.', now);
    const insertCoverage = db.prepare('INSERT INTO research_coverage_links (id,subq_id,kind,ref_id,label,score,read_state,created_at) VALUES (?,?,?,?,?,?,?,?)');
    insertCoverage.run('demo-research-link-1', 'demo-research-subq-1', 'idea', 'demo-i1', IDEAS[0].label[L], 0.94, 'read', now);
    insertCoverage.run('demo-research-link-2', 'demo-research-subq-2', 'gap', 'demo-g3', GAPS[2].statement[L], 0.82, 'read', now);

    const selection = { ideaIds: ['demo-i1', 'demo-i3'], themeIds: ['demo-t1', 'demo-t2'], gapIds: ['demo-g3'], contradictionIds: [], workIds: ['demo-w1', 'demo-w3'], passageIds: [], tutorRouteIds: [] };
    const draftStats = { selectedIdeas: 2, selectedThemes: 2, selectedGaps: 1, selectedContradictions: 0, selectedWorks: 2, selectedPassages: 0, selectedTutorRoutes: 0, contextChars: 1_420, truncated: false };
    const savedDrafts = [
      {
        id: 'demo-writing-draft', kind: 'literature_review',
        title: L === 'es' ? 'Espaciado y recuperación: revisión breve' : 'Spacing and retrieval: a short review',
        objective: L === 'es' ? 'Sintetizar dos estrategias de aprendizaje con evidencia.' : 'Synthesize two evidence-based learning strategies.',
        abstract: L === 'es' ? 'Borrador de ejemplo para explorar el taller de escritura, su matriz y la bibliografía.' : 'A sample draft for exploring the writing workshop, its matrix, and bibliography.',
        markdown: L === 'es' ? '## Síntesis\n\nLa recuperación activa mejora la retención frente a la relectura, mientras que el espaciado distribuye el esfuerzo para favorecer la consolidación. Ambas estrategias pueden combinarse en sesiones breves y repetidas.' : '## Synthesis\n\nActive retrieval improves retention over rereading, while spacing distributes effort to support consolidation. Both strategies can be combined in short, repeated sessions.',
      },
      {
        id: 'demo-deep-research-draft', kind: 'deep_research',
        title: L === 'es' ? 'Informe profundo · ciencia del aprendizaje' : 'Deep report · learning science',
        objective: L === 'es' ? 'Examinar beneficios, límites y preguntas abiertas del corpus.' : 'Examine benefits, limits, and open questions in the corpus.',
        abstract: L === 'es' ? 'Informe guardado de demostración que permite abrir directamente la experiencia de investigación profunda.' : 'A saved demo report that opens the deep-research experience directly.',
        markdown: L === 'es' ? '## Hallazgos\n\nEl corpus respalda la recuperación y el espaciado, pero también señala límites: ansiedad ante los exámenes, transferencia desde el laboratorio y falta de seguimientos longitudinales.\n\n## Agenda futura\n\nComparar intervalos y perfiles de alumnado en contextos reales.' : '## Findings\n\nThe corpus supports retrieval and spacing, while also identifying limits: test anxiety, transfer from laboratory settings, and missing longitudinal follow-up.\n\n## Future agenda\n\nCompare intervals and learner profiles in real settings.',
      },
    ];
    const insertDraft = db.prepare('INSERT INTO writing_saved_drafts (id,title,brief_json,selection_json,model_json,draft_json,created_at,updated_at) VALUES (?,?,?,?,NULL,?,?,?)');
    for (const item of savedDrafts) {
      const brief = { kind: item.kind, objective: item.objective, tone: 'critical', language: L };
      const draft = { generatedAt: now, brief, selection, title: item.title, abstract: item.abstract, outline: [{ id: `${item.id}-section`, title: L === 'es' ? 'Síntesis' : 'Synthesis', purpose: item.objective, keyClaims: [IDEAS[0].statement[L]], sources: ['demo-w1', 'demo-w3'] }], draftMarkdown: item.markdown, matrix: [{ claim: IDEAS[0].statement[L], role: 'support', sourceLabel: WORKS[0].title[L], citation: '(Roediger & Karpicke, 2006)', evidence: IDEAS[0].evidence.quote, notes: '' }], bibliography: [`Roediger, H. L. & Karpicke, J. D. (2006). ${WORKS[0].title[L]}.`], nextSteps: [L === 'es' ? 'Añadir evidencia longitudinal.' : 'Add longitudinal evidence.'], limitations: [GAPS[3].statement[L]], stats: draftStats };
      insertDraft.run(item.id, item.title, JSON.stringify(brief), JSON.stringify(selection), JSON.stringify(draft), now, now);
    }

    const immersionPlan = {
      topic: L === 'es' ? 'Práctica de recuperación' : 'Retrieval practice', title: L === 'es' ? 'Ruta guiada · aprender recuperando' : 'Guided route · learning by retrieval', language: L, minutes: 90, generatedAt: now, model: null,
      overview: L === 'es' ? 'Una ruta de ejemplo que conecta efecto de prueba, generación y espaciado.' : 'A sample route connecting the testing effect, generation, and spacing.',
      keyTerms: [{ term: L === 'es' ? 'recuperación activa' : 'active retrieval', definition: IDEAS[1].statement[L] }],
      stations: [{ id: 'demo-immersion-station', title: L === 'es' ? 'Recuperar frente a releer' : 'Retrieval versus rereading', question: L === 'es' ? '¿Por qué recordar activamente deja una huella más duradera?' : 'Why does active recall leave a more durable trace?', minutes: 28, context: IDEAS[1].statement[L], synthesis: IDEAS[0].development[L], citations: [], positions: [{ authorId: 'demo-a1', name: 'Roediger, H. L.', position: IDEAS[0].statement[L], ideaIds: ['demo-i1'] }], takeaways: [IDEAS[0].statement[L]], ideaIds: ['demo-i1', 'demo-i2'], quiz: [{ id: 'demo-immersion-quiz', kind: 'choice', question: L === 'es' ? '¿Qué estrategia produjo mejor retención a largo plazo?' : 'Which strategy produced better long-term retention?', options: [L === 'es' ? 'Relectura' : 'Rereading', L === 'es' ? 'Recuperación activa' : 'Active retrieval'], correctIndex: 1, explanation: IDEAS[0].statement[L], expected: '', ideaIds: ['demo-i1'] }] }],
      contrasts: { authors: ['Roediger, H. L.'], rows: [] }, frontiers: [{ kind: 'gap', statement: GAPS[3].statement[L], detail: L === 'es' ? 'El corpus invita a ampliar el seguimiento temporal.' : 'The corpus calls for longer follow-up.', workTitle: WORKS[0].title[L] }], exam: { questions: [], feynman: L === 'es' ? 'Explica con tus palabras por qué recuperar no equivale a releer.' : 'Explain in your own words why retrieval is not the same as rereading.' },
      graph: { nodes: [], edges: [] }, ideaIndex: [{ id: 'demo-i1', label: IDEAS[0].label[L], statement: IDEAS[0].statement[L], authors: WORKS[0].authors, workTitles: [WORKS[0].title[L]] }], stats: { stations: 1, ideas: 2, works: 1, authors: 1, citations: 0, quizQuestions: 1 }, stoppedReason: null,
    };
    const immersionProgress = { currentStep: 1, furthestStep: 1, completedSteps: [0], answers: [], startedAt: now, finishedAt: null };
    db.prepare('INSERT INTO immersion_sessions (id,topic,title,language,minutes,model_json,plan_json,progress_json,stats_json,created_at,updated_at) VALUES (?,?,?,?,?,NULL,?,?,?,?,?)')
      .run('demo-immersion-session', immersionPlan.topic, immersionPlan.title, L, 90, JSON.stringify(immersionPlan), JSON.stringify(immersionProgress), JSON.stringify(immersionPlan.stats), now, now);

    db.prepare(`INSERT INTO projects
      (id,title,kind,status,brief,research_question_id,root_folder_id,model_json,target_words,created_at,updated_at)
      VALUES (?,?,?,'active',?,?,?,NULL,2500,?,?)`)
      .run('demo-project-learning', L === 'es' ? 'Capítulo · estrategias de aprendizaje' : 'Chapter · learning strategies', 'chapter', L === 'es' ? 'Convertir el corpus demo en un capítulo académico estructurado.' : 'Turn the demo corpus into a structured academic chapter.', 'demo-research-question', FOLDER.id, now, now);
    db.prepare('INSERT INTO project_sections (id,project_id,folder_id,title,role,status,target_words,order_idx,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('demo-project-section', 'demo-project-learning', FOLDER.id, L === 'es' ? 'Revisión de evidencia' : 'Evidence review', 'body', 'drafting', 1200, 0, now, now);
    db.prepare('INSERT INTO project_links (id,project_id,section_id,kind,ref_id,label,role,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('demo-project-link', 'demo-project-learning', 'demo-project-section', 'work', 'demo-w1', WORKS[0].title[L], 'evidence', now);

    updateSettings({ demoMode: true });
  });
  tx();
  return true;
}

/**
 * Remove every demo row by its `demo-` id prefix and clear the `demoMode` flag.
 * Guarded by the flag, so it never touches a real library even if called twice.
 */
export function clearDemoData(): void {
  // The genealogy + databases demos live in separate tables and also restore the
  // vault type (whichever the demo flipped away from).
  clearGenealogyDemoData();
  clearDatabasesDemoData();
  clearStudyDemoData();
  clearTeachingDemoData();
  const db = getDb();
  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM project_links WHERE id LIKE 'demo-%';
      DELETE FROM project_chapters WHERE id LIKE 'demo-%';
      DELETE FROM project_sections WHERE id LIKE 'demo-%';
      DELETE FROM projects WHERE id LIKE 'demo-%';
      DELETE FROM immersion_sessions WHERE id LIKE 'demo-%';
      DELETE FROM writing_saved_drafts WHERE id LIKE 'demo-%';
      DELETE FROM research_coverage_links WHERE id LIKE 'demo-%';
      DELETE FROM research_subquestions WHERE id LIKE 'demo-%';
      DELETE FROM research_questions WHERE id LIKE 'demo-%';
      DELETE FROM idea_theme_links WHERE global_id LIKE 'demo-%';
      DELETE FROM idea_occurrences WHERE global_id LIKE 'demo-%';
      DELETE FROM evidence WHERE id LIKE 'demo-%';
      DELETE FROM gaps WHERE id LIKE 'demo-%';
      DELETE FROM edges WHERE id LIKE 'demo-%';
      DELETE FROM ideas WHERE global_id LIKE 'demo-%';
      DELETE FROM work_themes WHERE theme_id LIKE 'demo-%';
      DELETE FROM themes WHERE theme_id LIKE 'demo-%';
      DELETE FROM work_authors WHERE author_id LIKE 'demo-%';
      DELETE FROM author_relations WHERE from_author LIKE 'demo-%' OR to_author LIKE 'demo-%';
      DELETE FROM authors WHERE author_id LIKE 'demo-%';
      DELETE FROM notes WHERE id LIKE 'demo-%';
      DELETE FROM note_folders WHERE id LIKE 'demo-%';
      DELETE FROM works WHERE nodus_id LIKE 'demo-%';
    `);
    updateSettings({ demoMode: false });
  });
  tx();
}
