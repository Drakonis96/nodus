/* Nodus web demo — DATABASES mode. A static sample of the app's Databases vault:
   three typed tables (Field samples, Experiments, Reading list) with the same
   column types the desktop app uses — title, text, single/multi-select, number,
   date, checkbox, attachment, relation and an AI-summary column. The Analysis and
   Data-chat sections are computed from these rows in databases-app.js. Modelled on
   electron/db/databasesDemoData.ts, with English sample content. */
(function () {
  // Option palette — the same accent hues the app assigns to select options.
  const C = {
    green: '#34d399', teal: '#22d3ee', violet: '#8b5cf6', blue: '#6366f1',
    orange: '#f97316', amber: '#fbbf24', red: '#f87171', pink: '#f472b6',
  };

  const databases = [
    {
      id: 'DEMO1', name: 'Field samples', shortId: 'DB-DEMO1', icon: 'grid',
      columns: [
        { key: 'name', name: 'Name', type: 'title' },
        { key: 'code', name: 'Code', type: 'text' },
        { key: 'species', name: 'Species', type: 'select', options: [
          { key: 'moss', label: 'Moss', color: C.green },
          { key: 'lichen', label: 'Lichen', color: C.teal },
          { key: 'fern', label: 'Fern', color: C.violet },
          { key: 'alga', label: 'Alga', color: C.blue },
        ] },
        { key: 'habitat', name: 'Habitat', type: 'multiSelect', options: [
          { key: 'forest', label: 'Forest', color: C.green },
          { key: 'coast', label: 'Coast', color: C.blue },
          { key: 'mountain', label: 'Mountain', color: C.orange },
          { key: 'river', label: 'River', color: C.teal },
        ] },
        { key: 'weight', name: 'Weight (g)', type: 'number' },
        { key: 'cover', name: 'Cover (%)', type: 'number' },
        { key: 'collected', name: 'Collected', type: 'date' },
        { key: 'analyzed', name: 'Analyzed', type: 'checkbox' },
        { key: 'photo', name: 'Photo', type: 'attachment' },
        { key: 'notes', name: 'Notes', type: 'text' },
        { key: 'summary', name: 'AI summary', type: 'ai' },
      ],
      rows: [
        { name: 'Alpine moss', code: 'MC-001', species: 'moss', habitat: ['mountain', 'forest'], weight: 12.4, cover: 38, collected: '2026-05-03', analyzed: true, notes: 'Humid shade, north face.' },
        { name: 'Rock lichen', code: 'MC-002', species: 'lichen', habitat: ['mountain'], weight: 8.1, cover: 22, collected: '2026-05-03', analyzed: false, notes: 'On exposed granite.' },
        { name: 'Shade fern', code: 'MC-003', species: 'fern', habitat: ['forest', 'river'], weight: 20.0, cover: 55, collected: '2026-05-11', analyzed: true, notes: 'Beside a stream.' },
        { name: 'Green alga', code: 'MC-004', species: 'alga', habitat: ['coast'], weight: 5.7, cover: 12, collected: '2026-05-18', analyzed: false, notes: 'Intertidal pool.' },
        { name: 'Riverbank moss', code: 'MC-005', species: 'moss', habitat: ['river', 'forest'], weight: 9.9, cover: 31, collected: '2026-05-22', analyzed: true, notes: null },
        { name: 'Coastal lichen', code: 'MC-006', species: 'lichen', habitat: ['coast'], weight: 3.2, cover: 9, collected: '2026-06-01', analyzed: false, notes: 'Rock hit by surf.' },
        { name: 'Royal fern', code: 'MC-007', species: 'fern', habitat: ['forest'], weight: 27.6, cover: 61, collected: '2026-06-09', analyzed: true, notes: 'Large specimen, fertile tip.' },
        { name: 'Brown alga', code: 'MC-008', species: 'alga', habitat: ['coast'], weight: 14.3, cover: 27, collected: '2026-06-15', analyzed: false, notes: null },
      ],
    },
    {
      id: 'DEMO2', name: 'Experiments', shortId: 'DB-DEMO2', icon: 'grid',
      columns: [
        { key: 'title', name: 'Title', type: 'title' },
        { key: 'hypothesis', name: 'Hypothesis', type: 'text' },
        { key: 'status', name: 'Status', type: 'select', options: [
          { key: 'planned', label: 'Planned', color: C.blue },
          { key: 'ongoing', label: 'In progress', color: C.amber },
          { key: 'done', label: 'Completed', color: C.green },
          { key: 'dropped', label: 'Discarded', color: C.red },
        ] },
        { key: 'techniques', name: 'Techniques', type: 'multiSelect', options: [
          { key: 'microscopy', label: 'Microscopy', color: C.violet },
          { key: 'spectrometry', label: 'Spectrometry', color: C.teal },
          { key: 'pcr', label: 'PCR', color: C.pink },
          { key: 'culture', label: 'Culture', color: C.green },
        ] },
        { key: 'replicates', name: 'Replicates', type: 'number' },
        { key: 'duration', name: 'Duration (days)', type: 'number' },
        { key: 'start', name: 'Start', type: 'date' },
        { key: 'confirmed', name: 'Confirmed', type: 'checkbox' },
        { key: 'sample', name: 'Sample', type: 'relation', relTo: 'DEMO1' },
      ],
      rows: [
        { title: 'Shade germination', hypothesis: 'Shade lowers the germination rate.', status: 'done', techniques: ['culture', 'microscopy'], replicates: 6, duration: 21, start: '2026-03-02', confirmed: true, sample: 'Alpine moss' },
        { title: 'Salinity tolerance', hypothesis: 'Coastal lichen tolerates higher salinity.', status: 'ongoing', techniques: ['culture', 'spectrometry'], replicates: 4, duration: 35, start: '2026-04-14', confirmed: false, sample: 'Rock lichen' },
        { title: 'Pigment profile', hypothesis: 'The pigment profile differs by habitat.', status: 'ongoing', techniques: ['spectrometry'], replicates: 3, duration: 28, start: '2026-05-06', confirmed: false, sample: 'Green alga' },
        { title: 'PCR identification', hypothesis: 'Universal primers identify the four species.', status: 'planned', techniques: ['pcr'], replicates: 8, duration: 14, start: '2026-07-01', confirmed: false, sample: null },
        { title: 'Stomatal density', hypothesis: 'Stomatal density rises with altitude.', status: 'done', techniques: ['microscopy'], replicates: 5, duration: 40, start: '2026-02-19', confirmed: true, sample: 'Shade fern' },
        { title: 'Cross-contamination', hypothesis: 'The old protocol introduces cross-contamination.', status: 'dropped', techniques: ['pcr', 'culture'], replicates: 2, duration: 9, start: '2026-01-30', confirmed: false, sample: null },
      ],
    },
    {
      id: 'DEMO3', name: 'Reading list', shortId: 'DB-DEMO3', icon: 'book',
      columns: [
        { key: 'title', name: 'Title', type: 'title' },
        { key: 'field', name: 'Field', type: 'select', options: [
          { key: 'botany', label: 'Botany', color: C.green },
          { key: 'ecology', label: 'Ecology', color: C.teal },
          { key: 'genetics', label: 'Genetics', color: C.violet },
          { key: 'methods', label: 'Methods', color: C.orange },
        ] },
        { key: 'priority', name: 'Priority', type: 'select', options: [
          { key: 'high', label: 'High', color: C.red },
          { key: 'medium', label: 'Medium', color: C.amber },
          { key: 'low', label: 'Low', color: C.green },
        ] },
        { key: 'tags', name: 'Tags', type: 'multiSelect', options: [
          { key: 'review', label: 'review', color: C.blue },
          { key: 'fieldwork', label: 'fieldwork', color: C.green },
          { key: 'taxonomy', label: 'taxonomy', color: C.violet },
          { key: 'protocol', label: 'protocol', color: C.pink },
          { key: 'reference', label: 'reference', color: C.teal },
          { key: 'guide', label: 'guide', color: C.orange },
        ] },
        { key: 'year', name: 'Year', type: 'number' },
        { key: 'read', name: 'Read', type: 'checkbox' },
      ],
      rows: [
        { title: 'Bryophyte ecology of alpine zones', field: 'ecology', priority: 'high', tags: ['review', 'fieldwork'], year: 2021, read: true },
        { title: 'Lichen photobionts revisited', field: 'botany', priority: 'medium', tags: ['taxonomy'], year: 2019, read: true },
        { title: 'PCR primers for cryptogams', field: 'methods', priority: 'high', tags: ['protocol'], year: 2023, read: false },
        { title: 'Pigment spectrometry handbook', field: 'methods', priority: 'low', tags: ['reference'], year: 2018, read: false },
        { title: 'Fern reproduction and habitat', field: 'genetics', priority: 'medium', tags: ['review'], year: 2022, read: false },
        { title: 'Coastal algae field guide', field: 'botany', priority: 'low', tags: ['fieldwork', 'guide'], year: 2020, read: true },
      ],
    },
  ];

  // Canned Data-chat replies per database — the shape a grounded answer takes.
  const chat = {
    DEMO1: [
      { text: 'Across the 8 samples, weight and cover move together: the two ferns (Royal fern 27.6 g, Shade fern 20 g) top both, while the coastal lichen sits at the bottom (3.2 g, 9% cover). Half the samples are still unanalyzed.' },
      { text: 'By habitat, Forest is the most common tag (4 samples), then Coast (3). Coastal samples are consistently the lightest — a pattern worth a group comparison in Analysis.' },
      { text: 'Data quality: two rows have empty Notes and the Photo column is 0% filled. No numeric outliers — every weight sits inside 1.5×IQR.' },
    ],
    DEMO2: [
      { text: 'Two experiments are Completed and both were Confirmed; the two In-progress ones are not yet. The single Discarded run (Cross-contamination) had the fewest replicates (2) and the shortest duration (9 days).' },
      { text: 'Replicates and duration are only weakly related here — the 8-replicate PCR run is one of the shortest (14 days), while Stomatal density ran 40 days on 5 replicates.' },
      { text: 'Three experiments link to a Field sample via the Sample relation; the two method-development runs (PCR identification, Cross-contamination) have none.' },
    ],
    DEMO3: [
      { text: 'Six references, half read. Both High-priority items sit in Ecology and Methods, and one of them (PCR primers, 2023) is still unread — a good next read.' },
      { text: 'By field, Botany and Methods have two entries each. The newest reference is from 2023, the oldest 2018; the median year is 2020.5.' },
      { text: '"fieldwork" and "review" are the most common tags. Nothing here is tagged both High priority and read except the alpine-zone review.' },
    ],
  };

  const settings = {
    providers: [
      { name: 'Anthropic', desc: 'Claude — cloud, bring your own key', key: 'sk-ant-•••••••••••••4b2a', on: true },
      { name: 'OpenAI', desc: 'GPT — cloud, bring your own key', key: '', on: false },
      { name: 'Ollama', desc: 'Local models, fully offline', key: '', on: false },
      { name: 'LM Studio', desc: 'Local models, fully offline', key: '', on: false },
    ],
    models: [
      ['Data chat', 'claude-opus-4-8'],
      ['AI summary column', 'claude-sonnet-5'],
      ['Suggested analyses', 'claude-opus-4-8'],
      ['Analysis report', 'claude-sonnet-5'],
    ],
  };

  const notes = [
    { id: 'n1', folder: 'Fieldwork', title: 'Sampling protocol', updated: 'today', body: 'Every row in [Field samples] is one collection event. Weigh fresh, photograph in situ, then flag [Analyzed] once processed. Cover (%) is estimated over a 25×25 cm quadrat.' },
    { id: 'n2', folder: 'Fieldwork', title: 'Open questions', updated: '2 days ago', body: 'Does cover really track weight, or is it driven by [Species]? Run a correlation in Analysis, then a group comparison by habitat. Link findings back to the [Experiments] that use each sample.' },
    { id: 'n3', folder: 'Lab', title: 'Experiment log', updated: '4 days ago', body: 'Salinity tolerance is still In progress at 35 days. Cross-contamination was discarded — the old protocol failed. See the [Reading list] entry "PCR primers for cryptogams" before the next PCR run.' },
  ];

  window.DB = { databases, chat, settings, notes };
})();
