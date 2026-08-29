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
