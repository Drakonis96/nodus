import type {
  ProjectDetail,
  ProjectLinkKind,
  ProjectSection,
  ProjectSectionRole,
  ProjectSectionStatus,
  PromptLanguage,
} from './types';

export type ProjectGuideStepId = 'brief' | 'coverage' | 'materials' | 'outline' | 'manuscript' | 'review';
export type ProjectGuideStepStatus = 'done' | 'current' | 'blocked';
export type ProjectGuideAction =
  | 'edit_brief'
  | 'mark_coverage'
  | 'mark_materials'
  | 'mark_outline'
  | 'import_chapter'
  | 'review_chapter';

export interface ProjectGuideStep {
  id: ProjectGuideStepId;
  title: string;
  summary: string;
  description: string;
  evidence: string;
  status: ProjectGuideStepStatus;
  action: ProjectGuideAction;
  actionLabel: string;
  sectionRoles: ProjectSectionRole[];
}

export interface ProjectGuide {
  title: string;
  subtitle: string;
  completion: number;
  doneCount: number;
  totalCount: number;
  nextStep: ProjectGuideStep | null;
  steps: ProjectGuideStep[];
}

const ACTIVE_SECTION_STATUSES = new Set<ProjectSectionStatus>(['in_progress', 'review', 'ready']);
const SOURCE_LINK_KINDS = new Set<ProjectLinkKind>(['work', 'idea', 'gap', 'debate', 'note', 'tutor_route', 'writing_draft']);
const OUTLINE_ROLES: ProjectSectionRole[] = ['debates', 'gaps', 'drafts'];

interface ProjectGuideStepCopy {
  title: string;
  summary: string;
  description: string;
  actionLabel: string;
}

interface ProjectGuideCopy {
  kinds: Record<ProjectDetail['project']['kind'], string>;
  completeSubtitle: string;
  steps: Record<ProjectGuideStepId, ProjectGuideStepCopy>;
  evidence: {
    briefPending: string;
    linkedQuestion: string;
    coverageFallback: string;
    coverageInProgress: string;
    materialsFallback: string;
    materialsInProgress: string;
    outlineFallback: string;
    manuscriptFallback: string;
    reviewFallback: string;
    reviewRecorded: string;
    linkedMaterials: (count: number) => string;
    activeOutlineBlocks: (count: number) => string;
    manuscriptCounts: (chapters: number, words: number) => string;
    reviewCounts: (suggestions: number, applied: number) => string;
    sectionStatus: Record<'ready' | 'review' | 'inProgress', string>;
    sectionLinks: (status: string, links: number) => string;
  };
}

