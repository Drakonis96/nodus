// The pure craft/coherence checks for worldbuilding characters, plus the interview and
// biography prompts. No DB, no provider — these are the parts that must be right before
// any of them reaches a model.
//
// The bar for the confusable-name check is deliberately high: a warning that fires on
// every vaguely similar pair trains the author to ignore the whole section, and then the
// one that matters is ignored too. Half of these assertions exist to pin down what must
// NOT be reported.

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-character-checks-'));

function load(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

const checks = load('shared/characterChecks.ts');
const interview = load('shared/characterInterview.ts');
const characterChat = load('shared/characterChat.ts');
const biography = load('shared/characterBiographyContext.ts');
const proseReview = load('shared/worldProseReview.ts');

test.after(() => rm(outDir, { recursive: true, force: true }));

const coherence = (overrides = {}) =>
  checks.checkCharacterCoherence({
    lifeStatus: 'unknown',
    birthYear: null,
    deathYear: null,
    deathDate: null,
    events: [],
    ...overrides,
  });

test('a clean sheet reports nothing', () => {
  assert.deepEqual(coherence(), []);
  assert.deepEqual(
    coherence({ birthYear: 1200, deathYear: 1260, lifeStatus: 'dead', deathDate: 'Otoño de 1260' }),
    []
  );
});

test('dying before being born is an error', () => {
  const [issue] = coherence({ birthYear: 1260, deathYear: 1200 });
  assert.equal(issue.id, 'death-before-birth');
  assert.equal(issue.severity, 'error');
  assert.equal(issue.values.death, '1200');
});

test('acting after death or before birth is an error, but the boundary events are not', () => {
  const after = coherence({
    birthYear: 1200,
    deathYear: 1250,
    events: [{ type: 'battle', label: null, worldYear: 1270 }],
  });
  assert.equal(after.length, 1);
  assert.equal(after[0].severity, 'error');
  assert.match(after[0].message, /después de morir/);

  const before = coherence({
    birthYear: 1200,
    events: [{ type: 'oath', label: null, worldYear: 1180 }],
  });
  assert.equal(before.length, 1);
  assert.match(before[0].message, /antes de nacer/);

  // The birth and death events sit ON the boundary; flagging them would fire on every
  // character who has both dated.
  assert.deepEqual(
    coherence({
      birthYear: 1200,
      deathYear: 1250,
      events: [
        { type: 'birth', label: null, worldYear: 1200 },
        { type: 'death', label: null, worldYear: 1250 },
      ],
    }),
    []
  );
  // An undated event can never contradict anything.
  assert.deepEqual(
    coherence({ birthYear: 1200, deathYear: 1250, events: [{ type: 'battle', label: null, worldYear: null }] }),
    []
  );
});

test('a death date on a living character warns, but undead and immortal do not', () => {
  const [warning] = coherence({ lifeStatus: 'alive', deathDate: 'Otoño de 1260' });
  assert.equal(warning.id, 'dead-but-alive');
  assert.equal(warning.severity, 'warning');
  // These two statuses make the pairing legitimate, which is the whole point of having
  // them instead of a boolean.
  assert.deepEqual(coherence({ lifeStatus: 'undead', deathDate: 'Otoño de 1260' }), []);
  assert.deepEqual(coherence({ lifeStatus: 'immortal', deathYear: 1260 }), []);
});

test('being marked dead with no date is only a nudge', () => {
  const [warning] = coherence({ lifeStatus: 'dead' });
  assert.equal(warning.id, 'dead-without-date');
  assert.equal(warning.severity, 'warning');
});

test('confusable names catch the pairs a reader mixes up', () => {
  const cast = [
    { personId: 'a', displayName: 'Kaelen' },
    { personId: 'b', displayName: 'Kaelin' },
    { personId: 'c', displayName: 'Thorgrim' },
  ];
  const pairs = checks.findConfusableNames(cast);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].aId, 'a');
  assert.equal(pairs[0].bId, 'b');
  assert.ok(pairs[0].similarity > 0.8);
});

