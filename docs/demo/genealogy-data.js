/* Sample corpus for the Nodus GENEALOGY web demo. Static and self-contained.
   A fictional but period-authentic Andalusian family (Ronda / Málaga, 1841–1931)
   with an emigration thread to Buenos Aires — chosen because it yields real
   kinship, primary-source evidence, a social network and a family-history report,
   exactly what the genealogy vault reconstructs. Names, dates and places are
   invented; any resemblance to real records is coincidental. */
window.GEN = {
  vault: 'Herrera–Sotomayor',
  mode: 'Genealogy',

  // sex drives the tree/portrait accent. accent is a period-sepia hue.
  persons: [
    { id: 'p1', name: 'Bartolomé Herrera Ríos', sex: 'M', birth: { date: '1841', place: 'Ronda' }, death: { date: '1908', place: 'Málaga' }, occupation: 'Master tanner (maestro curtidor)', gen: 0,
      bio: 'Head of the Herrera tannery on calle Curtidores in Ronda. Moved the family to Málaga around 1878 when the leather trade shifted to the port. Recorded as a witness in three parish marriages beyond his own children’s.', conf: 'confirmed' },
    { id: 'p2', name: 'Dolores Sotomayor Pérez', sex: 'F', birth: { date: '1847', place: 'Ronda' }, death: { date: '1919', place: 'Málaga' }, occupation: 'Household (sus labores)', gen: 0,
      bio: 'Married Bartolomé in 1866. Her father, a wheelwright, appears as a godfather across the extended family — the thread that first linked the Sotomayor and Vega households.', conf: 'confirmed' },

    { id: 'p3', name: 'Francisco Herrera Sotomayor', sex: 'M', birth: { date: '1868', place: 'Ronda' }, death: { date: '1931', place: 'Málaga' }, occupation: 'Tanner, later warehouse foreman', gen: 1,
      bio: 'Eldest son. Took over the tannery, then took wage work at a port warehouse after 1890. His military levy record (1888) fixes his birth year and physical description.', conf: 'confirmed' },
    { id: 'p4', name: 'María Herrera Sotomayor', sex: 'F', birth: { date: '1871', place: 'Ronda' }, death: { date: '1949', place: 'Buenos Aires' }, occupation: 'Seamstress (costurera)', gen: 1,
      bio: 'Emigrated to Argentina in 1905 with her husband; the Buenos Aires passenger manifest is the last Spanish record and the first American one.', conf: 'confirmed' },
    { id: 'p5', name: 'Antonio Herrera Sotomayor', sex: 'M', birth: { date: '1875', place: 'Ronda' }, death: { date: '1876', place: 'Ronda' }, occupation: '—', gen: 1,
      bio: 'Died in infancy; recorded only in the 1876 parish death book. Included because the burial entry names both parents and disambiguates the household in the 1877 padrón.', conf: 'confirmed' },

    { id: 'p6', name: 'Carmen Vega Luna', sex: 'F', birth: { date: '1872', place: 'Ronda' }, death: { date: '1938', place: 'Málaga' }, occupation: 'Household', gen: 1,
      bio: 'Married Francisco in 1897. Daughter of a Vega household connected to the Sotomayors through godparent ties two decades earlier.', conf: 'confirmed' },
    { id: 'p7', name: 'José Herrera Vega', sex: 'M', birth: { date: '1899', place: 'Málaga' }, death: { date: '1972', place: 'Málaga' }, occupation: 'Typesetter (cajista de imprenta)', gen: 2,
      bio: 'Only surviving child of Francisco and Carmen. His 1899 baptism at Los Mártires closes the male line in the corpus.', conf: 'confirmed' },
    { id: 'p8', name: 'Ramón Ortega ¿Herrera?', sex: 'M', birth: { date: 'c. 1901', place: 'Málaga (?)' }, death: { date: '—', place: '—' }, occupation: 'Unknown', gen: 2,
      bio: 'A foundling surnamed Ortega baptised in 1901 with a marginal note naming a “Herrera” godmother. Possibly a second child of Francisco and Carmen, but the evidence is indirect — logged as an open identity question, not a confirmed link.', conf: 'hypothesis' },
  ],

  // parent → child (biological/legal filiation as the records state it)
  filiation: [
    { parent: 'p1', child: 'p3' }, { parent: 'p2', child: 'p3' },
    { parent: 'p1', child: 'p4' }, { parent: 'p2', child: 'p4' },
    { parent: 'p1', child: 'p5' }, { parent: 'p2', child: 'p5' },
    { parent: 'p3', child: 'p7' }, { parent: 'p6', child: 'p7' },
  ],
  // marriages / unions
  unions: [
    { a: 'p1', b: 'p2', date: '1866', place: 'Ronda, Santa María la Mayor' },
    { a: 'p3', b: 'p6', date: '1897', place: 'Málaga, Los Mártires' },
    { a: 'p4', b: 'c1', date: '1896', place: 'Ronda, Espíritu Santo' }, // María m. an external spouse
  ],

  // people who are not (yet) part of the tree: godparents, spouses-in, partners
  contacts: [
    { id: 'c1', name: 'Manuel Gutiérrez Pino', note: 'Husband of María Herrera. Carpenter; emigrated with her to Buenos Aires in 1905. Not yet given his own ficha.' },
    { id: 'c2', name: 'Rafael Sotomayor (el ruedero)', note: 'Wheelwright, Dolores’s father. Recurring godfather across the Sotomayor and Vega households.' },
    { id: 'c3', name: 'Fr. Andrés Molina', note: 'Parish priest, Santa María la Mayor (Ronda). Officiant on the 1866 and 1868 entries.' },
    { id: 'c4', name: 'Casa Larios (warehouse)', note: 'Employer named in Francisco’s post-1890 records and in the port workers’ roll.' },
  ],

  // social relations, from a person’s ficha (independent of kinship)
  relations: [
    { from: 'p1', to: 'c4', kind: 'contact', role: 'employer', notes: 'Sold tanned hides to the Larios warehouse from 1882; the ledger names him by trade.' },
    { from: 'p1', to: 'c3', kind: 'contact', role: 'officiant', notes: 'Married the couple and baptised Francisco.' },
    { from: 'p2', to: 'c2', kind: 'contact', role: 'father', notes: 'Rafael is Dolores’s father; recorded as godfather to Francisco (1868).' },
    { from: 'p3', to: 'c4', kind: 'contact', role: 'employer', notes: 'Foreman at Casa Larios after leaving the tannery.' },
    { from: 'p6', to: 'p2', kind: 'person', role: 'godmother', notes: 'Dolores stood as godmother at a Vega baptism in 1874 — the earliest Herrera–Vega tie.' },
    { from: 'p4', to: 'c1', kind: 'contact', role: 'spouse', notes: 'Married 1896; emigrated together.' },
  ],

  // historical events, each anchored to an archive source
  events: [
    { id: 'e1', type: 'marriage', date: '1866-05-12', place: 'Ronda', persons: ['p1', 'p2'], source: 'a1', summary: 'Marriage of Bartolomé Herrera and Dolores Sotomayor, Santa María la Mayor.' },
    { id: 'e2', type: 'baptism', date: '1868-02-03', place: 'Ronda', persons: ['p3'], source: 'a2', summary: 'Baptism of Francisco; godfather Rafael Sotomayor.' },
    { id: 'e3', type: 'birth', date: '1871-09-20', place: 'Ronda', persons: ['p4'], source: 'a3', summary: 'Birth of María, from the 1877 padrón household roll.' },
    { id: 'e4', type: 'death', date: '1876-07-01', place: 'Ronda', persons: ['p5'], source: 'a4', summary: 'Death of Antonio, infant; entry names both parents.' },
    { id: 'e5', type: 'census', date: '1877', place: 'Ronda', persons: ['p1', 'p2', 'p3', 'p4'], source: 'a3', summary: 'Padrón municipal: the Herrera–Sotomayor household on calle Curtidores.' },
    { id: 'e6', type: 'military', date: '1888', place: 'Ronda', persons: ['p3'], source: 'a5', summary: 'Military levy (quinta): Francisco, height and trade recorded.' },
    { id: 'e7', type: 'marriage', date: '1897-06-08', place: 'Málaga', persons: ['p3', 'p6'], source: 'a6', summary: 'Marriage of Francisco Herrera and Carmen Vega, Los Mártires.' },
    { id: 'e8', type: 'baptism', date: '1899-11-15', place: 'Málaga', persons: ['p7'], source: 'a7', summary: 'Baptism of José Herrera Vega, Los Mártires.' },
    { id: 'e9', type: 'migration', date: '1905-04-30', place: 'Buenos Aires', persons: ['p4'], source: 'a8', summary: 'Arrival manifest: María Herrera and Manuel Gutiérrez, steamer from Málaga.' },
    { id: 'e10', type: 'death', date: '1908-03-22', place: 'Málaga', persons: ['p1'], source: 'a9', summary: 'Death of Bartolomé Herrera; civil register, cause and residence noted.' },
  ],

  // places, positioned on a schematic map (x/y as % of the frame)
  places: [
    { id: 'pl1', name: 'Ronda', region: 'Málaga, Andalucía', x: 30, y: 62, kind: 'origin', count: 6, note: 'Origin of the family; tannery and first four life events.' },
    { id: 'pl2', name: 'Málaga', region: 'Andalucía', x: 44, y: 74, kind: 'residence', count: 4, note: 'The port city the family moved to c. 1878.' },
    { id: 'pl3', name: 'Buenos Aires', region: 'Argentina', x: 33, y: 92, kind: 'emigration', count: 1, note: 'María’s emigration, 1905 — the Atlantic edge of the corpus.' },
  ],

  // the evidence archive: primary sources, indexed and transcribed
  archive: [
    { id: 'a1', kind: 'Marriage record', title: 'Libro de matrimonios, Santa María la Mayor', date: '1866', place: 'Ronda', repository: 'Archivo Parroquial de Ronda', persons: ['p1', 'p2'],
      transcript: '«En la villa de Ronda, a doce de mayo de mil ochocientos sesenta y seis, yo, el infrascrito cura, desposé por palabras de presente a Bartolomé Herrera Ríos, curtidor, hijo de… con Dolores Sotomayor Pérez, hija de Rafael Sotomayor…»',
      facts: ['Groom: Bartolomé Herrera Ríos, tanner', 'Bride: Dolores Sotomayor Pérez', 'Bride’s father: Rafael Sotomayor', 'Date: 12 May 1866'] },
    { id: 'a2', kind: 'Baptism record', title: 'Libro de bautismos, folio 214', date: '1868', place: 'Ronda', repository: 'Archivo Parroquial de Ronda', persons: ['p3'],
      transcript: '«…bauticé solemnemente a un niño que nació el treinta y uno de enero, hijo legítimo de Bartolomé Herrera y de Dolores Sotomayor; fue su padrino Rafael Sotomayor, abuelo materno…»',
      facts: ['Child: Francisco Herrera Sotomayor', 'Born: 31 Jan 1868', 'Godfather: Rafael Sotomayor (maternal grandfather)'] },
    { id: 'a3', kind: 'Census (padrón)', title: 'Padrón municipal de Ronda, calle Curtidores 7', date: '1877', place: 'Ronda', repository: 'Archivo Municipal de Ronda', persons: ['p1', 'p2', 'p3', 'p4'],
      transcript: 'Household roll: Bartolomé Herrera (36, curtidor), Dolores Sotomayor (30), Francisco (9), María (5). Antonio not listed — consistent with the 1876 death entry.',
      facts: ['Household head: Bartolomé Herrera, 36', 'Dolores Sotomayor, 30', 'Francisco, 9 · María, 5', 'Address: calle Curtidores 7'] },
    { id: 'a4', kind: 'Death record', title: 'Libro de difuntos, párvulos', date: '1876', place: 'Ronda', repository: 'Archivo Parroquial de Ronda', persons: ['p5'],
      transcript: '«…murió Antonio Herrera Sotomayor, de edad de un año, hijo de Bartolomé Herrera y Dolores Sotomayor…»',
      facts: ['Deceased: Antonio Herrera Sotomayor, infant', 'Parents named: Bartolomé & Dolores', 'Date: 1 Jul 1876'] },
    { id: 'a5', kind: 'Military levy', title: 'Acta de la quinta de 1888', date: '1888', place: 'Ronda', repository: 'Archivo Municipal de Ronda', persons: ['p3'],
      transcript: 'Francisco Herrera Sotomayor, hijo de Bartolomé; talla 1,64 m; oficio curtidor; declarado útil. Fixes birth year 1868 and confirms trade.',
      facts: ['Conscript: Francisco Herrera, son of Bartolomé', 'Height: 1.64 m · trade: tanner', 'Confirms birth year 1868'] },
    { id: 'a6', kind: 'Marriage record', title: 'Libro de matrimonios, Los Mártires', date: '1897', place: 'Málaga', repository: 'Archivo Parroquial de Los Mártires (Málaga)', persons: ['p3', 'p6'],
      transcript: '«…contrajeron matrimonio Francisco Herrera Sotomayor, natural de Ronda, y Carmen Vega Luna, natural de Ronda, vecinos de Málaga…»',
      facts: ['Groom: Francisco Herrera (b. Ronda)', 'Bride: Carmen Vega Luna (b. Ronda)', 'Residents of Málaga · 1897'] },
    { id: 'a7', kind: 'Baptism record', title: 'Libro de bautismos, Los Mártires', date: '1899', place: 'Málaga', repository: 'Archivo Parroquial de Los Mártires (Málaga)', persons: ['p7'],
      transcript: '«…José Herrera Vega, hijo legítimo de Francisco Herrera y Carmen Vega, nacido el quince de noviembre de mil ochocientos noventa y nueve…»',
      facts: ['Child: José Herrera Vega', 'Born: 15 Nov 1899', 'Parents: Francisco & Carmen'] },
    { id: 'a8', kind: 'Passenger manifest', title: 'Lista de pasajeros, Puerto de Buenos Aires', date: '1905', place: 'Buenos Aires', repository: 'CEMLA — Centro de Estudios Migratorios Latinoamericanos', persons: ['p4'],
      transcript: 'Herrera, María, 33, española, costurera; Gutiérrez, Manuel, 35, carpintero — steamer arrived from Málaga, 30 Apr 1905.',
      facts: ['María Herrera, 33, seamstress', 'With Manuel Gutiérrez, 35, carpenter', 'From Málaga → Buenos Aires, 1905'] },
    { id: 'a9', kind: 'Civil death register', title: 'Registro Civil de Málaga, sección 3ª', date: '1908', place: 'Málaga', repository: 'Registro Civil de Málaga', persons: ['p1'],
      transcript: 'Bartolomé Herrera Ríos, 67, viudo (sic), curtidor jubilado; falleció el 22 de marzo de 1908 en calle de la Victoria. Note: “viudo” contradicts Dolores’s 1919 death — flagged.',
      facts: ['Deceased: Bartolomé Herrera Ríos, 67', 'Date: 22 Mar 1908, Málaga', '⚠ States “widower” — conflicts with Dolores (d. 1919)'] },
  ],

  // conflicts the engine surfaces (like the app’s conflict detection)
  conflicts: [
    { person: 'p1', text: 'The 1908 civil death register calls Bartolomé a “widower”, but Dolores Sotomayor’s death is recorded in 1919 — eleven years later. Likely a clerk’s error; both parish and civil sources otherwise agree.' },
  ],

  // AI kinship suggestions the user confirms (evidence-driven, never auto-added)
  kinSuggestions: [
    { id: 'k1', type: 'child', from: 'p3', to: 'p8', strength: 'baja', question: 'Was Ramón Ortega a second child of Francisco Herrera and Carmen Vega?',
      evidence: ['1901 foundling baptism (Ortega) with a marginal note naming a “Herrera” godmother', 'The household had no recorded child between 1899 and 1903', 'Surname Ortega is the standard foundling surname of the parish that year'] },
  ],

  // secondary literature that supports the reconstruction (the Library view)
  library: [
    { id: 'w1', author: 'Reder Gadow, M.', year: 1996, title: 'Vida y muerte en Málaga a fines del Antiguo Régimen', type: 'Book', note: 'Context for parish record-keeping in the diocese.' },
    { id: 'w2', author: 'Sánchez Alonso, B.', year: 1995, title: 'Las causas de la emigración española, 1880–1930', type: 'Book', note: 'Frames María’s 1905 emigration to the Río de la Plata.' },
    { id: 'w3', author: 'Mörner, M.', year: 1985, title: 'Adventurers and Proletarians: Migrants in Latin America', type: 'Book', note: 'Comparative migration patterns; the manifest genre.' },
  ],

  deepResearch: [
    {
      id: 'dr1',
      title: 'The Herrera–Sotomayor line: from the Ronda tannery to the Río de la Plata',
      meta: '4 sections · 9 primary sources · 3 references · generated from the archive',
      cover: '../assets/art/immersion-threads.svg',
      sections: [
        { title: '1 — A tanner’s household in Ronda', paras: [
          { text: 'The family enters the record in 1866, when Bartolomé Herrera Ríos, a master tanner, married Dolores Sotomayor Pérez at Santa María la Mayor [1]. Their household is fixed a decade later by the 1877 padrón, which lists Bartolomé (36), Dolores (30) and two surviving children on calle Curtidores [2]. A third child, Antonio, is present only in the 1876 infant death book — his absence from the padrón is itself the confirmation [3].', cites: [['[1] Marriage record, Ronda, 1866', 'a1'], ['[2] Padrón, Ronda, 1877', 'a3'], ['[3] Death book, Ronda, 1876', 'a4']] },
        ] },
        { title: '2 — Francisco, and the move to Málaga', paras: [
          { text: 'Francisco, baptised in 1868 with his maternal grandfather as godfather [4], is the pivot of the line. The 1888 military levy independently fixes his birth year and records his trade and height [5]; by his 1897 marriage to Carmen Vega he is a resident of Málaga [6], where the tannery gives way to warehouse work. Their son José, baptised in 1899, closes the male line held in this corpus [7].', cites: [['[4] Baptism, Ronda, 1868', 'a2'], ['[5] Military levy, 1888', 'a5'], ['[6] Marriage, Málaga, 1897', 'a6'], ['[7] Baptism, Málaga, 1899', 'a7']] },
        ] },
        { title: '3 — María, and the Atlantic', paras: [
          { text: 'The daughter, María, married in 1896 and emigrated in 1905; the Buenos Aires arrival manifest is simultaneously the last Spanish trace and the first American one, listing her, her husband and their trades [8]. It is the seam where this corpus would branch into an Argentine archive.', cites: [['[8] Passenger manifest, Buenos Aires, 1905', 'a8']] },
        ] },
        { title: '4 — One contradiction, left open', paras: [
          { text: 'A single conflict stands unresolved: the 1908 civil register calls Bartolomé a “widower”, yet Dolores’s death is recorded in 1919 [9]. Parish and civil sources agree on everything else, so a clerical error is the parsimonious reading — but the report records it as open rather than resolving it silently.', cites: [['[9] Civil death register, Málaga, 1908', 'a9']] },
        ] },
      ],
    },
  ],

  notes: [
    { id: 'n1', folder: 'Threads to chase', notes: [
      { id: 'nn1', title: 'The Vega–Sotomayor godparent tie', body: 'The earliest Herrera–Vega link is not the 1897 marriage but a godparent relation two decades earlier: Dolores stood as godmother at a Vega baptism in 1874. Worth pulling the full 1870s Vega baptisms.\n\nLinks: [person: Carmen Vega Luna] · [person: Dolores Sotomayor Pérez]', updated: '2 days ago' },
      { id: 'nn2', title: 'Ramón Ortega — foundling?', body: 'Low-confidence: a 1901 Ortega baptism with a “Herrera” godmother in the margin. Do NOT add to the tree — logged as an open identity question until a second source appears.\n\nLinks: [person: Ramón Ortega ¿Herrera?]', updated: 'yesterday' },
    ] },
    { id: 'n2', folder: 'Argentina', notes: [
      { id: 'nn3', title: 'Where the corpus crosses the Atlantic', body: 'The 1905 manifest is the branch point. Next: CEMLA arrival card + a Buenos Aires parish for any children of María and Manuel.\n\nLinks: [person: María Herrera Sotomayor]', updated: '4 days ago' },
    ] },
  ],

  settings: {
    providers: [
      { name: 'Anthropic', desc: 'Claude models · cloud', key: 'sk-ant-················7Kq2', on: true },
      { name: 'OpenAI', desc: 'GPT models · cloud', key: null, on: false },
      { name: 'Google', desc: 'Gemini models · cloud', key: null, on: false },
      { name: 'Ollama', desc: 'Local models · fully offline', key: 'http://127.0.0.1:11434', on: true },
      { name: 'LM Studio', desc: 'Local models · fully offline', key: 'http://127.0.0.1:1234', on: false },
    ],
    models: [
      ['Record analysis (persons & events)', 'claude-sonnet-5'],
      ['Family-history report', 'claude-sonnet-5'],
      ['Biographies & summaries', 'qwen3:8b · Ollama'],
      ['Embeddings (archive index)', 'nomic-embed-text · Ollama'],
    ],
  },
};

window.GEN_EVENT_COLORS = {
  birth: '#34d399', baptism: '#22d3ee', marriage: '#fbbf24', death: '#f87171',
  census: '#a78bfa', military: '#94a3b8', migration: '#f59e0b',
};
