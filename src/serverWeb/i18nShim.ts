import type { AppLanguage } from '@shared/types';
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { normalizeUiLanguage } from '@shared/uiLanguage';
import { EN } from '../i18n.en';
import { FR } from '../i18n.fr';
import { DE } from '../i18n.de';
import { PT } from '../i18n.pt';
import { PT_BR } from '../i18n.pt-BR';
import { IT } from '../i18n.it';
import { TR } from '../i18n.tr';

/**
 * Server Web uses the same translation tables as Desktop.  This used to be a
 * Spanish-only stub, which meant shared views silently ignored the user's
 * portable interface preference.  Keeping the adapter preserves the server
 * build boundary while making all eight supported locales available.
 *
 * The small local table covers the native Server settings shell's labels that
 * are intentionally not part of Desktop's source catalogue.  Shared labels
 * continue through the complete Desktop catalogue and its English fallback.
 */
const SERVER_WEB_TRANSLATIONS: Partial<Record<AppLanguage, Record<string, string>>> = {
  en: {
    'Ajustes': 'Settings', 'Servidor': 'Server', 'Proveedores': 'Providers', 'Modelos IA': 'AI models',
    'Biblioteca': 'Library', 'Texto y OCR': 'Text & OCR', Interfaz: 'Interface', Integraciones: 'Integrations',
    'Nodus Browser': 'Nodus Browser', 'Tutoriales': 'Tutorials', 'Copia de seguridad': 'Backup',
    'Acerca de': 'About', Actualizaciones: 'Updates', 'Busca un ajuste o entra por una sección temática.': 'Search for a setting or open a focused section.',
    'Buscar en ajustes…': 'Search settings…', 'Idioma de interfaz': 'Interface language', 'Idioma de prompts': 'Prompt language',
    'Guardar interfaz': 'Save interface', 'Guardar modelos': 'Save models', 'Guardando…': 'Saving…',
    'Cargando ajustes…': 'Loading settings…', 'Secciones de ajustes': 'Settings sections',
    'No hay ajustes que coincidan con la búsqueda.': 'No settings match your search.',
    'Proveedores de IA y modelos': 'AI providers and models', 'Modelos de IA': 'AI models',
    'Modelos favoritos para los selectores independientes': 'Favourite models for independent selectors',
    'Configuración': 'Configuration', Básica: 'Basic', Avanzada: 'Advanced',
    'Modelo general de texto': 'General text model', 'Sin asignar': 'Unassigned', pendiente: 'pending',
    'Tema': 'Theme', Sistema: 'System', Oscuro: 'Dark', Claro: 'Light',
    'Escala de interfaz': 'Interface scale', 'Fuente accesible': 'Accessible font',
    'Alto contraste': 'High contrast', 'Reducir movimiento': 'Reduce motion',
    'Modo de lectura enfocada': 'Focused reading mode',
    'Nodus Server': 'Nodus Server', 'Nuevo vault': 'New vault', 'Vaults del servidor': 'Server vaults',
    Nombre: 'Name', Tipo: 'Type', Descripción: 'Description', 'Crear vault': 'Create vault',
    Usuarios: 'Users', Dispositivos: 'Devices', 'Usuarios y acceso': 'Users and access',
    Dispositivo: 'Device', 'Último uso': 'Last used', Nunca: 'Never', Revocar: 'Revoke',
    Correo: 'Email', 'Contraseña temporal': 'Temporary password', 'Vault inicial': 'Initial vault',
    Rol: 'Role', Lectura: 'Read', Escritura: 'Write', Propietario: 'Owner',
    'Crear cuenta': 'Create account', 'Mi cuenta': 'My account', 'Cuenta activa': 'Active account',
    'Contraseña actual': 'Current password', 'Nueva contraseña': 'New password',
    'Repetir contraseña': 'Repeat password', 'Cambiar contraseña': 'Change password', 'Cerrar sesión': 'Sign out',
    'Nativo del servidor': 'Server-native', Editable: 'Editable', 'Sin publicar': 'Not published',
    'Conectar Desktop': 'Connect Desktop', 'Código de conexión': 'Connection code', Caduca: 'Expires',
    'Investigación': 'Research', Genealogía: 'Genealogy', Prosopografía: 'Prosopography',
    Testimonios: 'Testimonies', 'Fuentes primarias': 'Primary sources', Estudio: 'Study',
    Docencia: 'Teaching', 'Base de datos': 'Database',
    'Biblioteca publicada': 'Published library', 'Vaults disponibles': 'Available vaults', Privacidad: 'Privacy',
    Protegida: 'Protected', 'Sincronización Zotero': 'Zotero synchronisation',
    'Extracción de texto y OCR': 'Text extraction and OCR', 'Texto publicado': 'Published text',
    'OCR de PDF': 'PDF OCR', 'Lectura nativa': 'Native reading', 'Gestionado por Desktop': 'Managed by Desktop',
    'Servidor MCP': 'MCP server', Compatible: 'Compatible',
    'Primeros pasos': 'Getting started', 'IA privada': 'Private AI',
    'Perfil portable': 'Portable profile', 'Última sincronización': 'Last synchronisation', Sincronizado: 'Synchronised', Pendiente: 'Pending',
    'Acerca de Nodus Research': 'About Nodus Research', 'Versión Server': 'Server version',
    'Código fuente': 'Source code', 'Actualizaciones y novedades': 'Updates and what’s new', Canal: 'Channel',
    'Versión instalada': 'Installed version', 'Servidor administrado': 'Managed server',
    grupo: 'group', 'Administración integrada, sin iframe ni rutas a puertos auxiliares.': 'Integrated administration, without iframes or auxiliary ports.',
    'Crea una bóveda nativa administrada íntegramente por Server, sin depender de Nodus Desktop.': 'Create a Server-managed native vault without depending on Nodus Desktop.',
    Pasajes: 'Passages', 'Notas y proyectos': 'Notes and projects', 'Índice semántico': 'Semantic index',
    'Anotaciones privadas': 'Private annotations', 'Sin acceso inicial': 'No initial access', 'Sin acceso': 'No access',
    'Dispositivos publicadores': 'Publisher devices',
    'La cuenta se administra dentro de Ajustes; nunca se abre un puerto ni una página externa.': 'Your account is managed inside Settings; no auxiliary port or external page is opened.',
    'Alternar navegación': 'Toggle navigation', 'Bóveda activa': 'Active vault',
    'Mostrar el menú lateral': 'Show sidebar', 'Ocultar el menú lateral': 'Hide sidebar',
    'Cambiar el ancho del menú lateral': 'Resize sidebar',
    'Arrastra para cambiar el ancho. Usa las flechas o doble clic para restablecerlo.': 'Drag to resize. Use the arrow keys or double-click to reset.',
    'Gestionar vaults': 'Manage vaults', 'Selector y gestor de vaults del servidor': 'Server vault selector and manager',
    Añadir: 'Add', Cerrar: 'Close', 'Buscar vaults…': 'Search vaults…', 'Buscar vaults': 'Search vaults',
    'Filtrar por tipo': 'Filter by type', 'Todos los tipos': 'All types', 'Ordenar vaults': 'Sort vaults',
    'Fecha de creación': 'Creation date', Activo: 'Active',
    'Publicado desde Desktop': 'Published from Desktop', 'Vault activo': 'Active vault', Activar: 'Activate',
    Renombrar: 'Rename', Duplicar: 'Duplicate', Exportar: 'Export', Importar: 'Import', Eliminar: 'Delete',
    'Solo lectura': 'Read only', 'No hay coincidencias.': 'No matches.', 'Reinicializar activo': 'Reset active vault',
    'Añadir vault': 'Add vault', 'Tipo de vault': 'Vault type', Cancelar: 'Cancel', 'Renombrar vault': 'Rename vault',
    'Duplicar vault': 'Duplicate vault', 'Eliminar vault': 'Delete vault', 'Reinicializar vault': 'Reset vault',
    Continuar: 'Continue', Verificar: 'Verify', 'Código de confirmación': 'Confirmation code',
    'Código incorrecto.': 'Incorrect code.', 'Eliminar definitivamente': 'Delete permanently',
    'Reinicializar definitivamente': 'Reset permanently', 'Importar vault': 'Import vault',
    'Vault de worldbuilding': 'Worldbuilding vault', 'Vault de genealogía': 'Genealogy vault', Publicado: 'Published',
    'Crea y organiza personajes, lugares y lore directamente en Nodus Server.': 'Create and organise characters, places and lore directly in Nodus Server.',
    'Personajes, lugares y lore del mundo publicados para consulta.': 'Published world characters, places and lore for reference.',
    Personajes: 'Characters', Protagonistas: 'Protagonists', 'Con vida': 'Alive', 'En la enciclopedia': 'In the encyclopaedia',
    'Personajes recientes': 'Recent characters', 'Ver todos': 'View all', Personaje: 'Character',
    'Personaje del servidor': 'Server character', 'Personaje publicado': 'Published character',
    'Todavía no hay personajes.': 'There are no characters yet.', 'Crea el primero desde Personajes.': 'Create the first one from Characters.',
    'Construye personas, parentescos, acontecimientos y lugares directamente en Server.': 'Build people, family relationships, events and places directly in Server.',
    'Personas, parentescos, acontecimientos y lugares publicados para consulta.': 'Published people, family relationships, events and places for reference.',
    'Vínculos de parentesco': 'Family relationships', 'Documentos publicados': 'Published documents',
    'Sugerencias de parentesco': 'Relationship suggestions', 'Privadas de la cuenta': 'Private to the account',
    'Trabaja directamente en esta bóveda sin depender de Nodus Desktop.': 'Work directly in this vault without depending on Nodus Desktop.',
    'Consulta el conocimiento publicado con el mismo espacio de trabajo de Nodus Desktop.': 'Browse published knowledge in the same workspace as Nodus Desktop.',
    Actualizar: 'Refresh', 'Datos privados': 'Private data', Recursos: 'Resources', 'Explorar la bóveda': 'Explore the vault',
    'Las mismas secciones y jerarquía que en Desktop.': 'The same sections and hierarchy as Desktop.',
    'Abrir sección': 'Open section', 'Abrir sección publicada': 'Open published section',
    'Registro publicado · solo lectura': 'Published record · read only', 'registros publicados': 'published records',
    'Buscar en': 'Search in', 'No hay': 'No', publicados: 'published', Volver: 'Back', Detalles: 'Details',
    'Consulta de metadatos en modo solo lectura.': 'Read-only metadata view.',
    'Esta superficie conserva su posición y apariencia de Desktop, pero sus acciones dependen de edición local o IA y están desactivadas en Server.': 'This surface keeps its Desktop position and appearance, but actions requiring local editing or AI are disabled in Server.',
    'Disponible solo para consulta cuando exista contenido publicado': 'Available for reference when published content exists',
    'Nodus Server nunca ejecuta escrituras del vault ni herramientas de IA desde esta vista.': 'Nodus Server never writes to the vault or runs AI tools from this view.',
    'No tienes bóvedas asignadas': 'You have no assigned vaults', 'Solicita acceso a un administrador de Nodus Server.': 'Ask a Nodus Server administrator for access.',
    'La sesión ha caducado.': 'Your session has expired.', 'No se ha podido cargar esta vista.': 'This view could not be loaded.', 'Iniciar sesión': 'Sign in',
    'Obra': 'Work', Obras: 'Works', Conexiones: 'Connections', 'Desarrollo / contexto': 'Development / context',
    Evidencia: 'Evidence', 'Idea sin título': 'Untitled idea', 'Sin enunciado publicado': 'No published statement',
    'Obra publicada': 'Published work', 'Sin desarrollo publicado': 'No published development', 'Evidencia sin texto': 'Evidence without text',
    relación: 'relationship', 'No hay obras publicadas para esta idea.': 'No works published for this idea.',
    'No hay relaciones publicadas.': 'No published relationships.', 'Abrir en Biblioteca': 'Open in Library',
    'Lectura publicada y sus versiones disponibles': 'Published reading and available versions', 'No hay resumen publicado.': 'No published summary.',
    'pasajes indexados': 'indexed passages', 'Perfil documental': 'Document profile', 'No hay perfil documental publicado.': 'No published document profile.',
    'Autor sin nombre': 'Unnamed author', 'No hay síntesis publicada para este autor.': 'No published synthesis for this author.',
    'No hay obras publicadas.': 'No published works.', 'No hay ideas publicadas.': 'No published ideas.',
    'No hay relaciones autorales publicadas.': 'No published author relationships.',
    'Atribución provisional': 'Provisional attribution', 'Sin ideas atribuidas': 'No attributed ideas', Editado: 'Edited', Leída: 'Read',
    'Registro publicado': 'Published record', 'contexto y evidencia disponibles': 'context and evidence available',
    'No se ha podido cargar este registro.': 'This record could not be loaded.', Reintentar: 'Retry', Cargando: 'Loading',
    'Volver al registro de origen': 'Return to source record', Origen: 'Origin', Atrás: 'Back', Adelante: 'Forward',
    Sección: 'Section',
    'Cargando…': 'Loading…', 'ideas extraídas': 'ideas extracted',
    'Documento sin título': 'Untitled document', '¿Cómo quieres leer este documento?': 'How would you like to read this document?',
    'Puedes cambiar de versión desde el selector del lector.': 'You can change versions from the reader selector.',
    'Markdown limpio': 'Clean Markdown', 'Lectura adaptable con índice e imágenes extraídas.': 'Adaptable reading with index and extracted images.',
    'Archivo original': 'Original file', 'Abre directamente el archivo conservado y su diseño original.': 'Open the preserved file and its original layout directly.',
    'No volver a preguntar': 'Do not ask again', 'La próxima vez se abrirá el formato elegido.': 'The selected format will open next time.',
    'Versiones y archivos': 'Versions and files', disponibles: 'available', 'Preguntar de nuevo al abrir': 'Ask again when opening',
    'documentos publicados': 'published documents', 'Todas las colecciones': 'All collections',
    'Buscar título, autor, etiqueta…': 'Search title, author, tag…', Título: 'Title', Autoría: 'Authorship', Año: 'Year',
    'No se ha podido cargar la biblioteca.': 'The library could not be loaded.', 'La biblioteca está vacía': 'The library is empty',
    'No hay coincidencias': 'No matches', 'Documento publicado': 'Published document', 'Texto limpio': 'Clean text', Original: 'Original', Metadatos: 'Metadata', Abrir: 'Open',
    Anterior: 'Previous', Siguiente: 'Next', 'Página anterior': 'Previous page', 'Página siguiente': 'Next page',
    'No hay enlaces': 'No links', 'Todavía no hay una pregunta de investigación publicada': 'No published research question yet',
    'Cuando se mapee en Desktop aparecerán aquí sus subpreguntas, fuentes y cobertura real.': 'Once mapped in Desktop, its subquestions, sources and actual coverage will appear here.',
    'No hay debates publicados': 'No published debates', 'Las contradicciones y refutaciones validadas del grafo aparecerán enfrentadas aquí.': 'Validated contradictions and refutations from the graph will appear side by side here.',
    'No hay huecos publicados': 'No published gaps', 'Los límites y oportunidades detectados en las obras aparecerán aquí con su trazabilidad.': 'Limits and opportunities found in works will appear here with their traceability.',
    'Sin título': 'Untitled', 'Sin enlaces': 'No links',
    Borrador: 'Draft', Archivado: 'Archived', 'El proveedor completó el trabajo, pero su respuesta no contiene texto compatible.': 'The provider completed the job, but its response contains no compatible text.',
    'Añadir nota': 'Add note', 'Guardar anotación': 'Save annotation', 'Eliminar anotación': 'Delete annotation', Subrayado: 'Highlight', Anotación: 'Annotation',
    'Bóveda nativa del servidor': 'Server-native vault', 'registro': 'record', 'registros': 'records', 'Nuevo': 'New', 'Nueva': 'New', 'la primera': 'the first', 'el primer': 'the first', 'Guardar': 'Save',
    idea: 'idea', obra: 'work', autor: 'author', pasaje: 'passage', tema: 'theme', hueco: 'gap',
    'base de datos': 'database', página: 'page', personaje: 'character', lugar: 'place', evento: 'event',
    persona: 'person', fuente: 'source', vínculo: 'link', escena: 'scene', mapa: 'map', artículo: 'article', entrada: 'entry',
    hilo: 'thread', arco: 'arc', regla: 'rule', pregunta: 'question', curso: 'course', material: 'material', plan: 'plan',
    periodo: 'period', examen: 'exam', rúbrica: 'rubric', calificación: 'grade', unidad: 'unit', documento: 'document',
    repositorio: 'repository', extracto: 'excerpt', análisis: 'analysis', entrevista: 'interview', transcripción: 'transcript',
    código: 'code', contraste: 'contrast', participante: 'participant',
    'Revisión': 'Revision', 'Gestionar': 'Manage', 'Editar': 'Edit', 'Borrar': 'Delete',
    'No hay registros todavía.': 'No records yet.', 'Crea': 'Create', 'desde esta vista.': 'from this view.',
    'Esta vista aún no admite contenido nativo': 'This view does not support native content yet',
    'La bóveda sigue siendo válida, pero esta colección derivada no expone un contrato de escritura seguro.': 'The vault is valid, but this derived collection does not expose a safe write contract.',
    'No se pudo cargar el contenido nativo.': 'Could not load native content.', 'No se pudo cargar el contenido.': 'Could not load content.',
    'No se pudo borrar.': 'Could not delete.', 'No se pudo guardar.': 'Could not save.', 'Completa la clave del registro.': 'Complete the record key.',
    'No hay registros.': 'No records.', 'Columna': 'Column', 'Registro': 'Record',
    'Análisis publicado': 'Published analysis', 'Análisis de bases de datos': 'Database analysis',
    'Constructor de análisis': 'Analysis builder', 'Solo datos publicados': 'Published data only',
    'No hay análisis aplicables a esta base de datos publicada.': 'No analyses apply to this published database.',
    'Añadir análisis': 'Add analysis', 'Recuento': 'Count', Media: 'Mean', Suma: 'Sum',
    'Agrupar por': 'Group by', Día: 'Day', Mes: 'Month', 'Vistas publicadas': 'Published views',
    'Sin bases de datos': 'No databases', 'Cargando datos publicados…': 'Loading published data…',
    'Base de datos publicada': 'Published database', 'Imagen publicada': 'Published image',
    'Adjunto': 'Attachment', 'No hay registros publicados.': 'No published records.',
    'Hay más registros publicados. Usa la paginación de la vista para continuar.': 'More published records are available. Use the view pagination to continue.',
    'Ubicación archivística': 'Archive location', 'Colecciones de trabajo': 'Working collections', 'Todo el archivo': 'Entire archive',
    'Buscar metadatos: título, signatura o descripción…': 'Search metadata: title, reference or description…',
    'Buscar fuentes por metadatos': 'Search sources by metadata', 'Vista tabla': 'Table view', 'Vista galería': 'Gallery view', 'Vista jerarquía': 'Hierarchy view',
    'Sin unidad archivística': 'No archival unit', 'Sin colección': 'No collection', 'No hay fuentes publicadas con estos filtros.': 'No published sources match these filters.',
    'Fuentes publicadas': 'Published sources', 'Fuente': 'Source', 'Sin descripción publicada': 'No published description',
    'Unidad archivística': 'Archival unit', Colección: 'Collection', Unidad: 'Unit',
    Relleno: 'Fill', filas: 'rows', columnas: 'columns', 'vistas publicadas': 'published views', Vista: 'View',
    'Solicitud no válida.': 'Invalid request.', Elegir: 'Choose', 'Elegir…': 'Choose…', ninguna: 'none',
    'Cargando contenido de la bóveda…': 'Loading vault content…',
    'Datos privados; no se muestran en el servidor': 'Private data; not shown on the server',
  },
  fr: {
    'Ajustes': 'Paramètres', 'Servidor': 'Serveur', 'Proveedores': 'Fournisseurs', 'Modelos IA': 'Modèles IA',
    'Biblioteca': 'Bibliothèque', 'Texto y OCR': 'Texte et OCR', Interfaz: 'Interface', Integraciones: 'Intégrations',
    'Tutoriales': 'Tutoriels', 'Copia de seguridad': 'Sauvegarde', 'Acerca de': 'À propos', Actualizaciones: 'Mises à jour',
    'Busca un ajuste o entra por una sección temática.': 'Recherchez un paramètre ou accédez à une section thématique.',
    'Buscar en ajustes…': 'Rechercher dans les paramètres…', 'Idioma de interfaz': 'Langue de l’interface', 'Idioma de prompts': 'Langue des prompts',
    'Guardar interfaz': 'Enregistrer l’interface', 'Guardar modelos': 'Enregistrer les modèles', 'Guardando…': 'Enregistrement…',
  },
  de: {
    'Ajustes': 'Einstellungen', 'Servidor': 'Server', 'Proveedores': 'Anbieter', 'Modelos IA': 'KI-Modelle',
    'Biblioteca': 'Bibliothek', 'Texto y OCR': 'Text & OCR', Interfaz: 'Oberfläche', Integraciones: 'Integrationen',
    'Tutoriales': 'Tutorials', 'Copia de seguridad': 'Sicherung', 'Acerca de': 'Über', Actualizaciones: 'Updates',
    'Busca un ajuste o entra por una sección temática.': 'Suchen Sie nach einer Einstellung oder öffnen Sie einen Themenbereich.',
    'Buscar en ajustes…': 'Einstellungen durchsuchen…', 'Idioma de interfaz': 'Sprache der Oberfläche', 'Idioma de prompts': 'Prompt-Sprache',
    'Guardar interfaz': 'Oberfläche speichern', 'Guardar modelos': 'Modelle speichern', 'Guardando…': 'Wird gespeichert…',
  },
  pt: {
    'Ajustes': 'Definições', 'Servidor': 'Servidor', 'Proveedores': 'Provedores', 'Modelos IA': 'Modelos de IA',
    'Biblioteca': 'Biblioteca', 'Texto y OCR': 'Texto e OCR', Interfaz: 'Interface', Integraciones: 'Integrações',
    'Tutoriales': 'Tutoriais', 'Copia de seguridad': 'Cópia de segurança', 'Acerca de': 'Sobre', Actualizaciones: 'Atualizações',
    'Busca un ajuste o entra por una sección temática.': 'Procure uma definição ou abra uma secção temática.',
    'Buscar en ajustes…': 'Pesquisar nas definições…', 'Idioma de interfaz': 'Idioma da interface', 'Idioma de prompts': 'Idioma dos prompts',
    'Guardar interfaz': 'Guardar interface', 'Guardar modelos': 'Guardar modelos', 'Guardando…': 'A guardar…',
  },
  'pt-BR': {
    'Ajustes': 'Configurações', 'Servidor': 'Servidor', 'Proveedores': 'Provedores', 'Modelos IA': 'Modelos de IA',
    'Biblioteca': 'Biblioteca', 'Texto y OCR': 'Texto e OCR', Interfaz: 'Interface', Integraciones: 'Integrações',
    'Tutoriales': 'Tutoriais', 'Copia de seguridad': 'Backup', 'Acerca de': 'Sobre', Actualizaciones: 'Atualizações',
    'Busca un ajuste o entra por una sección temática.': 'Pesquise uma configuração ou abra uma seção temática.',
    'Buscar en ajustes…': 'Pesquisar nas configurações…', 'Idioma de interfaz': 'Idioma da interface', 'Idioma de prompts': 'Idioma dos prompts',
    'Guardar interfaz': 'Salvar interface', 'Guardar modelos': 'Salvar modelos', 'Guardando…': 'Salvando…',
  },
  it: {
    'Ajustes': 'Impostazioni', 'Servidor': 'Server', 'Proveedores': 'Provider', 'Modelos IA': 'Modelli IA',
    'Biblioteca': 'Biblioteca', 'Texto y OCR': 'Testo e OCR', Interfaz: 'Interfaccia', Integraciones: 'Integrazioni',
    'Tutoriales': 'Tutorial', 'Copia de seguridad': 'Backup', 'Acerca de': 'Informazioni', Actualizaciones: 'Aggiornamenti',
    'Busca un ajuste o entra por una sección temática.': 'Cerca un’impostazione o apri una sezione tematica.',
    'Buscar en ajustes…': 'Cerca nelle impostazioni…', 'Idioma de interfaz': 'Lingua dell’interfaccia', 'Idioma de prompts': 'Lingua dei prompt',
    'Guardar interfaz': 'Salva interfaccia', 'Guardar modelos': 'Salva modelli', 'Guardando…': 'Salvataggio…',
  },
  tr: {
    'Ajustes': 'Ayarlar', 'Servidor': 'Sunucu', 'Proveedores': 'Sağlayıcılar', 'Modelos IA': 'Yapay zekâ modelleri',
    'Biblioteca': 'Kütüphane', 'Texto y OCR': 'Metin ve OCR', Interfaz: 'Arayüz', Integraciones: 'Entegrasyonlar',
    'Tutoriales': 'Eğitimler', 'Copia de seguridad': 'Yedekleme', 'Acerca de': 'Hakkında', Actualizaciones: 'Güncellemeler',
    'Busca un ajuste o entra por una sección temática.': 'Bir ayar arayın veya tematik bir bölüm açın.',
    'Buscar en ajustes…': 'Ayarlarda ara…', 'Idioma de interfaz': 'Arayüz dili', 'Idioma de prompts': 'İstem dili',
    'Guardar interfaz': 'Arayüzü kaydet', 'Guardar modelos': 'Modelleri kaydet', 'Guardando…': 'Kaydediliyor…',
  },
};

