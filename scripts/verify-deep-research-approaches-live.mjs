// Explicit opt-in live QA for every Deep Research variant × approach.
//
// Safety contract:
//   - uses only ephemeral demo profiles;
//   - accepts the Gemini key from the environment and removes it immediately;
//   - serves the key to Nodus from memory (never secretStore / disk);
//   - requires the exact model id below and has no fallback provider/model;
//   - writes sanitized reports/results only under an ignored artifact directory.
//
// Usage:
//   GEMINI_API_KEY=… npm run verify:deep-research-approaches-live
//   GEMINI_API_KEY=… npm run verify:deep-research-approaches-live -- --resolve-only
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const MODEL_ID = 'gemini-3.1-flash-lite';
const MODEL = { provider: 'gemini', model: MODEL_ID };
const APPROACHES = [
  'general', 'literature_review', 'state_of_art', 'scholarly_debate',
  'comparative', 'chronological', 'conceptual',
];
const VARIANTS = ['academic', 'genealogy', 'study', 'teaching'];
const CHILD_FLAG = '--electron-deep-research-approaches-live';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const outputRoot = path.resolve(arg('--out', path.join(repoRoot, 'output/deep-research-approaches-live')));

if (!process.argv.includes(CHILD_FLAG)) {
  assert.ok(process.env.GEMINI_API_KEY?.trim(), 'Set GEMINI_API_KEY for this explicit isolated QA run.');
  fs.mkdirSync(outputRoot, { recursive: true });
  const onlyVariant = arg('--variant');
  const variants = onlyVariant ? [onlyVariant] : VARIANTS;
  for (const variant of variants) {
    assert.ok(VARIANTS.includes(variant), `Unknown Deep Research variant: ${variant}`);
    execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [
      path.join(repoRoot, 'scripts/verify-deep-research-approaches-live.mjs'),
      CHILD_FLAG,
      '--variant', variant,
      '--out', outputRoot,
      ...(process.argv.includes('--resolve-only') ? ['--resolve-only'] : []),
      ...(arg('--approach') ? ['--approach', arg('--approach')] : []),
      ...(arg('--runs') ? ['--runs', arg('--runs')] : []),
    ], {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (process.argv.includes('--resolve-only')) break;
  }
  if (!process.argv.includes('--resolve-only')) combineResults(outputRoot);
  process.exit(0);
}

const variant = arg('--variant');
assert.ok(VARIANTS.includes(variant), 'A valid --variant is required in the Electron child.');
const apiKey = process.env.GEMINI_API_KEY?.trim();
assert.ok(apiKey, 'The Gemini key must reach only the isolated Electron child.');
delete process.env.GEMINI_API_KEY;

const profileRoot = await mkdtemp(path.join(os.tmpdir(), `nodus-dr-approaches-${variant}-`));
installRuntimeHooks(profileRoot);
installInMemorySecretStore(apiKey);

let closeDb = () => undefined;
try {
  const providers = require(path.join(repoRoot, 'electron/ai/providers.ts'));
  const available = await providers.listModels('gemini', apiKey);
  const resolved = available.find((candidate) => candidate.id === MODEL_ID);
  assert.ok(resolved, `${MODEL_ID} is not currently offered by the configured Gemini provider path.`);

  const ai = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  const probe = await ai.completeText({
    system: 'Return exactly the word OK.',
    user: 'Provider invocation check.',
    maxTokens: 16,
    temperature: 0,
    noRetry: true,
    plainContext: true,
    skipStudentPseudonyms: true,
  }, MODEL);
  assert.match(probe.trim(), /^OK[.!]?$/i, `${MODEL_ID} resolved but did not complete the invocation probe.`);
  console.log(`[live-qa] exact model resolved and invoked: ${MODEL_ID}`);
  if (process.argv.includes('--resolve-only')) process.exitCode = 0;
  else {
    const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
    const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
    ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));
    seedFixture(variant, vaults);
    settings.updateSettings({
      uiLanguage: 'es',
      promptLanguage: 'es',
      synthesisModel: MODEL,
      deepResearchModel: MODEL,
      studyModel: MODEL,
      modelSettingsMode: 'advanced',
      studyAiEnabled: true,
      studyAiPrivacyMode: 'external',
      studyAiLocalOnly: false,
      studyAiConfirmExternal: false,
      studyAiRetryCount: 0,
      studyAiMaxInputChars: 60_000,
      studyAiMaxOutputTokens: 6_000,
    });

    const { generateDeepResearchReport } = require(path.join(repoRoot, 'electron/ai/deepResearch.ts'));
    const drafts = require(path.join(repoRoot, 'electron/db/writingDraftsRepo.ts'));
    const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
    const onlyApproach = arg('--approach');
    const approaches = onlyApproach ? [onlyApproach] : APPROACHES;
    approaches.forEach((value) => assert.ok(APPROACHES.includes(value), `Unknown approach: ${value}`));
    const requestedRuns = Math.max(1, Math.min(3, Number(arg('--runs', '2')) || 2));
    const results = [];
    const variantDir = path.join(outputRoot, variant);
    fs.mkdirSync(variantDir, { recursive: true });

    for (const approach of approaches) {
      let shouldRunThird = false;
      for (let run = 1; run <= requestedRuns + (shouldRunThird ? 1 : 0); run += 1) {
        const objective = objectivesFor(variant, approach)[(run - 1) % 2];
        const request = requestFor(variant, approach, objective);
        const startedAt = Date.now();
        const phases = [];
        console.log(`[live-qa] ${variant} × ${approach} · report ${run}`);
        const report = await generateDeepResearchReport(request, (progress) => {
          phases.push(progress.phase);
          if (progress.phase === 'planning' || progress.phase === 'done') {
            console.log(`  · ${progress.phase}: ${progress.message}`);
          }
        });
        assert.equal(report.draft.deepResearchApproach, approach);
        assert.deepEqual(report.draft.generationModel, MODEL);
        const saved = drafts.saveWritingWorkshopDraft({ draft: report.draft, model: MODEL, title: report.draft.title });
        const deterministic = inspectDeterministically(report, variant, approach, getDb());
        const semantic = await judgeApproach(ai, report, variant, approach, objective);
        const passed = deterministic.passed && semantic.pass && semantic.approachScore >= 3 && semantic.groundingScore >= 3;
        const entry = {
          variant, approach, run, objective, savedDraftId: saved.id,
          elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
          phases, model: MODEL_ID, passed, deterministic, semantic,
          reportFile: `${approach}-${run}.json`,
        };
        const serialized = JSON.stringify({ entry, report }, null, 2);
        assert.equal(serialized.includes(apiKey), false, 'The API key must never enter a report or QA artifact.');
        fs.writeFileSync(path.join(variantDir, entry.reportFile), `${serialized}\n`, { mode: 0o600 });
        results.push(entry);
        console.log(`  · QA ${passed ? 'PASS' : 'FAIL'} · approach=${semantic.approachScore}/4 grounding=${semantic.groundingScore}/4`);
        if (!passed && run <= 2) shouldRunThird = true;
      }
    }

    // Close the product connection and reopen SQLite as a fresh process would.
    const databasePath = vaults.getActiveVault().path;
    closeDb();
    closeDb = () => undefined;
    const Database = require('better-sqlite3');
    const reopened = new Database(databasePath, { readonly: true, fileMustExist: true });
    const rows = reopened.prepare(`SELECT brief_json, model_json, draft_json FROM writing_saved_drafts
      WHERE json_extract(brief_json, '$.kind') = 'deep_research'`).all();
    const expectedReports = results.length;
    assert.ok(rows.length >= expectedReports, 'Every generated report survives a database reopen.');
    for (const row of rows.slice(-expectedReports)) {
      const brief = JSON.parse(row.brief_json);
      const model = JSON.parse(row.model_json);
      const draft = JSON.parse(row.draft_json);
      assert.ok(APPROACHES.includes(brief.deepResearchApproach));
      assert.deepEqual(model, MODEL);
      assert.deepEqual(draft.generationModel, MODEL);
      assert.equal(draft.deepResearchApproach, brief.deepResearchApproach);
    }
    reopened.close();

    // A focused rerun merges with already-sanitized artifacts from an earlier pass.
    // This lets QA repair one failed case without spending calls on every passing case.
    const artifactResults = fs.readdirSync(variantDir)
      .filter((name) => /^(general|literature_review|state_of_art|scholarly_debate|comparative|chronological|conceptual)-\d+\.json$/.test(name))
      .map((name) => JSON.parse(fs.readFileSync(path.join(variantDir, name), 'utf8')).entry)
      .sort((a, b) => APPROACHES.indexOf(a.approach) - APPROACHES.indexOf(b.approach) || a.run - b.run);
    const resultPath = path.join(variantDir, 'results.json');
    fs.writeFileSync(resultPath, `${JSON.stringify({
      variant, fixture: 'isolated-demo', model: MODEL_ID,
      generated: artifactResults.length, passed: artifactResults.filter((item) => item.passed).length,
      failed: artifactResults.filter((item) => !item.passed).length,
      persistenceReopenPassed: true, results: artifactResults,
    }, null, 2)}\n`, { mode: 0o600 });
    assert.equal(artifactResults.some((item) => !item.passed), false, `${variant} has live QA failures; inspect ${resultPath}.`);
  }
} finally {
  delete process.env.GEMINI_API_KEY;
  try { closeDb(); } catch { /* no database in resolve-only mode */ }
  await rm(profileRoot, { recursive: true, force: true });
}

