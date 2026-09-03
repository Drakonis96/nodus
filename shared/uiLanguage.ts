import type { AppLanguage } from './types';

export type UiTranslations = Partial<Record<AppLanguage, string>> & { en: string };

const UI_LANGUAGES = new Set<AppLanguage>(['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']);

/** Runtime locale validation. Unknown or future locales must never fall back to Spanish. */
export function normalizeUiLanguage(language: unknown): AppLanguage {
  return typeof language === 'string' && UI_LANGUAGES.has(language as AppLanguage)
    ? (language as AppLanguage)
    : 'en';
}

/** Resolve a browser locale such as `fr-FR` or `pt-BR` to a supported UI language. */
export function normalizeBrowserUiLanguage(language: unknown): AppLanguage {
  if (typeof language !== 'string') return 'en';
  const normalized = language.trim().toLowerCase();
  if (normalized === 'pt-br' || normalized.startsWith('pt-br-')) return 'pt-BR';
  const base = normalized.split('-')[0];
  return base === 'es' || base === 'en' || base === 'fr' || base === 'de'
    || base === 'pt' || base === 'it' || base === 'tr'
    ? base
    : 'en';
}

/** Pick UI copy with a single, explicit fallback: English. */
export function uiText(language: unknown, translations: UiTranslations): string {
  const normalized = normalizeUiLanguage(language);
  return translations[normalized] ?? translations.en;
}

type LocalizedTemplate = UiTranslations;
type TemplateParams = Record<string, string | number | string[]>;

function interpolateTemplate(template: string, params: TemplateParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    return Array.isArray(value) ? value.join(' · ') : value == null ? `{${name}}` : String(value);
  });
}

/** Localize stable, server-produced debate prose while keeping side statements as data. */
export function localizeDebateTension(key: unknown, params: TemplateParams | null | undefined, language: unknown): string | null {
  const templates: Record<string, LocalizedTemplate> = {
    'debate.contradicts': {
      es: 'La contradicción detectada es que «{left}» entra en tensión con «{right}».', en: 'The detected contradiction is that “{left}” is in tension with “{right}”.', fr: 'La contradiction détectée est que « {left} » entre en tension avec « {right} ».', de: 'Der erkannte Widerspruch besteht darin, dass „{left}“ im Spannungsverhältnis zu „{right}“ steht.', pt: 'A contradição detetada é que «{left}» entra em tensão com «{right}».', 'pt-BR': 'A contradição detectada é que “{left}” entra em tensão com “{right}”.', it: 'La contraddizione rilevata è che «{left}» entra in tensione con «{right}».', tr: 'Tespit edilen çelişki, “{left}” ifadesinin “{right}” ile gerilim içinde olmasıdır.',
    },
    'debate.refutes': {
      es: 'La refutación detectada es que «{left}» entra en tensión con «{right}».', en: 'The detected refutation is that “{left}” is in tension with “{right}”.', fr: 'La réfutation détectée est que « {left} » entre en tension avec « {right} ».', de: 'Die erkannte Widerlegung besteht darin, dass „{left}“ im Spannungsverhältnis zu „{right}“ steht.', pt: 'A refutação detetada é que «{left}» entra em tensão com «{right}».', 'pt-BR': 'A refutação detectada é que “{left}” entra em tensão com “{right}”.', it: 'La confutazione rilevata è che «{left}» entra in tensione con «{right}».', tr: 'Tespit edilen çürütme, “{left}” ifadesinin “{right}” ile gerilim içinde olmasıdır.',
    },
  };
  const template = templates[String(key)];
  return template ? interpolateTemplate(uiText(language, template), params ?? {}) : null;
}

/** Localize the stable copy keys attached to server reading-path projections. */
export function localizeReadingPathText(key: unknown, params: TemplateParams | null | undefined, language: unknown): string | null {
  const templates: Record<string, LocalizedTemplate> = {
    'reading.reason.connectedIdeas': { es: 'Conecta ideas del corpus publicado.', en: 'Connects ideas from the published corpus.', fr: 'Relie des idées du corpus publié.', de: 'Verbindet Ideen aus dem veröffentlichten Korpus.', pt: 'Liga ideias do corpus publicado.', 'pt-BR': 'Conecta ideias do corpus publicado.', it: 'Collega idee del corpus pubblicato.', tr: 'Yayımlanmış derlemeye ait fikirleri birbirine bağlar.' },
    'reading.reason.pendingAnalysis': { es: 'Obra pendiente de análisis.', en: 'Work pending analysis.', fr: 'Œuvre en attente d’analyse.', de: 'Werk wartet auf Analyse.', pt: 'Obra pendente de análise.', 'pt-BR': 'Obra pendente de análise.', it: 'Opera in attesa di analisi.', tr: 'Analiz bekleyen çalışma.' },
    'reading.summary': { es: 'Ruta de lectura con {count} obras priorizadas.', en: 'Reading path with {count} prioritised works.', fr: 'Parcours de lecture avec {count} œuvres prioritaires.', de: 'Lesepfad mit {count} priorisierten Werken.', pt: 'Rota de leitura com {count} obras prioritárias.', 'pt-BR': 'Rota de leitura com {count} obras priorizadas.', it: 'Percorso di lettura con {count} opere prioritarie.', tr: '{count} öncelikli çalışmadan oluşan okuma yolu.' },
    'reading.phase.foundations.title': { es: 'Textos de base', en: 'Foundational texts', fr: 'Textes fondamentaux', de: 'Grundlagentexte', pt: 'Textos de base', 'pt-BR': 'Textos fundamentais', it: 'Testi fondativi', tr: 'Temel metinler' },
    'reading.phase.foundations.objective': { es: 'Construye el terreno común.', en: 'Build the common ground.', fr: 'Construire le socle commun.', de: 'Die gemeinsame Grundlage aufbauen.', pt: 'Constrói o terreno comum.', 'pt-BR': 'Construa a base comum.', it: 'Costruisci il terreno comune.', tr: 'Ortak zemini oluşturun.' },
    'reading.phase.core.title': { es: 'Núcleo de la investigación', en: 'Research core', fr: 'Cœur de la recherche', de: 'Forschungskern', pt: 'Núcleo da investigação', 'pt-BR': 'Núcleo da pesquisa', it: 'Nucleo della ricerca', tr: 'Araştırmanın çekirdeği' },
    'reading.phase.core.objective': { es: 'Lee las obras más relevantes para tu pregunta.', en: 'Read the works most relevant to your question.', fr: 'Lisez les œuvres les plus pertinentes pour votre question.', de: 'Lesen Sie die für Ihre Frage relevantesten Werke.', pt: 'Lê as obras mais relevantes para a tua pergunta.', 'pt-BR': 'Leia as obras mais relevantes para sua pergunta.', it: 'Leggi le opere più rilevanti per la tua domanda.', tr: 'Sorunuzla en ilgili çalışmaları okuyun.' },
    'reading.phase.bridges.title': { es: 'Puentes entre temas', en: 'Bridges between themes', fr: 'Ponts entre les thèmes', de: 'Brücken zwischen Themen', pt: 'Pontes entre temas', 'pt-BR': 'Pontes entre temas', it: 'Ponti tra i temi', tr: 'Temalar arasında köprüler' },
    'reading.phase.bridges.objective': { es: 'Conecta líneas temáticas del corpus.', en: 'Connect thematic lines in the corpus.', fr: 'Reliez les axes thématiques du corpus.', de: 'Thematische Linien im Korpus verbinden.', pt: 'Liga linhas temáticas do corpus.', 'pt-BR': 'Conecte linhas temáticas do corpus.', it: 'Collega le linee tematiche del corpus.', tr: 'Derlemdeki tematik çizgileri birbirine bağlayın.' },
    'reading.phase.debates.title': { es: 'Debates y tensiones', en: 'Debates and tensions', fr: 'Débats et tensions', de: 'Debatten und Spannungen', pt: 'Debates e tensões', 'pt-BR': 'Debates e tensões', it: 'Dibattiti e tensioni', tr: 'Tartışmalar ve gerilimler' },
    'reading.phase.debates.objective': { es: 'Contrasta posiciones y relaciones visibles.', en: 'Compare visible positions and relations.', fr: 'Comparez les positions et relations visibles.', de: 'Sichtbare Positionen und Beziehungen vergleichen.', pt: 'Contrasta posições e relações visíveis.', 'pt-BR': 'Compare posições e relações visíveis.', it: 'Confronta posizioni e relazioni visibili.', tr: 'Görünür konumları ve ilişkileri karşılaştırın.' },
    'reading.phase.gaps.title': { es: 'Huecos abiertos', en: 'Open gaps', fr: 'Lacunes ouvertes', de: 'Offene Lücken', pt: 'Lacunas abertas', 'pt-BR': 'Lacunas abertas', it: 'Lacune aperte', tr: 'Açık boşluklar' },
    'reading.phase.gaps.objective': { es: 'Acércate a lo que todavía no está cubierto.', en: 'Move towards what is not yet covered.', fr: 'Approchez-vous de ce qui n’est pas encore couvert.', de: 'Dem bisher nicht Abgedeckten näherkommen.', pt: 'Aproxima-te do que ainda não está coberto.', 'pt-BR': 'Aproxime-se do que ainda não foi coberto.', it: 'Avvicinati a ciò che non è ancora coperto.', tr: 'Henüz kapsanmayan konulara yaklaşın.' },
    'reading.phase.pending.title': { es: 'Pendientes de analizar', en: 'Pending analysis', fr: 'À analyser', de: 'Ausstehende Analyse', pt: 'Pendentes de análise', 'pt-BR': 'Pendentes de análise', it: 'In attesa di analisi', tr: 'Analiz bekleyenler' },
    'reading.phase.pending.objective': { es: 'Obras que aún necesitan una lectura inicial.', en: 'Works that still need an initial reading.', fr: 'Œuvres qui nécessitent encore une première lecture.', de: 'Werke, die noch eine erste Lektüre benötigen.', pt: 'Obras que ainda precisam de uma leitura inicial.', 'pt-BR': 'Obras que ainda precisam de uma leitura inicial.', it: 'Opere che necessitano ancora di una prima lettura.', tr: 'Henüz ilk okumayı gerektiren çalışmalar.' },
  };
  const template = templates[String(key)];
  return template ? interpolateTemplate(uiText(language, template), params ?? {}) : null;
}