test('confusable names stay quiet on the cases that would make it noise', () => {
  // Distinct names.
  assert.deepEqual(
    checks.findConfusableNames([
      { personId: 'a', displayName: 'Kaelen Vor' },
      { personId: 'b', displayName: 'Thorgrim' },
    ]),
    []
  );
  // Short names collide by accident; a world fond of terse names would light up entirely.
  assert.deepEqual(
    checks.findConfusableNames([
      { personId: 'a', displayName: 'Ur' },
      { personId: 'b', displayName: 'Un' },
    ]),
    []
  );
  // Sharing a surname is not confusing — families are supposed to.
  assert.deepEqual(
    checks.findConfusableNames([
      { personId: 'a', displayName: 'Serel Vandrek' },
      { personId: 'b', displayName: 'Thorgrim Vandrek' },
    ]),
    []
  );
});

test('accents and case do not hide a collision', () => {
  const pairs = checks.findConfusableNames([
    { personId: 'a', displayName: 'Kaëlen' },
    { personId: 'b', displayName: 'kaelen' },
  ]);
  assert.equal(pairs.length, 1, 'the same name written two ways is the worst case, not an exempt one');
  assert.equal(checks.nameSimilarity('Kaëlen', 'kaelen'), 1);
});

test('confusableWith narrows to one character', () => {
  const cast = [
    { personId: 'a', displayName: 'Kaelen' },
    { personId: 'b', displayName: 'Kaelin' },
    { personId: 'c', displayName: 'Serel' },
  ];
  assert.equal(checks.confusableWith('a', cast).length, 1);
  assert.equal(checks.confusableWith('c', cast).length, 0);
});

// ── The prompts ──────────────────────────────────────────────────────────────

const sheet = {
  name: 'Kaelen Vor',
  aliases: [{ name: 'El Cuervo de Vael', kind: 'Epíteto o título' }],
  species: 'Semielfo',
  gender: 'no binario',
  pronouns: 'elle/le',
  lifeStatus: 'alive',
  narrativeRole: 'protagonist',
  birthDate: '13 de Lluvia, 1204 T.E.',
  deathDate: null,
  appearance: 'Alto y enjuto.',
  personality: 'Reservado.',
  backstory: 'Criado en las cocinas del Alcázar.',
  parents: [],
  spouses: [],
  children: [],
  siblings: [],
  relations: [],
  events: [{ type: 'oath', date: 'Primavera de 1221 T.E.', place: 'Vael', worldYear: 1221, notes: null }],
  notes: null,
};

test('the faithful biography prompt forbids invention; the propose one demands marking', () => {
  assert.match(biography.CHARACTER_BIOGRAPHY_SYSTEM, /No añadas hechos/);
  assert.match(biography.CHARACTER_BIOGRAPHY_PROPOSE_SYSTEM, /PUEDES proponer/);
  assert.match(biography.CHARACTER_BIOGRAPHY_PROPOSE_SYSTEM, /corchetes/);
  // Both must protect the two things that make output unusable when lost.
  for (const prompt of [biography.CHARACTER_BIOGRAPHY_SYSTEM, biography.CHARACTER_BIOGRAPHY_PROPOSE_SYSTEM]) {
    assert.match(prompt, /PRONOMBRES/);
    assert.match(prompt, /calendario inventado/);
  }
});

test('the biography context passes the pronouns and the invented date through verbatim', () => {
  const context = biography.composeCharacterBiographyContext(sheet);
  assert.match(context, /pronombres \(úsalos literalmente\): elle\/le/);
  assert.match(context, /13 de Lluvia, 1204 T\.E\./);
  assert.match(context, /año 1221/);
  assert.doesNotMatch(context, /propón/, 'the faithful mode never invites proposals');
  assert.match(biography.composeCharacterBiographyContext(sheet, 'propose'), /propón/);
});

