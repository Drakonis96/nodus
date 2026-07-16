// Human-facing "what's new" notes shown once after the app updates to a new
// version. Newest first. Each highlight is bilingual so the modal can follow the
// UI language. Keep these short and user-facing — they are product notes, not a
// changelog. Add a new entry at the top whenever the app version bumps.

import type { VaultType } from './vaultTypes';

export type ReleaseNoteScope = 'general' | VaultType;

export interface ReleaseHighlight {
  es: string;
  en: string;
  fr: string;
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
    version: '2.3.7',
    date: '2026-07-16',
    highlights: [
      {
        scope: 'genealogy',
        es: 'El árbol genealógico es más directo y expresivo: puedes desplazarte arrastrando, abrir la ficha lateral con un clic y centrar una persona con doble clic. Las ramas combinan los colores elegidos para ambos progenitores y resaltan en dorado la descendencia de la persona protagonista; también se distinguen las relaciones familiares y sociales iniciales.',
        en: 'The family tree is now more direct and expressive: drag to move around, open the side dossier with one click and centre a person with a double click. Branches blend the colours selected for both parents and highlight the focus person’s descendants in gold; initial family and social relationships are now distinguished too.',
        fr: 'L\'arbre généalogique est plus direct et plus expressif : vous pouvez vous déplacer en faisant glisser, ouvrir la fiche latérale d\'un clic et centrer une personne d\'un double clic. Les branches combinent les couleurs choisies pour les deux parents et mettent en évidence en doré la descendance de la personne protagoniste ; les liens de parenté et les relations sociales initiaux sont également distingués.',
      },
      {
        scope: 'genealogy',
        es: 'El timeline y el mapa de Genealogía estrenan filtros múltiples, tarjetas más claras, miniaturas y acceso a la ficha completa al pulsar una persona. Se han eliminado parpadeos y solapamientos, el mapa encuadra los puntos visibles y sus créditos se abren de forma segura en el navegador.',
        en: 'The Genealogy timeline and map now feature multi-select filters, clearer cards, thumbnails and full dossier access when a person is clicked. Flicker and layering issues are gone, the map fits the visible points and credit links open safely in the browser.',
        fr: 'La chronologie et la carte de Généalogie inaugurent des filtres multiples, des cartes plus claires, des miniatures et l\'accès à la fiche complète en cliquant sur une personne. Les scintillements et les chevauchements ont été éliminés, la carte cadre les points visibles et ses crédits s\'ouvrent en toute sécurité dans le navigateur.',
      },
      {
        scope: 'genealogy',
        es: 'El archivo genealógico reúne la creación de entradas en un único modal ordenado, admite cualquier tipo de adjunto e incorpora importación desde Zotero. Las fichas incluyen además un identificador nacional opcional que también participa en las búsquedas.',
        en: 'The genealogy archive now brings entry creation into one well-organised modal, accepts any attachment type and supports Zotero imports. Person dossiers also include an optional national identifier that is searchable throughout the vault.',
        fr: 'L\'archive généalogique réunit la création d\'entrées dans un seul modal ordonné, accepte tout type de pièce jointe et intègre l\'importation depuis Zotero. Les fiches incluent en outre un identifiant national facultatif qui participe également aux recherches.',
      },
      {
        scope: 'estudio',
        es: 'Los materiales de Estudio se pueden descargar, muestran el nombre de cada acción al pasar el ratón y aparecen correctamente dentro de sus cursos y asignaturas. Nodi, el chat y las herramientas de IA pueden utilizar el contenido ya indexado de imágenes, PDF y otros archivos.',
        en: 'Study materials can now be downloaded, reveal each action name on hover and appear correctly inside their assigned courses and subjects. Nodi, chat and AI tools can use the indexed content of images, PDFs and other files.',
        fr: 'Les matériaux d\'Étude peuvent être téléchargés, affichent le nom de chaque action au survol de la souris et apparaissent correctement dans leurs cours et matières. Nodi, le chat et les outils d\'IA peuvent utiliser le contenu déjà indexé des images, PDF et autres fichiers.',
      },
      {
        scope: 'estudio',
        es: 'Estudio incorpora Deep Research adaptado al aprendizaje y reutiliza el mismo motor, diseño y capacidades de grafo e ideas que las bóvedas académicas, manteniendo siempre separado el contenido de cada vault. El horario muestra nombres completos y el selector evita emojis duplicados.',
        en: 'Study now includes learning-focused Deep Research and reuses the same graph and ideas engine, design and capabilities as academic vaults, while keeping every vault’s content isolated. Timetable names remain readable and the picker no longer duplicates emoji.',
        fr: 'Étude intègre Deep Research adapté à l\'apprentissage et réutilise le même moteur, la même conception et les mêmes capacités de graphe et d\'idées que les espaces académiques, tout en gardant toujours séparé le contenu de chaque espace. L\'emploi du temps affiche les noms complets et le sélecteur évite les emojis en double.',
      },
      {
        scope: 'general',
        es: 'Los asistentes de creación de vaults Académico, Genealogía, Estudio y Bases de datos permiten elegir por separado el modelo de IA y el modelo de embeddings, tanto local como en la nube, y descargan el modelo local cuando es necesario.',
        en: 'The Academic, Genealogy, Study and Databases vault creation wizards now let you choose separate AI and embedding models, either local or cloud-based, and download a local model when needed.',
        fr: 'Les assistants de création des espaces Académique, Généalogie, Étude et Bases de données permettent de choisir séparément le modèle d\'IA et le modèle d\'embeddings, local ou dans le cloud, et téléchargent le modèle local si nécessaire.',
      },
      {
        scope: 'general',
        es: 'Nodi contrae y hace girar sus extremidades mientras piensa, cierra los ojos y recupera su postura con una animación fluida. También se puede arrastrar por toda la pantalla y cerrar desde su menú contextual con una despedida animada que respeta sus cosméticos.',
        en: 'Nodi contracts and spins its limbs while thinking, closes its eyes and smoothly returns to its normal pose. It can also be dragged across the full screen and dismissed from its context menu with an animated farewell that accounts for its cosmetics.',
        fr: 'Nodi contracte et fait tourner ses membres pendant qu\'il réfléchit, ferme les yeux et retrouve sa posture grâce à une animation fluide. Il peut également être déplacé sur tout l\'écran et fermé depuis son menu contextuel avec un adieu animé qui respecte ses cosmétiques.',
      },
      {
        scope: 'general',
        es: 'La interfaz conserva ahora el color de la bóveda activa al redimensionar el sidebar, iguala el tamaño de las tarjetas de creación y corrige superficies claras, botones, buscadores y desplegables. Los iconos de Novedades indican además su grupo al pasar el ratón.',
        en: 'The interface now keeps the active vault colour while resizing the sidebar, gives creation cards a consistent size and fixes light surfaces, buttons, search fields and dropdowns. What’s New icons also identify their group on hover.',
        fr: 'L\'interface conserve désormais la couleur de l\'espace actif lors du redimensionnement de la barre latérale, uniformise la taille des cartes de création et corrige les surfaces claires, les boutons, les champs de recherche et les menus déroulants. Les icônes de Nouveautés indiquent en outre leur groupe au survol de la souris.',
      },
      {
        scope: 'general',
        es: 'Al iniciar Nodus aparece una comprobación cinematográfica de actualizaciones que informa si ya tienes la última versión, si existe una nueva o si se produce un error. Muestra el progreso de descarga y permite instalar y reiniciar sin solaparse con el modal de novedades.',
        en: 'Nodus now performs a cinematic update check at startup, reporting whether you are up to date, a new version is available or an error occurred. It shows download progress and supports install-and-restart without overlapping the What’s New modal.',
        fr: 'Au démarrage de Nodus apparaît une vérification cinématographique des mises à jour qui indique si vous disposez déjà de la dernière version, si une nouvelle version existe ou si une erreur se produit. Elle affiche la progression du téléchargement et permet d\'installer et de redémarrer sans se superposer au modal des nouveautés.',
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
      },
      {
        scope: 'genealogy',
        es: 'La ficha de persona presenta Name variants, Kinship, Life events, Places, Documents, Evidence y Notes en bloques coherentes con Biography y Relations. Las variantes, los eventos y los lugares se añaden mediante modales limpios, con botones de tamaño uniforme.',
        en: 'The person dossier now presents Name variants, Kinship, Life events, Places, Documents, Evidence and Notes in sections consistent with Biography and Relations. Variants, events and places are added through clean modals with uniformly sized buttons.',
        fr: 'La fiche de personne présente Name variants, Kinship, Life events, Places, Documents, Evidence et Notes dans des blocs cohérents avec Biography et Relations. Les variantes, les événements et les lieux s\'ajoutent via des modales épurées, avec des boutons de taille uniforme.',
      },
      {
        scope: 'general',
        es: 'El icono renovado de Nodus se conserva también durante el arranque en frío de la aplicación, antes de que se cargue la bóveda activa.',
        en: 'The refreshed Nodus icon is now preserved during a cold application launch too, before the active vault has loaded.',
        fr: 'L\'icône renouvelée de Nodus est désormais également conservée pendant le démarrage à froid de l\'application, avant le chargement de l\'espace actif.',
      },
      {
        scope: 'general',
        es: 'El modal de novedades muestra ahora el historial completo de la versión principal instalada —por ejemplo, todas las versiones 2.x— en español o inglés. Cada cambio histórico incluye además el icono y el color de su bóveda, o el indicador general cuando afecta a toda la aplicación.',
        en: 'The What’s New modal now shows the complete history of the installed major version—for example, every 2.x release—in English or Spanish. Every historical change also includes its vault icon and colour, or the general indicator when it affects the whole application.',
        fr: 'Le modal des nouveautés affiche désormais l\'historique complet de la version principale installée — par exemple, toutes les versions 2.x — en espagnol ou en anglais. Chaque changement historique inclut en outre l\'icône et la couleur de son espace, ou l\'indicateur général lorsqu\'il concerne l\'ensemble de l\'application.',
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
      },
      {
        scope: 'genealogy',
        es: 'Las líneas horizontales del árbol se trazan únicamente por el espacio libre entre generaciones. Los nombres, las etiquetas de parentesco y las fechas cuentan además con un fondo protector para conservar siempre su legibilidad en modo claro y oscuro.',
        en: 'Horizontal tree lines are now routed exclusively through the free space between generations. Names, kinship labels and dates also have a protective background so they remain readable in both light and dark mode.',
        fr: 'Les lignes horizontales de l\'arbre ne passent désormais que par l\'espace libre entre les générations. Les noms, les étiquettes de lien de parenté et les dates disposent en outre d\'un fond protecteur pour toujours conserver leur lisibilité en mode clair et sombre.',
      },
      {
        scope: 'genealogy',
        es: 'El árbol incorpora un buscador que localiza personas por nombre, fechas o etiqueta de parentesco, incluso sin escribir los acentos. Las coincidencias quedan iluminadas y el resto del árbol permanece visible de forma atenuada para conservar el contexto familiar.',
        en: 'The tree now includes search across names, dates and kinship labels, with accent-insensitive matching. Matches are highlighted while the rest of the tree stays visible in a dimmed state to preserve family context.',
        fr: 'L\'arbre intègre un moteur de recherche qui localise les personnes par nom, dates ou étiquette de lien de parenté, même sans saisir les accents. Les correspondances sont mises en surbrillance et le reste de l\'arbre reste visible de façon atténuée pour conserver le contexte familial.',
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
      },
      {
        scope: 'genealogy',
        es: 'Cada persona muestra ahora una etiqueta de parentesco relativa a la persona protagonista del árbol: padres, hermanos, tíos, primos, sobrinos, abuelos, bisabuelos, tatarabuelos y sus equivalentes descendentes, entre otros. Las etiquetas se recalculan al cambiar el centro y también forman parte del contexto de Nodi y del asistente.',
        en: 'Every person now shows a kinship label relative to the tree’s focus person, including parents, siblings, uncles and aunts, cousins, nephews and nieces, grandparents, great-grandparents, great-great-grandparents and their descendant equivalents. Labels are recalculated when the focus changes and are also included in Nodi and assistant context.',
        fr: 'Chaque personne affiche désormais une étiquette de lien de parenté relative à la personne protagoniste de l\'arbre : parents, frères et sœurs, oncles et tantes, cousins, neveux et nièces, grands-parents, arrière-grands-parents, arrière-arrière-grands-parents et leurs équivalents descendants, entre autres. Les étiquettes sont recalculées lorsque le centre change et font également partie du contexte de Nodi et de l\'assistant.',
      },
      {
        scope: 'genealogy',
        es: 'Las relaciones familiares y sociales comparten una interfaz más limpia: cada bloque conserva su listado y ofrece un único botón para abrir un modal de alta o edición. Los selectores tienen buscador, admiten varias personas y las relaciones sociales permiten elegir uno o varios tipos preconfigurados en una sola operación.',
        en: 'Family and social relations now share a cleaner interface: each section keeps its persistent list and provides one button that opens an add or edit modal. Selectors include search, support multiple people, and social relations let you choose one or more predefined types in a single operation.',
        fr: 'Les relations familiales et sociales partagent une interface plus épurée : chaque bloc conserve sa liste et propose un bouton unique pour ouvrir un modal d\'ajout ou de modification. Les sélecteurs disposent d\'une recherche, prennent en charge plusieurs personnes, et les relations sociales permettent de choisir un ou plusieurs types préconfigurés en une seule opération.',
      },
      {
        scope: 'general',
        es: 'Se han pulido varios detalles de interfaz: la marca de Nodus conserva su margen al ocultar el sidebar, la primera persona del listado ya no queda tapada, los desplegables se muestran por encima de los modales sin solapar la lupa con el texto y el banner de apoyo evita duplicar el botón de PayPal.',
        en: 'Several interface details have been polished: the Nodus brand keeps its margin when the sidebar is hidden, the first person in the list is no longer clipped, dropdowns appear above modals without overlapping the search icon and text, and the support banner no longer duplicates the PayPal button.',
        fr: 'Plusieurs détails d\'interface ont été peaufinés : la marque Nodus conserve sa marge lorsque la barre latérale est masquée, la première personne de la liste n\'est plus masquée, les menus déroulants s\'affichent au-dessus des modales sans superposer la loupe au texte, et la bannière de soutien évite de dupliquer le bouton PayPal.',
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
      },
      {
        scope: 'genealogy',
        es: 'El panel derecho del árbol conserva todas las relaciones de la persona seleccionada para poder editarlas, invertirlas o eliminarlas. También avisa de fechas cronológicamente improbables sin bloquear los casos históricos que necesites documentar.',
        en: 'The tree sidebar now keeps every relationship for the selected person visible, so you can edit, reverse or delete it. It also warns about chronologically unlikely dates without blocking historical cases you need to document.',
        fr: 'Le panneau droit de l\'arbre conserve désormais toutes les relations de la personne sélectionnée afin de pouvoir les modifier, les inverser ou les supprimer. Il signale également les dates chronologiquement improbables sans bloquer les cas historiques que vous devez documenter.',
      },
      {
        scope: 'genealogy',
        es: 'El árbol coloca por defecto a los antepasados arriba y permite invertir la orientación. Se han corregido la disposición y las líneas de progenitores, hijos, hermanos y parejas, manteniendo compatibles las relaciones que ya existían.',
        en: 'The tree now places ancestors at the top by default and can optionally reverse its orientation. Parent, child, sibling and partner layout and connectors have been corrected while keeping existing relationships compatible.',
        fr: 'L\'arbre place désormais les ancêtres en haut par défaut et permet d\'inverser l\'orientation. La disposition et les lignes des parents, enfants, frères et sœurs et partenaires ont été corrigées, tout en conservant la compatibilité avec les relations déjà existantes.',
      },
      {
        scope: 'general',
        es: 'El modal de novedades identifica visualmente cada cambio: los cambios generales usan un icono neutro y los específicos de una bóveda muestran su color e icono correspondientes, tanto en modo claro como oscuro.',
        en: 'The What’s New modal now identifies every change visually: general changes use a neutral icon, while vault-specific changes show the corresponding colour and icon in both light and dark mode.',
        fr: 'Le modal des nouveautés identifie désormais visuellement chaque changement : les changements généraux utilisent une icône neutre et ceux spécifiques à un espace affichent leur couleur et leur icône correspondantes, en mode clair comme en mode sombre.',
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
      },
      {
        scope: 'general',
        es: 'Nodus vuelve a detectar el modelo con el que se creó el índice de cada workspace. Si tus embeddings se generaron, por ejemplo, con BGE-M3 mediante OpenRouter, ese modelo reaparece seleccionado sin borrar ni reindexar ningún vector.',
        en: 'Nodus now detects the model used to build each workspace index again. If your embeddings were generated, for example, with BGE-M3 through OpenRouter, that model is selected again without deleting or reindexing any vectors.',
        fr: 'Nodus détecte à nouveau le modèle avec lequel l\'index de chaque espace de travail a été créé. Si vos embeddings ont été générés, par exemple, avec BGE-M3 via OpenRouter, ce modèle réapparaît sélectionné sans supprimer ni réindexer aucun vecteur.',
      },
      {
        scope: 'general',
        es: 'También se recuperan los modelos destacados y las selecciones por tarea conservadas antes de la migración. El modo básico o avanzado y el modelo de embeddings vuelven a pertenecer a cada workspace, evitando que uno sobrescriba la configuración de otro.',
        en: 'Favorite models and per-task selections preserved before the migration are recovered too. Basic or advanced mode and the embedding model belong to each workspace again, preventing one workspace from overwriting another.',
        fr: 'Les modèles favoris et les sélections par tâche conservées avant la migration sont également récupérés. Le mode basique ou avancé et le modèle d\'embeddings appartiennent à nouveau à chaque espace de travail, évitant qu\'un espace n\'écrase la configuration d\'un autre.',
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
      },
      {
        scope: 'general',
        es: 'En macOS puede aparecer una solicitud del Llavero durante la recuperación. Comprueba que corresponde a Nodus y selecciona «Permitir siempre»; si la cerraste, puedes repetir la recuperación desde Ajustes → Proveedores.',
        en: 'On macOS, Keychain may ask for permission during recovery. Check that the request belongs to Nodus and choose “Always Allow”; if you dismissed it, retry from Settings → Providers.',
        fr: 'Sur macOS, une demande du Trousseau peut apparaître pendant la récupération. Vérifiez qu\'elle provient bien de Nodus et sélectionnez «Toujours autoriser» ; si vous l\'avez fermée, vous pouvez relancer la récupération depuis Paramètres → Fournisseurs.',
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
      },
      {
        scope: 'estudio',
        es: 'Zotero se integra más a fondo: las bóvedas pueden usar bibliotecas de grupo y, desde cursos o materiales, buscar un elemento y decidir si importar su adjunto a Nodus o mantener un enlace que lo abra en Zotero.',
        en: 'Zotero integration goes deeper: vaults can use group libraries and, from courses or materials, search for an item and choose whether to import its attachment into Nodus or keep a link that opens it in Zotero.',
        fr: 'L\'intégration de Zotero va plus loin : les espaces peuvent utiliser des bibliothèques de groupe et, depuis les cours ou les matériaux, rechercher un élément et choisir d\'importer sa pièce jointe dans Nodus ou de conserver un lien qui l\'ouvre dans Zotero.',
      },
      {
        scope: 'general',
        es: 'Groq y Cerebras se incorporan como proveedores de IA, con carga de modelos cuando el proveedor la permite. La configuración básica y avanzada ahora avisa antes de cambiar de modo para evitar dejar modelos sin configurar por accidente.',
        en: 'Groq and Cerebras join the AI providers, with model discovery whenever the provider supports it. Basic and advanced setup now asks for confirmation before switching modes, preventing accidental incomplete model configurations.',
        fr: 'Groq et Cerebras rejoignent les fournisseurs d\'IA, avec chargement des modèles lorsque le fournisseur le permet. La configuration basique et avancée avertit désormais avant de changer de mode, afin d\'éviter de laisser des modèles non configurés par accident.',
      },
      {
        scope: 'general',
        es: 'Los modelos locales son más sencillos de usar: puedes descargar, seleccionar y eliminar modelos integrados para distintas tareas y, si uno necesita un motor previo, Nodus lo instala automáticamente antes de iniciar la descarga.',
        en: 'Local models are easier to use: download, select and remove integrated models for different tasks, and when a model requires an engine first, Nodus installs it automatically before starting the download.',
        fr: 'Les modèles locaux sont plus simples à utiliser : vous pouvez télécharger, sélectionner et supprimer des modèles intégrés pour différentes tâches et, si l\'un d\'eux nécessite un moteur préalable, Nodus l\'installe automatiquement avant de démarrer le téléchargement.',
      },
      {
        scope: 'general',
        es: 'Nueva guía esencial cinematográfica protagonizada por Nodi para entender bóvedas, proveedores, modelos, embeddings y voz. Nodi se presenta al final, permanece más tranquilo durante el recorrido y no se superpone con su versión real.',
        en: 'A new cinematic essential guide starring Nodi explains vaults, providers, models, embeddings and speech. Nodi is introduced at the end, stays calmer throughout the tour and no longer overlaps with the live companion.',
        fr: 'Nouveau guide essentiel cinématographique mettant en vedette Nodi pour comprendre les espaces, les fournisseurs, les modèles, les embeddings et la voix. Nodi se présente à la fin, reste plus calme pendant la visite et ne se superpose plus à sa version réelle.',
      },
      {
        scope: 'general',
        es: 'Nuevo sistema de recuperación total: Nodus protege automáticamente todas tus bóvedas, documentos, ajustes, historiales, archivos y claves en snapshots cifrados dentro de una carpeta segura. Incluye clave de recuperación y un asistente de migración para instalaciones anteriores, compatible con carpetas sincronizadas por Google Drive, Dropbox, iCloud y servicios similares.',
        en: 'A new complete recovery system automatically protects every vault, document, setting, history, file and key in encrypted snapshots inside a safe folder. It includes a recovery key and a migration assistant for previous installations, compatible with folders synchronized by Google Drive, Dropbox, iCloud and similar services.',
        fr: 'Nouveau système de récupération totale : Nodus protège automatiquement tous vos espaces, documents, paramètres, historiques, fichiers et clés dans des snapshots chiffrés au sein d\'un dossier sécurisé. Il inclut une clé de récupération et un assistant de migration pour les installations antérieures, compatible avec les dossiers synchronisés par Google Drive, Dropbox, iCloud et services similaires.',
      },
      {
        scope: 'general',
        es: 'Las demos de los modos Académico, Genealogía, Bases de datos y Estudio se han ampliado para que ninguna sección empiece vacía: incluyen carpetas, notas, materiales, conversaciones, informes y ejemplos conectados que puedes explorar y eliminar después.',
        en: 'The Academic, Genealogy, Databases and Study demos have been expanded so no section starts empty: they include folders, notes, materials, conversations, reports and connected examples that you can explore and remove afterwards.',
        fr: 'Les démos des modes Académique, Généalogie, Bases de données et Étude ont été enrichies pour qu\'aucune section ne commence vide : elles incluent des dossiers, des notes, des matériaux, des conversations, des rapports et des exemples reliés que vous pouvez explorer puis supprimer.',
      },
      {
        scope: 'general',
        es: 'Nodi cierra correctamente su menú, chat y paneles al hacer clic fuera. También mejoran la experiencia flotante, las animaciones del tutorial y el comportamiento del icono de la app, que conserva el aspecto de la bóveda y el tema activos al cerrar.',
        en: 'Nodi now closes its menu, chat and panels correctly when you click elsewhere. The floating experience and tutorial animations are improved too, and the app icon now keeps the active vault and theme appearance after quitting.',
        fr: 'Nodi ferme désormais correctement son menu, son chat et ses panneaux lors d\'un clic à l\'extérieur. L\'expérience flottante, les animations du tutoriel et le comportement de l\'icône de l\'application s\'améliorent également : elle conserve l\'apparence de l\'espace et du thème actifs à la fermeture.',
      },
      {
        scope: 'general',
        es: 'La navegación lateral se siente más consistente: la marca de Nodus permanece centrada al redimensionar el menú y toda su cabecera permite mostrarlo u ocultarlo.',
        en: 'Sidebar navigation now feels more consistent: the Nodus brand stays centered as the menu is resized, and its entire header can show or hide it.',
        fr: 'La navigation latérale paraît plus cohérente : la marque Nodus reste centrée lors du redimensionnement du menu et l\'ensemble de son en-tête permet de l\'afficher ou de le masquer.',
      },
      {
        scope: 'general',
        es: 'El panel de novedades estrena una presentación cinematográfica con Nodi celebrando, versiones y cambios claramente visibles en modo claro y oscuro, además de una sección opcional para apoyar el proyecto open source mediante PayPal.',
        en: 'The What’s New panel now has a cinematic presentation with Nodi celebrating, versions and changes clearly visible in light and dark mode, plus an optional section to support the open-source project through PayPal.',
        fr: 'Le panneau des nouveautés inaugure une présentation cinématographique avec Nodi qui célèbre, des versions et des changements clairement visibles en mode clair et sombre, ainsi qu\'une section optionnelle pour soutenir le projet open source via PayPal.',
      },
    ],
  },
  {
    version: '2.2.0',
    date: '2026-07-13',
    highlights: [
      {
        scope: 'general',
        es: 'Te presentamos a Nodi, la nueva mascota de Nodus: un nodo de luz que te acompaña flotando abajo a la derecha. Puedes arrastrarlo por la ventana y activarlo o desactivarlo desde Ajustes → Interfaz.',
        en: 'Meet Nodi, Nodus’s new mascot: a little node of light that keeps you company, floating at the bottom right. Drag it around the window, and switch it on or off in Settings → Interface.',
        fr: 'Nous vous présentons Nodi, la nouvelle mascotte de Nodus : un nœud de lumière qui vous accompagne en flottant en bas à droite. Vous pouvez le faire glisser dans la fenêtre et l\'activer ou le désactiver depuis Paramètres → Interface.',
      },
      {
        scope: 'general',
        es: 'Haz clic en Nodi para abrir su menú: un chat con la IA que conoce Nodus y tu configuración, un centro de notificaciones (te avisa con un punto rojo y levantando la mano) y una ayuda rápida. Además, Nodi cambia de traje según el modo de la bóveda (académico, genealogía, bases de datos), algo que puedes desactivar si prefieres el Nodi de siempre.',
        en: 'Click Nodi to open its menu: a chat with an AI that knows Nodus and your setup, a notification center (it flags unread items with a red dot and a raised hand) and quick help. Nodi even changes outfit to match the vault mode (academic, genealogy, databases) — which you can turn off if you prefer the plain Nodi.',
        fr: 'Cliquez sur Nodi pour ouvrir son menu : un chat avec l\'IA qui connaît Nodus et votre configuration, un centre de notifications (il vous prévient avec un point rouge et en levant la main) et une aide rapide. De plus, Nodi change de tenue selon le mode de l\'espace (académique, généalogie, bases de données), ce que vous pouvez désactiver si vous préférez le Nodi habituel.',
      },
      {
        scope: 'general',
        es: 'Si quieres, Nodi puede vivir en una pequeña ventana flotante del escritorio, siempre por encima del resto de aplicaciones —incluso a pantalla completa—, para tenerlo a mano sin cambiar de app.',
        en: 'If you like, Nodi can live in a small floating desktop window, always on top of your other apps — even in fullscreen — so it’s always within reach without switching apps.',
        fr: 'Si vous le souhaitez, Nodi peut vivre dans une petite fenêtre flottante du bureau, toujours au-dessus des autres applications — même en plein écran — pour l\'avoir à portée de main sans changer d\'application.',
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
      },
      {
        scope: 'general',
        es: 'Como las bóvedas comparten claves y modelos, hemos retirado el aviso de «cargar claves de API desde otra bóveda»: ya no hacía falta.',
        en: 'Since vaults share keys and models, we removed the “load API keys from another vault” prompt — it was no longer needed.',
        fr: 'Les espaces partageant désormais les clés et les modèles, nous avons retiré l\'avertissement «charger les clés d\'API depuis un autre espace» : il n\'était plus nécessaire.',
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
      },
      {
        scope: 'databases',
        es: 'Columnas con IA: deja que la IA rellene una columna entera a partir del resto de la fila, ya sea con texto (resúmenes, clasificaciones, traducciones) o con imágenes generadas. Y un chat integrado responde preguntas sobre los datos de tu tabla.',
        en: 'AI columns: let the AI fill an entire column from the rest of the row — either with text (summaries, classifications, translations) or with generated images. And a built-in chat answers questions about your table’s data.',
        fr: 'Colonnes avec IA : laissez l\'IA remplir une colonne entière à partir du reste de la ligne, que ce soit avec du texte (résumés, classifications, traductions) ou des images générées. Et un chat intégré répond aux questions sur les données de votre tableau.',
      },
      {
        scope: 'databases',
        es: 'Análisis estadístico honesto: la IA propone los análisis adecuados sobre tus columnas reales (correlaciones, chi-cuadrado, ANOVA, regresión) y la app los calcula de forma determinista, con gráficos nativos —mapas de calor, dispersión y diagramas de caja—. La IA planifica; el motor calcula, sin inventar cifras.',
        en: 'Honest statistical analysis: the AI proposes the right analyses over your real columns (correlations, chi-square, ANOVA, regression) and the app computes them deterministically, with native charts — heatmaps, scatter plots and box plots. The AI plans; the engine computes, with no made-up numbers.',
        fr: 'Analyse statistique honnête : l\'IA propose les analyses adaptées à vos colonnes réelles (corrélations, chi carré, ANOVA, régression) et l\'application les calcule de façon déterministe, avec des graphiques natifs — cartes de chaleur, nuages de points et diagrammes en boîte. L\'IA planifie ; le moteur calcule, sans inventer de chiffres.',
      },
      {
        scope: 'genealogy',
        es: 'El Archivo de Genealogía se reconstruye como una cuadrícula editable al estilo de las bases de datos: edita cada celda al momento, asigna documentos a varias carpetas a la vez y clasifícalos con una taxonomía de más de 190 tipos de documento patrimonial, con búsqueda inteligente y filtros por faceta.',
        en: 'The Genealogy Archive is rebuilt as an editable database-style grid: edit each cell inline, file documents into several folders at once, and classify them with a taxonomy of 190+ heritage document types, complete with smart search and facet filters.',
        fr: 'L\'Archive de Généalogie est reconstruite sous forme de grille modifiable façon bases de données : modifiez chaque cellule instantanément, assignez des documents à plusieurs dossiers à la fois et classez-les grâce à une taxonomie de plus de 190 types de documents patrimoniaux, avec recherche intelligente et filtres par facette.',
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
      },
      {
        scope: 'genealogy',
        es: 'En las fichas de persona, los botones de editar y eliminar de las relaciones sociales pasan a ser iconos, y el panel de «Ajustar encuadre» del retrato se cierra al hacer clic fuera y ya no queda descuadrado.',
        en: 'In the person dossier, the edit and delete buttons of social relations are now icons, and the portrait “Adjust framing” panel closes on an outside click and is no longer misaligned.',
        fr: 'Dans les fiches de personne, les boutons de modification et de suppression des relations sociales deviennent des icônes, et le panneau «Ajuster le cadrage» du portrait se ferme lors d\'un clic à l\'extérieur et n\'est plus désaligné.',
      },
      {
        scope: 'general',
        es: 'Corregida la ventana de novedades: ahora aparece correctamente al actualizar y recupera los cambios de la versión 2.0.0 si te los perdiste.',
        en: 'Fixed the what’s-new window: it now appears correctly after updating and recovers the 2.0.0 changes if you missed them.',
        fr: 'Fenêtre des nouveautés corrigée : elle apparaît désormais correctement lors de la mise à jour et récupère les changements de la version 2.0.0 si vous les avez manqués.',
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
      },
      {
        scope: 'genealogy',
        es: 'Nuevo modo Genealogía: reconstruye historia familiar a partir de fuentes primarias con fichas de persona, árbol genealógico, cronología, archivo de evidencia y un mapa real. El asistente actúa como genealogista y propone parentescos a partir de la evidencia, siguiendo el estándar de prueba genealógico.',
        en: 'New Genealogy mode: reconstruct family history from primary sources with person dossiers, a family tree, a timeline, an evidence archive and a real map. The assistant acts as a genealogist and proposes kinship from the evidence, following the genealogical proof standard.',
        fr: 'Nouveau mode Généalogie : reconstituez l\'histoire familiale à partir de sources primaires grâce à des fiches de personne, un arbre généalogique, une chronologie, une archive de preuves et une carte réelle. L\'assistant agit comme un généalogiste et propose des liens de parenté à partir des preuves, en suivant la norme de preuve généalogique.',
      },
      {
        scope: 'genealogy',
        es: 'Relaciones sociales: una segunda red, independiente del parentesco, para amistades, patronazgo, empleo, rivalidades y correspondencia — el material del historiador social y prosopográfico.',
        en: 'Social relations: a second network, independent from kinship, for friendships, patronage, employment, rivalries and correspondence — the material of the social and prosopographical historian.',
        fr: 'Relations sociales : un second réseau, indépendant du lien de parenté, pour les amitiés, le patronage, l\'emploi, les rivalités et la correspondance — la matière de l\'historien social et prosopographique.',
      },
      {
        scope: 'genealogy',
        es: 'Deep Research aprende genealogía: compone un informe de historia familiar sobre el archivo indexado por embeddings y la biblioteca. La cabecera muestra ahora el modo de la bóveda activa en su color de acento.',
        en: 'Deep Research learns genealogy: it composes a family-history report over the embedding-indexed archive and library. The header now shows the active vault’s mode in its accent colour.',
        fr: 'Deep Research apprend la généalogie : il compose un rapport d\'histoire familiale à partir de l\'archive indexée par embeddings et de la bibliothèque. L\'en-tête affiche désormais le mode de l\'espace actif dans sa couleur d\'accent.',
      },
      {
        scope: 'general',
        es: 'Copias de seguridad multi-bóveda: el sistema de respaldos automáticos cifrados abarca ahora todas tus bóvedas con rotación por generaciones.',
        en: 'Multi-vault backups: the automatic encrypted backup system now covers all your vaults with generational rotation.',
        fr: 'Sauvegardes multi-espaces : le système de sauvegardes automatiques chiffrées couvre désormais tous vos espaces avec rotation par générations.',
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
      },
      {
        scope: 'general',
        es: 'Nodus llega a Linux: cada release publica ahora instaladores .deb y AppImage, y la app hereda el tema del cursor del sistema en Wayland.',
        en: 'Nodus lands on Linux: every release now ships .deb and AppImage installers, and the app inherits the system cursor theme on Wayland.',
        fr: 'Nodus arrive sur Linux : chaque version publie désormais des installateurs .deb et AppImage, et l\'application hérite du thème du curseur du système sous Wayland.',
      },
      {
        scope: 'general',
        es: 'Los idiomas de los prompts suman francés y turco: las ideas, los informes de Deep Research y los borradores del taller pueden generarse también en esos idiomas. Las citas literales siempre conservan el idioma original.',
        en: 'Prompt languages now include French and Turkish: ideas, Deep Research reports and workshop drafts can also be generated in those languages. Verbatim quotes always keep the source language.',
        fr: 'Les langues des prompts s\'enrichissent du français et du turc : les idées, les rapports de Deep Research et les brouillons de l\'atelier peuvent désormais être générés dans ces langues également. Les citations littérales conservent toujours la langue d\'origine.',
      },
      {
        scope: 'general',
        es: 'Corregido: los PDFs locales añadidos después del primer análisis vuelven a detectarse al sincronizar, en lugar de quedarse marcados como «sin texto» para siempre.',
        en: 'Fixed: local PDFs attached after a first scan are picked up again on sync instead of staying flagged as “no text” forever.',
        fr: 'Corrigé : les PDF locaux ajoutés après la première analyse sont de nouveau détectés lors de la synchronisation, au lieu de rester marqués comme «sans texte» pour toujours.',
      },
      {
        scope: 'general',
        es: 'Esta versión incluye la primera contribución externa al proyecto: el copiloto de LibreOffice, los paquetes de Linux y los nuevos idiomas nacen del trabajo de Oğuz Karayemiş (@oguzkarayemis). ¡Gracias!',
        en: 'This version includes the project’s first external contribution: the LibreOffice copilot, the Linux packages and the new languages grew from the work of Oğuz Karayemiş (@oguzkarayemis). Thank you!',
        fr: 'Cette version inclut la première contribution externe au projet : le copilote LibreOffice, les paquets Linux et les nouvelles langues sont nés du travail d\'Oğuz Karayemiş (@oguzkarayemis). Merci !',
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
      },
      {
        scope: 'general',
        es: 'Las citas de los modelos locales se muestran correctamente como «Autor, Año» en lugar del identificador interno de la idea.',
        en: 'Citations from local models now render properly as “Author, Year” instead of the internal idea id.',
        fr: 'Les citations des modèles locaux s\'affichent désormais correctement sous la forme «Auteur, Année» au lieu de l\'identifiant interne de l\'idée.',
      },
      {
        scope: 'general',
        es: 'El asistente de configuración muestra las colecciones como un árbol desplegable, para vigilar subcolecciones concretas cuando una colección es muy grande.',
        en: 'The setup wizard now shows collections as an expandable tree, so you can monitor specific subcollections when a collection is very large.',
        fr: 'L\'assistant de configuration affiche désormais les collections sous forme d\'arbre déroulant, pour surveiller des sous-collections précises lorsqu\'une collection est très volumineuse.',
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
      },
      {
        scope: 'general',
        es: 'Selección múltiple en Deep Research e Inmersión para eliminar varios elementos a la vez, con confirmación.',
        en: 'Multi-select in Deep Research and Immersion to delete several items at once, with confirmation.',
        fr: 'Sélection multiple dans Deep Research et Immersion pour supprimer plusieurs éléments à la fois, avec confirmation.',
      },
      {
        scope: 'general',
        es: 'Nuevo botón «Traducir»: genera con IA una traducción del informe o de la inmersión a cualquier idioma. Cada traducción se guarda para releerla, regenerarla o eliminarla.',
        en: 'New “Translate” button: generate an AI translation of a report or immersion into any language. Each translation is saved to reread, regenerate or delete.',
        fr: 'Nouveau bouton «Traduire» : génère avec l\'IA une traduction du rapport ou de l\'immersion dans n\'importe quelle langue. Chaque traduction est enregistrée pour être relue, régénérée ou supprimée.',
      },
      {
        scope: 'general',
        es: 'Al actualizar la app verás esta ventana con las novedades y las correcciones.',
        en: 'After each update you’ll see this what’s-new window with the latest changes and fixes.',
        fr: 'Après chaque mise à jour de l\'application, vous verrez cette fenêtre avec les nouveautés et les corrections.',
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
      },
      {
        scope: 'general',
        es: 'Corregida la voz «Sharvard»: ahora aparece como voz masculina, que es la que el motor reproduce realmente.',
        en: 'Fixed the “Sharvard” voice: it now appears as a male voice, which is what the engine actually renders.',
        fr: 'Voix «Sharvard» corrigée : elle apparaît désormais comme une voix masculine, ce qui correspond à ce que le moteur reproduit réellement.',
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
