import { getDb } from './database';
import { getSettings, updateSettings } from './settingsRepo';
import { clearGenealogyDemoData } from './genealogyDemoData';

// A small, self-consistent corpus on the science of learning. It exists so a
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
];

const THEMES: { id: string; label: Localized }[] = [
  { id: 'demo-t1', label: { es: 'Consolidación de la memoria', en: 'Memory consolidation' } },
  { id: 'demo-t2', label: { es: 'Práctica de recuperación', en: 'Retrieval practice' } },
  { id: 'demo-t3', label: { es: 'Carga cognitiva', en: 'Cognitive load' } },
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
];

const EDGES: DemoEdge[] = [
  { from: 'demo-i2', to: 'demo-i1', type: 'supports', basis: 'explicit', confidence: 0.88, sourceWork: 'demo-w1' },
  { from: 'demo-i8', to: 'demo-i2', type: 'supports', basis: 'inferred', confidence: 0.8, sourceWork: 'demo-w6' },
  { from: 'demo-i9', to: 'demo-i3', type: 'extends', basis: 'explicit', confidence: 0.76, sourceWork: 'demo-w3' },
  { from: 'demo-i5', to: 'demo-i4', type: 'refines', basis: 'explicit', confidence: 0.82, sourceWork: 'demo-w2' },
  { from: 'demo-i6', to: 'demo-i1', type: 'contradicts', basis: 'inferred', confidence: 0.7, sourceWork: 'demo-w4' },
  { from: 'demo-i5', to: 'demo-i2', type: 'shares_method', basis: 'inferred', confidence: 0.62, sourceWork: 'demo-w2' },
];

const GAPS: DemoGap[] = [
  { id: 'demo-g1', workId: 'demo-w4', relatedIdea: 'demo-i6', kind: 'unresolved_contradiction', confidence: 0.72, statement: { es: 'No está resuelto si la práctica de recuperación frecuente ayuda o perjudica a estudiantes con alta ansiedad ante los exámenes.', en: 'It remains unresolved whether frequent retrieval practice helps or harms students with high test anxiety.' } },
  { id: 'demo-g2', workId: 'demo-w2', relatedIdea: 'demo-i4', kind: 'limitation', confidence: 0.68, statement: { es: 'Buena parte de la evidencia sobre carga cognitiva procede de tareas de laboratorio, no de aulas reales.', en: 'Much of the evidence on cognitive load comes from laboratory tasks rather than real classrooms.' } },
  { id: 'demo-g3', workId: 'demo-w3', relatedIdea: 'demo-i3', kind: 'open_question', confidence: 0.7, statement: { es: '¿Cuál es el intervalo de espaciado óptimo para retener material conceptual durante un semestre completo?', en: 'What is the optimal spacing interval for retaining conceptual material across a full semester?' } },
  { id: 'demo-g4', workId: 'demo-w1', relatedIdea: 'demo-i1', kind: 'future_work', confidence: 0.66, statement: { es: 'Faltan estudios longitudinales que midan el efecto de prueba más allá de unas pocas semanas.', en: 'Longitudinal studies measuring the testing effect beyond a few weeks are lacking.' } },
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
];

const WORK_AUTHORS: { workId: string; authorId: string }[] = [
  { workId: 'demo-w1', authorId: 'demo-a1' }, { workId: 'demo-w1', authorId: 'demo-a2' },
  { workId: 'demo-w2', authorId: 'demo-a3' },
  { workId: 'demo-w3', authorId: 'demo-a4' }, { workId: 'demo-w3', authorId: 'demo-a5' },
  { workId: 'demo-w4', authorId: 'demo-a6' },
  { workId: 'demo-w5', authorId: 'demo-a7' },
  { workId: 'demo-w6', authorId: 'demo-a8' }, { workId: 'demo-w6', authorId: 'demo-a9' },
];

const AUTHOR_RELATIONS: { from: string; to: string; type: string; weight: number }[] = [
  { from: 'demo-a1', to: 'demo-a2', type: 'coauthor', weight: 1 },
  { from: 'demo-a4', to: 'demo-a5', type: 'coauthor', weight: 1 },
  { from: 'demo-a8', to: 'demo-a9', type: 'coauthor', weight: 1 },
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
        'Este corpus de demostración reúne seis obras sobre la **ciencia del aprendizaje** para que puedas recorrer la app sin conectar Zotero ni configurar una clave de IA.',
        '',
        '- **Grafo** e **Ideas**: nueve ideas con su evidencia, agrupadas en tres temas.',
        '- **Debates**: una contradicción real entre el efecto de prueba y la ansiedad ante los exámenes.',
        '- **Huecos**: cuatro huecos de investigación derivados de las obras.',
        '- **Notas**: estas notas y la carpeta «Marco teórico».',
        '',
        'Para empezar con tu propia biblioteca, sal del modo demo desde la cabecera o en Ajustes → Datos. Se borrará todo lo de ejemplo.',
      ],
      en: [
        '# You are viewing Nodus with sample data',
        '',
        'This demo corpus gathers six works on the **science of learning** so you can explore the app without connecting Zotero or configuring an AI key.',
        '',
        '- **Graph** and **Ideas**: nine ideas with their evidence, grouped into three themes.',
        '- **Debates**: a real contradiction between the testing effect and test anxiety.',
        '- **Gaps**: four research gaps derived from the works.',
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
    count('events') > 0
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
  // The genealogy demo lives in separate tables and also restores the vault type.
  clearGenealogyDemoData();
  const db = getDb();
  const tx = db.transaction(() => {
    db.exec(`
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