/** Localize server continuity findings without translating their entity names. */
export function localizeContinuityText(key: unknown, params: TemplateParams | null | undefined, language: unknown): string | null {
  const templates: Record<string, LocalizedTemplate> = {
    'continuity.thread.noScenes.headline': { es: '«{subjects}» no avanza en ninguna escena', en: '“{subjects}” does not advance in any scene', fr: '« {subjects} » n’avance dans aucune scène', de: '„{subjects}“ kommt in keiner Szene voran', pt: '«{subjects}» não avança em nenhuma cena', 'pt-BR': '“{subjects}” não avança em nenhuma cena', it: '«{subjects}» non avanza in nessuna scena', tr: '“{subjects}” hiçbir sahnede ilerlemiyor' },
    'continuity.thread.resolvedFlat.headline': { es: '«{subjects}» se cierra sin haber subido nunca', en: '“{subjects}” closes without ever escalating', fr: '« {subjects} » se termine sans avoir jamais gagné en intensité', de: '„{subjects}“ wird beendet, ohne sich je zugespitzt zu haben', pt: '«{subjects}» fecha sem nunca ter escalado', 'pt-BR': '“{subjects}” termina sem nunca ter escalado', it: '«{subjects}» si chiude senza essere mai cresciuto', tr: '“{subjects}” hiç yükselmeden kapanıyor' },
    'continuity.coverage.undatedScenes.headline': { es: '{count} escenas no tienen día del mundo', en: '{count} scenes have no world day', fr: '{count} scènes n’ont pas de jour du monde', de: '{count} Szenen haben keinen Welttag', pt: '{count} cenas não têm dia do mundo', 'pt-BR': '{count} cenas não têm dia do mundo', it: '{count} scene non hanno un giorno del mondo', tr: '{count} sahnenin dünya günü yok' },
    'continuity.lifespan.afterDeath.headline': { es: '{subjects} actúa después de morir', en: '{subjects} acts after death', fr: '{subjects} agit après sa mort', de: '{subjects} handelt nach dem Tod', pt: '{subjects} age depois de morrer', 'pt-BR': '{subjects} age depois de morrer', it: '{subjects} agisce dopo la morte', tr: '{subjects} ölümünden sonra hareket ediyor' },
    'continuity.lifespan.beforeBirth.headline': { es: '{subjects} aparece antes de nacer', en: '{subjects} appears before birth', fr: '{subjects} apparaît avant sa naissance', de: '{subjects} erscheint vor seiner Geburt', pt: '{subjects} aparece antes de nascer', 'pt-BR': '{subjects} aparece antes de nascer', it: '{subjects} appare prima della nascita', tr: '{subjects} doğumundan önce görünüyor' },
    'continuity.affiliation.inverted.headline': { es: '{subjects} deja su grupo antes de entrar', en: '{subjects} leaves its group before joining it', fr: '{subjects} quitte son groupe avant de le rejoindre', de: '{subjects} verlässt die Gruppe, bevor es ihr beitritt', pt: '{subjects} deixa o grupo antes de entrar nele', 'pt-BR': '{subjects} deixa o grupo antes de entrar nele', it: '{subjects} lascia il gruppo prima di entrarvi', tr: '{subjects} gruba katılmadan önce gruptan ayrılıyor' },
    'continuity.containment.cycle.headline': { es: '{subjects} acaba conteniéndose a sí mismo', en: '{subjects} ends up containing itself', fr: '{subjects} finit par se contenir lui-même', de: '{subjects} enthält am Ende sich selbst', pt: '{subjects} acaba por se conter a si próprio', 'pt-BR': '{subjects} acaba contendo a si mesmo', it: '{subjects} finisce per contenere sé stesso', tr: '{subjects} sonunda kendisini içeriyor' },
  };
  const template = templates[String(key)];
  return template ? interpolateTemplate(uiText(language, template), params ?? {}) : null;
}

/**
 * Conservative detector for Spanish application messages. It intentionally ignores
 * short user data and technical identifiers; it is only used at UI/error boundaries.
 */
export function looksLikeSpanishUiText(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/[¿¡ñáéíóú]/i.test(text)) return true;
  if (/\b(?:bóveda|obra|archivo|carpeta|mientras|después|seleccionad[oa]|encontrad[oa]|configurad[oa]|lectura|cola|pued[ea]s?|debe[sn]?|falta)\b/i.test(text)) return true;
  const functionWords = text.match(/\b(?:el|la|los|las|una?|se|del|para|con|sin)\b/gi) ?? [];
  return functionWords.length >= 2;
}

/**
 * Every failure the global library can hit while talking to Zotero, translated.
 *
 * These sentences are born in the main process (`electron/zotero/zoteroClient.ts`
 * and `electron/library/libraryService.ts`) and reach the renderer as a rejected
 * `ipcRenderer.invoke`, which is the one path that never gets a second chance:
 * `localizeIpcPayload` lets a renderer-translated field through untouched, but a
 * thrown error is localized here or not at all. Unlisted, they read as Spanish
 * prose and collapsed into the generic "the operation could not be completed" —
 * so the commonest failure of all, a closed Zotero, named neither its cause nor
 * its fix. The technical detail (`fetch failed`, an HTTP status) is transport
 * output and stays verbatim in every language.
 */