let active: AppLanguage = 'en';

type TranslationTables = Partial<Record<Exclude<AppLanguage, 'es'>, Record<string, string>>>;
const DESKTOP_TABLES: TranslationTables = { en: EN, fr: FR, de: DE, pt: PT, 'pt-BR': PT_BR, it: IT, tr: TR };

export function setActiveLang(language: AppLanguage): void {
  active = normalizeUiLanguage(language);
}
export function getActiveLang(): AppLanguage { return active; }
export function resolveTranslation(language: unknown, source: string, tables: TranslationTables = DESKTOP_TABLES): string {
  const normalized = normalizeUiLanguage(language);
  if (normalized === 'es') return source;
  return SERVER_WEB_TRANSLATIONS[normalized]?.[source] ?? tables[normalized]?.[source] ?? SERVER_WEB_TRANSLATIONS.en?.[source] ?? tables.en?.[source] ?? source;
}
export function t(source: string): string { return resolveTranslation(active, source); }
/** Translate the static text/labels in a server surface without touching
 * published record values. Unknown strings pass through unchanged. */
export function translateNode(node: ReactNode): ReactNode {
  if (typeof node === 'string') return t(node);
  if (Array.isArray(node)) return node.map(translateNode);
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  const props: Record<string, unknown> = {};
  for (const key of ['placeholder', 'title', 'aria-label', 'label']) {
    if (typeof element.props[key] === 'string') props[key] = t(element.props[key] as string);
  }
  if (element.props.children !== undefined) props.children = translateNode(element.props.children as ReactNode);
  return cloneElement(element, props);
}
export function tx(source: string, variables: Record<string, string | number>): string {
  return Object.entries(variables).reduce((value, [key, replacement]) => value.replaceAll(`{${key}}`, String(replacement)), t(source));
}
export function tr(value: string): string { return t(value); }
export function errorText(error: unknown): string { return t(error instanceof Error ? error.message : String(error)); }
export function pick<T>(values: Partial<Record<AppLanguage, T>> & { es: T; en: T }): T { return values[active] ?? values.en; }
export function notificationLine(value: unknown, fallback: string | undefined): string {
  return typeof value === 'string' && value.trim() ? tr(value) : fallback ? t(fallback) : '';
}
