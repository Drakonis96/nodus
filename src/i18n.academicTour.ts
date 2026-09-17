import type { AppLanguage } from '@shared/types';

type TourLanguage = Exclude<AppLanguage, 'es'>;

/**
 * Copy for the academic vault's essential tour.
 *
 * Keeping the seven translations beside the source flow makes product changes easy
 * to review as one unit. The Spanish keys are the canonical copy in Tour.tsx.
 */
export const ACADEMIC_TOUR_TRANSLATIONS: Record<TourLanguage, Record<string, string>> = {
  en: {
    'Bienvenido a tu vault académico': 'Welcome to your academic vault',
    'Aunque veas muchas opciones, para empezar solo necesitas una ruta: Biblioteca → Ideas → Grafo. En un minuto harás ese recorrido; puedes saltarlo o repetirlo desde Ajustes cuando quieras.':
      'Although there are many options, you only need one path to get started: Library → Ideas → Graph. This one-minute tour follows that path; you can skip it or replay it from Settings at any time.',
    'Empieza por una sola ruta': 'Start with one simple path',
    'Este distintivo indica en qué vault estás. Cada vault separa un proyecto de los demás, para que sus fuentes, análisis y borradores no se mezclen. Úsalo solo cuando quieras cambiar de proyecto o crear otro.':
      'This badge shows which vault you are in. Each vault keeps one project separate, so its sources, analyses and drafts do not get mixed with others. Use it only when you want to switch projects or create another one.',
    'Biblioteca: dos ámbitos, una decisión': 'Library: two scopes, one choice',
    'Global guarda las fuentes disponibles para todos tus proyectos; «Este vault» muestra solo las que participan aquí. Puedes añadir archivos, DOI, ISBN o referencias manuales, o sincronizar Zotero. No necesitas configurar todas las opciones para comenzar.':
      'Global stores sources available to all your projects; “This vault” shows only those used here. You can add files, DOIs, ISBNs or manual references, or sync Zotero. You do not need to configure every option to begin.',
    'Analiza solo lo que necesites': 'Analyze only what you need',
    'Añade una fuente al vault y cambia a «Este vault». Allí selecciona una o varias obras y pulsa «Analizar». Nodus extraerá temas, ideas, evidencia y relaciones. Empieza con una sola fuente: siempre podrás analizar más después.':
      'Add a source to the vault and switch to “This vault”. Select one or more works there and click “Analyze”. Nodus will extract themes, ideas, evidence and relationships. Start with one source; you can always analyze more later.',
    'La cola te cuenta qué ocurre': 'The queue tells you what is happening',
    'La barra inferior muestra el progreso de los análisis. Puedes seguir usando Nodus mientras trabaja. Si falta un modelo o una clave de IA, la tarea se pausa y te indica qué revisar en Ajustes; no tienes que adivinar qué falló.':
      'The bottom bar shows analysis progress. You can keep using Nodus while it works. If an AI model or key is missing, the task pauses and tells you what to check in Settings, so you never have to guess what failed.',
    'Comprueba antes de confiar': 'Check before you trust',
    'Ideas reúne lo extraído de tus lecturas. Abre una idea y revisa la cita o el pasaje que la sostiene. La IA ayuda a leer, pero la fuente sigue siendo la autoridad: esta comprobación es el hábito más importante del vault académico.':
      'Ideas brings together what was extracted from your reading. Open an idea and review the quotation or passage supporting it. AI helps you read, but the source remains the authority: this check is the most important habit in an academic vault.',
    'Las conexiones aparecen después': 'Connections come later',
    'Grafo muestra cada idea como un nodo y sus relaciones como enlaces. Al principio puede estar vacío o ser pequeño: es normal. Se vuelve útil a medida que analizas fuentes verificadas, no antes.':
      'Graph shows each idea as a node and its relationships as links. It may be empty or small at first; that is normal. It becomes useful as you analyze verified sources, not before.',
    'Escribe sin salir del corpus': 'Write without leaving your corpus',
    'Espacio de trabajo reúne notas, borradores y proyectos de escritura. Conserva los enlaces internos a fuentes e ideas para que puedas volver a la evidencia mientras redactas. No hace falta usarlo hasta que tengas algo que desarrollar.':
      'Workspace brings together notes, drafts and writing projects. It preserves internal links to sources and ideas so you can return to the evidence while writing. You do not need it until you have something to develop.',
    'Lo demás puede esperar': 'Everything else can wait',
    'El menú agrupa funciones por intención: Explorar, Analizar, Escribir y Herramientas. Ábrelas cuando tu investigación las necesite; en Ajustes puedes ocultar o reordenar secciones. Tu primera misión es sencilla: añade una fuente, analízala y verifica una idea.':
      'The menu groups features by purpose: Explore, Analyze, Write and Tools. Open them when your research needs them; Settings lets you hide or reorder sections. Your first mission is simple: add one source, analyze it and verify one idea.',
  },
  fr: {
    'Bienvenido a tu vault académico': 'Bienvenue dans votre vault académique',
    'Aunque veas muchas opciones, para empezar solo necesitas una ruta: Biblioteca → Ideas → Grafo. En un minuto harás ese recorrido; puedes saltarlo o repetirlo desde Ajustes cuando quieras.':
      'Même si de nombreuses options sont affichées, un seul parcours suffit pour commencer : Bibliothèque → Idées → Graphe. Cette visite d’une minute suit ce chemin ; vous pouvez la passer ou la relancer depuis les Paramètres.',
    'Empieza por una sola ruta': 'Commencez par un parcours simple',
    'Este distintivo indica en qué vault estás. Cada vault separa un proyecto de los demás, para que sus fuentes, análisis y borradores no se mezclen. Úsalo solo cuando quieras cambiar de proyecto o crear otro.':
      'Ce badge indique dans quel vault vous vous trouvez. Chaque vault isole un projet afin que ses sources, analyses et brouillons ne se mélangent pas aux autres. Utilisez-le seulement pour changer de projet ou en créer un autre.',
    'Biblioteca: dos ámbitos, una decisión': 'Bibliothèque : deux espaces, un choix',
    'Global guarda las fuentes disponibles para todos tus proyectos; «Este vault» muestra solo las que participan aquí. Puedes añadir archivos, DOI, ISBN o referencias manuales, o sincronizar Zotero. No necesitas configurar todas las opciones para comenzar.':
      'Global conserve les sources disponibles pour tous vos projets ; « Ce vault » affiche uniquement celles utilisées ici. Vous pouvez ajouter des fichiers, DOI, ISBN ou références manuelles, ou synchroniser Zotero. Il n’est pas nécessaire de tout configurer pour commencer.',
    'Analiza solo lo que necesites': 'Analysez uniquement ce dont vous avez besoin',
    'Añade una fuente al vault y cambia a «Este vault». Allí selecciona una o varias obras y pulsa «Analizar». Nodus extraerá temas, ideas, evidencia y relaciones. Empieza con una sola fuente: siempre podrás analizar más después.':
      'Ajoutez une source au vault puis passez à « Ce vault ». Sélectionnez-y une ou plusieurs œuvres et cliquez sur « Analyser ». Nodus extraira thèmes, idées, preuves et relations. Commencez par une source ; vous pourrez toujours en analyser davantage.',
    'La cola te cuenta qué ocurre': 'La file indique ce qui se passe',
    'La barra inferior muestra el progreso de los análisis. Puedes seguir usando Nodus mientras trabaja. Si falta un modelo o una clave de IA, la tarea se pausa y te indica qué revisar en Ajustes; no tienes que adivinar qué falló.':
      'La barre inférieure affiche la progression des analyses. Vous pouvez continuer à utiliser Nodus pendant ce temps. Si un modèle ou une clé d’IA manque, la tâche se met en pause et indique quoi vérifier dans les Paramètres.',
    'Comprueba antes de confiar': 'Vérifiez avant de faire confiance',
    'Ideas reúne lo extraído de tus lecturas. Abre una idea y revisa la cita o el pasaje que la sostiene. La IA ayuda a leer, pero la fuente sigue siendo la autoridad: esta comprobación es el hábito más importante del vault académico.':
      'Idées rassemble ce qui a été extrait de vos lectures. Ouvrez une idée et vérifiez la citation ou le passage qui l’étaye. L’IA aide à lire, mais la source reste l’autorité : cette vérification est l’habitude la plus importante du vault académique.',
    'Las conexiones aparecen después': 'Les connexions apparaissent ensuite',
    'Grafo muestra cada idea como un nodo y sus relaciones como enlaces. Al principio puede estar vacío o ser pequeño: es normal. Se vuelve útil a medida que analizas fuentes verificadas, no antes.':
      'Graphe affiche chaque idée comme un nœud et ses relations comme des liens. Il peut être vide ou modeste au début : c’est normal. Il devient utile à mesure que vous analysez des sources vérifiées.',
    'Escribe sin salir del corpus': 'Écrivez sans quitter votre corpus',
    'Espacio de trabajo reúne notas, borradores y proyectos de escritura. Conserva los enlaces internos a fuentes e ideas para que puedas volver a la evidencia mientras redactas. No hace falta usarlo hasta que tengas algo que desarrollar.':
      'Espace de travail réunit notes, brouillons et projets d’écriture. Il conserve les liens internes vers les sources et les idées afin de revenir aux preuves pendant la rédaction. Vous n’en avez pas besoin avant d’avoir quelque chose à développer.',
    'Lo demás puede esperar': 'Le reste peut attendre',
    'El menú agrupa funciones por intención: Explorar, Analizar, Escribir y Herramientas. Ábrelas cuando tu investigación las necesite; en Ajustes puedes ocultar o reordenar secciones. Tu primera misión es sencilla: añade una fuente, analízala y verifica una idea.':
      'Le menu regroupe les fonctions par intention : Explorer, Analyser, Écrire et Outils. Ouvrez-les lorsque votre recherche en a besoin ; les Paramètres permettent de masquer ou réorganiser des sections. Première mission : ajoutez une source, analysez-la et vérifiez une idée.',
  },
  de: {
    'Bienvenido a tu vault académico': 'Willkommen in deinem akademischen Vault',
    'Aunque veas muchas opciones, para empezar solo necesitas una ruta: Biblioteca → Ideas → Grafo. En un minuto harás ese recorrido; puedes saltarlo o repetirlo desde Ajustes cuando quieras.':
      'Auch wenn viele Optionen sichtbar sind, brauchst du zum Einstieg nur einen Weg: Bibliothek → Ideen → Graph. Diese einminütige Tour folgt diesem Weg; du kannst sie überspringen oder jederzeit in den Einstellungen erneut starten.',
    'Empieza por una sola ruta': 'Beginne mit einem einfachen Weg',
    'Este distintivo indica en qué vault estás. Cada vault separa un proyecto de los demás, para que sus fuentes, análisis y borradores no se mezclen. Úsalo solo cuando quieras cambiar de proyecto o crear otro.':
      'Dieses Abzeichen zeigt, in welchem Vault du dich befindest. Jeder Vault hält ein Projekt getrennt, damit Quellen, Analysen und Entwürfe nicht vermischt werden. Nutze es nur, um das Projekt zu wechseln oder ein neues anzulegen.',
    'Biblioteca: dos ámbitos, una decisión': 'Bibliothek: zwei Bereiche, eine Entscheidung',
    'Global guarda las fuentes disponibles para todos tus proyectos; «Este vault» muestra solo las que participan aquí. Puedes añadir archivos, DOI, ISBN o referencias manuales, o sincronizar Zotero. No necesitas configurar todas las opciones para comenzar.':
      'Global speichert Quellen für alle Projekte; „Dieser Vault“ zeigt nur die hier verwendeten. Du kannst Dateien, DOIs, ISBNs oder manuelle Referenzen hinzufügen oder Zotero synchronisieren. Für den Einstieg musst du nicht alles konfigurieren.',
    'Analiza solo lo que necesites': 'Analysiere nur, was du brauchst',
    'Añade una fuente al vault y cambia a «Este vault». Allí selecciona una o varias obras y pulsa «Analizar». Nodus extraerá temas, ideas, evidencia y relaciones. Empieza con una sola fuente: siempre podrás analizar más después.':
      'Füge dem Vault eine Quelle hinzu und wechsle zu „Dieser Vault“. Wähle dort ein oder mehrere Werke und klicke auf „Analysieren“. Nodus extrahiert Themen, Ideen, Belege und Beziehungen. Beginne mit einer Quelle; weitere kannst du später analysieren.',
    'La cola te cuenta qué ocurre': 'Die Warteschlange zeigt, was passiert',
    'La barra inferior muestra el progreso de los análisis. Puedes seguir usando Nodus mientras trabaja. Si falta un modelo o una clave de IA, la tarea se pausa y te indica qué revisar en Ajustes; no tienes que adivinar qué falló.':
      'Die untere Leiste zeigt den Fortschritt der Analysen. Du kannst Nodus währenddessen weiter nutzen. Fehlt ein KI-Modell oder Schlüssel, pausiert die Aufgabe und zeigt, was in den Einstellungen geprüft werden muss.',
    'Comprueba antes de confiar': 'Prüfe, bevor du vertraust',
    'Ideas reúne lo extraído de tus lecturas. Abre una idea y revisa la cita o el pasaje que la sostiene. La IA ayuda a leer, pero la fuente sigue siendo la autoridad: esta comprobación es el hábito más importante del vault académico.':
      'Ideen bündelt, was aus deinen Lektüren extrahiert wurde. Öffne eine Idee und prüfe das Zitat oder die Passage, die sie stützt. KI hilft beim Lesen, doch die Quelle bleibt maßgeblich: Diese Prüfung ist die wichtigste Gewohnheit im akademischen Vault.',
    'Las conexiones aparecen después': 'Verbindungen entstehen später',
    'Grafo muestra cada idea como un nodo y sus relaciones como enlaces. Al principio puede estar vacío o ser pequeño: es normal. Se vuelve útil a medida que analizas fuentes verificadas, no antes.':
      'Graph zeigt jede Idee als Knoten und ihre Beziehungen als Verbindungen. Anfangs kann er leer oder klein sein; das ist normal. Nützlich wird er, sobald du geprüfte Quellen analysierst.',
    'Escribe sin salir del corpus': 'Schreibe, ohne den Korpus zu verlassen',
    'Espacio de trabajo reúne notas, borradores y proyectos de escritura. Conserva los enlaces internos a fuentes e ideas para que puedas volver a la evidencia mientras redactas. No hace falta usarlo hasta que tengas algo que desarrollar.':
      'Arbeitsbereich vereint Notizen, Entwürfe und Schreibprojekte. Interne Links zu Quellen und Ideen bleiben erhalten, damit du beim Schreiben zu den Belegen zurückkehren kannst. Du brauchst ihn erst, wenn du etwas ausarbeiten möchtest.',
    'Lo demás puede esperar': 'Alles andere kann warten',
    'El menú agrupa funciones por intención: Explorar, Analizar, Escribir y Herramientas. Ábrelas cuando tu investigación las necesite; en Ajustes puedes ocultar o reordenar secciones. Tu primera misión es sencilla: añade una fuente, analízala y verifica una idea.':
      'Das Menü gruppiert Funktionen nach Zweck: Erkunden, Analysieren, Schreiben und Werkzeuge. Öffne sie erst, wenn deine Forschung sie braucht; in den Einstellungen kannst du Bereiche ausblenden oder neu ordnen. Erste Aufgabe: eine Quelle hinzufügen, analysieren und eine Idee prüfen.',
  },
  pt: {
    'Bienvenido a tu vault académico': 'Bem-vindo ao seu vault académico',
    'Aunque veas muchas opciones, para empezar solo necesitas una ruta: Biblioteca → Ideas → Grafo. En un minuto harás ese recorrido; puedes saltarlo o repetirlo desde Ajustes cuando quieras.':
      'Embora veja muitas opções, para começar só precisa de um percurso: Biblioteca → Ideias → Grafo. Esta visita de um minuto segue esse caminho; pode ignorá-la ou repeti-la nas Definições quando quiser.',
    'Empieza por una sola ruta': 'Comece por um percurso simples',
    'Este distintivo indica en qué vault estás. Cada vault separa un proyecto de los demás, para que sus fuentes, análisis y borradores no se mezclen. Úsalo solo cuando quieras cambiar de proyecto o crear otro.':
      'Este distintivo indica em que vault está. Cada vault mantém um projeto separado, para que fontes, análises e rascunhos não se misturem. Use-o apenas quando quiser mudar de projeto ou criar outro.',
    'Biblioteca: dos ámbitos, una decisión': 'Biblioteca: dois âmbitos, uma decisão',
    'Global guarda las fuentes disponibles para todos tus proyectos; «Este vault» muestra solo las que participan aquí. Puedes añadir archivos, DOI, ISBN o referencias manuales, o sincronizar Zotero. No necesitas configurar todas las opciones para comenzar.':
      'Global guarda as fontes disponíveis para todos os projetos; «Este vault» mostra apenas as usadas aqui. Pode adicionar ficheiros, DOI, ISBN ou referências manuais, ou sincronizar o Zotero. Não precisa de configurar todas as opções para começar.',
    'Analiza solo lo que necesites': 'Analise apenas o que precisa',
    'Añade una fuente al vault y cambia a «Este vault». Allí selecciona una o varias obras y pulsa «Analizar». Nodus extraerá temas, ideas, evidencia y relaciones. Empieza con una sola fuente: siempre podrás analizar más después.':
      'Adicione uma fonte ao vault e mude para «Este vault». Aí, selecione uma ou várias obras e prima «Analisar». O Nodus extrairá temas, ideias, evidências e relações. Comece com uma fonte; poderá analisar mais depois.',
    'La cola te cuenta qué ocurre': 'A fila mostra o que está a acontecer',
    'La barra inferior muestra el progreso de los análisis. Puedes seguir usando Nodus mientras trabaja. Si falta un modelo o una clave de IA, la tarea se pausa y te indica qué revisar en Ajustes; no tienes que adivinar qué falló.':
      'A barra inferior mostra o progresso das análises. Pode continuar a usar o Nodus enquanto trabalha. Se faltar um modelo ou uma chave de IA, a tarefa pausa e indica o que deve verificar nas Definições.',
    'Comprueba antes de confiar': 'Verifique antes de confiar',
    'Ideas reúne lo extraído de tus lecturas. Abre una idea y revisa la cita o el pasaje que la sostiene. La IA ayuda a leer, pero la fuente sigue siendo la autoridad: esta comprobación es el hábito más importante del vault académico.':
      'Ideias reúne o que foi extraído das suas leituras. Abra uma ideia e verifique a citação ou passagem que a sustenta. A IA ajuda a ler, mas a fonte continua a ser a autoridade: esta verificação é o hábito mais importante do vault académico.',
    'Las conexiones aparecen después': 'As ligações aparecem depois',
    'Grafo muestra cada idea como un nodo y sus relaciones como enlaces. Al principio puede estar vacío o ser pequeño: es normal. Se vuelve útil a medida que analizas fuentes verificadas, no antes.':
      'Grafo mostra cada ideia como um nó e as suas relações como ligações. No início pode estar vazio ou ser pequeno; é normal. Torna-se útil à medida que analisa fontes verificadas.',
    'Escribe sin salir del corpus': 'Escreva sem sair do corpus',
    'Espacio de trabajo reúne notas, borradores y proyectos de escritura. Conserva los enlaces internos a fuentes e ideas para que puedas volver a la evidencia mientras redactas. No hace falta usarlo hasta que tengas algo que desarrollar.':
      'Espaço de trabalho reúne notas, rascunhos e projetos de escrita. Mantém as ligações internas a fontes e ideias para poder regressar às evidências enquanto escreve. Só precisa dele quando tiver algo para desenvolver.',
    'Lo demás puede esperar': 'O resto pode esperar',
    'El menú agrupa funciones por intención: Explorar, Analizar, Escribir y Herramientas. Ábrelas cuando tu investigación las necesite; en Ajustes puedes ocultar o reordenar secciones. Tu primera misión es sencilla: añade una fuente, analízala y verifica una idea.':
      'O menu agrupa funções por objetivo: Explorar, Analisar, Escrever e Ferramentas. Abra-as quando a sua investigação precisar; nas Definições pode ocultar ou reordenar secções. Primeira missão: adicione uma fonte, analise-a e verifique uma ideia.',
  },
  'pt-BR': {
    'Bienvenido a tu vault académico': 'Boas-vindas ao seu vault acadêmico',
    'Aunque veas muchas opciones, para empezar solo necesitas una ruta: Biblioteca → Ideas → Grafo. En un minuto harás ese recorrido; puedes saltarlo o repetirlo desde Ajustes cuando quieras.':
      'Mesmo com tantas opções, você só precisa de um caminho para começar: Biblioteca → Ideias → Grafo. Este tour de um minuto segue esse caminho; você pode pulá-lo ou repeti-lo em Configurações quando quiser.',
    'Empieza por una sola ruta': 'Comece por um caminho simples',
    'Este distintivo indica en qué vault estás. Cada vault separa un proyecto de los demás, para que sus fuentes, análisis y borradores no se mezclen. Úsalo solo cuando quieras cambiar de proyecto o crear otro.':
      'Este selo indica em qual vault você está. Cada vault mantém um projeto separado para que fontes, análises e rascunhos não se misturem. Use-o apenas para trocar de projeto ou criar outro.',
    'Biblioteca: dos ámbitos, una decisión': 'Biblioteca: dois escopos, uma escolha',
    'Global guarda las fuentes disponibles para todos tus proyectos; «Este vault» muestra solo las que participan aquí. Puedes añadir archivos, DOI, ISBN o referencias manuales, o sincronizar Zotero. No necesitas configurar todas las opciones para comenzar.':
      'Global guarda as fontes disponíveis para todos os projetos; “Este vault” mostra apenas as usadas aqui. Você pode adicionar arquivos, DOI, ISBN ou referências manuais, ou sincronizar o Zotero. Não é preciso configurar tudo para começar.',
    'Analiza solo lo que necesites': 'Analise apenas o que você precisa',
    'Añade una fuente al vault y cambia a «Este vault». Allí selecciona una o varias obras y pulsa «Analizar». Nodus extraerá temas, ideas, evidencia y relaciones. Empieza con una sola fuente: siempre podrás analizar más después.':
      'Adicione uma fonte ao vault e mude para “Este vault”. Selecione uma ou mais obras e clique em “Analisar”. O Nodus extrairá temas, ideias, evidências e relações. Comece com uma fonte; você sempre poderá analisar mais depois.',
    'La cola te cuenta qué ocurre': 'A fila mostra o que está acontecendo',
    'La barra inferior muestra el progreso de los análisis. Puedes seguir usando Nodus mientras trabaja. Si falta un modelo o una clave de IA, la tarea se pausa y te indica qué revisar en Ajustes; no tienes que adivinar qué falló.':
      'A barra inferior mostra o progresso das análises. Você pode continuar usando o Nodus enquanto ele trabalha. Se faltar um modelo ou uma chave de IA, a tarefa pausa e informa o que revisar em Configurações.',
    'Comprueba antes de confiar': 'Confira antes de confiar',
    'Ideas reúne lo extraído de tus lecturas. Abre una idea y revisa la cita o el pasaje que la sostiene. La IA ayuda a leer, pero la fuente sigue siendo la autoridad: esta comprobación es el hábito más importante del vault académico.':
      'Ideias reúne o que foi extraído das suas leituras. Abra uma ideia e confira a citação ou o trecho que a sustenta. A IA ajuda na leitura, mas a fonte continua sendo a autoridade: essa verificação é o hábito mais importante do vault acadêmico.',
    'Las conexiones aparecen después': 'As conexões aparecem depois',
    'Grafo muestra cada idea como un nodo y sus relaciones como enlaces. Al principio puede estar vacío o ser pequeño: es normal. Se vuelve útil a medida que analizas fuentes verificadas, no antes.':
      'Grafo mostra cada ideia como um nó e suas relações como conexões. No começo ele pode estar vazio ou pequeno; isso é normal. Ele se torna útil à medida que você analisa fontes verificadas.',
    'Escribe sin salir del corpus': 'Escreva sem sair do corpus',
    'Espacio de trabajo reúne notas, borradores y proyectos de escritura. Conserva los enlaces internos a fuentes e ideas para que puedas volver a la evidencia mientras redactas. No hace falta usarlo hasta que tengas algo que desarrollar.':
      'Espaço de trabalho reúne notas, rascunhos e projetos de escrita. Ele preserva links internos para fontes e ideias, permitindo voltar às evidências durante a redação. Você só precisa usá-lo quando tiver algo para desenvolver.',
    'Lo demás puede esperar': 'O restante pode esperar',
    'El menú agrupa funciones por intención: Explorar, Analizar, Escribir y Herramientas. Ábrelas cuando tu investigación las necesite; en Ajustes puedes ocultar o reordenar secciones. Tu primera misión es sencilla: añade una fuente, analízala y verifica una idea.':
      'O menu agrupa recursos por objetivo: Explorar, Analisar, Escrever e Ferramentas. Abra-os quando sua pesquisa precisar; em Configurações você pode ocultar ou reordenar seções. Primeira missão: adicione uma fonte, analise-a e verifique uma ideia.',
  },
  it: {
    'Bienvenido a tu vault académico': 'Benvenuto nel tuo vault accademico',
    'Aunque veas muchas opciones, para empezar solo necesitas una ruta: Biblioteca → Ideas → Grafo. En un minuto harás ese recorrido; puedes saltarlo o repetirlo desde Ajustes cuando quieras.':
      'Anche se vedi molte opzioni, per iniziare ti basta un percorso: Biblioteca → Idee → Grafo. Questo tour di un minuto segue quel percorso; puoi saltarlo o ripeterlo dalle Impostazioni in qualsiasi momento.',
    'Empieza por una sola ruta': 'Inizia con un percorso semplice',
    'Este distintivo indica en qué vault estás. Cada vault separa un proyecto de los demás, para que sus fuentes, análisis y borradores no se mezclen. Úsalo solo cuando quieras cambiar de proyecto o crear otro.':
      'Questo distintivo indica in quale vault ti trovi. Ogni vault mantiene separato un progetto, così fonti, analisi e bozze non si mescolano. Usalo solo per cambiare progetto o crearne un altro.',
    'Biblioteca: dos ámbitos, una decisión': 'Biblioteca: due ambiti, una scelta',
    'Global guarda las fuentes disponibles para todos tus proyectos; «Este vault» muestra solo las que participan aquí. Puedes añadir archivos, DOI, ISBN o referencias manuales, o sincronizar Zotero. No necesitas configurar todas las opciones para comenzar.':
      'Globale conserva le fonti disponibili per tutti i progetti; “Questo vault” mostra solo quelle usate qui. Puoi aggiungere file, DOI, ISBN o riferimenti manuali, oppure sincronizzare Zotero. Non serve configurare tutto per iniziare.',
    'Analiza solo lo que necesites': 'Analizza solo ciò che ti serve',
    'Añade una fuente al vault y cambia a «Este vault». Allí selecciona una o varias obras y pulsa «Analizar». Nodus extraerá temas, ideas, evidencia y relaciones. Empieza con una sola fuente: siempre podrás analizar más después.':
      'Aggiungi una fonte al vault e passa a “Questo vault”. Seleziona una o più opere e premi “Analizza”. Nodus estrarrà temi, idee, prove e relazioni. Inizia con una fonte; potrai sempre analizzarne altre in seguito.',
    'La cola te cuenta qué ocurre': 'La coda mostra cosa sta succedendo',
    'La barra inferior muestra el progreso de los análisis. Puedes seguir usando Nodus mientras trabaja. Si falta un modelo o una clave de IA, la tarea se pausa y te indica qué revisar en Ajustes; no tienes que adivinar qué falló.':
      'La barra inferiore mostra l’avanzamento delle analisi. Puoi continuare a usare Nodus mentre lavora. Se manca un modello o una chiave IA, l’attività si mette in pausa e indica cosa controllare nelle Impostazioni.',
    'Comprueba antes de confiar': 'Controlla prima di fidarti',
    'Ideas reúne lo extraído de tus lecturas. Abre una idea y revisa la cita o el pasaje que la sostiene. La IA ayuda a leer, pero la fuente sigue siendo la autoridad: esta comprobación es el hábito más importante del vault académico.':
      'Idee raccoglie ciò che è stato estratto dalle tue letture. Apri un’idea e controlla la citazione o il passaggio che la sostiene. L’IA aiuta a leggere, ma la fonte resta l’autorità: questa verifica è l’abitudine più importante del vault accademico.',
    'Las conexiones aparecen después': 'Le connessioni arrivano dopo',
    'Grafo muestra cada idea como un nodo y sus relaciones como enlaces. Al principio puede estar vacío o ser pequeño: es normal. Se vuelve útil a medida que analizas fuentes verificadas, no antes.':
      'Grafo mostra ogni idea come un nodo e le sue relazioni come collegamenti. All’inizio può essere vuoto o piccolo: è normale. Diventa utile man mano che analizzi fonti verificate.',
    'Escribe sin salir del corpus': 'Scrivi senza uscire dal corpus',
    'Espacio de trabajo reúne notas, borradores y proyectos de escritura. Conserva los enlaces internos a fuentes e ideas para que puedas volver a la evidencia mientras redactas. No hace falta usarlo hasta que tengas algo que desarrollar.':
      'Spazio di lavoro riunisce note, bozze e progetti di scrittura. Mantiene i collegamenti interni a fonti e idee, così puoi tornare alle prove mentre scrivi. Non serve usarlo finché non hai qualcosa da sviluppare.',
    'Lo demás puede esperar': 'Il resto può aspettare',
    'El menú agrupa funciones por intención: Explorar, Analizar, Escribir y Herramientas. Ábrelas cuando tu investigación las necesite; en Ajustes puedes ocultar o reordenar secciones. Tu primera misión es sencilla: añade una fuente, analízala y verifica una idea.':
      'Il menu raggruppa le funzioni per scopo: Esplora, Analizza, Scrivi e Strumenti. Aprile quando servono alla tua ricerca; nelle Impostazioni puoi nascondere o riordinare le sezioni. Prima missione: aggiungi una fonte, analizzala e verifica un’idea.',
  },
  tr: {
    'Bienvenido a tu vault académico': 'Akademik vault’una hoş geldin',
    'Aunque veas muchas opciones, para empezar solo necesitas una ruta: Biblioteca → Ideas → Grafo. En un minuto harás ese recorrido; puedes saltarlo o repetirlo desde Ajustes cuando quieras.':
      'Birçok seçenek görsen de başlamak için tek bir yol yeter: Kütüphane → Fikirler → Grafik. Bu bir dakikalık tur o yolu izler; turu atlayabilir veya Ayarlar’dan istediğin zaman yeniden başlatabilirsin.',
    'Empieza por una sola ruta': 'Tek ve basit bir yolla başla',
    'Este distintivo indica en qué vault estás. Cada vault separa un proyecto de los demás, para que sus fuentes, análisis y borradores no se mezclen. Úsalo solo cuando quieras cambiar de proyecto o crear otro.':
      'Bu rozet hangi vault’ta olduğunu gösterir. Her vault bir projeyi diğerlerinden ayırır; böylece kaynaklar, analizler ve taslaklar karışmaz. Rozeti yalnızca proje değiştirmek veya yeni bir proje oluşturmak istediğinde kullan.',
    'Biblioteca: dos ámbitos, una decisión': 'Kütüphane: iki kapsam, tek seçim',
    'Global guarda las fuentes disponibles para todos tus proyectos; «Este vault» muestra solo las que participan aquí. Puedes añadir archivos, DOI, ISBN o referencias manuales, o sincronizar Zotero. No necesitas configurar todas las opciones para comenzar.':
      'Global, tüm projelerde kullanılabilen kaynakları saklar; “Bu vault” yalnızca burada kullanılanları gösterir. Dosya, DOI, ISBN veya elle referans ekleyebilir ya da Zotero’yu eşitleyebilirsin. Başlamak için her seçeneği yapılandırman gerekmez.',
    'Analiza solo lo que necesites': 'Yalnızca ihtiyacın olanı analiz et',
    'Añade una fuente al vault y cambia a «Este vault». Allí selecciona una o varias obras y pulsa «Analizar». Nodus extraerá temas, ideas, evidencia y relaciones. Empieza con una sola fuente: siempre podrás analizar más después.':
      'Vault’a bir kaynak ekle ve “Bu vault”a geç. Burada bir veya daha fazla eser seçip “Analiz et”e tıkla. Nodus temaları, fikirleri, kanıtları ve ilişkileri çıkarır. Tek bir kaynakla başla; daha fazlasını sonra analiz edebilirsin.',
    'La cola te cuenta qué ocurre': 'Kuyruk neler olduğunu gösterir',
    'La barra inferior muestra el progreso de los análisis. Puedes seguir usando Nodus mientras trabaja. Si falta un modelo o una clave de IA, la tarea se pausa y te indica qué revisar en Ajustes; no tienes que adivinar qué falló.':
      'Alt çubuk analizlerin ilerlemesini gösterir. Nodus çalışırken uygulamayı kullanmaya devam edebilirsin. Bir yapay zekâ modeli veya anahtarı eksikse görev duraklar ve Ayarlar’da neyi kontrol etmen gerektiğini söyler.',
    'Comprueba antes de confiar': 'Güvenmeden önce kontrol et',
    'Ideas reúne lo extraído de tus lecturas. Abre una idea y revisa la cita o el pasaje que la sostiene. La IA ayuda a leer, pero la fuente sigue siendo la autoridad: esta comprobación es el hábito más importante del vault académico.':
      'Fikirler, okumalarından çıkarılanları bir araya getirir. Bir fikri açıp onu destekleyen alıntıyı veya bölümü kontrol et. Yapay zekâ okumaya yardımcı olur, ancak yetkili olan kaynaktır: Bu kontrol akademik vault’taki en önemli alışkanlıktır.',
    'Las conexiones aparecen después': 'Bağlantılar daha sonra oluşur',
    'Grafo muestra cada idea como un nodo y sus relaciones como enlaces. Al principio puede estar vacío o ser pequeño: es normal. Se vuelve útil a medida que analizas fuentes verificadas, no antes.':
      'Grafik her fikri bir düğüm, ilişkilerini ise bağlantı olarak gösterir. Başta boş veya küçük olabilir; bu normaldir. Doğrulanmış kaynakları analiz ettikçe faydalı hâle gelir.',
    'Escribe sin salir del corpus': 'Korpustan ayrılmadan yaz',
    'Espacio de trabajo reúne notas, borradores y proyectos de escritura. Conserva los enlaces internos a fuentes e ideas para que puedas volver a la evidencia mientras redactas. No hace falta usarlo hasta que tengas algo que desarrollar.':
      'Çalışma Alanı notları, taslakları ve yazı projelerini bir araya getirir. Yazarken kanıtlara dönebilmen için kaynaklara ve fikirlere giden iç bağlantıları korur. Geliştirecek bir şeyin olana kadar kullanman gerekmez.',
    'Lo demás puede esperar': 'Geri kalan her şey bekleyebilir',
    'El menú agrupa funciones por intención: Explorar, Analizar, Escribir y Herramientas. Ábrelas cuando tu investigación las necesite; en Ajustes puedes ocultar o reordenar secciones. Tu primera misión es sencilla: añade una fuente, analízala y verifica una idea.':
      'Menü özellikleri amaca göre gruplar: Keşfet, Analiz et, Yaz ve Araçlar. Araştırman gerektiğinde bunları aç; Ayarlar’da bölümleri gizleyebilir veya yeniden sıralayabilirsin. İlk görevin basit: bir kaynak ekle, analiz et ve bir fikri doğrula.',
  },
  'zh-CN': {
    'Bienvenido a tu vault académico': '欢迎使用你的学术资料库',
    'Aunque veas muchas opciones, para empezar solo necesitas una ruta: Biblioteca → Ideas → Grafo. En un minuto harás ese recorrido; puedes saltarlo o repetirlo desde Ajustes cuando quieras.':
      '尽管选项很多，但入门只需一条路径：文献库 → 观点 → 图谱。这个一分钟的引导会带你走完这条路径；你可以随时跳过，或从设置中重新播放。',
    'Empieza por una sola ruta': '从一条简单的路径开始',
    'Este distintivo indica en qué vault estás. Cada vault separa un proyecto de los demás, para que sus fuentes, análisis y borradores no se mezclen. Úsalo solo cuando quieras cambiar de proyecto o crear otro.':
      '此标识显示你当前所在的资料库。每个资料库都将一个项目与其他项目隔离，使其来源、分析和草稿不会混淆。仅在想切换项目或创建新项目时才使用它。',
    'Biblioteca: dos ámbitos, una decisión': '文献库：两种范围，一个选择',
    'Global guarda las fuentes disponibles para todos tus proyectos; «Este vault» muestra solo las que participan aquí. Puedes añadir archivos, DOI, ISBN o referencias manuales, o sincronizar Zotero. No necesitas configurar todas las opciones para comenzar.':
      '「全局」保存所有项目可用的来源；「此资料库」仅显示在此处使用的来源。你可以添加文件、DOI、ISBN或手动引用，也可以同步Zotero。开始前无需配置所有选项。',
    'Analiza solo lo que necesites': '只分析你需要的内容',
    'Añade una fuente al vault y cambia a «Este vault». Allí selecciona una o varias obras y pulsa «Analizar». Nodus extraerá temas, ideas, evidencia y relaciones. Empieza con una sola fuente: siempre podrás analizar más después.':
      '向资料库添加一个来源并切换到「此资料库」。在其中选择一篇或多篇文献，然后点击「分析」。Nodus将提取主题、观点、证据和关系。先从单个来源开始：之后随时可以分析更多。',
    'La cola te cuenta qué ocurre': '队列会告诉你正在发生什么',
    'La barra inferior muestra el progreso de los análisis. Puedes seguir usando Nodus mientras trabaja. Si falta un modelo o una clave de IA, la tarea se pausa y te indica qué revisar en Ajustes; no tienes que adivinar qué falló.':
      '底部栏显示分析进度。Nodus工作时你可以继续使用。如果缺少模型或AI密钥，任务会暂停并提示你在设置中检查什么；无需猜测哪里出了问题。',
    'Comprueba antes de confiar': '先核实，再采信',
    'Ideas reúne lo extraído de tus lecturas. Abre una idea y revisa la cita o el pasaje que la sostiene. La IA ayuda a leer, pero la fuente sigue siendo la autoridad: esta comprobación es el hábito más importante del vault académico.':
      '观点汇集了从阅读中提取的内容。打开一个观点，查看支撑它的引注或片段。AI帮助阅读，但来源仍是权威：这项核实是学术资料库中最重要的习惯。',
    'Las conexiones aparecen después': '连接稍后才会出现',
    'Grafo muestra cada idea como un nodo y sus relaciones como enlaces. Al principio puede estar vacío o ser pequeño: es normal. Se vuelve útil a medida que analizas fuentes verificadas, no antes.':
      '图谱将每个观点显示为一个节点，将其关系显示为连线。起初可能为空或很小：这很正常。随着你分析经过核实的来源，它才会变得有用，而不是在此之前。',
    'Escribe sin salir del corpus': '无需离开语料库即可写作',
    'Espacio de trabajo reúne notas, borradores y proyectos de escritura. Conserva los enlaces internos a fuentes e ideas para que puedas volver a la evidencia mientras redactas. No hace falta usarlo hasta que tengas algo que desarrollar.':
      '工作区汇集了笔记、草稿和写作项目。它保留指向来源和观点的内部链接，让你在撰写时能回到证据。除非有内容需要展开，否则无需使用它。',
    'Lo demás puede esperar': '其余的一切都可以稍后再说',
    'El menú agrupa funciones por intención: Explorar, Analizar, Escribir y Herramientas. Ábrelas cuando tu investigación las necesite; en Ajustes puedes ocultar o reordenar secciones. Tu primera misión es sencilla: añade una fuente, analízala y verifica una idea.':
      '菜单按用途对功能进行分组：探索、分析、写作和工具。当你的研究需要时再打开它们；在设置中可以隐藏或重新排列各区块。你的第一个任务很简单：添加一个来源，分析它，并核实一个观点。',
  },
  'zh-TW': {
    'Bienvenido a tu vault académico': '歡迎使用你的學術資料庫',
    'Aunque veas muchas opciones, para empezar solo necesitas una ruta: Biblioteca → Ideas → Grafo. En un minuto harás ese recorrido; puedes saltarlo o repetirlo desde Ajustes cuando quieras.':
      '儘管選項很多，但入門只需一條路徑：文獻庫 → 觀點 → 圖譜。這個一分鐘的引導會帶你走完這條路徑；你可以隨時跳過，或從設定中重新播放。',
    'Empieza por una sola ruta': '從一條簡單的路徑開始',
    'Este distintivo indica en qué vault estás. Cada vault separa un proyecto de los demás, para que sus fuentes, análisis y borradores no se mezclen. Úsalo solo cuando quieras cambiar de proyecto o crear otro.':
      '此標識顯示你當前所在的資料庫。每個資料庫都將一個專案與其他專案隔離，使其來源、分析和草稿不會混淆。僅在想切換專案或建立新專案時才使用它。',
    'Biblioteca: dos ámbitos, una decisión': '文獻庫：兩種範圍，一個選擇',
    'Global guarda las fuentes disponibles para todos tus proyectos; «Este vault» muestra solo las que participan aquí. Puedes añadir archivos, DOI, ISBN o referencias manuales, o sincronizar Zotero. No necesitas configurar todas las opciones para comenzar.':
      '「全域性」儲存所有專案可用的來源；「此資料庫」僅顯示在此處使用的來源。你可以新增檔案、DOI、ISBN或手動引用，也可以同步Zotero。開始前無需配置所有選項。',
    'Analiza solo lo que necesites': '只分析你需要的內容',
    'Añade una fuente al vault y cambia a «Este vault». Allí selecciona una o varias obras y pulsa «Analizar». Nodus extraerá temas, ideas, evidencia y relaciones. Empieza con una sola fuente: siempre podrás analizar más después.':
      '向資料庫新增一個來源並切換到「此資料庫」。在其中選擇一篇或多篇文獻，然後點選「分析」。Nodus將提取主題、觀點、證據和關係。先從單個來源開始：之後隨時可以分析更多。',
    'La cola te cuenta qué ocurre': '佇列會告訴你正在發生什麼',
    'La barra inferior muestra el progreso de los análisis. Puedes seguir usando Nodus mientras trabaja. Si falta un modelo o una clave de IA, la tarea se pausa y te indica qué revisar en Ajustes; no tienes que adivinar qué falló.':
      '底部欄顯示分析進度。Nodus工作時你可以繼續使用。如果缺少模型或AI金鑰，任務會暫停並提示你在設定中檢查什麼；無需猜測哪裡出了問題。',
    'Comprueba antes de confiar': '先核實，再採信',
    'Ideas reúne lo extraído de tus lecturas. Abre una idea y revisa la cita o el pasaje que la sostiene. La IA ayuda a leer, pero la fuente sigue siendo la autoridad: esta comprobación es el hábito más importante del vault académico.':
      '觀點彙集了從閱讀中提取的內容。開啟一個觀點，檢視支撐它的引注或片段。AI幫助閱讀，但來源仍是權威：這項核實是學術資料庫中最重要的習慣。',
    'Las conexiones aparecen después': '連線稍後才會出現',
    'Grafo muestra cada idea como un nodo y sus relaciones como enlaces. Al principio puede estar vacío o ser pequeño: es normal. Se vuelve útil a medida que analizas fuentes verificadas, no antes.':
      '圖譜將每個觀點顯示為一個節點，將其關係顯示為連線。起初可能為空或很小：這很正常。隨著你分析經過核實的來源，它才會變得有用，而不是在此之前。',
    'Escribe sin salir del corpus': '無需離開語料庫即可寫作',
    'Espacio de trabajo reúne notas, borradores y proyectos de escritura. Conserva los enlaces internos a fuentes e ideas para que puedas volver a la evidencia mientras redactas. No hace falta usarlo hasta que tengas algo que desarrollar.':
      '工作區彙集了筆記、草稿和寫作專案。它保留指向來源和觀點的內部連結，讓你在撰寫時能回到證據。除非有內容需要展開，否則無需使用它。',
    'Lo demás puede esperar': '其餘的一切都可以稍後再說',
    'El menú agrupa funciones por intención: Explorar, Analizar, Escribir y Herramientas. Ábrelas cuando tu investigación las necesite; en Ajustes puedes ocultar o reordenar secciones. Tu primera misión es sencilla: añade una fuente, analízala y verifica una idea.':
      '選單按用途對功能進行分組：探索、分析、寫作和工具。當你的研究需要時再開啟它們；在設定中可以隱藏或重新排列各區塊。你的第一個任務很簡單：新增一個來源，分析它，並核實一個觀點。',
  },
  ko: {
    "Bienvenido a tu vault académico": "학술 금고에 오신 것을 환영합니다",
    "Aunque veas muchas opciones, para empezar solo necesitas una ruta: Biblioteca → Ideas → Grafo. En un minuto harás ese recorrido; puedes saltarlo o repetirlo desde Ajustes cuando quieras.": "옵션은 많지만 시작하려면 라이브러리 → 아이디어 → 그래프 중 하나의 경로만 있으면 됩니다. 이 1분 투어는 그 경로를 따릅니다. 언제든지 건너뛰거나 설정에서 재생할 수 있습니다.",
    "Empieza por una sola ruta": "하나의 간단한 경로로 시작하세요",
    "Este distintivo indica en qué vault estás. Cada vault separa un proyecto de los demás, para que sus fuentes, análisis y borradores no se mezclen. Úsalo solo cuando quieras cambiar de proyecto o crear otro.": "이 배지는 귀하가 어느 볼트에 있는지 보여줍니다. 각 볼트는 하나의 프로젝트를 별도로 유지하므로 해당 소스, 분석 및 초안이 다른 것과 섞이지 않습니다. 프로젝트를 전환하거나 다른 프로젝트를 생성하려는 경우에만 사용하세요.",
    "Biblioteca: dos ámbitos, una decisión": "라이브러리: 두 개의 범위, 하나의 선택",
    "Global guarda las fuentes disponibles para todos tus proyectos; «Este vault» muestra solo las que participan aquí. Puedes añadir archivos, DOI, ISBN o referencias manuales, o sincronizar Zotero. No necesitas configurar todas las opciones para comenzar.": "모든 프로젝트에 사용할 수 있는 글로벌 스토어 소스 \"이 볼트\"에는 여기서 사용된 것만 표시됩니다. 파일, DOI, ISBN 또는 매뉴얼 참조를 추가하거나 Zotero를 동기화할 수 있습니다. 시작하기 위해 모든 옵션을 구성할 필요는 없습니다.",
    "Analiza solo lo que necesites": "필요한 것만 분석",
    "Añade una fuente al vault y cambia a «Este vault». Allí selecciona una o varias obras y pulsa «Analizar». Nodus extraerá temas, ideas, evidencia y relaciones. Empieza con una sola fuente: siempre podrás analizar más después.": "볼트에 소스를 추가하고 \"이 볼트\"로 전환합니다. 그곳에서 하나 이상의 작품을 선택하고 “분석”을 클릭하세요. Nodus는 테마, 아이디어, 증거 및 관계를 추출합니다. 하나의 소스로 시작하세요. 나중에 언제든지 더 자세히 분석할 수 있습니다.",
    "La cola te cuenta qué ocurre": "대기열은 무슨 일이 일어나고 있는지 알려줍니다.",
    "La barra inferior muestra el progreso de los análisis. Puedes seguir usando Nodus mientras trabaja. Si falta un modelo o una clave de IA, la tarea se pausa y te indica qué revisar en Ajustes; no tienes que adivinar qué falló.": "하단 표시줄에는 분석 진행 상황이 표시됩니다. Nodus가 작동하는 동안 계속 사용할 수 있습니다. AI 모델이나 키가 누락된 경우 작업이 일시 중지되고 설정에서 확인할 사항을 알려주므로 무엇이 실패했는지 추측할 필요가 없습니다.",
    "Comprueba antes de confiar": "신뢰하기 전에 확인하세요",
    "Ideas reúne lo extraído de tus lecturas. Abre una idea y revisa la cita o el pasaje que la sostiene. La IA ayuda a leer, pero la fuente sigue siendo la autoridad: esta comprobación es el hábito más importante del vault académico.": "아이디어는 당신이 읽은 내용에서 추출된 내용을 하나로 모읍니다. 아이디어를 열고 이를 뒷받침하는 인용문이나 구절을 검토하세요. AI는 읽기를 도와주지만 출처는 여전히 권위입니다. 이 확인은 학술 금고에서 가장 중요한 습관입니다.",
    "Las conexiones aparecen después": "연결은 나중에 옵니다",
    "Grafo muestra cada idea como un nodo y sus relaciones como enlaces. Al principio puede estar vacío o ser pequeño: es normal. Se vuelve útil a medida que analizas fuentes verificadas, no antes.": "그래프는 각 아이디어를 노드로 표시하고 해당 관계를 링크로 표시합니다. 처음에는 비어 있거나 작을 수 있습니다. 그것은 정상입니다. 기존이 아닌 검증된 소스를 분석하면 유용해집니다.",
    "Escribe sin salir del corpus": "말뭉치를 떠나지 않고 글쓰기",
    "Espacio de trabajo reúne notas, borradores y proyectos de escritura. Conserva los enlaces internos a fuentes e ideas para que puedas volver a la evidencia mientras redactas. No hace falta usarlo hasta que tengas algo que desarrollar.": "Workspace는 메모, 초안, 작문 프로젝트를 함께 제공합니다. 소스와 아이디어에 대한 내부 링크를 유지하므로 글을 쓰는 동안 증거로 돌아갈 수 있습니다. 개발할 것이 있을 때까지는 필요하지 않습니다.",
    "Lo demás puede esperar": "다른 모든 것은 기다릴 수 있습니다",
    "El menú agrupa funciones por intención: Explorar, Analizar, Escribir y Herramientas. Ábrelas cuando tu investigación las necesite; en Ajustes puedes ocultar o reordenar secciones. Tu primera misión es sencilla: añade una fuente, analízala y verifica una idea.": "메뉴는 탐색, 분석, 쓰기 및 도구 등 목적별로 기능을 그룹화합니다. 연구에 필요할 때 열어보세요. 설정을 사용하면 섹션을 숨기거나 재정렬할 수 있습니다. 첫 번째 임무는 간단합니다. 하나의 소스를 추가하고 분석하고 하나의 아이디어를 검증하는 것입니다.",
  },
  ja: {
    "Bienvenido a tu vault académico": "学術保管庫へようこそ",
    "Aunque veas muchas opciones, para empezar solo necesitas una ruta: Biblioteca → Ideas → Grafo. En un minuto harás ese recorrido; puedes saltarlo o repetirlo desde Ajustes cuando quieras.": "多くのオプションがありますが、開始するために必要なパスは1つだけです: [ライブラリ] → [アイデア] → [グラフ]。この1分間のツアーはその道をたどります。設定からいつでもスキップしたり、再生したりできます。",
    "Empieza por una sola ruta": "1つの単純なパスから始める",
    "Este distintivo indica en qué vault estás. Cada vault separa un proyecto de los demás, para que sus fuentes, análisis y borradores no se mezclen. Úsalo solo cuando quieras cambiar de proyecto o crear otro.": "このバッジは、現在どの Vault に属しているかを示します。各 Vault は1つのプロジェクトを個別に保持するため、そのソース、分析、およびドラフトが他のプロジェクトと混在することはありません。プロジェクトを切り替えたり、別のプロジェクトを作成したりする場合にのみ使用してください。",
    "Biblioteca: dos ámbitos, una decisión": "ライブラリ: 2つのスコープ、1つの選択肢",
    "Global guarda las fuentes disponibles para todos tus proyectos; «Este vault» muestra solo las que participan aquí. Puedes añadir archivos, DOI, ISBN o referencias manuales, o sincronizar Zotero. No necesitas configurar todas las opciones para comenzar.": "グローバルには、すべてのプロジェクトで利用できるソースが保存されます。 「この保管庫」には、ここで使用されている保管庫のみが表示されます。ファイル、DOI、ISBN、マニュアル参照を追加したり、Zotero を同期したりできます。始める前にすべてのオプションを設定する必要はありません。",
    "Analiza solo lo que necesites": "必要なものだけを分析する",
    "Añade una fuente al vault y cambia a «Este vault». Allí selecciona una o varias obras y pulsa «Analizar». Nodus extraerá temas, ideas, evidencia y relaciones. Empieza con una sola fuente: siempre podrás analizar más después.": "ソースをボールトに追加し、「このボールト」に切り替えます。そこで1つ以上の作品を選択し、「分析」をクリックします。 Nodus はテーマ、アイデア、証拠、関係を抽出します。 1つのソースから始めます。後でいつでもさらに分析できます。",
    "La cola te cuenta qué ocurre": "行列を見れば何が起こっているかがわかります",
    "La barra inferior muestra el progreso de los análisis. Puedes seguir usando Nodus mientras trabaja. Si falta un modelo o una clave de IA, la tarea se pausa y te indica qué revisar en Ajustes; no tienes que adivinar qué falló.": "下部のバーは分析の進行状況を示します。 Nodus が動作している間は使い続けることができます。 AI モデルまたはキーが見つからない場合は、タスクが一時停止し、設定で何を確認する必要があるかを通知するため、何が失敗したかを推測する必要はありません。",
    "Comprueba antes de confiar": "信用する前に確認してください",
    "Ideas reúne lo extraído de tus lecturas. Abre una idea y revisa la cita o el pasaje que la sostiene. La IA ayuda a leer, pero la fuente sigue siendo la autoridad: esta comprobación es el hábito más importante del vault académico.": "アイデアは、読書から抽出されたものをまとめます。アイデアを開いて、それを裏付ける引用や文章を確認します。 AI は読書を助けますが、情報源が権威であることに変わりはありません。このチェックは学術保管庫において最も重要な習慣です。",
    "Las conexiones aparecen después": "つながりは後からついてくる",
    "Grafo muestra cada idea como un nodo y sus relaciones como enlaces. Al principio puede estar vacío o ser pequeño: es normal. Se vuelve útil a medida que analizas fuentes verificadas, no antes.": "グラフでは、各アイデアがノードとして、その関係がリンクとして表示されます。最初は空か小さいかもしれません。それが正常です。これは、検証済みのソースを分析するときに役立つようになります。",
    "Escribe sin salir del corpus": "コーパスを離れずに書く",
    "Espacio de trabajo reúne notas, borradores y proyectos de escritura. Conserva los enlaces internos a fuentes e ideas para que puedas volver a la evidencia mientras redactas. No hace falta usarlo hasta que tengas algo que desarrollar.": "Workspace には、メモ、下書き、執筆プロジェクトが1つにまとめられます。ソースやアイデアへの内部リンクが保存されるため、執筆中に証拠に戻ることができます。何かを開発するまでは必要ありません。",
    "Lo demás puede esperar": "それ以外は待つことができる",
    "El menú agrupa funciones por intención: Explorar, Analizar, Escribir y Herramientas. Ábrelas cuando tu investigación las necesite; en Ajustes puedes ocultar o reordenar secciones. Tu primera misión es sencilla: añade una fuente, analízala y verifica una idea.": "メニューは、探索、分析、書き込み、ツールなどの目的別に機能をグループ化します。研究で必要なときに開きます。設定により、セクションを非表示にしたり並べ替えたりできます。最初のミッションはシンプルです。ソースを1つ追加し、分析して、1つのアイデアを検証します。",
  },
};
