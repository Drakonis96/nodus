import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { publish } from './lib/nodusServerFixtures.mjs';
import { repoRoot, withServer } from './lib/nodusServerHarness.mjs';

// This is a server-web matrix fixture, not an Electron/Nodus fixture. It publishes
// the same table names the Desktop snapshot builder emits, then exercises the real
// cookie-authenticated SPA against the real local Server process.
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const output = path.join(repoRoot, 'reports', 'server-web-qa', 'specialized-matrix');
await mkdir(output, { recursive: true });

function snapshot(type, name, tables) {
  const payload = {
    format: 'nodus.server-snapshot', formatVersion: 2, generatedAt: '2026-08-27T12:00:00.000Z', schemaVersion: 121,
    vault: { id: `${type}-fixture`, name, type }, capabilities: { hasAssets: false }, assets: [], tables,
  };
  const revision = createHash('sha256').update(JSON.stringify(payload)).digest('base64url');
  return { revision, gzipped: gzipSync(Buffer.from(JSON.stringify(payload))) };
}

const stamp = '2026-08-27T12:00:00.000Z';
const fixtures = {
  estudio: {
    name: 'Estudio · matriz',
    policy: [],
    tables: {
      study_courses: [{ id: 'course-1', short_id: 'CUR-1', name: 'Historia del arte', description: 'Curso de prueba', updated_at: stamp }],
      study_subjects: [{ id: 'subject-1', short_id: 'SUB-1', course_id: 'course-1', name: 'Archivo y memoria', description: 'Asignatura de prueba', updated_at: stamp }],
      study_materials: [{ id: 'material-1', short_id: 'MAT-1', title: 'Dossier de fuentes', description: 'Metadatos publicables', extension: 'pdf', updated_at: stamp }],
      study_docs: [{ id: 'document-1', short_id: 'DOC-1', title: 'Apunte del seminario', description: 'Nota publicada', content_markdown: '# Contexto\n\nTexto del apunte.', updated_at: stamp }],
      study_doc_links: [], study_doc_tags: [],
      study_schedule_periods: [{ id: 'period-1', section: 'morning', label: 'Primera franja', start_time: '09:00', end_time: '10:00', position: 0 }],
      study_schedule_cells: [{ day: 'monday', period_id: 'period-1', subject_id: 'subject-1' }],
      study_calendar_events: [{ id: 'calendar-1', title: 'Entrega del dossier', event_type: 'deadline', starts_at: stamp, ends_at: stamp, notes: 'Evento publicado', course_id: 'course-1' }],
      study_plans: [{ id: 'plan-1', short_id: 'PLAN-1', title: 'Plan semanal', description: 'Plan de prueba', exam_at: stamp, available_minutes: 90, course_id: 'course-1' }],
      study_plan_blocks: [{ id: 'block-1', short_id: 'BLOCK-1', plan_id: 'plan-1', title: 'Leer el dossier', starts_at: stamp, duration_minutes: 30 }],
      study_questions: [{ id: 'question-1', short_id: 'Q-1', prompt: '¿Qué conserva un archivo?', answer_json: '{"text":"Memoria"}', question_type: 'short_answer', difficulty: 'medium', status: 'approved', explanation: 'La documentación conserva huellas de memoria.', source_json: '{"title":"Dossier de fuentes"}', updated_at: stamp }],
      study_ideas: [{ id: 'idea-1', subject_id: 'subject-1', type: 'claim', label: 'El archivo organiza la memoria', statement: 'Idea publicable', updated_at: stamp }, { id: 'idea-2', subject_id: 'subject-1', type: 'claim', label: 'La memoria reinterpreta el archivo', statement: 'Otra idea publicable', updated_at: stamp }],
      study_idea_edges: [{ id: 'edge-1', subject_id: 'subject-1', from_id: 'idea-1', to_id: 'idea-2', type: 'supports', confidence: 0.8 }],
    },
  },
  docencia: {
    name: 'Docencia · matriz',
    policy: [],
    tables: {
      study_courses: [{ id: 'teaching-course-1', short_id: 'CUR-T', name: 'Seminario de archivo', description: 'Curso docente', updated_at: stamp }],
      study_subjects: [{ id: 'teaching-subject-1', short_id: 'SUB-T', course_id: 'teaching-course-1', name: 'Fuentes primarias', updated_at: stamp }],
      study_materials: [{ id: 'teaching-material-1', short_id: 'MAT-T', title: 'Guía del seminario', description: 'Material docente', extension: 'md', updated_at: stamp }],
      study_schedule_periods: [{ id: 'teaching-period-1', section: 'afternoon', label: 'Seminario', start_time: '16:00', end_time: '17:00', position: 0 }],
      study_schedule_cells: [{ day: 'wednesday', period_id: 'teaching-period-1', subject_id: 'teaching-subject-1' }],
      study_calendar_events: [{ id: 'teaching-calendar-1', title: 'Seminario', event_type: 'class', starts_at: stamp, notes: 'Actividad docente' }],
      study_ideas: [{ id: 'teaching-idea-1', subject_id: 'teaching-subject-1', type: 'claim', label: 'Leer contra el archivo', statement: 'Idea docente', updated_at: stamp }],
      teaching_exams: [{ id: 'exam-1', short_id: 'EX-1', title: 'Examen de archivo', language: 'es', target_question_count: 1, header_json: '{"instructions":"Responde"}' }],
      teaching_exam_questions: [{ id: 'exam-question-1', short_id: 'EXQ-1', exam_id: 'exam-1', position: 0, type: 'short_answer', prompt: 'Define archivo', points: 1 }],
      teaching_rubrics: [{ id: 'rubric-1', short_id: 'RUB-1', title: 'Rúbrica de lectura', description: 'Criterios públicos', criteria_json: '[]', updated_at: stamp }],
      // Intentionally absent: teaching_groups, teaching_students, grade entries and assessment rows.
    },
  },
  databases: {
    name: 'Bases de datos · matriz',
    // Pages are user-authored database content; exercise the published path
    // explicitly while keeping the default publication boundary fail-closed.
    policy: ['allowUserContent'],
    tables: {
      db_databases: [{ id: 'database-1', name: 'Catálogo de fuentes', description: 'Base publicada', row_count: 1, updated_at: stamp }],
      db_columns: [{ id: 'column-1', database_id: 'database-1', name: 'Título', type: 'text', position: 0 }],
      db_rows: [{ id: 'db-row-1', database_id: 'database-1', position: 0 }],
      db_cells: [{ id: 'cell-1', row_id: 'db-row-1', column_id: 'column-1', value: 'Registro de prueba' }],
      db_views: [{ id: 'view-1', database_id: 'database-1', name: 'Todos', position: 0 }],
      pages: [{ id: 'page-1', title: 'Página de catálogo', content: 'Contenido publicado', updated_at: stamp }],
      page_blocks: [{ id: 'page-block-1', page_id: 'page-1', sort_order: 0, type: 'paragraph', normalized_text: 'Contenido del bloque publicado', updated_at: stamp }],
    },
  },
  primary_sources: {
    name: 'Fuentes primarias · matriz',
    policy: ['allowPrimarySources'],
    tables: {
      persons: [{ person_id: 'primary-person-1', display_name: 'María Archivo', notes: 'Persona documentada' }],
      places: [{ place_id: 'primary-place-1', name: 'Archivo municipal', notes: 'Lugar documentado' }],
      events: [{ event_id: 'primary-event-1', label: 'Ingreso del fondo', date: '1900-01-01', notes: 'Evento documentado' }],
      archive_folders: [{ folder_id: 'folder-1', name: 'Fondo municipal' }],
      archive_items: [{ item_id: 'archive-1', folder_id: 'folder-1', title: 'Acta municipal', kind: 'document', description: 'Descripción publicable', created_at: stamp, updated_at: stamp }],
      archive_item_tags: [{ item_id: 'archive-1', tag: 'municipio' }],
      archive_item_folders: [{ item_id: 'archive-1', folder_id: 'folder-1' }],
      archive_item_persons: [{ item_id: 'archive-1', person_id: 'primary-person-1' }],
      archive_repositories: [{ repository_id: 'repository-1', name: 'Archivo municipal', access_notes: 'Consulta pública', country_code: 'ES', updated_at: stamp }],
      archive_description_units: [{ unit_id: 'unit-1', repository_id: 'repository-1', level: 'file', title: 'Fondo municipal', scope_content: 'Actas', date_display: '1900', updated_at: stamp }],
      archive_item_units: [{ item_id: 'archive-1', unit_id: 'unit-1', relation_kind: 'describes', position: 0 }],
      archive_excerpts: [{ excerpt_id: 'excerpt-1', item_id: 'archive-1', locator_display: 'f. 1', quoted_text: 'La memoria del puerto', updated_at: stamp }],
      archive_source_analyses: [{ analysis_id: 'analysis-1', item_id: 'archive-1', origin_notes: 'Análisis de procedencia', content_form: 'acta', updated_at: stamp }],
    },
  },
  testimonios: {
    name: 'Testimonios · matriz',
    policy: ['allowTestimonies'],
    tables: {
      testimony_interviews: [{ id: 'interview-1', title: 'Entrevista sobre el puerto', abstract: 'Memoria oral publicada', conducted_at: stamp, location_text: 'Valencia', updated_at: stamp }],
      testimony_transcripts: [{ id: 'transcript-1', interview_id: 'interview-1', media_id: 'media-private', content_markdown: 'La plaza estaba llena.', language: 'es', updated_at: stamp }],
      testimony_transcript_segments: [{ id: 'segment-1', transcript_id: 'transcript-1', t_start: 0, t_end: 1, text: 'La plaza estaba llena.', position: 0 }],
      testimony_codes: [{ id: 'code-1', label: 'Memoria urbana', normalized_label: 'memoria urbana', description: 'Código publicado', color: '#06b6d4', updated_at: stamp }],
      testimony_annotations: [{ id: 'annotation-1', interview_id: 'interview-1', transcript_id: 'transcript-1', quote_snapshot: 'La plaza estaba llena.', memo: 'Observación', updated_at: stamp }],
      testimony_annotation_codes: [{ annotation_id: 'annotation-1', code_id: 'code-1' }],
      testimony_contrasts: [{ id: 'contrast-1', title: 'Dos memorias del puerto', memo_markdown: 'Contraste publicado', updated_at: stamp }],
      testimony_contrast_items: [{ contrast_id: 'contrast-1', annotation_id: 'annotation-1', position: 0 }],
    },
  },
  prosopography: {
    name: 'Prosopografía · matriz',
    policy: [],
    // Aggregate-only rows are safe to publish and let this matrix exercise the
    // real prosopography detail URL without ever putting person identities or
    // factoid literals in the fixture.
    tables: {
      prosopography_public_population: [{ id: 'population:study-1', study_id: 'study-1', title: 'Estudio agregado', research_question: 'Cobertura del archivo', visible_population_count: 4, included_count: 3, reviewed_statement_count: 2, publication_state: 'aggregate_only', updated_at: stamp }],
      prosopography_public_sources: [{ id: 'source:archive:open', source_kind: 'archive', access_status: 'open', source_count: 2, segment_count: 3, publication_state: 'aggregate_only' }],
      prosopography_public_analysis: [{ id: 'analysis:analysis-1', analysis_id: 'analysis-1', title: 'Cobertura agregada', analysis_kind: 'descriptive', latest_population_count: 4, latest_included_count: 3, publication_state: 'aggregate_only', updated_at: stamp }],
      prosopography_public_networks: [{ id: 'network:layer-1', layer_id: 'layer-1', name: 'Red agregada', edge_count: 3, node_count: 4, density: 0.5, publication_state: 'aggregate_only', updated_at: stamp }],
    },
  },
};

