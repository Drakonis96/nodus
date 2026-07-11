// Sample corpus for the Nodus web demo. All data is static and English-only:
// a small learning-science library (the same domain as the app's built-in
// demo corpus) chosen because it yields real contradictions, gaps and debates.
window.DATA = {
  vault: 'Learning science (sample)',
  works: [
    { id: 'w1', author: 'Roediger & Karpicke', year: 2006, title: 'Test-Enhanced Learning: Taking Memory Tests Improves Long-Term Retention', type: 'Journal article', venue: 'Psychological Science', read: true, themeIds: ['t1'], abstract: 'Two experiments show that taking a memory test enhances later retention more than restudying, even without feedback. The benefit emerges at delayed tests and reverses at immediate ones.', zoteroKey: 'ABCD1234', pages: 12, scanned: 'Full text · analysed 3 days ago' },
    { id: 'w2', author: 'Karpicke & Blunt', year: 2011, title: 'Retrieval Practice Produces More Learning than Elaborative Studying with Concept Mapping', type: 'Journal article', venue: 'Science', read: true, themeIds: ['t1'], abstract: 'Retrieval practice produced better performance than elaborative studying with concept mapping on both verbatim and inference tests, for science texts.', zoteroKey: 'EFGH5678', pages: 5, scanned: 'Full text · analysed 3 days ago' },
    { id: 'w3', author: 'Sweller', year: 1988, title: 'Cognitive Load During Problem Solving: Effects on Learning', type: 'Journal article', venue: 'Cognitive Science', read: true, themeIds: ['t2'], abstract: 'Conventional problem solving imposes a heavy cognitive load that interferes with schema acquisition; goal-free problems and worked examples reduce it.', zoteroKey: 'IJKL9012', pages: 29, scanned: 'Full text · analysed 3 days ago' },
    { id: 'w4', author: 'Cepeda et al.', year: 2006, title: 'Distributed Practice in Verbal Recall Tasks: A Review and Quantitative Synthesis', type: 'Journal article', venue: 'Psychological Bulletin', read: false, themeIds: ['t3'], abstract: 'A meta-analysis of 254 studies (14,811 participants): spaced practice reliably beats massed practice, and the optimal gap grows with the retention interval.', zoteroKey: 'MNOP3456', pages: 26, scanned: 'Full text · analysed 2 days ago' },
    { id: 'w5', author: 'Bjork & Bjork', year: 2011, title: 'Making Things Hard on Yourself, But in a Good Way: Creating Desirable Difficulties', type: 'Book section', venue: 'Psychology and the Real World', read: true, themeIds: ['t1', 't3'], abstract: 'Conditions that slow apparent learning — spacing, interleaving, testing, reducing feedback — often enhance long-term retention and transfer.', zoteroKey: 'QRST7890', pages: 9, scanned: 'Full text · analysed 3 days ago' },
    { id: 'w6', author: 'Van Gog & Sweller', year: 2015, title: 'Not New, but Nearly Forgotten: The Testing Effect Decreases as the Complexity of Learning Materials Increases', type: 'Journal article', venue: 'Educational Psychology Review', read: false, themeIds: ['t1', 't2'], abstract: 'A re-analysis arguing that the testing effect shrinks — and may disappear — when element interactivity of the material is high.', zoteroKey: 'UVWX1234', pages: 15, scanned: 'Full text · analysed yesterday' },
  ],
  themes: [
    { id: 't1', label: 'RETRIEVAL PRACTICE', color: '#f97316' },
    { id: 't2', label: 'COGNITIVE LOAD', color: '#f97316' },
    { id: 't3', label: 'MEMORY CONSOLIDATION', color: '#f97316' },
  ],
  // type: claim | finding | construct | method | framework
  ideas: [
    { id: 'i1', type: 'finding', label: 'The testing effect strengthens long-term retention', work: 'w1', theme: 't1', evidence: 'Students who took recall tests retained ~50% more content after one week than students who re-studied (Exp. 2, N=120).', page: 'p. 251' },
    { id: 'i2', type: 'claim', label: 'Active retrieval outperforms re-reading', work: 'w1', theme: 't1', evidence: 'Repeated studying felt more effective to students, yet repeated testing produced better delayed recall — a metacognitive illusion.', page: 'p. 254' },
    { id: 'i3', type: 'finding', label: 'Retrieval practice beats concept mapping for meaningful learning', work: 'w2', theme: 't1', evidence: 'Retrieval practice outperformed elaborative concept mapping on verbatim and inference questions alike (d = 1.50).', page: 'p. 774' },
    { id: 'i4', type: 'construct', label: 'Intrinsic vs. extraneous cognitive load', work: 'w3', theme: 't2', evidence: 'Load imposed by the material itself (element interactivity) is distinct from load imposed by poor instructional design.', page: 'p. 262' },
    { id: 'i5', type: 'claim', label: 'Reducing extraneous load frees working memory for learning', work: 'w3', theme: 't2', evidence: 'Goal-free problems and worked examples reduced search-based load and improved schema acquisition.', page: 'p. 275' },
    { id: 'i6', type: 'finding', label: 'The testing effect fades as material complexity rises', work: 'w6', theme: 't2', evidence: 'Across re-analysed studies, testing-effect sizes shrank toward zero when element interactivity was high.', page: 'p. 16' },
    { id: 'i7', type: 'framework', label: 'Desirable difficulties', work: 'w5', theme: 't1', evidence: 'Conditions that slow apparent learning (spacing, testing, interleaving) often enhance long-term retention and transfer.', page: 'p. 58' },
    { id: 'i8', type: 'finding', label: 'Spaced practice improves retention over massed study', work: 'w4', theme: 't3', evidence: 'Meta-analysis of 254 studies: spaced practice reliably outperformed massed practice (mean gain 15%).', page: 'p. 356' },
    { id: 'i9', type: 'claim', label: 'Spacing supports consolidation between sessions', work: 'w4', theme: 't3', evidence: 'Optimal inter-study intervals scale with the retention interval, consistent with consolidation accounts.', page: 'p. 370' },
    { id: 'i10', type: 'finding', label: 'Generating an answer improves recall over reading it', work: 'w5', theme: 't1', evidence: 'Generation tasks produced reliable recall advantages across verbal materials.', page: 'p. 61' },
    { id: 'i11', type: 'construct', label: 'Element interactivity', work: 'w6', theme: 't2', evidence: 'The number of interacting elements a learner must hold simultaneously determines intrinsic load.', page: 'p. 4' },
    { id: 'i12', type: 'method', label: 'Delayed cued-recall testing paradigm', work: 'w1', theme: 't1', evidence: 'Retention measured at 5 min, 2 days and 1 week; the study–test crossover appears only at delayed tests.', page: 'p. 250' },
  ],
  // Edge types mirror the app legend.
  edges: [
    { from: 'i2', to: 'i1', type: 'supports' },
    { from: 'i3', to: 'i2', type: 'supports' },
    { from: 'i6', to: 'i2', type: 'contradicts' },
    { from: 'i11', to: 'i6', type: 'precondition_of' },
    { from: 'i4', to: 'i11', type: 'refines' },
    { from: 'i5', to: 'i4', type: 'applies_to' },
    { from: 'i7', to: 'i2', type: 'extends' },
    { from: 'i7', to: 'i8', type: 'extends' },
    { from: 'i10', to: 'i1', type: 'supports' },
    { from: 'i9', to: 'i8', type: 'refines' },
    { from: 'i12', to: 'i1', type: 'shares_method' },
    { from: 'i8', to: 'i1', type: 'measures_same' },
  ],
  authors: [
    { id: 'a1', name: 'Henry L. Roediger III', works: ['w1'], ideas: ['i1', 'i2', 'i12'], stance: 'Retrieval practice is a robust, general learning mechanism.', agrees: ['Jeffrey D. Karpicke', 'Robert A. Bjork'], disputes: ['Tamara van Gog'] },
    { id: 'a2', name: 'Jeffrey D. Karpicke', works: ['w1', 'w2'], ideas: ['i1', 'i2', 'i3', 'i12'], stance: 'Retrieval is the key event of learning, beating elaboration.', agrees: ['Henry L. Roediger III'], disputes: ['John Sweller', 'Tamara van Gog'] },
    { id: 'a3', name: 'John Sweller', works: ['w3', 'w6'], ideas: ['i4', 'i5', 'i6', 'i11'], stance: 'Working-memory limits bound every instructional effect.', agrees: ['Tamara van Gog'], disputes: ['Jeffrey D. Karpicke'] },
    { id: 'a4', name: 'Nicholas J. Cepeda', works: ['w4'], ideas: ['i8', 'i9'], stance: 'Optimal spacing depends on the retention goal.', agrees: ['Robert A. Bjork'], disputes: [] },
    { id: 'a5', name: 'Robert A. Bjork', works: ['w5'], ideas: ['i7', 'i10'], stance: 'Difficulties that slow learning can be desirable.', agrees: ['Henry L. Roediger III', 'Nicholas J. Cepeda'], disputes: [] },
    { id: 'a6', name: 'Tamara van Gog', works: ['w6'], ideas: ['i6', 'i11'], stance: 'The testing effect has boundary conditions.', agrees: ['John Sweller'], disputes: ['Henry L. Roediger III'] },
  ],
  debates: [
    {
      id: 'd1',
      title: 'Does the testing effect survive complex materials?',
      status: 'open',
      positionA: { label: 'Robust across materials', authors: ['Roediger', 'Karpicke', 'Blunt'], summary: 'Retrieval practice improved retention and inference even for meaningful science texts; the effect generalises across formats.', evidence: ['i1', 'i3'] },
      positionB: { label: 'Attenuates under high load', authors: ['Van Gog', 'Sweller'], summary: 'When element interactivity is high, testing-effect sizes shrink toward zero — working-memory limits gate the benefit.', evidence: ['i6', 'i11'] },
      timeline: [
        { year: 2006, event: 'Roediger & Karpicke establish the delayed testing effect.' },
        { year: 2011, event: 'Karpicke & Blunt extend it to meaningful learning (Science).' },
        { year: 2015, event: 'Van Gog & Sweller re-analyse: effect fades with complexity.' },
      ],
    },
  ],
  gaps: [
    { id: 'g1', title: 'Testing × complexity in real classrooms', detail: 'No work in the corpus tests retrieval practice with high element-interactivity material outside the lab.', themes: ['t1', 't2'], strength: 'high', adjacent: ['i3', 'i6'], question: 'Does scaffolded retrieval practice preserve the testing effect for high-complexity material in authentic classrooms?', sources: [{ title: 'Agarwal et al. (2021) — Retrieval practice in classroom settings: a review', match: '87%' }, { title: 'Leahy & Sweller (2019) — Cognitive load and the testing effect in primary school', match: '82%' }, { title: 'Moreira et al. (2019) — Retrieval practice in K-12: a field synthesis', match: '74%' }] },
    { id: 'g2', title: 'Spacing × testing interaction', detail: 'Spacing and testing are each supported, but no source combines them factorially.', themes: ['t1', 't3'], strength: 'high', adjacent: ['i1', 'i8'], question: 'Are spacing and testing additive, redundant, or super-additive for week-scale retention?', sources: [{ title: 'Latimier et al. (2021) — Does spacing retrieval practice help?', match: '91%' }, { title: 'Kang (2016) — Spaced repetition promotes efficient learning', match: '78%' }] },
    { id: 'g3', title: 'Retention beyond one year', detail: 'The longest retention interval measured in the corpus is one week (plus meta-analytic estimates).', themes: ['t3'], strength: 'medium', adjacent: ['i8', 'i9'], question: 'Do testing and spacing advantages persist at 1-year-plus intervals?', sources: [{ title: 'Custers (2010) — Long-term retention of basic science knowledge', match: '84%' }] },
    { id: 'g4', title: 'Individual differences in working memory', detail: 'Whether working-memory capacity moderates the testing effect is asserted but never measured.', themes: ['t2'], strength: 'medium', adjacent: ['i4', 'i6'], question: 'Does working-memory capacity moderate the size of the testing effect?', sources: [{ title: 'Agarwal et al. (2017) — Benefits from retrieval practice are greater for students with lower working memory', match: '93%' }] },
  ],
  coverage: [
    { id: 'q1', question: 'Is the testing effect mediated by retrieval effort or by re-exposure?', status: 'partial', note: 'Roediger & Karpicke rule out re-exposure alone; effort account untested.', evidence: ['i1', 'i2', 'i12'], missing: 'A design manipulating retrieval effort while holding exposure constant.' },
    { id: 'q2', question: 'Does spacing interact with sleep-dependent consolidation?', status: 'open', note: 'Cepeda et al. gesture at consolidation; no sleep study in corpus.', evidence: ['i9'], missing: 'Any work with polysomnography or sleep/wake manipulation.' },
    { id: 'q3', question: 'Do desirable difficulties transfer to problem solving?', status: 'covered', note: 'Bjork & Bjork review transfer evidence across three task families.', evidence: ['i7', 'i10'], missing: null },
  ],
  hypotheses: [
    { id: 'h1', title: 'Load-gated retrieval hypothesis', statement: 'The testing effect holds whenever the retrieval attempt itself fits within working-memory limits; scaffolded retrieval should restore the effect for complex material.', support: ['i1', 'i6', 'i11'], risk: 'Predicts Van Gog & Sweller results are a scaffolding artefact — directly testable.', test: 'Factorial design: material complexity (low/high) × retrieval scaffolding (none/partial cues). The hypothesis predicts a three-way rescue: scaffolding restores the testing effect only in the high-complexity cell.' },
    { id: 'h2', title: 'Spacing as covert retrieval', statement: 'Spaced re-study works because each return forces implicit retrieval; spacing and testing are one mechanism, not two.', support: ['i8', 'i9', 'i2'], risk: 'Contradicted if spacing gains persist under recognition-only re-exposure.', test: 'Compare spaced re-reading vs spaced recognition vs spaced cued recall at a 2-week test. If spacing is covert retrieval, the recognition condition should lose most of the spacing gain.' },
  ],
  readingPath: [
    { order: 1, work: 'w1', why: 'Foundational result: the delayed testing effect.' },
    { order: 2, work: 'w5', why: 'The framework that makes sense of it: desirable difficulties.' },
    { order: 3, work: 'w3', why: 'The constraint: working memory and cognitive load.' },
    { order: 4, work: 'w6', why: 'The live objection — read after 1 and 3 to see both sides.' },
    { order: 5, work: 'w4', why: 'Complete the picture with spacing (still unread).' },
  ],
  deepResearch: [
    {
      id: 'dr1',
      title: 'Retrieval practice: why testing yourself beats re-reading',
      meta: '3 pages · 6 works · 12 ideas cited · generated in queue',
      cover: '../assets/art/deep-research-cover.svg',
      audio: '../assets/audio/deep-research-sample.m4a',
      audioLabel: 'Audio edition · Heart · Kokoro (local)',
      pages: [
        { title: 'Page 1 — The finding that keeps resurfacing', paras: [
          { text: 'Across the six works in this corpus, one result recurs: actively recalling an idea strengthens memory far more than reading it again. Roediger and Karpicke (2006) found that students who tested themselves retained roughly 50% more content one week later than students who re-studied [1]. The effect is not a laboratory curiosity: Karpicke and Blunt (2011) showed retrieval practice outperforming elaborative concept mapping even on inference questions, with an effect size of d = 1.50 [2].', cites: [['[1] Roediger & Karpicke 2006, p. 251', 'i1'], ['[2] Karpicke & Blunt 2011, p. 774', 'i3']] },
          { text: 'What makes the finding uncomfortable is the metacognitive illusion that accompanies it: re-reading feels more effective while producing less. Students in the 2006 experiments consistently predicted the opposite of their own results [3].', cites: [['[3] Roediger & Karpicke 2006, p. 254', 'i2']] },
        ] },
        { title: 'Page 2 — The boundary condition', paras: [
          { text: 'The graph also surfaces a live debate. Van Gog and Sweller (2015) re-analysed the literature and argue the effect shrinks toward zero when element interactivity is high [4] — a prediction grounded in cognitive-load theory [5]. If retrieval itself consumes working memory, then materials whose elements must be held simultaneously leave no capacity for the retrieval attempt to do its consolidating work [6].', cites: [['[4] Van Gog & Sweller 2015, p. 16', 'i6'], ['[5] Sweller 1988, p. 262', 'i4'], ['[6] Van Gog & Sweller 2015, p. 4', 'i11']] },
          { text: 'The corpus does not yet contain a classroom test of this boundary — the strongest open gap identified by the graph.', cites: [] },
        ] },
        { title: 'Page 3 — What to read next', paras: [
          { text: 'Two gaps remain open: the testing-by-complexity interaction in authentic settings, and the untested combination of spacing with retrieval practice [7]. The suggested reading path starts with the foundational 2006 result and ends at the still-unread Cepeda meta-analysis, whose 254 studies anchor the spacing side of the story [7].', cites: [['[7] Cepeda et al. 2006, p. 356', 'i8']] },
        ] },
      ],
      matrix: [
        ['Testing beats restudy at a delay', 'Roediger & Karpicke 2006', 'supports', 'Karpicke & Blunt 2011', 'supports'],
        ['Effect survives complex material', 'Karpicke & Blunt 2011', 'supports', 'Van Gog & Sweller 2015', 'contradicts'],
        ['Working memory gates learning', 'Sweller 1988', 'supports', 'Van Gog & Sweller 2015', 'extends'],
      ],
    },
    {
      id: 'dr2',
      title: 'Spacing and consolidation: the quiet half of desirable difficulties',
      meta: '2 pages · 3 works · 5 ideas cited · generated in queue',
      cover: '../assets/art/immersion-threads.svg',
      audio: '../assets/audio/immersion-sample.m4a',
      audioLabel: 'Audio edition · George · Kokoro (local)',
      pages: [
        { title: 'Page 1 — The oldest effect in the corpus', paras: [
          { text: 'Spacing is the corpus’s most quantified claim: across 254 studies, distributed practice beat massed practice with a mean gain of 15% [1]. Cepeda and colleagues add the practical twist — the optimal gap between sessions scales with how long you need to remember [2].', cites: [['[1] Cepeda et al. 2006, p. 356', 'i8'], ['[2] Cepeda et al. 2006, p. 370', 'i9']] },
        ] },
        { title: 'Page 2 — One mechanism or two?', paras: [
          { text: 'Bjork’s desirable-difficulties framework treats spacing and testing as siblings [3], and the graph hints they may be closer than that: if every spaced return forces covert retrieval, the two literatures describe one mechanism. No work in the corpus tests this — it is logged as an open gap and a proposed hypothesis.', cites: [['[3] Bjork & Bjork 2011, p. 58', 'i7']] },
        ] },
      ],
      matrix: [
        ['Spacing beats massing', 'Cepeda et al. 2006', 'supports', 'Bjork & Bjork 2011', 'supports'],
        ['Spacing = covert retrieval', '— untested in corpus —', 'gap', '', ''],
      ],
    },
  ],
  immersions: [
    {
      id: 'im1',
      title: 'Your library as a night sky',
      topic: 'How memory consolidates: spacing, sleep and the shape of forgetting',
      art: '../assets/art/immersion-night-sky.svg',
      audio: '../assets/audio/immersion-sample.m4a',
      voice: 'George · Kokoro (local)',
      duration: '24 min',
      progress: 40,
      scope: { ideas: 7, works: 4, authors: 4, debates: 1, gaps: 2, passages: 18 },
      steps: [
        { kind: 'panorama', title: 'Panorama', minutes: 4, done: true, body: 'The lay of the land: three themes, one live dispute, and why the spacing literature is the quiet backbone of everything else in this corpus.' },
        { kind: 'station', title: 'Station 1 · The spacing effect', minutes: 6, done: true, quote: '“Spaced practice reliably outperformed massed practice (mean gain 15%).”', source: 'Cepeda et al. 2006, p. 356', body: 'Two hundred and fifty-four studies point the same way. We walk through what the meta-analysis actually measured — and what it deliberately left out.' },
        { kind: 'station', title: 'Station 2 · Desirable difficulties', minutes: 6, done: false, quote: '“Conditions that slow apparent learning often enhance long-term retention and transfer.”', source: 'Bjork & Bjork 2011, p. 58', body: 'Why the things that feel worst while studying tend to work best afterwards.' },
        { kind: 'contrasts', title: 'Contrasts', minutes: 4, done: false, body: 'Cepeda’s consolidation account vs. a covert-retrieval reading of the same data. Same numbers, two mechanisms.' },
        { kind: 'frontiers', title: 'Frontiers', minutes: 2, done: false, body: 'The two open gaps this walk touches: spacing × testing, and retention beyond one year.' },
        { kind: 'exam', title: 'Final exam', minutes: 2, done: false, body: '5 questions. Your answers are saved with the session.' },
      ],
      quiz: { q: 'According to the corpus, what determines the optimal gap between study sessions?', options: ['A fixed 24-hour cycle', 'How long you need to remember the material', 'The learner’s age', 'Material difficulty alone'], answer: 1, explain: 'Cepeda et al. (2006, p. 370): optimal inter-study intervals scale with the retention interval.' },
    },
    {
      id: 'im2',
      title: 'Threads between the shelves',
      topic: 'The testing effect and its boundary: one argument, six works',
      art: '../assets/art/immersion-threads.svg',
      audio: '../assets/audio/deep-research-sample.m4a',
      voice: 'Heart · Kokoro (local)',
      duration: '27 min',
      progress: 0,
      scope: { ideas: 9, works: 5, authors: 5, debates: 1, gaps: 2, passages: 22 },
      steps: [
        { kind: 'panorama', title: 'Panorama', minutes: 4, done: false, body: 'Six works, three themes, one argument — the testing effect from its 2006 birth to its 2015 boundary.' },
        { kind: 'station', title: 'Station 1 · The crossover', minutes: 6, done: false, quote: '“Repeated studying felt more effective to students, yet repeated testing produced better delayed recall.”', source: 'Roediger & Karpicke 2006, p. 254', body: 'The single chart that started the modern retrieval-practice literature.' },
        { kind: 'station', title: 'Station 2 · Science, 2011', minutes: 6, done: false, quote: '“Retrieval practice outperformed elaborative concept mapping (d = 1.50).”', source: 'Karpicke & Blunt 2011, p. 774', body: 'The strongest version of the claim — and exactly the one the 2015 critique targets.' },
        { kind: 'contrasts', title: 'Contrasts', minutes: 5, done: false, body: 'Karpicke vs. Van Gog & Sweller, position by position, with each side’s evidence read aloud.' },
        { kind: 'frontiers', title: 'Frontiers', minutes: 3, done: false, body: 'Where the debate is genuinely unresolved: classrooms, complexity, and working-memory differences.' },
        { kind: 'exam', title: 'Final exam', minutes: 3, done: false, body: '5 questions to certify the walk.' },
      ],
      quiz: { q: 'What moderator do Van Gog & Sweller (2015) claim shrinks the testing effect?', options: ['Retention interval', 'Feedback timing', 'Element interactivity of the material', 'Age of participants'], answer: 2, explain: 'Their re-analysis ties the fading effect to high element interactivity (2015, p. 16).' },
    },
  ],
  studyGuide: [
    { id: 'sg1', title: 'Core concept check', kind: 'Flashcards', count: 4, desc: 'Testing effect, element interactivity, desirable difficulties, spacing curve.', cards: [
      { q: 'What is the testing effect?', a: 'Actively recalling material strengthens long-term retention more than re-studying it — the advantage appears at delayed tests. (Roediger & Karpicke 2006)' },
      { q: 'Define element interactivity.', a: 'The number of information elements a learner must hold in working memory simultaneously; it determines intrinsic cognitive load. (Van Gog & Sweller 2015)' },
      { q: 'What is a “desirable difficulty”?', a: 'A condition that slows apparent learning (spacing, testing, interleaving) but enhances long-term retention and transfer. (Bjork & Bjork 2011)' },
      { q: 'How should study sessions be spaced?', a: 'The optimal gap scales with the retention interval — remember longer, space wider. (Cepeda et al. 2006)' },
    ] },
    { id: 'sg2', title: 'The 2015 objection', kind: 'Socratic route', count: 4, desc: 'Four questions that walk you from Roediger 2006 to the Van Gog & Sweller critique.', route: [
      { q: 'Roediger & Karpicke found testing beats restudy — but only when?', a: 'At delayed tests (2 days, 1 week). At 5 minutes, restudy wins: the famous crossover.' },
      { q: 'Karpicke & Blunt (2011) strengthened the claim how?', a: 'By beating concept mapping — an elaborative technique — on meaningful science texts, including inference questions.' },
      { q: 'What premise do Van Gog & Sweller attack?', a: 'That the effect generalises across materials. They argue high element interactivity leaves no working memory for retrieval to help.' },
      { q: 'What evidence would settle it?', a: 'A classroom study crossing complexity with scaffolded retrieval — exactly the top gap in this corpus.' },
    ] },
    { id: 'sg3', title: 'Methods compare', kind: 'Matrix', count: 3, desc: 'Delayed cued recall vs. concept mapping vs. meta-analytic synthesis.', matrix: [
      ['Method', 'Used by', 'Measures', 'Blind spot'],
      ['Delayed cued recall', 'Roediger & Karpicke 2006', 'Retention at 5 min / 2 d / 1 wk', 'Lab materials only'],
      ['Concept mapping comparison', 'Karpicke & Blunt 2011', 'Verbatim + inference learning', 'Single domain (science texts)'],
      ['Meta-analytic synthesis', 'Cepeda et al. 2006', '254 studies, 14,811 participants', 'Cannot test interactions'],
    ] },
  ],
  writing: {
    drafts: [
      { id: 'wd1', title: 'Section 2.1 — The testing effect and its limits', words: 96, citations: 4, status: 'verified', updated: '2 days ago' },
      { id: 'wd2', title: 'Section 2.2 — Spacing: the quiet half', words: 61, citations: 2, status: 'verified', updated: 'yesterday' },
      { id: 'wd3', title: 'Intro sketch — why difficulties are desirable', words: 38, citations: 1, status: 'draft', updated: '3 hours ago' },
    ],
    active: {
      title: 'Section 2.1 — The testing effect and its limits',
      text: 'The claim that retrieval practice enhances retention is among the most replicated findings in learning science (Roediger & Karpicke, 2006). Its strongest form — that retrieval beats elaborative study even for meaningful material — rests on Karpicke and Blunt (2011). Yet the effect is not unconditional: Van Gog and Sweller (2015) show that as element interactivity rises, the advantage attenuates, suggesting that working-memory constraints (Sweller, 1988) gate the benefit. This section argues that the disagreement is best read not as a replication failure but as a boundary condition…',
      status: 'Verified · 4/4 citations resolve to Zotero items',
    },
    insertion: ' Indeed, generation tasks produce reliable recall advantages across verbal materials (Bjork & Bjork, 2011, p. 61), which anchors the boundary-condition reading in a mechanism rather than a hedge.',
  },
  projects: [
    { id: 'p1', name: 'Lit review — Chapter 2', works: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'], drafts: ['wd1', 'wd2', 'wd3'], notes: ['Where the debate actually lives', 'Gap map for ch. 2'], updated: 'Updated 2 days ago', goal: 'A 9,000-word chapter arguing the boundary-condition reading of the testing effect.' },
    { id: 'p2', name: 'Conference talk: desirable difficulties', works: ['w1', 'w5', 'w4'], drafts: ['wd3'], notes: ['Roediger 2006 — the crossover chart'], updated: 'Updated last week', goal: '15-minute talk + slides for the learning-sciences seminar.' },
  ],
  notes: [
    { id: 'n1', folder: 'Reading notes', notes: [
      { id: 'nn1', title: 'Roediger 2006 — the crossover chart', body: 'The key figure: restudy wins at 5 minutes, testing wins at 2 days and 1 week. The crossover is the whole argument — never cite the immediate condition alone.\n\nLinks: [idea: The testing effect strengthens long-term retention] · [idea: Delayed cued-recall testing paradigm]', updated: '3 days ago' },
      { id: 'nn2', title: 'Van Gog 2015 — objections list', body: '1. Most testing-effect studies use word pairs (low interactivity).\n2. The few complex-material studies show shrinking effects.\n3. Prediction: scaffolding should rescue the effect — nobody has run it.\n\nLinks: [idea: The testing effect fades as material complexity rises]', updated: 'yesterday' },
    ] },
    { id: 'n2', folder: 'Synthesis', notes: [
      { id: 'nn3', title: 'Where the debate actually lives', body: 'Not a replication fight. Both sides agree on the low-complexity data. The disagreement is exclusively about generalisation to high element interactivity — which the corpus cannot settle. This is the chapter’s core move.\n\nLinks: [debate: Does the testing effect survive complex materials?]', updated: '2 days ago' },
      { id: 'nn4', title: 'Gap map for ch. 2', body: 'g1 classrooms × complexity → section 2.4\ng2 spacing × testing → section 2.5\ng3 long-term retention → limitations\ng4 working memory differences → future work\n\nLinks: [gap: Testing × complexity in real classrooms]', updated: '2 days ago' },
    ] },
  ],
  argumentMap: {
    thesis: 'Retrieval practice should anchor study design — within working-memory limits.',
    supports: [
      { idea: 'i1', label: 'Testing effect strengthens retention (Roediger & Karpicke 2006)' },
      { idea: 'i3', label: 'Beats concept mapping on inference (Karpicke & Blunt 2011)' },
      { idea: 'i7', label: 'Fits the desirable-difficulties framework (Bjork & Bjork 2011)' },
    ],
    objections: [
      { idea: 'i6', label: 'Effect fades with complexity (Van Gog & Sweller 2015)' },
    ],
    rebuttals: [
      { idea: 'i11', label: 'Complexity is measurable — scaffold retrieval, don’t abandon it' },
    ],
  },
  settings: {
    providers: [
      { name: 'Anthropic', desc: 'Claude models · cloud', key: 'sk-ant-················7Kq2', on: true },
      { name: 'OpenAI', desc: 'GPT models · cloud', key: null, on: false },
      { name: 'Google', desc: 'Gemini models · cloud', key: null, on: false },
      { name: 'OpenRouter', desc: 'Multi-provider gateway · cloud', key: null, on: false },
      { name: 'DeepSeek', desc: 'DeepSeek models · cloud', key: null, on: false },
      { name: 'Ollama', desc: 'Local models · fully offline', key: 'http://127.0.0.1:11434', on: true },
      { name: 'LM Studio', desc: 'Local models · fully offline', key: 'http://127.0.0.1:1234', on: false },
    ],
    models: [
      ['Extraction (themes & ideas)', 'claude-sonnet-5'],
      ['Synthesis (reports, debates)', 'claude-sonnet-5'],
      ['Tutor & study', 'qwen3:8b · Ollama'],
      ['Summaries', 'qwen3:8b · Ollama'],
      ['Embeddings', 'nomic-embed-text · Ollama'],
    ],
  },
};

window.EDGE_COLORS = {
  supports: '#34d399', refutes: '#f87171', contradicts: '#ef4444', extends: '#a78bfa',
  refines: '#8b5cf6', applies_to: '#fbbf24', shares_method: '#22d3ee',
  precondition_of: '#f472b6', measures_same: '#2dd4bf', variant: '#94a3b8', gap: '#f59e0b',
};
window.TYPE_COLORS = {
  theme: '#f97316', claim: '#818cf8', finding: '#34d399',
  construct: '#fbbf24', method: '#f87171', framework: '#22d3ee',
};