const PROJECT_GUIDE_COPY: Record<PromptLanguage, ProjectGuideCopy> = {
  es: {
    kinds: {
      thesis: 'Flujo guiado de tesis', article: 'Flujo guiado de artículo', chapter: 'Flujo guiado de manuscrito',
      literature_review: 'Flujo guiado de manuscrito', theoretical_framework: 'Flujo guiado de manuscrito', other: 'Flujo guiado de manuscrito',
    },
    completeSubtitle: 'Proyecto listo para revisar, exportar o cerrar.',
    steps: {
      brief: {
        title: 'Brief y pregunta', summary: 'Objetivo, alcance y criterio de lectura definidos.',
        description: 'Define el objetivo, el alcance, la pregunta principal y el criterio de selección de fuentes. Este texto aparece en la cabecera del proyecto, se envía como contexto a la IA al generar sugerencias y se incluye en la exportación.', actionLabel: 'Editar brief',
      },
      coverage: {
        title: 'Cobertura', summary: 'Pregunta principal conectada con la cobertura del corpus.',
        description: 'Vincula tu pregunta de investigación con el corpus: indica qué áreas ya están cubiertas y qué falta por explorar. Marcar este paso como en curso activa la sección de cobertura en el proyecto.', actionLabel: 'Marcar cobertura',
      },
      materials: {
        title: 'Corpus y materiales', summary: 'Obras, ideas, notas, huecos o borradores listos para integrarse.',
        description: 'Añade obras, ideas, notas, huecos, debates y borradores al proyecto. Estos materiales son los que la IA usará para proponer inserciones con citas verificables en el manuscrito.', actionLabel: 'Preparar materiales',
      },
      outline: {
        title: 'Estructura argumental', summary: 'Debates, huecos y borradores organizados antes de intervenir el texto.',
        description: 'Organiza los debates, huecos y borradores que estructurarán el argumento antes de redactar los capítulos. Puedes activar cada bloque por separado para marcar que está listo para usarse.', actionLabel: 'Preparar estructura',
      },
      manuscript: {
        title: 'Manuscrito', summary: 'Capítulo o artículo importado como texto editable y versionado.',
        description: 'Importa un capítulo o artículo como texto editable. Nodus lo versiona automáticamente y permite aplicar sugerencias sobre el borrador.', actionLabel: 'Subir capítulo',
      },
      review: {
        title: 'Revisión y salida', summary: 'Relaciones, sugerencias verificables y exportación final.',
        description: 'Genera sugerencias verificables contra el corpus y revisa las citas del manuscrito antes de exportar o cerrar el proyecto.', actionLabel: 'Revisar capítulo',
      },
    },
    evidence: {
      briefPending: 'Pendiente', linkedQuestion: 'Pregunta vinculada', coverageFallback: 'Sin cobertura marcada', coverageInProgress: 'Cobertura en curso', materialsFallback: 'Sin materiales activos', materialsInProgress: 'Materiales en curso', outlineFallback: 'Estructura pendiente', manuscriptFallback: 'Sin capítulo importado', reviewFallback: 'Sin revisión registrada', reviewRecorded: 'Revisión registrada',
      linkedMaterials: (count) => `${count} material(es) vinculados`, activeOutlineBlocks: (count) => `${count} bloque(s) de estructura activos`, manuscriptCounts: (chapters, words) => `${chapters} capítulo(s), ${words} palabra(s)`, reviewCounts: (suggestions, applied) => `${suggestions} sugerencia(s), ${applied} aplicada(s)`,
      sectionStatus: { ready: 'Lista', review: 'En revisión', inProgress: 'En curso' }, sectionLinks: (status, links) => `${status}, ${links} vínculo(s)`,
    },
  },
  en: {
    kinds: {
      thesis: 'Guided thesis flow', article: 'Guided article flow', chapter: 'Guided manuscript flow',
      literature_review: 'Guided manuscript flow', theoretical_framework: 'Guided manuscript flow', other: 'Guided manuscript flow',
    },
    completeSubtitle: 'Project ready to review, export, or close.',
    steps: {
      brief: { title: 'Brief and question', summary: 'Objective, scope, and reading criteria defined.', description: 'Define the objective, scope, main question, and source-selection criteria. This text appears in the project header, is sent as context to the AI when generating suggestions, and is included in the export.', actionLabel: 'Edit brief' },
      coverage: { title: 'Coverage', summary: 'Main question connected to corpus coverage.', description: 'Connect your research question to the corpus: indicate which areas are already covered and what remains to explore. Marking this step as in progress activates the coverage section in the project.', actionLabel: 'Mark coverage' },
      materials: { title: 'Corpus and materials', summary: 'Works, ideas, notes, gaps, or drafts ready to integrate.', description: 'Add works, ideas, notes, gaps, debates, and drafts to the project. The AI will use these materials to propose insertions with verifiable citations in the manuscript.', actionLabel: 'Prepare materials' },
      outline: { title: 'Argument structure', summary: 'Debates, gaps, and drafts organized before editing the text.', description: 'Organize the debates, gaps, and drafts that will structure the argument before drafting the chapters. You can activate each block separately to mark it ready for use.', actionLabel: 'Prepare structure' },
      manuscript: { title: 'Manuscript', summary: 'Chapter or article imported as editable, versioned text.', description: 'Import a chapter or article as editable text. Nodus versions it automatically and lets you apply suggestions to the draft.', actionLabel: 'Upload chapter' },
      review: { title: 'Review and output', summary: 'Relations, verifiable suggestions, and final export.', description: 'Generate verifiable suggestions against the corpus and review the manuscript citations before exporting or closing the project.', actionLabel: 'Review chapter' },
    },
    evidence: {
      briefPending: 'Pending', linkedQuestion: 'Linked question', coverageFallback: 'No coverage marked', coverageInProgress: 'Coverage in progress', materialsFallback: 'No active materials', materialsInProgress: 'Materials in progress', outlineFallback: 'Structure pending', manuscriptFallback: 'No chapter imported', reviewFallback: 'No review recorded', reviewRecorded: 'Review recorded',
      linkedMaterials: (count) => `${count} linked material(s)`, activeOutlineBlocks: (count) => `${count} active structure block(s)`, manuscriptCounts: (chapters, words) => `${chapters} chapter(s), ${words} word(s)`, reviewCounts: (suggestions, applied) => `${suggestions} suggestion(s), ${applied} applied`,
      sectionStatus: { ready: 'Ready', review: 'Under review', inProgress: 'In progress' }, sectionLinks: (status, links) => `${status}, ${links} link(s)`,
    },
  },
  fr: {
    kinds: {
      thesis: 'Parcours guidé de thèse', article: "Parcours guidé d'article", chapter: 'Parcours guidé de manuscrit',
      literature_review: 'Parcours guidé de manuscrit', theoretical_framework: 'Parcours guidé de manuscrit', other: 'Parcours guidé de manuscrit',
    },
    completeSubtitle: 'Projet prêt à être révisé, exporté ou clôturé.',
    steps: {
      brief: { title: 'Brief et question', summary: "Objectif, portée et critères de lecture définis.", description: "Définissez l'objectif, la portée, la question principale et les critères de sélection des sources. Ce texte apparaît dans l'en-tête du projet, est envoyé comme contexte à l'IA lors de la génération de suggestions et figure dans l'export.", actionLabel: 'Modifier le brief' },
      coverage: { title: 'Couverture', summary: 'Question principale reliée à la couverture du corpus.', description: 'Reliez votre question de recherche au corpus : indiquez les domaines déjà couverts et ce qui reste à explorer. Marquer cette étape comme en cours active la section de couverture du projet.', actionLabel: 'Marquer la couverture' },
      materials: { title: 'Corpus et matériaux', summary: 'Œuvres, idées, notes, lacunes ou brouillons prêts à être intégrés.', description: "Ajoutez des œuvres, idées, notes, lacunes, débats et brouillons au projet. L'IA utilisera ces matériaux pour proposer des insertions avec des citations vérifiables dans le manuscrit.", actionLabel: 'Préparer les matériaux' },
      outline: { title: 'Structure argumentative', summary: 'Débats, lacunes et brouillons organisés avant d’intervenir sur le texte.', description: 'Organisez les débats, lacunes et brouillons qui structureront l’argument avant de rédiger les chapitres. Vous pouvez activer chaque bloc séparément pour indiquer qu’il est prêt à être utilisé.', actionLabel: 'Préparer la structure' },
      manuscript: { title: 'Manuscrit', summary: 'Chapitre ou article importé comme texte éditable et versionné.', description: 'Importez un chapitre ou un article comme texte éditable. Nodus le versionne automatiquement et permet d’appliquer des suggestions au brouillon.', actionLabel: 'Importer le chapitre' },
      review: { title: 'Révision et sortie', summary: 'Relations, suggestions vérifiables et export final.', description: 'Générez des suggestions vérifiables à partir du corpus et vérifiez les citations du manuscrit avant de l’exporter ou de clôturer le projet.', actionLabel: 'Réviser le chapitre' },
    },
    evidence: {
      briefPending: 'En attente', linkedQuestion: 'Question liée', coverageFallback: 'Aucune couverture marquée', coverageInProgress: 'Couverture en cours', materialsFallback: 'Aucun matériau actif', materialsInProgress: 'Matériaux en cours', outlineFallback: 'Structure en attente', manuscriptFallback: 'Aucun chapitre importé', reviewFallback: 'Aucune révision enregistrée', reviewRecorded: 'Révision enregistrée',
      linkedMaterials: (count) => `${count} matériau(x) lié(s)`, activeOutlineBlocks: (count) => `${count} bloc(s) de structure actif(s)`, manuscriptCounts: (chapters, words) => `${chapters} chapitre(s), ${words} mot(s)`, reviewCounts: (suggestions, applied) => `${suggestions} suggestion(s), ${applied} appliquée(s)`,
      sectionStatus: { ready: 'Prête', review: 'En révision', inProgress: 'En cours' }, sectionLinks: (status, links) => `${status}, ${links} lien(s)`,
    },
  },
  de: {
    kinds: {
      thesis: 'Geführter Thesis-Ablauf', article: 'Geführter Artikel-Ablauf', chapter: 'Geführter Manuskript-Ablauf',
      literature_review: 'Geführter Manuskript-Ablauf', theoretical_framework: 'Geführter Manuskript-Ablauf', other: 'Geführter Manuskript-Ablauf',
    },
    completeSubtitle: 'Projekt bereit zum Überprüfen, Exportieren oder Abschließen.',
    steps: {
      brief: { title: 'Brief und Frage', summary: 'Ziel, Umfang und Lesekriterien definiert.', description: 'Definieren Sie Ziel, Umfang, Hauptfrage und Kriterien für die Quellenauswahl. Dieser Text erscheint in der Projektkopfzeile, wird der KI beim Erstellen von Vorschlägen als Kontext übermittelt und in den Export aufgenommen.', actionLabel: 'Brief bearbeiten' },
      coverage: { title: 'Abdeckung', summary: 'Hauptfrage mit der Korpusabdeckung verknüpft.', description: 'Verknüpfen Sie Ihre Forschungsfrage mit dem Korpus: Geben Sie an, welche Bereiche bereits abgedeckt sind und was noch zu untersuchen ist. Wenn Sie diesen Schritt als laufend markieren, wird der Abdeckungsabschnitt im Projekt aktiviert.', actionLabel: 'Abdeckung markieren' },
      materials: { title: 'Korpus und Materialien', summary: 'Werke, Ideen, Notizen, Lücken oder Entwürfe zur Integration bereit.', description: 'Fügen Sie dem Projekt Werke, Ideen, Notizen, Lücken, Debatten und Entwürfe hinzu. Die KI verwendet diese Materialien, um Einfügungen mit überprüfbaren Zitaten im Manuskript vorzuschlagen.', actionLabel: 'Materialien vorbereiten' },
      outline: { title: 'Argumentationsstruktur', summary: 'Debatten, Lücken und Entwürfe vor der Textbearbeitung geordnet.', description: 'Ordnen Sie die Debatten, Lücken und Entwürfe, die das Argument vor dem Verfassen der Kapitel strukturieren. Sie können jeden Block einzeln aktivieren, um seine Einsatzbereitschaft zu markieren.', actionLabel: 'Struktur vorbereiten' },
      manuscript: { title: 'Manuskript', summary: 'Kapitel oder Artikel als bearbeitbarer Text mit Versionen importiert.', description: 'Importieren Sie ein Kapitel oder einen Artikel als bearbeitbaren Text. Nodus versioniert ihn automatisch und ermöglicht, Vorschläge auf den Entwurf anzuwenden.', actionLabel: 'Kapitel hochladen' },
      review: { title: 'Überprüfung und Ausgabe', summary: 'Beziehungen, überprüfbare Vorschläge und abschließender Export.', description: 'Erstellen Sie überprüfbare Vorschläge anhand des Korpus und prüfen Sie die Manuskriptzitate, bevor Sie das Projekt exportieren oder abschließen.', actionLabel: 'Kapitel überprüfen' },
    },
    evidence: {
      briefPending: 'Ausstehend', linkedQuestion: 'Verknüpfte Frage', coverageFallback: 'Keine Abdeckung markiert', coverageInProgress: 'Abdeckung in Bearbeitung', materialsFallback: 'Keine aktiven Materialien', materialsInProgress: 'Materialien in Bearbeitung', outlineFallback: 'Struktur ausstehend', manuscriptFallback: 'Kein Kapitel importiert', reviewFallback: 'Keine Überprüfung erfasst', reviewRecorded: 'Überprüfung erfasst',
      linkedMaterials: (count) => `${count} verknüpfte(s) Material(ien)`, activeOutlineBlocks: (count) => `${count} aktive Strukturblock(s)`, manuscriptCounts: (chapters, words) => `${chapters} Kapitel, ${words} Wörter`, reviewCounts: (suggestions, applied) => `${suggestions} Vorschlag/Vorschläge, ${applied} angewendet`,
      sectionStatus: { ready: 'Bereit', review: 'In Überprüfung', inProgress: 'In Bearbeitung' }, sectionLinks: (status, links) => `${status}, ${links} Verknüpfung(en)`,
    },
  },
  pt: {
    kinds: {
      thesis: 'Fluxo guiado de tese', article: 'Fluxo guiado de artigo', chapter: 'Fluxo guiado de manuscrito',
      literature_review: 'Fluxo guiado de manuscrito', theoretical_framework: 'Fluxo guiado de manuscrito', other: 'Fluxo guiado de manuscrito',
    },
    completeSubtitle: 'Projeto pronto para rever, exportar ou fechar.',
    steps: {
      brief: { title: 'Brief e pergunta', summary: 'Objetivo, âmbito e critérios de leitura definidos.', description: 'Defina o objetivo, o âmbito, a pergunta principal e os critérios de seleção das fontes. Este texto aparece no cabeçalho do projeto, é enviado como contexto para a IA ao gerar sugestões e é incluído na exportação.', actionLabel: 'Editar brief' },
      coverage: { title: 'Cobertura', summary: 'Pergunta principal ligada à cobertura do corpus.', description: 'Ligue a sua pergunta de investigação ao corpus: indique as áreas já cobertas e o que falta explorar. Marcar este passo como em curso ativa a secção de cobertura no projeto.', actionLabel: 'Marcar cobertura' },
      materials: { title: 'Corpus e materiais', summary: 'Obras, ideias, notas, lacunas ou rascunhos prontos para integrar.', description: 'Adicione obras, ideias, notas, lacunas, debates e rascunhos ao projeto. A IA usará estes materiais para propor inserções com citações verificáveis no manuscrito.', actionLabel: 'Preparar materiais' },
      outline: { title: 'Estrutura argumentativa', summary: 'Debates, lacunas e rascunhos organizados antes de intervir no texto.', description: 'Organize os debates, lacunas e rascunhos que estruturarão o argumento antes de redigir os capítulos. Pode ativar cada bloco separadamente para indicar que está pronto a usar.', actionLabel: 'Preparar estrutura' },
      manuscript: { title: 'Manuscrito', summary: 'Capítulo ou artigo importado como texto editável e versionado.', description: 'Importe um capítulo ou artigo como texto editável. O Nodus cria versões automaticamente e permite aplicar sugestões ao rascunho.', actionLabel: 'Carregar capítulo' },
      review: { title: 'Revisão e saída', summary: 'Relações, sugestões verificáveis e exportação final.', description: 'Gere sugestões verificáveis contra o corpus e reveja as citações do manuscrito antes de exportar ou fechar o projeto.', actionLabel: 'Rever capítulo' },
    },
    evidence: {
      briefPending: 'Pendente', linkedQuestion: 'Pergunta ligada', coverageFallback: 'Sem cobertura marcada', coverageInProgress: 'Cobertura em curso', materialsFallback: 'Sem materiais ativos', materialsInProgress: 'Materiais em curso', outlineFallback: 'Estrutura pendente', manuscriptFallback: 'Sem capítulo importado', reviewFallback: 'Sem revisão registada', reviewRecorded: 'Revisão registada',
      linkedMaterials: (count) => `${count} material(is) ligado(s)`, activeOutlineBlocks: (count) => `${count} bloco(s) de estrutura ativo(s)`, manuscriptCounts: (chapters, words) => `${chapters} capítulo(s), ${words} palavra(s)`, reviewCounts: (suggestions, applied) => `${suggestions} sugestão(ões), ${applied} aplicada(s)`,
      sectionStatus: { ready: 'Pronta', review: 'Em revisão', inProgress: 'Em curso' }, sectionLinks: (status, links) => `${status}, ${links} ligação(ões)`,
    },
  },
  'pt-BR': {
    kinds: {
      thesis: 'Fluxo guiado de tese', article: 'Fluxo guiado de artigo', chapter: 'Fluxo guiado de manuscrito',
      literature_review: 'Fluxo guiado de manuscrito', theoretical_framework: 'Fluxo guiado de manuscrito', other: 'Fluxo guiado de manuscrito',
    },
    completeSubtitle: 'Projeto pronto para revisar, exportar ou fechar.',
    steps: {
      brief: { title: 'Brief e pergunta', summary: 'Objetivo, escopo e critérios de leitura definidos.', description: 'Defina o objetivo, o escopo, a pergunta principal e os critérios de seleção de fontes. Este texto aparece no cabeçalho do projeto, é enviado como contexto para a IA ao gerar sugestões e é incluído na exportação.', actionLabel: 'Editar brief' },
      coverage: { title: 'Cobertura', summary: 'Pergunta principal conectada à cobertura do corpus.', description: 'Conecte sua pergunta de pesquisa ao corpus: indique quais áreas já estão cobertas e o que ainda precisa ser explorado. Marcar esta etapa como em andamento ativa a seção de cobertura no projeto.', actionLabel: 'Marcar cobertura' },
      materials: { title: 'Corpus e materiais', summary: 'Obras, ideias, notas, lacunas ou rascunhos prontos para integrar.', description: 'Adicione obras, ideias, notas, lacunas, debates e rascunhos ao projeto. A IA usará esses materiais para propor inserções com citações verificáveis no manuscrito.', actionLabel: 'Preparar materiais' },
      outline: { title: 'Estrutura argumentativa', summary: 'Debates, lacunas e rascunhos organizados antes de editar o texto.', description: 'Organize os debates, lacunas e rascunhos que estruturarão o argumento antes de redigir os capítulos. Você pode ativar cada bloco separadamente para indicar que está pronto para uso.', actionLabel: 'Preparar estrutura' },
      manuscript: { title: 'Manuscrito', summary: 'Capítulo ou artigo importado como texto editável e versionado.', description: 'Importe um capítulo ou artigo como texto editável. O Nodus cria versões automaticamente e permite aplicar sugestões ao rascunho.', actionLabel: 'Enviar capítulo' },
      review: { title: 'Revisão e saída', summary: 'Relações, sugestões verificáveis e exportação final.', description: 'Gere sugestões verificáveis contra o corpus e revise as citações do manuscrito antes de exportar ou fechar o projeto.', actionLabel: 'Revisar capítulo' },
    },
    evidence: {
      briefPending: 'Pendente', linkedQuestion: 'Pergunta vinculada', coverageFallback: 'Nenhuma cobertura marcada', coverageInProgress: 'Cobertura em andamento', materialsFallback: 'Nenhum material ativo', materialsInProgress: 'Materiais em andamento', outlineFallback: 'Estrutura pendente', manuscriptFallback: 'Nenhum capítulo importado', reviewFallback: 'Nenhuma revisão registrada', reviewRecorded: 'Revisão registrada',
      linkedMaterials: (count) => `${count} material(is) vinculado(s)`, activeOutlineBlocks: (count) => `${count} bloco(s) de estrutura ativo(s)`, manuscriptCounts: (chapters, words) => `${chapters} capítulo(s), ${words} palavra(s)`, reviewCounts: (suggestions, applied) => `${suggestions} sugestão(ões), ${applied} aplicada(s)`,
      sectionStatus: { ready: 'Pronta', review: 'Em revisão', inProgress: 'Em andamento' }, sectionLinks: (status, links) => `${status}, ${links} vínculo(s)`,
    },
  },
  it: {
    kinds: {
      thesis: 'Percorso guidato della tesi', article: "Percorso guidato dell'articolo", chapter: 'Percorso guidato del manoscritto',
      literature_review: 'Percorso guidato del manoscritto', theoretical_framework: 'Percorso guidato del manoscritto', other: 'Percorso guidato del manoscritto',
    },
    completeSubtitle: "Progetto pronto per la revisione, l'esportazione o la chiusura.",
    steps: {
      brief: { title: 'Brief e domanda', summary: 'Obiettivo, ambito e criteri di lettura definiti.', description: 'Definisci obiettivo, ambito, domanda principale e criteri di selezione delle fonti. Questo testo appare nell’intestazione del progetto, viene inviato come contesto all’IA quando genera suggerimenti ed è incluso nell’esportazione.', actionLabel: 'Modifica brief' },
      coverage: { title: 'Copertura', summary: 'Domanda principale collegata alla copertura del corpus.', description: 'Collega la tua domanda di ricerca al corpus: indica quali aree sono già coperte e cosa resta da esplorare. Contrassegnare questo passaggio come in corso attiva la sezione della copertura nel progetto.', actionLabel: 'Segna copertura' },
      materials: { title: 'Corpus e materiali', summary: 'Opere, idee, note, lacune o bozze pronte per essere integrate.', description: 'Aggiungi al progetto opere, idee, note, lacune, dibattiti e bozze. L’IA userà questi materiali per proporre inserimenti con citazioni verificabili nel manoscritto.', actionLabel: 'Prepara materiali' },
      outline: { title: 'Struttura argomentativa', summary: 'Dibattiti, lacune e bozze organizzati prima di intervenire sul testo.', description: 'Organizza i dibattiti, le lacune e le bozze che struttureranno l’argomento prima di redigere i capitoli. Puoi attivare ogni blocco separatamente per indicare che è pronto all’uso.', actionLabel: 'Prepara struttura' },
      manuscript: { title: 'Manoscritto', summary: 'Capitolo o articolo importato come testo modificabile e versionato.', description: 'Importa un capitolo o un articolo come testo modificabile. Nodus lo sottopone automaticamente a versionamento e consente di applicare suggerimenti alla bozza.', actionLabel: 'Carica capitolo' },
      review: { title: 'Revisione e uscita', summary: 'Relazioni, suggerimenti verificabili ed esportazione finale.', description: 'Genera suggerimenti verificabili sul corpus e controlla le citazioni del manoscritto prima di esportare o chiudere il progetto.', actionLabel: 'Rivedi capitolo' },
    },
    evidence: {
      briefPending: 'In sospeso', linkedQuestion: 'Domanda collegata', coverageFallback: 'Nessuna copertura indicata', coverageInProgress: 'Copertura in corso', materialsFallback: 'Nessun materiale attivo', materialsInProgress: 'Materiali in corso', outlineFallback: 'Struttura in sospeso', manuscriptFallback: 'Nessun capitolo importato', reviewFallback: 'Nessuna revisione registrata', reviewRecorded: 'Revisione registrata',
      linkedMaterials: (count) => `${count} materiale/i collegato/i`, activeOutlineBlocks: (count) => `${count} blocco/chi di struttura attivi`, manuscriptCounts: (chapters, words) => `${chapters} capitolo/i, ${words} parola/e`, reviewCounts: (suggestions, applied) => `${suggestions} suggerimento/i, ${applied} applicato/i`,
      sectionStatus: { ready: 'Pronta', review: 'In revisione', inProgress: 'In corso' }, sectionLinks: (status, links) => `${status}, ${links} collegamento/i`,
    },
  },
  tr: {
    kinds: {
      thesis: 'Rehberli tez akışı', article: 'Rehberli makale akışı', chapter: 'Rehberli el yazması akışı',
      literature_review: 'Rehberli el yazması akışı', theoretical_framework: 'Rehberli el yazması akışı', other: 'Rehberli el yazması akışı',
    },
    completeSubtitle: 'Proje incelenmeye, dışa aktarılmaya veya kapatılmaya hazır.',
    steps: {
      brief: { title: 'Brief ve soru', summary: 'Amaç, kapsam ve okuma ölçütleri belirlendi.', description: 'Amacı, kapsamı, ana soruyu ve kaynak seçme ölçütlerini belirleyin. Bu metin proje başlığında görünür, öneriler oluşturulurken yapay zekâya bağlam olarak gönderilir ve dışa aktarmaya eklenir.', actionLabel: 'Brief’i düzenle' },
      coverage: { title: 'Kapsam', summary: 'Ana soru derlem kapsamına bağlandı.', description: 'Araştırma sorunuzu derleme bağlayın: hangi alanların kapsandığını ve nelerin keşfedilmeyi beklediğini belirtin. Bu adımı devam ediyor olarak işaretlemek projedeki kapsam bölümünü etkinleştirir.', actionLabel: 'Kapsamı işaretle' },
      materials: { title: 'Derlem ve materyaller', summary: 'Eserler, fikirler, notlar, boşluklar veya taslaklar entegrasyona hazır.', description: 'Projeye eserler, fikirler, notlar, boşluklar, tartışmalar ve taslaklar ekleyin. Yapay zekâ, el yazmasında doğrulanabilir alıntılar içeren eklemeler önermek için bu materyalleri kullanır.', actionLabel: 'Materyalleri hazırla' },
      outline: { title: 'Argüman yapısı', summary: 'Metne müdahale etmeden önce tartışmalar, boşluklar ve taslaklar düzenlendi.', description: 'Bölümleri yazmadan önce argümanı yapılandıracak tartışmaları, boşlukları ve taslakları düzenleyin. Kullanıma hazır olduğunu belirtmek için her bloğu ayrı ayrı etkinleştirebilirsiniz.', actionLabel: 'Yapıyı hazırla' },
      manuscript: { title: 'El yazması', summary: 'Bölüm veya makale düzenlenebilir ve sürümlenmiş metin olarak içe aktarıldı.', description: 'Bir bölümü veya makaleyi düzenlenebilir metin olarak içe aktarın. Nodus bunu otomatik olarak sürümler ve taslağa öneri uygulamanıza izin verir.', actionLabel: 'Bölümü yükle' },
      review: { title: 'İnceleme ve çıktı', summary: 'İlişkiler, doğrulanabilir öneriler ve son dışa aktarma.', description: 'Derleme karşı doğrulanabilir öneriler oluşturun ve projeyi dışa aktarmadan veya kapatmadan önce el yazması alıntılarını inceleyin.', actionLabel: 'Bölümü incele' },
    },
    evidence: {
      briefPending: 'Beklemede', linkedQuestion: 'Bağlı soru', coverageFallback: 'Kapsam işaretlenmedi', coverageInProgress: 'Kapsam devam ediyor', materialsFallback: 'Etkin materyal yok', materialsInProgress: 'Materyaller devam ediyor', outlineFallback: 'Yapı beklemede', manuscriptFallback: 'İçe aktarılan bölüm yok', reviewFallback: 'Kaydedilmiş inceleme yok', reviewRecorded: 'İnceleme kaydedildi',
      linkedMaterials: (count) => `${count} bağlı materyal`, activeOutlineBlocks: (count) => `${count} etkin yapı bloğu`, manuscriptCounts: (chapters, words) => `${chapters} bölüm, ${words} kelime`, reviewCounts: (suggestions, applied) => `${suggestions} öneri, ${applied} uygulandı`,
      sectionStatus: { ready: 'Hazır', review: 'İnceleniyor', inProgress: 'Devam ediyor' }, sectionLinks: (status, links) => `${status}, ${links} bağlantı`,
    },
  },
  'zh-Hans': {
    kinds: {
      thesis: '论文引导流程', article: '文章引导流程', chapter: '手稿引导流程',
      literature_review: '手稿引导流程', theoretical_framework: '手稿引导流程', other: '手稿引导流程',
    },
    completeSubtitle: '项目已可供审阅、导出或结项。',
    steps: {
      brief: {
        title: '简介与问题', summary: '目标、范围与阅读标准已明确。',
        description: '定义目标、范围、主要问题与来源筛选标准。此文本会显示在项目页眉中，在生成建议时作为上下文发送给 AI，并包含在导出内容中。', actionLabel: '编辑简介',
      },
      coverage: {
        title: '覆盖范围', summary: '主要问题已与语料覆盖范围关联。',
        description: '将你的研究问题与语料库关联起来：指出哪些领域已有覆盖、哪些仍待探索。将此步骤标记为进行中会激活项目中的覆盖范围部分。', actionLabel: '标记覆盖范围',
      },
      materials: {
        title: '语料与材料', summary: '作品、想法、笔记、空白或草稿已准备好整合。',
        description: '将作品、想法、笔记、空白、争论与草稿加入项目。AI 将使用这些材料来提出带有可验证引用的手稿插入建议。', actionLabel: '准备材料',
      },
      outline: {
        title: '论证结构', summary: '在介入文本之前整理好争论、空白与草稿。',
        description: '在撰写章节之前，先组织将构成论证的争论、空白与草稿。你可以单独激活每个板块，以标记其可供使用。', actionLabel: '准备结构',
      },
      manuscript: {
        title: '手稿', summary: '章节或文章已作为可编辑、带版本的文本导入。',
        description: '将章节或文章导入为可编辑文本。Nodus 会自动为其创建版本，并允许将建议应用到草稿上。', actionLabel: '上传章节',
      },
      review: {
        title: '审阅与输出', summary: '关系、可验证建议与最终导出。',
        description: '针对语料库生成可验证的建议，并在导出或结项之前审阅手稿的引用。', actionLabel: '审阅章节',
      },
    },
    evidence: {
      briefPending: '待处理', linkedQuestion: '已关联问题', coverageFallback: '未标记覆盖范围', coverageInProgress: '覆盖范围进行中', materialsFallback: '无活动材料', materialsInProgress: '材料进行中', outlineFallback: '结构待处理', manuscriptFallback: '未导入章节', reviewFallback: '未记录审阅', reviewRecorded: '已记录审阅',
      linkedMaterials: (count) => `${count} 项关联材料`, activeOutlineBlocks: (count) => `${count} 个活动结构板块`, manuscriptCounts: (chapters, words) => `${chapters} 章，${words} 词`, reviewCounts: (suggestions, applied) => `${suggestions} 条建议，已应用 ${applied} 条`,
      sectionStatus: { ready: '就绪', review: '审阅中', inProgress: '进行中' }, sectionLinks: (status, links) => `${status}，${links} 个链接`,
    },
  },
  'zh-Hant': {
    kinds: {
      thesis: '論文引導流程', article: '文章引導流程', chapter: '手稿引導流程',
      literature_review: '手稿引導流程', theoretical_framework: '手稿引導流程', other: '手稿引導流程',
    },
    completeSubtitle: '專案已可供審閱、匯出或結案。',
    steps: {
      brief: {
        title: '簡介與問題', summary: '目標、範圍與閱讀標準已明確。',
        description: '定義目標、範圍、主要問題與來源篩選標準。此文字會顯示在專案標題中，在產生建議時作為脈絡傳送給 AI，並包含在匯出內容中。', actionLabel: '編輯簡介',
      },
      coverage: {
        title: '涵蓋範圍', summary: '主要問題已與語料涵蓋範圍連結。',
        description: '將你的研究問題與語料庫連結：指出哪些領域已有涵蓋、哪些仍待探索。將此步驟標記為進行中會啟用專案中的涵蓋範圍區段。', actionLabel: '標記涵蓋範圍',
      },
      materials: {
        title: '語料與材料', summary: '作品、想法、筆記、空缺或草稿已準備好整合。',
        description: '將作品、想法、筆記、空缺、爭論與草稿加入專案。AI 將使用這些材料，在手稿中提出附有可驗證引用的插入建議。', actionLabel: '準備材料',
      },
      outline: {
        title: '論證結構', summary: '在介入文本之前整理好爭論、空缺與草稿。',
        description: '在撰寫章節之前，先組織將構成論證的爭論、空缺與草稿。你可以個別啟用每個區塊，以標記其可供使用。', actionLabel: '準備結構',
      },
      manuscript: {
        title: '手稿', summary: '章節或文章已作為可編輯、具版本紀錄的文字匯入。',
        description: '將章節或文章匯入為可編輯文字。Nodus 會自動為其建立版本，並允許將建議套用到草稿上。', actionLabel: '上傳章節',
      },
      review: {
        title: '審閱與輸出', summary: '關係、可驗證建議與最終匯出。',
        description: '針對語料庫產生可驗證的建議，並在匯出或結案之前審閱手稿的引用。', actionLabel: '審閱章節',
      },
    },
    evidence: {
      briefPending: '待處理', linkedQuestion: '已連結問題', coverageFallback: '未標記涵蓋範圍', coverageInProgress: '涵蓋範圍進行中', materialsFallback: '無作用中材料', materialsInProgress: '材料進行中', outlineFallback: '結構待處理', manuscriptFallback: '未匯入章節', reviewFallback: '未記錄審閱', reviewRecorded: '已記錄審閱',
      linkedMaterials: (count) => `${count} 項連結材料`, activeOutlineBlocks: (count) => `${count} 個作用中結構區塊`, manuscriptCounts: (chapters, words) => `${chapters} 章，${words} 詞`, reviewCounts: (suggestions, applied) => `${suggestions} 則建議，已套用 ${applied} 則`,
      sectionStatus: { ready: '就緒', review: '審閱中', inProgress: '進行中' }, sectionLinks: (status, links) => `${status}，${links} 個連結`,
    },
  },
  vi: {
    kinds: {
      thesis: 'Quy trình luận văn có hướng dẫn', article: 'Quy trình bài báo có hướng dẫn', chapter: 'Quy trình bản thảo có hướng dẫn',
      literature_review: 'Quy trình bản thảo có hướng dẫn', theoretical_framework: 'Quy trình bản thảo có hướng dẫn', other: 'Quy trình bản thảo có hướng dẫn',
    },
    completeSubtitle: 'Dự án đã sẵn sàng để xem xét, xuất hoặc kết thúc.',
    steps: {
      brief: {
        title: 'Đề cương và câu hỏi', summary: 'Mục tiêu, phạm vi và tiêu chí đọc đã được xác định.',
        description: 'Xác định mục tiêu, phạm vi, câu hỏi chính và tiêu chí chọn nguồn. Văn bản này xuất hiện ở phần đầu dự án, được gửi làm bối cảnh cho AI khi tạo đề xuất và được đưa vào bản xuất.', actionLabel: 'Chỉnh sửa đề cương',
      },
      coverage: {
        title: 'Độ bao quát', summary: 'Câu hỏi chính đã gắn với độ bao quát của kho ngữ liệu.',
        description: 'Gắn câu hỏi nghiên cứu của bạn với kho ngữ liệu: cho biết những lĩnh vực đã được bao quát và những gì còn cần khám phá. Đánh dấu bước này là đang thực hiện sẽ kích hoạt phần độ bao quát trong dự án.', actionLabel: 'Đánh dấu độ bao quát',
      },
      materials: {
        title: 'Kho ngữ liệu và tư liệu', summary: 'Tác phẩm, ý tưởng, ghi chú, khoảng trống hoặc bản nháp sẵn sàng để tích hợp.',
        description: 'Thêm tác phẩm, ý tưởng, ghi chú, khoảng trống, tranh luận và bản nháp vào dự án. AI sẽ dùng những tư liệu này để đề xuất các chèn vào bản thảo kèm trích dẫn có thể kiểm chứng.', actionLabel: 'Chuẩn bị tư liệu',
      },
      outline: {
        title: 'Cấu trúc lập luận', summary: 'Các tranh luận, khoảng trống và bản nháp được tổ chức trước khi can thiệp vào văn bản.',
        description: 'Tổ chức các tranh luận, khoảng trống và bản nháp sẽ định hình lập luận trước khi viết các chương. Bạn có thể kích hoạt từng khối riêng biệt để đánh dấu là sẵn sàng sử dụng.', actionLabel: 'Chuẩn bị cấu trúc',
      },
      manuscript: {
        title: 'Bản thảo', summary: 'Chương hoặc bài báo đã được nhập dưới dạng văn bản có thể chỉnh sửa và có phiên bản.',
        description: 'Nhập một chương hoặc bài báo dưới dạng văn bản có thể chỉnh sửa. Nodus tự động tạo phiên bản và cho phép áp dụng đề xuất vào bản nháp.', actionLabel: 'Tải lên chương',
      },
      review: {
        title: 'Xem xét và đầu ra', summary: 'Quan hệ, đề xuất có thể kiểm chứng và bản xuất cuối cùng.',
        description: 'Tạo các đề xuất có thể kiểm chứng dựa trên kho ngữ liệu và xem lại các trích dẫn của bản thảo trước khi xuất hoặc kết thúc dự án.', actionLabel: 'Xem xét chương',
      },
    },
    evidence: {
      briefPending: 'Đang chờ', linkedQuestion: 'Câu hỏi đã liên kết', coverageFallback: 'Chưa đánh dấu độ bao quát', coverageInProgress: 'Độ bao quát đang thực hiện', materialsFallback: 'Không có tư liệu hoạt động', materialsInProgress: 'Tư liệu đang thực hiện', outlineFallback: 'Cấu trúc đang chờ', manuscriptFallback: 'Chưa nhập chương', reviewFallback: 'Chưa ghi nhận xem xét', reviewRecorded: 'Đã ghi nhận xem xét',
      linkedMaterials: (count) => `${count} tư liệu được liên kết`, activeOutlineBlocks: (count) => `${count} khối cấu trúc đang hoạt động`, manuscriptCounts: (chapters, words) => `${chapters} chương, ${words} từ`, reviewCounts: (suggestions, applied) => `${suggestions} đề xuất, đã áp dụng ${applied}`,
      sectionStatus: { ready: 'Sẵn sàng', review: 'Đang xem xét', inProgress: 'Đang thực hiện' }, sectionLinks: (status, links) => `${status}, ${links} liên kết`,
    },
  },
  ja: {
    kinds: {
      thesis: '論文ガイドフロー', article: '記事ガイドフロー', chapter: '原稿ガイドフロー',
      literature_review: '原稿ガイドフロー', theoretical_framework: '原稿ガイドフロー', other: '原稿ガイドフロー',
    },
    completeSubtitle: 'プロジェクトは確認、書き出し、または終了できる状態です。',
    steps: {
      brief: {
        title: 'ブリーフと問い', summary: '目的、範囲、読解基準が定義されています。',
        description: '目的、範囲、主要な問い、資料選定基準を定義してください。このテキストはプロジェクトのヘッダーに表示され、提案を生成する際に AI へ文脈として送信され、書き出しにも含まれます。', actionLabel: 'ブリーフを編集',
      },
      coverage: {
        title: 'カバレッジ', summary: '主要な問いがコーパスのカバレッジと結びついています。',
        description: '研究の問いをコーパスに結びつけてください。どの領域がすでに網羅され、何がまだ調査されていないかを示します。このステップを進行中にすると、プロジェクトのカバレッジセクションが有効になります。', actionLabel: 'カバレッジを記録',
      },
      materials: {
        title: 'コーパスと資料', summary: '作品、アイデア、ノート、ギャップ、草稿が統合可能な状態です。',
        description: '作品、アイデア、ノート、ギャップ、議論、草稿をプロジェクトに追加してください。AI はこれらの資料を使って、検証可能な引用を伴う挿入を原稿に提案します。', actionLabel: '資料を準備',
      },
      outline: {
        title: '論証構造', summary: '本文に介入する前に、議論、ギャップ、草稿を整理します。',
        description: '章を執筆する前に、論証を構成する議論、ギャップ、草稿を整理してください。各ブロックを個別に有効にして、使用可能であることを示せます。', actionLabel: '構造を準備',
      },
      manuscript: {
        title: '原稿', summary: '章または記事を、編集可能で版管理されたテキストとして読み込みました。',
        description: '章または記事を編集可能なテキストとして読み込んでください。Nodus が自動的に版管理し、草稿に提案を適用できます。', actionLabel: '章をアップロード',
      },
      review: {
        title: '確認と出力', summary: '関係、検証可能な提案、最終書き出し。',
        description: 'コーパスに対して検証可能な提案を生成し、書き出しまたはプロジェクト終了の前に原稿の引用を確認してください。', actionLabel: '章を確認',
      },
    },
    evidence: {
      briefPending: '保留中', linkedQuestion: 'リンクされた問い', coverageFallback: 'カバレッジ未記録', coverageInProgress: 'カバレッジ進行中', materialsFallback: '有効な資料なし', materialsInProgress: '資料を進行中', outlineFallback: '構造は保留中', manuscriptFallback: '章が読み込まれていません', reviewFallback: '確認が記録されていません', reviewRecorded: '確認を記録しました',
      linkedMaterials: (count) => `リンクされた資料 ${count} 件`, activeOutlineBlocks: (count) => `有効な構造ブロック ${count} 件`, manuscriptCounts: (chapters, words) => `${chapters} 章、${words} 語`, reviewCounts: (suggestions, applied) => `提案 ${suggestions} 件、適用済み ${applied} 件`,
      sectionStatus: { ready: '準備完了', review: '確認中', inProgress: '進行中' }, sectionLinks: (status, links) => `${status}、リンク ${links} 件`,
    },
  },
  ru: {
    kinds: {
      thesis: 'Управляемый поток диссертации', article: 'Управляемый поток статьи', chapter: 'Управляемый поток рукописи',
      literature_review: 'Управляемый поток рукописи', theoretical_framework: 'Управляемый поток рукописи', other: 'Управляемый поток рукописи',
    },
    completeSubtitle: 'Проект готов к проверке, экспорту или завершению.',
    steps: {
      brief: {
        title: 'Бриф и вопрос', summary: 'Цель, охват и критерии чтения определены.',
        description: 'Определите цель, охват, основной вопрос и критерии отбора источников. Этот текст отображается в заголовке проекта, передаётся ИИ как контекст при генерации предложений и включается в экспорт.', actionLabel: 'Изменить бриф',
      },
      coverage: {
        title: 'Охват', summary: 'Основной вопрос связан с охватом корпуса.',
        description: 'Свяжите исследовательский вопрос с корпусом: укажите, какие области уже охвачены, а что ещё предстоит изучить. Отметка этого шага как выполняемого активирует раздел охвата в проекте.', actionLabel: 'Отметить охват',
      },
      materials: {
        title: 'Корпус и материалы', summary: 'Работы, идеи, заметки, пробелы или черновики готовы к интеграции.',
        description: 'Добавьте в проект работы, идеи, заметки, пробелы, дискуссии и черновики. ИИ будет использовать эти материалы, чтобы предлагать вставки с проверяемыми цитатами в рукописи.', actionLabel: 'Подготовить материалы',
      },
      outline: {
        title: 'Структура аргумента', summary: 'Дискуссии, пробелы и черновики упорядочены до вмешательства в текст.',
        description: 'Упорядочьте дискуссии, пробелы и черновики, которые будут формировать аргумент до написания глав. Можно активировать каждый блок отдельно, чтобы отметить его готовность к использованию.', actionLabel: 'Подготовить структуру',
      },
      manuscript: {
        title: 'Рукопись', summary: 'Глава или статья импортирована как редактируемый текст с версиями.',
        description: 'Импортируйте главу или статью как редактируемый текст. Nodus автоматически версионирует его и позволяет применять предложения к черновику.', actionLabel: 'Загрузить главу',
      },
      review: {
        title: 'Проверка и вывод', summary: 'Связи, проверяемые предложения и финальный экспорт.',
        description: 'Создайте проверяемые предложения по корпусу и проверьте цитаты рукописи до экспорта или завершения проекта.', actionLabel: 'Проверить главу',
      },
    },
    evidence: {
      briefPending: 'Ожидает', linkedQuestion: 'Связанный вопрос', coverageFallback: 'Охват не отмечен', coverageInProgress: 'Охват в работе', materialsFallback: 'Нет активных материалов', materialsInProgress: 'Материалы в работе', outlineFallback: 'Структура ожидает', manuscriptFallback: 'Глава не импортирована', reviewFallback: 'Проверка не зарегистрирована', reviewRecorded: 'Проверка зарегистрирована',
      linkedMaterials: (count) => `Связанных материалов: ${count}`, activeOutlineBlocks: (count) => `Активных блоков структуры: ${count}`, manuscriptCounts: (chapters, words) => `Глав: ${chapters}, слов: ${words}`, reviewCounts: (suggestions, applied) => `Предложений: ${suggestions}, применено: ${applied}`,
      sectionStatus: { ready: 'Готово', review: 'На проверке', inProgress: 'В работе' }, sectionLinks: (status, links) => `${status}, связей: ${links}`,
    },
  },
  uk: {
    kinds: {
      thesis: 'Керований потік дисертації', article: 'Керований потік статті', chapter: 'Керований потік рукопису',
      literature_review: 'Керований потік рукопису', theoretical_framework: 'Керований потік рукопису', other: 'Керований потік рукопису',
    },
    completeSubtitle: 'Проєкт готовий до перевірки, експорту або завершення.',
    steps: {
      brief: {
        title: 'Бриф і питання', summary: 'Мета, обсяг і критерії читання визначені.',
        description: 'Визначте мету, обсяг, головне питання та критерії відбору джерел. Цей текст відображається в заголовку проєкту, передається ШІ як контекст під час генерації пропозицій і включається до експорту.', actionLabel: 'Редагувати бриф',
      },
      coverage: {
        title: 'Охоплення', summary: 'Головне питання пов’язане з охопленням корпусу.',
        description: 'Пов’яжіть дослідницьке питання з корпусом: укажіть, які галузі вже охоплені, а що ще потрібно дослідити. Позначення цього кроку як виконуваного активує розділ охоплення в проєкті.', actionLabel: 'Позначити охоплення',
      },
      materials: {
        title: 'Корпус і матеріали', summary: 'Праці, ідеї, нотатки, прогалини або чернетки готові до інтеграції.',
        description: 'Додайте до проєкту праці, ідеї, нотатки, прогалини, дискусії та чернетки. ШІ використає ці матеріали, щоб пропонувати вставки з перевірними цитатами в рукописі.', actionLabel: 'Підготувати матеріали',
      },
      outline: {
        title: 'Структура аргументу', summary: 'Дискусії, прогалини й чернетки впорядковано до втручання в текст.',
        description: 'Упорядкуйте дискусії, прогалини й чернетки, які формуватимуть аргумент до написання розділів. Можна активувати кожен блок окремо, щоб позначити його готовність до використання.', actionLabel: 'Підготувати структуру',
      },
      manuscript: {
        title: 'Рукопис', summary: 'Розділ або статтю імпортовано як редагований текст із версіями.',
        description: 'Імпортуйте розділ або статтю як редагований текст. Nodus автоматично створює версії та дозволяє застосовувати пропозиції до чернетки.', actionLabel: 'Завантажити розділ',
      },
      review: {
        title: 'Перевірка та вивід', summary: 'Зв’язки, перевірні пропозиції та фінальний експорт.',
        description: 'Створіть перевірні пропозиції щодо корпусу та перегляньте цитати рукопису до експорту або завершення проєкту.', actionLabel: 'Перевірити розділ',
      },
    },
    evidence: {
      briefPending: 'Очікує', linkedQuestion: 'Пов’язане питання', coverageFallback: 'Охоплення не позначено', coverageInProgress: 'Охоплення в роботі', materialsFallback: 'Немає активних матеріалів', materialsInProgress: 'Матеріали в роботі', outlineFallback: 'Структура очікує', manuscriptFallback: 'Розділ не імпортовано', reviewFallback: 'Перевірку не зареєстровано', reviewRecorded: 'Перевірку зареєстровано',
      linkedMaterials: (count) => `Пов’язаних матеріалів: ${count}`, activeOutlineBlocks: (count) => `Активних блоків структури: ${count}`, manuscriptCounts: (chapters, words) => `Розділів: ${chapters}, слів: ${words}`, reviewCounts: (suggestions, applied) => `Пропозицій: ${suggestions}, застосовано: ${applied}`,
      sectionStatus: { ready: 'Готово', review: 'На перевірці', inProgress: 'У роботі' }, sectionLinks: (status, links) => `${status}, зв’язків: ${links}`,
    },
  },
  ko: {
    kinds: {
      thesis: '학위논문 안내 흐름', article: '학술 논문 안내 흐름', chapter: '원고 안내 흐름',
      literature_review: '원고 안내 흐름', theoretical_framework: '원고 안내 흐름', other: '원고 안내 흐름',
    },
    completeSubtitle: '프로젝트를 검토, 내보내기 또는 종료할 준비가 되었습니다.',
    steps: {
      brief: {
        title: '브리프와 질문', summary: '목표, 범위, 읽기 기준이 정의되었습니다.',
        description: '목표, 범위, 주요 질문, 자료 선정 기준을 정의하십시오. 이 텍스트는 프로젝트 머리말에 표시되고, 제안을 생성할 때 AI에 맥락으로 전송되며, 내보내기에도 포함됩니다.', actionLabel: '브리프 편집',
      },
      coverage: {
        title: '범위', summary: '주요 질문이 코퍼스 범위와 연결되었습니다.',
        description: '연구 질문을 코퍼스와 연결하십시오. 이미 다루어진 영역과 아직 탐구해야 할 부분을 밝히십시오. 이 단계를 진행 중으로 표시하면 프로젝트의 범위 섹션이 활성화됩니다.', actionLabel: '범위 표시',
      },
      materials: {
        title: '코퍼스와 자료', summary: '저작, 아이디어, 노트, 공백 또는 초안이 통합 준비되었습니다.',
        description: '저작, 아이디어, 노트, 공백, 논쟁, 초안을 프로젝트에 추가하십시오. AI는 이러한 자료를 사용하여 원고에 검증 가능한 인용이 포함된 삽입을 제안합니다.', actionLabel: '자료 준비',
      },
      outline: {
        title: '논증 구조', summary: '텍스트에 개입하기 전에 논쟁, 공백, 초안을 정리했습니다.',
        description: '장을 집필하기 전에 논증을 구성할 논쟁, 공백, 초안을 정리하십시오. 각 블록을 개별적으로 활성화하여 사용 가능함을 표시할 수 있습니다.', actionLabel: '구조 준비',
      },
      manuscript: {
        title: '원고', summary: '장 또는 논문을 편집 가능하고 버전 관리되는 텍스트로 가져왔습니다.',
        description: '장 또는 논문을 편집 가능한 텍스트로 가져오십시오. Nodus가 자동으로 버전을 만들고 초안에 제안을 적용할 수 있습니다.', actionLabel: '장 업로드',
      },
      review: {
        title: '검토와 출력', summary: '관계, 검증 가능한 제안, 최종 내보내기.',
        description: '코퍼스에 대한 검증 가능한 제안을 생성하고, 내보내거나 프로젝트를 종료하기 전에 원고의 인용을 검토하십시오.', actionLabel: '장 검토',
      },
    },
    evidence: {
      briefPending: '대기 중', linkedQuestion: '연결된 질문', coverageFallback: '범위가 표시되지 않음', coverageInProgress: '범위 진행 중', materialsFallback: '활성 자료 없음', materialsInProgress: '자료 진행 중', outlineFallback: '구조 대기 중', manuscriptFallback: '가져온 장 없음', reviewFallback: '기록된 검토 없음', reviewRecorded: '검토 기록됨',
      linkedMaterials: (count) => `연결된 자료 ${count}개`, activeOutlineBlocks: (count) => `활성 구조 블록 ${count}개`, manuscriptCounts: (chapters, words) => `${chapters}장, ${words}단어`, reviewCounts: (suggestions, applied) => `제안 ${suggestions}개, 적용 ${applied}개`,
      sectionStatus: { ready: '준비됨', review: '검토 중', inProgress: '진행 중' }, sectionLinks: (status, links) => `${status}, 링크 ${links}개`,
    },
  },
};