const ZOTERO_LIBRARY_ERRORS: Record<string, UiTranslations> = {
  'No se pudo conectar con Zotero.': {
    es: 'No se pudo conectar con Zotero.',
    en: 'Could not connect to Zotero.',
    fr: 'Impossible de se connecter à Zotero.',
    de: 'Verbindung zu Zotero nicht möglich.',
    pt: 'Não foi possível ligar ao Zotero.',
    'pt-BR': 'Não foi possível conectar ao Zotero.',
    it: 'Impossibile connettersi a Zotero.',
    tr: 'Zotero’ya bağlanılamadı.',
  },
  'Las credenciales de Zotero han caducado.': {
    es: 'Las credenciales de Zotero han caducado.',
    en: 'The Zotero credentials have expired.',
    fr: 'Les identifiants Zotero ont expiré.',
    de: 'Die Zotero-Anmeldedaten sind abgelaufen.',
    pt: 'As credenciais do Zotero expiraram.',
    'pt-BR': 'As credenciais do Zotero expiraram.',
    it: 'Le credenziali di Zotero sono scadute.',
    tr: 'Zotero kimlik bilgilerinin süresi doldu.',
  },
  'Zotero rechazó el acceso a esta biblioteca.': {
    es: 'Zotero rechazó el acceso a esta biblioteca.',
    en: 'Zotero refused access to this library.',
    fr: 'Zotero a refusé l’accès à cette bibliothèque.',
    de: 'Zotero hat den Zugriff auf diese Bibliothek verweigert.',
    pt: 'O Zotero recusou o acesso a esta biblioteca.',
    'pt-BR': 'O Zotero recusou o acesso a esta biblioteca.',
    it: 'Zotero ha rifiutato l’accesso a questa libreria.',
    tr: 'Zotero bu kitaplığa erişimi reddetti.',
  },
  'Zotero mantiene temporalmente limitado el acceso.': {
    es: 'Zotero mantiene temporalmente limitado el acceso.',
    en: 'Zotero is temporarily limiting access.',
    fr: 'Zotero limite temporairement les accès.',
    de: 'Zotero begrenzt den Zugriff vorübergehend.',
    pt: 'O Zotero está a limitar temporariamente o acesso.',
    'pt-BR': 'O Zotero está limitando temporariamente o acesso.',
    it: 'Zotero sta limitando temporaneamente l’accesso.',
    tr: 'Zotero erişimi geçici olarak sınırlıyor.',
  },
  'Configura primero la carpeta de copias de seguridad de Nodus.': {
    es: 'Configura primero la carpeta de copias de seguridad de Nodus.',
    en: 'Set up the Nodus backup folder first.',
    fr: 'Configurez d’abord le dossier de sauvegarde de Nodus.',
    de: 'Richten Sie zuerst den Nodus-Sicherungsordner ein.',
    pt: 'Configure primeiro a pasta de cópias de segurança do Nodus.',
    'pt-BR': 'Configure primeiro a pasta de backups do Nodus.',
    it: 'Configura prima la cartella dei backup di Nodus.',
    tr: 'Önce Nodus yedekleme klasörünü yapılandırın.',
  },
};

/** The same failures whose text carries a transport detail or an HTTP status. */
function zoteroRuntimeError(message: string, language: unknown): string | null {
  const known = ZOTERO_LIBRARY_ERRORS[message];
  if (known) return uiText(language, known);
  const unreachable = /^No se pudo conectar con Zotero: (.+)$/.exec(message);
  if (unreachable) {
    const detail = unreachable[1];
    return uiText(language, {
      es: message,
      en: `Could not connect to Zotero: ${detail}`,
      fr: `Impossible de se connecter à Zotero : ${detail}`,
      de: `Verbindung zu Zotero nicht möglich: ${detail}`,
      pt: `Não foi possível ligar ao Zotero: ${detail}`,
      'pt-BR': `Não foi possível conectar ao Zotero: ${detail}`,
      it: `Impossibile connettersi a Zotero: ${detail}`,
      tr: `Zotero’ya bağlanılamadı: ${detail}`,
    });
  }
  const responded = /^Zotero respondió HTTP (\d+)\.$/.exec(message);
  if (responded) {
    const status = responded[1];
    return uiText(language, {
      es: message,
      en: `Zotero responded with HTTP ${status}.`,
      fr: `Zotero a répondu HTTP ${status}.`,
      de: `Zotero hat mit HTTP ${status} geantwortet.`,
      pt: `O Zotero respondeu HTTP ${status}.`,
      'pt-BR': `O Zotero respondeu HTTP ${status}.`,
      it: `Zotero ha risposto HTTP ${status}.`,
      tr: `Zotero HTTP ${status} yanıtı verdi.`,
    });
  }
  const missing = /^La biblioteca de Zotero ya no existe: .+\.$/.test(message);
  if (missing) {
    return uiText(language, {
      es: message,
      en: 'That Zotero library no longer exists.',
      fr: 'Cette bibliothèque Zotero n’existe plus.',
      de: 'Diese Zotero-Bibliothek existiert nicht mehr.',
      pt: 'Essa biblioteca do Zotero já não existe.',
      'pt-BR': 'Essa biblioteca do Zotero não existe mais.',
      it: 'Quella libreria Zotero non esiste più.',
      tr: 'Bu Zotero kitaplığı artık mevcut değil.',
    });
  }
  return null;
}

/**
 * Every failure the AI providers can hand back, translated.
 *
 * These are born in `electron/ai/aiClient.ts` as Spanish prose and travel further than
 * any other error in the app: the scan queue shows them live, and `works.deep_error` /
 * `works.notes` STORE them, so a failed analysis repeats its sentence for as long as it
 * stays failed. Unlisted, all of it collapsed into "the operation could not be
 * completed" — which is how a reader in English was told a work had failed and never
 * told that the model had simply run out of time, the one fact that points at the fix.
 *
 * Model names, provider labels, token counts and HTTP statuses are identifiers, not
 * prose: they stay verbatim in every language.
 */
