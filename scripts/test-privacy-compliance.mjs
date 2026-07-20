import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(repoRoot, relative), 'utf8');

async function sourceFiles(root, extensions = new Set(['.ts', '.tsx'])) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (extensions.has(path.extname(entry.name))) result.push(absolute);
    }
  }
  await visit(path.join(repoRoot, root));
  return result;
}

test('the distributable contains the privacy policy and controller checklist', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.scripts['privacy:verify'], 'node --test scripts/test-privacy-compliance.mjs');
  assert.ok(pkg.build.extraResources.some((item) => item.from === 'PRIVACY.md' && item.to === 'legal/PRIVACY.md'));
  assert.ok(pkg.build.extraResources.some((item) => item.from === 'legal' && item.to === 'legal'));
  assert.equal(existsSync(path.join(repoRoot, 'legal/RGPD_DEPLOYMENT_CHECKLIST.md')), true);

  const settings = await read('src/views/Settings.tsx');
  assert.match(settings, /data-testid="about-privacy"/);
  assert.match(settings, /data-testid="about-gdpr"/);
  assert.match(settings, /data-testid="about-third-party-licenses"/);
  assert.match(settings, /data-testid="about-transparency-security"/);
  assert.match(settings, /window\.nodus\.openPrivacyPolicy\(\)/);
  assert.match(settings, /blob\/main\/PRIVACY\.md/);
  assert.match(settings, /blob\/main\/legal\/RGPD_DEPLOYMENT_CHECKLIST\.md/);
  assert.match(settings, /blob\/main\/LICENSE/);
  assert.match(settings, /security\/advisories\/new/);
  assert.match(settings, /no es una certificación/);
  for (const source of await Promise.all(['electron/ipc.ts', 'electron/preload.ts', 'shared/types.ts'].map(read))) {
    assert.match(source, /openPrivacyPolicy/);
  }
});

test('the policy states the real local and controller boundaries without an invalid blanket waiver', async () => {
  const policy = await read('PRIVACY.md');
  const normalized = policy.replace(/\s+/g, ' ');
  for (const marker of [
    'no incorpora publicidad, telemetría, analítica remota',
    'no usa IA para puntuar, calificar, clasificar, perfilar ni evaluar',
    'no crea por sí solo una base jurídica',
    'no elimina obligaciones legales imperativas',
    'artículos 13 y 14 del RGPD',
    'artículo 28 RGPD',
    'evaluación de impacto',
    'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    'https://www.aepd.es/',
  ]) assert.match(normalized, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.doesNotMatch(policy, /Nodus (?:cumple|garantiza) (?:íntegramente|totalmente|oficialmente)|el usuario es el único responsable/i);
});

test('no production bridge can send student work to AI for grading, feedback or evaluation', async () => {
  assert.equal(existsSync(path.join(repoRoot, 'electron/ai/studyGrading.ts')), false);
  const sources = await Promise.all([
    'electron/ipc.ts',
    'electron/preload.ts',
    'shared/types.ts',
    'electron/ai/assessmentImport.ts',
    'electron/ai/studyGuide.ts',
    'src/views/TeachingGradesView.tsx',
    'src/components/StudyTestGenerator.tsx',
  ].map(read));
  for (const source of sources) {
    assert.doesNotMatch(source, /teaching:feedback:draft|['"]study:grading:run['"]|['"]study:answer['"]|draftStudentFeedback|gradeStudyAnswer|cancelStudyGrading/);
  }
  const tasks = await read('shared/studyAi.ts');
  assert.doesNotMatch(tasks, /['"]grading['"]/);

  const immersion = await read('electron/ai/immersion.ts');
  assert.match(immersion, /assessment: null/);
  assert.doesNotMatch(immersion, /respuesta_del_estudiante|EVALUA LA RESPUESTA|open → AI|heuristic fallback/i);
});

test('every microphone access is blocked by the just-in-time recording notice', async () => {
  const files = await sourceFiles('src');
  const microphoneSources = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (!source.includes('getUserMedia(')) continue;
    microphoneSources.push(path.relative(repoRoot, file));
    assert.match(source, /confirmMicrophonePrivacy/);
    assert.ok(source.indexOf('confirmMicrophonePrivacy()') < source.indexOf('getUserMedia('), `${file}: notice must precede microphone access`);
  }
  assert.deepEqual(microphoneSources.sort(), [
    'src/components/editor/StudyDictation.tsx',
    'src/views/StudyRecordingsView.tsx',
  ]);
  const notice = await read('src/privacyNotices.tsx');
  assert.match(notice, /base jurídica y autorización/);
  assert.match(notice, /no sustituye el consentimiento/);
});

test('every file picker is blocked by the just-in-time import notice', async () => {
  const electronFiles = await sourceFiles('electron', new Set(['.ts']));
  const rawDialogs = [];
  for (const file of electronFiles) {
    const source = await readFile(file, 'utf8');
    if (source.includes('dialog.showOpenDialog')) rawDialogs.push(path.relative(repoRoot, file));
  }
  assert.deepEqual(rawDialogs, ['electron/privacy.ts']);

  const rendererFiles = await sourceFiles('src');
  const fileInputs = [];
  for (const file of rendererFiles) {
    const source = await readFile(file, 'utf8');
    if (!/type=["']file["']/.test(source)) continue;
    fileInputs.push(path.relative(repoRoot, file));
    assert.match(source, /confirmFileImportPrivacy/, `${file}: renderer file input needs the privacy gate`);
  }
  assert.deepEqual(fileInputs.sort(), [
    'src/components/DecorativeImageModal.tsx',
    'src/views/StudyOrganizationView.tsx',
  ]);

  const mainNotice = await read('electron/privacy.ts');
  assert.match(mainNotice, /privacy:fileImport:request/);
  assert.match(mainNotice, /requestFileImportPrivacy/);
  assert.doesNotMatch(mainNotice, /showMessageBox/);

  const [rendererNotice, app, preload, apiTypes, ipc] = await Promise.all([
    read('src/privacyNotices.tsx'),
    read('src/App.tsx'),
    read('electron/preload.ts'),
    read('shared/types.ts'),
    read('electron/ipc.ts'),
  ]);
  assert.match(rendererNotice, /autorizado para tratar/);
  assert.match(rendererNotice, /función remota/);
  assert.match(rendererNotice, /PrivacyRequestHost/);
  assert.match(rendererNotice, /zIndex:\s*220/);
  assert.match(app, /<PrivacyRequestHost\s*\/>/);
  for (const source of [preload, apiTypes, ipc]) {
    assert.match(source, /resolveFileImportPrivacyRequest|privacy:fileImport:resolve/);
  }
});

test('public copy matches the no-AI-student-evaluation product boundary', async () => {
  const [readme, faq, landing, teachingDemo] = await Promise.all([
    read('README.md'), read('docs/faq.js'), read('docs/index.html'), read('docs/demo/teaching.html'),
  ]);
  for (const source of [readme, faq, landing, teachingDemo]) {
    assert.doesNotMatch(source, /When AI assists with feedback or assessment|student-name pseudonymisation|códigos seudónimos locales siempre que interviene la IA/i);
    assert.match(source, /(?:never|does not use AI to) [\s\S]{0,80}(?:grade|evaluate)[\s\S]{0,40}students|nunca (?:califica|envía)[\s\S]{0,120}(?:estudiantes|alumnado)|nunca evalúa estudiantes/i);
  }
});