function guideCopy(language: PromptLanguage): ProjectGuideCopy {
  return PROJECT_GUIDE_COPY[language] ?? PROJECT_GUIDE_COPY.es;
}

export function buildProjectGuide(detail: ProjectDetail, language: PromptLanguage = 'es'): ProjectGuide {
  const copy = guideCopy(language);
  const briefText = detail.project.brief.trim();
  const briefReady = briefText.length > 0 || Boolean(detail.project.researchQuestionId);
  const coverageReady =
    sectionReady(detail, 'coverage') ||
    detail.links.some((link) => link.kind === 'research_question' && link.role !== 'discarded') ||
    Boolean(detail.project.researchQuestionId);
  const sourceLinks = detail.links.filter((link) => SOURCE_LINK_KINDS.has(link.kind) && link.role !== 'discarded');
  const materialsReady = sourceLinks.length > 0 || sectionReady(detail, 'literature');
  const outlineSignals = OUTLINE_ROLES.filter((role) => sectionReady(detail, role) || linksForRole(detail, role).length > 0);
  const outlineReady = outlineSignals.length >= 2;
  const manuscriptWords = detail.chapters.reduce((total, chapter) => total + chapter.wordCount, 0);
  const manuscriptReady = detail.chapters.length > 0;
  const manuscriptSection = sectionForRole(detail.sections, 'manuscript');
  const reviewReady =
    detail.stats.suggestions > 0 ||
    detail.stats.appliedSuggestions > 0 ||
    manuscriptSection?.status === 'review' ||
    manuscriptSection?.status === 'ready' ||
    detail.project.status === 'done';

  const definitions: Array<Omit<ProjectGuideStep, 'status'> & { ready: boolean }> = [
    {
      id: 'brief',
      ...copy.steps.brief,
      evidence: briefReady ? compactEvidence(briefText || detail.project.researchQuestionId || copy.evidence.linkedQuestion) : copy.evidence.briefPending,
      action: 'edit_brief',
      sectionRoles: ['brief'],
      ready: briefReady,
    },
    {
      id: 'coverage',
      ...copy.steps.coverage,
      evidence: coverageReady ? sectionEvidence(detail, 'coverage', copy.evidence.coverageInProgress, copy) : copy.evidence.coverageFallback,
      action: 'mark_coverage',
      sectionRoles: ['coverage'],
      ready: coverageReady,
    },
    {
      id: 'materials',
      ...copy.steps.materials,
      evidence: materialsReady
        ? sourceLinks.length > 0
          ? copy.evidence.linkedMaterials(sourceLinks.length)
          : sectionEvidence(detail, 'literature', copy.evidence.materialsInProgress, copy)
        : copy.evidence.materialsFallback,
      action: 'mark_materials',
      sectionRoles: ['literature'],
      ready: materialsReady,
    },
    {
      id: 'outline',
      ...copy.steps.outline,
      evidence: outlineReady ? copy.evidence.activeOutlineBlocks(outlineSignals.length) : copy.evidence.outlineFallback,
      action: 'mark_outline',
      sectionRoles: OUTLINE_ROLES,
      ready: outlineReady,
    },
    {
      id: 'manuscript',
      ...copy.steps.manuscript,
      evidence: manuscriptReady ? copy.evidence.manuscriptCounts(detail.chapters.length, manuscriptWords) : copy.evidence.manuscriptFallback,
      action: 'import_chapter',
      sectionRoles: ['manuscript'],
      ready: manuscriptReady,
    },
    {
      id: 'review',
      ...copy.steps.review,
      evidence: reviewReady
        ? detail.stats.suggestions > 0 || detail.stats.appliedSuggestions > 0
          ? copy.evidence.reviewCounts(detail.stats.suggestions, detail.stats.appliedSuggestions)
          : sectionEvidence(detail, 'manuscript', copy.evidence.reviewRecorded, copy)
        : copy.evidence.reviewFallback,
      action: 'review_chapter',
      sectionRoles: ['manuscript'],
      ready: reviewReady,
    },
  ];

  const firstOpenIndex = definitions.findIndex((step) => !step.ready);
  const steps = definitions.map(({ ready, ...step }, index): ProjectGuideStep => ({
    ...step,
    status: ready ? 'done' : index === firstOpenIndex ? 'current' : 'blocked',
  }));
  const doneCount = definitions.filter((step) => step.ready).length;
  const totalCount = definitions.length;

  return {
    title: copy.kinds[detail.project.kind],
    subtitle: definitions[firstOpenIndex]?.summary ?? copy.completeSubtitle,
    completion: Math.round((doneCount / totalCount) * 100),
    doneCount,
    totalCount,
    nextStep: steps.find((step) => step.status === 'current') ?? null,
    steps,
  };
}

