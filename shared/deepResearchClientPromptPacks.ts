import type { PromptLanguage } from './types';

export interface DeepResearchClientPromptPack {
  citationPolicy: readonly string[];
  evidenceShape(sectionCount: number): string;
  singleNarrative: string;
  sectionedNarrative: string;
  distributeEvidence: string;
  catalogSemantics: string;
  singleOutput: string;
  sectionedOutput: string;
  finalize: string;
}

const PACKS: Record<PromptLanguage, DeepResearchClientPromptPack> = {
  es: {
    citationPolicy: ['Cita CADA afirmación sustantiva con un token del catálogo, copiado EXACTAMENTE (incluido el enlace nodus://) y colocado entre paréntesis.', 'Usa SOLO los tokens de `materials`. Cualquier cita que no esté en el catálogo será eliminada al ensamblar: no inventes autores, obras, años ni ids.', 'Puedes citar el mismo token varias veces. No añadas una sección de Referencias ni bibliografía: Nodus la construye a partir de las obras realmente citadas.'],
    evidenceShape: (count) => `La evidencia sugiere en torno a ${count} movimientos argumentales, pero no es una cuota ni un límite. Desarrolla cada afirmación, relación, contraste y evidencia relevante una sola vez y detente cuando no aporte valor marginal verificable.`,
    singleNarrative: 'Redacta una única narración continua, sin encabezados, subtítulos ni rótulos internos. Organiza los movimientos del argumento mediante párrafos y transiciones naturales.',
    sectionedNarrative: 'Prefiere POCAS secciones LARGAS y profundas antes que muchas cortas: cada sección agrupa varias ideas afines y las relaciona, no una idea por sección.',
    distributeEvidence: 'Reparte TODAS las ideas relevantes del catálogo entre las secciones. Sitúa los huecos y contradicciones donde aporten tensión argumental. Cierra con una síntesis.',
    catalogSemantics: 'Cada entrada del catálogo trae en `note` el contenido real de lo que cita. Los pasajes traen el texto literal de la obra entre comillas angulares: úsalos como evidencia textual y no extiendas su sentido. Los huecos y las contradicciones traen lo que afirman, así que arguméntalos por su contenido en vez de nombrarlos de pasada.',
    singleOutput: 'Entrega el cuerpo seguido en `sectionsMarkdown`, sin ningún encabezado Markdown. No incluyas el resumen, las limitaciones ni las referencias: pásalos como campos aparte y conserva `sectionLimit: "single"` al finalizar.',
    sectionedOutput: 'Empieza cada sección con un encabezado Markdown "## Título". No incluyas el resumen, las limitaciones ni las referencias en `sectionsMarkdown`: pásalos como campos aparte a la herramienta de ensamblado.',
    finalize: 'Cuando termines de redactar, llama a `nodus_finalize_deep_research` con tu markdown para validar las citas, construir las referencias y, si quieres, guardar el borrador.',
  },
  en: {
    citationPolicy: ['Cite EVERY substantive claim with a catalog token, copied EXACTLY (including the nodus:// link) and placed in parentheses.', 'Use ONLY tokens from `materials`. Any citation absent from the catalog will be removed during assembly: do not invent authors, works, years, or ids.', 'You may cite the same token more than once. Do not add a References or bibliography section: Nodus builds it from the works actually cited.'],
    evidenceShape: (count) => `The evidence suggests roughly ${count} argumentative movements, but this is neither a quota nor a limit. Develop each relevant claim, relationship, contrast, and piece of evidence once, then stop when no verifiable marginal value remains.`,
    singleNarrative: 'Write one continuous narrative without headings, subheadings, or internal labels. Organize the argument through paragraphs and natural transitions.',
    sectionedNarrative: 'Prefer a FEW LONG, in-depth sections to many short ones: each section should group and relate several connected ideas, not cover one idea per section.',
    distributeEvidence: 'Distribute ALL relevant catalog ideas across the sections. Place gaps and contradictions where they create argumentative tension. End with a synthesis.',
    catalogSemantics: 'Each catalog entry carries the actual cited content in `note`. Passages contain verbatim work text in angle quotes: use it as textual evidence without extending its meaning. Gaps and contradictions state their actual claim, so argue from their content instead of merely naming the labels.',
    singleOutput: 'Put the continuous body in `sectionsMarkdown` without Markdown headings. Do not include the abstract, limitations, or references: pass them as separate fields and retain `sectionLimit: "single"` when finalizing.',
    sectionedOutput: 'Start each section with a Markdown heading "## Title". Do not include the abstract, limitations, or references in `sectionsMarkdown`: pass them as separate fields to the assembly tool.',
    finalize: 'When the draft is complete, call `nodus_finalize_deep_research` with your markdown to validate citations, build references, and optionally save the draft.',
  },
  fr: {
    citationPolicy: ['Citez CHAQUE affirmation substantielle avec un jeton du catalogue, copié EXACTEMENT, lien nodus:// compris, et placé entre parenthèses.', 'Utilisez UNIQUEMENT les jetons de `materials`. Toute citation absente du catalogue sera supprimée lors de l’assemblage : n’inventez ni auteurs, ni ouvrages, ni années, ni ids.', 'Vous pouvez citer plusieurs fois le même jeton. N’ajoutez ni section Références ni bibliographie : Nodus la construit à partir des ouvrages réellement cités.'],
    evidenceShape: (count) => `Les preuves suggèrent environ ${count} mouvements argumentatifs, sans que ce soit un quota ni une limite. Développez une seule fois chaque affirmation, relation, contraste et preuve pertinente, puis arrêtez-vous lorsqu’il ne reste plus de valeur marginale vérifiable.`,
    singleNarrative: 'Rédigez un récit continu unique, sans titres, sous-titres ni libellés internes. Organisez l’argument par paragraphes et transitions naturelles.',
    sectionedNarrative: 'Préférez quelques sections LONGUES et approfondies à de nombreuses sections courtes : chacune regroupe et relie plusieurs idées proches, pas une seule idée.',
    distributeEvidence: 'Répartissez TOUTES les idées pertinentes du catalogue entre les sections. Placez lacunes et contradictions là où elles créent une tension argumentative. Terminez par une synthèse.',
    catalogSemantics: 'Chaque entrée du catalogue contient dans `note` le contenu réellement cité. Les passages donnent le texte littéral entre guillemets angulaires : utilisez-le comme preuve sans en étendre le sens. Les lacunes et contradictions indiquent ce qu’elles affirment ; argumentez à partir de leur contenu plutôt que de simplement les nommer.',
    singleOutput: 'Placez le corps continu dans `sectionsMarkdown`, sans titre Markdown. N’y incluez ni résumé, ni limites, ni références : transmettez-les dans des champs séparés et conservez `sectionLimit: "single"` lors de la finalisation.',
    sectionedOutput: 'Commencez chaque section par un titre Markdown "## Titre". N’incluez ni résumé, ni limites, ni références dans `sectionsMarkdown` : transmettez-les séparément à l’outil d’assemblage.',
    finalize: 'Une fois la rédaction terminée, appelez `nodus_finalize_deep_research` avec le markdown afin de valider les citations, construire les références et, si vous le souhaitez, enregistrer le brouillon.',
  },
  de: {
    citationPolicy: ['Belegen Sie JEDE wesentliche Aussage mit einem Katalog-Token, das EXAKT, einschließlich des nodus://-Links, kopiert und in Klammern gesetzt wird.', 'Verwenden Sie NUR Tokens aus `materials`. Beim Zusammenstellen werden alle nicht im Katalog enthaltenen Zitate entfernt: Erfinden Sie keine Autoren, Werke, Jahre oder ids.', 'Dasselbe Token darf mehrfach zitiert werden. Fügen Sie keinen Abschnitt Quellen oder Literaturverzeichnis hinzu: Nodus erstellt ihn aus den tatsächlich zitierten Werken.'],
    evidenceShape: (count) => `Die Belege legen ungefähr ${count} argumentative Schritte nahe; dies ist weder eine Quote noch eine Grenze. Entwickeln Sie jede relevante Aussage, Beziehung, Gegenüberstellung und Evidenz genau einmal und enden Sie, sobald kein überprüfbarer Mehrwert mehr entsteht.`,
    singleNarrative: 'Verfassen Sie einen durchgehenden Text ohne Überschriften, Untertitel oder interne Bezeichnungen. Gliedern Sie das Argument durch Absätze und natürliche Übergänge.',
    sectionedNarrative: 'Bevorzugen Sie WENIGE LANGE, vertiefte Abschnitte gegenüber vielen kurzen: Jeder Abschnitt bündelt und verknüpft mehrere verwandte Ideen, nicht nur eine Idee.',
    distributeEvidence: 'Verteilen Sie ALLE relevanten Katalogideen auf die Abschnitte. Platzieren Sie Lücken und Widersprüche dort, wo sie argumentative Spannung erzeugen. Schließen Sie mit einer Synthese.',
    catalogSemantics: 'Jeder Katalogeintrag enthält in `note` den tatsächlich zitierten Inhalt. Passagen enthalten den wörtlichen Werktext in Winkelzitaten: Verwenden Sie ihn als Textbeleg, ohne seine Bedeutung auszuweiten. Lücken und Widersprüche enthalten ihre eigentliche Aussage; argumentieren Sie aus diesem Inhalt, statt nur die Bezeichnung zu nennen.',
    singleOutput: 'Geben Sie den fortlaufenden Text ohne Markdown-Überschriften in `sectionsMarkdown` aus. Abstract, Einschränkungen und Quellen werden als getrennte Felder übergeben; behalten Sie beim Finalisieren `sectionLimit: "single"` bei.',
    sectionedOutput: 'Beginnen Sie jeden Abschnitt mit einer Markdown-Überschrift "## Titel". Abstract, Einschränkungen und Quellen gehören nicht in `sectionsMarkdown`, sondern als getrennte Felder in das Zusammenstellungswerkzeug.',
    finalize: 'Rufen Sie nach Abschluss des Entwurfs `nodus_finalize_deep_research` mit dem Markdown auf, um Zitate zu prüfen, Quellen zu erstellen und den Entwurf optional zu speichern.',
  },
  pt: {
    citationPolicy: ['Cita CADA afirmação substantiva com um token do catálogo, copiado EXATAMENTE, incluindo a ligação nodus://, e colocado entre parênteses.', 'Usa APENAS tokens de `materials`. Qualquer citação ausente do catálogo será removida na composição: não inventes autores, obras, anos ou ids.', 'Podes citar o mesmo token várias vezes. Não acrescentes uma secção de Referências nem bibliografia: o Nodus constrói-a a partir das obras realmente citadas.'],
    evidenceShape: (count) => `A evidência sugere cerca de ${count} movimentos argumentativos, mas isto não é uma quota nem um limite. Desenvolve uma vez cada afirmação, relação, contraste e prova pertinente e termina quando deixar de haver valor marginal verificável.`,
    singleNarrative: 'Redige uma única narrativa contínua, sem cabeçalhos, subtítulos ou rótulos internos. Organiza o argumento com parágrafos e transições naturais.',
    sectionedNarrative: 'Prefere POUCAS secções LONGAS e aprofundadas a muitas curtas: cada secção reúne e relaciona várias ideias próximas, não apenas uma ideia.',
    distributeEvidence: 'Distribui TODAS as ideias pertinentes do catálogo pelas secções. Coloca lacunas e contradições onde criem tensão argumentativa. Termina com uma síntese.',
    catalogSemantics: 'Cada entrada do catálogo contém em `note` o conteúdo efetivamente citado. As passagens trazem o texto literal da obra entre aspas angulares: usa-o como prova textual sem ampliar o seu sentido. As lacunas e contradições indicam o que afirmam; argumenta pelo seu conteúdo em vez de apenas nomear os rótulos.',
    singleOutput: 'Entrega o corpo contínuo em `sectionsMarkdown`, sem cabeçalhos Markdown. Não incluas o resumo, as limitações ou as referências: passa-os como campos separados e conserva `sectionLimit: "single"` ao finalizar.',
    sectionedOutput: 'Começa cada secção com um cabeçalho Markdown "## Título". Não incluas o resumo, as limitações ou as referências em `sectionsMarkdown`: passa-os separadamente à ferramenta de composição.',
    finalize: 'Quando terminares a redação, chama `nodus_finalize_deep_research` com o markdown para validar as citações, construir as referências e, se quiseres, guardar o rascunho.',
  },
  'pt-BR': {
    citationPolicy: ['Cite CADA afirmação substantiva com um token do catálogo, copiado EXATAMENTE, incluindo o link nodus://, e colocado entre parênteses.', 'Use SOMENTE tokens de `materials`. Qualquer citação ausente do catálogo será removida na montagem: não invente autores, obras, anos ou ids.', 'Você pode citar o mesmo token várias vezes. Não adicione uma seção de Referências nem bibliografia: o Nodus a constrói a partir das obras realmente citadas.'],
    evidenceShape: (count) => `As evidências sugerem cerca de ${count} movimentos argumentativos, mas isso não é uma cota nem um limite. Desenvolva uma vez cada afirmação, relação, contraste e evidência relevante e pare quando não houver mais valor marginal verificável.`,
    singleNarrative: 'Escreva uma única narrativa contínua, sem cabeçalhos, subtítulos ou rótulos internos. Organize o argumento com parágrafos e transições naturais.',
    sectionedNarrative: 'Prefira POUCAS seções LONGAS e aprofundadas a muitas curtas: cada seção reúne e relaciona várias ideias próximas, não apenas uma ideia.',
    distributeEvidence: 'Distribua TODAS as ideias relevantes do catálogo entre as seções. Coloque lacunas e contradições onde criem tensão argumentativa. Termine com uma síntese.',
    catalogSemantics: 'Cada entrada do catálogo contém em `note` o conteúdo realmente citado. As passagens trazem o texto literal da obra entre aspas angulares: use-o como evidência textual sem ampliar seu sentido. As lacunas e contradições indicam o que afirmam; argumente a partir de seu conteúdo em vez de apenas nomear os rótulos.',
    singleOutput: 'Entregue o corpo contínuo em `sectionsMarkdown`, sem cabeçalhos Markdown. Não inclua o resumo, as limitações nem as referências: passe-os como campos separados e mantenha `sectionLimit: "single"` ao finalizar.',
    sectionedOutput: 'Comece cada seção com um cabeçalho Markdown "## Título". Não inclua o resumo, as limitações nem as referências em `sectionsMarkdown`: passe-os separadamente para a ferramenta de montagem.',
    finalize: 'Quando terminar a redação, chame `nodus_finalize_deep_research` com o markdown para validar as citações, construir as referências e, se quiser, salvar o rascunho.',
  },
  it: {
    citationPolicy: ['Cita OGNI affermazione sostanziale con un token del catalogo, copiato ESATTAMENTE, incluso il link nodus://, e posto tra parentesi.', 'Usa SOLO token presenti in `materials`. Ogni citazione assente dal catalogo verrà rimossa durante l’assemblaggio: non inventare autori, opere, anni o ids.', 'Puoi citare lo stesso token più volte. Non aggiungere una sezione Riferimenti né una bibliografia: Nodus la costruisce dalle opere effettivamente citate.'],
    evidenceShape: (count) => `Le prove suggeriscono circa ${count} passaggi argomentativi, ma non è una quota né un limite. Sviluppa una sola volta ogni affermazione, relazione, confronto e prova pertinente e fermati quando non resta valore marginale verificabile.`,
    singleNarrative: 'Scrivi un’unica narrazione continua, senza titoli, sottotitoli o etichette interne. Organizza l’argomento con paragrafi e transizioni naturali.',
    sectionedNarrative: 'Preferisci POCHE sezioni LUNGHE e approfondite a molte brevi: ogni sezione raggruppa e collega varie idee affini, non una sola idea.',
    distributeEvidence: 'Distribuisci TUTTE le idee pertinenti del catalogo tra le sezioni. Colloca lacune e contraddizioni dove creano tensione argomentativa. Concludi con una sintesi.',
    catalogSemantics: 'Ogni voce del catalogo contiene in `note` il contenuto effettivamente citato. I passaggi riportano il testo letterale dell’opera tra virgolette angolari: usalo come prova testuale senza ampliarne il significato. Lacune e contraddizioni indicano ciò che affermano; argomenta dal loro contenuto invece di limitarti a nominarne le etichette.',
    singleOutput: 'Inserisci il corpo continuo in `sectionsMarkdown`, senza titoli Markdown. Non includere abstract, limitazioni o riferimenti: passali come campi separati e conserva `sectionLimit: "single"` alla finalizzazione.',
    sectionedOutput: 'Inizia ogni sezione con un titolo Markdown "## Titolo". Non includere abstract, limitazioni o riferimenti in `sectionsMarkdown`: passali separatamente allo strumento di assemblaggio.',
    finalize: 'Al termine della stesura, chiama `nodus_finalize_deep_research` con il markdown per convalidare le citazioni, costruire i riferimenti e, se vuoi, salvare la bozza.',
  },
  tr: {
    citationPolicy: ['HER önemli iddiayı katalogdan bir token ile, nodus:// bağlantısı dâhil TAM OLARAK kopyalayarak ve parantez içine yerleştirerek kaynaklandırın.', 'YALNIZCA `materials` içindeki tokenları kullanın. Katalogda bulunmayan alıntılar birleştirme sırasında kaldırılır: yazar, eser, yıl veya id uydurmayın.', 'Aynı tokenı birden fazla kez kaynak gösterebilirsiniz. Kaynakça veya Referanslar bölümü eklemeyin: Nodus bunu gerçekten alıntılanan eserlerden oluşturur.'],
    evidenceShape: (count) => `Kanıtlar yaklaşık ${count} tartışma hareketi öneriyor; ancak bu bir kota ya da sınır değildir. İlgili her iddiayı, ilişkiyi, karşılaştırmayı ve kanıtı bir kez geliştirin; doğrulanabilir ek değer kalmadığında durun.`,
    singleNarrative: 'Başlık, alt başlık veya iç etiket olmadan tek ve kesintisiz bir anlatı yazın. Argümanı paragraflar ve doğal geçişlerle düzenleyin.',
    sectionedNarrative: 'Çok sayıda kısa bölüm yerine AZ sayıda UZUN ve derin bölüm tercih edin: her bölüm tek bir fikir yerine birbiriyle ilişkili birkaç fikri birleştirsin.',
    distributeEvidence: 'Katalogdaki ilgili TÜM fikirleri bölümlere dağıtın. Boşlukları ve çelişkileri tartışmada gerilim yarattıkları yere yerleştirin. Bir sentezle bitirin.',
    catalogSemantics: 'Her katalog girdisi gerçekten alıntıladığı içeriği `note` alanında taşır. Pasajlar eserin sözcüğü sözcüğüne metnini açılı tırnaklar içinde içerir: anlamını genişletmeden metinsel kanıt olarak kullanın. Boşluklar ve çelişkiler gerçek iddialarını içerir; etiketlerini anmak yerine içeriklerinden hareketle tartışın.',
    singleOutput: 'Kesintisiz gövdeyi Markdown başlığı olmadan `sectionsMarkdown` içinde verin. Özeti, sınırlılıkları veya kaynakları eklemeyin; bunları ayrı alanlar olarak iletin ve sonlandırırken `sectionLimit: "single"` değerini koruyun.',
    sectionedOutput: 'Her bölüme "## Başlık" Markdown başlığıyla başlayın. Özeti, sınırlılıkları veya kaynakları `sectionsMarkdown` içine eklemeyin; bunları birleştirme aracına ayrı alanlar olarak iletin.',
    finalize: 'Taslak tamamlandığında alıntıları doğrulamak, kaynakları oluşturmak ve isterseniz taslağı kaydetmek için markdown ile `nodus_finalize_deep_research` çağrısını yapın.',
  },
};

export function deepResearchClientPromptPack(language: PromptLanguage): DeepResearchClientPromptPack {
  return PACKS[language] ?? PACKS.en;
}