function seedFixture(kind, vaults) {
  const active = vaults.getActiveVault();
  if (kind === 'academic') {
    vaults.setVaultType(active.id, 'academic');
    assert.equal(require(path.join(repoRoot, 'electron/db/demoData.ts')).seedDemoData(), true);
  } else if (kind === 'genealogy') {
    assert.equal(require(path.join(repoRoot, 'electron/db/genealogyDemoData.ts')).seedGenealogyDemoData(), true);
  } else if (kind === 'study') {
    vaults.setVaultType(active.id, 'estudio');
    assert.equal(require(path.join(repoRoot, 'electron/db/studyDemoData.ts')).seedStudyDemoData(), true);
  } else {
    vaults.setVaultType(active.id, 'docencia');
    assert.equal(require(path.join(repoRoot, 'electron/db/teachingDemoData.ts')).seedTeachingDemoData(), true);
  }
  assert.equal(vaults.getActiveVault().type, kind === 'teaching' ? 'docencia' : kind === 'study' ? 'estudio' : kind);
}

function requestFor(kind, approach, objective) {
  const base = {
    objective, approach, language: 'es',sectionLimit: 3,
    model: MODEL, audience: kind === 'teaching' ? 'teacher' : kind === 'study' ? 'students' : 'comunidad académica',
  };
  if (kind === 'study') return { ...base, studyMode: true };
  if (kind === 'teaching') return {
    ...base,
    unitMode: true,
    outline: [
      { title: 'Activación y problema', focus: 'Partir de una pregunta comprobable en los materiales.' },
      { title: 'Análisis guiado de evidencias', focus: 'Desarrollar el enfoque seleccionado dentro de esta sección sin cambiarla.' },
      { title: 'Síntesis y evaluación', focus: 'Cerrar con una actividad evaluable y criterios claros.' },
    ],
  };
  return base;
}

