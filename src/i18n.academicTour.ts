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
};