const AI_PROVIDER_ERRORS: Record<string, UiTranslations> = {
  'Tiempo agotado esperando al proveedor de IA. Prueba con un modelo más rápido o un fragmento menor.': {
    es: 'Tiempo agotado esperando al proveedor de IA. Prueba con un modelo más rápido o un fragmento menor.',
    en: 'Timed out waiting for the AI provider. Try a faster model or a smaller fragment.',
    fr: 'Délai dépassé en attendant le fournisseur d’IA. Essayez un modèle plus rapide ou un fragment plus petit.',
    de: 'Zeitüberschreitung beim Warten auf den KI-Anbieter. Versuchen Sie ein schnelleres Modell oder ein kleineres Fragment.',
    pt: 'Tempo esgotado à espera do fornecedor de IA. Experimente um modelo mais rápido ou um fragmento menor.',
    'pt-BR': 'Tempo esgotado aguardando o provedor de IA. Tente um modelo mais rápido ou um fragmento menor.',
    it: 'Tempo scaduto in attesa del fornitore di IA. Prova un modello più veloce o un frammento più piccolo.',
    tr: 'Yapay zekâ sağlayıcısı beklenirken zaman aşımına uğradı. Daha hızlı bir model veya daha küçük bir parça deneyin.',
  },
  'Límite de tasa del proveedor de IA': {
    es: 'Límite de tasa del proveedor de IA',
    en: 'AI provider rate limit',
    fr: 'Limite de débit du fournisseur d’IA',
    de: 'Ratenbegrenzung des KI-Anbieters',
    pt: 'Limite de taxa do fornecedor de IA',
    'pt-BR': 'Limite de taxa do provedor de IA',
    it: 'Limite di frequenza del fornitore di IA',
    tr: 'Yapay zekâ sağlayıcısının hız sınırı',
  },
  'El proveedor rechazó la solicitud (400) sin explicar el motivo. Suele ser la clave de IA (revísala en Ajustes) o, con mucho contexto, una petición que supera el límite del modelo.': {
    es: 'El proveedor rechazó la solicitud (400) sin explicar el motivo. Suele ser la clave de IA (revísala en Ajustes) o, con mucho contexto, una petición que supera el límite del modelo.',
    en: 'The provider rejected the request (400) without explaining why. It is usually the AI key (check it in Settings) or, with a lot of context, a request that exceeds the model’s limit.',
    fr: 'Le fournisseur a rejeté la requête (400) sans expliquer pourquoi. Il s’agit généralement de la clé d’IA (vérifiez-la dans les Réglages) ou, avec beaucoup de contexte, d’une requête qui dépasse la limite du modèle.',
    de: 'Der Anbieter hat die Anfrage (400) ohne Begründung abgelehnt. Meist liegt es am KI-Schlüssel (prüfen Sie ihn in den Einstellungen) oder, bei viel Kontext, an einer Anfrage, die das Limit des Modells überschreitet.',
    pt: 'O fornecedor rejeitou o pedido (400) sem explicar o motivo. Costuma ser a chave de IA (verifique-a nas Definições) ou, com muito contexto, um pedido que excede o limite do modelo.',
    'pt-BR': 'O provedor rejeitou a solicitação (400) sem explicar o motivo. Costuma ser a chave de IA (verifique-a nas Configurações) ou, com muito contexto, uma solicitação que excede o limite do modelo.',
    it: 'Il fornitore ha rifiutato la richiesta (400) senza spiegarne il motivo. Di solito è la chiave IA (controllala nelle Impostazioni) o, con molto contesto, una richiesta che supera il limite del modello.',
    tr: 'Sağlayıcı isteği (400) gerekçe belirtmeden reddetti. Genellikle yapay zekâ anahtarıdır (Ayarlar’dan kontrol edin) veya çok fazla bağlamla modelin sınırını aşan bir istektir.',
  },
  'El modelo no tiene suficiente contexto para esta petición. Reduce el tamaño de la tarea, aumenta el contexto del modelo (Context Length / num_ctx si es local) o usa un modelo con más contexto.': {
    es: 'El modelo no tiene suficiente contexto para esta petición. Reduce el tamaño de la tarea, aumenta el contexto del modelo (Context Length / num_ctx si es local) o usa un modelo con más contexto.',
    en: 'The model does not have enough context for this request. Reduce the size of the task, raise the model’s context (Context Length / num_ctx if it is local) or use a model with more context.',
    fr: 'Le modèle n’a pas assez de contexte pour cette requête. Réduisez la taille de la tâche, augmentez le contexte du modèle (Context Length / num_ctx s’il est local) ou utilisez un modèle avec plus de contexte.',
    de: 'Das Modell hat für diese Anfrage nicht genug Kontext. Verkleinern Sie die Aufgabe, erhöhen Sie den Kontext des Modells (Context Length / num_ctx bei lokalen Modellen) oder verwenden Sie ein Modell mit mehr Kontext.',
    pt: 'O modelo não tem contexto suficiente para este pedido. Reduza o tamanho da tarefa, aumente o contexto do modelo (Context Length / num_ctx se for local) ou use um modelo com mais contexto.',
    'pt-BR': 'O modelo não tem contexto suficiente para esta solicitação. Reduza o tamanho da tarefa, aumente o contexto do modelo (Context Length / num_ctx se for local) ou use um modelo com mais contexto.',
    it: 'Il modello non ha contesto sufficiente per questa richiesta. Riduci la dimensione dell’attività, aumenta il contesto del modello (Context Length / num_ctx se è locale) o usa un modello con più contesto.',
    tr: 'Model bu istek için yeterli bağlama sahip değil. Görevin boyutunu küçültün, modelin bağlamını artırın (yerelse Context Length / num_ctx) veya daha fazla bağlamı olan bir model kullanın.',
  },
  'El JSON no cumple el esquema esperado': {
    es: 'El JSON no cumple el esquema esperado',
    en: 'The JSON does not match the expected schema',
    fr: 'Le JSON ne correspond pas au schéma attendu',
    de: 'Das JSON entspricht nicht dem erwarteten Schema',
    pt: 'O JSON não cumpre o esquema esperado',
    'pt-BR': 'O JSON não corresponde ao esquema esperado',
    it: 'Il JSON non rispetta lo schema previsto',
    tr: 'JSON beklenen şemaya uymuyor',
  },
  'Fallo de parseo JSON': {
    es: 'Fallo de parseo JSON',
    en: 'JSON parsing failed',
    fr: 'Échec de l’analyse JSON',
    de: 'JSON-Analyse fehlgeschlagen',
    pt: 'Falha na análise do JSON',
    'pt-BR': 'Falha na análise do JSON',
    it: 'Analisi del JSON non riuscita',
    tr: 'JSON ayrıştırma başarısız oldu',
  },
  'La respuesta normalizada no cumple el esquema profundo.': {
    es: 'La respuesta normalizada no cumple el esquema profundo.',
    en: 'The normalized response does not match the deep schema.',
    fr: 'La réponse normalisée ne correspond pas au schéma approfondi.',
    de: 'Die normalisierte Antwort entspricht nicht dem Tiefenschema.',
    pt: 'A resposta normalizada não cumpre o esquema profundo.',
    'pt-BR': 'A resposta normalizada não corresponde ao esquema profundo.',
    it: 'La risposta normalizzata non rispetta lo schema profondo.',
    tr: 'Normalleştirilmiş yanıt derin şemaya uymuyor.',
  },
  'El análisis profundo ha fallado.': {
    es: 'El análisis profundo ha fallado.',
    en: 'The deep analysis failed.',
    fr: 'L’analyse approfondie a échoué.',
    de: 'Die Tiefenanalyse ist fehlgeschlagen.',
    pt: 'A análise profunda falhou.',
    'pt-BR': 'A análise profunda falhou.',
    it: 'L’analisi profonda non è riuscita.',
    tr: 'Derin analiz başarısız oldu.',
  },
  'Error de IA': {
    es: 'Error de IA',
    en: 'AI error',
    fr: 'Erreur d’IA',
    de: 'KI-Fehler',
    pt: 'Erro de IA',
    'pt-BR': 'Erro de IA',
    it: 'Errore di IA',
    tr: 'Yapay zekâ hatası',
  },
};

/** The two tails `truncatedJsonMessage` appends, kept apart from their shared opening. */
function truncatedJsonTail(tail: string, language: unknown): string {
  const local = /^El espacio de salida es lo que queda de la ventana de contexto tras el prompt: amplíala en (.+?) \((.+?)\), /.exec(tail);
  if (local) {
    const [, provider, knob] = local;
    return uiText(language, {
      es: tail,
      en: `The output space is whatever is left of the context window after the prompt: widen it in ${provider} (${knob}), choose a local model with more context, or use a cloud provider for this task.`,
      fr: `L’espace de sortie correspond à ce qui reste de la fenêtre de contexte après l’invite : élargissez-la dans ${provider} (${knob}), choisissez un modèle local avec plus de contexte ou utilisez un fournisseur cloud pour cette tâche.`,
      de: `Der Ausgabespeicher ist das, was nach dem Prompt vom Kontextfenster übrig bleibt: Erweitern Sie es in ${provider} (${knob}), wählen Sie ein lokales Modell mit mehr Kontext oder verwenden Sie für diese Aufgabe einen Cloud-Anbieter.`,
      pt: `O espaço de saída é o que sobra da janela de contexto depois do prompt: aumente-a em ${provider} (${knob}), escolha um modelo local com mais contexto ou use um fornecedor na nuvem para esta tarefa.`,
      'pt-BR': `O espaço de saída é o que sobra da janela de contexto depois do prompt: aumente-a em ${provider} (${knob}), escolha um modelo local com mais contexto ou use um provedor na nuvem para esta tarefa.`,
      it: `Lo spazio di output è ciò che resta della finestra di contesto dopo il prompt: ampliala in ${provider} (${knob}), scegli un modello locale con più contesto o usa un fornitore cloud per questa attività.`,
      tr: `Çıktı alanı, istemden sonra bağlam penceresinden geriye kalandır: ${provider} içinde genişletin (${knob}), daha fazla bağlamı olan yerel bir model seçin veya bu görev için bir bulut sağlayıcısı kullanın.`,
    });
  }
  return uiText(language, {
    es: tail,
    en: 'Use a model with a higher output limit or reduce the size of the task.',
    fr: 'Utilisez un modèle avec une limite de sortie plus élevée ou réduisez la taille de la tâche.',
    de: 'Verwenden Sie ein Modell mit einem höheren Ausgabelimit oder verkleinern Sie die Aufgabe.',
    pt: 'Use um modelo com um limite de saída maior ou reduza o tamanho da tarefa.',
    'pt-BR': 'Use um modelo com um limite de saída maior ou reduza o tamanho da tarefa.',
    it: 'Usa un modello con un limite di output più alto o riduci la dimensione dell’attività.',
    tr: 'Daha yüksek çıktı sınırı olan bir model kullanın veya görevin boyutunu küçültün.',
  });
}

