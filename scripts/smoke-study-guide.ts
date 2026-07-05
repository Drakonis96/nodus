// Headless smoke for Modo Estudio. Seeds the bundled demo corpus into a
// throwaway DB and exercises the real Electron-side services: migration 24,
// study plan, persisted progress, fallback tutor session and answer assessment.
// Run via:
//   rm -rf /tmp/nodus-study-smoke-userdata && \
//   npx esbuild scripts/smoke-study-guide.ts --bundle --platform=node --format=esm \
//     --outfile=.smoke-study-guide.mjs --external:better-sqlite3 \
//     --alias:electron=./scripts/stub-electron.mjs && \
//   NODUS_TEST_USERDATA=/tmp/nodus-study-smoke-userdata node .smoke-study-guide.mjs
import { seedDemoData } from '../electron/db/demoData';
import { getDb } from '../electron/db/database';
import { buildStudyPlan, evaluateStudyAnswer, generateStudySession } from '../electron/ai/studyGuide';
import { setStudyProgress } from '../electron/db/studyProgressRepo';

seedDemoData();

const db = getDb();
const progressTable = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'study_progress'")
  .get() as { name: string } | undefined;
if (!progressTable) throw new Error('migration 24 did not create study_progress');

const plan = await buildStudyPlan({ objective: 'tourism heritage memory', authorLimit: 6, worksPerAuthor: 3 });
console.log(`plan: ${plan.authors.length} authors · ${plan.stats.totalWorks} works · ${plan.stats.totalIdeas} ideas`);
if (plan.authors.length === 0) throw new Error('study plan has no authors');
if (!plan.nextAuthorId) throw new Error('study plan has no next author');

const author = plan.authors[0];
console.log(`next author: ${author.fullName} · works ${author.recommendedWorks.length} · ideas ${author.keyIdeas.length}`);
if (author.recommendedWorks.length === 0) throw new Error('selected author has no recommended works');
if (author.keyIdeas.length === 0) throw new Error('selected author has no key ideas');

const progress = setStudyProgress({ targetKind: 'author', targetId: author.authorId, status: 'in_progress' });
if (progress.status !== 'in_progress') throw new Error('study progress was not persisted');

const updated = await buildStudyPlan({ objective: 'tourism heritage memory', authorLimit: 6, worksPerAuthor: 3, includeCompleted: true });
const updatedAuthor = updated.authors.find((item) => item.authorId === author.authorId);
if (updatedAuthor?.progressStatus !== 'in_progress') throw new Error('study plan did not read persisted progress');

const session = await generateStudySession({ authorId: author.authorId, objective: 'tourism heritage memory', useFullText: true, model: null });
console.log(`session: ${session.sequence.length} steps · ${session.quiz.length} quiz · full text ${session.usedFullText}`);
if (session.sequence.length === 0) throw new Error('study session has no sequence');
if (session.quiz.length === 0) throw new Error('study session has no quiz');

const assessment = await evaluateStudyAnswer({
  authorId: author.authorId,
  question: session.quiz[0].question,
  answer: `La idea central se relaciona con ${author.keyIdeas[0].label} y debe comprobarse en la obra recomendada.`,
  model: null,
});
console.log(`assessment: ${assessment.verdict} ${assessment.score}/100`);
if (assessment.score <= 0) throw new Error('assessment did not score the answer');

console.log('\nSTUDY GUIDE SMOKE OK');