function objectivesFor(kind, approach) {
  const corpora = {
    academic: {
      general: ['Analiza las estrategias que favorecen el aprendizaje duradero según el corpus.', 'Explica cómo se relacionan memoria, práctica y retroalimentación en el aprendizaje.'],
      literature_review: ['Revisa las principales interpretaciones sobre las técnicas eficaces de aprendizaje.', 'Sintetiza enfoques y métodos sobre memoria, carga cognitiva y autorregulación.'],
      state_of_art: ['Establece qué sostiene el corpus sobre práctica de recuperación, espaciado y transferencia y qué queda abierto.', 'Explica el estado actual del conocimiento disponible sobre aprendizaje eficaz, límites y controversias.'],
      scholarly_debate: ['Reconstruye el desacuerdo sobre práctica de recuperación y ansiedad ante los exámenes.', 'Examina los desacuerdos reales sobre confrontar errores previos y construir modelos alternativos.'],
      comparative: ['Compara práctica de recuperación y reestudio según efectos, mecanismos, límites y evidencia.', 'Compara práctica espaciada e intercalada mediante criterios estables.'],
      chronological: ['Explica la evolución de las teorías del aprendizaje entre 1968 y 2013 sin presentar el desenlace como inevitable.', 'Analiza continuidades, cambios y giros en el estudio de memoria y aprendizaje a lo largo del corpus fechado.'],
      conceptual: ['Sintetiza las relaciones entre carga cognitiva, metacognición, autoeficacia y transferencia.', 'Reconstruye el mapa conceptual entre memoria, práctica, retroalimentación y autorregulación.'],
    },
    genealogy: {
      general: ['Reconstruye la historia documentada de la familia Serrano entre Carmona y Sevilla.', 'Explica qué puede saberse de la familia Serrano a partir de sus documentos conservados.'],
      literature_review: ['Sintetiza las interpretaciones secundarias y la evidencia archivística sobre la trayectoria familiar Serrano.', 'Revisa cómo la bibliografía metodológica y los documentos permiten interpretar la movilidad de la familia.'],
      state_of_art: ['Distingue hechos familiares establecidos, inciertos y relaciones todavía no resueltas en el corpus Serrano.', 'Establece qué puede probarse sobre personas, hogares y movimientos y qué evidencia falta.'],
      scholarly_debate: ['Examina si existen registros o interpretaciones realmente conflictivos sobre la familia Serrano y declara la asimetría si no los hay.', 'Reconstruye únicamente los conflictos documentales genuinos del archivo, sin inventar un debate.'],
      comparative: ['Compara las ramas Serrano Vidal y Serrano Campos por hogares, movimientos y evidencia documental.', 'Compara las trayectorias documentadas de Rafael, Amparo y Vicente Serrano con criterios estables.'],
      chronological: ['Reconstruye la secuencia documentada de la familia Serrano entre 1865 y 1925, con continuidades y giros.', 'Explica etapas vitales, movimientos y cambios familiares usando solo fechas documentadas.'],
      conceptual: ['Sintetiza los conceptos de hogar, parentesco documentado, movilidad y ocupación presentes en el archivo.', 'Reconstruye las relaciones entre familia, padrón, migración y prueba genealógica sin usarlas para inventar vínculos.'],
    },
    study: {
      general: ['Explica cómo se relacionan estructura celular, transporte de membrana y flujo de energía.', 'Prepara una explicación de los materiales sobre membranas y ecosistemas.'],
      literature_review: ['Sintetiza las perspectivas representadas en los materiales sobre membrana, transporte y energía.', 'Revisa enfoques y explicaciones presentes en los apuntes de biología disponibles.'],
      state_of_art: ['Distingue conocimientos establecidos, limitados y preguntas abiertas en los materiales de biología.', 'Explica qué puede concluirse y qué no sobre transporte celular y energía desde estos materiales.'],
      scholarly_debate: ['Identifica explicaciones competidoras reales en los materiales y no inventes oposición si no existe.', 'Examina las tensiones o alternativas explicativas disponibles sobre transporte y flujo de energía.'],
      comparative: ['Compara difusión simple, ósmosis y transporte activo por mecanismo, energía y dirección del gradiente.', 'Compara el flujo de energía en células y ecosistemas mediante criterios estables.'],
      chronological: ['Explica la secuencia de procesos desde la captación de energía hasta su transferencia y disipación.', 'Organiza temporalmente los procesos de transporte y energía sin convertirlos en una lista.'],
      conceptual: ['Reconstruye las relaciones entre membrana, gradiente, permeabilidad, ATP y ósmosis.', 'Elabora un mapa conceptual en prosa sobre productores, energía química y niveles tróficos.'],
    },
    teaching: {
      general: ['Diseña una unidad sobre industrialización y cambio social a partir de los materiales.', 'Diseña una unidad para aprender a analizar fuentes de la revolución industrial.'],
      literature_review: ['Diseña una unidad que enseñe las interpretaciones representadas sobre industrialización y sociedad.', 'Enseña a sintetizar perspectivas y fuentes sobre el cambio industrial.'],
      state_of_art: ['Diseña una unidad sobre conocimientos establecidos, límites y preguntas abiertas de la industrialización.', 'Enseña qué sostienen y qué no sostienen los materiales sobre cambio social industrial.'],
      scholarly_debate: ['Diseña una unidad que enseñe debates reales sobre industrialización, condiciones laborales y respuestas sociales.', 'Enseña a evaluar explicaciones competidoras del cambio industrial sin fabricar oposición.'],
      comparative: ['Diseña una unidad que compare fábrica y trabajo artesanal mediante ejes estables.', 'Compara condiciones laborales y respuestas sociales antes y durante la industrialización.'],
      chronological: ['Diseña una unidad sobre antecedentes, fases y consecuencias de la revolución industrial.', 'Enseña continuidades, rupturas y giros del proceso de industrialización.'],
      conceptual: ['Diseña una unidad sobre las relaciones entre industrialización, urbanización, clase y trabajo.', 'Enseña un mapa conceptual de fábrica, mecanización, cambio social y movimiento obrero.'],
    },
  };
  return corpora[kind][approach];
}

