/* Nodus web demo — TEACHING mode.
   This fixture mirrors electron/db/teachingDemoData.ts and the real UI captures:
   one Year 9 History group, an analytic rubric, a printable exam and a published
   gradebook whose non-numeric states remain distinct from zero. */
(function () {
  const students = [
    { id: 's1', code: 'STU_BSQV', first: 'Lucía', last: 'Alonso Prieto', note: 'Argues well in class; ready for more demanding sources.', marks: [9.1, 8.5, 9.3, 9, 9.5], statuses: ['evaluated', 'evaluated', 'evaluated', 'evaluated', 'evaluated'] },
    { id: 's2', code: 'STU_YDHC', first: 'Adrián', last: 'Benítez Salas', note: 'Improves markedly when he works from an outline.', marks: [6.4, 7, 6.1, 7.5, 6], statuses: ['evaluated', 'evaluated', 'evaluated', 'evaluated', 'evaluated'] },
    { id: 's3', code: 'STU_WCNP', first: 'Nerea', last: 'Cabrera Ruiz', note: 'Strong vocabulary; her conclusions still trail off.', marks: [7.8, 6.2, 8.4, 8, 7], statuses: ['evaluated', 'evaluated', 'evaluated', 'evaluated', 'evaluated'] },
    { id: 's4', code: 'STU_NAPW', first: 'Iván', last: 'Domínguez Peña', note: 'Joined in November: unit 1 still to be made up.', marks: [5.2, null, 4.8, null, 6.5], statuses: ['evaluated', 'not_assessed', 'evaluated', 'not_submitted', 'evaluated'] },
    { id: 's5', code: 'STU_6J8S', first: 'Marta', last: 'Esteban Gil', note: 'Exempt from the map test under a curricular adaptation.', marks: [7.1, null, 7.6, 8.5, 8], statuses: ['evaluated', 'exempt', 'evaluated', 'evaluated', 'evaluated'] },
    { id: 's6', code: 'STU_QFNK', first: 'Youssef', last: 'Fernández Amrani', note: 'Analyses well out loud; written expression needs support.', marks: [4.6, 5.5, 5.9, 6, 7.5], statuses: ['evaluated', 'evaluated', 'evaluated', 'evaluated', 'evaluated'] },
  ];

  const levels = [
    { id: 'l1', name: 'Excellent', score: 10 },
    { id: 'l2', name: 'Good', score: 6.67 },
    { id: 'l3', name: 'Adequate', score: 3.33 },
    { id: 'l4', name: 'Needs improvement', score: 0 },
  ];

  const rubric = {
    id: 'historical-commentary', title: 'Historical source commentary', subject: 'History', maximum: 10,
    description: 'Weighted analytic rubric for the unit 3 commentary.',
    criteria: [
      { name: 'Historical contextualisation', weight: 30, description: 'How the document is tied to the moment that produced it.', cells: [
        'Places the document in its precise historical moment and explains how the period shapes its content.',
        'Identifies the relevant period and the main events surrounding the document.',
        'Locates the text in a broad time frame and offers some contextual detail.',
        'Links the document to a general stage, with approximate references to its origin.',
      ] },
      { name: 'Analysis of the content', weight: 30, description: 'How the ideas in the source are handled.', cells: [
        'Separates main and secondary ideas and connects them into an original interpretation.',
        'Draws out the central ideas and follows the internal structure of the document.',
        'Recognises relevant ideas but leaves most of them disconnected.',
        'Reproduces fragments with brief remarks on their literal meaning.',
      ] },
      { name: 'Subject vocabulary', weight: 25, description: 'Command of the terminology proper to the subject.', cells: [
        'Uses disciplinary terms precisely and clarifies them when the context calls for it.',
        'Uses terminology suited to the topic and handles the core concepts confidently.',
        'Mixes general wording with technical terms applied unevenly.',
        'Relies on everyday wording and phrases lifted from the prompt.',
      ] },
      { name: 'Clarity of exposition', weight: 15, description: 'How the writing and reasoning progress.', cells: [
        'Guides the reader through progressive paragraphs to a clearly bounded conclusion.',
        'Presents an ordered account with transitions that preserve the thread of reasoning.',
        'Develops the commentary linearly, with uneven paragraphs and a terse ending.',
        'Strings observations together and leaves the ending implicit.',
      ] },
    ],
  };

  const exam = {
    id: 'unit-3', title: 'Written test · unit 3', subject: 'History', duration: 55, points: 4.75,
    institution: 'Sample secondary school', printedSubject: 'Geography and History', group: 'Year 9 A',
    instructions: 'Read the whole paper before answering. Mind your expression and always justify your answers.',
    questions: [
      { n: '1', type: 'Definition', points: 1, prompt: 'Define “industrial revolution” and state the period in which it unfolds.' },
      { n: '2', type: 'Section', points: 0, prompt: 'Read the following testimony: “The children enter the mill before daybreak and leave when it is already dark. The air is thick with cotton dust.” (Parliamentary report, 1832)' },
      { n: '2.1', type: 'Short essay', points: 1.5, prompt: 'Explain which working conditions the testimony describes.' },
      { n: '2.2', type: 'Short answer', points: 0.5, prompt: 'What social response emerged in the face of these conditions?' },
      { n: '3', type: 'Multiple choice', points: 0.5, prompt: 'Which energy source characterises the first industrialisation?', options: ['Coal', 'Oil', 'Electricity', 'Natural gas'], answer: 'Coal' },
      { n: '4', type: 'True / false', points: 0.25, prompt: 'Industrialisation reached the whole of Europe at the same time.', answer: 'False: it was an uneven, staggered process.' },
      { n: '5', type: 'Matching', points: 1, prompt: 'Match each invention with the field it applied to.', answer: 'Steam–transport; power loom–textiles; converter–steelmaking.' },
    ],
  };

  const columns = [
    { id: 'exam', name: 'Unit 3 exam', weight: 30, parent: 'Written tests' },
    { id: 'maps', name: 'Map test', weight: 20, parent: 'Written tests' },
    { id: 'commentary', name: 'Guided commentary', weight: 30, parent: 'Source commentary' },
    { id: 'notebook', name: 'Class notebook', weight: 10, parent: 'Classwork' },
    { id: 'participation', name: 'Reasoned participation', weight: 10, parent: 'Classwork' },
  ];

  window.TEACHING = {
    year: '2025/2026', course: 'Year 9 · Geography and History', subject: 'History', group: 'Year 9 A',
    students, levels, rubric, exam, columns,
    recent: [
      { kind: 'exam', title: 'Written test · unit 3', meta: '6 scored questions · printable preview' },
      { kind: 'rubric', title: 'Historical source commentary', meta: '4 criteria · 4 levels · weights 100%' },
      { kind: 'grades', title: 'History · Year 9 A', meta: 'Published assessment plan · 6 students' },
    ],
  };
})();