test('biography and prose-review context scaffolds are native in every prompt language', () => {
  const locales = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
  const translatedSheet = { ...sheet, aliases: [{ name: 'El Cuervo de Vael', kind: 'Epíteto o título', kindToken: 'epithet' }] };
  for (const locale of locales) {
    const context = biography.composeCharacterBiographyContext(translatedSheet, 'faithful', locale);
    assert.match(context, /Kaelen Vor/);
    assert.match(context, /elle\/le/);
    assert.match(context, /13 de Lluvia, 1204 T\.E\./);
    assert.match(context, /1221/);
    if (locale !== 'es') {
      assert.doesNotMatch(context, /Personaje:|pronombres \(úsalos|Hechos de su vida|Notas del autor|Redacta la biografía/);
    }

    const review = proseReview.composeProseReviewContext({
      sceneTitle: 'La puerta sitiada',
      beats: [{ threadLabel: 'conflict: El asedio', mark: 'Rises', text: 'La guardia cede' }],
      prose: 'La puerta tembló.',
    }, locale);
    assert.match(review, /La puerta sitiada/);
    assert.match(review, /La puerta tembló/);
    if (locale !== 'es') assert.doesNotMatch(review, /ESCENA:|LO QUE DIJISTE|EL TEXTO DE LA ESCENA|Dime, en/);
  }
});

test('the interview prompt keeps the character in voice and ignorant of what is not on the sheet', () => {
  const system = interview.characterInterviewSystem({
    ...sheet,
    voiceRegister: 'Seco',
    voiceTics: 'Nunca dice "por favor".',
    voiceSample: '—No me hagas repetirlo.',
    abilities: [{ name: 'Voz de mando', cost: 'Pierde la voz un día', limits: 'Solo si ya le temen' }],
    arc: { want: 'El trono', need: 'Que alguien le crea', flaw: 'No pide ayuda', lie: 'Está solo', wound: 'Lo abandonaron' },
    scenes: [{
      title: 'La puerta sitiada',
      role: 'punto de vista',
      summary: 'Kaelen desobedece la orden y deja escapar a la cocinera.',
      notes: 'Elige a una persona por encima del rango.',
    }],
  });
  assert.match(system, /primera persona/);
  assert.match(system, /NO te lo inventes/);
  assert.match(system, /No sabes nada que no esté en tu ficha/);
  assert.match(system, /Tus pronombres son elle\/le/);
  assert.match(system, /No me hagas repetirlo/);
  assert.match(system, /Voz de mando/);
  assert.match(system, /El trono/);
  assert.match(system, /Escenas que has vivido/);
  assert.match(system, /La puerta sitiada/);
  assert.match(system, /punto de vista/);
  assert.match(system, /desobedece la orden/);
  // The NEED is withheld on purpose: a character who can state what they actually need
  // has finished their arc, and the interview stops being useful.
  assert.doesNotMatch(system, /Que alguien le crea/);
  // The sheet digest is embedded, but not its "now write the biography" tail.
  assert.match(system, /TU FICHA/);
  assert.doesNotMatch(system, /Redacta la biografía/);
});

test('the interview prompt keeps only the recent turns and ends on the character', () => {
  const history = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 === 0 ? 'author' : 'character',
    content: `turno ${i}`,
  }));
  const prompt = interview.composeInterviewPrompt(history, '¿De qué te arrepientes?');
  assert.doesNotMatch(prompt, /turno 0\b/, 'an unbounded transcript would grow the prompt without limit');
  assert.match(prompt, /turno 39/);
  // Six exchanges was too short to hold an interview: the author refers back to what they
  // said several questions ago and the character must still have it.
  assert.match(prompt, /turno 20/, 'the window spans more than a handful of exchanges');
  assert.match(prompt, /Autor: ¿De qué te arrepientes\?/);
  assert.ok(prompt.trimEnd().endsWith('Tú:'), 'the prompt must hand the turn to the character');
});

test('one long-winded turn cannot blow the transcript budget', () => {
  const history = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 === 0 ? 'author' : 'character',
    content: `turno ${i} ${'x'.repeat(1200)}`,
  }));
  const prompt = interview.composeInterviewPrompt(history, '¿Y ahora?');
  assert.ok(prompt.length < 9000, `the transcript stays bounded by characters, not just turns (${prompt.length})`);
  assert.match(prompt, /turno 11/, 'the newest turns are the ones kept');
  assert.doesNotMatch(prompt, /turno 0\b/, 'the oldest turns are the ones dropped');
});

test('the interview prompt names the openings the character has already worn out', () => {
  // The demo characters carry literal catchphrases in voiceTics, and a model told to
  // preserve a speech pattern opens EVERY reply with them. Only the openings already
  // spent are checkable, so those are what the prompt forbids.
  const history = [
    { role: 'author', content: '¿Quién eres?' },
    { role: 'character', content: 'Mira al borde, pequeña cartógrafa. El centro presume de ser el mundo.' },
    { role: 'author', content: '¿Y tu hija?' },
    { role: 'character', content: 'Mira al borde, pequeña cartógrafa. Ella aprendió a leer costas antes que letras.' },
  ];
  const prompt = interview.composeInterviewPrompt(history, '¿Qué te debe el Faro?');
  assert.match(prompt, /Ya has abierto respuestas así/);
  assert.match(prompt, /«Mira al borde»/);
  assert.equal(
    prompt.match(/Ya has abierto respuestas así/g).length,
    1,
    'the same opening is listed once, not once per repetition'
  );
  assert.ok(prompt.trimEnd().endsWith('Tú:'), 'the stage direction still hands over the turn');

  // A first turn has nothing to avoid, so it must not carry the direction at all.
  assert.doesNotMatch(interview.composeInterviewPrompt([], 'Hola'), /Ya has abierto/);
});

