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
 * Last-resort protection for legacy Electron errors that still contain prose rather
 * than a stable error code. Specific messages should be translated by the caller;
 * unknown Spanish prose becomes a localized generic error instead of leaking Spanish.
 */
export function localizeRuntimeError(message: string, language: unknown): string {
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

const RENDERER_TRANSLATED_MESSAGES = new Set([
  ...IMAGE_GENERATION_ERROR_MESSAGES,
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
