import type { NodusDocTopic } from './types';

/** Privacy: what leaves the machine, what never does, and what the server publishes. */
export const PRIVACY_DOC_TOPICS: readonly NodusDocTopic[] = [
  {
    id: 'privacy-what-is-sent',
    area: 'privacy',
    title: { es: 'Qué sale del equipo y qué no', en: 'What leaves the machine and what never does' },
    keywords: ['privacidad', 'que se envia', 'datos', 'se suben mis documentos', 'nube', 'confidencial', 'gdpr', 'rgpd', 'sin telemetria', 'sin cuenta', 'open source', 'vision', 'ocr remoto', 'zotero', 'unpaywall'],
    body: {
      es: `- Nodus no requiere cuenta, no incluye publicidad ni telemetría y no envía contenido a un servicio en la nube del proyecto. Todo se guarda en el dispositivo salvo que se activen funciones remotas.
- Proveedores de IA, imagen, voz y transcripción en la nube: se envían las peticiones, fragmentos, imágenes, audio o texto necesarios para la petición del usuario. Con modelos locales no hay ese envío: nada sale del equipo.
- La revisión pública de imágenes (capacidad de visión) envía solo miniaturas acotadas de imágenes públicas con metadatos seguros; nunca archivos privados ni datos del alumnado.
- OCR asistido con un modelo remoto: se envían las imágenes de las páginas. Con un modelo local, se quedan en el equipo. Abrir, leer, subrayar o anotar un documento no invoca a ningún modelo por sí solo.
- Zotero: se consultan las bibliotecas y los archivos autorizados. Identificadores (Crossref, Open Library, NCBI, arXiv) y Unpaywall: se envía el identificador seleccionado y el correo configurado, en una operación limitada y cancelable.
- Instalaciones y comprobaciones: el conector de navegador solo lee la pestaña activa al pulsar su icono y guarda su secreto de emparejamiento en Chrome; los avisos de Nodus consultan un archivo público cada cuatro horas (desactivable) sin identificadores; las actualizaciones, las incidencias y el cliente del túnel se descargan de GitHub; los modelos, voces y runtimes de Hugging Face.
- El túnel MCP de OpenAI envía a ChatGPT las peticiones y resultados de herramientas, que pueden contener fragmentos, metadatos y contenido de la bóveda activa; su clave se guarda en el almacén del sistema y no entra en las copias.
- Nodus Server publica una proyección filtrada (ver su ficha); no envía el SQLite, ni claves, ni contraseñas, ni rutas locales, ni los PDF.
- La política completa está en Ajustes > Acerca de Nodus Research > «Leer política de privacidad», con el archivo en GitHub y la explicación de cumplimiento del RGPD.`,
      en: `- Nodus needs no account, contains no advertising and no telemetry, and sends no content to a project-run cloud service. Everything is stored on the device unless remote features are enabled.
- Cloud AI, image, voice and transcription providers receive the requests, fragments, images, audio or text needed for the user's request. With local models there is no such submission: nothing leaves the machine.
- Public image review (the vision capability) sends only bounded thumbnails of public images with safe metadata; never private files or student data.
- AI-assisted OCR with a remote model sends each page's images. With a local model they stay on the machine. Opening, reading, highlighting or annotating a document invokes no model by itself.
- Zotero: authorised libraries and files are queried. Identifiers (Crossref, Open Library, NCBI, arXiv) and Unpaywall: the selected identifier and the configured email are sent, in a bounded, cancellable operation.
- Installations and checks: the browser connector only reads the active tab when its icon is pressed and keeps its pairing secret in Chrome; Nodus notices fetch a public file every four hours (switchable off) with no identifiers; updates, issues and the tunnel client download from GitHub; models, voices and runtimes from Hugging Face.
- The OpenAI MCP tunnel sends ChatGPT tool requests and results, which may contain fragments, metadata and active vault content; its key is kept in the system's secure store and never enters backups.
- Nodus Server publishes a filtered projection (see its sheet); it never sends the SQLite file, keys, passwords, local paths or the PDFs.
- The full policy lives in Settings > About Nodus Research > "Read privacy policy", with its archive on GitHub and the GDPR compliance explanation.`,
    },
    related: ['privacy-server-publishing', 'toolkit-translate'],
  },
  {
    id: 'privacy-server-publishing',
    area: 'privacy',
    title: { es: 'Qué publica Nodus Server y qué nunca sale', en: 'What Nodus Server publishes and what never leaves' },
    keywords: ['publicar', 'que se publica', 'servidor privacidad', 'vault compartido', 'vectores', 'pasajes', 'biblioteca', 'alumnado', 'sqlite', 'copia filtrada', 'solo lectura'],
    body: {
      es: `- Se publica siempre: referencias, autores, temas, ideas, evidencias, conexiones y preguntas.
- Nunca se publica: PDF, audio, claves, contraseñas, rutas locales, datos del alumnado ni el archivo SQLite. Los documentos no viajan.
- Interruptores que amplían lo publicado: incluir contenido creado por el usuario, incluir pasajes extraídos, publicar biblioteca y documentos, incluir vectores semánticos, y —solo en Fuentes primarias y Testimonios— publicar fuentes revisadas y testimonios textuales. Cada uno se decide por bóveda y con la bóveda activa.
- Los vectores semánticos publicados son cuantificados y no reversibles, y nunca provienen del PDF: publicarlos es opcional.
- La copia se publica por HTTPS saliente mientras Nodus está abierto; el servidor puede servir la última copia aunque el ordenador esté apagado. El acceso remoto usa OAuth con permisos de lectura sobre los espacios asignados.
- Una bóveda conectada como réplica de solo lectura no envía al servidor lo que se escriba o genere en este equipo.`,
      en: `- Always published: references, authors, topics, ideas, evidence, connections and questions.
- Never published: PDFs, audio, keys, passwords, local paths, student data or the SQLite file. Documents do not travel.
- Switches that widen what is published: include user-created content, include extracted passages, publish library and documents, include semantic vectors and — in Primary sources and Testimonies only — publish reviewed sources and textual testimonies. Each is decided per vault, for the active vault.
- Published semantic vectors are quantised and not reversible, and never come from the PDF: publishing them is optional.
- The copy is published over outbound HTTPS while Nodus is open; the server can serve the last copy even when the machine is off. Remote access uses OAuth with read permissions over the assigned spaces.
- A replica vault connected as read-only never sends to the server what is written or generated on this machine.`,
    },
    related: ['server-overview', 'privacy-what-is-sent'],
  },
];