const routes = {
  estudio: [
    ['studyCourses', 'vault-surface-study-courses'], ['studySchedule', 'vault-surface-study-schedule'], ['studyCalendar', 'vault-surface-study-calendar'],
    ['studySearch', 'academic-search-view'], ['studyLibrary', 'vault-surface-study-materials'], ['studyRecordings', 'vault-surface-study-materials'],
    ['studyChat', 'study-view'], ['studyIdeas', 'vault-surface-study-ideas'], ['studyGraph', 'vault-surface-study-graph'],
    ['studyQuestions', 'vault-surface-study-questions'], ['studyReview', 'vault-surface-study-review'], ['studyDeepResearch', 'deep-research-view'],
  ],
  docencia: [
    ['studyCourses', 'vault-surface-study-courses'], ['teachingGroups', 'vault-private-surface'], ['studySchedule', 'vault-surface-study-schedule'],
    ['studyCalendar', 'vault-surface-study-calendar'], ['studyLibrary', 'vault-surface-study-materials'], ['studyRecordings', 'vault-surface-study-materials'],
    ['studyChat', 'study-view'], ['studyIdeas', 'vault-surface-study-ideas'], ['studyGraph', 'vault-surface-study-graph'], ['studyQuestions', 'vault-surface-study-questions'],
    ['teachingRubrics', 'vault-surface-teaching-rubrics'], ['teachingExams', 'vault-surface-teaching-exams'], ['teachingGrades', 'vault-private-surface'], ['teachingUnits', 'vault-private-surface'],
  ],
  databases: [['pages', 'vault-surface-database-pages'], ['dbSearch', 'academic-search-view'], ['dbAnalysis', 'published-database-analysis'], ['dbChat', 'database-view']],
  primary_sources: [['search', 'primary-sources-search'], ['archive', 'vault-surface-archive-items'], ['persons', 'primary-sources-persons-view'], ['timeline', 'primary-sources-timeline-view'], ['map', 'primary-sources-provenance-map-view'], ['relations', 'primary-sources-relations-view']],
  testimonios: [['search', 'academic-search-view'], ['testimonyInterviews', 'vault-surface-testimony-interviews'], ['testimonyParticipants', 'vault-private-surface'], ['testimonyContrasts', 'vault-surface-testimony-contrasts']],
  prosopography: [['prosopSearch', 'academic-search-view'], ['prosopPopulation', 'vault-surface-prosopography-persons'], ['prosopPersons', 'vault-surface-prosopography-persons'], ['prosopSources', 'vault-surface-prosopography-sources'], ['prosopAnalysis', 'vault-surface-prosopography-analysis'], ['prosopNetworks', 'vault-surface-prosopography-networks']],
};

