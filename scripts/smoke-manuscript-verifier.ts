// Headless smoke for the manuscript verifier. It creates a throwaway DB, adds a
// controlled listed idea and verifies that an uncited matching manuscript claim
// is flagged without needing embeddings or an AI key.
// Run via:
//   rm -rf /tmp/nodus-manuscript-smoke-userdata && \
//   npx esbuild scripts/smoke-manuscript-verifier.ts --bundle --platform=node --format=esm \
//     --outfile=.smoke-manuscript-verifier.mjs --external:better-sqlite3 \
//     --alias:electron=./scripts/stub-electron.mjs && \
//   ELECTRON_RUN_AS_NODE=1 NODUS_TEST_USERDATA=/tmp/nodus-manuscript-smoke-userdata \
//     npx electron .smoke-manuscript-verifier.mjs
import { seedDemoData } from '../electron/db/demoData';
import { getDb } from '../electron/db/database';
import { createIdea } from '../electron/db/ideasRepo';
import { createChapter, createProject } from '../electron/db/projectsRepo';
import { verifyManuscriptCitations } from '../electron/ai/manuscriptVerifier';

seedDemoData();

const idea = createIdea({
  type: 'claim',
  label: 'Turismo patrimonial y memoria publica',
  statement: 'El turismo patrimonial organiza la memoria publica mediante rutas urbanas y relatos institucionales.',
  embedding: null,
});

const detail = createProject({
  title: 'Smoke manuscript verifier',
  kind: 'thesis',
  brief: 'Verificar afirmaciones sin cita contra ideas del corpus.',
});
const manuscriptSection = detail.sections.find((section) => section.role === 'manuscript') ?? null;
const chapter = createChapter({
  projectId: detail.project.id,
  sectionId: manuscriptSection?.id ?? null,
  title: 'Capitulo de prueba',
  sourceFormat: 'markdown',
  text: [
    'El turismo patrimonial organiza la memoria publica mediante rutas urbanas y relatos institucionales.',
    '',
    'En esta tesis sostengo que el archivo local funciona como una interfaz metodologica propia.',
    '',
    'Rivera (2020) muestra que las rutas patrimoniales median la memoria publica urbana.',
  ].join('\n'),
});

const result = await verifyManuscriptCitations({
  chapterId: chapter.id,
  language: 'es',
  model: null,
  maxClaims: 20,
});

const db = getDb();
const ideaCount = (db.prepare('SELECT COUNT(*) AS n FROM ideas').get() as { n: number }).n;
console.log(`ideas: ${ideaCount} · claims ${result.summary.checkedClaims} · missing ${result.summary.missingCitations} · ai ${result.aiReviewed}`);

if (result.summary.checkedClaims < 3) throw new Error('verifier did not inspect the expected claims');
const missing = result.claims.find((claim) => claim.status === 'missing_citation');
if (!missing) throw new Error('verifier did not flag the uncited matching claim');
if (!missing.suggestedCitations.some((candidate) => candidate.refId === idea.global_id)) {
  throw new Error('missing citation did not point to the controlled corpus idea');
}
if (!result.claims.some((claim) => claim.status === 'own_argument')) {
  throw new Error('verifier did not preserve the own-argument classification');
}
if (!result.claims.some((claim) => claim.hasCitation && claim.status === 'covered')) {
  throw new Error('verifier did not recognize an already cited claim');
}

console.log('\nMANUSCRIPT VERIFIER SMOKE OK');
