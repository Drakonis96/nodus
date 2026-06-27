import { getDb } from './database';
import { updateSettings } from './settingsRepo';

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

const DEMO_PREFIX = 'demo-';

interface DemoWork {
  id: string;
  title: string;
  authors: string[];
  year: number;
  read: boolean;
}

interface DemoIdea {
  id: string;
  type: 'claim' | 'finding' | 'construct' | 'method' | 'framework';
  label: string;
  statement: string;
  workId: string;
  themeId: string;
  role: 'support' | 'contrast' | 'gap' | 'method' | 'definition' | 'context';
  development: string;
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
  statement: string;
  confidence: number;
}

const WORKS: DemoWork[] = [
  { id: 'demo-w1', title: 'Práctica de recuperación y retención a largo plazo', authors: ['Roediger, H. L.', 'Karpicke, J. D.'], year: 2006, read: true },
  { id: 'demo-w2', title: 'Teoría de la carga cognitiva y diseño instruccional', authors: ['Sweller, J.'], year: 1988, read: true },
  { id: 'demo-w3', title: 'Efectos del espaciado en el aprendizaje y la consolidación', authors: ['Cepeda, N. J.', 'Pashler, H.'], year: 2006, read: true },
  { id: 'demo-w4', title: 'Ansiedad ante los exámenes y rendimiento académico', authors: ['Putwain, D. W.'], year: 2008, read: false },
  { id: 'demo-w5', title: 'Autorregulación del aprendizaje: una visión general', authors: ['Zimmerman, B. J.'], year: 2002, read: true },
  { id: 'demo-w6', title: 'El efecto de generación en la memoria', authors: ['Slamecka, N. J.', 'Graf, P.'], year: 1978, read: false },
];

const THEMES: { id: string; label: string }[] = [
  { id: 'demo-t1', label: 'Consolidación de la memoria' },
  { id: 'demo-t2', label: 'Práctica de recuperación' },
  { id: 'demo-t3', label: 'Carga cognitiva' },
];

