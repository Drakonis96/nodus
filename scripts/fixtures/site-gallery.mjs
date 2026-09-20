// English-only, disposable data for the public website captures.
// These helpers run in the real application's renderer against its preload API.
export async function enrichLearningWorkspace(teaching) {
  const api = window.nodus;
  const ws = await api.getStudyWorkspace();
  const subjects = ws.subjects;
  const colors = ['#0d9488', '#7c3aed'];
  for (const [index, subject] of subjects.entries()) {
    await api.updateStudyEntity('subject', subject.id, { color: colors[index % colors.length] });
  }
  const schedule = await api.getStudySchedule(ws.academicYears[0]?.id ?? null);
  schedule.periods = [
    { id: 'site-first', section: 'morning', label: 'First period', startTime: '09:00', endTime: '10:00', position: 0 },
    { id: 'site-second', section: 'morning', label: 'Second period', startTime: '10:15', endTime: '11:15', position: 1 },
    { id: 'site-third', section: 'morning', label: 'Workshop', startTime: '11:30', endTime: '12:30', position: 2 },
    { id: 'site-fourth', section: 'afternoon', label: 'Afternoon', startTime: '15:00', endTime: '16:00', position: 3 },
  ];
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  schedule.cells = days.flatMap((day, d) => schedule.periods.map((period, p) => ({
    day, periodId: period.id, subjectId: p === 2 ? null : subjects[(d + p) % subjects.length].id,
    activityTitle: p === 2 ? (teaching ? 'Source analysis workshop' : 'Laboratory practice') : null,
  })));
  await api.saveStudySchedule(schedule);
  const now = new Date();
  const titles = teaching
    ? ['Primary sources workshop', 'Map analysis', 'Essay feedback', 'Industrial Revolution exam', 'Teaching team meeting', 'Fieldwork presentations', 'Source commentary due', 'Unit planning']
    : ['Membrane transport lab', 'Ecology reading group', 'Flashcard review', 'Cell biology exam', 'Field notebook due', 'Ecosystem seminar', 'Practice questions', 'Revision session'];
  for (let i = 0; i < titles.length; i++) {
    const date = new Date(now.getFullYear(), now.getMonth(), 3 + i * 3, 10, 0);
    await api.createStudyCalendarEvent({ title: titles[i], type: ['class', 'session', 'assignment', 'exam'][i % 4],
      startsAt: date.toISOString(), endsAt: new Date(+date + 3600000).toISOString(), subjectId: subjects[i % subjects.length].id });
  }
  const prompts = teaching ? [
    ['Which source gives first-hand evidence of factory working conditions?', 'A factory inspector’s report from 1842', 'A modern textbook summary', 'A historical novel', 'A recent documentary'],
    ['Which innovation most directly powered early textile factories?', 'The steam engine', 'The telephone', 'The internal combustion engine', 'The radio'],
    ['What does comparing two conflicting accounts help a historian assess?', 'Perspective and reliability', 'The length of each document', 'The number of paragraphs', 'The author’s handwriting'],
    ['Which factor contributed to industrial urbanisation?', 'The growth of factory employment', 'A decline in transport links', 'The closure of urban markets', 'A ban on rural migration'],
  ] : [
    ['Which process moves molecules against their concentration gradient?', 'Active transport', 'Simple diffusion', 'Osmosis', 'Facilitated diffusion'],
    ['What is the main structural component of the cell membrane?', 'A phospholipid bilayer', 'A cellulose wall', 'A single protein layer', 'A starch coating'],
    ['Which organelle produces most ATP during aerobic respiration?', 'The mitochondrion', 'The nucleus', 'The Golgi apparatus', 'The lysosome'],
    ['What describes the role of a decomposer in an ecosystem?', 'Recycling nutrients from dead matter', 'Producing sunlight', 'Fixing all atmospheric oxygen', 'Stopping the food web'],
    ['Which interaction benefits both species involved?', 'Mutualism', 'Predation', 'Parasitism', 'Competition'],
    ['What happens to a plant cell placed in a hypotonic solution?', 'Water enters the cell', 'All water leaves the cell', 'Its membrane dissolves', 'Its nucleus divides immediately'],
  ];
  for (const [index, entry] of prompts.entries()) {
    await api.createStudyQuestion({ prompt: entry[0], type: 'single_choice', status: 'approved',
      difficulty: ['easy', 'medium', 'hard'][index % 3], cognitiveLevel: index % 2 ? 'understand' : 'apply',
      subjectId: subjects[teaching ? 0 : ([3, 4].includes(index) ? 1 : 0)].id, tags: teaching ? ['History', 'Source analysis'] : ['Biology', 'Exam preparation'],
      options: entry.slice(1).map((text, i) => ({ id: `o${i}`, text, correct: i === 0 })),
      answer: { text: entry[1] }, explanation: teaching ? 'Evaluate the evidence in its historical context and distinguish primary from secondary sources.' : 'Use the underlying biological mechanism to explain your choice, rather than memorising the answer.',
    });
  }
  // Older built-in demo questions store string options; normalise those examples
  // through the public API so the bank renders complete English answer choices.
  for (const q of await api.listStudyQuestions({})) {
    const options = q.options.map((option, i) => typeof option === 'string'
      ? { id: `o${i}`, text: option, correct: option === q.answer.value } : option);
    await api.updateStudyQuestion(q.id, { ...q, options,
      answer: options.some(o => o.correct) ? { text: options.find(o => o.correct).text } : q.answer,
      tags: q.tags.map(tag => ({ membrana: 'Membrane', transporte: 'Transport' }[tag] ?? tag)),
    });
  }
}

