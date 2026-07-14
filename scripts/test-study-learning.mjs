// Study vault phase 11: pure SM-2 scheduling and metrics, durable flashcards,
// review evidence, planning, goals, Pomodoro sessions and ICS export.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const require = createRequire(import.meta.url);
if (!process.argv.includes('--electron-study-learning-test')) { execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/test-study-learning.mjs'), '--electron-study-learning-test'], { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }); process.exit(0); }
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-learning-')); installRuntimeHooks(root);
try {
  const srs = require(path.join(repoRoot, 'shared/studySrs.ts')); const stats = require(path.join(repoRoot, 'shared/studyStats.ts')); const flashcards = require(path.join(repoRoot, 'shared/studyFlashcards.ts')); const planner = require(path.join(repoRoot, 'shared/studyPlanner.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts')); const bank = require(path.join(repoRoot, 'electron/db/studyQuestionsRepo.ts')); const learning = require(path.join(repoRoot, 'electron/db/studyLearningRepo.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')); const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  assert.equal(SCHEMA_VERSION, 62); assert.equal(getDb().pragma('user_version', { simple: true }), 62);
  for (const table of ['study_flashcards', 'study_srs_state', 'study_reviews', 'study_mastery', 'study_plans', 'study_plan_blocks', 'study_calendar_events', 'study_goals', 'study_study_sessions']) assert.ok(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} exists`);

  const initial = srs.initialStudySrsState(new Date('2026-01-01T00:00:00Z')); const first = srs.scheduleStudySrsReview(initial, 4, new Date('2026-01-01T00:00:00Z'), 4); assert.equal(first.intervalDays, 1); assert.equal(first.repetitions, 1); assert.equal(first.correct, true);
  const second = srs.scheduleStudySrsReview(first, 4, new Date('2026-01-02T00:00:00Z')); assert.equal(second.intervalDays, 6); const lapse = srs.scheduleStudySrsReview(second, 1, new Date('2026-01-08T00:00:00Z')); assert.equal(lapse.repetitions, 0); assert.equal(lapse.lapses, 1); assert.ok(lapse.easeFactor >= 1.3);
  assert.equal(stats.summarizeStudyPerformance({ correct: 8, incorrect: 2, omitted: 0, reviews: 10, lapses: 2, studySeconds: 1200 }).status, 'strong');
  assert.deepEqual(flashcards.clozeStudyFlashcard('La {{c1::mitosis}} produce {{c2::dos células}}.'), { question: 'La _____ produce _____.', answer: 'mitosis · dos células' });
  assert.ok(flashcards.validateStudyFlashcard({ type: 'cloze', front: 'Sin marca', back: 'x' }).length);
  const distributed = planner.distributeStudyBlocks({ startsAt: '2026-01-01T00:00:00Z', examAt: '2026-01-10T00:00:00Z', totalMinutes: 100, topics: [{ id: 'weak', title: 'Débil', mastery: 10 }, { id: 'strong', title: 'Fuerte', mastery: 90 }] }); assert.ok(distributed[0].durationMinutes > distributed[1].durationMinutes, 'weak topics receive more time');

  const course = org.createStudyCourse({ name: 'Biología' }); const subject = org.createStudySubject({ courseId: course.id, name: 'Citología' }); const topic = org.createStudyTopic({ subjectId: subject.id, name: 'Mitosis' });
  const question = bank.createStudyQuestion({ prompt: '¿Qué proceso produce dos células hijas?', type: 'short', status: 'approved', answer: { text: 'La mitosis.' }, explanation: 'Según el manual.', courseId: course.id, subjectId: subject.id, topicId: topic.id, source: { title: 'Manual', excerpt: 'La mitosis produce dos células hijas.' } });
  const [fromQuestion] = learning.createStudyFlashcardsFromQuestions([question.id]); assert.equal(fromQuestion.questionId, question.id); assert.equal(fromQuestion.srs.repetitions, 0);
  const cloze = learning.createStudyFlashcard({ type: 'cloze', front: 'La {{c1::mitosis}} produce dos células.', back: 'mitosis', subjectId: subject.id, topicId: topic.id, tags: ['célula'] });
  assert.equal(learning.listStudyFlashcards({ subjectId: subject.id }).length, 2); assert.equal(learning.listStudyFlashcards({ search: 'mitosis' }).length, 2);
  const reviewed = learning.reviewStudyFlashcard({ cardId: cloze.id, rating: 4, confidence: 4, elapsedMs: 1800 }); assert.equal(reviewed.review.correct, true); assert.equal(reviewed.card.srs.intervalDays, 1); assert.equal(getDb().prepare('SELECT COUNT(*) value FROM study_reviews').get().value, 1);
  learning.setStudyFlashcardState(cloze.id, 'reset'); assert.equal(learning.listStudyFlashcards().find((card) => card.id === cloze.id).srs.repetitions, 0); learning.setStudyFlashcardState(cloze.id, 'exclude'); assert.equal(learning.listStudyFlashcards().find((card) => card.id === cloze.id).srs.excluded, true); learning.setStudyFlashcardState(cloze.id, 'include');

  const plan = learning.createStudyPlan({ title: 'Preparar parcial', subjectId: subject.id, examAt: '2026-09-15T09:00:00Z', availableMinutes: 180 }); const block = learning.createStudyPlanBlock({ planId: plan.id, title: 'Repasar mitosis', subjectId: subject.id, topicId: topic.id, startsAt: '2026-09-10T17:00:00Z', durationMinutes: 30 });
  const event = learning.createStudyCalendarEvent({ title: 'Parcial citología', type: 'exam', startsAt: '2026-09-15T09:00:00Z', subjectId: subject.id }); const goal = learning.createStudyGoal({ title: 'Estudiar 90 minutos', targetValue: 90, unit: 'minutos', subjectId: subject.id });
  learning.updateStudyPlannerItem('goal', goal.id, { currentValue: 90, completed: true }); const session = learning.startStudySession({ planBlockId: block.id, subjectId: subject.id, topicId: topic.id, plannedMinutes: 30 }); const finished = learning.finishStudySession(session.id, { actualSeconds: 1500, interruptions: 1 }); assert.equal(finished.actualSeconds, 1500);
  const snapshot = learning.getStudyPlanner(); assert.equal(snapshot.events[0].id, event.id); assert.equal(snapshot.goals[0].completed, true); assert.match(learning.renderStudyPlannerIcs(snapshot), /BEGIN:VEVENT[\s\S]*Parcial citología/);
  const dashboard = learning.getStudyProgressDashboard(); assert.equal(dashboard.dueCards, 2); assert.equal(dashboard.completedGoals, 1); assert.equal(dashboard.actualMinutes, 25); assert.equal(dashboard.plannedMinutes, 30);

  const legacy = new (require('better-sqlite3'))(path.join(root, 'legacy-v60.sqlite')); for (const migration of migrations.filter((item) => item.version <= 60)) { legacy.exec(migration.up); legacy.pragma(`user_version = ${migration.version}`); } const stamp = new Date().toISOString(); legacy.prepare("INSERT INTO study_courses (id,short_id,name,position,created_at,updated_at) VALUES ('legacy','CRS-LEG','Conservado',0,?,?)").run(stamp, stamp); runMigrations(legacy); assert.equal(legacy.pragma('user_version', { simple: true }), 62); assert.equal(legacy.prepare("SELECT name FROM study_courses WHERE id='legacy'").get().name, 'Conservado'); legacy.close();
  for (const [file, markers] of [['src/views/StudyReviewView.tsx', ['study-review-view','study-review-session','study-flashcard-editor']], ['src/views/StudyProgressView.tsx', ['study-progress-view']], ['src/views/StudyPlannerView.tsx', ['study-planner-view','study-planner-create','study-pomodoro-active']]]) { const source = await readFile(path.join(repoRoot, file), 'utf8'); for (const marker of markers) assert.match(source, new RegExp(marker)); }
  closeDb(); console.log('Study learning phase 11 tests passed!');
} finally { await rm(root, { recursive: true, force: true }); }

function installRuntimeHooks(userDataPath) { const ts=require('typescript');const Module=require('node:module');const originalResolveFilename=Module._resolveFilename;const originalLoad=Module._load;const electronStub={app:{getPath:()=>userDataPath,getVersion:()=> '0.0.0-test',getAppPath:()=>repoRoot,isPackaged:false},safeStorage:{isEncryptionAvailable:()=>false,encryptString:(value)=>Buffer.from(String(value)),decryptString:(value)=>Buffer.from(value).toString()},dialog:{},shell:{},BrowserWindow:class{}};Module._resolveFilename=function(request,parent,isMain,options){if(request.startsWith('@shared/'))return path.join(repoRoot,`${request.replace('@shared/','shared/')}.ts`);return originalResolveFilename.call(this,request,parent,isMain,options);};Module._load=function(request,parent,isMain){if(request==='electron')return electronStub;return originalLoad.call(this,request,parent,isMain);};require.extensions['.ts']=function(module,filename){const output=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,moduleResolution:ts.ModuleResolutionKind.NodeJs,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX,resolveJsonModule:true,skipLibCheck:true}}).outputText;module._compile(output,filename);};}