test('the opening signature captures a formula, not a whole sentence', () => {
  assert.equal(interview.openingSignature('—Queda oído. No queda obedecido.'), 'Queda oído');
  assert.equal(interview.openingSignature('«Uno: la carta es falsa»'), 'Uno');
  assert.equal(
    interview.openingSignature('Es una pregunta que llevo nueve meses evitando responder'),
    'Es una pregunta que llevo nueve',
    'an opening without punctuation is capped at a few words'
  );
});

test('the transcript speaks the same language as the task contract', () => {
  const { PROMPT_LANGUAGES } = load('shared/types.ts');
  const history = [
    { role: 'author', content: 'Hola' },
    { role: 'character', content: 'Look at the edge, traveller. The centre lies.' },
  ];
  const labels = { es: 'Tú', en: 'You', fr: 'Toi', tr: 'Sen', de: 'Du', pt: 'Tu', 'pt-BR': 'Você', it: 'Tu' };
  for (const language of PROMPT_LANGUAGES) {
    const prompt = interview.composeInterviewPrompt(history, '¿Y bien?', language);
    assert.ok(
      prompt.trimEnd().endsWith(`${labels[language]}:`),
      `${language}: the turn is handed over in the prompt language`
    );
    assert.match(prompt, /«Look at the edge»/, `${language}: the spent opening is still named`);
  }
});

test('the legacy character-interview system builder is native outside Spanish too', () => {
  const sources = {
    ...sheet,
    voiceRegister: 'Dry', voiceTics: null, voiceSample: 'Do not ask twice.',
    abilities: [], arc: { want: null, need: null, flaw: null, lie: null, wound: null }, scenes: [],
  };
  for (const language of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
    const prompt = interview.characterInterviewSystem(sources, language);
    assert.match(prompt, /Kaelen Vor/);
    assert.match(prompt, /Do not ask twice/);
    assert.doesNotMatch(prompt, /Vas a INTERPRETAR|Reglas estrictas|Habla SIEMPRE|Nunca rompas el personaje|TU FICHA/);
  }
});

test('character chat invokes images only for an explicit request and builds a safe prompt', () => {
  for (const request of [
    'Envíame una imagen del puerto al amanecer',
    '¿Puedes mostrarme una foto de tu habitación?',
    'Haz un retrato de cómo ibas vestido aquella noche',
    'Send me a picture of the old gate',
    'Envoie-moi une image du vieux port',
    'Zeig mir ein Bild vom alten Tor',
    'Envia-me uma imagem do porto antigo',
    'Envie uma imagem do porto antigo',
    'Mandami una foto del vecchio porto',
    'Bana eski limanın bir resmini gönder',
  ]) {
    assert.equal(characterChat.isCharacterImageRequest(request), true, request);
  }
  for (const ordinary of [
    '¿Cómo imaginas el puerto?',
    'Muéstrame cómo ocurrió la batalla',
    'Háblame de tu retrato moral',
    '¿Qué opinas de aquella fotografía?',
  ]) {
    assert.equal(characterChat.isCharacterImageRequest(ordinary), false, ordinary);
  }

  const prompt = characterChat.buildCharacterChatImagePrompt({
    style: 'cinematic',
    name: 'Kaelen Vor',
    visualSeed: 'pelo negro recogido y ojos ámbar',
    appearance: 'capa gris y cicatriz vertical',
    request: 'Envíame una imagen en las murallas bajo la lluvia',
    answer: 'Así me viste la guardia aquella noche.',
  });
  assert.match(prompt, /pelo negro recogido/);
  assert.match(prompt, /murallas bajo la lluvia/);
  assert.match(prompt, /no text/);
});

test('the interview knows when this turn can carry an image without breaking character', () => {
  const system = interview.characterInterviewSystem({
    ...sheet,
    voiceRegister: null,
    voiceTics: null,
    voiceSample: null,
    abilities: [],
    arc: { want: null, need: null, flaw: null, lie: null, wound: null },
    scenes: [],
    canSendImages: true,
  });
  assert.match(system, /puede adjuntarla/);
  assert.match(system, /sin decir que no puedes crear o adjuntar imágenes/);
});

