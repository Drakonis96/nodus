/* Sample corpus for the Nodus GENEALOGY web demo — a faithful mirror of the app's
   built-in genealogy demo (electron/db/genealogyDemoData.ts): the SERRANO family of
   Carmona (Sevilla), 1836–2004, with a branch that moves to the city and another
   that marries into Écija. Same people, dates, records, places, kinship, social
   network and AI suggestions the desktop app seeds. UI chrome is English; the
   record transcripts stay in their period Spanish, exactly as in the app. */
window.GEN = {
  vault: 'Serrano family',
  mode: 'Genealogy',

  // sex → default silhouette (man faces right, woman left; mirrored to face inward).
  persons: [
    { id: 'p1', name: 'Bartolomé Serrano Ortega', sex: 'male', birth: '1838', death: '1901', occupation: 'Olive-grove owner' },
    { id: 'p2', name: 'Rosalía Campos Ríos', sex: 'female', birth: 'c. 1842', death: '1919', occupation: 'Household' },
    { id: 'p3', name: 'Ignacio Vidal Moreno', sex: 'male', birth: '1836', death: '1898', occupation: 'Wheelwright' },
    { id: 'p4', name: 'Manuela Ferrer Blanco', sex: 'female', birth: '1841', death: '1907', occupation: 'Household' },
    { id: 'p5', name: 'Tomás Serrano Campos', sex: 'male', birth: '12 de marzo de 1865', death: '1932', occupation: 'Olive-press master' },
    { id: 'p6', name: 'Dolores Serrano Campos', sex: 'female', birth: '1868', death: '1941', occupation: 'Household' },
    { id: 'p7', name: 'Encarnación Vidal Ferrer', sex: 'female', birth: '1867', death: '1940', occupation: 'Seamstress' },
    { id: 'p8', name: 'Rafael Serrano Vidal', sex: 'male', birth: '1890', death: '1961', occupation: 'Typesetter (Sevilla)' },
    { id: 'p9', name: 'Amparo Serrano Vidal', sex: 'female', birth: '1893', death: '1975', occupation: 'Household' },
    { id: 'p10', name: 'Vicente Serrano Vidal', sex: 'male', birth: '1896', death: '1918', occupation: 'Conscript' },
    { id: 'p11', name: 'Josefa Marín León', sex: 'female', birth: '1895', death: '1980', occupation: 'Household' },
    { id: 'p12', name: 'Carmen Serrano Marín', sex: 'female', birth: '1921', death: '2004', occupation: '—' },
    { id: 'p14', name: 'Casimiro Reyes Pardo', sex: 'male', birth: '1861', death: '1930', occupation: 'Grain merchant (Écija)' },
    { id: 'p15', name: 'Lucía Reyes Serrano', sex: 'female', birth: '1892', death: '1969', occupation: 'Household' },
  ],

  variants: {
    p7: ['Encarna Vidal (apodo)', 'Encarnación Vidal y Ferrer (registro)'],
    p5: ['Tomás Serrano (variante)'],
    p1: ['Bartolomé Serrano (variante)'],
  },

  // 18 confirmed kinship links (parent→child + spouse). Exactly what the tree draws.
  relationships: [
    { from: 'p1', to: 'p5', type: 'parent' }, { from: 'p2', to: 'p5', type: 'parent' },
    { from: 'p1', to: 'p6', type: 'parent' }, { from: 'p2', to: 'p6', type: 'parent' },
    { from: 'p3', to: 'p7', type: 'parent' }, { from: 'p4', to: 'p7', type: 'parent' },
    { from: 'p5', to: 'p8', type: 'parent' }, { from: 'p7', to: 'p8', type: 'parent' },
    { from: 'p5', to: 'p9', type: 'parent' }, { from: 'p7', to: 'p9', type: 'parent' },
    { from: 'p5', to: 'p10', type: 'parent' }, { from: 'p7', to: 'p10', type: 'parent' },
    { from: 'p8', to: 'p12', type: 'parent' }, { from: 'p11', to: 'p12', type: 'parent' },
    { from: 'p1', to: 'p2', type: 'spouse' },
    { from: 'p3', to: 'p4', type: 'spouse' },
    { from: 'p5', to: 'p7', type: 'spouse' },
    { from: 'p8', to: 'p11', type: 'spouse' },
  ],

  places: [
    { id: 'sevilla', name: 'Sevilla', kind: 'municipality', lat: 37.3886, lng: -5.9823, region: 'Andalucía, España' },
    { id: 'carmona', name: 'Carmona', kind: 'municipality', lat: 37.4713, lng: -5.6469, region: 'Andalucía, España' },
    { id: 'parr', name: 'Parroquia de Santa María, Carmona', kind: 'parish', lat: 37.4718, lng: -5.6432, region: 'Carmona, Andalucía' },
    { id: 'ecija', name: 'Écija', kind: 'municipality', lat: 37.5411, lng: -5.0824, region: 'Andalucía, España' },
  ],

  events: [
    { id: 'e1', type: 'baptism', date: '12 de marzo de 1865', year: 1865, placeId: 'parr', persons: ['p5', 'p1', 'p2'], source: 'a1' },
    { id: 'e10', type: 'death', date: '1901', year: 1901, placeId: 'carmona', persons: ['p1'], source: null },
    { id: 'e2', type: 'marriage', date: '1889', year: 1889, placeId: 'carmona', persons: ['p5', 'p7'], source: 'a2' },
    { id: 'e3', type: 'baptism', date: '1890', year: 1890, placeId: 'parr', persons: ['p8', 'p5', 'p7'], source: null },
    { id: 'e4', type: 'baptism', date: '1893', year: 1893, placeId: 'parr', persons: ['p9', 'p5', 'p7'], source: null },
    { id: 'e5', type: 'census', date: '1900', year: 1900, placeId: 'carmona', label: 'Padrón municipal', persons: ['p5', 'p7', 'p8', 'p9', 'p10'], source: 'a3' },
    { id: 'e6', type: 'migration', date: '1912', year: 1912, placeId: 'sevilla', label: 'Traslado a Sevilla', persons: ['p8'], source: null },
    { id: 'e8', type: 'death', date: '1918', year: 1918, placeId: 'sevilla', persons: ['p10'], source: 'a6' },
    { id: 'e7', type: 'marriage', date: '1919', year: 1919, placeId: 'sevilla', persons: ['p8', 'p11'], source: null },
    { id: 'e9', type: 'baptism', date: '1921', year: 1921, placeId: 'sevilla', persons: ['p12', 'p8', 'p11'], source: null },
  ],

  // per-person place log → the general map (movements/migrations)
  personPlaces: [
    { personId: 'p1', placeId: 'carmona', label: 'residence' }, { personId: 'p1', placeId: 'carmona', label: 'death' },
    { personId: 'p2', placeId: 'carmona', label: 'residence' },
    { personId: 'p5', placeId: 'carmona', label: 'birth' }, { personId: 'p5', placeId: 'carmona', label: 'marriage' }, { personId: 'p5', placeId: 'carmona', label: 'residence' },
    { personId: 'p7', placeId: 'carmona', label: 'residence' }, { personId: 'p7', placeId: 'sevilla', label: 'residence' },
    { personId: 'p8', placeId: 'carmona', label: 'birth' }, { personId: 'p8', placeId: 'sevilla', label: 'migration' }, { personId: 'p8', placeId: 'sevilla', label: 'marriage' },
    { personId: 'p10', placeId: 'carmona', label: 'birth' }, { personId: 'p10', placeId: 'sevilla', label: 'death' },
    { personId: 'p12', placeId: 'sevilla', label: 'birth' },
    { personId: 'p6', placeId: 'carmona', label: 'birth' }, { personId: 'p6', placeId: 'ecija', label: 'marriage' },
    { personId: 'p14', placeId: 'ecija', label: 'residence' }, { personId: 'p15', placeId: 'ecija', label: 'birth' },
  ],

  archiveFolder: 'Serrano family — primary sources',
  archive: [
    { id: 'a1', kind: 'pdf', docType: 'Baptism record', title: 'Baptism record of Tomás Serrano (1865)', date: '1865', place: 'Carmona',
      source: 'Archivo Parroquial de Santa María, Carmona · Libro de bautismos', persons: ['p1', 'p2', 'p5'],
      metadata: { Person: 'Tomás Serrano Campos', Date: '12 de marzo de 1865', Parents: 'Bartolomé Serrano y Rosalía Campos', Godparents: 'Ignacio Vidal y Manuela Ferrer', Parish: 'Parroquia de Santa María, Carmona' },
      text: 'En la villa de Carmona, a doce de marzo de mil ochocientos sesenta y cinco, yo, el infrascrito cura, bauticé solemnemente a Tomás, hijo legítimo de Bartolomé Serrano Ortega y de Rosalía Campos Ríos, naturales de esta villa. Fueron sus padrinos Ignacio Vidal y Manuela Ferrer.' },
    { id: 'a2', kind: 'pdf', docType: 'Marriage record', title: 'Marriage record of Tomás and Encarnación (1889)', date: '1889', place: 'Carmona',
      source: 'Archivo Parroquial de Santa María, Carmona · Libro de matrimonios', persons: ['p5', 'p7'],
      metadata: { 'Spouse 1': 'Tomás Serrano Campos', 'Spouse 2': 'Encarnación Vidal Ferrer', Date: '1889', Parish: 'Parroquia de Santa María, Carmona' },
      text: 'En Carmona, año de mil ochocientos ochenta y nueve, contrajeron matrimonio Tomás Serrano Campos, hijo de Bartolomé Serrano y Rosalía Campos, y Encarnación Vidal Ferrer, hija de Ignacio Vidal y Manuela Ferrer.' },
    { id: 'a3', kind: 'csv', docType: 'Census', title: 'Carmona census sheet (1900)', date: '1900', place: 'Carmona',
      source: 'Archivo Municipal de Carmona · Padrón municipal de 1900', persons: ['p9', 'p7', 'p8', 'p5', 'p10'],
      metadata: { Year: '1900', Municipality: 'Carmona', Household: 'Calle Real, 14', People: 'Tomás Serrano; Encarnación Vidal; Rafael, Amparo y Vicente Serrano' },
      text: 'Apellidos,Nombre,Parentesco,Edad\nSerrano Campos,Tomás,Cabeza,35\nVidal Ferrer,Encarnación,Esposa,33\nSerrano Vidal,Rafael,Hijo,10\nSerrano Vidal,Amparo,Hija,7\nSerrano Vidal,Vicente,Hijo,4' },
    { id: 'a4', kind: 'text', docType: 'Diary', title: 'Diary of Encarnación Vidal', date: '1903', place: 'Carmona',
      source: 'Colección familiar Serrano (documento privado)', persons: ['p7'],
      metadata: { Person: 'Encarnación Vidal Ferrer', Date: '1903' },
      text: 'Hoy ha venido a casa mi cuñada Dolores con Casimiro, su marido, y su pequeña Lucía. Rafael ya es todo un hombre; habla de marcharse a Sevilla en cuanto pueda. Amparo cose a mi lado y Vicente no para quieto.' },
    { id: 'a5', kind: 'text', docType: 'Letter', title: 'Letter from Amparo to her brother Rafael (1925)', date: '1925', place: 'Carmona',
      source: 'Colección familiar Serrano (documento privado)', persons: ['p8'],
      metadata: { From: 'Amparo Serrano Vidal', To: 'Rafael Serrano Vidal', Date: '1925' },
      text: 'Querido Rafael: te escribe tu hermana Amparo Serrano desde Carmona. Madre pregunta por ti y por Josefa Marín. Aún lloramos a nuestro Vicente. Escríbenos pronto.' },
    { id: 'a6', kind: 'pdf', docType: 'Death record', title: 'Death record of Vicente Serrano (1918)', date: '1918', place: 'Sevilla',
      source: 'Registro Civil de Sevilla · Sección de defunciones', persons: ['p10'],
      metadata: { Person: 'Vicente Serrano Vidal', 'Date of death': '1918', Age: '22 years', Cause: 'gripe' },
      text: 'En Sevilla, año de mil novecientos dieciocho, falleció Vicente Serrano Vidal, de veintidós años, hijo de Tomás Serrano y Encarnación Vidal, a consecuencia de la epidemia de gripe.' },
    { id: 'a7', kind: 'image', docType: 'Photograph', title: 'Studio portrait of the Serrano family (c. 1905)', date: 'c. 1905', place: 'Sevilla',
      source: 'Álbum fotográfico de la familia Serrano', persons: ['p5', 'p7', 'p8', 'p9'],
      metadata: { Date: 'c. 1905', Place: 'Sevilla' },
      description: 'Sepia studio photograph: a seated couple with three children standing behind, in Sunday dress. On the back, in pencil: «Los Serrano, Sevilla».',
      text: 'Los Serrano, Sevilla, h. 1905. De pie: Rafael, Amparo, Vicente. Sentados: Tomás y Encarnación.' },
    { id: 'a8', kind: 'pdf', docType: 'Marriage record', title: 'Marriage record of Dolores Serrano and Casimiro Reyes (1890)', date: '1890', place: 'Carmona',
      source: 'Archivo Parroquial de Santa María, Carmona · Libro de matrimonios', persons: ['p6', 'p14'],
      metadata: { 'Spouse 1': 'Dolores Serrano Campos', 'Spouse 2': 'Casimiro Reyes Pardo', Date: '1890', Parish: 'Parroquia de Santa María, Carmona' },
      text: 'En Carmona, año de mil ochocientos noventa, contrajeron matrimonio Casimiro Reyes Pardo y Dolores Serrano Campos, hija de Bartolomé Serrano y Rosalía Campos.' },
    { id: 'a9', kind: 'pdf', docType: 'Baptism record', title: 'Baptism record of Lucía Reyes (1892)', date: '1892', place: 'Carmona',
      source: 'Archivo Parroquial de Santa María, Carmona · Libro de bautismos', persons: ['p15', 'p6', 'p14'],
      metadata: { Person: 'Lucía Reyes Serrano', Date: '1892', Parents: 'Casimiro Reyes y Dolores Serrano', Parish: 'Parroquia de Santa María, Carmona' },
      text: 'En Carmona, año de mil ochocientos noventa y dos, bauticé a Lucía, hija de Casimiro Reyes Pardo y de Dolores Serrano Campos.' },
  ],

  // Social network — a SECOND graph, independent of kinship. Persons (indigo) +
  // standalone contacts (amber), with role-labelled edges.
  contacts: [
    { id: 'c1', name: 'Antonio Ruiz Cabello', note: 'The village notary between 1868 and 1895. Drafted several of the family’s deeds.' },
    { id: 'c2', name: 'Father Eugenio Lozano', note: 'Parish priest of Santa María between 1855 and 1880. Officiated several of the family’s baptisms and marriages.' },
  ],
  social: [
    { id: 's1', from: 'p5', to: 'c1', role: 'client', notes: 'Bought an olive grove through him in 1889, per the surviving deed.' },
    { id: 's2', from: 'p1', to: 'c2', role: 'parishioner', notes: '' },
    { id: 's3', from: 'p5', to: 'p14', role: 'business partner', notes: 'Ran a shared olive press between 1895 and 1905.' },
  ],

  // Open AI kinship suggestions the user vets (never auto-added to the tree).
  suggestions: [
    { id: 'k1', from: 'p14', to: 'p6', type: 'spouse', question: 'Were Casimiro Reyes and Dolores Serrano married?', strength: 'high',
      evidence: ['«contrajeron matrimonio Casimiro Reyes Pardo y Dolores Serrano Campos» — Marriage record, Carmona 1890', '«mi cuñada Dolores con Casimiro, su marido» — Diary of Encarnación, 1903'] },
    { id: 'k2', from: 'p14', to: 'p15', type: 'parent', question: 'Was Casimiro Reyes the father of Lucía Reyes?', strength: 'high',
      evidence: ['«Lucía, hija de Casimiro Reyes Pardo y de Dolores Serrano Campos» — Baptism record, Carmona 1892'] },
    { id: 'k3', from: 'p6', to: 'p15', type: 'parent', question: 'Was Dolores Serrano the mother of Lucía Reyes?', strength: 'high',
      evidence: ['«Lucía, hija de Casimiro Reyes Pardo y de Dolores Serrano Campos» — Baptism record, Carmona 1892'] },
  ],

  deepResearch: {
    id: 'dr1',
    title: 'The Serrano family of Carmona: from the olive press to the city',
    meta: '4 sections · 9 primary sources · generated from the archive',
    sections: [
      { title: '1 — Rooted in Carmona', paras: [
        { text: 'The family enters the record in 1865, when Tomás Serrano Campos was baptised at Santa María de Carmona, son of Bartolomé Serrano Ortega and Rosalía Campos Ríos [1]. Tomás married Encarnación Vidal Ferrer in 1889 [2], and the 1900 padrón fixes their household on calle Real with three children — Rafael, Amparo and Vicente [3].', cites: [['[1] Baptism, Carmona, 1865', 'a1'], ['[2] Marriage, Carmona, 1889', 'a2'], ['[3] Census, Carmona, 1900', 'a3']] },
      ] },
      { title: '2 — Rafael, and the move to Sevilla', paras: [
        { text: 'Rafael Serrano Vidal, baptised in 1890, is the branch that leaves the town: he moves to Sevilla around 1912 and marries Josefa Marín León there in 1919, where their daughter Carmen is baptised in 1921. The city line begins with him.', cites: [] },
      ] },
      { title: '3 — Vicente, and 1918', paras: [
        { text: 'The youngest son, Vicente, died in Sevilla in 1918 at twenty-two — the civil register names the cause as the influenza epidemic [4]. His sister Amparo’s 1925 letter to Rafael still mourns him: «Aún lloramos a nuestro Vicente».', cites: [['[4] Death register, Sevilla, 1918', 'a6']] },
      ] },
      { title: '4 — The Écija branch, proposed but unconfirmed', paras: [
        { text: 'A second thread runs east to Écija through Dolores Serrano, Tomás’s sister. Three AI suggestions — her marriage to Casimiro Reyes and their daughter Lucía — are grounded in an 1890 marriage record and an 1892 baptism, but they are logged as proposals for review, not added to the tree until confirmed.', cites: [['Marriage, Carmona, 1890', 'a8'], ['Baptism, Carmona, 1892', 'a9']] },
      ] },
    ],
  },

  notes: [
    { id: 'n1', folder: 'Threads to chase', title: 'The Écija branch (Reyes)', body: 'Dolores Serrano (Tomás’s sister) married into Écija. The Casimiro↔Dolores marriage and their daughter Lucía are strong suggestions from the 1890 marriage + 1892 baptism — confirm and pull the full Écija parish books.\n\nLinks: [person: Dolores Serrano Campos] · [person: Lucía Reyes Serrano]', updated: '2 days ago' },
    { id: 'n2', folder: 'Threads to chase', title: '1918 — the flu', body: 'Vicente died in the 1918 epidemic in Sevilla, aged 22. Cross-check the Sevilla civil death register against the parish burial book.\n\nLinks: [person: Vicente Serrano Vidal]', updated: 'yesterday' },
  ],

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
      ['Record analysis (persons & events)', 'claude-sonnet-5'],
      ['Family-history report', 'claude-sonnet-5'],
      ['Biographies & summaries', 'qwen3:8b · Ollama'],
      ['Portraits (vision)', 'gemini-3-flash'],
      ['Embeddings (archive index)', 'nomic-embed-text · Ollama'],
    ],
  },
};

window.GEN_EVENT_COLORS = {
  birth: '#34d399', baptism: '#22d3ee', marriage: '#fbbf24', death: '#f87171',
  census: '#a78bfa', migration: '#f59e0b', residence: '#94a3b8', burial: '#f87171',
};
