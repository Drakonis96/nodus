import type { PromptLanguage } from './types';

/**
 * The "extensión orientativa de cada sección" guidance, written natively in every
 * language Nodus writes reports in.
 *
 * A report is written in the language of the request, so the steer has to reach the
 * model in that language too — a Spanish sentence appended to a Turkish prompt is
 * both a translation bug and a quality one, because the writer then answers in the
 * language of the last instruction it understood.
 *
 * Every string states the same three things, and none of them may be softened when
 * a language is added: the number is a WORD target per section, it is an editorial
 * orientation and not a quota, and the writer must stop early rather than repeat,
 * pad, invent or over-claim to reach it.
 */
export interface DeepResearchLengthPromptPack {
  /** Steer for a whole-section writer. */
  section(words: number): string;
  /** Steer for the per-paragraph writer used by the academic evidence pipeline. */
  paragraph(words: number): string;
  /** Steer for a planner that decides how many evidence paragraphs to design. */
  evidencePlan(paragraphs: number, words: number): string;
  /** Steer for a planner that only shapes section purposes/claims. */
  plan(words: number): string;
  /** Instruction for one bounded continuation call. */
  continuation(remainingWords: number, passWords: number): string;
  /** Explicit permission to return nothing when the evidence is spent. */
  continuationStop: string;
  /** Line added to the MCP client writing kit. */
  clientKit(words: number): string;
}