// ── The world calendar ───────────────────────────────────────────────────────
// All of it is arithmetic on numbers the author typed, so every case below is exact.
// The failure this guards against is silent: a wrong absolute day still SORTS, it just
// sorts wrongly, and a timeline in the wrong order still looks like a timeline.

const cal = load('shared/worldCalendar.ts');

/** Three 10-day months = a 30-day year. Small numbers keep the arithmetic checkable. */
const CALENDAR = {
  name: 'Prueba',
  notes: null,
  eras: [
    { eraId: 'te', name: 'Tercera Era', abbreviation: 'T.E.', startYear: 1000, countsBackwards: false, sortOrder: 0 },
    { eraId: 'ln', name: 'Larga Noche', abbreviation: 'L.N.', startYear: 999, countsBackwards: true, sortOrder: 1 },
  ],
  months: [
    { monthId: 'm1', name: 'Deshielo', days: 10, sortOrder: 0 },
    { monthId: 'm2', name: 'Lluvia', days: 10, sortOrder: 1 },
    { monthId: 'm3', name: 'Siega', days: 10, sortOrder: 2 },
  ],
};

test('a calendar with no months is no calendar', () => {
  assert.equal(cal.hasCalendar(cal.EMPTY_CALENDAR), false);
  assert.equal(cal.daysPerYear(cal.EMPTY_CALENDAR), 0);
  // Without months there is no absolute day, so the integer year stays in charge.
  assert.equal(cal.worldDayOf(cal.EMPTY_CALENDAR, { eraId: null, year: 1204, monthIndex: 0, day: 1 }), null);
});

test('era years map onto the absolute scale, forwards and backwards', () => {
  assert.equal(cal.daysPerYear(CALENDAR), 30);
  // Year 1 of an era IS its start year.
  assert.equal(cal.absoluteYear(CALENDAR, 'te', 1), 1000);
  assert.equal(cal.absoluteYear(CALENDAR, 'te', 205), 1204);
  // A backwards era counts down towards its start.
  assert.equal(cal.absoluteYear(CALENDAR, 'ln', 1), 999);
  assert.equal(cal.absoluteYear(CALENDAR, 'ln', 100), 900);
  // An unknown era leaves the year as an absolute one rather than throwing.
  assert.equal(cal.absoluteYear(CALENDAR, null, 1204), 1204);
});

test('a year-only date sorts BEFORE everything dated inside that year', () => {
  const yearOnly = cal.worldDayOf(CALENDAR, { eraId: 'te', year: 205, monthIndex: null, day: null });
  const firstDay = cal.worldDayOf(CALENDAR, { eraId: 'te', year: 205, monthIndex: 0, day: 1 });
  assert.equal(yearOnly, 1204 * 30);
  assert.equal(firstDay, 1204 * 30 + 1);
  assert.ok(yearOnly < firstDay, '"1204" must precede "1 de Deshielo de 1204"');
});

test('months accumulate, so a later month is a later day', () => {
  const deshielo = cal.worldDayOf(CALENDAR, { eraId: 'te', year: 205, monthIndex: 0, day: 5 });
  const lluvia = cal.worldDayOf(CALENDAR, { eraId: 'te', year: 205, monthIndex: 1, day: 5 });
  const siega = cal.worldDayOf(CALENDAR, { eraId: 'te', year: 205, monthIndex: 2, day: 5 });
  assert.equal(deshielo, 1204 * 30 + 5);
  assert.equal(lluvia, 1204 * 30 + 15);
  assert.equal(siega, 1204 * 30 + 25);
  assert.ok(deshielo < lluvia && lluvia < siega);
});

test('dates from different eras compare correctly', () => {
  // 100 L.N. is absolute year 900; 205 T.E. is 1204. The backwards era comes first.
  const longNight = cal.worldDayOf(CALENDAR, { eraId: 'ln', year: 100, monthIndex: 0, day: 1 });
  const thirdAge = cal.worldDayOf(CALENDAR, { eraId: 'te', year: 205, monthIndex: 0, day: 1 });
  assert.ok(longNight < thirdAge, 'an era that counts backwards still lands earlier on the scale');
});