function sectionForRole(sections: ProjectSection[], role: ProjectSectionRole): ProjectSection | null {
  return sections.find((section) => section.role === role) ?? null;
}

function sectionReady(detail: ProjectDetail, role: ProjectSectionRole): boolean {
  const section = sectionForRole(detail.sections, role);
  return Boolean(section && ACTIVE_SECTION_STATUSES.has(section.status));
}

function linksForRole(detail: ProjectDetail, role: ProjectSectionRole) {
  const ids = new Set(detail.sections.filter((section) => section.role === role).map((section) => section.id));
  return detail.links.filter((link) => link.sectionId && ids.has(link.sectionId) && link.role !== 'discarded');
}

function sectionEvidence(detail: ProjectDetail, role: ProjectSectionRole, fallback: string, copy: ProjectGuideCopy): string {
  const section = sectionForRole(detail.sections, role);
  if (!section) return fallback;
  const links = linksForRole(detail, role).length;
  const prefix = section.status === 'ready' ? copy.evidence.sectionStatus.ready : section.status === 'review' ? copy.evidence.sectionStatus.review : copy.evidence.sectionStatus.inProgress;
  return links > 0 ? copy.evidence.sectionLinks(prefix, links) : prefix;
}

function compactEvidence(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= 90) return clean;
  return `${clean.slice(0, 87)}...`;
}