export async function enrichDatabaseWorkspace(imageRoot) {
  const api = window.nodus;
  const rows = await api.listDatabaseRows('demo-db-samples');
  const names = ['Alpine moss', 'Coastal lichen', 'Woodland fern', 'Green algae', 'Riverbank moss', 'Rock lichen', 'Royal fern', 'Brown algae'];
  for (let i = 0; i < rows.length; i++) {
    await api.setDatabaseCell(rows[i].id, 'demo-col-samples-name', names[i]);
    await api.setDatabaseCell(rows[i].id, 'demo-col-samples-notes', i < 3
      ? 'Illustrative AI-generated image for this demonstration.' : 'Field sample from the example collection.');
  }
  const detail = await api.getDatabaseDetail('demo-db-samples');
  const habitat = detail.columns.find(c => c.id === 'demo-col-samples-habitat');
  const coast = habitat.options.find(o => o.label === 'Coast');
  await api.setDatabaseCell(rows[1].id, habitat.id, JSON.stringify([coast.id]));
  const attached = await api.bulkAttachDatabaseFiles('demo-db-samples', 'demo-col-samples-code', 'demo-col-samples-photo', [
    { name: 'MC-001.jpg', path: `${imageRoot}/alpine-moss.jpg` },
    { name: 'MC-002.jpg', path: `${imageRoot}/coastal-lichen.jpg` },
    { name: 'MC-003.jpg', path: `${imageRoot}/woodland-fern.jpg` },
  ], { ocr: false, describe: false });
  if (attached.attached !== 3) throw new Error('All three distinct photos must be attached before capture.');
  await api.createDatabaseView('demo-db-samples', { name: 'Photo catalogue', layout: 'gallery',
    filter: { conjunction: 'and', conditions: [{ id: 'has-photo', columnId: 'demo-col-samples-photo', op: 'notEmpty' }] }, sorts: [] });
  const experiments = await api.listDatabaseRows('demo-db-experiments');
  const titles = ['Germination in shade', 'Salinity tolerance', 'Pigment profiling', 'PCR identification', 'Stomatal density', 'Cross-contamination'];
  const hypotheses = ['Shade reduces germination rates.', 'Coastal lichen tolerates higher salinity.', 'Pigment profiles distinguish algae species.',
    'Universal primers identify the genus.', 'Stomatal density varies with altitude.', 'The original protocol introduced contamination.'];
  for (let i = 0; i < experiments.length; i++) {
    await api.setDatabaseCell(experiments[i].id, 'demo-col-experiments-title', titles[i]);
    await api.setDatabaseCell(experiments[i].id, 'demo-col-experiments-hypothesis', hypotheses[i]);
  }
}