function aiProviderRuntimeError(message: string, language: unknown): string | null {
  const known = AI_PROVIDER_ERRORS[message];
  if (known) return uiText(language, known);

  const providerStatus = /^Error del proveedor \((\d+)\)$/.exec(message);
  if (providerStatus) {
    const status = providerStatus[1];
    return uiText(language, {
      es: message,
      en: `Provider error (${status})`,
      fr: `Erreur du fournisseur (${status})`,
      de: `Anbieterfehler (${status})`,
      pt: `Erro do fornecedor (${status})`,
      'pt-BR': `Erro do provedor (${status})`,
      it: `Errore del fornitore (${status})`,
      tr: `Sağlayıcı hatası (${status})`,
    });
  }

  const rejected = /^El proveedor rechazó la solicitud \(400\)\. Detalle: (.+)$/.exec(message);
  if (rejected) {
    const detail = rejected[1];
    return uiText(language, {
      es: message,
      en: `The provider rejected the request (400). Detail: ${detail}`,
      fr: `Le fournisseur a rejeté la requête (400). Détail : ${detail}`,
      de: `Der Anbieter hat die Anfrage (400) abgelehnt. Detail: ${detail}`,
      pt: `O fornecedor rejeitou o pedido (400). Detalhe: ${detail}`,
      'pt-BR': `O provedor rejeitou a solicitação (400). Detalhe: ${detail}`,
      it: `Il fornitore ha rifiutato la richiesta (400). Dettaglio: ${detail}`,
      tr: `Sağlayıcı isteği (400) reddetti. Ayrıntı: ${detail}`,
    });
  }

  const empty = /^Respuesta vacía del proveedor de IA \((.+)\)\.$/.exec(message);
  if (empty) {
    const reason = empty[1] === 'sin finish_reason'
      ? uiText(language, {
        es: 'sin finish_reason', en: 'no finish_reason', fr: 'sans finish_reason', de: 'ohne finish_reason',
        pt: 'sem finish_reason', 'pt-BR': 'sem finish_reason', it: 'senza finish_reason', tr: 'finish_reason yok',
      })
      : empty[1];
    return uiText(language, {
      es: message,
      en: `Empty response from the AI provider (${reason}).`,
      fr: `Réponse vide du fournisseur d’IA (${reason}).`,
      de: `Leere Antwort vom KI-Anbieter (${reason}).`,
      pt: `Resposta vazia do fornecedor de IA (${reason}).`,
      'pt-BR': `Resposta vazia do provedor de IA (${reason}).`,
      it: `Risposta vuota dal fornitore di IA (${reason}).`,
      tr: `Yapay zekâ sağlayıcısından boş yanıt (${reason}).`,
    });
  }

  const truncated = /^La respuesta de «(.+?)» \((.+?)\) se cortó al alcanzar el límite de (.+?) tokens de salida y el JSON quedó incompleto\. (.+)$/.exec(message);
  if (truncated) {
    const [, model, provider, tokens, tail] = truncated;
    const advice = truncatedJsonTail(tail, language);
    return uiText(language, {
      es: message,
      en: `The response from «${model}» (${provider}) was cut off at the ${tokens}-output-token limit and the JSON was left incomplete. ${advice}`,
      fr: `La réponse de « ${model} » (${provider}) a été coupée à la limite de ${tokens} jetons de sortie et le JSON est resté incomplet. ${advice}`,
      de: `Die Antwort von „${model}“ (${provider}) wurde beim Limit von ${tokens} Ausgabetokens abgeschnitten und das JSON blieb unvollständig. ${advice}`,
      pt: `A resposta de «${model}» (${provider}) foi cortada ao atingir o limite de ${tokens} tokens de saída e o JSON ficou incompleto. ${advice}`,
      'pt-BR': `A resposta de «${model}» (${provider}) foi cortada ao atingir o limite de ${tokens} tokens de saída e o JSON ficou incompleto. ${advice}`,
      it: `La risposta di «${model}» (${provider}) si è interrotta al limite di ${tokens} token di output e il JSON è rimasto incompleto. ${advice}`,
      tr: `«${model}» (${provider}) yanıtı ${tokens} çıktı belirteci sınırında kesildi ve JSON eksik kaldı. ${advice}`,
    });
  }

  const overflow = /^El modelo local «(.+?)» no tiene suficiente contexto para esta tarea: necesita (.+?)\. Aumenta el contexto del modelo en (.+?) \((.+?)\), elige un modelo con más contexto, reduce el tamaño de la tarea \(menos texto por lote\) o usa un proveedor en la nube para tareas grandes\.$/.exec(message);
  if (overflow) {
    const [, model, rawNeed, provider, knob] = overflow;
    const window = /\(ventana actual: (.+?) tokens\)$/.exec(rawNeed)?.[1] ?? null;
    const tokens = /^~(.+?) tokens/.exec(rawNeed)?.[1] ?? null;
    const need = (label: string, windowLabel: string) =>
      `${tokens ? `~${tokens} ${label}` : windowLabel}`;
    const currentWindow = (label: string) => (window ? ` (${label}: ${window})` : '');
    return uiText(language, {
      es: message,
      en: `The local model «${model}» does not have enough context for this task: it needs ${need('tokens', 'more tokens than fit')}${currentWindow('current window')}. Raise the model's context in ${provider} (${knob}), choose a model with more context, reduce the size of the task (less text per batch) or use a cloud provider for large tasks.`,
      fr: `Le modèle local « ${model} » n’a pas assez de contexte pour cette tâche : il lui faut ${need('jetons', 'plus de jetons qu’il n’en tient')}${currentWindow('fenêtre actuelle')}. Augmentez le contexte du modèle dans ${provider} (${knob}), choisissez un modèle avec plus de contexte, réduisez la taille de la tâche (moins de texte par lot) ou utilisez un fournisseur cloud pour les grandes tâches.`,
      de: `Das lokale Modell „${model}“ hat für diese Aufgabe nicht genug Kontext: Es benötigt ${need('Tokens', 'mehr Tokens als hineinpassen')}${currentWindow('aktuelles Fenster')}. Erhöhen Sie den Kontext des Modells in ${provider} (${knob}), wählen Sie ein Modell mit mehr Kontext, verkleinern Sie die Aufgabe (weniger Text pro Stapel) oder verwenden Sie für große Aufgaben einen Cloud-Anbieter.`,
      pt: `O modelo local «${model}» não tem contexto suficiente para esta tarefa: precisa de ${need('tokens', 'mais tokens do que cabem')}${currentWindow('janela atual')}. Aumente o contexto do modelo em ${provider} (${knob}), escolha um modelo com mais contexto, reduza o tamanho da tarefa (menos texto por lote) ou use um fornecedor na nuvem para tarefas grandes.`,
      'pt-BR': `O modelo local «${model}» não tem contexto suficiente para esta tarefa: precisa de ${need('tokens', 'mais tokens do que cabem')}${currentWindow('janela atual')}. Aumente o contexto do modelo em ${provider} (${knob}), escolha um modelo com mais contexto, reduza o tamanho da tarefa (menos texto por lote) ou use um provedor na nuvem para tarefas grandes.`,
      it: `Il modello locale «${model}» non ha contesto sufficiente per questa attività: richiede ${need('token', 'più token di quelli disponibili')}${currentWindow('finestra attuale')}. Aumenta il contesto del modello in ${provider} (${knob}), scegli un modello con più contesto, riduci la dimensione dell’attività (meno testo per lotto) o usa un fornitore cloud per le attività grandi.`,
      tr: `Yerel model «${model}» bu görev için yeterli bağlama sahip değil: ${need('belirteç', 'sığandan daha fazla belirteç')} gerekiyor${currentWindow('mevcut pencere')}. Modelin bağlamını ${provider} içinde artırın (${knob}), daha fazla bağlamı olan bir model seçin, görevin boyutunu küçültün (parti başına daha az metin) veya büyük görevler için bir bulut sağlayıcısı kullanın.`,
    });
  }

  return null;
}

/**
 * Last-resort protection for legacy Electron errors that still contain prose rather
 * than a stable error code. Specific messages should be translated by the caller;
 * unknown Spanish prose becomes a localized generic error instead of leaking Spanish.
 */