// Labels are part of the parity contract too: a generic "acl entries" count is
// not an acceptable replacement for the Desktop vocabulary of a specialised
// vault. The test deliberately checks the public (or explicit private) home
// state before it opens any sidebar route.
const homeMetrics = {
  estudio: ['Cursos', 'Materiales', 'Eventos', 'Preguntas'],
  docencia: ['Exámenes', 'Rúbricas', 'Cursos', 'Materiales'],
  databases: ['Bases de datos', 'Registros', 'Vistas', 'Valores'],
  primary_sources: ['Fuentes', 'Unidades', 'Extractos', 'Análisis'],
  testimonios: ['Entrevistas', 'Transcripciones', 'Códigos', 'Contrastes'],
  prosopography: ['Datos privados'],
};

function noFallback(body, privateRoute) {
  assert.doesNotMatch(body, /No se ha podido cargar|No se ha podido cargar esta vista|Something went wrong/i);
  if (privateRoute) {
    assert.match(body, /Datos privados|privad|no se publican/i);
  } else {
    assert.doesNotMatch(body, /Esta superficie conserva su posición|Disponible solo para consulta cuando exista contenido publicado/i);
  }
}

/** Wait for the first published/private state, rather than capturing the shell's loading state. */
async function waitForSettled(page, testId, timeout = 15_000) {
  const host = page.getByTestId(testId).first();
  await host.waitFor({ timeout });
  await page.waitForFunction((id) => {
    const node = document.querySelector(`[data-testid="${id}"]`);
    if (!node || node.querySelector('[aria-busy="true"], [data-loading="true"]')) return false;
    return ![...node.querySelectorAll('[role="status"]')].some((status) => /cargando|loading|esperando|preparando/i.test(status.textContent || ''));
  }, testId, { timeout });
  await page.waitForTimeout(100);
  return host;
}