function inspectDeterministically(report, kind, approach, db) {
  const markdown = report.draft.draftMarkdown ?? '';
  const links = [...markdown.matchAll(/\]\((nodus:\/\/[^)]+)\)/g)].map((match) => match[1]);
  const uniqueLinks = [...new Set(links)];
  const invalidLinks = uniqueLinks.filter((url) => !citationExists(url, db));
  const sections = markdown.split(/^##\s+/mu).slice(1).map((part) => part.trim());
  const similarities = [];
  for (let i = 0; i < sections.length; i += 1) for (let j = i + 1; j < sections.length; j += 1) {
    similarities.push(jaccard(sections[i], sections[j]));
  }
  const words = markdown.replace(/\[[^\]]*\]\([^)]+\)/g, ' ').split(/\s+/).filter(Boolean).length;
  const singleSourceDeclared = (report.draft.limitations ?? []).some((item) =>
    /(?:una (?:única|sola) fuente|un (?:único|solo) material|solo un material|base (?:documental|de fuentes) limitada)/i.test(item));
  const fixedOutlineOk = kind !== 'teaching' || ['Activación y problema', 'Análisis guiado de evidencias', 'Síntesis y evaluación']
    .every((title, index) => report.draft.outline[index]?.title === title) && report.draft.outline.length === 3;
  const checks = {
    citationsPresent: uniqueLinks.length > 0,
    noInventedCitationIds: invalidLinks.length === 0,
    multipleSources: uniqueLinks.length >= 2 || (uniqueLinks.length === 1 && singleSourceDeclared),
    coherentSections: report.meta.sections >= 2 && sections.length >= 2,
    noObviousSectionDuplication: Math.max(0, ...similarities) < 0.72,
    sensibleLength: words >= 700,
    limitations: (report.draft.limitations ?? []).length > 0,
    nextSteps: (report.draft.nextSteps ?? []).length > 0,
    approachPersisted: report.draft.deepResearchApproach === approach,
    modelPersisted: report.draft.generationModel?.provider === 'gemini' && report.draft.generationModel?.model === MODEL_ID,
    teachingFixedOutlineAuthoritative: fixedOutlineOk,
  };
  return { passed: Object.values(checks).every(Boolean), checks, words, citations: uniqueLinks.length, invalidLinks, maxSectionSimilarity: Math.max(0, ...similarities) };
}