export function localizeRuntimeError(message: string, language: unknown): string {
  if (message === 'Fallo al sintetizar el audio.') {
    return uiText(language, { es: message, en: 'Audio synthesis failed.', fr: 'La synthèse audio a échoué.', de: 'Die Audiosynthese ist fehlgeschlagen.', pt: 'A síntese de áudio falhou.', 'pt-BR': 'A síntese de áudio falhou.', it: 'Sintesi audio non riuscita.', tr: 'Ses sentezi başarısız oldu.' });
  }
  if (message === 'El worker de audio falló.') {
    return uiText(language, { es: message, en: 'The audio worker failed.', fr: 'Le worker audio a échoué.', de: 'Der Audio-Worker ist fehlgeschlagen.', pt: 'O worker de áudio falhou.', 'pt-BR': 'O worker de áudio falhou.', it: 'Il worker audio non è riuscito.', tr: 'Ses çalışanı başarısız oldu.' });
  }
  if (message === 'La voz de Hume seleccionada ya no está disponible.') {
    return uiText(language, { es: message, en: 'The selected Hume voice is no longer available.', fr: 'La voix Hume sélectionnée n’est plus disponible.', de: 'Die ausgewählte Hume-Stimme ist nicht mehr verfügbar.', pt: 'A voz Hume selecionada já não está disponível.', 'pt-BR': 'A voz Hume selecionada não está mais disponível.', it: 'La voce Hume selezionata non è più disponibile.', tr: 'Seçilen Hume sesi artık kullanılamıyor.' });
  }
  if (message === 'eSpeak NG devolvió una respuesta sin fonemas') {
    return uiText(language, { es: message, en: 'eSpeak NG returned a response without phonemes.', fr: 'eSpeak NG a renvoyé une réponse sans phonèmes.', de: 'eSpeak NG hat eine Antwort ohne Phoneme zurückgegeben.', pt: 'O eSpeak NG devolveu uma resposta sem fonemas.', 'pt-BR': 'O eSpeak NG retornou uma resposta sem fonemas.', it: 'eSpeak NG ha restituito una risposta senza fonemi.', tr: 'eSpeak NG fonem içermeyen bir yanıt döndürdü.' });
  }
  if (message === 'eSpeak NG terminó sin devolver fonemas') {
    return uiText(language, { es: message, en: 'eSpeak NG finished without returning phonemes.', fr: 'eSpeak NG a terminé sans renvoyer de phonèmes.', de: 'eSpeak NG wurde beendet, ohne Phoneme zurückzugeben.', pt: 'O eSpeak NG terminou sem devolver fonemas.', 'pt-BR': 'O eSpeak NG terminou sem retornar fonemas.', it: 'eSpeak NG ha terminato senza restituire fonemi.', tr: 'eSpeak NG fonem döndürmeden tamamlandı.' });
  }
  const phonemizer = /^Error del fonetizador español de eSpeak NG: (.+)$/.exec(message);
  if (phonemizer) {
    return uiText(language, {
      es: message,
      en: `Spanish eSpeak NG phonemizer error: ${phonemizer[1]}`,
      fr: `Erreur du phonétiseur eSpeak NG espagnol : ${phonemizer[1]}`,
      de: `Fehler des spanischen eSpeak-NG-Phonetisierers: ${phonemizer[1]}`,
      pt: `Erro do fonetizador espanhol eSpeak NG: ${phonemizer[1]}`,
      'pt-BR': `Erro do fonetizador espanhol eSpeak NG: ${phonemizer[1]}`,
      it: `Errore del fonemizzatore spagnolo eSpeak NG: ${phonemizer[1]}`,
      tr: `İspanyolca eSpeak NG fonemleştirici hatası: ${phonemizer[1]}`,
    });
  }
  const unsupportedAudioWorker = /^Proveedor de audio no soportado en el worker: (.+)$/.exec(message);
  if (unsupportedAudioWorker) {
    return uiText(language, {
      es: message,
      en: `Audio provider is not supported in the worker: ${unsupportedAudioWorker[1]}`,
      fr: `Le fournisseur audio n’est pas pris en charge par le worker : ${unsupportedAudioWorker[1]}`,
      de: `Der Audioanbieter wird im Worker nicht unterstützt: ${unsupportedAudioWorker[1]}`,
      pt: `O fornecedor de áudio não é suportado pelo worker: ${unsupportedAudioWorker[1]}`,
      'pt-BR': `O provedor de áudio não é compatível com o worker: ${unsupportedAudioWorker[1]}`,
      it: `Il provider audio non è supportato dal worker: ${unsupportedAudioWorker[1]}`,
      tr: `Ses sağlayıcısı worker tarafından desteklenmiyor: ${unsupportedAudioWorker[1]}`,
    });
  }
  if (message === 'Transcripción cancelada.') {
    return uiText(language, { es: message, en: 'Transcription cancelled.', fr: 'Transcription annulée.', de: 'Transkription abgebrochen.', pt: 'Transcrição cancelada.', 'pt-BR': 'Transcrição cancelada.', it: 'Trascrizione annullata.', tr: 'Transkripsiyon iptal edildi.' });
  }
  if (message === 'Detección de hablantes cancelada.') {
    return uiText(language, { es: message, en: 'Speaker detection cancelled.', fr: 'Détection des locuteurs annulée.', de: 'Sprechererkennung abgebrochen.', pt: 'Deteção de oradores cancelada.', 'pt-BR': 'Detecção de falantes cancelada.', it: 'Rilevamento degli interlocutori annullato.', tr: 'Konuşmacı algılama iptal edildi.' });
  }
  if (message === 'No se encontró el conector integrado. En desarrollo, ejecuta "npm run browser:zip".') {
    return uiText(language, { es: message, en: 'The bundled connector was not found. In development, run "npm run browser:zip".', fr: 'Le connecteur intégré est introuvable. En développement, exécutez « npm run browser:zip ».', de: 'Der integrierte Connector wurde nicht gefunden. Führen Sie in der Entwicklung „npm run browser:zip“ aus.', pt: 'O conector integrado não foi encontrado. Em desenvolvimento, execute «npm run browser:zip».', 'pt-BR': 'O conector integrado não foi encontrado. Em desenvolvimento, execute "npm run browser:zip".', it: 'Il connettore integrato non è stato trovato. In sviluppo, esegui «npm run browser:zip».', tr: 'Dahili bağlayıcı bulunamadı. Geliştirme sırasında "npm run browser:zip" komutunu çalıştırın.' });
  }
  if (message === 'Las funciones de IA del vault de estudio están desactivadas en Ajustes.') {
    return uiText(language, { es: message, en: 'Study vault AI features are disabled in Settings.', fr: 'Les fonctions d’IA du coffre d’étude sont désactivées dans les Réglages.', de: 'Die KI-Funktionen des Lernarchivs sind in den Einstellungen deaktiviert.', pt: 'As funções de IA do arquivo de estudo estão desativadas nas Definições.', 'pt-BR': 'Os recursos de IA do vault de estudo estão desativados nas Configurações.', it: 'Le funzioni IA del vault di studio sono disattivate nelle Impostazioni.', tr: 'Çalışma kasasının yapay zekâ özellikleri Ayarlar’da devre dışı.' });
  }
  const localOnly = /^El modo local \(«solo modelos locales»\) impide usar (.+)\.$/.exec(message);
  if (localOnly) {
    const [, provider] = localOnly;
    return uiText(language, { es: message, en: `Local-only mode cannot use ${provider}.`, fr: `Le mode local uniquement ne peut pas utiliser ${provider}.`, de: `Der Nur-lokal-Modus kann ${provider} nicht verwenden.`, pt: `O modo apenas local não pode usar ${provider}.`, 'pt-BR': `O modo somente local não pode usar ${provider}.`, it: `La modalità solo locale non può usare ${provider}.`, tr: `Yalnızca yerel mod ${provider} sağlayıcısını kullanamaz.` });
  }
  const externalOnly = /^El modo externo requiere un proveedor remoto; (.+) es local\.$/.exec(message);
  if (externalOnly) {
    const [, provider] = externalOnly;
    return uiText(language, { es: message, en: `External-only mode requires a remote provider; ${provider} is local.`, fr: `Le mode externe uniquement exige un fournisseur distant ; ${provider} est local.`, de: `Der Nur-extern-Modus erfordert einen entfernten Anbieter; ${provider} ist lokal.`, pt: `O modo apenas externo requer um fornecedor remoto; ${provider} é local.`, 'pt-BR': `O modo somente externo requer um provedor remoto; ${provider} é local.`, it: `La modalità solo esterna richiede un fornitore remoto; ${provider} è locale.`, tr: `Yalnızca harici mod uzak bir sağlayıcı gerektirir; ${provider} yerel.` });
  }
  if (message === 'Esta asignatura está excluida del procesamiento externo. Usa un modelo local o elimina la exclusión en Ajustes.') {
    return uiText(language, { es: message, en: 'This subject is excluded from external processing. Use a local model or remove the exclusion in Settings.', fr: 'Cette matière est exclue du traitement externe. Utilisez un modèle local ou retirez l’exclusion dans les Réglages.', de: 'Dieses Fach ist von der externen Verarbeitung ausgeschlossen. Verwenden Sie ein lokales Modell oder entfernen Sie den Ausschluss in den Einstellungen.', pt: 'Esta disciplina está excluída do processamento externo. Use um modelo local ou remova a exclusão nas Definições.', 'pt-BR': 'Esta disciplina está excluída do processamento externo. Use um modelo local ou remova a exclusão nas Configurações.', it: 'Questa materia è esclusa dall’elaborazione esterna. Usa un modello locale o rimuovi l’esclusione nelle Impostazioni.', tr: 'Bu ders harici işleme dışında bırakıldı. Yerel bir model kullanın veya Ayarlar’dan dışlamayı kaldırın.' });
  }
  const inputLimit = /^La solicitud supera el límite configurado de (.+) caracteres\.$/.exec(message);
  if (inputLimit) {
    const [, count] = inputLimit;
    return uiText(language, { es: message, en: `The request exceeds the configured limit of ${count} characters.`, fr: `La demande dépasse la limite configurée de ${count} caractères.`, de: `Die Anfrage überschreitet das konfigurierte Limit von ${count} Zeichen.`, pt: `O pedido excede o limite configurado de ${count} caracteres.`, 'pt-BR': `A solicitação excede o limite configurado de ${count} caracteres.`, it: `La richiesta supera il limite configurato di ${count} caratteri.`, tr: `İstek, yapılandırılmış ${count} karakterlik sınırı aşıyor.` });
  }
  if (message === 'Se ha alcanzado el presupuesto mensual de IA para estudio.') {
    return uiText(language, { es: message, en: 'The monthly study AI budget has been reached.', fr: 'Le budget mensuel d’IA pour l’étude a été atteint.', de: 'Das monatliche Lern-KI-Budget wurde erreicht.', pt: 'O orçamento mensal de IA para estudo foi atingido.', 'pt-BR': 'O orçamento mensal de IA para estudo foi atingido.', it: 'Il budget mensile per l’IA di studio è stato raggiunto.', tr: 'Aylık çalışma yapay zekâ bütçesine ulaşıldı.' });
  }
  if (message === 'Envío externo cancelado por el usuario.') {
    return uiText(language, { es: message, en: 'External send cancelled by the user.', fr: 'Envoi externe annulé par l’utilisateur.', de: 'Externe Übermittlung vom Nutzer abgebrochen.', pt: 'Envio externo cancelado pelo utilizador.', 'pt-BR': 'Envio externo cancelado pelo usuário.', it: 'Invio esterno annullato dall’utente.', tr: 'Harici gönderim kullanıcı tarafından iptal edildi.' });
  }
  if (message === 'E2E: proveedor de IA no disponible.') {
    return uiText(language, { es: message, en: 'E2E: AI provider unavailable.', fr: 'E2E : fournisseur d’IA indisponible.', de: 'E2E: KI-Anbieter nicht verfügbar.', pt: 'E2E: fornecedor de IA indisponível.', 'pt-BR': 'E2E: provedor de IA indisponível.', it: 'E2E: fornitore IA non disponibile.', tr: 'E2E: yapay zekâ sağlayıcısı kullanılamıyor.' });
  }
  if (message === 'No fue posible completar la tarea de IA.') {
    return uiText(language, { es: message, en: 'The AI task could not be completed.', fr: 'La tâche d’IA n’a pas pu être terminée.', de: 'Die KI-Aufgabe konnte nicht abgeschlossen werden.', pt: 'Não foi possível concluir a tarefa de IA.', 'pt-BR': 'Não foi possível concluir a tarefa de IA.', it: 'Non è stato possibile completare l’attività IA.', tr: 'Yapay zekâ görevi tamamlanamadı.' });
  }
  if (message === 'No hay un modelo de IA configurado. Elige uno en Ajustes.') {
    return uiText(language, {
      es: message,
      en: 'No AI model is configured. Choose one in Settings.',
      fr: 'Aucun modèle d’IA n’est configuré. Choisissez-en un dans les Réglages.',
      de: 'Es ist kein KI-Modell konfiguriert. Wählen Sie eines in den Einstellungen aus.',
      pt: 'Não há nenhum modelo de IA configurado. Escolha um nas Definições.',
      'pt-BR': 'Nenhum modelo de IA está configurado. Escolha um nas Configurações.',
      it: 'Non è configurato alcun modello di IA. Scegline uno nelle Impostazioni.',
      tr: 'Yapılandırılmış bir yapay zekâ modeli yok. Ayarlar’dan bir model seçin.',
    });
  }
  if (message === 'Clave de IA inválida. Revísala en Ajustes.') {
    return uiText(language, {
      es: message,
      en: 'The AI key is invalid. Check it in Settings.',
      fr: 'La clé d’IA n’est pas valide. Vérifiez-la dans les Réglages.',
      de: 'Der KI-Schlüssel ist ungültig. Prüfen Sie ihn in den Einstellungen.',
      pt: 'A chave de IA é inválida. Verifique-a nas Definições.',
      'pt-BR': 'A chave de IA é inválida. Verifique-a nas Configurações.',
      it: 'La chiave IA non è valida. Controllala nelle Impostazioni.',
      tr: 'Yapay zekâ anahtarı geçersiz. Ayarlar’dan kontrol edin.',
    });
  }
  const missingKey = /^Falta la clave de IA para (.+)\. Configúrala en Ajustes\.$/.exec(message);
  if (missingKey) {
    const provider = missingKey[1];
    return uiText(language, {
      es: message,
      en: `The AI key for ${provider} is missing. Configure it in Settings.`,
      fr: `La clé d’IA pour ${provider} est manquante. Configurez-la dans les Réglages.`,
      de: `Der KI-Schlüssel für ${provider} fehlt. Konfigurieren Sie ihn in den Einstellungen.`,
      pt: `Falta a chave de IA para ${provider}. Configure-a nas Definições.`,
      'pt-BR': `Falta a chave de IA para ${provider}. Configure-a nas Configurações.`,
      it: `Manca la chiave IA per ${provider}. Configurala nelle Impostazioni.`,
      tr: `${provider} için yapay zekâ anahtarı eksik. Ayarlar’dan yapılandırın.`,
    });
  }
  if (message === 'La fuente cambió repetidamente durante el análisis. La campaña se ha pausado para evitar reintentos indefinidos.') {
    return uiText(language, {
      es: message,
      en: 'The document source kept changing during analysis. Indexing was paused to prevent endless retries.',
      fr: 'La source du document a changé à plusieurs reprises pendant l’analyse. L’indexation a été suspendue pour éviter des tentatives sans fin.',
      de: 'Die Dokumentquelle hat sich während der Analyse wiederholt geändert. Die Indizierung wurde pausiert, um endlose Wiederholungen zu vermeiden.',
      pt: 'A fonte do documento mudou repetidamente durante a análise. A indexação foi pausada para evitar tentativas intermináveis.',
      'pt-BR': 'A fonte do documento mudou repetidamente durante a análise. A indexação foi pausada para evitar tentativas intermináveis.',
      it: 'La fonte del documento è cambiata ripetutamente durante l’analisi. L’indicizzazione è stata sospesa per evitare tentativi infiniti.',
      tr: 'Belge kaynağı analiz sırasında tekrar tekrar değişti. Sonsuz yeniden denemeleri önlemek için dizin oluşturma duraklatıldı.',
    });
  }
  if (message === 'La fuente sigue cambiando. Reanuda cuando la sincronización haya terminado.') {
    return uiText(language, {
      es: message,
      en: 'The source is still changing. Resume after synchronization has finished.',
      fr: 'La source continue de changer. Reprenez une fois la synchronisation terminée.',
      de: 'Die Quelle ändert sich weiterhin. Setzen Sie den Vorgang fort, sobald die Synchronisierung abgeschlossen ist.',
      pt: 'A fonte continua a mudar. Retome quando a sincronização terminar.',
      'pt-BR': 'A fonte continua mudando. Retome quando a sincronização terminar.',
      it: 'La fonte continua a cambiare. Riprendi al termine della sincronizzazione.',
      tr: 'Kaynak değişmeye devam ediyor. Eşitleme tamamlandıktan sonra devam edin.',
    });
  }
  const zoteroFailure = zoteroRuntimeError(message, language);
  if (zoteroFailure) return zoteroFailure;
  const providerFailure = aiProviderRuntimeError(message, language);
  if (providerFailure) return providerFailure;
  if (!looksLikeSpanishUiText(message)) return message;
  return uiText(language, {
    es: message,
    en: 'The operation could not be completed.',
    fr: 'L’opération n’a pas pu être effectuée.',
    de: 'Der Vorgang konnte nicht abgeschlossen werden.',
    pt: 'Não foi possível concluir a operação.',
    'pt-BR': 'Não foi possível concluir a operação.',
    it: 'Non è stato possibile completare l’operazione.',
    tr: 'İşlem tamamlanamadı.',
  });
}

