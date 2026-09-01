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