test('out-of-range days and months are clamped, never allowed to corrupt the order', () => {
  // Day 99 of a 10-day month, and month 7 of a 3-month year: a bad value must not
  // produce an absolute day that lands in the wrong year.
  const clampedDay = cal.worldDayOf(CALENDAR, { eraId: 'te', year: 205, monthIndex: 0, day: 99 });
  assert.equal(clampedDay, 1204 * 30 + 10, 'the day is clamped to the length of its month');
  const clampedMonth = cal.worldDayOf(CALENDAR, { eraId: 'te', year: 205, monthIndex: 7, day: 1 });
  assert.equal(clampedMonth, 1204 * 30 + 21, 'the month is clamped to the last one');
  assert.ok(clampedDay < cal.worldDayOf(CALENDAR, { eraId: 'te', year: 206, monthIndex: null, day: null }));
});

test('an undated date has no absolute day', () => {
  assert.equal(cal.worldDayOf(CALENDAR, { eraId: 'te', year: null, monthIndex: 0, day: 1 }), null);
});

test('fromWorldDay is the exact inverse of worldDayOf', () => {
  for (const date of [
    { eraId: 'te', year: 205, monthIndex: 1, day: 7 },
    { eraId: 'te', year: 1, monthIndex: 0, day: 1 },
    { eraId: 'te', year: 205, monthIndex: null, day: null },
    { eraId: 'ln', year: 100, monthIndex: 2, day: 10 },
  ]) {
    const day = cal.worldDayOf(CALENDAR, date);
    const back = cal.fromWorldDay(CALENDAR, day);
    assert.equal(cal.worldDayOf(CALENDAR, back), day, `round trip for ${JSON.stringify(date)}`);
  }
});

test('formatting reads the way the author writes it', () => {
  assert.equal(
    cal.formatWorldDate(CALENDAR, { eraId: 'te', year: 205, monthIndex: 1, day: 13 }),
    '13 de Lluvia, 205 T.E.'
  );
  assert.equal(cal.formatWorldDate(CALENDAR, { eraId: 'te', year: 205, monthIndex: 1, day: null }), 'Lluvia de 205 T.E.');
  assert.equal(cal.formatWorldDate(CALENDAR, { eraId: 'te', year: 205, monthIndex: null, day: null }), '205 T.E.');
  assert.equal(cal.formatWorldDate(CALENDAR, { eraId: null, year: 205, monthIndex: null, day: null }), '205');
  assert.equal(cal.formatWorldDate(CALENDAR, { eraId: 'te', year: null, monthIndex: null, day: null }), '');
});

test('age is whole years, and never negative', () => {
  const birth = cal.worldDayOf(CALENDAR, { eraId: 'te', year: 180, monthIndex: 2, day: 9 });
  const later = cal.worldDayOf(CALENDAR, { eraId: 'te', year: 205, monthIndex: 0, day: 1 });
  // 1179 → 1204 is 25 years, but the birthday falls late in the year, so 24 have passed.
  assert.equal(cal.ageAt(CALENDAR, { year: null, worldDay: birth }, { year: null, worldDay: later }), 24);
  // With no calendar it falls back to plain year arithmetic, which is still worth showing.
  assert.equal(cal.ageAt(cal.EMPTY_CALENDAR, { year: 1180, worldDay: null }, { year: 1205, worldDay: null }), 25);
  // Before being born is not an age; a negative number on screen reads as a bug.
  assert.equal(cal.ageAt(cal.EMPTY_CALENDAR, { year: 1205, worldDay: null }, { year: 1180, worldDay: null }), null);
  assert.equal(cal.ageAt(cal.EMPTY_CALENDAR, { year: null, worldDay: null }, { year: 1180, worldDay: null }), null);
});

test('validation reports what would make dates ambiguous', () => {
  assert.deepEqual(cal.validateCalendar(CALENDAR), []);
  const problems = cal.validateCalendar({
    ...CALENDAR,
    months: [{ monthId: 'm1', name: '', days: 0, sortOrder: 0 }],
    eras: [
      { eraId: 'a', name: 'A', abbreviation: null, startYear: 100, countsBackwards: false, sortOrder: 0 },
      { eraId: 'b', name: 'B', abbreviation: null, startYear: 100, countsBackwards: false, sortOrder: 1 },
    ],
  });
  assert.ok(problems.some((p) => /menos de un día/.test(p)));
  assert.ok(problems.some((p) => /no tiene nombre/.test(p)));
  assert.ok(problems.some((p) => /mismo año/.test(p)));
});
