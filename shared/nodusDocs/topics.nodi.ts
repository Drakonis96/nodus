import type { NodusDocTopic } from './types';

/** The Nodi companion: where it lives, its chat, its contexts and the chat skills. */
export const NODI_DOC_TOPICS: readonly NodusDocTopic[] = [
  {
    id: 'nodi-companion',
    area: 'nodi',
    title: { es: 'Nodi: dónde vive, menú radial y aspecto', en: 'Nodi: where it lives, radial menu and look' },
    keywords: ['nodi', 'mascota', 'companion', 'menu radial', 'orbita', 'orbe', 'traje', 'tamano de nodi', 'ventana flotante', 'siempre visible', 'cerrar mascota', 'arrastrar', 'quien soy'],
    body: {
      es: `- Nodi es el asistente integrado de Nodus. Vive en la esquina inferior derecha de la ventana o en su propia ventana flotante siempre visible sobre otras aplicaciones; se elige en Ajustes > Interfaz > Mascota Nodi.
- Al pulsarlo se abre el menú radial con: «¿Quién soy?» (burbuja de ayuda), «Notificaciones», «Chat» y «Notas rápidas». En la ventana flotante aparece además «Abrir Nodus», que trae la ventana principal al frente.
- En la ventana flotante se arrastra para moverlo por el escritorio; el clic derecho abre «Opciones de la mascota» con la única acción «Cerrar mascota» («Puedes volver a activarla desde Ajustes.»). Fuera de su figura, el ratón atraviesa la ventana transparente.
- Aspecto y tamaño: «Tamaño de Nodi» de 40 % a 100 %, «Aspecto de Nodi» clásico u orbe y, con el orbe, color automático según la bóveda activa o un color fijo a elegir. La elección de aspecto se ofrece una vez en un modal propio.
- Nodi muestra notificaciones no leídas con un contador y celebra la llegada de avisos y los cambios de bóveda.
- Sus ajustes propios están en Ajustes > Interfaz > Mascota Nodi; el panel de chat tiene además su propio selector de modelo.`,
      en: `- Nodi is the assistant built into Nodus. It lives in the bottom-right corner of the window or in its own floating window always visible above other applications; the choice is in Settings > Interface > Nodi mascot.
- Clicking it opens the radial menu with: "Who am I?" (help bubble), "Notifications", "Chat" and "Quick notes". In the floating window an extra "Open Nodus" brings the main window forward.
- In the floating window it is dragged around the desktop; right-click opens "Mascot options" with a single "Close mascot" action ("You can turn it back on from Settings."). Outside its figure, the mouse passes through the transparent window.
- Look and size: "Nodi size" from 40% to 100%, "Nodi appearance" classic or orb and, with the orb, a colour that follows the active vault or a fixed colour of your choice. The appearance choice is offered once in its own modal.
- Nodi shows unread notifications with a counter and celebrates arriving notices and vault switches.
- Its own settings live in Settings > Interface > Nodi mascot; the chat panel also has its own model picker.`,
    },
    related: ['nodi-chat', 'settings-interface'],
  },
  {
    id: 'nodi-chat',
    area: 'nodi',
    title: { es: 'Chat de Nodi: contextos, historial y citas', en: 'Nodi chat: contexts, history and citations' },
    keywords: ['chat de nodi', 'contextos', 'vista actual', 'boveda actual', 'todos los vaults', 'documentacion de nodus', 'historial de chats', 'nuevo chat', 'citar', 'cita', 'modelo del chat', 'notas rapidas', 'starter'],
    body: {
      es: `- El panel de chat tiene en su cabecera: título de la conversación, «Nuevo chat», «Historial de chats», «Contextos» (con contador), el control de Skills, «Ajustes de Nodi» y «Cerrar».
- Contextos seleccionables: «Documentación de Nodus» (funciones y rutas verificadas de la aplicación), «Vista actual» (el texto visible de la sección abierta o el documento completo en los lectores), «Bóveda actual» (recuperación semántica relevante, no la bóveda completa) y «Todos los vaults» (inventario transversal con conteos y elementos relevantes). Por defecto están activos Documentación de Nodus, Vista actual y Bóveda actual; «Todos los vaults» se activa a mano.
- Sin «Documentación de Nodus» activa, Nodi no tiene la guía de producto: para preguntas sobre cómo funciona la aplicación conviene activarla.
- Escribir y enviar: Intro envía, Mayús+Intro abre línea nueva; durante la respuesta aparece el botón de detener. Cada mensaje se puede copiar en Markdown.
- El historial guarda las conversaciones con título, bóveda y fecha, permite borrar una o «Borrar todo».
- Las respuestas del corpus académico pueden incluir citas con enlaces nodus:// y tarjetas de cita; en worldbuilding las citas abren la entrada del mundo. La cita de un fragmento del lector abre el chat con esa cita activada.
- El selector «Modelo» del panel elige el modelo solo para Nodi (por defecto usa el modelo de síntesis). La fila «Visible en la interfaz» permite mostrarlo u ocultarlo, y «Abrir ajustes de visibilidad» lleva a Ajustes > Interfaz.
- Hay preguntas de arranque sugeridas cuando el contexto de bóveda está activo y la conversación está vacía.`,
      en: `- The chat panel header holds: the conversation title, "New chat", "Chat history", "Contexts" (with a counter), the Skills control, "Nodi settings" and "Close".
- Selectable contexts: "Nodus documentation" (verified application features and routes), "Current view" (the visible text of the open section, or the whole document in readers), "Active vault" (relevant semantic retrieval, not the whole vault) and "All vaults" (a cross-vault inventory with counts and relevant items). By default Nodus documentation, Current view and Active vault are on; "All vaults" is opt-in.
- Without "Nodus documentation" enabled, Nodi has no product guide: enable it for questions about how the application works.
- Sending: Enter sends, Shift+Enter starts a new line; a stop button appears while answering. Every message can be copied as Markdown.
- The history keeps conversations with title, vault and date, and can delete one or "Delete all".
- Academic corpus answers can carry citations as nodus:// links and citation cards; in worldbuilding a citation opens the world entry. Quoting a reader excerpt opens the chat with that quote attached.
- The panel's "Model" picker sets Nodi's own model (it uses the synthesis model by default). The "Visible in the interface" row shows or hides it, and "Open visibility settings" goes to Settings > Interface.
- Suggested starter questions appear when a vault context is active and the conversation is empty.`,
    },
    related: ['nodi-skills', 'nodi-companion'],
  },
  {
    id: 'nodi-skills',
    area: 'nodi',
    title: { es: 'Skills: biblioteca, marketplace y activación', en: 'Skills: library, marketplace and activation' },
    keywords: ['skills', 'habilidades', 'skill', 'marketplace', 'instalar skill', 'desinstalar', 'activar skill', 'mis skills', 'plugins', 'capacidades', 'herramientas javascript', 'permisos', 'paquete', 'nodus-tool'],
    body: {
      es: `- Las skills son capacidades que se activan en cada chat. La biblioteca («Mis skills») se abre desde el icono de Skills de la cabecera («Skills y Marketplace»), desde la paleta («Mis skills» o «Marketplace») o desde el control de Skills dentro del chat.
- El control del chat activa y desactiva skills para esa superficie y esa conversación; el modal global es donde se instalan, crean, importan, exportan y configuran.
- Cada skill se activa por separado en el asistente (chat de la aplicación) y en Nodi: la misma skill puede estar activa en uno y no en el otro.
- Marketplace: se instalan skills y plugins desde el repositorio oficial de Nodus o desde fuentes comunitarias. Los plugins ejecutan código en un entorno aislado y piden permisos (conexiones HTTPS, credenciales y almacenamiento) que se revisan y aprueban en un diálogo antes de instalar o actualizar nada.
- Las skills pueden traer herramientas JavaScript propias: cada herramienta es una expresión de función que se ejecuta aislada, sin archivos, sin red y sin acceso a la aplicación, con cinco segundos como máximo. El modelo las invoca con un bloque nodus-tool y Nodus ejecuta y muestra el resultado.
- Las skills incluidas (SVG Studio, Image Atelier y Socratic Tutor, entre otras) también se pueden desinstalar y reinstalar desde el Marketplace; reinstalarlas restaura su versión de esta compilación.
- «Importar .md» y «Crear skill» permiten autoría propia; «Importar un paquete desde una carpeta» y «Restaurar skills iniciales» completan la gestión. Los archivos de skill están limitados a 40 KB.
- La generación de imágenes y las capacidades nativas solo están disponibles si la skill correspondiente está activa; sin ella Nodus no emite peticiones de imagen ni inventa URLs.`,
      en: `- Skills are capabilities switched on per chat. The library ("My skills") opens from the header Skills icon ("Skills and Marketplace"), from the palette ("My skills" or "Marketplace") or from the Skills control inside a chat.
- The in-chat control turns skills on and off for that surface and conversation; the global modal is where they are installed, created, imported, exported and configured.
- Each skill is activated separately for the assistant (in-app chat) and for Nodi: the same skill can be on in one and off in the other.
- Marketplace: skills and plugins install from the official Nodus repository or from community sources. Plugins run code in an isolated environment and request permissions (HTTPS connections, credentials and storage) that are reviewed and approved in a dialogue before anything installs or updates.
- Skills can carry their own JavaScript tools: each tool is a function expression that runs isolated, with no files, no network and no application access, for five seconds at most. The model invokes it with a nodus-tool block and Nodus runs it and shows the result.
- Built-in skills (SVG Studio, Image Atelier and Socratic Tutor, among others) can also be uninstalled and reinstalled from the Marketplace; reinstalling restores this build's version.
- "Import .md" and "Create skill" cover authoring your own; "Import a package from a folder" and "Restore default skills" complete the management. Skill files are limited to 40 KB.
- Image generation and native capabilities are only available while the matching skill is on; without it Nodus emits no image request and never invents a URL.`,
    },
    related: ['nodi-chat', 'toolkit-hub'],
  },
];