const IDEAS: DemoIdea[] = [
  {
    id: 'demo-i1', type: 'finding', label: 'El efecto de prueba refuerza la retención',
    statement: 'Recuperar información en una prueba produce mejor retención a largo plazo que volver a estudiarla.',
    workId: 'demo-w1', themeId: 'demo-t2', role: 'support', confidence: 0.92,
    development: 'En un seguimiento a una semana, el grupo que se autoevaluó retuvo notablemente más que el grupo que releyó el material.',
    evidence: { quote: 'Taking a test on studied material promotes better long-term retention than restudying the same material.', location: 'p. 250', kind: 'explicit' },
  },
  {
    id: 'demo-i2', type: 'claim', label: 'La recuperación activa supera a la relectura',
    statement: 'El esfuerzo de recuperar desde la memoria deja una huella más duradera que la exposición repetida y pasiva.',
    workId: 'demo-w1', themeId: 'demo-t2', role: 'context', confidence: 0.84,
    development: 'La dificultad deseable de la recuperación es justamente lo que fortalece la traza mnémica.',
    evidence: { quote: 'The act of retrieval is itself a memory modifier.', location: 'p. 252', kind: 'paraphrased' },
  },
  {
    id: 'demo-i3', type: 'finding', label: 'El espaciado mejora la retención frente al estudio masivo',
    statement: 'Distribuir las sesiones de estudio en el tiempo produce más retención que concentrarlas.',
    workId: 'demo-w3', themeId: 'demo-t1', role: 'support', confidence: 0.9,
    development: 'El beneficio del espaciado crece con el intervalo de retención objetivo.',
    evidence: { quote: 'Spaced practice yielded reliably higher retention than massed practice across retention intervals.', location: 'p. 354', kind: 'explicit' },
  },
  {
    id: 'demo-i4', type: 'construct', label: 'Carga cognitiva intrínseca frente a extrínseca',
    statement: 'La memoria de trabajo soporta una carga intrínseca a la tarea y una carga extrínseca impuesta por el diseño del material.',
    workId: 'demo-w2', themeId: 'demo-t3', role: 'definition', confidence: 0.88,
    development: 'Distinguir ambos tipos de carga permite rediseñar materiales sin simplificar el contenido en sí.',
    evidence: { quote: 'Extraneous cognitive load is imposed by the manner in which information is presented.', location: 'p. 261', kind: 'explicit' },
  },
  {
    id: 'demo-i5', type: 'claim', label: 'Reducir la carga extrínseca libera memoria de trabajo',
    statement: 'Eliminar elementos de diseño superfluos deja capacidad de memoria de trabajo para el aprendizaje genuino.',
    workId: 'demo-w2', themeId: 'demo-t3', role: 'support', confidence: 0.81,
    development: 'De aquí se derivan principios como evitar la atención dividida y la redundancia.',
    evidence: { quote: 'Reducing extraneous load frees working memory resources for schema construction.', location: 'p. 263', kind: 'paraphrased' },
  },
  {
    id: 'demo-i6', type: 'finding', label: 'La ansiedad ante los exámenes reduce el rendimiento',
    statement: 'Niveles altos de ansiedad ante la evaluación se asocian con un peor rendimiento en las pruebas.',
    workId: 'demo-w4', themeId: 'demo-t2', role: 'contrast', confidence: 0.79,
    development: 'La preocupación consume recursos de memoria de trabajo durante la prueba.',
    evidence: { quote: 'Test anxiety was negatively associated with examination performance.', location: 'p. 142', kind: 'explicit' },
  },
  {
    id: 'demo-i7', type: 'framework', label: 'Ciclo de autorregulación: planificar, monitorizar, evaluar',
    statement: 'El aprendizaje autorregulado se organiza en fases de previsión, ejecución con automonitorización y autorreflexión.',
    workId: 'demo-w5', themeId: 'demo-t1', role: 'definition', confidence: 0.86,
    development: 'Las estrategias de estudio eficaces dependen de que el estudiante regule su propio proceso.',
    evidence: { quote: 'Self-regulation unfolds across forethought, performance, and self-reflection phases.', location: 'p. 67', kind: 'paraphrased' },
  },
  {
    id: 'demo-i8', type: 'finding', label: 'Generar la respuesta mejora el recuerdo frente a leerla',
    statement: 'Producir activamente una respuesta deja mejor recuerdo que leer esa misma respuesta ya dada.',
    workId: 'demo-w6', themeId: 'demo-t2', role: 'support', confidence: 0.83,
    development: 'El efecto de generación es un caso particular del beneficio del esfuerzo de recuperación.',
    evidence: { quote: 'Items generated by the subject were better remembered than items merely read.', location: 'p. 592', kind: 'explicit' },
  },
  {
    id: 'demo-i9', type: 'claim', label: 'El espaciado favorece la consolidación durante el sueño',
    statement: 'Separar las sesiones permite procesos de consolidación, ligados al sueño, entre repeticiones.',
    workId: 'demo-w3', themeId: 'demo-t1', role: 'context', confidence: 0.74,
    development: 'Es una de las explicaciones propuestas para el efecto del espaciado.',
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
  { id: 'demo-g1', workId: 'demo-w4', relatedIdea: 'demo-i6', kind: 'unresolved_contradiction', confidence: 0.72, statement: 'No está resuelto si la práctica de recuperación frecuente ayuda o perjudica a estudiantes con alta ansiedad ante los exámenes.' },
  { id: 'demo-g2', workId: 'demo-w2', relatedIdea: 'demo-i4', kind: 'limitation', confidence: 0.68, statement: 'Buena parte de la evidencia sobre carga cognitiva procede de tareas de laboratorio, no de aulas reales.' },
  { id: 'demo-g3', workId: 'demo-w3', relatedIdea: 'demo-i3', kind: 'open_question', confidence: 0.7, statement: '¿Cuál es el intervalo de espaciado óptimo para retener material conceptual durante un semestre completo?' },
  { id: 'demo-g4', workId: 'demo-w1', relatedIdea: 'demo-i1', kind: 'future_work', confidence: 0.66, statement: 'Faltan estudios longitudinales que midan el efecto de prueba más allá de unas pocas semanas.' },
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

/** True when the database holds any user content (real or demo). Gates the demo offer. */
export function hasAnyData(): boolean {
  const db = getDb();
  const count = (table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return count('works') > 0 || count('notes') > 0 || count('note_folders') > 0 || count('ideas') > 0;
}

/**
 * Seed the curated demo corpus. No-op (returns false) if any data already exists,
 * so it can never overwrite a real library. Sets the `demoMode` flag on success.
 */
export function seedDemoData(): boolean {
  const db = getDb();
  if (hasAnyData()) return false;

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const insWork = db.prepare(
      `INSERT INTO works (nodus_id, zotero_key, title, authors_json, year, item_type, read_tag, manual_deep,
         source_type, light_status, light_at, deep_status, deep_at, summary_status, archived)
       VALUES (?, ?, ?, ?, ?, 'journalArticle', ?, 1, 'abstract_only', 'done', ?, 'done', ?, 'none', 0)`
    );
    for (const w of WORKS) {
      insWork.run(w.id, `${DEMO_PREFIX}${w.id}`, w.title, JSON.stringify(w.authors), w.year, w.read ? 1 : 0, now, now);
    }

    const insTheme = db.prepare('INSERT INTO themes (theme_id, label, created_at, pinned) VALUES (?, ?, ?, 0)');
    const insWorkTheme = db.prepare('INSERT OR IGNORE INTO work_themes (nodus_id, theme_id) VALUES (?, ?)');
    for (const th of THEMES) insTheme.run(th.id, th.label, now);

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
      insIdea.run(idea.id, idea.type, idea.label, idea.statement, now);
      insOcc.run(idea.id, idea.workId, idea.role, idea.development, idea.confidence);
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
    for (const g of GAPS) insGap.run(g.id, g.workId, g.relatedIdea, g.kind, g.statement, g.confidence, `${g.relatedIdea}-ev`);

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
    insFolder.run(
      'demo-folder-1', null, 'Marco teórico (demo)', 0, now, now,
      'Notas de ejemplo que sintetizan las ideas del corpus de demostración sobre la ciencia del aprendizaje.'
    );

    const insNote = db.prepare(
      'INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)'
    );
    insNote.run(
      'demo-note-1', null, 'Bienvenido al modo demo', 'markdown',
      [
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
      ].join('\n'),
      0, now, now
    );
    insNote.run(
      'demo-note-2', 'demo-folder-1', 'Por qué funciona la recuperación', 'markdown',
      [
        '## Síntesis',
        '',
        'La **práctica de recuperación** (Roediger & Karpicke, 2006) mejora la retención porque el esfuerzo de recordar modifica la traza de memoria. El **efecto de generación** (Slamecka & Graf, 1978) apunta en la misma dirección: producir la respuesta supera a leerla.',
        '',
        'El **espaciado** (Cepeda & Pashler, 2006) añade un segundo mecanismo: distribuir las sesiones permite consolidar entre repeticiones.',
        '',
        '> Tensión a resolver: la recuperación frecuente podría no convenir a estudiantes con alta ansiedad ante los exámenes (Putwain, 2008).',
      ].join('\n'),
      0, now, now
    );
    insNote.run(
      'demo-note-3', 'demo-folder-1', 'Preguntas abiertas para la tesis', 'markdown',
      [
        '## Candidatas a pregunta de investigación',
        '',
        '1. ¿Cuál es el intervalo de espaciado óptimo a lo largo de un semestre?',
        '2. ¿Cómo interactúan la práctica de recuperación y la ansiedad ante los exámenes?',
        '3. ¿Se sostiene el efecto de carga cognitiva fuera del laboratorio?',
      ].join('\n'),
      1, now, now
    );

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
