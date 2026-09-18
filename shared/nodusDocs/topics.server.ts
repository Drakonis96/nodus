import type { NodusDocTopic } from './types';

/** Nodus Server, the local MCP server and the editor/connector integrations. */
export const SERVER_DOC_TOPICS: readonly NodusDocTopic[] = [
  {
    id: 'server-overview',
    area: 'server',
    title: { es: 'Nodus Server: publicar una copia filtrada de la bóveda', en: 'Nodus Server: publish a filtered copy of the vault' },
    keywords: ['servidor', 'nodus server', 'publicar', 'replica', 'conectado', 'cloudflare', 'docker', 'dominio', 'vault conectado', 'movil', 'solo lectura', 'espacio', 'outbox', 'bandeja'],
    body: {
      es: `- Nodus Server es infraestructura opcional que se configura en Ajustes > Servidor. Está marcado como experimental y pensado para testers. Cada bóveda se conecta por separado.
- Tres modos: «Cloudflare · recomendado» (despliegue con un botón y coste real en la propia guía), «Básico · este ordenador» (servidor local con acceso de red y opción de Tailscale, contraseña de administración, y las casillas de mantener el equipo despierto y seguir sirviendo al cerrar la tapa) y «Avanzado · Docker y dominio propio».
- Nodus publica por HTTPS saliente una copia lógica y filtrada: no abre un puerto entrante en el ordenador y no comparte listener, puerto ni token con el MCP local. Mientras Nodus está abierto mantiene la copia al día; el servidor puede servir la última copia publicada aunque el ordenador esté apagado.
- Qué se publica: siempre referencias, autores, temas, ideas, evidencias, conexiones y preguntas. Nunca PDF, audio, claves, contraseñas, rutas locales, datos del alumnado ni el archivo SQLite. Además hay interruptores para incluir contenido propio, pasajes extraídos, biblioteca y documentos, vectores semánticos, y —en Fuentes primarias y Testimonios— fuentes revisadas y testimonios textuales.
- La lista «Vaults conectados» muestra estado, URL, última publicación, última entrada de bandeja y acciones «Publicar ahora», «Administrar» y «Desconectar». El emparejamiento avanzado pide la dirección del servidor y un código temporal.
- El acceso remoto usa OAuth y permisos de lectura sobre los espacios asignados; una bóveda conectada como réplica puede ser de solo lectura, de escritura o propia, y con solo lectura lo que escribas se queda en este equipo.
- Lo que llega de otros dispositivos aparece en la Bandeja de la cabecera.
- El roadmap lista «Servidor» como Planificado: la infraestructura existe y es experimental, pero no debe presentarse como una función estable. Compartir vaults y el trabajo colaborativo no están disponibles.`,
      en: `- Nodus Server is optional infrastructure configured in Settings > Server. It is marked experimental and aimed at testers. Each vault connects separately.
- Three modes: "Cloudflare · recommended" (one-button deploy with its real cost stated in the guide), "Basic · this computer" (local server with network access and an optional Tailscale path, an admin password, and switches to keep the machine awake and keep serving on lid close) and "Advanced · Docker and your own domain".
- Nodus publishes a logical, filtered copy over outbound HTTPS: it opens no inbound port and shares no listener, port or token with the local MCP server. While Nodus is open the copy stays current; the server can serve the last published copy even when the machine is off.
- What is published: always references, authors, topics, ideas, evidence, connections and questions. Never PDFs, audio, keys, passwords, local paths, student data or the SQLite file. Switches add your own content, extracted passages, library and documents, semantic vectors and — in Primary sources and Testimonies — reviewed sources and textual testimonies.
- The "Connected vaults" list shows state, URL, last publish, last inbox entry and the actions "Publish now", "Manage" and "Disconnect". Advanced pairing asks for the server address and a one-time code.
- Remote access uses OAuth with read permissions over the assigned spaces; a connected replica vault can be read-only, writable or owned, and in read-only mode anything you write stays on this machine.
- What arrives from other devices shows up in the header Inbox.
- The roadmap lists "Server" as Planned: the infrastructure exists and is experimental, and must not be presented as a stable feature. Vault sharing and collaboration are not available.`,
    },
    related: ['general-inbox', 'privacy-server-publishing'],
  },
  {
    id: 'server-mcp',
    area: 'server',
    title: { es: 'Servidor MCP local y túnel de ChatGPT', en: 'Local MCP server and ChatGPT tunnel' },
    keywords: ['mcp', 'servidor mcp', 'model context protocol', 'claude', 'chatgpt', 'tunel', 'tunnel', 'token', 'puerto', '127.0.0.1', 'herramientas'],
    body: {
      es: `- El servidor MCP local se configura en Ajustes > Integraciones > Servidor MCP: «Activar servidor MCP», «Puerto local» (1024-65535; 4319 por defecto), estado («Activo», «Apagado» o «Error del servidor MCP»), «Ver datos de conexión» y «Regenerar token».
- Solo escucha en este ordenador (127.0.0.1): ChatGPT web no puede alcanzarlo directamente. Las herramientas de escritura están activas mientras el servidor esté encendido, y si se expone el servidor hay que proteger el token.
- MCP expone herramientas adecuadas al tipo de bóveda activo, además de herramientas generales; cambiar de bóveda cambia el contexto que esas herramientas consultan.
- Al regenerar el token, los clientes conectados deben reconectar con el nuevo («Token MCP regenerado. Reconecta los clientes con el nuevo token.»).
- El túnel de ChatGPT permite conectar ChatGPT con ese servidor local desde fuera. Requiere una clave de ejecución de OpenAI con permisos Tunnels Read y Use, un ID de túnel (empieza por tunnel_ y 32 caracteres) y un sistema operativo soportado; el cliente oficial se descarga y se verifica su integridad antes de ejecutarlo.
- Errores del túnel y su significado: «El ID debe empezar por tunnel_ y contener los 32 caracteres que muestra OpenAI.», «Falta la clave de ejecución de OpenAI.», «OpenAI rechazó la clave. Crea una clave de ejecución nueva y vuelve a pegarla.», «Tu cuenta necesita permisos Tunnels Read + Use en la organización de OpenAI.», «OpenAI no encuentra ese túnel en la organización asociada a la clave.», «La descarga no superó la comprobación de seguridad y no se ha ejecutado.», «Nodus no pudo conectar el túnel con su servidor MCP local.», «El cliente del túnel se detuvo. Pulsa Volver a conectar.» y «No se pudo completar la conexión. Abre el detalle técnico o inténtalo de nuevo.».
- No se deben pegar la clave de OpenAI ni el token MCP en el formulario de autenticación del túnel.`,
      en: `- The local MCP server is configured in Settings > Integrations > MCP server: "Enable MCP server", "Local port" (1024-65535; 4319 by default), state ("Active", "Off" or "MCP server error"), "View connection details" and "Regenerate token".
- It only listens on this computer (127.0.0.1): ChatGPT on the web cannot reach it directly. Write tools are active while the server is on, and exposing the server means protecting the token.
- MCP exposes tools suited to the active vault type plus general tools; switching vaults changes the context those tools read.
- Regenerating the token means connected clients must reconnect with the new one ("MCP token regenerated. Reconnect clients with the new token.").
- The ChatGPT tunnel connects ChatGPT to that local server from outside. It needs an OpenAI runtime key with Tunnels Read and Use permissions, a tunnel ID (starting with tunnel_ and 32 characters) and a supported operating system; the official client is downloaded and its integrity verified before running.
- Tunnel errors and their meaning: the ID must start with tunnel_; the OpenAI runtime key is missing; OpenAI rejected the key (create a new runtime key and paste it again); the account needs Tunnels Read + Use in the OpenAI organisation; OpenAI cannot find that tunnel in the key's organisation; the download failed its security check and was not run; Nodus could not connect the tunnel to its local MCP server; the tunnel client stopped (press Reconnect); and the connection could not be completed (open the technical detail or try again).
- Never paste the OpenAI key or the MCP token into the tunnel's authentication form.`,
    },
    related: ['server-overview', 'troubleshooting-server-mcp'],
  },
  {
    id: 'server-integrations',
    area: 'server',
    title: { es: 'Integraciones: Zotero, copilotos de escritura y conector de navegador', en: 'Integrations: Zotero, writing copilots and browser connector' },
    keywords: ['integraciones', 'zotero plugin', 'xpi', 'copilot', 'word', 'libreoffice', 'macro', 'conector', 'chrome', 'extension', 'emparejar', 'certificado', 'puerto 4321', 'puerto 4320'],
    body: {
      es: `- Ajustes > Integraciones reúne cuatro integraciones, además del MCP.
- Nodus para Zotero (beta): activa el servidor de Nodus para Zotero, fija su puerto (4321 por defecto), muestra el estado, «Guardar .xpi para Zotero», «Ver instrucciones de instalación», «Copiar token» y «Regenerar token». El .xpi se instala en Zotero como complemento.
- Copiloto de escritura (Word) (beta): «Activar Nodus Copilot para Word», generar el certificado, «Instalar/actualizar en Word» y «Regenerar token». Sirve en https://localhost (puerto 4320 por defecto).
- Copiloto de escritura (LibreOffice): «Instalar macro en LibreOffice» copia la macro nodus_copilot.py para usarla desde el editor.
- Nodus Research Connector: «Activar Nodus Research Connector», estado («Listo para emparejar»), instalación desde Chrome Web Store o descarga del ZIP, y «Revocar navegadores emparejados». El conector solo lee la pestaña activa cuando se pulsa su icono y no incorpora telemetría.`,
      en: `- Settings > Integrations gathers four integrations besides MCP.
- Nodus for Zotero (beta): enables the Nodus server for Zotero, sets its port (4321 by default), shows the state, and offers "Save .xpi for Zotero", "View installation instructions", "Copy token" and "Regenerate token". The .xpi installs in Zotero as an add-on.
- Writing copilot (Word) (beta): "Enable Nodus Copilot for Word", generate the certificate, "Install/update in Word" and "Regenerate token". It serves on https://localhost (port 4320 by default).
- Writing copilot (LibreOffice): "Install macro in LibreOffice" copies the nodus_copilot.py macro for use from the editor.
- Nodus Research Connector: "Enable Nodus Research Connector", its state ("Ready to pair"), installation from the Chrome Web Store or a ZIP download, and "Revoke paired browsers". The connector only reads the active tab when its icon is pressed and includes no telemetry.`,
    },
    related: ['sections-library', 'settings-overview'],
  },
];