/**
 * Why an image could not be generated.
 *
 * These differ from every other Electron error in one decisive way: they are STORED.
 * A failed decorative image keeps its reason in the vault and shows it days later, so
 * the generic "the operation could not be completed" fallback would erase the only
 * clue the user has about which provider refused and why — while the messages the
 * fallback happens not to recognise (`ChatGPT no pudo generar la imagen.` carries no
 * diacritic and only one function word) leaked Spanish into an English interface.
 * Both failure modes have the same fix: hand the sentence to the renderer untouched
 * and let t() translate it. Every string here is a key in src/i18n.*.ts, which
 * scripts/test-i18n-coverage.mjs holds to full coverage in all seven languages.
 */
export const IMAGE_GENERATION_ERROR_MESSAGES = [
  // Codex / ChatGPT subscription.
  'ChatGPT no pudo generar la imagen.',
  'ChatGPT terminó la petición sin generar ninguna imagen.',
  'ChatGPT no generó la imagen dentro del tiempo esperado.',
  'ChatGPT devolvió una imagen vacía.',
  'La generación de imagen de Codex no llegó a completarse.',
  'Codex intentó usar una herramienta deshabilitada; Nodus interrumpió la petición.',
  'El modelo de imagen elegido ya no está en el catálogo de ChatGPT. Elige otro en Proveedores y modelos.',
  'La suscripción de ChatGPT no está conectada. Ábrela en Proveedores y modelos.',
  // Direct API providers.
  'Falta la clave de Google.',
  'Falta la clave de OpenAI.',
  'Falta la clave de OpenRouter.',
  'Google no devolvió datos de imagen.',
  'El proveedor no devolvió datos de imagen.',
  // Local engine.
  'El prompt de imagen está vacío.',
  'El motor local no produjo una imagen.',
  'Instala el motor local de imágenes antes de generar.',
  'Descarga FLUX.2 Klein 4B Q4 en Ajustes → Modelos IA antes de generar imágenes locales.',
  // Nodus' own preconditions and interruptions.
  'No hay proveedor o modelo de imagen seleccionado.',
  'No hay un modelo de texto configurado para crear el contexto visual.',
  'El modelo de texto no devolvió un contexto visual.',
  'La generación de imagen se canceló.',
  'La generación superó el tiempo máximo. Puedes reintentarlo manualmente.',
  'La generación se interrumpió al cambiar de bóveda o cerrar la aplicación. Puedes reintentarlo manualmente.',
  'La inmersión ya no existe.',
  'El informe guardado ya no existe.',
];