const PACKS: Record<PromptLanguage, DeepResearchLengthPromptPack> = {
  es: {
    section: (words) =>
      `Extensión orientativa de esta sección: alrededor de ${words.toLocaleString('es-ES')} palabras. Es una orientación editorial, no una cuota: desarrolla con más detenimiento los mecanismos, las comparaciones y los límites probatorios que la evidencia disponible sostenga. Si el material se agota antes, termina la sección; no repitas, no rellenes, no inventes ni conviertas una inferencia en un hecho para alcanzar la cifra.`,
    paragraph: (words) =>
      `Extensión orientativa de este párrafo: alrededor de ${words.toLocaleString('es-ES')} palabras. Alcánzala explicando el mecanismo y precisando el alcance de la evidencia citada, nunca añadiendo afirmaciones sin respaldo ni repitiendo lo ya dicho.`,
    evidencePlan: (paragraphs, words) =>
      `El informe pide secciones de unas ${words.toLocaleString('es-ES')} palabras, es decir, del orden de ${paragraphs} párrafos con función inferencial propia. Diseña tantos párrafos distintos como el menú de evidencias permita sostener, hasta ese orden de magnitud. Si el material solo da para menos, planifica menos: nunca dupliques una función ni asignes una evidencia a dos párrafos para llegar a la cifra.`,
    plan: (words) =>
      `Cada sección se redactará con una extensión orientativa de unas ${words.toLocaleString('es-ES')} palabras. Dale a cada sección un propósito y unas afirmaciones lo bastante amplios para sostener ese desarrollo con la evidencia disponible, sin trocear el argumento ni prometer contenido que el corpus no respalde.`,
    continuation: (remaining, pass) =>
      `Continúa esta misma sección exactamente donde termina. Faltan unas ${remaining.toLocaleString('es-ES')} palabras para la extensión orientativa; escribe ahora alrededor de ${pass.toLocaleString('es-ES')}. No repitas el encabezado, no resumas lo ya escrito y no reabras un argumento cerrado: aporta material nuevo y respaldado, con sus citas exactas del menú, en párrafos completos que encadenen con el último.`,
    continuationStop:
      'Si el menú de evidencias ya no permite añadir nada sustantivo sin repetirte, sin rellenar o sin afirmar algo que las fuentes no sostengan, responde exactamente CONTINUACION_VACIA y nada más.',
    clientKit: (words) =>
      `Extensión orientativa: alrededor de ${words.toLocaleString('es-ES')} palabras por sección. Es una orientación editorial, no una cuota; detente antes si el catálogo se agota y no rellenes ni repitas para alcanzarla.`,
  },
  en: {
    section: (words) =>
      `Guideline length for this section: around ${words.toLocaleString('en-US')} words. This is editorial guidance, not a quota: spend it developing mechanisms, comparisons and evidentiary limits that the available evidence actually sustains. If the material runs out first, end the section; do not repeat, pad, invent, or turn an inference into a fact to reach the number.`,
    paragraph: (words) =>
      `Guideline length for this paragraph: around ${words.toLocaleString('en-US')} words. Reach it by explaining the mechanism and stating the exact scope of the cited evidence, never by adding unsupported claims or restating what has already been said.`,
    evidencePlan: (paragraphs, words) =>
      `The report asks for sections of roughly ${words.toLocaleString('en-US')} words, i.e. on the order of ${paragraphs} paragraphs each with its own inferential function. Design as many distinct paragraphs as the evidence menu can sustain, up to that order of magnitude. If the material supports fewer, plan fewer: never duplicate a function or assign one piece of evidence to two paragraphs to reach the number.`,
    plan: (words) =>
      `Each section will be written to a guideline length of roughly ${words.toLocaleString('en-US')} words. Give every section a purpose and claims broad enough to sustain that development from the available evidence, without fragmenting the argument or promising content the corpus cannot support.`,
    continuation: (remaining, pass) =>
      `Continue this same section exactly where it stops. About ${remaining.toLocaleString('en-US')} words remain before the guideline length; write roughly ${pass.toLocaleString('en-US')} now. Do not repeat the heading, do not summarize what is already written, and do not reopen a closed argument: add new, supported material with its exact citations from the menu, in complete paragraphs that follow on from the last one.`,
    continuationStop:
      'If the evidence menu no longer allows anything substantive to be added without repeating yourself, padding, or claiming something the sources do not support, answer exactly EMPTY_CONTINUATION and nothing else.',
    clientKit: (words) =>
      `Guideline length: around ${words.toLocaleString('en-US')} words per section. It is editorial guidance, not a quota; stop earlier if the catalog is exhausted and never pad or repeat to reach it.`,
  },
  fr: {
    section: (words) =>
      `Longueur indicative de cette section : environ ${words.toLocaleString('fr-FR')} mots. C’est une orientation éditoriale, pas un quota : consacrez-la à développer les mécanismes, les comparaisons et les limites probatoires que les preuves disponibles soutiennent réellement. Si la matière s’épuise avant, terminez la section ; ne répétez pas, ne remplissez pas, n’inventez pas et ne transformez pas une inférence en fait pour atteindre le chiffre.`,
    paragraph: (words) =>
      `Longueur indicative de ce paragraphe : environ ${words.toLocaleString('fr-FR')} mots. Atteignez-la en expliquant le mécanisme et en précisant la portée exacte des preuves citées, jamais en ajoutant des affirmations non étayées ni en répétant ce qui a déjà été dit.`,
    evidencePlan: (paragraphs, words) =>
      `Le rapport demande des sections d’environ ${words.toLocaleString('fr-FR')} mots, soit de l’ordre de ${paragraphs} paragraphes ayant chacun sa propre fonction inférentielle. Concevez autant de paragraphes distincts que le menu de preuves permet de soutenir, jusqu’à cet ordre de grandeur. Si la matière n’en autorise que moins, planifiez-en moins : ne dupliquez jamais une fonction et n’attribuez pas une même preuve à deux paragraphes pour atteindre le chiffre.`,
    plan: (words) =>
      `Chaque section sera rédigée avec une longueur indicative d’environ ${words.toLocaleString('fr-FR')} mots. Donnez à chaque section un objectif et des affirmations assez larges pour soutenir ce développement à partir des preuves disponibles, sans fragmenter l’argument ni promettre un contenu que le corpus ne peut étayer.`,
    continuation: (remaining, pass) =>
      `Poursuivez cette même section exactement là où elle s’arrête. Il reste environ ${remaining.toLocaleString('fr-FR')} mots avant la longueur indicative ; écrivez-en à peu près ${pass.toLocaleString('fr-FR')} maintenant. Ne répétez pas le titre, ne résumez pas ce qui est déjà écrit et ne rouvrez pas un argument clos : apportez un matériau nouveau et étayé, avec ses citations exactes du menu, en paragraphes complets qui s’enchaînent avec le dernier.`,
    continuationStop:
      'Si le menu de preuves ne permet plus d’ajouter quoi que ce soit de substantiel sans vous répéter, sans remplir ou sans affirmer ce que les sources n’étayent pas, répondez exactement CONTINUATION_VIDE et rien d’autre.',
    clientKit: (words) =>
      `Longueur indicative : environ ${words.toLocaleString('fr-FR')} mots par section. C’est une orientation éditoriale, pas un quota ; arrêtez-vous plus tôt si le catalogue est épuisé et ne remplissez ni ne répétez pour l’atteindre.`,
  },
  de: {
    section: (words) =>
      `Richtwert für die Länge dieses Abschnitts: etwa ${words.toLocaleString('de-DE')} Wörter. Das ist eine redaktionelle Orientierung, keine Quote: Nutzen Sie sie, um Mechanismen, Vergleiche und Belegsgrenzen auszuarbeiten, die das vorhandene Material tatsächlich trägt. Geht das Material vorher aus, beenden Sie den Abschnitt; wiederholen Sie nichts, füllen Sie nicht auf, erfinden Sie nichts und machen Sie aus einer Schlussfolgerung keine Tatsache, um die Zahl zu erreichen.`,
    paragraph: (words) =>
      `Richtwert für die Länge dieses Absatzes: etwa ${words.toLocaleString('de-DE')} Wörter. Erreichen Sie ihn, indem Sie den Mechanismus erklären und die genaue Reichweite der zitierten Belege benennen, niemals durch ungestützte Aussagen oder Wiederholungen.`,
    evidencePlan: (paragraphs, words) =>
      `Der Bericht verlangt Abschnitte von rund ${words.toLocaleString('de-DE')} Wörtern, also in der Größenordnung von ${paragraphs} Absätzen mit jeweils eigener Schlussfunktion. Entwerfen Sie so viele unterschiedliche Absätze, wie das Belegmenü tragen kann, bis zu dieser Größenordnung. Trägt das Material weniger, planen Sie weniger: Doppeln Sie niemals eine Funktion und weisen Sie denselben Beleg nicht zwei Absätzen zu, um die Zahl zu erreichen.`,
    plan: (words) =>
      `Jeder Abschnitt wird mit einem Längenrichtwert von rund ${words.toLocaleString('de-DE')} Wörtern geschrieben. Geben Sie jedem Abschnitt einen Zweck und Aussagen, die breit genug sind, um diese Ausarbeitung aus den vorhandenen Belegen zu tragen, ohne das Argument zu zerstückeln oder Inhalte zu versprechen, die das Korpus nicht stützt.`,
    continuation: (remaining, pass) =>
      `Setzen Sie genau diesen Abschnitt dort fort, wo er endet. Bis zum Längenrichtwert fehlen noch etwa ${remaining.toLocaleString('de-DE')} Wörter; schreiben Sie jetzt rund ${pass.toLocaleString('de-DE')}. Wiederholen Sie die Überschrift nicht, fassen Sie das bereits Geschriebene nicht zusammen und öffnen Sie kein abgeschlossenes Argument erneut: Bringen Sie neues, belegtes Material mit den exakten Zitaten aus dem Menü, in vollständigen Absätzen, die an den letzten anschließen.`,
    continuationStop:
      'Wenn das Belegmenü nichts Substanzielles mehr zulässt, ohne dass Sie sich wiederholen, auffüllen oder etwas behaupten, das die Quellen nicht stützen, antworten Sie genau LEERE_FORTSETZUNG und sonst nichts.',
    clientKit: (words) =>
      `Längenrichtwert: etwa ${words.toLocaleString('de-DE')} Wörter pro Abschnitt. Das ist eine redaktionelle Orientierung, keine Quote; hören Sie früher auf, wenn der Katalog erschöpft ist, und füllen oder wiederholen Sie nie, um ihn zu erreichen.`,
  },
  pt: {
    section: (words) =>
      `Extensão orientativa desta secção: cerca de ${words.toLocaleString('pt-PT')} palavras. É uma orientação editorial, não uma quota: aproveita-a para desenvolver os mecanismos, as comparações e os limites probatórios que a evidência disponível realmente sustenta. Se o material se esgotar antes, termina a secção; não repitas, não enches, não inventes nem transformes uma inferência num facto para atingir o número.`,
    paragraph: (words) =>
      `Extensão orientativa deste parágrafo: cerca de ${words.toLocaleString('pt-PT')} palavras. Atinge-a explicando o mecanismo e precisando o alcance exato da evidência citada, nunca acrescentando afirmações sem apoio nem repetindo o que já foi dito.`,
    evidencePlan: (paragraphs, words) =>
      `O relatório pede secções de cerca de ${words.toLocaleString('pt-PT')} palavras, ou seja, na ordem de ${paragraphs} parágrafos com função inferencial própria. Desenha tantos parágrafos distintos quantos o menu de evidências permitir sustentar, até essa ordem de grandeza. Se o material só der para menos, planeia menos: nunca dupliques uma função nem atribuas a mesma evidência a dois parágrafos para chegar ao número.`,
    plan: (words) =>
      `Cada secção será redigida com uma extensão orientativa de cerca de ${words.toLocaleString('pt-PT')} palavras. Dá a cada secção um propósito e afirmações suficientemente amplos para sustentar esse desenvolvimento a partir da evidência disponível, sem fragmentar o argumento nem prometer conteúdo que o corpus não suporte.`,
    continuation: (remaining, pass) =>
      `Continua esta mesma secção exatamente onde ela termina. Faltam cerca de ${remaining.toLocaleString('pt-PT')} palavras para a extensão orientativa; escreve agora aproximadamente ${pass.toLocaleString('pt-PT')}. Não repitas o cabeçalho, não resumas o que já está escrito e não reabras um argumento encerrado: acrescenta material novo e sustentado, com as citações exatas do menu, em parágrafos completos que encadeiem com o último.`,
    continuationStop:
      'Se o menu de evidências já não permitir acrescentar nada de substantivo sem te repetires, sem encher ou sem afirmar algo que as fontes não sustentam, responde exatamente CONTINUACAO_VAZIA e mais nada.',
    clientKit: (words) =>
      `Extensão orientativa: cerca de ${words.toLocaleString('pt-PT')} palavras por secção. É uma orientação editorial, não uma quota; para mais cedo se o catálogo se esgotar e nunca enchas nem repitas para a atingir.`,
  },
  'pt-BR': {
    section: (words) =>
      `Extensão orientativa desta seção: cerca de ${words.toLocaleString('pt-BR')} palavras. É uma orientação editorial, não uma cota: use-a para desenvolver os mecanismos, as comparações e os limites probatórios que a evidência disponível realmente sustenta. Se o material acabar antes, encerre a seção; não repita, não encha linguiça, não invente nem transforme uma inferência em fato para atingir o número.`,
    paragraph: (words) =>
      `Extensão orientativa deste parágrafo: cerca de ${words.toLocaleString('pt-BR')} palavras. Alcance-a explicando o mecanismo e precisando o alcance exato da evidência citada, nunca acrescentando afirmações sem respaldo nem repetindo o que já foi dito.`,
    evidencePlan: (paragraphs, words) =>
      `O relatório pede seções de cerca de ${words.toLocaleString('pt-BR')} palavras, ou seja, na ordem de ${paragraphs} parágrafos com função inferencial própria. Desenhe tantos parágrafos distintos quantos o menu de evidências permitir sustentar, até essa ordem de grandeza. Se o material só permitir menos, planeje menos: nunca duplique uma função nem atribua a mesma evidência a dois parágrafos para chegar ao número.`,
    plan: (words) =>
      `Cada seção será redigida com uma extensão orientativa de cerca de ${words.toLocaleString('pt-BR')} palavras. Dê a cada seção um propósito e afirmações amplos o bastante para sustentar esse desenvolvimento a partir da evidência disponível, sem fragmentar o argumento nem prometer conteúdo que o corpus não sustente.`,
    continuation: (remaining, pass) =>
      `Continue esta mesma seção exatamente onde ela termina. Faltam cerca de ${remaining.toLocaleString('pt-BR')} palavras para a extensão orientativa; escreva agora aproximadamente ${pass.toLocaleString('pt-BR')}. Não repita o cabeçalho, não resuma o que já está escrito e não reabra um argumento encerrado: acrescente material novo e sustentado, com as citações exatas do menu, em parágrafos completos que se encadeiem com o último.`,
    continuationStop:
      'Se o menu de evidências não permitir mais acrescentar nada substantivo sem se repetir, sem encher linguiça ou sem afirmar algo que as fontes não sustentam, responda exatamente CONTINUACAO_VAZIA e nada mais.',
    clientKit: (words) =>
      `Extensão orientativa: cerca de ${words.toLocaleString('pt-BR')} palavras por seção. É uma orientação editorial, não uma cota; pare antes se o catálogo se esgotar e nunca encha nem repita para alcançá-la.`,
  },
  it: {
    section: (words) =>
      `Lunghezza indicativa di questa sezione: circa ${words.toLocaleString('it-IT')} parole. È un’indicazione editoriale, non una quota: usala per sviluppare i meccanismi, i confronti e i limiti probatori che le prove disponibili sostengono davvero. Se il materiale si esaurisce prima, chiudi la sezione; non ripetere, non riempire, non inventare e non trasformare un’inferenza in un fatto per raggiungere la cifra.`,
    paragraph: (words) =>
      `Lunghezza indicativa di questo paragrafo: circa ${words.toLocaleString('it-IT')} parole. Raggiungila spiegando il meccanismo e precisando la portata esatta delle prove citate, mai aggiungendo affermazioni non sostenute né ripetendo quanto già detto.`,
    evidencePlan: (paragraphs, words) =>
      `Il rapporto richiede sezioni di circa ${words.toLocaleString('it-IT')} parole, cioè dell’ordine di ${paragraphs} paragrafi con una propria funzione inferenziale. Progetta tanti paragrafi distinti quanti il menu delle prove riesce a sostenere, fino a quell’ordine di grandezza. Se il materiale ne consente meno, pianificane meno: non duplicare mai una funzione né assegnare la stessa prova a due paragrafi per arrivare alla cifra.`,
    plan: (words) =>
      `Ogni sezione sarà scritta con una lunghezza indicativa di circa ${words.toLocaleString('it-IT')} parole. Assegna a ciascuna sezione uno scopo e affermazioni abbastanza ampi da sostenere quello sviluppo con le prove disponibili, senza frammentare l’argomento né promettere contenuti che il corpus non sostiene.`,
    continuation: (remaining, pass) =>
      `Prosegui questa stessa sezione esattamente dove si interrompe. Mancano circa ${remaining.toLocaleString('it-IT')} parole alla lunghezza indicativa; scrivine ora circa ${pass.toLocaleString('it-IT')}. Non ripetere il titolo, non riassumere quanto già scritto e non riaprire un argomento concluso: aggiungi materiale nuovo e sostenuto, con le citazioni esatte del menu, in paragrafi completi che si colleghino all’ultimo.`,
    continuationStop:
      'Se il menu delle prove non consente più di aggiungere nulla di sostanziale senza ripeterti, senza riempire o senza affermare qualcosa che le fonti non sostengono, rispondi esattamente CONTINUAZIONE_VUOTA e nient’altro.',
    clientKit: (words) =>
      `Lunghezza indicativa: circa ${words.toLocaleString('it-IT')} parole per sezione. È un’indicazione editoriale, non una quota; fermati prima se il catalogo si esaurisce e non riempire né ripetere per raggiungerla.`,
  },
  tr: {
    section: (words) =>
      `Bu bölüm için yol gösterici uzunluk: yaklaşık ${words.toLocaleString('tr-TR')} kelime. Bu editoryal bir yönlendirmedir, kota değildir: mevcut kanıtın gerçekten desteklediği mekanizmaları, karşılaştırmaları ve kanıt sınırlarını derinleştirmek için kullanın. Malzeme önce biterse bölümü orada bitirin; sayıya ulaşmak için tekrar etmeyin, doldurmayın, uydurmayın ve bir çıkarımı olguya dönüştürmeyin.`,
    paragraph: (words) =>
      `Bu paragraf için yol gösterici uzunluk: yaklaşık ${words.toLocaleString('tr-TR')} kelime. Buna, mekanizmayı açıklayarak ve alıntılanan kanıtın kapsamını tam olarak belirterek ulaşın; asla desteklenmeyen iddialar ekleyerek veya söylenenleri yineleyerek değil.`,
    evidencePlan: (paragraphs, words) =>
      `Rapor yaklaşık ${words.toLocaleString('tr-TR')} kelimelik bölümler istiyor; yani her biri kendi çıkarım işlevine sahip ${paragraphs} paragraf mertebesinde. Kanıt menüsünün destekleyebildiği kadar farklı paragraf tasarlayın, bu büyüklük mertebesine kadar. Malzeme daha azını destekliyorsa daha azını planlayın: sayıya ulaşmak için asla bir işlevi tekrarlamayın ve aynı kanıtı iki paragrafa atamayın.`,
    plan: (words) =>
      `Her bölüm yaklaşık ${words.toLocaleString('tr-TR')} kelimelik yol gösterici bir uzunlukla yazılacak. Her bölüme, mevcut kanıtla bu gelişimi taşıyacak kadar geniş bir amaç ve iddialar verin; argümanı parçalamadan ve külliyatın desteklemediği içeriği vaat etmeden.`,
    continuation: (remaining, pass) =>
      `Bu bölüme tam olarak bittiği yerden devam edin. Yol gösterici uzunluğa yaklaşık ${remaining.toLocaleString('tr-TR')} kelime kaldı; şimdi yaklaşık ${pass.toLocaleString('tr-TR')} kelime yazın. Başlığı tekrarlamayın, yazılmış olanı özetlemeyin ve kapanmış bir tartışmayı yeniden açmayın: menüdeki tam alıntılarıyla birlikte yeni ve desteklenen malzeme ekleyin; sonuncusuyla bağlanan tam paragraflar hâlinde.`,
    continuationStop:
      'Kanıt menüsü, kendinizi tekrarlamadan, doldurma yapmadan veya kaynakların desteklemediği bir şeyi iddia etmeden artık esaslı hiçbir şey eklemenize izin vermiyorsa, tam olarak BOS_DEVAM yazın ve başka hiçbir şey yazmayın.',
    clientKit: (words) =>
      `Yol gösterici uzunluk: bölüm başına yaklaşık ${words.toLocaleString('tr-TR')} kelime. Bu editoryal bir yönlendirmedir, kota değildir; katalog tükenirse daha erken durun ve ona ulaşmak için asla doldurma yapmayın veya tekrarlamayın.`,
  },
};

