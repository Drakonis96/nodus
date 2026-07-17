// Human-facing "what's new" notes shown once after the app updates to a new
// version. Newest first. Each highlight covers every supported UI language so
// the modal follows the interface. Keep these short and user-facing — they are
// product notes, not a changelog. Add a new entry at the top whenever the app
// version bumps.

import type { VaultType } from './vaultTypes';

// Beyond the vault types, a highlight can belong to a cross-vault surface with an
// identity of its own: the MCP server, the Nodi mascot, the tools hub or a new
// interface language. They get their own icon and colour instead of dissolving
// into 'general'.
export type ReleaseNoteScope = 'general' | VaultType | 'mcp' | 'nodi' | 'toolkit' | 'languages';

export interface ReleaseHighlight {
  es: string;
  en: string;
  fr: string;
  de: string;
  pt: string;
  'pt-BR': string;
  /** Drives the vault/general icon and colour shown beside this highlight. */
  scope: ReleaseNoteScope;
}

export interface ReleaseNote {
  version: string;
  /** ISO date (YYYY-MM-DD) the version shipped. */
  date: string;
  highlights: ReleaseHighlight[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '2.3.8',
    date: '2026-07-16',
    highlights: [
      {
        scope: 'languages',
        es: 'Nodus ya está disponible por completo en francés, alemán, portugués de Portugal y portugués de Brasil. Cada interfaz conserva su vocabulario propio, cubre también taxonomías, parentescos y recuperación, y recurre al inglés de forma segura si falta alguna traducción.',
        en: 'Nodus is now fully available in French, German, European Portuguese and Brazilian Portuguese. Each interface keeps its own vocabulary, also covers taxonomies, kinship and recovery, and safely falls back to English if a translation is ever missing.',
        fr: 'Nodus est désormais entièrement disponible en français, allemand, portugais du Portugal et portugais du Brésil. Chaque interface conserve son propre vocabulaire, couvre également les taxonomies, les liens de parenté et la récupération, et revient à l’anglais en toute sécurité si une traduction manque.',
        de: 'Nodus ist jetzt vollständig auf Französisch, Deutsch, europäischem Portugiesisch und brasilianischem Portugiesisch verfügbar. Jede Oberfläche bewahrt ihren eigenen Wortschatz, deckt auch Taxonomien, Verwandtschaft und Wiederherstellung ab und greift sicher auf Englisch zurück, falls eine Übersetzung fehlt.',
        pt: 'O Nodus está agora totalmente disponível em francês, alemão, português de Portugal e português do Brasil. Cada interface preserva o seu próprio vocabulário, abrange também taxonomias, parentescos e recuperação e recorre em segurança ao inglês caso falte alguma tradução.',
        'pt-BR': 'O Nodus agora está totalmente disponível em francês, alemão, português de Portugal e português do Brasil. Cada interface preserva seu próprio vocabulário, também abrange taxonomias, parentescos e recuperação e recorre com segurança ao inglês caso falte alguma tradução.',
      },
      {
        scope: 'general',
        es: 'El asistente de creación descubre automáticamente los modelos de IA y embeddings disponibles en proveedores locales y en la nube. Combina los resultados en dos buscadores claros, tolera proveedores desconectados y descarga el modelo integrado solo al terminar la configuración.',
        en: 'The vault setup wizard now automatically discovers available AI and embedding models across local and cloud providers. It combines the results into two clear searchable pickers, tolerates offline providers and downloads a built-in model only when setup finishes.',
        fr: 'L’assistant de création découvre automatiquement les modèles d’IA et d’embeddings disponibles auprès des fournisseurs locaux et dans le cloud. Il réunit les résultats dans deux sélecteurs de recherche clairs, tolère les fournisseurs hors ligne et ne télécharge le modèle intégré qu’à la fin de la configuration.',
        de: 'Der Einrichtungsassistent erkennt jetzt automatisch verfügbare KI- und Embedding-Modelle bei lokalen und Cloud-Anbietern. Er führt die Ergebnisse in zwei übersichtlichen, durchsuchbaren Auswahlen zusammen, toleriert nicht erreichbare Anbieter und lädt ein integriertes Modell erst nach Abschluss der Einrichtung herunter.',
        pt: 'O assistente de criação descobre automaticamente os modelos de IA e embeddings disponíveis em fornecedores locais e na nuvem. Combina os resultados em dois seletores pesquisáveis e claros, tolera fornecedores desligados e transfere o modelo integrado apenas ao concluir a configuração.',
        'pt-BR': 'O assistente de criação descobre automaticamente os modelos de IA e embeddings disponíveis em provedores locais e na nuvem. Ele combina os resultados em dois seletores pesquisáveis e claros, tolera provedores desconectados e baixa o modelo integrado somente ao concluir a configuração.',
      },
      {
        scope: 'nodi',
        es: 'Los controles radiales de Nodi mantienen ahora una distribución equilibrada, siguen siendo pulsables en las esquinas superiores y permanecen visibles durante su despedida. El menú contextual conserva la acción de cerrar y las interacciones evitan aperturas o cierres accidentales.',
        en: 'Nodi’s radial controls now stay evenly balanced, remain clickable in the top corners and stay visible during its farewell. The context menu reliably keeps the close action and interactions avoid accidental opening or dismissal.',
        fr: 'Les commandes radiales de Nodi conservent désormais une disposition équilibrée, restent cliquables dans les coins supérieurs et demeurent visibles pendant ses adieux. Le menu contextuel garde fiablement l’action de fermeture et les interactions évitent les ouvertures ou fermetures accidentelles.',
        de: 'Nodis radiale Bedienelemente bleiben jetzt gleichmäßig angeordnet, in den oberen Ecken anklickbar und während seines Abschieds sichtbar. Das Kontextmenü behält zuverlässig die Schließen-Aktion, und die Interaktionen vermeiden versehentliches Öffnen oder Ausblenden.',
        pt: 'Os controlos radiais do Nodi mantêm agora uma distribuição equilibrada, continuam clicáveis nos cantos superiores e permanecem visíveis durante a despedida. O menu de contexto conserva de forma fiável a ação de fechar e as interações evitam aberturas ou fechos acidentais.',
        'pt-BR': 'Os controles radiais do Nodi agora mantêm uma distribuição equilibrada, continuam clicáveis nos cantos superiores e permanecem visíveis durante a despedida. O menu de contexto preserva de forma confiável a ação de fechar e as interações evitam aberturas ou fechamentos acidentais.',
      },
      {
        scope: 'general',
        es: 'El icono de Nodus conserva la misma “N” compacta y estilizada tanto con la aplicación abierta como cerrada. El icono estático y las variantes dinámicas comparten ahora una única geometría, evitando que macOS muestre una marca sobredimensionada al salir.',
        en: 'The Nodus icon now keeps the same compact, stylized “N” whether the application is open or closed. The bundled icon and dynamic variants share one geometry, preventing macOS from showing an oversized mark after quitting.',
        fr: 'L’icône de Nodus conserve désormais le même « N » compact et stylisé, que l’application soit ouverte ou fermée. L’icône intégrée et les variantes dynamiques partagent une géométrie unique, empêchant macOS d’afficher une marque surdimensionnée après la fermeture.',
        de: 'Das Nodus-Symbol behält jetzt dasselbe kompakte, stilisierte „N“, unabhängig davon, ob die Anwendung geöffnet oder geschlossen ist. Das gebündelte Symbol und die dynamischen Varianten verwenden eine gemeinsame Geometrie, sodass macOS nach dem Beenden keine übergroße Marke mehr anzeigt.',
        pt: 'O ícone do Nodus mantém agora o mesmo “N” compacto e estilizado, quer a aplicação esteja aberta ou fechada. O ícone incluído e as variantes dinâmicas partilham uma única geometria, impedindo o macOS de mostrar uma marca sobredimensionada depois de sair.',
        'pt-BR': 'O ícone do Nodus agora mantém o mesmo “N” compacto e estilizado, tanto com o aplicativo aberto quanto fechado. O ícone incluído e as variantes dinâmicas compartilham uma única geometria, impedindo que o macOS mostre uma marca superdimensionada depois de sair.',
      },
    ],
  },
  {
    version: '2.3.7',
    date: '2026-07-16',
    highlights: [
      {
        scope: 'genealogy',
        es: 'El árbol genealógico es más directo y expresivo: puedes desplazarte arrastrando, abrir la ficha lateral con un clic y centrar una persona con doble clic. Las ramas combinan los colores elegidos para ambos progenitores y resaltan en dorado la descendencia de la persona protagonista; también se distinguen las relaciones familiares y sociales iniciales.',
        en: 'The family tree is now more direct and expressive: drag to move around, open the side dossier with one click and centre a person with a double click. Branches blend the colours selected for both parents and highlight the focus person’s descendants in gold; initial family and social relationships are now distinguished too.',
        fr: 'L\'arbre généalogique est plus direct et plus expressif : vous pouvez vous déplacer en faisant glisser, ouvrir la fiche latérale d\'un clic et centrer une personne d\'un double clic. Les branches combinent les couleurs choisies pour les deux parents et mettent en évidence en doré la descendance de la personne protagoniste ; les liens de parenté et les relations sociales initiaux sont également distingués.',
        de: 'Der Stammbaum ist jetzt direkter und ausdrucksstärker: Sie können sich per Ziehen bewegen, das Seitendossier mit einem Klick öffnen und eine Person mit Doppelklick zentrieren. Die Zweige kombinieren die für beide Elternteile gewählten Farben und heben die Nachkommen der Bezugsperson golden hervor; auch die anfänglichen familiären und sozialen Beziehungen werden nun unterschieden.',
        pt: 'A árvore genealógica é agora mais direta e expressiva: pode deslocar-se arrastando, abrir a ficha lateral com um clique e centrar uma pessoa com duplo clique. Os ramos combinam as cores escolhidas para ambos os progenitores e realçam a descendência da pessoa protagonista a dourado; distinguem-se também as relações familiares e sociais iniciais.',
        'pt-BR': 'A árvore genealógica está mais direta e expressiva: você pode se deslocar arrastando, abrir a ficha lateral com um clique e centralizar uma pessoa com um duplo clique. Os ramos combinam as cores escolhidas para os dois genitores e destacam em dourado a descendência da pessoa protagonista; também se distinguem as relações familiares e sociais iniciais.',
      },
      {
        scope: 'genealogy',
        es: 'El timeline y el mapa de Genealogía estrenan filtros múltiples, tarjetas más claras, miniaturas y acceso a la ficha completa al pulsar una persona. Se han eliminado parpadeos y solapamientos, el mapa encuadra los puntos visibles y sus créditos se abren de forma segura en el navegador.',
        en: 'The Genealogy timeline and map now feature multi-select filters, clearer cards, thumbnails and full dossier access when a person is clicked. Flicker and layering issues are gone, the map fits the visible points and credit links open safely in the browser.',
        fr: 'La chronologie et la carte de Généalogie inaugurent des filtres multiples, des cartes plus claires, des miniatures et l\'accès à la fiche complète en cliquant sur une personne. Les scintillements et les chevauchements ont été éliminés, la carte cadre les points visibles et ses crédits s\'ouvrent en toute sécurité dans le navigateur.',
        de: 'Zeitleiste und Karte der Genealogie erhalten Mehrfachfilter, übersichtlichere Karten, Miniaturansichten und Zugriff auf das vollständige Dossier per Klick auf eine Person. Flackern und Überlappungen wurden beseitigt, die Karte rahmt die sichtbaren Punkte ein, und ihre Quellenangaben öffnen sich sicher im Browser.',
        pt: 'A linha do tempo e o mapa de Genealogia estreiam filtros múltiplos, cartões mais claros, miniaturas e acesso à ficha completa ao clicar numa pessoa. Foram eliminados os cintilados e as sobreposições, o mapa enquadra os pontos visíveis e os respetivos créditos abrem-se em segurança no navegador.',
        'pt-BR': 'A linha do tempo e o mapa de Genealogia estreiam filtros múltiplos, cartões mais claros, miniaturas e acesso à ficha completa ao clicar em uma pessoa. Foram eliminadas cintilações e sobreposições, o mapa enquadra os pontos visíveis e seus créditos abrem com segurança no navegador.',
      },
      {
        scope: 'genealogy',
        es: 'El archivo genealógico reúne la creación de entradas en un único modal ordenado, admite cualquier tipo de adjunto e incorpora importación desde Zotero. Las fichas incluyen además un identificador nacional opcional que también participa en las búsquedas.',
        en: 'The genealogy archive now brings entry creation into one well-organised modal, accepts any attachment type and supports Zotero imports. Person dossiers also include an optional national identifier that is searchable throughout the vault.',
        fr: 'L\'archive généalogique réunit la création d\'entrées dans un seul modal ordonné, accepte tout type de pièce jointe et intègre l\'importation depuis Zotero. Les fiches incluent en outre un identifiant national facultatif qui participe également aux recherches.',
        de: 'Das genealogische Archiv fasst die Erstellung von Einträgen in einem einzigen, übersichtlichen Modal zusammen, akzeptiert jeden Anhangstyp und bindet den Import aus Zotero ein. Die Dossiers enthalten zudem eine optionale nationale Kennung, die auch in die Suche einbezogen wird.',
        pt: 'O arquivo genealógico reúne a criação de entradas num único modal organizado, aceita qualquer tipo de anexo e passa a permitir importação a partir do Zotero. As fichas incluem ainda um identificador nacional opcional que também participa nas pesquisas.',
        'pt-BR': 'O arquivo genealógico reúne a criação de entradas em um único modal organizado, aceita qualquer tipo de anexo e incorpora importação a partir do Zotero. As fichas incluem ainda um identificador nacional opcional que também participa das buscas.',
      },
      {
        scope: 'estudio',
        es: 'Los materiales de Estudio se pueden descargar, muestran el nombre de cada acción al pasar el ratón y aparecen correctamente dentro de sus cursos y asignaturas. Nodi, el chat y las herramientas de IA pueden utilizar el contenido ya indexado de imágenes, PDF y otros archivos.',
        en: 'Study materials can now be downloaded, reveal each action name on hover and appear correctly inside their assigned courses and subjects. Nodi, chat and AI tools can use the indexed content of images, PDFs and other files.',
        fr: 'Les matériaux d\'Étude peuvent être téléchargés, affichent le nom de chaque action au survol de la souris et apparaissent correctement dans leurs cours et matières. Nodi, le chat et les outils d\'IA peuvent utiliser le contenu déjà indexé des images, PDF et autres fichiers.',
        de: 'Studienmaterialien lassen sich jetzt herunterladen, zeigen beim Überfahren mit der Maus den Namen jeder Aktion und erscheinen korrekt innerhalb ihrer Kurse und Fächer. Nodi, der Chat und die KI-Werkzeuge können den bereits indexierten Inhalt von Bildern, PDFs und anderen Dateien nutzen.',
        pt: 'Os materiais de Estudo podem ser transferidos, mostram o nome de cada ação ao passar o rato e aparecem corretamente dentro dos respetivos cursos e disciplinas. O Nodi, o chat e as ferramentas de IA podem utilizar o conteúdo já indexado de imagens, PDF e outros ficheiros.',
        'pt-BR': 'Os materiais de Estudo podem ser baixados, exibem o nome de cada ação ao passar o mouse e aparecem corretamente dentro de seus cursos e disciplinas. Nodi, o chat e as ferramentas de IA podem usar o conteúdo já indexado de imagens, PDF e outros arquivos.',
      },
      {
        scope: 'estudio',
        es: 'Estudio incorpora Deep Research adaptado al aprendizaje y reutiliza el mismo motor, diseño y capacidades de grafo e ideas que las bóvedas académicas, manteniendo siempre separado el contenido de cada vault. El horario muestra nombres completos y el selector evita emojis duplicados.',
        en: 'Study now includes learning-focused Deep Research and reuses the same graph and ideas engine, design and capabilities as academic vaults, while keeping every vault’s content isolated. Timetable names remain readable and the picker no longer duplicates emoji.',
        fr: 'Étude intègre Deep Research adapté à l\'apprentissage et réutilise le même moteur, la même conception et les mêmes capacités de graphe et d\'idées que les espaces académiques, tout en gardant toujours séparé le contenu de chaque espace. L\'emploi du temps affiche les noms complets et le sélecteur évite les emojis en double.',
        de: 'Studium integriert ein lernorientiertes Deep Research und nutzt dieselbe Engine, dasselbe Design und dieselben Graph- und Ideenfunktionen wie akademische Arbeitsbereiche, wobei der Inhalt jedes Arbeitsbereichs stets getrennt bleibt. Der Stundenplan zeigt vollständige Namen an, und die Auswahl vermeidet doppelte Emojis.',
        pt: 'O Estudo incorpora o Deep Research adaptado à aprendizagem e reutiliza o mesmo motor, design e capacidades de grafo e ideias que os espaços académicos, mantendo sempre separado o conteúdo de cada espaço. O horário mostra nomes completos e o seletor evita emojis duplicados.',
        'pt-BR': 'Estudo incorpora o Deep Research adaptado ao aprendizado e reutiliza o mesmo motor, design e capacidades de grafo e ideias dos espaços acadêmicos, mantendo sempre separado o conteúdo de cada espaço. O horário exibe nomes completos e o seletor evita emojis duplicados.',
      },
      {
        scope: 'general',
        es: 'Los asistentes de creación de vaults Académico, Genealogía, Estudio y Bases de datos permiten elegir por separado el modelo de IA y el modelo de embeddings, tanto local como en la nube, y descargan el modelo local cuando es necesario.',
        en: 'The Academic, Genealogy, Study and Databases vault creation wizards now let you choose separate AI and embedding models, either local or cloud-based, and download a local model when needed.',
        fr: 'Les assistants de création des espaces Académique, Généalogie, Étude et Bases de données permettent de choisir séparément le modèle d\'IA et le modèle d\'embeddings, local ou dans le cloud, et téléchargent le modèle local si nécessaire.',
        de: 'Die Einrichtungsassistenten für die Arbeitsbereiche Akademisch, Genealogie, Studium und Datenbanken erlauben es nun, das KI-Modell und das Embedding-Modell getrennt auszuwählen, sowohl lokal als auch in der Cloud, und laden das lokale Modell bei Bedarf herunter.',
        pt: 'Os assistentes de criação de espaços Académico, Genealogia, Estudo e Bases de dados permitem escolher separadamente o modelo de IA e o modelo de embeddings, tanto local como na nuvem, e transferem o modelo local quando necessário.',
        'pt-BR': 'Os assistentes de criação de espaços Acadêmico, Genealogia, Estudo e Bases de dados permitem escolher separadamente o modelo de IA e o modelo de embeddings, tanto local quanto na nuvem, e baixam o modelo local quando necessário.',
      },
      {
        scope: 'nodi',
        es: 'Nodi contrae y hace girar sus extremidades mientras piensa, cierra los ojos y recupera su postura con una animación fluida. También se puede arrastrar por toda la pantalla y cerrar desde su menú contextual con una despedida animada que respeta sus cosméticos.',
        en: 'Nodi contracts and spins its limbs while thinking, closes its eyes and smoothly returns to its normal pose. It can also be dragged across the full screen and dismissed from its context menu with an animated farewell that accounts for its cosmetics.',
        fr: 'Nodi contracte et fait tourner ses membres pendant qu\'il réfléchit, ferme les yeux et retrouve sa posture grâce à une animation fluide. Il peut également être déplacé sur tout l\'écran et fermé depuis son menu contextuel avec un adieu animé qui respecte ses cosmétiques.',
        de: 'Nodi zieht seine Gliedmaßen zusammen und lässt sie rotieren, während es nachdenkt, schließt die Augen und kehrt mit einer flüssigen Animation in seine Haltung zurück. Es lässt sich außerdem über den gesamten Bildschirm ziehen und über sein Kontextmenü mit einem animierten Abschied schließen, der seine Kosmetik berücksichtigt.',
        pt: 'O Nodi contrai e faz girar os membros enquanto pensa, fecha os olhos e recupera a postura com uma animação fluida. Também pode ser arrastado por todo o ecrã e fechado a partir do seu menu de contexto com uma despedida animada que respeita os seus cosméticos.',
        'pt-BR': 'Nodi contrai e gira suas extremidades enquanto pensa, fecha os olhos e retoma sua postura com uma animação fluida. Também pode ser arrastado por toda a tela e fechado a partir do seu menu de contexto com uma despedida animada que respeita seus cosméticos.',
      },
      {
        scope: 'general',
        es: 'La interfaz conserva ahora el color de la bóveda activa al redimensionar el sidebar, iguala el tamaño de las tarjetas de creación y corrige superficies claras, botones, buscadores y desplegables. Los iconos de Novedades indican además su grupo al pasar el ratón.',
        en: 'The interface now keeps the active vault colour while resizing the sidebar, gives creation cards a consistent size and fixes light surfaces, buttons, search fields and dropdowns. What’s New icons also identify their group on hover.',
        fr: 'L\'interface conserve désormais la couleur de l\'espace actif lors du redimensionnement de la barre latérale, uniformise la taille des cartes de création et corrige les surfaces claires, les boutons, les champs de recherche et les menus déroulants. Les icônes de Nouveautés indiquent en outre leur groupe au survol de la souris.',
        de: 'Die Oberfläche behält nun beim Ändern der Sidebar-Größe die Farbe des aktiven Arbeitsbereichs bei, vereinheitlicht die Größe der Erstellungskarten und korrigiert helle Flächen, Schaltflächen, Suchfelder und Dropdown-Menüs. Die Symbole der Neuigkeiten zeigen beim Überfahren mit der Maus zudem ihre Gruppe an.',
        pt: 'A interface passa a conservar a cor do espaço ativo ao redimensionar a barra lateral, iguala o tamanho dos cartões de criação e corrige superfícies claras, botões, campos de pesquisa e menus suspensos. Os ícones de Novidades indicam ainda o respetivo grupo ao passar o rato.',
        'pt-BR': 'A interface agora mantém a cor do espaço ativo ao redimensionar a barra lateral, iguala o tamanho dos cartões de criação e corrige superfícies claras, botões, buscadores e menus suspensos. Os ícones de Novidades indicam ainda seu grupo ao passar o mouse.',
      },
      {
        scope: 'general',
        es: 'Al iniciar Nodus aparece una comprobación cinematográfica de actualizaciones que informa si ya tienes la última versión, si existe una nueva o si se produce un error. Muestra el progreso de descarga y permite instalar y reiniciar sin solaparse con el modal de novedades.',
        en: 'Nodus now performs a cinematic update check at startup, reporting whether you are up to date, a new version is available or an error occurred. It shows download progress and supports install-and-restart without overlapping the What’s New modal.',
        fr: 'Au démarrage de Nodus apparaît une vérification cinématographique des mises à jour qui indique si vous disposez déjà de la dernière version, si une nouvelle version existe ou si une erreur se produit. Elle affiche la progression du téléchargement et permet d\'installer et de redémarrer sans se superposer au modal des nouveautés.',
        de: 'Beim Start von Nodus erscheint eine filmreife Update-Prüfung, die anzeigt, ob Sie bereits die neueste Version verwenden, eine neue Version verfügbar ist oder ein Fehler aufgetreten ist. Sie zeigt den Download-Fortschritt und ermöglicht Installation und Neustart, ohne sich mit dem Neuigkeiten-Fenster zu überschneiden.',
        pt: 'Ao iniciar o Nodus surge uma verificação cinematográfica de atualizações que informa se já tem a versão mais recente, se existe uma nova ou se ocorre um erro. Mostra o progresso da transferência e permite instalar e reiniciar sem se sobrepor ao modal de novidades.',
        'pt-BR': 'Ao iniciar o Nodus aparece uma verificação cinematográfica de atualizações que informa se você já tem a última versão, se existe uma nova ou se ocorre um erro. Mostra o progresso do download e permite instalar e reiniciar sem se sobrepor ao modal de novidades.',
      },
    ],
  },
  {
    version: '2.3.6',
    date: '2026-07-16',
    highlights: [
      {
        scope: 'genealogy',
        es: 'El parentesco se recalcula de forma completa al cambiar la persona protagonista: cónyuges, padres, hijos, hermanos, familia política, familias reconstituidas, primos de cualquier grado y relaciones entre generaciones reciben su etiqueta precisa, incluso en árboles extensos. Nodi y el asistente conocen también estos parentescos calculados.',
        en: 'Kinship is now fully recalculated whenever the focus person changes: spouses, parents, children, siblings, in-laws, blended families, cousins of any degree and cross-generation relationships receive their precise label, even in extended trees. Nodi and the assistant also understand these calculated relationships.',
        fr: 'Le lien de parenté est désormais entièrement recalculé lorsque la personne protagoniste change : conjoints, parents, enfants, frères et sœurs, belle-famille, familles recomposées, cousins de tout degré et relations entre générations reçoivent leur étiquette précise, même dans les arbres étendus. Nodi et l\'assistant connaissent également ces liens de parenté calculés.',
        de: 'Die Verwandtschaft wird beim Wechsel der Bezugsperson jetzt vollständig neu berechnet: Ehepartner, Eltern, Kinder, Geschwister, Schwägerschaft, Patchwork-Familien, Cousins/Cousinen jeden Grades und generationsübergreifende Beziehungen erhalten ihre präzise Bezeichnung, selbst in umfangreichen Stammbäumen. Auch Nodi und der Assistent kennen diese berechneten Verwandtschaftsverhältnisse.',
        pt: 'O parentesco passa a ser recalculado por completo ao mudar a pessoa protagonista: cônjuges, pais, filhos, irmãos, família política, famílias reconstituídas, primos de qualquer grau e relações entre gerações recebem a sua etiqueta precisa, mesmo em árvores extensas. O Nodi e o assistente também conhecem estes parentescos calculados.',
        'pt-BR': 'O parentesco é recalculado por completo ao mudar a pessoa protagonista: cônjuges, pais, filhos, irmãos, família por afinidade, famílias reconstituídas, primos de qualquer grau e relações entre gerações recebem sua etiqueta precisa, mesmo em árvores extensas. Nodi e o assistente também conhecem esses parentescos calculados.',
      },
      {
        scope: 'genealogy',
        es: 'La ficha de persona presenta Name variants, Kinship, Life events, Places, Documents, Evidence y Notes en bloques coherentes con Biography y Relations. Las variantes, los eventos y los lugares se añaden mediante modales limpios, con botones de tamaño uniforme.',
        en: 'The person dossier now presents Name variants, Kinship, Life events, Places, Documents, Evidence and Notes in sections consistent with Biography and Relations. Variants, events and places are added through clean modals with uniformly sized buttons.',
        fr: 'La fiche de personne présente Name variants, Kinship, Life events, Places, Documents, Evidence et Notes dans des blocs cohérents avec Biography et Relations. Les variantes, les événements et les lieux s\'ajoutent via des modales épurées, avec des boutons de taille uniforme.',
        de: 'Das Personendossier zeigt Name variants, Kinship, Life events, Places, Documents, Evidence und Notes in Abschnitten, die mit Biography und Relations übereinstimmen. Varianten, Ereignisse und Orte werden über übersichtliche Modale hinzugefügt, mit einheitlich großen Schaltflächen.',
        pt: 'A ficha de pessoa apresenta Name variants, Kinship, Life events, Places, Documents, Evidence e Notes em blocos coerentes com Biography e Relations. As variantes, os eventos e os lugares adicionam-se através de modais limpos, com botões de tamanho uniforme.',
        'pt-BR': 'A ficha de pessoa apresenta Name variants, Kinship, Life events, Places, Documents, Evidence e Notes em blocos coerentes com Biography e Relations. As variantes, os eventos e os lugares são adicionados por meio de modais limpos, com botões de tamanho uniforme.',
      },
      {
        scope: 'general',
        es: 'El icono renovado de Nodus se conserva también durante el arranque en frío de la aplicación, antes de que se cargue la bóveda activa.',
        en: 'The refreshed Nodus icon is now preserved during a cold application launch too, before the active vault has loaded.',
        fr: 'L\'icône renouvelée de Nodus est désormais également conservée pendant le démarrage à froid de l\'application, avant le chargement de l\'espace actif.',
        de: 'Das erneuerte Nodus-Symbol bleibt nun auch beim Kaltstart der Anwendung erhalten, bevor der aktive Arbeitsbereich geladen wird.',
        pt: 'O ícone renovado do Nodus passa a manter-se também durante o arranque a frio da aplicação, antes de o espaço ativo ser carregado.',
        'pt-BR': 'O ícone renovado do Nodus é mantido também durante a inicialização a frio do aplicativo, antes de o espaço ativo ser carregado.',
      },
      {
        scope: 'general',
        es: 'El modal de novedades muestra ahora el historial completo de la versión principal instalada —por ejemplo, todas las versiones 2.x— en español o inglés. Cada cambio histórico incluye además el icono y el color de su bóveda, o el indicador general cuando afecta a toda la aplicación.',
        en: 'The What’s New modal now shows the complete history of the installed major version—for example, every 2.x release—in English or Spanish. Every historical change also includes its vault icon and colour, or the general indicator when it affects the whole application.',
        fr: 'Le modal des nouveautés affiche désormais l\'historique complet de la version principale installée — par exemple, toutes les versions 2.x — en espagnol ou en anglais. Chaque changement historique inclut en outre l\'icône et la couleur de son espace, ou l\'indicateur général lorsqu\'il concerne l\'ensemble de l\'application.',
        de: 'Das Neuigkeiten-Fenster zeigt jetzt den vollständigen Verlauf der installierten Hauptversion – zum Beispiel alle 2.x-Versionen – auf Spanisch oder Englisch an. Jede historische Änderung enthält außerdem das Symbol und die Farbe ihres Arbeitsbereichs oder die allgemeine Kennzeichnung, wenn sie die gesamte Anwendung betrifft.',
        pt: 'O modal de novidades mostra agora o histórico completo da versão principal instalada — por exemplo, todas as versões 2.x — em espanhol ou inglês. Cada alteração histórica inclui ainda o ícone e a cor do respetivo espaço, ou o indicador geral quando afeta toda a aplicação.',
        'pt-BR': 'O modal de novidades agora mostra o histórico completo da versão principal instalada — por exemplo, todas as versões 2.x — em espanhol ou inglês. Cada mudança histórica inclui ainda o ícone e a cor do seu espaço, ou o indicador geral quando afeta todo o aplicativo.',
      },
    ],
  },
  {
    version: '2.3.5',
    date: '2026-07-16',
    highlights: [
      {
        scope: 'genealogy',
        es: 'Las ramas extensas ya no se mezclan: tíos, tías y sus parejas permanecen dentro del bloque paterno o materno que les corresponde, con la pareja de progenitores como frontera central y todas las generaciones centradas de forma coherente.',
        en: 'Extended branches no longer mix: uncles, aunts and their partners remain inside their corresponding paternal or maternal block, with the parental couple as the centre seam and every generation aligned consistently.',
        fr: 'Les branches étendues ne se mélangent plus : oncles, tantes et leurs partenaires restent à l\'intérieur du bloc paternel ou maternel qui leur correspond, le couple de parents faisant office de frontière centrale et toutes les générations étant centrées de façon cohérente.',
        de: 'Umfangreiche Zweige vermischen sich nicht mehr: Onkel, Tanten und ihre Partner bleiben innerhalb des jeweils zugehörigen väterlichen oder mütterlichen Blocks, wobei das Elternpaar als zentrale Grenze dient und alle Generationen einheitlich zentriert sind.',
        pt: 'Os ramos extensos deixam de se misturar: tios, tias e os seus cônjuges permanecem dentro do bloco paterno ou materno correspondente, com o casal de progenitores como fronteira central e todas as gerações centradas de forma coerente.',
        'pt-BR': 'Os ramos extensos não se misturam mais: tios, tias e seus parceiros permanecem dentro do bloco paterno ou materno correspondente, com o casal de genitores como fronteira central e todas as gerações centralizadas de forma coerente.',
      },
      {
        scope: 'genealogy',
        es: 'Las líneas horizontales del árbol se trazan únicamente por el espacio libre entre generaciones. Los nombres, las etiquetas de parentesco y las fechas cuentan además con un fondo protector para conservar siempre su legibilidad en modo claro y oscuro.',
        en: 'Horizontal tree lines are now routed exclusively through the free space between generations. Names, kinship labels and dates also have a protective background so they remain readable in both light and dark mode.',
        fr: 'Les lignes horizontales de l\'arbre ne passent désormais que par l\'espace libre entre les générations. Les noms, les étiquettes de lien de parenté et les dates disposent en outre d\'un fond protecteur pour toujours conserver leur lisibilité en mode clair et sombre.',
        de: 'Die horizontalen Linien des Stammbaums verlaufen jetzt ausschließlich durch den freien Raum zwischen den Generationen. Namen, Verwandtschaftsbezeichnungen und Daten verfügen zudem über einen schützenden Hintergrund, damit sie im hellen und dunklen Modus stets lesbar bleiben.',
        pt: 'As linhas horizontais da árvore passam a ser traçadas apenas pelo espaço livre entre gerações. Os nomes, as etiquetas de parentesco e as datas contam ainda com um fundo protetor para conservar sempre a sua legibilidade em modo claro e escuro.',
        'pt-BR': 'As linhas horizontais da árvore são traçadas somente pelo espaço livre entre gerações. Os nomes, as etiquetas de parentesco e as datas contam ainda com um fundo protetor para preservar sempre sua legibilidade no modo claro e escuro.',
      },
      {
        scope: 'genealogy',
        es: 'El árbol incorpora un buscador que localiza personas por nombre, fechas o etiqueta de parentesco, incluso sin escribir los acentos. Las coincidencias quedan iluminadas y el resto del árbol permanece visible de forma atenuada para conservar el contexto familiar.',
        en: 'The tree now includes search across names, dates and kinship labels, with accent-insensitive matching. Matches are highlighted while the rest of the tree stays visible in a dimmed state to preserve family context.',
        fr: 'L\'arbre intègre un moteur de recherche qui localise les personnes par nom, dates ou étiquette de lien de parenté, même sans saisir les accents. Les correspondances sont mises en surbrillance et le reste de l\'arbre reste visible de façon atténuée pour conserver le contexte familial.',
        de: 'Der Stammbaum verfügt jetzt über eine Suche, die Personen anhand von Name, Datum oder Verwandtschaftsbezeichnung findet, auch ohne Akzentzeichen einzugeben. Treffer werden hervorgehoben, während der Rest des Stammbaums abgeblendet sichtbar bleibt, um den familiären Kontext zu bewahren.',
        pt: 'A árvore incorpora um motor de pesquisa que localiza pessoas por nome, datas ou etiqueta de parentesco, mesmo sem escrever os acentos. As correspondências ficam realçadas e o resto da árvore permanece visível de forma esbatida para conservar o contexto familiar.',
        'pt-BR': 'A árvore incorpora um buscador que localiza pessoas por nome, datas ou etiqueta de parentesco, mesmo sem digitar os acentos. As correspondências ficam destacadas e o restante da árvore permanece visível de forma atenuada para preservar o contexto familiar.',
      },
    ],
  },
  {
    version: '2.3.4',
    date: '2026-07-16',
    highlights: [
      {
        scope: 'genealogy',
        es: 'El árbol separa correctamente las unidades familiares para que las líneas de los abuelos paternos y maternos no vuelvan a unirse por error. Las ramas paterna y materna usan azul y rojo por defecto, permiten elegir sus dos colores principales y distinguen las subramas mediante variaciones de intensidad.',
        en: 'The tree now keeps family units separate, preventing paternal and maternal grandparent lines from being joined incorrectly. Paternal and maternal branches use blue and red by default, let you choose their two main colours, and distinguish sub-branches through tonal variations.',
        fr: 'L\'arbre sépare désormais correctement les unités familiales afin que les lignes des grands-parents paternels et maternels ne se rejoignent plus par erreur. Les branches paternelle et maternelle utilisent le bleu et le rouge par défaut, permettent de choisir leurs deux couleurs principales et distinguent les sous-branches par des variations d\'intensité.',
        de: 'Der Stammbaum trennt Familieneinheiten jetzt korrekt, sodass sich die Linien der väterlichen und mütterlichen Großeltern nicht mehr versehentlich verbinden. Die väterliche und die mütterliche Linie verwenden standardmäßig Blau und Rot, lassen sich in ihren beiden Hauptfarben frei wählen und unterscheiden Unterzweige durch Intensitätsabstufungen.',
        pt: 'A árvore separa corretamente as unidades familiares para que as linhas dos avós paternos e maternos não voltem a unir-se por erro. Os ramos paterno e materno usam azul e vermelho por predefinição, permitem escolher as suas duas cores principais e distinguem os sub-ramos através de variações de intensidade.',
        'pt-BR': 'A árvore separa corretamente as unidades familiares para que as linhas dos avós paternos e maternos não voltem a se unir por engano. Os ramos paterno e materno usam azul e vermelho por padrão, permitem escolher suas duas cores principais e distinguem os sub-ramos por meio de variações de intensidade.',
      },
      {
        scope: 'genealogy',
        es: 'Cada persona muestra ahora una etiqueta de parentesco relativa a la persona protagonista del árbol: padres, hermanos, tíos, primos, sobrinos, abuelos, bisabuelos, tatarabuelos y sus equivalentes descendentes, entre otros. Las etiquetas se recalculan al cambiar el centro y también forman parte del contexto de Nodi y del asistente.',
        en: 'Every person now shows a kinship label relative to the tree’s focus person, including parents, siblings, uncles and aunts, cousins, nephews and nieces, grandparents, great-grandparents, great-great-grandparents and their descendant equivalents. Labels are recalculated when the focus changes and are also included in Nodi and assistant context.',
        fr: 'Chaque personne affiche désormais une étiquette de lien de parenté relative à la personne protagoniste de l\'arbre : parents, frères et sœurs, oncles et tantes, cousins, neveux et nièces, grands-parents, arrière-grands-parents, arrière-arrière-grands-parents et leurs équivalents descendants, entre autres. Les étiquettes sont recalculées lorsque le centre change et font également partie du contexte de Nodi et de l\'assistant.',
        de: 'Jede Person zeigt jetzt eine Verwandtschaftsbezeichnung relativ zur Bezugsperson des Stammbaums an: Eltern, Geschwister, Onkel und Tanten, Cousins und Cousinen, Neffen und Nichten, Großeltern, Urgroßeltern, Ururgroßeltern und ihre absteigenden Entsprechungen, unter anderem. Die Bezeichnungen werden beim Wechsel des Zentrums neu berechnet und sind auch Teil des Kontexts von Nodi und dem Assistenten.',
        pt: 'Cada pessoa mostra agora uma etiqueta de parentesco relativa à pessoa protagonista da árvore: pais, irmãos, tios, primos, sobrinhos, avós, bisavós, trisavós e os respetivos equivalentes descendentes, entre outros. As etiquetas são recalculadas ao mudar o centro e também fazem parte do contexto do Nodi e do assistente.',
        'pt-BR': 'Cada pessoa agora mostra uma etiqueta de parentesco relativa à pessoa protagonista da árvore: pais, irmãos, tios, primos, sobrinhos, avós, bisavós, trisavós e seus equivalentes descendentes, entre outros. As etiquetas são recalculadas ao mudar o centro e também fazem parte do contexto de Nodi e do assistente.',
      },
      {
        scope: 'genealogy',
        es: 'Las relaciones familiares y sociales comparten una interfaz más limpia: cada bloque conserva su listado y ofrece un único botón para abrir un modal de alta o edición. Los selectores tienen buscador, admiten varias personas y las relaciones sociales permiten elegir uno o varios tipos preconfigurados en una sola operación.',
        en: 'Family and social relations now share a cleaner interface: each section keeps its persistent list and provides one button that opens an add or edit modal. Selectors include search, support multiple people, and social relations let you choose one or more predefined types in a single operation.',
        fr: 'Les relations familiales et sociales partagent une interface plus épurée : chaque bloc conserve sa liste et propose un bouton unique pour ouvrir un modal d\'ajout ou de modification. Les sélecteurs disposent d\'une recherche, prennent en charge plusieurs personnes, et les relations sociales permettent de choisir un ou plusieurs types préconfigurés en une seule opération.',
        de: 'Familiäre und soziale Beziehungen teilen sich jetzt eine übersichtlichere Oberfläche: Jeder Block behält seine Liste bei und bietet eine einzige Schaltfläche zum Öffnen eines Modals zum Hinzufügen oder Bearbeiten. Die Auswahlfelder verfügen über eine Suche, unterstützen mehrere Personen, und bei sozialen Beziehungen lassen sich einer oder mehrere vorkonfigurierte Typen in einem einzigen Vorgang auswählen.',
        pt: 'As relações familiares e sociais partilham uma interface mais limpa: cada bloco conserva a sua listagem e oferece um único botão para abrir um modal de criação ou edição. Os seletores têm pesquisa, admitem várias pessoas e as relações sociais permitem escolher um ou vários tipos pré-configurados numa única operação.',
        'pt-BR': 'As relações familiares e sociais compartilham uma interface mais limpa: cada bloco mantém sua listagem e oferece um único botão para abrir um modal de inclusão ou edição. Os seletores têm buscador, admitem várias pessoas e as relações sociais permitem escolher um ou vários tipos pré-configurados em uma única operação.',
      },
      {
        scope: 'general',
        es: 'Se han pulido varios detalles de interfaz: la marca de Nodus conserva su margen al ocultar el sidebar, la primera persona del listado ya no queda tapada, los desplegables se muestran por encima de los modales sin solapar la lupa con el texto y el banner de apoyo evita duplicar el botón de PayPal.',
        en: 'Several interface details have been polished: the Nodus brand keeps its margin when the sidebar is hidden, the first person in the list is no longer clipped, dropdowns appear above modals without overlapping the search icon and text, and the support banner no longer duplicates the PayPal button.',
        fr: 'Plusieurs détails d\'interface ont été peaufinés : la marque Nodus conserve sa marge lorsque la barre latérale est masquée, la première personne de la liste n\'est plus masquée, les menus déroulants s\'affichent au-dessus des modales sans superposer la loupe au texte, et la bannière de soutien évite de dupliquer le bouton PayPal.',
        de: 'Mehrere Oberflächendetails wurden verfeinert: Das Nodus-Logo behält seinen Rand, wenn die Sidebar ausgeblendet wird, die erste Person der Liste wird nicht mehr verdeckt, Dropdown-Menüs erscheinen über den Modalen, ohne die Lupe mit dem Text zu überlappen, und das Unterstützungsbanner zeigt den PayPal-Button nicht mehr doppelt an.',
        pt: 'Foram aperfeiçoados vários pormenores de interface: a marca do Nodus conserva a sua margem ao ocultar a barra lateral, a primeira pessoa da lista deixa de ficar tapada, os menus suspensos mostram-se acima dos modais sem sobrepor a lupa ao texto e o banner de apoio evita duplicar o botão do PayPal.',
        'pt-BR': 'Vários detalhes de interface foram aprimorados: a marca do Nodus mantém sua margem ao ocultar a barra lateral, a primeira pessoa da listagem não fica mais encoberta, os menus suspensos aparecem acima dos modais sem sobrepor a lupa ao texto e o banner de apoio evita duplicar o botão do PayPal.',
      },
    ],
  },
  {
    version: '2.3.3',
    date: '2026-07-15',
    highlights: [
      {
        scope: 'genealogy',
        es: 'Las relaciones familiares se pueden crear desde la ficha de una persona o desde el propio árbol mediante un selector claro: progenitor, hijo o hija, hermano o hermana y pareja. Al añadir descendencia puedes indicar los dos progenitores conocidos o solamente uno.',
        en: 'Family relationships can now be created from a person dossier or directly from the tree with a clear selector: parent, child, sibling or partner. When adding a child, you can specify both known parents or just one.',
        fr: 'Les relations familiales peuvent désormais être créées depuis la fiche d\'une personne ou directement depuis l\'arbre grâce à un sélecteur clair : parent, fils ou fille, frère ou sœur et partenaire. Lors de l\'ajout d\'une descendance, vous pouvez indiquer les deux parents connus ou un seul.',
        de: 'Familiäre Beziehungen lassen sich jetzt aus dem Personendossier oder direkt aus dem Stammbaum über eine klare Auswahl erstellen: Elternteil, Sohn oder Tochter, Bruder oder Schwester und Partner. Beim Hinzufügen von Nachkommen können Sie beide bekannten Elternteile oder nur einen angeben.',
        pt: 'As relações familiares podem ser criadas a partir da ficha de uma pessoa ou da própria árvore através de um seletor claro: progenitor, filho ou filha, irmão ou irmã e parceiro/a. Ao adicionar descendência, pode indicar os dois progenitores conhecidos ou apenas um.',
        'pt-BR': 'As relações familiares podem ser criadas a partir da ficha de uma pessoa ou da própria árvore por meio de um seletor claro: genitor, filho ou filha, irmão ou irmã e parceiro(a). Ao adicionar descendência, você pode indicar os dois genitores conhecidos ou apenas um.',
      },
      {
        scope: 'genealogy',
        es: 'El panel derecho del árbol conserva todas las relaciones de la persona seleccionada para poder editarlas, invertirlas o eliminarlas. También avisa de fechas cronológicamente improbables sin bloquear los casos históricos que necesites documentar.',
        en: 'The tree sidebar now keeps every relationship for the selected person visible, so you can edit, reverse or delete it. It also warns about chronologically unlikely dates without blocking historical cases you need to document.',
        fr: 'Le panneau droit de l\'arbre conserve désormais toutes les relations de la personne sélectionnée afin de pouvoir les modifier, les inverser ou les supprimer. Il signale également les dates chronologiquement improbables sans bloquer les cas historiques que vous devez documenter.',
        de: 'Das rechte Panel des Stammbaums zeigt jetzt alle Beziehungen der ausgewählten Person an, damit Sie sie bearbeiten, umkehren oder löschen können. Es warnt außerdem vor chronologisch unwahrscheinlichen Daten, ohne historische Fälle zu blockieren, die Sie dokumentieren müssen.',
        pt: 'O painel direito da árvore conserva todas as relações da pessoa selecionada para as poder editar, inverter ou eliminar. Também avisa sobre datas cronologicamente improváveis sem bloquear os casos históricos que precise de documentar.',
        'pt-BR': 'O painel direito da árvore mantém todas as relações da pessoa selecionada para que você possa editá-las, invertê-las ou excluí-las. Também avisa sobre datas cronologicamente improváveis sem bloquear os casos históricos que você precisa documentar.',
      },
      {
        scope: 'genealogy',
        es: 'El árbol coloca por defecto a los antepasados arriba y permite invertir la orientación. Se han corregido la disposición y las líneas de progenitores, hijos, hermanos y parejas, manteniendo compatibles las relaciones que ya existían.',
        en: 'The tree now places ancestors at the top by default and can optionally reverse its orientation. Parent, child, sibling and partner layout and connectors have been corrected while keeping existing relationships compatible.',
        fr: 'L\'arbre place désormais les ancêtres en haut par défaut et permet d\'inverser l\'orientation. La disposition et les lignes des parents, enfants, frères et sœurs et partenaires ont été corrigées, tout en conservant la compatibilité avec les relations déjà existantes.',
        de: 'Der Stammbaum platziert Vorfahren standardmäßig oben und ermöglicht es, die Ausrichtung umzukehren. Anordnung und Verbindungslinien von Eltern, Kindern, Geschwistern und Partnern wurden korrigiert, wobei bereits bestehende Beziehungen kompatibel bleiben.',
        pt: 'A árvore coloca por predefinição os antepassados no topo e permite inverter a orientação. Foram corrigidas a disposição e as linhas de progenitores, filhos, irmãos e parceiros, mantendo compatíveis as relações já existentes.',
        'pt-BR': 'A árvore coloca por padrão os ancestrais na parte superior e permite inverter a orientação. Foram corrigidas a disposição e as linhas de genitores, filhos, irmãos e parceiros, mantendo compatíveis as relações já existentes.',
      },
      {
        scope: 'general',
        es: 'El modal de novedades identifica visualmente cada cambio: los cambios generales usan un icono neutro y los específicos de una bóveda muestran su color e icono correspondientes, tanto en modo claro como oscuro.',
        en: 'The What’s New modal now identifies every change visually: general changes use a neutral icon, while vault-specific changes show the corresponding colour and icon in both light and dark mode.',
        fr: 'Le modal des nouveautés identifie désormais visuellement chaque changement : les changements généraux utilisent une icône neutre et ceux spécifiques à un espace affichent leur couleur et leur icône correspondantes, en mode clair comme en mode sombre.',
        de: 'Das Neuigkeiten-Fenster kennzeichnet jetzt jede Änderung visuell: Allgemeine Änderungen verwenden ein neutrales Symbol, während arbeitsbereichsspezifische Änderungen die entsprechende Farbe und das entsprechende Symbol zeigen, sowohl im hellen als auch im dunklen Modus.',
        pt: 'O modal de novidades identifica visualmente cada alteração: as alterações gerais usam um ícone neutro e as específicas de um espaço mostram a sua cor e ícone correspondentes, tanto em modo claro como escuro.',
        'pt-BR': 'O modal de novidades identifica visualmente cada mudança: as mudanças gerais usam um ícone neutro e as específicas de um espaço mostram sua cor e ícone correspondentes, tanto no modo claro quanto no escuro.',
      },
    ],
  },
  {
    version: '2.3.2',
    date: '2026-07-15',
    highlights: [
      {
        scope: 'general',
        es: 'Se ha solucionado un error que impedía a Nodus leer algunas claves de API de IA ya guardadas y hacía que no aparecieran en Ajustes. Las claves no se habían borrado: Nodus las recupera de forma segura y vuelve a incluirlas en la copia protegida del workspace.',
        en: 'Fixed an issue that prevented Nodus from reading some previously saved AI API keys, making them disappear from Settings. The keys had not been deleted: Nodus recovers them safely and includes them again in the protected workspace backup.',
        fr: 'Un problème empêchant Nodus de lire certaines clés d\'API d\'IA déjà enregistrées, les faisant disparaître des Paramètres, a été corrigé. Les clés n\'avaient pas été supprimées : Nodus les récupère en toute sécurité et les réintègre dans la copie protégée de l\'espace de travail.',
        de: 'Ein Fehler wurde behoben, der Nodus daran hinderte, einige bereits gespeicherte KI-API-Schlüssel zu lesen, wodurch sie nicht mehr in den Einstellungen erschienen. Die Schlüssel waren nicht gelöscht worden: Nodus stellt sie jetzt sicher wieder her und nimmt sie erneut in die geschützte Sicherung des Workspace auf.',
        pt: 'Foi corrigido um erro que impedia o Nodus de ler algumas chaves de API de IA já guardadas e fazia com que não aparecessem em Definições. As chaves não tinham sido apagadas: o Nodus recupera-as de forma segura e volta a incluí-las na cópia protegida do espaço de trabalho.',
        'pt-BR': 'Foi corrigido um erro que impedia o Nodus de ler algumas chaves de API de IA já salvas e fazia com que não aparecessem em Configurações. As chaves não haviam sido apagadas: o Nodus as recupera com segurança e volta a incluí-las na cópia protegida do espaço de trabalho.',
      },
      {
        scope: 'general',
        es: 'Nodus vuelve a detectar el modelo con el que se creó el índice de cada workspace. Si tus embeddings se generaron, por ejemplo, con BGE-M3 mediante OpenRouter, ese modelo reaparece seleccionado sin borrar ni reindexar ningún vector.',
        en: 'Nodus now detects the model used to build each workspace index again. If your embeddings were generated, for example, with BGE-M3 through OpenRouter, that model is selected again without deleting or reindexing any vectors.',
        fr: 'Nodus détecte à nouveau le modèle avec lequel l\'index de chaque espace de travail a été créé. Si vos embeddings ont été générés, par exemple, avec BGE-M3 via OpenRouter, ce modèle réapparaît sélectionné sans supprimer ni réindexer aucun vecteur.',
        de: 'Nodus erkennt jetzt wieder das Modell, mit dem der Index jedes Workspace erstellt wurde. Wurden Ihre Embeddings beispielsweise mit BGE-M3 über OpenRouter erzeugt, erscheint dieses Modell wieder ausgewählt, ohne dass Vektoren gelöscht oder neu indexiert werden.',
        pt: 'O Nodus volta a detetar o modelo com que foi criado o índice de cada espaço de trabalho. Se os seus embeddings foram gerados, por exemplo, com o BGE-M3 através do OpenRouter, esse modelo reaparece selecionado sem apagar nem reindexar qualquer vetor.',
        'pt-BR': 'O Nodus volta a detectar o modelo com o qual foi criado o índice de cada espaço de trabalho. Se seus embeddings foram gerados, por exemplo, com BGE-M3 via OpenRouter, esse modelo reaparece selecionado sem apagar nem reindexar nenhum vetor.',
      },
      {
        scope: 'general',
        es: 'También se recuperan los modelos destacados y las selecciones por tarea conservadas antes de la migración. El modo básico o avanzado y el modelo de embeddings vuelven a pertenecer a cada workspace, evitando que uno sobrescriba la configuración de otro.',
        en: 'Favorite models and per-task selections preserved before the migration are recovered too. Basic or advanced mode and the embedding model belong to each workspace again, preventing one workspace from overwriting another.',
        fr: 'Les modèles favoris et les sélections par tâche conservées avant la migration sont également récupérés. Le mode basique ou avancé et le modèle d\'embeddings appartiennent à nouveau à chaque espace de travail, évitant qu\'un espace n\'écrase la configuration d\'un autre.',
        de: 'Auch die vor der Migration gespeicherten bevorzugten Modelle und aufgabenbezogenen Auswahlen werden wiederhergestellt. Der einfache oder erweiterte Modus sowie das Embedding-Modell gehören wieder zu jedem Workspace, sodass keiner die Konfiguration eines anderen überschreibt.',
        pt: 'Também são recuperados os modelos destacados e as seleções por tarefa conservadas antes da migração. O modo básico ou avançado e o modelo de embeddings voltam a pertencer a cada espaço de trabalho, evitando que um substitua a configuração de outro.',
        'pt-BR': 'Também são recuperados os modelos favoritos e as seleções por tarefa preservadas antes da migração. O modo básico ou avançado e o modelo de embeddings voltam a pertencer a cada espaço de trabalho, evitando que um sobrescreva a configuração de outro.',
      },
    ],
  },
  {
    version: '2.3.1',
    date: '2026-07-15',
    highlights: [
      {
        scope: 'general',
        es: 'Se ha solucionado un error que impedía a Nodus leer algunas claves de API de IA ya guardadas y hacía que no aparecieran en Ajustes. Las claves no se habían borrado: esta versión las recupera de forma segura, conserva sus copias cifradas anteriores y vuelve a incluirlas en la copia protegida del workspace.',
        en: 'Fixed an issue that prevented Nodus from reading some previously saved AI API keys, making them disappear from Settings. The keys had not been deleted: this version recovers them safely, preserves their previous encrypted copies and includes them again in the protected workspace backup.',
        fr: 'Un problème empêchant Nodus de lire certaines clés d\'API d\'IA déjà enregistrées, les faisant disparaître des Paramètres, a été corrigé. Les clés n\'avaient pas été supprimées : cette version les récupère en toute sécurité, conserve leurs copies chiffrées antérieures et les réintègre dans la copie protégée de l\'espace de travail.',
        de: 'Ein Fehler wurde behoben, der Nodus daran hinderte, einige bereits gespeicherte KI-API-Schlüssel zu lesen, wodurch sie nicht mehr in den Einstellungen erschienen. Die Schlüssel waren nicht gelöscht worden: Diese Version stellt sie sicher wieder her, behält ihre bisherigen verschlüsselten Kopien bei und nimmt sie erneut in die geschützte Sicherung des Workspace auf.',
        pt: 'Foi corrigido um erro que impedia o Nodus de ler algumas chaves de API de IA já guardadas e fazia com que não aparecessem em Definições. As chaves não tinham sido apagadas: esta versão recupera-as de forma segura, conserva as suas cópias cifradas anteriores e volta a incluí-las na cópia protegida do espaço de trabalho.',
        'pt-BR': 'Foi corrigido um erro que impedia o Nodus de ler algumas chaves de API de IA já salvas e fazia com que não aparecessem em Configurações. As chaves não haviam sido apagadas: esta versão as recupera com segurança, preserva suas cópias criptografadas anteriores e volta a incluí-las na cópia protegida do espaço de trabalho.',
      },
      {
        scope: 'general',
        es: 'En macOS puede aparecer una solicitud del Llavero durante la recuperación. Comprueba que corresponde a Nodus y selecciona «Permitir siempre»; si la cerraste, puedes repetir la recuperación desde Ajustes → Proveedores.',
        en: 'On macOS, Keychain may ask for permission during recovery. Check that the request belongs to Nodus and choose “Always Allow”; if you dismissed it, retry from Settings → Providers.',
        fr: 'Sur macOS, une demande du Trousseau peut apparaître pendant la récupération. Vérifiez qu\'elle provient bien de Nodus et sélectionnez «Toujours autoriser» ; si vous l\'avez fermée, vous pouvez relancer la récupération depuis Paramètres → Fournisseurs.',
        de: 'Unter macOS kann während der Wiederherstellung eine Anfrage des Schlüsselbunds erscheinen. Prüfen Sie, dass sie von Nodus stammt, und wählen Sie „Immer erlauben“; falls Sie sie geschlossen haben, können Sie die Wiederherstellung über Einstellungen → Anbieter wiederholen.',
        pt: 'No macOS pode surgir um pedido do Acesso às Chaves durante a recuperação. Verifique que corresponde ao Nodus e selecione «Permitir sempre»; se o fechou, pode repetir a recuperação a partir de Definições → Fornecedores.',
        'pt-BR': 'No macOS, pode aparecer uma solicitação do Chaveiro durante a recuperação. Confira se ela corresponde ao Nodus e selecione “Sempre permitir”; se você a fechou, pode repetir a recuperação em Configurações → Provedores.',
      },
    ],
  },
  {
    version: '2.3.0',
    date: '2026-07-15',
    highlights: [
      {
        scope: 'estudio',
        es: 'El vault de estudio da un gran salto: cursos y asignaturas, carpetas y apuntes, materiales anotables, grabaciones con transcripción, horario, calendario, banco de preguntas, tests, tarjetas, repasos, progreso, grafo de conocimiento y chat fundamentado en tus fuentes.',
        en: 'Study vault takes a major leap forward: courses and subjects, folders and notes, annotatable materials, recordings with transcripts, timetable, calendar, question bank, tests, flashcards, reviews, progress, a knowledge graph and source-grounded chat.',
        fr: 'L\'espace Étude franchit une étape majeure : cours et matières, dossiers et notes, matériaux annotables, enregistrements avec transcription, emploi du temps, calendrier, banque de questions, tests, flashcards, révisions, progression, graphe de connaissances et chat fondé sur vos sources.',
        de: 'Der Studium-Arbeitsbereich macht einen großen Sprung nach vorn: Kurse und Fächer, Ordner und Notizen, kommentierbare Materialien, Aufnahmen mit Transkription, Stundenplan, Kalender, Fragenbank, Tests, Flashcards, Wiederholungen, Fortschritt, Wissensgraph und ein auf Ihren Quellen basierender Chat.',
        pt: 'O espaço de estudo dá um grande salto: cursos e disciplinas, pastas e notas, materiais anotáveis, gravações com transcrição, horário, calendário, banco de perguntas, testes, flashcards, revisões, progresso, grafo de conhecimento e chat fundamentado nas suas fontes.',
        'pt-BR': 'O espaço de estudo dá um grande salto: cursos e disciplinas, pastas e notas, materiais anotáveis, gravações com transcrição, horário, calendário, banco de questões, testes, flashcards, revisões, progresso, grafo de conhecimento e chat fundamentado em suas fontes.',
      },
      {
        scope: 'estudio',
        es: 'Zotero se integra más a fondo: las bóvedas pueden usar bibliotecas de grupo y, desde cursos o materiales, buscar un elemento y decidir si importar su adjunto a Nodus o mantener un enlace que lo abra en Zotero.',
        en: 'Zotero integration goes deeper: vaults can use group libraries and, from courses or materials, search for an item and choose whether to import its attachment into Nodus or keep a link that opens it in Zotero.',
        fr: 'L\'intégration de Zotero va plus loin : les espaces peuvent utiliser des bibliothèques de groupe et, depuis les cours ou les matériaux, rechercher un élément et choisir d\'importer sa pièce jointe dans Nodus ou de conserver un lien qui l\'ouvre dans Zotero.',
        de: 'Die Zotero-Integration geht tiefer: Arbeitsbereiche können jetzt Gruppenbibliotheken nutzen und aus Kursen oder Materialien heraus ein Element suchen und entscheiden, ob dessen Anhang in Nodus importiert oder ein Link beibehalten wird, der es in Zotero öffnet.',
        pt: 'A integração com o Zotero aprofunda-se: os espaços podem usar bibliotecas de grupo e, a partir de cursos ou materiais, procurar um elemento e decidir se importam o seu anexo para o Nodus ou se mantêm uma ligação que o abre no Zotero.',
        'pt-BR': 'O Zotero se integra mais a fundo: os espaços podem usar bibliotecas de grupo e, a partir de cursos ou materiais, buscar um item e decidir se importam seu anexo para o Nodus ou mantêm um link que o abra no Zotero.',
      },
      {
        scope: 'general',
        es: 'Groq y Cerebras se incorporan como proveedores de IA, con carga de modelos cuando el proveedor la permite. La configuración básica y avanzada ahora avisa antes de cambiar de modo para evitar dejar modelos sin configurar por accidente.',
        en: 'Groq and Cerebras join the AI providers, with model discovery whenever the provider supports it. Basic and advanced setup now asks for confirmation before switching modes, preventing accidental incomplete model configurations.',
        fr: 'Groq et Cerebras rejoignent les fournisseurs d\'IA, avec chargement des modèles lorsque le fournisseur le permet. La configuration basique et avancée avertit désormais avant de changer de mode, afin d\'éviter de laisser des modèles non configurés par accident.',
        de: 'Groq und Cerebras kommen als KI-Anbieter hinzu, mit Modell-Ladefunktion, sofern der Anbieter dies unterstützt. Die einfache und erweiterte Konfiguration warnt jetzt vor dem Wechsel des Modus, um zu verhindern, dass versehentlich Modelle unkonfiguriert bleiben.',
        pt: 'O Groq e o Cerebras juntam-se aos fornecedores de IA, com carregamento de modelos quando o fornecedor o permite. A configuração básica e avançada avisa agora antes de mudar de modo, para evitar deixar modelos por configurar por acidente.',
        'pt-BR': 'Groq e Cerebras passam a ser provedores de IA, com carregamento de modelos quando o provedor permite. A configuração básica e avançada agora avisa antes de mudar de modo para evitar deixar modelos sem configurar por acidente.',
      },
      {
        scope: 'general',
        es: 'Los modelos locales son más sencillos de usar: puedes descargar, seleccionar y eliminar modelos integrados para distintas tareas y, si uno necesita un motor previo, Nodus lo instala automáticamente antes de iniciar la descarga.',
        en: 'Local models are easier to use: download, select and remove integrated models for different tasks, and when a model requires an engine first, Nodus installs it automatically before starting the download.',
        fr: 'Les modèles locaux sont plus simples à utiliser : vous pouvez télécharger, sélectionner et supprimer des modèles intégrés pour différentes tâches et, si l\'un d\'eux nécessite un moteur préalable, Nodus l\'installe automatiquement avant de démarrer le téléchargement.',
        de: 'Lokale Modelle sind jetzt einfacher zu nutzen: Sie können integrierte Modelle für verschiedene Aufgaben herunterladen, auswählen und entfernen. Benötigt ein Modell zuvor eine Engine, installiert Nodus diese automatisch, bevor der Download beginnt.',
        pt: 'Os modelos locais são mais simples de usar: pode transferir, selecionar e eliminar modelos integrados para diferentes tarefas e, se um precisar de um motor prévio, o Nodus instala-o automaticamente antes de iniciar a transferência.',
        'pt-BR': 'Os modelos locais ficaram mais fáceis de usar: você pode baixar, selecionar e excluir modelos integrados para diferentes tarefas e, se um deles precisar de um mecanismo prévio, o Nodus o instala automaticamente antes de iniciar o download.',
      },
      {
        scope: 'general',
        es: 'Nueva guía esencial cinematográfica protagonizada por Nodi para entender bóvedas, proveedores, modelos, embeddings y voz. Nodi se presenta al final, permanece más tranquilo durante el recorrido y no se superpone con su versión real.',
        en: 'A new cinematic essential guide starring Nodi explains vaults, providers, models, embeddings and speech. Nodi is introduced at the end, stays calmer throughout the tour and no longer overlaps with the live companion.',
        fr: 'Nouveau guide essentiel cinématographique mettant en vedette Nodi pour comprendre les espaces, les fournisseurs, les modèles, les embeddings et la voix. Nodi se présente à la fin, reste plus calme pendant la visite et ne se superpose plus à sa version réelle.',
        de: 'Neuer filmreifer Einführungsguide mit Nodi in der Hauptrolle, um Arbeitsbereiche, Anbieter, Modelle, Embeddings und Sprache zu verstehen. Nodi stellt sich am Ende vor, bleibt während der Tour ruhiger und überlagert sich nicht mehr mit seiner echten Version.',
        pt: 'Novo guia essencial cinematográfico protagonizado pelo Nodi para compreender espaços, fornecedores, modelos, embeddings e voz. O Nodi apresenta-se no final, permanece mais tranquilo ao longo do percurso e não se sobrepõe à sua versão real.',
        'pt-BR': 'Novo guia essencial cinematográfico estrelado por Nodi para entender espaços, provedores, modelos, embeddings e voz. Nodi se apresenta no final, permanece mais tranquilo durante o percurso e não se sobrepõe à sua versão real.',
      },
      {
        scope: 'general',
        es: 'Nuevo sistema de recuperación total: Nodus protege automáticamente todas tus bóvedas, documentos, ajustes, historiales, archivos y claves en snapshots cifrados dentro de una carpeta segura. Incluye clave de recuperación y un asistente de migración para instalaciones anteriores, compatible con carpetas sincronizadas por Google Drive, Dropbox, iCloud y servicios similares.',
        en: 'A new complete recovery system automatically protects every vault, document, setting, history, file and key in encrypted snapshots inside a safe folder. It includes a recovery key and a migration assistant for previous installations, compatible with folders synchronized by Google Drive, Dropbox, iCloud and similar services.',
        fr: 'Nouveau système de récupération totale : Nodus protège automatiquement tous vos espaces, documents, paramètres, historiques, fichiers et clés dans des snapshots chiffrés au sein d\'un dossier sécurisé. Il inclut une clé de récupération et un assistant de migration pour les installations antérieures, compatible avec les dossiers synchronisés par Google Drive, Dropbox, iCloud et services similaires.',
        de: 'Neues System zur vollständigen Wiederherstellung: Nodus schützt automatisch alle Ihre Arbeitsbereiche, Dokumente, Einstellungen, Verläufe, Dateien und Schlüssel in verschlüsselten Snapshots innerhalb eines sicheren Ordners. Es enthält einen Wiederherstellungsschlüssel und einen Migrationsassistenten für frühere Installationen, kompatibel mit Ordnern, die über Google Drive, Dropbox, iCloud und ähnliche Dienste synchronisiert werden.',
        pt: 'Novo sistema de recuperação total: o Nodus protege automaticamente todos os seus espaços, documentos, definições, históricos, ficheiros e chaves em snapshots cifrados dentro de uma pasta segura. Inclui uma chave de recuperação e um assistente de migração para instalações anteriores, compatível com pastas sincronizadas por Google Drive, Dropbox, iCloud e serviços semelhantes.',
        'pt-BR': 'Novo sistema de recuperação total: o Nodus protege automaticamente todos os seus espaços, documentos, configurações, históricos, arquivos e chaves em snapshots criptografados dentro de uma pasta segura. Inclui chave de recuperação e um assistente de migração para instalações anteriores, compatível com pastas sincronizadas por Google Drive, Dropbox, iCloud e serviços similares.',
      },
      {
        scope: 'general',
        es: 'Las demos de los modos Académico, Genealogía, Bases de datos y Estudio se han ampliado para que ninguna sección empiece vacía: incluyen carpetas, notas, materiales, conversaciones, informes y ejemplos conectados que puedes explorar y eliminar después.',
        en: 'The Academic, Genealogy, Databases and Study demos have been expanded so no section starts empty: they include folders, notes, materials, conversations, reports and connected examples that you can explore and remove afterwards.',
        fr: 'Les démos des modes Académique, Généalogie, Bases de données et Étude ont été enrichies pour qu\'aucune section ne commence vide : elles incluent des dossiers, des notes, des matériaux, des conversations, des rapports et des exemples reliés que vous pouvez explorer puis supprimer.',
        de: 'Die Demos der Modi Akademisch, Genealogie, Datenbanken und Studium wurden erweitert, sodass kein Bereich mehr leer beginnt: Sie enthalten Ordner, Notizen, Materialien, Unterhaltungen, Berichte und verknüpfte Beispiele, die Sie erkunden und anschließend löschen können.',
        pt: 'As demonstrações dos modos Académico, Genealogia, Bases de dados e Estudo foram ampliadas para que nenhuma secção comece vazia: incluem pastas, notas, materiais, conversas, relatórios e exemplos ligados entre si que pode explorar e eliminar depois.',
        'pt-BR': 'As demos dos modos Acadêmico, Genealogia, Bases de dados e Estudo foram ampliadas para que nenhuma seção comece vazia: incluem pastas, notas, materiais, conversas, relatórios e exemplos conectados que você pode explorar e excluir depois.',
      },
      {
        scope: 'nodi',
        es: 'Nodi cierra correctamente su menú, chat y paneles al hacer clic fuera. También mejoran la experiencia flotante, las animaciones del tutorial y el comportamiento del icono de la app, que conserva el aspecto de la bóveda y el tema activos al cerrar.',
        en: 'Nodi now closes its menu, chat and panels correctly when you click elsewhere. The floating experience and tutorial animations are improved too, and the app icon now keeps the active vault and theme appearance after quitting.',
        fr: 'Nodi ferme désormais correctement son menu, son chat et ses panneaux lors d\'un clic à l\'extérieur. L\'expérience flottante, les animations du tutoriel et le comportement de l\'icône de l\'application s\'améliorent également : elle conserve l\'apparence de l\'espace et du thème actifs à la fermeture.',
        de: 'Nodi schließt jetzt sein Menü, den Chat und die Panels korrekt bei einem Klick außerhalb. Auch die schwebende Darstellung, die Tutorial-Animationen und das Verhalten des App-Symbols wurden verbessert: Es behält beim Beenden das Erscheinungsbild des aktiven Arbeitsbereichs und Themas bei.',
        pt: 'O Nodi fecha corretamente o seu menu, chat e painéis ao clicar fora. Também melhoram a experiência flutuante, as animações do tutorial e o comportamento do ícone da aplicação, que conserva o aspeto do espaço e do tema ativos ao fechar.',
        'pt-BR': 'Nodi agora fecha corretamente seu menu, chat e painéis ao clicar fora. Também melhoram a experiência flutuante, as animações do tutorial e o comportamento do ícone do app, que mantém a aparência do espaço e do tema ativos ao fechar.',
      },
      {
        scope: 'general',
        es: 'La navegación lateral se siente más consistente: la marca de Nodus permanece centrada al redimensionar el menú y toda su cabecera permite mostrarlo u ocultarlo.',
        en: 'Sidebar navigation now feels more consistent: the Nodus brand stays centered as the menu is resized, and its entire header can show or hide it.',
        fr: 'La navigation latérale paraît plus cohérente : la marque Nodus reste centrée lors du redimensionnement du menu et l\'ensemble de son en-tête permet de l\'afficher ou de le masquer.',
        de: 'Die seitliche Navigation wirkt jetzt einheitlicher: Das Nodus-Logo bleibt beim Ändern der Menügröße zentriert, und der gesamte Kopfbereich lässt sich zum Ein- oder Ausblenden nutzen.',
        pt: 'A navegação lateral torna-se mais consistente: a marca do Nodus permanece centrada ao redimensionar o menu e todo o seu cabeçalho permite mostrá-lo ou ocultá-lo.',
        'pt-BR': 'A navegação lateral parece mais consistente: a marca do Nodus permanece centralizada ao redimensionar o menu e todo o seu cabeçalho permite exibi-lo ou ocultá-lo.',
      },
      {
        scope: 'general',
        es: 'El panel de novedades estrena una presentación cinematográfica con Nodi celebrando, versiones y cambios claramente visibles en modo claro y oscuro, además de una sección opcional para apoyar el proyecto open source mediante PayPal.',
        en: 'The What’s New panel now has a cinematic presentation with Nodi celebrating, versions and changes clearly visible in light and dark mode, plus an optional section to support the open-source project through PayPal.',
        fr: 'Le panneau des nouveautés inaugure une présentation cinématographique avec Nodi qui célèbre, des versions et des changements clairement visibles en mode clair et sombre, ainsi qu\'une section optionnelle pour soutenir le projet open source via PayPal.',
        de: 'Das Neuigkeiten-Panel erhält eine filmreife Präsentation mit einem feiernden Nodi, Versionen und Änderungen, die im hellen und dunklen Modus deutlich sichtbar sind, sowie einen optionalen Bereich zur Unterstützung des Open-Source-Projekts über PayPal.',
        pt: 'O painel de novidades estreia uma apresentação cinematográfica com o Nodi a festejar, versões e alterações claramente visíveis em modo claro e escuro, além de uma secção opcional para apoiar o projeto open source através do PayPal.',
        'pt-BR': 'O painel de novidades estreia uma apresentação cinematográfica com Nodi comemorando, versões e mudanças claramente visíveis no modo claro e escuro, além de uma seção opcional para apoiar o projeto open source por meio do PayPal.',
      },
    ],
  },
  {
    version: '2.2.0',
    date: '2026-07-13',
    highlights: [
      {
        scope: 'nodi',
        es: 'Te presentamos a Nodi, la nueva mascota de Nodus: un nodo de luz que te acompaña flotando abajo a la derecha. Puedes arrastrarlo por la ventana y activarlo o desactivarlo desde Ajustes → Interfaz.',
        en: 'Meet Nodi, Nodus’s new mascot: a little node of light that keeps you company, floating at the bottom right. Drag it around the window, and switch it on or off in Settings → Interface.',
        fr: 'Nous vous présentons Nodi, la nouvelle mascotte de Nodus : un nœud de lumière qui vous accompagne en flottant en bas à droite. Vous pouvez le faire glisser dans la fenêtre et l\'activer ou le désactiver depuis Paramètres → Interface.',
        de: 'Wir stellen Ihnen Nodi vor, das neue Maskottchen von Nodus: ein Lichtknoten, der Sie schwebend unten rechts begleitet. Sie können es im Fenster verschieben und in Einstellungen → Oberfläche ein- oder ausschalten.',
        pt: 'Apresentamos-lhe o Nodi, a nova mascote do Nodus: um nó de luz que o acompanha flutuando em baixo à direita. Pode arrastá-lo pela janela e ativá-lo ou desativá-lo em Definições → Interface.',
        'pt-BR': 'Apresentamos o Nodi, a nova mascote do Nodus: um nó de luz que acompanha você flutuando no canto inferior direito. Você pode arrastá-lo pela janela e ativá-lo ou desativá-lo em Configurações → Interface.',
      },
      {
        scope: 'nodi',
        es: 'Haz clic en Nodi para abrir su menú: un chat con la IA que conoce Nodus y tu configuración, un centro de notificaciones (te avisa con un punto rojo y levantando la mano) y una ayuda rápida. Además, Nodi cambia de traje según el modo de la bóveda (académico, genealogía, bases de datos), algo que puedes desactivar si prefieres el Nodi de siempre.',
        en: 'Click Nodi to open its menu: a chat with an AI that knows Nodus and your setup, a notification center (it flags unread items with a red dot and a raised hand) and quick help. Nodi even changes outfit to match the vault mode (academic, genealogy, databases) — which you can turn off if you prefer the plain Nodi.',
        fr: 'Cliquez sur Nodi pour ouvrir son menu : un chat avec l\'IA qui connaît Nodus et votre configuration, un centre de notifications (il vous prévient avec un point rouge et en levant la main) et une aide rapide. De plus, Nodi change de tenue selon le mode de l\'espace (académique, généalogie, bases de données), ce que vous pouvez désactiver si vous préférez le Nodi habituel.',
        de: 'Klicken Sie auf Nodi, um sein Menü zu öffnen: einen Chat mit der KI, die Nodus und Ihre Konfiguration kennt, ein Benachrichtigungszentrum (es macht mit einem roten Punkt und einer erhobenen Hand auf sich aufmerksam) und eine Kurzhilfe. Außerdem wechselt Nodi je nach Modus des Arbeitsbereichs (Akademisch, Genealogie, Datenbanken) sein Outfit – das können Sie deaktivieren, wenn Sie den klassischen Nodi bevorzugen.',
        pt: 'Clique no Nodi para abrir o seu menu: um chat com a IA que conhece o Nodus e a sua configuração, um centro de notificações (avisa-o com um ponto vermelho e levantando a mão) e uma ajuda rápida. Além disso, o Nodi muda de traje consoante o modo do espaço (académico, genealogia, bases de dados), algo que pode desativar se preferir o Nodi de sempre.',
        'pt-BR': 'Clique em Nodi para abrir seu menu: um chat com a IA que conhece o Nodus e sua configuração, uma central de notificações (ele avisa com um ponto vermelho e levantando a mão) e uma ajuda rápida. Além disso, Nodi troca de traje conforme o modo do espaço (acadêmico, genealogia, bases de dados), algo que você pode desativar se preferir o Nodi de sempre.',
      },
      {
        scope: 'nodi',
        es: 'Si quieres, Nodi puede vivir en una pequeña ventana flotante del escritorio, siempre por encima del resto de aplicaciones —incluso a pantalla completa—, para tenerlo a mano sin cambiar de app.',
        en: 'If you like, Nodi can live in a small floating desktop window, always on top of your other apps — even in fullscreen — so it’s always within reach without switching apps.',
        fr: 'Si vous le souhaitez, Nodi peut vivre dans une petite fenêtre flottante du bureau, toujours au-dessus des autres applications — même en plein écran — pour l\'avoir à portée de main sans changer d\'application.',
        de: 'Wenn Sie möchten, kann Nodi in einem kleinen schwebenden Desktop-Fenster leben, immer über allen anderen Anwendungen – sogar im Vollbildmodus –, sodass es stets griffbereit ist, ohne die App zu wechseln.',
        pt: 'Se quiser, o Nodi pode viver numa pequena janela flutuante do ambiente de trabalho, sempre por cima das restantes aplicações — mesmo em ecrã inteiro —, para o ter à mão sem mudar de aplicação.',
        'pt-BR': 'Se você quiser, Nodi pode viver em uma pequena janela flutuante da área de trabalho, sempre acima das demais aplicações — mesmo em tela cheia —, para tê-lo à mão sem trocar de app.',
      },
    ],
  },
  {
    version: '2.1.1',
    date: '2026-07-13',
    highlights: [
      {
        scope: 'general',
        es: 'Los modelos que eliges para cada proveedor y para cada tarea de IA ahora se comparten entre todas tus bóvedas, igual que ya ocurría con las claves de API. Configúralos una vez y estarán listos en cualquier bóveda.',
        en: 'The models you pick for each provider and for each AI task are now shared across all your vaults, just like your API keys already were. Set them up once and they’re ready in every vault.',
        fr: 'Les modèles que vous choisissez pour chaque fournisseur et pour chaque tâche d\'IA sont désormais partagés entre tous vos espaces, comme c\'était déjà le cas pour les clés d\'API. Configurez-les une fois et ils seront prêts dans n\'importe quel espace.',
        de: 'Die Modelle, die Sie für jeden Anbieter und jede KI-Aufgabe wählen, werden jetzt zwischen allen Ihren Arbeitsbereichen geteilt, genau wie es bereits bei den API-Schlüsseln der Fall war. Konfigurieren Sie sie einmal, und sie stehen in jedem Arbeitsbereich bereit.',
        pt: 'Os modelos que escolhe para cada fornecedor e para cada tarefa de IA passam agora a ser partilhados entre todos os seus espaços, tal como já acontecia com as chaves de API. Configure-os uma vez e estarão prontos em qualquer espaço.',
        'pt-BR': 'Os modelos que você escolhe para cada provedor e para cada tarefa de IA agora são compartilhados entre todos os seus espaços, assim como já acontecia com as chaves de API. Configure-os uma vez e eles estarão prontos em qualquer espaço.',
      },
      {
        scope: 'general',
        es: 'Como las bóvedas comparten claves y modelos, hemos retirado el aviso de «cargar claves de API desde otra bóveda»: ya no hacía falta.',
        en: 'Since vaults share keys and models, we removed the “load API keys from another vault” prompt — it was no longer needed.',
        fr: 'Les espaces partageant désormais les clés et les modèles, nous avons retiré l\'avertissement «charger les clés d\'API depuis un autre espace» : il n\'était plus nécessaire.',
        de: 'Da Arbeitsbereiche jetzt Schlüssel und Modelle gemeinsam nutzen, haben wir den Hinweis „API-Schlüssel aus einem anderen Arbeitsbereich laden“ entfernt: Er war nicht mehr nötig.',
        pt: 'Como os espaços partilham chaves e modelos, retirámos o aviso de «carregar chaves de API de outro espaço»: já não era necessário.',
        'pt-BR': 'Como os espaços compartilham chaves e modelos, retiramos o aviso de “carregar chaves de API de outro espaço”: já não era mais necessário.',
      },
    ],
  },
  {
    version: '2.1.0',
    date: '2026-07-13',
    highlights: [
      {
        scope: 'databases',
        es: 'Nodus estrena el modo Bases de datos: un gestor de bases de datos al estilo Notion dentro de tu bóveda. Crea tablas con columnas de muchos tipos (texto, número, selección, fecha, relación, rollup, imagen…), organiza los datos en varias vistas con filtros y ordenaciones, y edítalo todo directamente en la cuadrícula. Importa y exporta en CSV cuando lo necesites.',
        en: 'Nodus introduces Databases mode: a Notion-style database manager inside your vault. Build tables with many column types (text, number, select, date, relation, rollup, image…), organize data across several views with filters and sorting, and edit everything right in the grid. Import and export CSV whenever you need it.',
        fr: 'Nodus inaugure le mode Bases de données : un gestionnaire de bases de données façon Notion au sein de votre espace. Créez des tableaux avec des colonnes de nombreux types (texte, nombre, sélection, date, relation, rollup, image…), organisez les données dans plusieurs vues avec filtres et tris, et modifiez tout directement dans la grille. Importez et exportez en CSV quand vous en avez besoin.',
        de: 'Nodus führt den Modus Datenbanken ein: einen Datenbankmanager im Notion-Stil innerhalb Ihres Arbeitsbereichs. Erstellen Sie Tabellen mit Spalten vieler Typen (Text, Zahl, Auswahl, Datum, Relation, Rollup, Bild…), organisieren Sie die Daten in mehreren Ansichten mit Filtern und Sortierungen und bearbeiten Sie alles direkt im Raster. Importieren und exportieren Sie CSV, wann immer Sie es brauchen.',
        pt: 'O Nodus estreia o modo Bases de dados: um gestor de bases de dados ao estilo Notion dentro do seu espaço. Crie tabelas com colunas de muitos tipos (texto, número, seleção, data, relação, rollup, imagem…), organize os dados em várias vistas com filtros e ordenações, e edite tudo diretamente na grelha. Importe e exporte em CSV sempre que precisar.',
        'pt-BR': 'O Nodus estreia o modo Bases de dados: um gerenciador de bases de dados no estilo Notion dentro do seu espaço. Crie tabelas com colunas de muitos tipos (texto, número, seleção, data, relação, rollup, imagem…), organize os dados em várias visualizações com filtros e ordenações, e edite tudo diretamente na grade. Importe e exporte em CSV quando precisar.',
      },
      {
        scope: 'databases',
        es: 'Columnas con IA: deja que la IA rellene una columna entera a partir del resto de la fila, ya sea con texto (resúmenes, clasificaciones, traducciones) o con imágenes generadas. Y un chat integrado responde preguntas sobre los datos de tu tabla.',
        en: 'AI columns: let the AI fill an entire column from the rest of the row — either with text (summaries, classifications, translations) or with generated images. And a built-in chat answers questions about your table’s data.',
        fr: 'Colonnes avec IA : laissez l\'IA remplir une colonne entière à partir du reste de la ligne, que ce soit avec du texte (résumés, classifications, traductions) ou des images générées. Et un chat intégré répond aux questions sur les données de votre tableau.',
        de: 'Spalten mit KI: Lassen Sie die KI eine ganze Spalte anhand des Rests der Zeile ausfüllen, sei es mit Text (Zusammenfassungen, Klassifizierungen, Übersetzungen) oder mit generierten Bildern. Und ein integrierter Chat beantwortet Fragen zu den Daten Ihrer Tabelle.',
        pt: 'Colunas com IA: deixe que a IA preencha uma coluna inteira a partir do resto da linha, seja com texto (resumos, classificações, traduções) ou com imagens geradas. E um chat integrado responde a perguntas sobre os dados da sua tabela.',
        'pt-BR': 'Colunas com IA: deixe a IA preencher uma coluna inteira a partir do restante da linha, seja com texto (resumos, classificações, traduções) ou com imagens geradas. E um chat integrado responde perguntas sobre os dados da sua tabela.',
      },
      {
        scope: 'databases',
        es: 'Análisis estadístico honesto: la IA propone los análisis adecuados sobre tus columnas reales (correlaciones, chi-cuadrado, ANOVA, regresión) y la app los calcula de forma determinista, con gráficos nativos —mapas de calor, dispersión y diagramas de caja—. La IA planifica; el motor calcula, sin inventar cifras.',
        en: 'Honest statistical analysis: the AI proposes the right analyses over your real columns (correlations, chi-square, ANOVA, regression) and the app computes them deterministically, with native charts — heatmaps, scatter plots and box plots. The AI plans; the engine computes, with no made-up numbers.',
        fr: 'Analyse statistique honnête : l\'IA propose les analyses adaptées à vos colonnes réelles (corrélations, chi carré, ANOVA, régression) et l\'application les calcule de façon déterministe, avec des graphiques natifs — cartes de chaleur, nuages de points et diagrammes en boîte. L\'IA planifie ; le moteur calcule, sans inventer de chiffres.',
        de: 'Ehrliche statistische Analyse: Die KI schlägt die passenden Analysen für Ihre echten Spalten vor (Korrelationen, Chi-Quadrat, ANOVA, Regression), und die App berechnet sie deterministisch, mit nativen Diagrammen – Heatmaps, Streudiagrammen und Boxplots. Die KI plant; die Engine berechnet, ohne Zahlen zu erfinden.',
        pt: 'Análise estatística honesta: a IA propõe as análises adequadas sobre as suas colunas reais (correlações, qui-quadrado, ANOVA, regressão) e a aplicação calcula-as de forma determinística, com gráficos nativos — mapas de calor, dispersão e diagramas de caixa. A IA planeia; o motor calcula, sem inventar números.',
        'pt-BR': 'Análise estatística honesta: a IA propõe as análises adequadas sobre suas colunas reais (correlações, qui-quadrado, ANOVA, regressão) e o app as calcula de forma determinística, com gráficos nativos — mapas de calor, dispersão e diagramas de caixa. A IA planeja; o motor calcula, sem inventar números.',
      },
      {
        scope: 'genealogy',
        es: 'El Archivo de Genealogía se reconstruye como una cuadrícula editable al estilo de las bases de datos: edita cada celda al momento, asigna documentos a varias carpetas a la vez y clasifícalos con una taxonomía de más de 190 tipos de documento patrimonial, con búsqueda inteligente y filtros por faceta.',
        en: 'The Genealogy Archive is rebuilt as an editable database-style grid: edit each cell inline, file documents into several folders at once, and classify them with a taxonomy of 190+ heritage document types, complete with smart search and facet filters.',
        fr: 'L\'Archive de Généalogie est reconstruite sous forme de grille modifiable façon bases de données : modifiez chaque cellule instantanément, assignez des documents à plusieurs dossiers à la fois et classez-les grâce à une taxonomie de plus de 190 types de documents patrimoniaux, avec recherche intelligente et filtres par facette.',
        de: 'Das Genealogie-Archiv wird als bearbeitbares Raster im Stil der Datenbanken neu aufgebaut: Bearbeiten Sie jede Zelle sofort, ordnen Sie Dokumente mehreren Ordnern gleichzeitig zu und klassifizieren Sie sie mit einer Taxonomie von über 190 Typen von Kulturerbe-Dokumenten, mit intelligenter Suche und Facettenfiltern.',
        pt: 'O Arquivo de Genealogia é reconstruído como uma grelha editável ao estilo das bases de dados: edite cada célula no momento, atribua documentos a várias pastas em simultâneo e classifique-os com uma taxonomia de mais de 190 tipos de documento patrimonial, com pesquisa inteligente e filtros por faceta.',
        'pt-BR': 'O Arquivo de Genealogia é reconstruído como uma grade editável no estilo das bases de dados: edite cada célula na hora, atribua documentos a várias pastas de uma vez e classifique-os com uma taxonomia de mais de 190 tipos de documento patrimonial, com busca inteligente e filtros por faceta.',
      },
    ],
  },
  {
    version: '2.0.2',
    date: '2026-07-12',
    highlights: [
      {
        scope: 'genealogy',
        es: 'El Archivo estrena un campo «Fuente» para cada documento: anota de dónde procede (el archivo o repositorio, una cita o una URL). Es la base de una buena cita genealógica y viaja con las copias de seguridad como el resto del documento.',
        en: 'The Archive gains a “Source” field on every document: record where it came from (the archive or repository, a citation, or a URL). It’s the backbone of a good genealogical citation, and it travels with your backups like the rest of the document.',
        fr: 'L\'Archive inaugure un champ «Source» pour chaque document : notez sa provenance (l\'archive ou le dépôt, une citation ou une URL). C\'est la base d\'une bonne citation généalogique, et cela accompagne les sauvegardes comme le reste du document.',
        de: 'Das Archiv erhält ein neues Feld „Quelle“ für jedes Dokument: Notieren Sie, woher es stammt (das Archiv oder Repositorium, eine Zitation oder eine URL). Das ist die Grundlage einer guten genealogischen Zitation und wird wie der Rest des Dokuments in den Sicherungen mitgeführt.',
        pt: 'O Arquivo estreia um campo «Fonte» para cada documento: anote a sua proveniência (o arquivo ou repositório, uma citação ou um URL). É a base de uma boa citação genealógica e acompanha as cópias de segurança tal como o resto do documento.',
        'pt-BR': 'O Arquivo estreia um campo “Fonte” para cada documento: anote de onde ele vem (o arquivo ou repositório, uma citação ou uma URL). É a base de uma boa citação genealógica e acompanha os backups como o restante do documento.',
      },
    ],
  },
  {
    version: '2.0.1',
    date: '2026-07-12',
    highlights: [
      {
        scope: 'general',
        es: 'El selector de bóvedas muestra ahora una etiqueta con el tipo de cada bóveda (Académico, Genealogía…), y el rótulo «Activa» y el botón «Cargar» comparten por fin la misma tipografía.',
        en: 'The vault switcher now shows a badge with each vault’s type (Academic, Genealogy…), and the “Active” label and the “Load” button finally share the same typography.',
        fr: 'Le sélecteur d\'espaces affiche désormais un badge indiquant le type de chaque espace (Académique, Généalogie…), et le libellé «Actif» et le bouton «Charger» partagent enfin la même typographie.',
        de: 'Die Arbeitsbereichsauswahl zeigt jetzt ein Etikett mit dem Typ jedes Arbeitsbereichs (Akademisch, Genealogie…), und die Bezeichnung „Aktiv“ und die Schaltfläche „Laden“ verwenden endlich dieselbe Schriftart.',
        pt: 'O seletor de espaços mostra agora um distintivo com o tipo de cada espaço (Académico, Genealogia…), e o rótulo «Ativo» e o botão «Carregar» partilham finalmente a mesma tipografia.',
        'pt-BR': 'O seletor de espaços agora exibe uma etiqueta com o tipo de cada espaço (Acadêmico, Genealogia…), e o rótulo “Ativo” e o botão “Carregar” finalmente compartilham a mesma tipografia.',
      },
      {
        scope: 'genealogy',
        es: 'En las fichas de persona, los botones de editar y eliminar de las relaciones sociales pasan a ser iconos, y el panel de «Ajustar encuadre» del retrato se cierra al hacer clic fuera y ya no queda descuadrado.',
        en: 'In the person dossier, the edit and delete buttons of social relations are now icons, and the portrait “Adjust framing” panel closes on an outside click and is no longer misaligned.',
        fr: 'Dans les fiches de personne, les boutons de modification et de suppression des relations sociales deviennent des icônes, et le panneau «Ajuster le cadrage» du portrait se ferme lors d\'un clic à l\'extérieur et n\'est plus désaligné.',
        de: 'In den Personendossiers werden die Schaltflächen zum Bearbeiten und Löschen sozialer Beziehungen jetzt zu Symbolen, und das Panel „Ausschnitt anpassen“ für das Porträt schließt sich bei einem Klick außerhalb und ist nicht mehr verschoben.',
        pt: 'Nas fichas de pessoa, os botões de editar e eliminar das relações sociais passam a ser ícones, e o painel de «Ajustar enquadramento» do retrato fecha-se ao clicar fora e deixa de ficar desalinhado.',
        'pt-BR': 'Nas fichas de pessoa, os botões de editar e excluir das relações sociais passam a ser ícones, e o painel de “Ajustar enquadramento” do retrato se fecha ao clicar fora e não fica mais desalinhado.',
      },
      {
        scope: 'general',
        es: 'Corregida la ventana de novedades: ahora aparece correctamente al actualizar y recupera los cambios de la versión 2.0.0 si te los perdiste.',
        en: 'Fixed the what’s-new window: it now appears correctly after updating and recovers the 2.0.0 changes if you missed them.',
        fr: 'Fenêtre des nouveautés corrigée : elle apparaît désormais correctement lors de la mise à jour et récupère les changements de la version 2.0.0 si vous les avez manqués.',
        de: 'Das Neuigkeiten-Fenster wurde korrigiert: Es erscheint jetzt korrekt nach einem Update und zeigt die Änderungen der Version 2.0.0 an, falls Sie diese verpasst haben.',
        pt: 'Corrigida a janela de novidades: aparece agora corretamente ao atualizar e recupera as alterações da versão 2.0.0 caso as tenha perdido.',
        'pt-BR': 'Corrigida a janela de novidades: agora ela aparece corretamente ao atualizar e recupera as mudanças da versão 2.0.0 caso você as tenha perdido.',
      },
    ],
  },
  {
    version: '2.0.0',
    date: '2026-07-12',
    highlights: [
      {
        scope: 'general',
        es: 'Nodus estrena tipos de bóveda: cada bóveda tiene ahora un modo que adapta las secciones visibles y la personalidad del asistente de IA. Esta versión trae dos modos, «Académico» y «Genealogía», y anuncia los que llegarán después: Estudio, Fuentes primarias y Bases de datos.',
        en: 'Nodus introduces vault types: each vault now has a mode that tailors which sections are shown and the AI assistant’s persona. This release ships two modes, “Academic” and “Genealogy”, and previews the ones coming next: Study, Primary Sources and Databases.',
        fr: 'Nodus inaugure les types d\'espace : chaque espace dispose désormais d\'un mode qui adapte les sections visibles et la personnalité de l\'assistant IA. Cette version apporte deux modes, «Académique» et «Généalogie», et annonce ceux à venir : Étude, Sources primaires et Bases de données.',
        de: 'Nodus führt Arbeitsbereichstypen ein: Jeder Arbeitsbereich hat jetzt einen Modus, der die sichtbaren Bereiche und die Persönlichkeit des KI-Assistenten anpasst. Diese Version bringt zwei Modi, „Akademisch“ und „Genealogie“, und kündigt die kommenden an: Studium, Primärquellen und Datenbanken.',
        pt: 'O Nodus estreia tipos de espaço: cada espaço tem agora um modo que adapta as secções visíveis e a personalidade do assistente de IA. Esta versão traz dois modos, «Académico» e «Genealogia», e anuncia os que chegarão depois: Estudo, Fontes primárias e Bases de dados.',
        'pt-BR': 'O Nodus estreia os tipos de espaço: cada espaço agora tem um modo que adapta as seções visíveis e a personalidade do assistente de IA. Esta versão traz dois modos, “Acadêmico” e “Genealogia”, e anuncia os que chegarão depois: Estudo, Fontes primárias e Bases de dados.',
      },
      {
        scope: 'genealogy',
        es: 'Nuevo modo Genealogía: reconstruye historia familiar a partir de fuentes primarias con fichas de persona, árbol genealógico, cronología, archivo de evidencia y un mapa real. El asistente actúa como genealogista y propone parentescos a partir de la evidencia, siguiendo el estándar de prueba genealógico.',
        en: 'New Genealogy mode: reconstruct family history from primary sources with person dossiers, a family tree, a timeline, an evidence archive and a real map. The assistant acts as a genealogist and proposes kinship from the evidence, following the genealogical proof standard.',
        fr: 'Nouveau mode Généalogie : reconstituez l\'histoire familiale à partir de sources primaires grâce à des fiches de personne, un arbre généalogique, une chronologie, une archive de preuves et une carte réelle. L\'assistant agit comme un généalogiste et propose des liens de parenté à partir des preuves, en suivant la norme de preuve généalogique.',
        de: 'Neuer Modus Genealogie: Rekonstruieren Sie Familiengeschichte anhand von Primärquellen mit Personendossiers, Stammbaum, Zeitleiste, Belegarchiv und einer echten Karte. Der Assistent agiert als Genealoge und schlägt anhand der Belege Verwandtschaftsverhältnisse vor, gemäß dem genealogischen Beweisstandard.',
        pt: 'Novo modo Genealogia: reconstrua a história familiar a partir de fontes primárias com fichas de pessoa, árvore genealógica, cronologia, arquivo de evidências e um mapa real. O assistente atua como genealogista e propõe parentescos a partir das evidências, seguindo o padrão de prova genealógica.',
        'pt-BR': 'Novo modo Genealogia: reconstrua a história familiar a partir de fontes primárias com fichas de pessoa, árvore genealógica, cronologia, arquivo de evidências e um mapa real. O assistente atua como genealogista e propõe parentescos a partir das evidências, seguindo o padrão de prova genealógica.',
      },
      {
        scope: 'genealogy',
        es: 'Relaciones sociales: una segunda red, independiente del parentesco, para amistades, patronazgo, empleo, rivalidades y correspondencia — el material del historiador social y prosopográfico.',
        en: 'Social relations: a second network, independent from kinship, for friendships, patronage, employment, rivalries and correspondence — the material of the social and prosopographical historian.',
        fr: 'Relations sociales : un second réseau, indépendant du lien de parenté, pour les amitiés, le patronage, l\'emploi, les rivalités et la correspondance — la matière de l\'historien social et prosopographique.',
        de: 'Soziale Beziehungen: ein zweites, vom Verwandtschaftsverhältnis unabhängiges Netzwerk für Freundschaften, Patronage, Beschäftigung, Rivalitäten und Korrespondenz — das Material des Sozial- und Prosopographiehistorikers.',
        pt: 'Relações sociais: uma segunda rede, independente do parentesco, para amizades, patrocínio, emprego, rivalidades e correspondência — a matéria-prima do historiador social e prosopográfico.',
        'pt-BR': 'Relações sociais: uma segunda rede, independente do parentesco, para amizades, patronagem, emprego, rivalidades e correspondência — o material do historiador social e prosopográfico.',
      },
      {
        scope: 'genealogy',
        es: 'Deep Research aprende genealogía: compone un informe de historia familiar sobre el archivo indexado por embeddings y la biblioteca. La cabecera muestra ahora el modo de la bóveda activa en su color de acento.',
        en: 'Deep Research learns genealogy: it composes a family-history report over the embedding-indexed archive and library. The header now shows the active vault’s mode in its accent colour.',
        fr: 'Deep Research apprend la généalogie : il compose un rapport d\'histoire familiale à partir de l\'archive indexée par embeddings et de la bibliothèque. L\'en-tête affiche désormais le mode de l\'espace actif dans sa couleur d\'accent.',
        de: 'Deep Research lernt Genealogie: Es erstellt einen Bericht zur Familiengeschichte auf Grundlage des per Embeddings indexierten Archivs und der Bibliothek. Die Kopfzeile zeigt jetzt den Modus des aktiven Arbeitsbereichs in seiner Akzentfarbe an.',
        pt: 'O Deep Research aprende genealogia: compõe um relatório de história familiar sobre o arquivo indexado por embeddings e a biblioteca. O cabeçalho mostra agora o modo do espaço ativo na sua cor de destaque.',
        'pt-BR': 'Deep Research aprende genealogia: compõe um relatório de história familiar a partir do arquivo indexado por embeddings e da biblioteca. O cabeçalho agora mostra o modo do espaço ativo em sua cor de destaque.',
      },
      {
        scope: 'general',
        es: 'Copias de seguridad multi-bóveda: el sistema de respaldos automáticos cifrados abarca ahora todas tus bóvedas con rotación por generaciones.',
        en: 'Multi-vault backups: the automatic encrypted backup system now covers all your vaults with generational rotation.',
        fr: 'Sauvegardes multi-espaces : le système de sauvegardes automatiques chiffrées couvre désormais tous vos espaces avec rotation par générations.',
        de: 'Arbeitsbereichsübergreifende Sicherungen: Das System automatischer verschlüsselter Sicherungen umfasst jetzt alle Ihre Arbeitsbereiche mit generationsbasierter Rotation.',
        pt: 'Cópias de segurança multi-espaço: o sistema de backups automáticos cifrados abrange agora todos os seus espaços com rotação por gerações.',
        'pt-BR': 'Backups multi-espaço: o sistema de backups automáticos criptografados agora abrange todos os seus espaços com rotação por gerações.',
      },
    ],
  },
  {
    version: '1.8.0',
    date: '2026-07-11',
    highlights: [
      {
        scope: 'general',
        es: 'Nuevo copiloto de escritura para LibreOffice Writer (Linux, macOS y Windows): instala la macro desde Ajustes → Copiloto de escritura (LibreOffice), ejecútala en Writer y el panel del copiloto sigue tu cursor para analizar el párrafo e insertar texto citado con IA. La conexión se configura sola.',
        en: 'New writing copilot for LibreOffice Writer (Linux, macOS and Windows): install the macro from Settings → Writing copilot (LibreOffice), run it in Writer, and the copilot pane follows your cursor to analyze the paragraph and insert AI-drafted cited text. The connection configures itself.',
        fr: 'Nouveau copilote d\'écriture pour LibreOffice Writer (Linux, macOS et Windows) : installez la macro depuis Paramètres → Copilote d\'écriture (LibreOffice), exécutez-la dans Writer, et le panneau du copilote suit votre curseur pour analyser le paragraphe et insérer du texte cité généré par IA. La connexion se configure automatiquement.',
        de: 'Neuer Schreib-Copilot für LibreOffice Writer (Linux, macOS und Windows): Installieren Sie das Makro über Einstellungen → Schreib-Copilot (LibreOffice), führen Sie es in Writer aus, und das Copilot-Panel folgt Ihrem Cursor, um den Absatz zu analysieren und mit KI zitierten Text einzufügen. Die Verbindung konfiguriert sich von selbst.',
        pt: 'Novo copiloto de escrita para o LibreOffice Writer (Linux, macOS e Windows): instale a macro em Definições → Copiloto de escrita (LibreOffice), execute-a no Writer e o painel do copiloto segue o seu cursor para analisar o parágrafo e inserir texto citado com IA. A ligação configura-se sozinha.',
        'pt-BR': 'Novo copiloto de escrita para o LibreOffice Writer (Linux, macOS e Windows): instale a macro em Configurações → Copiloto de escrita (LibreOffice), execute-a no Writer e o painel do copiloto segue seu cursor para analisar o parágrafo e inserir texto citado com IA. A conexão se configura sozinha.',
      },
      {
        scope: 'general',
        es: 'Nodus llega a Linux: cada release publica ahora instaladores .deb y AppImage, y la app hereda el tema del cursor del sistema en Wayland.',
        en: 'Nodus lands on Linux: every release now ships .deb and AppImage installers, and the app inherits the system cursor theme on Wayland.',
        fr: 'Nodus arrive sur Linux : chaque version publie désormais des installateurs .deb et AppImage, et l\'application hérite du thème du curseur du système sous Wayland.',
        de: 'Nodus kommt zu Linux: Jedes Release veröffentlicht jetzt .deb- und AppImage-Installer, und die App übernimmt unter Wayland das Cursor-Theme des Systems.',
        pt: 'O Nodus chega ao Linux: cada versão passa a publicar instaladores .deb e AppImage, e a aplicação herda o tema do cursor do sistema no Wayland.',
        'pt-BR': 'O Nodus chega ao Linux: cada release agora publica instaladores .deb e AppImage, e o app herda o tema do cursor do sistema no Wayland.',
      },
      {
        scope: 'languages',
        es: 'Los idiomas de los prompts suman francés y turco: las ideas, los informes de Deep Research y los borradores del taller pueden generarse también en esos idiomas. Las citas literales siempre conservan el idioma original.',
        en: 'Prompt languages now include French and Turkish: ideas, Deep Research reports and workshop drafts can also be generated in those languages. Verbatim quotes always keep the source language.',
        fr: 'Les langues des prompts s\'enrichissent du français et du turc : les idées, les rapports de Deep Research et les brouillons de l\'atelier peuvent désormais être générés dans ces langues également. Les citations littérales conservent toujours la langue d\'origine.',
        de: 'Die Prompt-Sprachen wachsen um Französisch und Türkisch: Ideen, Deep-Research-Berichte und Entwürfe aus der Schreibwerkstatt lassen sich jetzt auch in diesen Sprachen erzeugen. Wörtliche Zitate behalten stets die Originalsprache bei.',
        pt: 'Os idiomas dos prompts somam o francês e o turco: as ideias, os relatórios de Deep Research e os rascunhos da oficina podem também ser gerados nesses idiomas. As citações literais conservam sempre o idioma original.',
        'pt-BR': 'Os idiomas dos prompts ganham francês e turco: as ideias, os relatórios do Deep Research e os rascunhos da oficina podem ser gerados também nesses idiomas. As citações literais sempre preservam o idioma original.',
      },
      {
        scope: 'general',
        es: 'Corregido: los PDFs locales añadidos después del primer análisis vuelven a detectarse al sincronizar, en lugar de quedarse marcados como «sin texto» para siempre.',
        en: 'Fixed: local PDFs attached after a first scan are picked up again on sync instead of staying flagged as “no text” forever.',
        fr: 'Corrigé : les PDF locaux ajoutés après la première analyse sont de nouveau détectés lors de la synchronisation, au lieu de rester marqués comme «sans texte» pour toujours.',
        de: 'Behoben: Lokale PDFs, die nach der ersten Analyse hinzugefügt wurden, werden bei der Synchronisierung wieder erkannt, statt für immer als „ohne Text“ markiert zu bleiben.',
        pt: 'Corrigido: os PDF locais adicionados após a primeira análise voltam a ser detetados ao sincronizar, em vez de ficarem marcados como «sem texto» para sempre.',
        'pt-BR': 'Corrigido: os PDFs locais adicionados após a primeira análise voltam a ser detectados ao sincronizar, em vez de ficarem marcados como “sem texto” para sempre.',
      },
      {
        scope: 'general',
        es: 'Esta versión incluye la primera contribución externa al proyecto: el copiloto de LibreOffice, los paquetes de Linux y los nuevos idiomas nacen del trabajo de Oğuz Karayemiş (@oguzkarayemis). ¡Gracias!',
        en: 'This version includes the project’s first external contribution: the LibreOffice copilot, the Linux packages and the new languages grew from the work of Oğuz Karayemiş (@oguzkarayemis). Thank you!',
        fr: 'Cette version inclut la première contribution externe au projet : le copilote LibreOffice, les paquets Linux et les nouvelles langues sont nés du travail d\'Oğuz Karayemiş (@oguzkarayemis). Merci !',
        de: 'Diese Version enthält den ersten externen Beitrag zum Projekt: Der LibreOffice-Copilot, die Linux-Pakete und die neuen Sprachen entstanden aus der Arbeit von Oğuz Karayemiş (@oguzkarayemis). Vielen Dank!',
        pt: 'Esta versão inclui a primeira contribuição externa para o projeto: o copiloto do LibreOffice, os pacotes para Linux e os novos idiomas nasceram do trabalho de Oğuz Karayemiş (@oguzkarayemis). Obrigado!',
        'pt-BR': 'Esta versão inclui a primeira contribuição externa ao projeto: o copiloto do LibreOffice, os pacotes do Linux e os novos idiomas nasceram do trabalho de Oğuz Karayemiş (@oguzkarayemis). Obrigado!',
      },
    ],
  },
  {
    version: '1.7.5',
    date: '2026-07-11',
    highlights: [
      {
        scope: 'general',
        es: 'Los modelos locales (LM Studio / Ollama) con ventana de contexto pequeña ya no fallan en el asistente de investigación: la app ajusta automáticamente el contexto a la ventana del modelo para que siempre pueda responder.',
        en: 'Local models (LM Studio / Ollama) with a small context window no longer fail in the research assistant: the app now fits the context to the model’s window so it can always answer.',
        fr: 'Les modèles locaux (LM Studio / Ollama) dotés d\'une petite fenêtre de contexte ne provoquent plus d\'échec dans l\'assistant de recherche : l\'application ajuste désormais automatiquement le contexte à la fenêtre du modèle afin qu\'il puisse toujours répondre.',
        de: 'Lokale Modelle (LM Studio / Ollama) mit kleinem Kontextfenster schlagen im Recherche-Assistenten nicht mehr fehl: Die App passt den Kontext jetzt automatisch an das Fenster des Modells an, damit es immer antworten kann.',
        pt: 'Os modelos locais (LM Studio / Ollama) com uma janela de contexto pequena deixam de falhar no assistente de investigação: a aplicação ajusta agora automaticamente o contexto à janela do modelo para que possa sempre responder.',
        'pt-BR': 'Os modelos locais (LM Studio / Ollama) com janela de contexto pequena não falham mais no assistente de pesquisa: o app ajusta automaticamente o contexto à janela do modelo para que ele sempre possa responder.',
      },
      {
        scope: 'general',
        es: 'Las citas de los modelos locales se muestran correctamente como «Autor, Año» en lugar del identificador interno de la idea.',
        en: 'Citations from local models now render properly as “Author, Year” instead of the internal idea id.',
        fr: 'Les citations des modèles locaux s\'affichent désormais correctement sous la forme «Auteur, Année» au lieu de l\'identifiant interne de l\'idée.',
        de: 'Zitate lokaler Modelle werden jetzt korrekt als „Autor, Jahr“ angezeigt statt der internen Kennung der Idee.',
        pt: 'As citações dos modelos locais mostram-se corretamente como «Autor, Ano» em vez do identificador interno da ideia.',
        'pt-BR': 'As citações dos modelos locais agora aparecem corretamente como “Autor, Ano” em vez do identificador interno da ideia.',
      },
      {
        scope: 'general',
        es: 'El asistente de configuración muestra las colecciones como un árbol desplegable, para vigilar subcolecciones concretas cuando una colección es muy grande.',
        en: 'The setup wizard now shows collections as an expandable tree, so you can monitor specific subcollections when a collection is very large.',
        fr: 'L\'assistant de configuration affiche désormais les collections sous forme d\'arbre déroulant, pour surveiller des sous-collections précises lorsqu\'une collection est très volumineuse.',
        de: 'Der Einrichtungsassistent zeigt Sammlungen jetzt als aufklappbaren Baum an, um bei sehr großen Sammlungen gezielt einzelne Unterkollektionen zu überwachen.',
        pt: 'O assistente de configuração mostra as coleções como uma árvore expansível, para vigiar subcoleções específicas quando uma coleção é muito grande.',
        'pt-BR': 'O assistente de configuração exibe as coleções como uma árvore expansível, para monitorar subcoleções específicas quando uma coleção é muito grande.',
      },
    ],
  },
  {
    version: '1.7.4',
    date: '2026-07-11',
    highlights: [
      {
        scope: 'general',
        es: 'Inmersión estrena galería con vista de mosaico y de lista, y un botón «Nueva inmersión» con su propia ventana, igual que Deep Research.',
        en: 'Immersion has a new gallery with grid and list views, plus a “New immersion” button with its own dialog — just like Deep Research.',
        fr: 'Immersion inaugure une galerie avec vue en mosaïque et en liste, ainsi qu\'un bouton «Nouvelle immersion» avec sa propre fenêtre, tout comme Deep Research.',
        de: 'Immersion erhält eine neue Galerie mit Kachel- und Listenansicht sowie eine Schaltfläche „Neue Immersion“ mit eigenem Fenster, genau wie Deep Research.',
        pt: 'A Imersão estreia uma galeria com vista em mosaico e em lista, e um botão «Nova imersão» com a sua própria janela, tal como o Deep Research.',
        'pt-BR': 'Imersão estreia uma galeria com visualização em mosaico e em lista, e um botão “Nova imersão” com sua própria janela, assim como o Deep Research.',
      },
      {
        scope: 'general',
        es: 'Selección múltiple en Deep Research e Inmersión para eliminar varios elementos a la vez, con confirmación.',
        en: 'Multi-select in Deep Research and Immersion to delete several items at once, with confirmation.',
        fr: 'Sélection multiple dans Deep Research et Immersion pour supprimer plusieurs éléments à la fois, avec confirmation.',
        de: 'Mehrfachauswahl in Deep Research und Immersion, um mehrere Elemente gleichzeitig zu löschen, mit Bestätigung.',
        pt: 'Seleção múltipla no Deep Research e na Imersão para eliminar vários elementos de uma vez, com confirmação.',
        'pt-BR': 'Seleção múltipla no Deep Research e na Imersão para excluir vários itens de uma vez, com confirmação.',
      },
      {
        scope: 'general',
        es: 'Nuevo botón «Traducir»: genera con IA una traducción del informe o de la inmersión a cualquier idioma. Cada traducción se guarda para releerla, regenerarla o eliminarla.',
        en: 'New “Translate” button: generate an AI translation of a report or immersion into any language. Each translation is saved to reread, regenerate or delete.',
        fr: 'Nouveau bouton «Traduire» : génère avec l\'IA une traduction du rapport ou de l\'immersion dans n\'importe quelle langue. Chaque traduction est enregistrée pour être relue, régénérée ou supprimée.',
        de: 'Neue Schaltfläche „Übersetzen“: Erzeugt mit KI eine Übersetzung des Berichts oder der Immersion in jede beliebige Sprache. Jede Übersetzung wird gespeichert, um sie erneut zu lesen, neu zu erzeugen oder zu löschen.',
        pt: 'Novo botão «Traduzir»: gera com IA uma tradução do relatório ou da imersão para qualquer idioma. Cada tradução fica guardada para voltar a ler, regenerar ou eliminar.',
        'pt-BR': 'Novo botão “Traduzir”: gera com IA uma tradução do relatório ou da imersão para qualquer idioma. Cada tradução é salva para ser relida, regenerada ou excluída.',
      },
      {
        scope: 'general',
        es: 'Al actualizar la app verás esta ventana con las novedades y las correcciones.',
        en: 'After each update you’ll see this what’s-new window with the latest changes and fixes.',
        fr: 'Après chaque mise à jour de l\'application, vous verrez cette fenêtre avec les nouveautés et les corrections.',
        de: 'Nach jedem Update sehen Sie dieses Fenster mit den Neuigkeiten und Korrekturen.',
        pt: 'Ao atualizar a aplicação verá esta janela com as novidades e as correções.',
        'pt-BR': 'Ao atualizar o app, você verá esta janela com as novidades e as correções.',
      },
    ],
  },
  {
    version: '1.7.3',
    date: '2026-07-11',
    highlights: [
      {
        scope: 'general',
        es: 'La interfaz ya no se congela mientras se genera el audio de narración en Deep Research e Inmersión.',
        en: 'The interface no longer freezes while narration audio is generated in Deep Research and Immersion.',
        fr: 'L\'interface ne se fige plus pendant la génération de l\'audio de narration dans Deep Research et Immersion.',
        de: 'Die Oberfläche friert nicht mehr ein, während das Erzähl-Audio in Deep Research und Immersion generiert wird.',
        pt: 'A interface deixa de ficar bloqueada enquanto se gera o áudio de narração no Deep Research e na Imersão.',
        'pt-BR': 'A interface não trava mais enquanto o áudio de narração é gerado no Deep Research e na Imersão.',
      },
      {
        scope: 'general',
        es: 'Corregida la voz «Sharvard»: ahora aparece como voz masculina, que es la que el motor reproduce realmente.',
        en: 'Fixed the “Sharvard” voice: it now appears as a male voice, which is what the engine actually renders.',
        fr: 'Voix «Sharvard» corrigée : elle apparaît désormais comme une voix masculine, ce qui correspond à ce que le moteur reproduit réellement.',
        de: 'Stimme „Sharvard“ korrigiert: Sie erscheint jetzt als männliche Stimme, was der tatsächlichen Wiedergabe durch die Engine entspricht.',
        pt: 'Corrigida a voz «Sharvard»: aparece agora como voz masculina, que é a que o motor efetivamente reproduz.',
        'pt-BR': 'Corrigida a voz “Sharvard”: agora ela aparece como voz masculina, que é a que o motor realmente reproduz.',
      },
    ],
  },
];

/** Compare two dotted numeric versions. Returns >0 if a>b, <0 if a<b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Release notes strictly newer than `since` (a version string, or null for a
 *  fresh install), capped and newest-first, up to and including `current`. */
export function releaseNotesSince(since: string | null, current: string): ReleaseNote[] {
  return RELEASE_NOTES.filter(
    (note) =>
      compareVersions(note.version, current) <= 0 &&
      (since == null || compareVersions(note.version, since) > 0)
  );
}

/** Every published note from the same major version as `current`, capped at
 *  `current` and kept newest-first. Used by the update modal so each new build
 *  provides the complete context for its current product generation. */
export function releaseNotesForMajor(current: string): ReleaseNote[] {
  const currentMajor = Number.parseInt(current.split('.')[0] ?? '', 10);
  if (!Number.isFinite(currentMajor)) return [];

  return RELEASE_NOTES.filter((note) => {
    const noteMajor = Number.parseInt(note.version.split('.')[0] ?? '', 10);
    return noteMajor === currentMajor && compareVersions(note.version, current) <= 0;
  });
}
