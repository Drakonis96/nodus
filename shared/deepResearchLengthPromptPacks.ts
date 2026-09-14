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
  'zh-Hans': {
    section: (words) =>
      `本节参考篇幅：约 ${words.toLocaleString('zh-CN')} 字。这是编辑指引，不是配额：请用它充分展开现有证据确实能够支撑的机制、比较和证据边界。如果材料先一步用尽，就结束本节；不要为了达到数字而重复、凑字数、编造，或把推论写成事实。`,
    paragraph: (words) =>
      `本段参考篇幅：约 ${words.toLocaleString('zh-CN')} 字。请通过阐明机制并准确界定所引证据的范围来达到，绝不要靠添加没有依据的论断或重复已说过的内容来凑数。`,
    evidencePlan: (paragraphs, words) =>
      `报告要求各节约为 ${words.toLocaleString('zh-CN')} 字，即大约 ${paragraphs} 个各自承担独立推论功能的段落。在证据菜单能够支撑的范围内，设计尽量多彼此不同的段落，直至这一数量级。如果材料只够支撑更少，就少规划：绝不要为了凑够数字而重复同一功能，或把一条证据分配给两个段落。`,
    plan: (words) =>
      `每一节都将按约 ${words.toLocaleString('zh-CN')} 字的参考篇幅撰写。为每一节设定足够宽泛的目的和论断，以便用现有证据支撑这一展开，既不把论证切碎，也不承诺语料无法支撑的内容。`,
    continuation: (remaining, pass) =>
      `从本节结束处原样继续。距离参考篇幅还差约 ${remaining.toLocaleString('zh-CN')} 字；现在写约 ${pass.toLocaleString('zh-CN')} 字。不要重复标题，不要概括已写内容，也不要重新打开已经结束的论证：补充新的、有依据的材料，附上菜单中确切的引注，并以与上一段衔接的完整段落呈现。`,
    continuationStop:
      '如果证据菜单已无法再补充任何实质内容而不重复自己、不凑数、不断言来源并不支持的东西，请只回答 续写为空，不要回答任何其他内容。',
    clientKit: (words) =>
      `参考篇幅：每节约 ${words.toLocaleString('zh-CN')} 字。这是编辑指引，不是配额；如果目录用尽就提前停止，绝不为了达到而凑数或重复。`,
  },
  'zh-Hant': {
    section: (words) =>
      `本節參考篇幅：約 ${words.toLocaleString('zh-TW')} 字。這是編輯指引，不是配額：請用它充分開展現有證據確實能夠支撐的機制、比較和證據邊界。如果材料先一步用盡，就結束本節；不要為了達到數字而重複、湊字數、編造，或把推論寫成事實。`,
    paragraph: (words) =>
      `本段參考篇幅：約 ${words.toLocaleString('zh-TW')} 字。請透過闡明機制並準確界定所引證據的範圍來達到，絕不要靠加入沒有依據的論斷或重複已說過的內容來湊數。`,
    evidencePlan: (paragraphs, words) =>
      `報告要求各節約為 ${words.toLocaleString('zh-TW')} 字，即大約 ${paragraphs} 個各自承擔獨立推論功能的段落。在證據選單能夠支撐的範圍內，設計盡量多彼此不同的段落，直至這個數量級。如果材料只夠支撐更少，就少規劃：絕不要為了湊夠數字而重複同一功能，或把一項證據分配給兩個段落。`,
    plan: (words) =>
      `每一節都將按約 ${words.toLocaleString('zh-TW')} 字的參考篇幅撰寫。為每一節設定足夠寬廣的目的和論斷，以便用現有證據支撐這樣的開展，既不把論證切碎，也不承諾語料無法支撐的內容。`,
    continuation: (remaining, pass) =>
      `從本節結束處原樣繼續。距離參考篇幅還差約 ${remaining.toLocaleString('zh-TW')} 字；現在寫約 ${pass.toLocaleString('zh-TW')} 字。不要重複標題，不要概述已寫內容，也不要重新打開已經結束的論證：補充新的、有依據的材料，附上選單中確切的引註，並以與上一段銜接的完整段落呈現。`,
    continuationStop:
      '如果證據選單已無法再補充任何實質內容而不重複自己、不湊數、不斷言來源並不支持的東西，請只回答 續寫為空，不要回答任何其他內容。',
    clientKit: (words) =>
      `參考篇幅：每節約 ${words.toLocaleString('zh-TW')} 字。這是編輯指引，不是配額；如果目錄用盡就提前停止，絕不為了達到而湊數或重複。`,
  },
  vi: {
    section: (words) =>
      `Độ dài tham khảo của phần này: khoảng ${words.toLocaleString('vi-VN')} từ. Đây là định hướng biên tập, không phải hạn ngạch: hãy dùng nó để triển khai các cơ chế, so sánh và giới hạn chứng cứ mà nguồn tư liệu hiện có thực sự chống đỡ. Nếu tư liệu cạn trước, hãy kết thúc phần này; đừng lặp lại, viết cho đầy, bịa đặt hay biến một suy luận thành dữ kiện để đạt con số.`,
    paragraph: (words) =>
      `Độ dài tham khảo của đoạn này: khoảng ${words.toLocaleString('vi-VN')} từ. Hãy đạt được bằng cách giải thích cơ chế và nêu chính xác phạm vi của chứng cứ được trích dẫn, tuyệt đối không thêm các khẳng định thiếu căn cứ hay nhắc lại điều đã nói.`,
    evidencePlan: (paragraphs, words) =>
      `Báo cáo yêu cầu các phần dài khoảng ${words.toLocaleString('vi-VN')} từ, tức vào cỡ ${paragraphs} đoạn, mỗi đoạn có chức năng suy luận riêng. Hãy thiết kế càng nhiều đoạn khác biệt càng tốt trong giới hạn mà menu chứng cứ có thể chống đỡ, tối đa đến bậc độ lớn đó. Nếu tư liệu chỉ đủ cho ít hơn, hãy lập kế hoạch ít hơn: tuyệt đối không lặp lại một chức năng hay gán cùng một chứng cứ cho hai đoạn để đạt con số.`,
    plan: (words) =>
      `Mỗi phần sẽ được viết với độ dài tham khảo khoảng ${words.toLocaleString('vi-VN')} từ. Hãy cho mỗi phần một mục đích và những khẳng định đủ rộng để chống đỡ sự triển khai đó bằng chứng cứ hiện có, mà không chia cắt lập luận hay hứa hẹn nội dung mà ngữ liệu không thể chống đỡ.`,
    continuation: (remaining, pass) =>
      `Hãy tiếp tục chính phần này đúng từ chỗ nó dừng lại. Còn khoảng ${remaining.toLocaleString('vi-VN')} từ nữa mới đạt độ dài tham khảo; bây giờ hãy viết khoảng ${pass.toLocaleString('vi-VN')} từ. Đừng lặp lại tiêu đề, đừng tóm tắt điều đã viết và đừng mở lại một lập luận đã khép lại: hãy bổ sung tư liệu mới, có căn cứ, kèm các trích dẫn chính xác từ menu, trong những đoạn hoàn chỉnh nối tiếp đoạn cuối.`,
    continuationStop:
      'Nếu menu chứng cứ không còn cho phép bổ sung bất cứ điều gì thực chất mà không lặp lại chính mình, không viết cho đầy hay không khẳng định điều mà các nguồn không chống đỡ, hãy trả lời chính xác TIEP_TUC_TRONG và không gì khác.',
    clientKit: (words) =>
      `Độ dài tham khảo: khoảng ${words.toLocaleString('vi-VN')} từ mỗi phần. Đây là định hướng biên tập, không phải hạn ngạch; hãy dừng sớm hơn nếu danh mục cạn và tuyệt đối không viết cho đầy hay lặp lại để đạt được nó.`,
  },
  ja: {
    section: (words) =>
      `この節の目安の長さ：約 ${words.toLocaleString('ja-JP')} 字。これは編集上の目安であり、ノルマではありません。利用可能な証拠が実際に支えられる仕組み・比較・証拠上の限界を展開するために使ってください。資料が先に尽きたら、そこで節を終えてください。数字に合わせるために繰り返したり、水増ししたり、捏造したり、推測を事実に変えたりしないでください。`,
    paragraph: (words) =>
      `この段落の目安の長さ：約 ${words.toLocaleString('ja-JP')} 字。仕組みを説明し、引用した証拠の範囲を正確に示すことで達成してください。根拠のない主張を加えたり、すでに述べたことを繰り返したりしてはいけません。`,
    evidencePlan: (paragraphs, words) =>
      `報告書は各節およそ ${words.toLocaleString('ja-JP')} 字、つまりそれぞれ独自の推論機能を持つ ${paragraphs} 段落程度を求めています。証拠メニューが支えられる範囲で、できるだけ多くの異なる段落を設計してください。資料がそれより少なくしか支えられない場合は、少なく計画してください。数字に合わせるために同じ機能を重複させたり、一つの証拠を二つの段落に割り当てたりしないでください。`,
    plan: (words) =>
      `各節は約 ${words.toLocaleString('ja-JP')} 字の目安の長さで書かれます。利用可能な証拠からその展開を支えられるよう、各節に十分広い目的と主張を与えてください。論証を細切れにしたり、コーパスが支えられない内容を約束したりしないでください。`,
    continuation: (remaining, pass) =>
      `この節の終わった箇所からそのまま続けてください。目安の長さまであと約 ${remaining.toLocaleString('ja-JP')} 字です。ここでは約 ${pass.toLocaleString('ja-JP')} 字書いてください。見出しを繰り返さず、すでに書いた内容を要約せず、閉じた論点を再び開かないでください。メニューからの正確な引用を伴う、新しい裏付けのある材料を、前の段落につながる完全な段落で加えてください。`,
    continuationStop:
      '証拠メニューが、繰り返しや水増し、出典が支えない主張をすることなく、実質的な内容をこれ以上加えることを許さない場合は、正確に 続きなし とのみ答えてください。',
    clientKit: (words) =>
      `目安の長さ：各節あたり約 ${words.toLocaleString('ja-JP')} 字。これは編集上の目安であり、ノルマではありません。カタログが尽きたら早めにやめ、到達するために水増しや繰り返しをしないでください。`,
  },
  ru: {
    section: (words) =>
      `Ориентировочная длина этого раздела: около ${words.toLocaleString('ru-RU')} слов. Это редакционный ориентир, а не квота: используйте его, чтобы развить механизмы, сравнения и пределы доказательности, которые действительно выдерживает имеющийся материал. Если материал исчерпается раньше, завершите раздел; не повторяйтесь, не заполняйте объём, не выдумывайте и не превращайте вывод в факт, чтобы достичь числа.`,
    paragraph: (words) =>
      `Ориентировочная длина этого абзаца: около ${words.toLocaleString('ru-RU')} слов. Достигните её, объясняя механизм и точно указывая охват цитируемых доказательств, а не добавляя необоснованные утверждения или повторяя уже сказанное.`,
    evidencePlan: (paragraphs, words) =>
      `Отчёт требует разделов примерно по ${words.toLocaleString('ru-RU')} слов, то есть порядка ${paragraphs} абзацев, каждый со своей функцией вывода. Спроектируйте столько различных абзацев, сколько способно выдержать меню доказательств, вплоть до этого порядка величины. Если материал выдерживает меньше, планируйте меньше: никогда не дублируйте функцию и не назначайте одно доказательство двум абзацам, чтобы достичь числа.`,
    plan: (words) =>
      `Каждый раздел будет написан с ориентировочной длиной около ${words.toLocaleString('ru-RU')} слов. Дайте каждому разделу цель и утверждения, достаточно широкие, чтобы выдержать такое развитие на имеющихся доказательствах, не дробя аргумент и не обещая содержание, которое корпус не может подкрепить.`,
    continuation: (remaining, pass) =>
      `Продолжите этот же раздел точно с того места, где он заканчивается. До ориентировочной длины остаётся около ${remaining.toLocaleString('ru-RU')} слов; сейчас напишите примерно ${pass.toLocaleString('ru-RU')}. Не повторяйте заголовок, не пересказывайте уже написанное и не открывайте заново закрытый аргумент: добавьте новый, подкреплённый материал с точными цитатами из меню, в полных абзацах, которые продолжают последний.`,
    continuationStop:
      'Если меню доказательств больше не позволяет добавить ничего существенного без повторений, заполнения объёма или утверждений, которые источники не поддерживают, ответьте точно ПУСТОЕ_ПРОДОЛЖЕНИЕ и больше ничего.',
    clientKit: (words) =>
      `Ориентировочная длина: около ${words.toLocaleString('ru-RU')} слов на раздел. Это редакционный ориентир, а не квота; остановитесь раньше, если каталог исчерпан, и никогда не заполняйте объём и не повторяйтесь, чтобы её достичь.`,
  },
  uk: {
    section: (words) =>
      `Орієнтовна довжина цього розділу: близько ${words.toLocaleString('uk-UA')} слів. Це редакційний орієнтир, а не квота: використайте його, щоб розгорнути механізми, порівняння та межі доказовості, які справді витримує наявний матеріал. Якщо матеріал вичерпається раніше, завершіть розділ; не повторюйтеся, не заповнюйте обсяг, не вигадуйте й не перетворюйте висновок на факт, щоб досягти числа.`,
    paragraph: (words) =>
      `Орієнтовна довжина цього абзацу: близько ${words.toLocaleString('uk-UA')} слів. Досягніть її, пояснюючи механізм і точно зазначаючи обсяг цитованих доказів, а не додаючи необґрунтовані твердження чи повторюючи вже сказане.`,
    evidencePlan: (paragraphs, words) =>
      `Звіт вимагає розділів приблизно по ${words.toLocaleString('uk-UA')} слів, тобто близько ${paragraphs} абзаців, кожен зі своєю функцією висновування. Спроєктуйте стільки різних абзаців, скільки здатне витримати меню доказів, до цього порядку величини. Якщо матеріал витримує менше, плануйте менше: ніколи не дублюйте функцію й не призначайте один доказ двом абзацам, щоб досягти числа.`,
    plan: (words) =>
      `Кожен розділ буде написано з орієнтовною довжиною близько ${words.toLocaleString('uk-UA')} слів. Дайте кожному розділу мету й твердження, достатньо широкі, щоб витримати таке розгортання на наявних доказах, не подрібнюючи аргумент і не обіцяючи зміст, який корпус не може підкріпити.`,
    continuation: (remaining, pass) =>
      `Продовжте цей самий розділ точно з того місця, де він закінчується. До орієнтовної довжини залишається близько ${remaining.toLocaleString('uk-UA')} слів; тепер напишіть приблизно ${pass.toLocaleString('uk-UA')}. Не повторюйте заголовок, не переказуйте вже написане й не відкривайте заново закритий аргумент: додайте новий, підкріплений матеріал з точними цитатами з меню, у повних абзацах, що продовжують останній.`,
    continuationStop:
      'Якщо меню доказів більше не дозволяє додати нічого суттєвого без повторень, заповнення обсягу чи тверджень, яких джерела не підтримують, дайте відповідь точно ПОРОЖНЄ_ПРОДОВЖЕННЯ і більше нічого.',
    clientKit: (words) =>
      `Орієнтовна довжина: близько ${words.toLocaleString('uk-UA')} слів на розділ. Це редакційний орієнтир, а не квота; зупиніться раніше, якщо каталог вичерпано, і ніколи не заповнюйте обсяг і не повторюйтеся, щоб її досягти.`,
  },
  ko: {
    section: (words) =>
      `이 절의 참고 분량: 약 ${words.toLocaleString('ko-KR')}단어입니다. 이는 편집 지침이며 할당량이 아닙니다. 확보된 증거가 실제로 뒷받침하는 메커니즘, 비교, 증거의 한계를 전개하는 데 사용하십시오. 자료가 먼저 소진되면 절을 끝내십시오. 숫자를 채우기 위해 반복하거나, 분량을 늘리거나, 날조하거나, 추론을 사실로 바꾸지 마십시오.`,
    paragraph: (words) =>
      `이 단락의 참고 분량: 약 ${words.toLocaleString('ko-KR')}단어입니다. 메커니즘을 설명하고 인용된 증거의 범위를 정확히 밝혀 도달하되, 근거 없는 주장을 덧붙이거나 이미 말한 내용을 반복해서는 안 됩니다.`,
    evidencePlan: (paragraphs, words) =>
      `보고서는 각 절을 약 ${words.toLocaleString('ko-KR')}단어, 즉 각기 고유한 추론 기능을 지닌 ${paragraphs}개 안팎의 단락으로 요청합니다. 증거 메뉴가 뒷받침할 수 있는 범위에서 서로 다른 단락을 그 규모까지 설계하십시오. 자료가 그보다 적게 뒷받침한다면 더 적게 계획하십시오. 숫자를 채우기 위해 같은 기능을 중복하거나 하나의 증거를 두 단락에 배정하지 마십시오.`,
    plan: (words) =>
      `각 절은 약 ${words.toLocaleString('ko-KR')}단어의 참고 분량에 맞춰 작성됩니다. 확보된 증거로 그러한 전개를 뒷받침할 수 있도록 각 절에 충분히 넓은 목적과 주장을 부여하되, 논증을 토막 내거나 코퍼스가 뒷받침할 수 없는 내용을 약속하지 마십시오.`,
    continuation: (remaining, pass) =>
      `이 절을 끝나는 지점에서 그대로 이어 가십시오. 참고 분량까지 약 ${remaining.toLocaleString('ko-KR')}단어가 남았습니다. 지금 약 ${pass.toLocaleString('ko-KR')}단어를 쓰십시오. 제목을 반복하지 말고, 이미 쓴 내용을 요약하지 말고, 닫힌 논점을 다시 열지 마십시오. 메뉴에서 정확히 인용한 새롭고 뒷받침되는 자료를, 마지막 단락에 이어지는 완전한 단락으로 추가하십시오.`,
    continuationStop:
      '증거 메뉴가 더 이상 반복하거나 분량을 늘리거나 출처가 뒷받침하지 않는 것을 주장하지 않고서는 실질적인 내용을 추가할 수 없다면, 정확히 계속_없음이라고만 답하십시오.',
    clientKit: (words) =>
      `참고 분량: 절마다 약 ${words.toLocaleString('ko-KR')}단어입니다. 이는 편집 지침이며 할당량이 아닙니다. 카탈로그가 소진되면 더 일찍 멈추고, 도달하기 위해 분량을 늘리거나 반복하지 마십시오.`,
  },
};

/**
 * The sentinel each `continuationStop` asks for, per language. A continuation that
 * is only this token counts as zero new words, so the loop stops instead of pasting
 * "EMPTY_CONTINUATION" into the report.
 */
export const EMPTY_CONTINUATION_TOKENS = [
  'CONTINUACION_VACIA',
  'EMPTY_CONTINUATION',
  'CONTINUATION_VIDE',
  'LEERE_FORTSETZUNG',
  'CONTINUACAO_VAZIA',
  'CONTINUAZIONE_VUOTA',
  'BOS_DEVAM',
  '续写为空',
  '續寫為空',
  'TIEP_TUC_TRONG',
  '続きなし',
  'ПУСТОЕ_ПРОДОЛЖЕНИЕ',
  'ПОРОЖНЄ_ПРОДОВЖЕННЯ',
  '계속_없음',
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