function citationExists(url, db) {
  const parsed = /^nodus:\/\/([^/]+)\/([^?]+)/.exec(url);
  if (!parsed) return false;
  const kind = parsed[1];
  const id = decodeURIComponent(parsed[2]);
  const table = {
    idea: ['ideas', 'global_id'], work: ['works', 'nodus_id'], passage: ['passages', 'id'],
    gap: ['gaps', 'id'], contradiction: ['edges', 'id'], archive: ['archive_items', 'item_id'],
    material: ['study_materials', 'id'], doc: ['study_docs', 'id'], recording: ['study_recordings', 'id'],
  }[kind];
  if (kind === 'study') {
    const study = /^nodus:\/\/study\/(material|doc|recording)\/([^?]+)/.exec(url);
    if (!study) return false;
    const mapped = { material: ['study_materials', 'id'], doc: ['study_docs', 'id'], recording: ['study_recordings', 'id'] }[study[1]];
    return Boolean(db.prepare(`SELECT 1 FROM ${mapped[0]} WHERE ${mapped[1]} = ?`).get(decodeURIComponent(study[2])));
  }
  return Boolean(table && db.prepare(`SELECT 1 FROM ${table[0]} WHERE ${table[1]} = ?`).get(id));
}

function jaccard(left, right) {
  const tokens = (text) => new Set(text.toLocaleLowerCase('es').match(/[a-záéíóúüñ]{5,}/gu) ?? []);
  const a = tokens(left); const b = tokens(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

async function judgeApproach(ai, report, variantName, approach, objective) {
  const rubric = {
    general: 'Evalúa calidad general sin exigir organización especializada.',
    literature_review: 'Falla si es bibliografía anotada o secciones por autor; debe sintetizar líneas, convergencias y desacuerdos.',
    state_of_art: 'Falla si confunde ausencia del corpus con ausencia en el campo; debe separar establecido, limitado, discutido y abierto.',
    scholarly_debate: 'Falla si inventa oposición; debe atribuir posiciones reales, evidencia y causas del desacuerdo o reconocer que no hay debate suficiente.',
    comparative: 'Falla si no usa ejes estables, oculta asimetrías o un comparando domina sin explicación.',
    chronological: 'Falla si es una lista de fechas, inventa fechas o no explica continuidad, cambio y puntos de inflexión.',
    conceptual: 'Falla si solo lista definiciones; debe reconstruir relaciones, límites y tensiones entre conceptos.',
  }[approach];
  const vaultRule = variantName === 'genealogy'
    ? 'Falla si afirma parentesco o identidad sin calificar la evidencia o si abandona el estándar de prueba genealógico.'
    : variantName === 'study'
      ? 'Falla si pierde claridad pedagógica.'
      : variantName === 'teaching'
        ? 'Falla si deja de ser una unidad utilizable o altera las tres secciones fijadas por el docente.'
        : 'Evalúa como informe académico fundamentado.';
  const result = await ai.completeJson({
    system: [
      'Eres un evaluador estricto de informes Deep Research. Evalúa el texto dado, no lo reescribas.',
      'Puntúa de 1 a 4 fidelidad al enfoque y fundamentación. pass solo puede ser true si ambas puntuaciones son al menos 3 y no hay un defecto crítico.',
      rubric, vaultRule,
      'Comprueba además progresión, ausencia de repetición obvia, limitaciones prudentes y próximos pasos útiles.',
      'Sé extremadamente conciso: máximo dos issues y dos strengths, cada uno de una sola frase.',
      'Devuelve solo JSON: {"pass":true,"approachScore":4,"groundingScore":4,"layer":"retrieval|planning|writing|finalization|none","issues":["..."],"strengths":["..."]}.',
    ].join('\n'),
    user: JSON.stringify({ variant: variantName, approach, objective, title: report.draft.title, abstract: report.draft.abstract, outline: report.draft.outline, limitations: report.draft.limitations, nextSteps: report.draft.nextSteps, markdown: report.draft.draftMarkdown }, null, 2),
    maxTokens: 2_000,
    temperature: 0,
    plainContext: true,
    skipStudentPseudonyms: true,
  }, (value) => Boolean(value && typeof value === 'object' && typeof value.pass === 'boolean' && Number.isFinite(value.approachScore) && Number.isFinite(value.groundingScore) && Array.isArray(value.issues)), MODEL);
  return {
    pass: Boolean(result.pass),
    approachScore: Math.max(1, Math.min(4, Number(result.approachScore) || 1)),
    groundingScore: Math.max(1, Math.min(4, Number(result.groundingScore) || 1)),
    layer: typeof result.layer === 'string' ? result.layer : 'none',
    issues: Array.isArray(result.issues) ? result.issues.filter((item) => typeof item === 'string').slice(0, 6) : [],
    strengths: Array.isArray(result.strengths) ? result.strengths.filter((item) => typeof item === 'string').slice(0, 6) : [],
  };
}

function combineResults(root) {
  const availableVariants = VARIANTS.filter((name) => fs.existsSync(path.join(root, name, 'results.json')));
  const variants = availableVariants.map((name) => JSON.parse(fs.readFileSync(path.join(root, name, 'results.json'), 'utf8')));
  const matrix = [];
  for (const name of availableVariants) for (const approach of APPROACHES) {
    const rows = variants.find((item) => item.variant === name).results.filter((item) => item.approach === approach);
    matrix.push({ variant: name, approach, reports: rows.length, passed: rows.filter((item) => item.passed).length, failed: rows.filter((item) => !item.passed).length });
  }
  const summary = {
    generatedAt: new Date().toISOString(), isolatedDemoData: true, model: MODEL_ID,
    otherModelsUsed: false, keyPersistedOrLogged: false,
    totalReports: matrix.reduce((sum, item) => sum + item.reports, 0), matrix,
  };
  fs.writeFileSync(path.join(root, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(summary, null, 2));
}

function installInMemorySecretStore(key) {
  const filename = path.join(repoRoot, 'electron/secrets/secretStore.ts');
  const Module = require('node:module');
  const stub = new Module(filename, null);
  stub.filename = filename;
  stub.loaded = true;
  stub.exports = {
    getApiKey: (provider) => provider === 'gemini' ? key : null,
    hasApiKey: (provider) => provider === 'gemini',
    providerKeyMap: () => ({ gemini: true }),
    lockedApiKeyProviders: () => [],
  };
  require.cache[filename] = stub;
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-deep-research-approaches-live', getAppPath: () => repoRoot, isPackaged: false, getName: () => 'Nodus' },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
    dialog: { showMessageBoxSync: () => 1 }, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined }, net: {},
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
