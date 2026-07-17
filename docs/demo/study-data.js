/* Nodus web demo — STUDY mode sample data.
   A faithful English port of the study vault's own sample workspace
   (electron/db/studyDemoData.ts): one course, two subjects, a folder and topics,
   two notes, one imported material, one recorded class with its transcript,
   the extracted idea map, one question, one flashcard and the planner. */
window.STUDY = {
  course: {
    id: 'crs-bio', shortId: 'CRS-DEMO1', name: 'General Biology',
    description: 'Sample local course for exploring the study vault.',
    color: '#0f766e', icon: 'graduation', year: 2026,
  },
  subjects: [
    { id: 'sub-cell', shortId: 'SUB-DEMO1', name: 'Cell biology', description: 'Structure and function of the cell.', color: '#0d9488', icon: 'microscope', favorite: true },
    { id: 'sub-eco', shortId: 'SUB-DEMO2', name: 'Ecology', description: 'Relations between organisms and ecosystems.', color: '#15803d', icon: 'leaf', favorite: false },
  ],
  folders: [
    { id: 'fld-cell', shortId: 'FLD-DEMO1', subjectId: 'sub-cell', name: 'Unit 1 · The cell', description: 'Topics and materials for the first unit.', color: '#0d9488' },
  ],
  topics: [
    { id: 'top-membrane', shortId: 'TOP-DEMO1', subjectId: 'sub-cell', folderId: 'fld-cell', name: 'Plasma membrane', description: 'Transport, composition and signalling.', color: '#14b8a6' },
    { id: 'top-energy', shortId: 'TOP-DEMO2', subjectId: 'sub-eco', folderId: null, name: 'Energy flow', description: 'Trophic levels and productivity.', color: '#22c55e' },
  ],
  docs: [
    {
      id: 'doc-cell', shortId: 'DOC-DEMO1', title: 'Plasma membrane · summary', kind: 'Note',
      subjectId: 'sub-cell', topicId: 'top-membrane', favorite: true, pinned: true, tags: ['Final exam'],
      updatedAt: '2 days ago',
      markdown: `# Plasma membrane

The membrane follows the **fluid mosaic model**: a phospholipid bilayer with mobile proteins.

## Transport

- Simple diffusion does not consume ATP.
- Active transport moves solutes against the gradient.
- Osmosis describes the net movement of water.

> Key question: what determines selective permeability?`,
      annotation: { text: 'phospholipid bilayer', note: 'Relate this structure to selective permeability.', color: '#f59e0b' },
      link: { to: 'doc-eco', label: 'Compare with energy flow' },
    },
    {
      id: 'doc-eco', shortId: 'DOC-DEMO2', title: 'Energy flow in ecosystems', kind: 'Handbook',
      subjectId: 'sub-eco', topicId: 'top-energy', favorite: false, pinned: false, tags: [],
      updatedAt: '3 days ago',
      markdown: `# Energy flow

Producers turn light energy into chemical energy. At every trophic transfer a share is dissipated as heat.

## To review

1. Tell gross and net primary productivity apart.
2. Explain why energy is not recycled the way matter is.`,
      annotation: null, link: null,
    },
  ],
  materials: [
    {
      id: 'mat-osmosis', shortId: 'MAT-DEMO1', title: 'Lab guide · osmosis',
      description: 'Sample Markdown material, ready to open, annotate and link.',
      fileName: 'osmosis-lab-guide.md', extension: 'MD', sizeBytes: 341, readState: 'Reading',
      courseId: 'crs-bio', subjectId: 'sub-cell', folderId: 'fld-cell', topicId: 'top-membrane',
      indexStatus: 'Indexed', embedding: 'nomic-embed-text · 768d', favorite: true,
      citation: 'Department of Biology (2026). Lab guide · osmosis.',
      text: `# Lab guide · osmosis

Goal: observe the movement of water across a semipermeable membrane.

## Procedure

1. Prepare three solutions at different concentrations.
2. Record the initial and final mass.
3. Explain the results through the osmotic gradient.`,
      annotation: { text: 'observe the movement of water across a semipermeable membrane', note: 'Core idea of the experiment.', color: '#14b8a6', linkedDoc: 'doc-cell', linkLabel: 'Osmosis and permeability' },
    },
  ],
  recordings: [
    {
      id: 'rec-membrane', shortId: 'REC-DEMO1', title: 'Class · transport across the membrane',
      fileName: 'membrane-class-demo.wav', session: 'Class 3', durationSeconds: 2612, sizeBytes: 41_800_000,
      language: 'English', status: 'Ready', favorite: true, date: '3 days ago',
      courseId: 'crs-bio', subjectId: 'sub-cell', topicId: 'top-membrane',
      transcript: 'The plasma membrane regulates exchange with the medium. Diffusion happens down the gradient; active transport requires energy.',
      segments: [
        { start: 0, end: 74, speaker: 'Lecturer', chapter: 'Cell transport', confidence: 0.98, text: 'The membrane regulates exchange with the medium; active transport requires energy.' },
        { start: 74, end: 168, speaker: 'Lecturer', chapter: 'Cell transport', confidence: 0.96, text: 'Simple diffusion needs no ATP: molecules move down their concentration gradient.' },
        { start: 168, end: 240, speaker: 'Student', chapter: 'Q&A', confidence: 0.91, text: 'So osmosis is a special case of diffusion, only for water?' },
      ],
      markers: [{ at: 96, label: 'Key concept', note: 'Difference between passive and active transport.', color: '#f59e0b' }],
    },
  ],
  ideas: [
    { id: 'idea-mosaic', subjectId: 'sub-cell', type: 'concept', label: 'Fluid mosaic model', statement: 'The membrane is a phospholipid bilayer with mobile proteins.', source: 'doc-cell', sourceTitle: 'Plasma membrane · summary', quote: 'The membrane follows the fluid mosaic model: a phospholipid bilayer with mobile proteins.', confidence: 0.95 },
    { id: 'idea-perm', subjectId: 'sub-cell', type: 'principle', label: 'Selective permeability', statement: 'The composition of the membrane determines which substances can cross it.', source: 'doc-cell', sourceTitle: 'Plasma membrane · summary', quote: 'what determines selective permeability?', confidence: 0.95 },
    { id: 'idea-passive', subjectId: 'sub-cell', type: 'process', label: 'Passive transport', statement: 'Simple diffusion and osmosis happen without consuming ATP.', source: 'doc-cell', sourceTitle: 'Plasma membrane · summary', quote: 'Simple diffusion does not consume ATP.', confidence: 0.95 },
    { id: 'idea-active', subjectId: 'sub-cell', type: 'process', label: 'Active transport', statement: 'Active transport moves solutes against the gradient and requires energy.', source: 'doc-cell', sourceTitle: 'Plasma membrane · summary', quote: 'Active transport moves solutes against the gradient.', confidence: 0.95 },
    { id: 'idea-producers', subjectId: 'sub-eco', type: 'concept', label: 'Producers', statement: 'Producers turn light energy into chemical energy.', source: 'doc-eco', sourceTitle: 'Energy flow in ecosystems', quote: 'Producers turn light energy into chemical energy.', confidence: 0.94 },
    { id: 'idea-transfer', subjectId: 'sub-eco', type: 'process', label: 'Trophic transfer', statement: 'Chemical energy passes between trophic levels through feeding.', source: 'doc-eco', sourceTitle: 'Energy flow in ecosystems', quote: 'At every trophic transfer a share is dissipated as heat.', confidence: 0.94 },
    { id: 'idea-dissipation', subjectId: 'sub-eco', type: 'consequence', label: 'Energy dissipation', statement: 'At every trophic transfer part of the energy is dissipated as heat.', source: 'doc-eco', sourceTitle: 'Energy flow in ecosystems', quote: 'At every trophic transfer a share is dissipated as heat.', confidence: 0.94 },
  ],
  edges: [
    { subjectId: 'sub-cell', from: 'idea-mosaic', to: 'idea-perm', type: 'supports', basis: 'The bilayer-and-protein structure explains which substances are selected.', confidence: 0.91 },
    { subjectId: 'sub-cell', from: 'idea-passive', to: 'idea-active', type: 'contrasts', basis: 'They differ in energy use and direction relative to the gradient.', confidence: 0.97 },
    { subjectId: 'sub-cell', from: 'idea-perm', to: 'idea-passive', type: 'applies', basis: 'Permeability conditions which molecules can diffuse.', confidence: 0.86 },
    { subjectId: 'sub-eco', from: 'idea-producers', to: 'idea-transfer', type: 'causes', basis: 'The energy fixed by producers starts the flow between trophic levels.', confidence: 0.92 },
    { subjectId: 'sub-eco', from: 'idea-transfer', to: 'idea-dissipation', type: 'causes', basis: 'Every energy transfer carries losses as heat.', confidence: 0.96 },
  ],
  questions: [
    {
      id: 'q-transport', shortId: 'QUE-DEMO1', prompt: 'Which mechanism moves solutes against their concentration gradient?',
      type: 'Single choice', difficulty: 'Easy', level: 'Understand', status: 'Approved',
      options: ['Simple diffusion', 'Osmosis', 'Active transport', 'Filtration'], answer: 'Active transport',
      explanation: 'Active transport spends energy to move solutes against the gradient.',
      tags: ['membrane', 'transport'], subjectId: 'sub-cell', topicId: 'top-membrane',
      sourceId: 'doc-cell', sourceTitle: 'Plasma membrane · summary', excerpt: 'Active transport moves solutes against the gradient.',
      lastAttempt: { response: 'Active transport', score: 1, max: 1, at: '2 days ago', feedback: 'Correct: it needs energy to overcome the gradient.' },
    },
  ],
  flashcards: [
    {
      id: 'fc-active', shortId: 'FLC-DEMO1', front: 'What does active transport do?',
      back: 'It moves solutes against the gradient and requires energy.',
      hint: 'Think about the direction of the gradient.',
      subjectId: 'sub-cell', topicId: 'top-membrane', questionId: 'q-transport', difficulty: 'Easy',
      srs: { ease: 2.6, intervalDays: 3, repetitions: 1, lapses: 0, due: 'today' },
    },
  ],
  plan: {
    id: 'pln-final', title: 'Final exam preparation', description: 'Sample local plan with one session and one key date.',
    subjectId: 'sub-cell', availableMinutes: 180, examInDays: 12,
    blocks: [{ id: 'blk-review', title: 'Review membrane transport', type: 'review', subjectId: 'sub-cell', topicId: 'top-membrane', when: 'Tomorrow · 30 min', status: 'Planned', notes: 'Finish the pending cards.' }],
  },
  events: [
    { id: 'evt-exam', title: 'Biology final exam', type: 'exam', inDays: 12, allDay: true, subjectId: 'sub-cell', notes: 'Editable sample date.', reminder: '1 day before' },
    { id: 'evt-lab', title: 'Osmosis lab session', type: 'class', inDays: 3, allDay: false, subjectId: 'sub-cell', notes: 'Bring the lab guide.', reminder: '2 h before' },
    { id: 'evt-review', title: 'Review session · energy flow', type: 'session', inDays: 6, allDay: false, subjectId: 'sub-eco', notes: '', reminder: '' },
  ],
  goal: { title: 'Complete three sessions', period: 'weekly', target: 3, current: 1, unit: 'sessions', subjectId: 'sub-cell' },
  sessions: [{ id: 'ses-cell', mode: 'focus', plannedMinutes: 25, actualSeconds: 1380, interruptions: 1, subjectId: 'sub-cell', topicId: 'top-membrane', notes: 'Review done; check osmosis tomorrow.' }],
  mastery: [
    { scope: 'Cell biology', subjectId: 'sub-cell', mastery: 0.62, confidence: 0.78, evidence: 3, status: 'Learning' },
    { scope: 'Ecology', subjectId: 'sub-eco', mastery: 0.18, confidence: 0.4, evidence: 1, status: 'Starting' },
  ],
  schedule: {
    periods: [
      { id: 'per-morning', section: 'morning', label: 'First period', start: '09:00', end: '10:00' },
      { id: 'per-midday', section: 'morning', label: 'Second period', start: '10:15', end: '11:15' },
      { id: 'per-afternoon', section: 'afternoon', label: 'Afternoon', start: '16:00', end: '17:00' },
    ],
    cells: [
      { day: 'monday', periodId: 'per-morning', subjectId: 'sub-cell' },
      { day: 'wednesday', periodId: 'per-morning', subjectId: 'sub-eco' },
      { day: 'thursday', periodId: 'per-afternoon', subjectId: 'sub-cell' },
      { day: 'tuesday', periodId: 'per-midday', activity: 'Library' },
      { day: 'friday', periodId: 'per-midday', subjectId: 'sub-eco' },
    ],
  },
  savedSearches: [{ name: 'Membrane transport', query: 'transport' }],
  searchHistory: ['osmosis', 'trophic', 'active transport'],
  chat: {
    title: 'Membrane transport, explained',
    messages: [
      { who: 'user', text: 'Explain the difference between passive and active transport as if it were the first time I study it.' },
      {
        who: 'ai',
        text: 'Think of the membrane as a door with a slope. **Passive transport** is going downhill: molecules move from where there are many to where there are few, and the cell spends nothing — simple diffusion and osmosis (water) work this way [1]. **Active transport** is going uphill: it pushes solutes against the gradient, so it needs energy [1].\n\nThe deciding factor is which way you go relative to the gradient, not the substance. Selective permeability sets who is even allowed through the door [2].',
        citations: [
          { id: '[1]', title: 'Plasma membrane · summary', kind: 'document', targetId: 'doc-cell' },
          { id: '[2]', title: 'Class · transport across the membrane · 01:36', kind: 'transcript', targetId: 'rec-membrane' },
        ],
      },
    ],
    canned: [
      'Both notes and the recorded class say the same thing: the direction relative to the gradient is what separates passive from active transport [1]. Nothing in this vault contradicts it — and I will not add anything that is not in your material.',
      'Your ecology note stops at heat dissipation but never spells out why energy is not recycled the way matter is — that is exactly the question the note leaves you [1]. It is a good candidate for a flashcard.',
      'Your weakest area right now is Ecology: 1 piece of evidence and 18% mastery, against 62% in Cell biology. If the exam is in 12 days, energy flow is where the next session pays off most.',
    ],
    starters: [
      'Summarise the essential ideas and tell me what I should remember.',
      'Compare the core concepts of these sources.',
      'What contradictions or gaps show up in the material?',
      'Explain it step by step as if it were the first time I study it.',
    ],
  },
  report: {
    title: 'Transport across the plasma membrane: a study brief',
    subtitle: 'Built from 2 notes, 1 material and 1 transcribed class · Cell biology',
    pages: [
      {
        title: 'What the membrane is',
        body: [
          'Everything in this unit hangs off one structure. The membrane is not a passive wall: it is a phospholipid bilayer with proteins that move within it — the fluid mosaic model [1]. That mobility is what lets the same surface be a barrier and a gate at once.',
          'Because the bilayer is lipid, what crosses it easily and what needs help is decided by chemistry, not by the cell\'s intent. This is the property your own note keeps returning to as a question: selective permeability [1].',
        ],
        cites: [{ id: '[1]', title: 'Plasma membrane · summary, fluid mosaic model' }],
      },
      {
        title: 'Downhill and uphill',
        body: [
          'Two mechanisms follow from that. Simple diffusion and osmosis run down the concentration gradient and cost nothing [1]. Active transport runs the other way, against the gradient, and therefore requires energy [1] — the point the lecturer makes in the recorded class as well [2].',
          'The osmosis lab operationalises exactly this: three solutions, a mass measurement before and after, and an explanation that has to invoke the osmotic gradient rather than the substance itself [3].',
        ],
        cites: [
          { id: '[1]', title: 'Plasma membrane · summary, transport' },
          { id: '[2]', title: 'Class · transport across the membrane, 00:00–01:14' },
          { id: '[3]', title: 'Lab guide · osmosis, procedure' },
        ],
      },
      {
        title: 'What to take to the exam',
        body: [
          'Three sentences carry this unit. The membrane is a fluid mosaic. Permeability decides who may cross. Direction relative to the gradient decides whether it costs energy.',
          'Your idea map shows passive and active transport as a contrast edge, not two unrelated facts — which is how an exam question is most likely to ask for them. The one saved question in your bank does exactly that.',
        ],
        cites: [{ id: '[1]', title: 'Plasma membrane · summary' }],
      },
    ],
  },
  notes: [
    { id: 'note-doubts', title: 'Open doubts', body: 'Why is energy not recycled like matter?\n\nThe ecology note stops at dissipation — ask in the next class.\n\nCheck: does osmosis count as passive transport in the exam glossary? (Yes: no ATP.)' },
    { id: 'note-plan', title: 'Exam plan', body: '12 days left.\n\n1. Membrane transport — already at 62%, keep the cards ticking over.\n2. Energy flow — weakest, one evidence only. Two focus sessions.\n3. Lab report — due after the osmosis session.' },
  ],
};