/**
 * The three sentences the bottom progress bars use to say what a run is DOING, not
 * that it broke. They travel in a field called `error`, so they were localized as
 * failures: two became the generic "the operation could not be completed" — an idle
 * embedding queue announcing a crash that never happened — and the third leaked
 * Spanish into every other interface. They are keys in src/i18n.*.ts, translated by
 * tr() where they are rendered.
 */
export const PROGRESS_STATE_MESSAGES = [
  'No hay obras con análisis profundo para indexar.',
  'No hay obras disponibles para indexar.',
  'La obra ya no existe.',
];

/**
 * The Zotero import readout, exactly as `electron/library/zoteroLibraryImport.ts`
 * writes it.
 *
 * It travels in a field called `message`, so it used to be treated as an error like
 * any other and a perfectly healthy import told a non-Spanish reader one of two
 * wrong things: the Spanish sentence verbatim (`Copiando y verificando adjuntos…`
 * carries too few function words to be detected as Spanish) or the generic "the
 * operation could not be completed" (`Catálogo listo…` carries an accent, so it IS
 * detected — and a progress step became a failure on screen). Neither is a failure,
 * and neither is the progress the bar exists to show. These sentences are keys in
 * src/i18n.*.ts instead: tr() translates them in the renderer, where the library and
 * item names they carry pass through untouched.
 */
export const ZOTERO_IMPORT_PROGRESS_MESSAGES = [
  'Conectando con Zotero…',
  'Catálogo listo; reconciliando notas…',
  'Copiando y verificando adjuntos…',
  'Verificando el índice local…',
  'Finalizando claves de cita y cola de extracción…',
  'Importación de Zotero completada y verificada.',
  'Importación cancelada; el catálogo ya importado se conserva.',
];

/** The same readout while it names the library or the item it is working through. */
export const ZOTERO_IMPORT_PROGRESS_PATTERNS = [
  /^Inventariando .+…$/,
  /^Reconciliando colecciones de .+…$/,
  /^Catálogo disponible: .+$/,
  /^Notas: .+$/,
  /^Adjuntos: .+$/,
  /^Verificando .+ contra el inventario…$/,
];

const RENDERER_TRANSLATED_MESSAGES = new Set([
  ...IMAGE_GENERATION_ERROR_MESSAGES,
  ...ZOTERO_IMPORT_PROGRESS_MESSAGES,
  ...PROGRESS_STATE_MESSAGES,
  'Bóveda no encontrada.',
  'No se encontró la bóveda de origen de las claves API.',
  'Esta bóveda ya está cargada.',
  'Bóveda cargada.',
  'No se puede cambiar de bóveda con la cola de análisis activa. Pausa o termina los trabajos pendientes antes de cargar otra bóveda.',
  'No se puede cambiar de bóveda mientras se están indexando embeddings de ideas.',
  'No se puede cambiar de bóveda mientras se están indexando pasajes.',
  'No se puede cambiar de bóveda mientras se descubren relaciones semánticas.',
]);

function isRendererTranslatedMessage(message: string): boolean {
  if (RENDERER_TRANSLATED_MESSAGES.has(message)) return true;
  if (ZOTERO_IMPORT_PROGRESS_PATTERNS.some((pattern) => pattern.test(message))) return true;
  // A queue item counting down its own retries is a progress readout too.
  if (/^Reintentando \(\d+\/\d+\)…$/.test(message)) return true;
  return /^(?:Esta bóveda ya está cargada\.|Bóveda cargada\.) Claves API copiadas: \d+\.$/.test(message);
}

/**
 * Localize legacy `message`/`error` fields returned as ordinary IPC payloads.
 * Domain content and user-authored title/body fields are deliberately untouched.
 */
export function localizeIpcPayload<T>(value: T, language: unknown): T {
  // Every one of the ~732 IPC handlers passes its result through here, so this
  // runs over entire result sets — a databases view can be 7,000 rows of nested
  // cells. The previous implementation rebuilt every object and array
  // unconditionally (`Object.entries` → `map` → `Object.fromEntries`), which
  // allocated a fresh copy of the whole payload on every call even though the
  // overwhelming majority contain no `message`/`error` field at all.
  //
  // The structure still has to be walked to find those fields, but nothing is
  // allocated unless something actually changed: unchanged subtrees are
  // returned by identity and shared with the original. `for...in` is used over
  // `Object.entries` for the same reason — no intermediate arrays.
  if (Array.isArray(value)) {
    let localizedItems: unknown[] | null = null;
    for (let index = 0; index < value.length; index += 1) {
      const entry = value[index];
      const next = localizeIpcPayload(entry, language);
      if (next !== entry && localizedItems === null) localizedItems = value.slice(0, index);
      if (localizedItems !== null) localizedItems.push(next);
    }
    return (localizedItems ?? value) as T;
  }
  if (!value || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  const record = value as Record<string, unknown>;
  let localized: Record<string, unknown> | null = null;
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const entry = record[key];
    const next =
      (key === 'message' || key === 'error') &&
      typeof entry === 'string' &&
      !isRendererTranslatedMessage(entry)
        ? localizeRuntimeError(entry, language)
        : localizeIpcPayload(entry, language);
    if (next === entry) {
      if (localized !== null) localized[key] = next;
      continue;
    }
    if (localized === null) {
      // First change in this object: copy what we have skipped so far.
      localized = {};
      for (const seen in record) {
        if (!Object.prototype.hasOwnProperty.call(record, seen)) continue;
        if (seen === key) break;
        localized[seen] = record[seen];
      }
    }
    localized[key] = next;
  }
  return (localized ?? value) as T;
}