await withServer({ label: 'server-web-specialized-matrix', ai: true }, async (server) => {
  const spaces = {};
  for (const [type, fixture] of Object.entries(fixtures)) {
    spaces[type] = await server.createSpace(fixture.name);
    await server.setPublicationPolicy(spaces[type], fixture.policy);
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaces[type], `${type} matrix publisher`);
    await publish(server.origin, owner.deviceToken, spaces[type], snapshot(type, fixture.name, fixture.tables));
  }
  const grants = Object.values(spaces).map((spaceId) => ({ spaceId, role: 'reader' }));
  const reader = await server.createUser('specialized-matrix-reader@example.test', 'reader-password-strong', grants);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const consoleErrors = [];
  const notFoundResponses = [];
  const manifest = { format: 'nodus.server-web-e2e-manifest', generatedAt: new Date().toISOString(), viewport: { desktop: [1440, 1000], mobile: [390, 844] }, spaces, routes: {}, details: {}, screenshots: [], diagnostics: { consoleErrors: [], notFoundResponses: [] }, themes: [] };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() === 404) notFoundResponses.push(response.url());
      if (response.status() >= 500) consoleErrors.push(`HTTP ${response.status()} ${response.url()}`);
    });
    await page.goto(`${server.origin}/login?next=/`, { waitUntil: 'networkidle' });
    await page.locator('#login-email').fill(reader.email);
    await page.locator('#login-password').fill(reader.password);
    await Promise.all([page.waitForURL(new RegExp(`${server.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`)), page.locator('button[type="submit"]').click()]);
    await page.getByTestId('overview-view').waitFor();

    const switchVault = async (type) => {
      await page.getByTestId('header-vault-badge').click();
      await page.getByTestId(`vault-option-${spaces[type]}`).click();
      await waitForSettled(page, 'overview-view');
      assert.equal(await page.getByTestId('app-shell').getAttribute('data-surface'), 'server');
    };
    const visit = async (type, [route, testId]) => {
      const privateRoute = testId === 'vault-private-surface';
      // Dedicated vault sidebars intentionally expose the same stable tour hook
      // as the generic sidebar, but not a test id (several items have alternate
      // labels in teaching/study mode). Resolve the visible navigation contract
      // through that shared hook and keep test ids reserved for renderers.
      await page.locator(`[data-tour="nav-${route}"]`).first().click();
      await waitForSettled(page, testId);
      const body = await page.locator('body').innerText();
      noFallback(body, privateRoute);
      if (privateRoute) {
        assert.equal(await page.getByTestId('vault-private-surface').count(), 1);
        assert.match(body, /Datos privados; no se muestran en el servidor/);
      }
      const key = `${type}:${route}`;
      manifest.routes[key] = { url: page.url(), renderer: testId, private: privateRoute, theme: await page.locator('html').getAttribute('data-theme'), viewport: [1440, 1000] };
      const file = path.join(output, `${type}-${route}-desktop.png`);
      await page.screenshot({ path: file, fullPage: true });
      manifest.routes[key].screenshot = path.relative(repoRoot, file);
      manifest.screenshots.push(path.relative(repoRoot, file));
    };
    const visitHome = async (type) => {
      await waitForSettled(page, 'overview-view');
      const body = await page.locator('body').innerText();
      noFallback(body, false);
      for (const label of homeMetrics[type]) assert.match(body, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${type} home must expose the specialised metric ${label}`);
      manifest.routes[`${type}:home`] = { url: page.url(), renderer: 'overview-view', metrics: homeMetrics[type], theme: await page.locator('html').getAttribute('data-theme'), viewport: [1440, 1000] };
      const file = path.join(output, `${type}-home-desktop.png`);
      await page.screenshot({ path: file, fullPage: true });
      manifest.screenshots.push(path.relative(repoRoot, file));
    };
    const visitPublishedDetail = async (type, route, surface, detailTestId, recordSelector = 'button') => {
      await switchVault(type);
      await page.locator(`[data-tour="nav-${route}"]`).first().click();
      const host = page.getByTestId(`vault-surface-${surface}`);
      await waitForSettled(page, `vault-surface-${surface}`);
      const record = recordSelector === 'button'
        ? host.locator('button').nth(1)
        : host.locator(recordSelector).first();
      await record.click();
      await waitForSettled(page, detailTestId);
      noFallback(await page.locator('body').innerText(), false);
      const detailUrl = page.url();
      assert.match(new URL(detailUrl).pathname, /^\/detail\//, `${type}/${route} must produce a canonical detail URL`);
      await page.reload({ waitUntil: 'networkidle' });
      await waitForSettled(page, detailTestId);
      noFallback(await page.locator('body').innerText(), false);
      assert.equal(page.url(), detailUrl, `${type}/${route} detail URL must survive a hard reload`);
      manifest.routes[`${type}:${route}:detail`] = { url: detailUrl, renderer: detailTestId, reloaded: true };
      await page.goBack({ waitUntil: 'networkidle' });
      await waitForSettled(page, `vault-surface-${surface}`);
    };
    const visitDirectPublishedDetail = async (type, detailPath, hostTestId, detailTestId) => {
      const waitForDetail = async () => {
        if (detailTestId.startsWith('text:')) {
          await page.getByText(detailTestId.slice('text:'.length), { exact: true }).first().waitFor();
        } else {
          await waitForSettled(page, detailTestId);
        }
      };
      await switchVault(type);
      await page.goto(`${server.origin}${detailPath}`, { waitUntil: 'networkidle' });
      await waitForSettled(page, hostTestId);
      await waitForDetail();
      noFallback(await page.locator('body').innerText(), false);
      const detailUrl = page.url();
      assert.equal(new URL(detailUrl).pathname, detailPath.split('?')[0], `${type} secondary detail must keep its canonical path`);
      await page.reload({ waitUntil: 'networkidle' });
      await waitForSettled(page, hostTestId);
      await waitForDetail();
      noFallback(await page.locator('body').innerText(), false);
      assert.equal(page.url(), detailUrl, `${type} secondary detail URL must survive a hard reload`);
      manifest.details[`${type}:${detailPath}`] = { url: detailUrl, renderer: detailTestId, reloaded: true };
      await page.goto(`${server.origin}/`, { waitUntil: 'networkidle' });
      await waitForSettled(page, 'overview-view');
    };
    for (const [type, entries] of Object.entries(routes)) {
      await switchVault(type);
      await visitHome(type);
      for (const entry of entries) await visit(type, entry);
      // Return to the actual home landmark before recording the themed home
      // capture. Without this, the screenshot filename says "home" while the
      // URL still points at the last sidebar route visited above.
      await page.goto(`${server.origin}/`, { waitUntil: 'networkidle' });
      await waitForSettled(page, 'overview-view');
      assert.equal(new URL(page.url()).pathname, '/', `${type} themed capture must be rooted at /`);
      assert.equal(await page.getByTestId('overview-view').count(), 1, `${type} themed capture must contain the home landmark`);
      const beforeTheme = await page.locator('html').getAttribute('data-theme');
      await page.getByTestId('theme-toggle').click();
      await page.waitForFunction((previous) => document.documentElement.getAttribute('data-theme') !== previous, beforeTheme);
      const theme = await page.locator('html').getAttribute('data-theme');
      assert.match(theme, /dark|light/);
      manifest.themes = [...new Set([...(manifest.themes || []), theme])];
      const themedShot = path.join(output, `${type}-home-${theme}.png`);
      await page.screenshot({ path: themedShot, fullPage: true });
      manifest.routes[`${type}:home:${theme}`] = { url: page.url(), renderer: 'overview-view', theme, viewport: [1440, 1000], screenshot: path.relative(repoRoot, themedShot) };
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${type} desktop view must not overflow horizontally`);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${type} mobile view must not overflow horizontally`);
      const mobileShot = path.join(output, `${type}-mobile.png`);
      await page.screenshot({ path: mobileShot, fullPage: true });
      manifest.screenshots.push(path.relative(repoRoot, mobileShot));
      await page.setViewportSize({ width: 1440, height: 1000 });
    }

    // A published study course must remain a reloadable deep-link, not just a
    // tab whose row happened to be present in the catalogue.
    await switchVault('estudio');
    await page.locator('[data-tour="nav-studyCourses"]').first().click();
    await waitForSettled(page, 'vault-surface-study-courses');
    // The first button is the catalogue tab itself; the first record is the
    // next button and should produce the canonical detail URL.
    await page.locator('[data-testid="vault-surface-study-courses"] button').nth(1).click();
    await waitForSettled(page, 'vault-surface-study-courses');
    const detailUrl = page.url();
    assert.match(detailUrl, /\/detail\/studyCourses\/study-courses\//);
    await page.reload({ waitUntil: 'networkidle' });
    await waitForSettled(page, 'vault-surface-study-courses');
    noFallback(await page.locator('body').innerText(), false);
    manifest.deepLink = { url: detailUrl, reloaded: true };

    // Exercise the richer dossier contracts as well as their catalogues. These
    // checks catch the old generic/raw-column fallback that looked fine until a
    // reader clicked a real record.
    await visitPublishedDetail('estudio', 'studyLibrary', 'study-materials', 'study-material-detail');
    await visitPublishedDetail('estudio', 'studyQuestions', 'study-questions', 'study-question-detail');
    await visitPublishedDetail('docencia', 'teachingExams', 'teaching-exams', 'exam-detail');
    await visitPublishedDetail('docencia', 'teachingRubrics', 'teaching-rubrics', 'rubric-detail');
    await visitPublishedDetail('databases', 'pages', 'database-pages', 'database-page-detail');
      await visitPublishedDetail('primary_sources', 'archive', 'archive-items', 'archive-item-dossier-rich', 'tbody tr');
      await visitPublishedDetail('testimonios', 'testimonyInterviews', 'testimony-interviews', 'testimony-interview-dossier', '[data-testid="vault-data-row"]');
      await visitPublishedDetail('testimonios', 'testimonyContrasts', 'testimony-contrasts', 'testimony-contrast-detail', '[data-testid="vault-data-row"]');
    await visitDirectPublishedDetail('databases', '/detail/databases/databases/database-1', 'vault-surface-databases', 'database-reader');
    await visitDirectPublishedDetail('prosopography', '/detail/prosopPopulation/prosopography-public-population/population%3Astudy-1', 'vault-surface-prosopography-persons', 'text:Estudio agregado');
    await visitDirectPublishedDetail('primary_sources', '/detail/archive/archive-repositories/repository-1', 'vault-surface-archive-items', 'archive-repository-detail');
    await visitDirectPublishedDetail('primary_sources', '/detail/archive/archive-units/unit-1', 'vault-surface-archive-items', 'archive-unit-detail');
    await visitDirectPublishedDetail('primary_sources', '/detail/archive/archive-excerpts/excerpt-1', 'vault-surface-archive-items', 'archive-excerpt-detail');
    await visitDirectPublishedDetail('primary_sources', '/detail/archive/source-analyses/analysis-1', 'vault-surface-archive-items', 'source-analysis-detail');
    await visitDirectPublishedDetail('testimonios', '/detail/testimonyInterviews/testimony-transcripts/transcript-1', 'vault-surface-testimony-interviews', 'testimony-transcript-detail');
    await visitDirectPublishedDetail('testimonios', '/detail/testimonyInterviews/testimony-codes/code-1', 'vault-surface-testimony-interviews', 'testimony-code-detail');
    manifest.diagnostics.consoleErrors = consoleErrors;
    manifest.diagnostics.notFoundResponses = notFoundResponses;
    await context.close();
  } finally {
    await browser.close();
    await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const unexpectedConsoleErrors = consoleErrors.filter((message) => !/Failed to load resource: the server responded with a status of 404 \(Not Found\)/i.test(message) && message !== 'not_found');
  assert.deepEqual(unexpectedConsoleErrors, [], `specialized matrix browser/server errors: ${unexpectedConsoleErrors.join(' | ')}`);
  assert.deepEqual(notFoundResponses, [], `specialized matrix unexpected 404 responses: ${notFoundResponses.join(' | ')}`);
  assert.deepEqual([...new Set(manifest.themes)].sort(), ['dark', 'light'], 'matrix must exercise both color themes');
  process.stdout.write(`specialized matrix passed: ${Object.keys(manifest.routes).length} routes\n`);
});