/**
 * The sentinel each `continuationStop` asks for, per language. A continuation that
 * is only this token counts as zero new words, so the loop stops instead of pasting
 * "EMPTY_CONTINUATION" into the report.
 */
const EMPTY_CONTINUATION_TOKENS = [
  'CONTINUACION_VACIA',
  'EMPTY_CONTINUATION',
  'CONTINUATION_VIDE',
  'LEERE_FORTSETZUNG',
  'CONTINUACAO_VAZIA',
  'CONTINUAZIONE_VUOTA',
  'BOS_DEVAM',
] as const;

export function deepResearchLengthPromptPack(language: PromptLanguage = 'es'): DeepResearchLengthPromptPack {
  return PACKS[language] ?? PACKS.es;
}

/**
 * Strip the "nothing left to add" sentinel in any supported language. Returns an
 * empty string when the model only answered with it, which the continuation loop
 * reads as exhausted evidence.
 */
export function stripEmptyContinuation(raw: string): string {
  let text = (raw ?? '').trim();
  for (const token of EMPTY_CONTINUATION_TOKENS) {
    text = text.replace(new RegExp(`(^|\\s)${token}[.!]?(\\s|$)`, 'giu'), ' ');
  }
  return text.replace(/\s+/gu, ' ').trim().length === 0 ? '' : (raw ?? '').trim();
}

/** True when the model said it has nothing supported left to add. */
export function isEmptyContinuation(raw: string): boolean {
  return stripEmptyContinuation(raw).length === 0;
}
