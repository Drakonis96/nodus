// Visual and structural verification for the professional Deep Research and
// Immersion PDFs. Runs through the real Electron printToPDF engine and writes
// stable fixtures under tmp/pdfs for Poppler rendering/inspection.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-professional-pdf')) {
  execFileSync(
    path.join(root, 'node_modules/.bin/electron'),
    [path.join(root, 'scripts/verify-professional-report-pdf.mjs'), '--electron-professional-pdf'],
    { cwd: root, env: { ...process.env }, stdio: 'inherit' }
  );
  process.exit(0);
}

console.log('Professional PDF verification started.');

{
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(root, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}

const { app, BrowserWindow } = require('electron');
const { createCanvas } = require('@napi-rs/canvas');
const { buildDeepResearchPdfInput } = require(path.join(root, 'electron/export/writingWorkshopExport.ts'));
const { buildImmersionPdfInput } = require(path.join(root, 'electron/export/immersionExport.ts'));
const { professionalReportPdf } = require(path.join(root, 'electron/export/professionalReportPdf.ts'));

function coverDataUrl() {
  const canvas = createCanvas(1400, 760);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 1400, 760);
  gradient.addColorStop(0, '#18263b');
  gradient.addColorStop(0.55, '#315b67');
  gradient.addColorStop(1, '#d2ab70');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1400, 760);
  ctx.globalAlpha = 0.3;
  for (let i = 0; i < 22; i++) {
    const x = 80 + ((i * 223) % 1240);
    const y = 75 + ((i * 137) % 610);
    ctx.beginPath();
    ctx.arc(x, y, 7 + (i % 4) * 3, 0, Math.PI * 2);
    ctx.fillStyle = i % 3 === 0 ? '#f8e4ad' : '#a9e3d8';
    ctx.fill();
    if (i > 0) {
      const prevX = 80 + (((i - 1) * 223) % 1240);
      const prevY = 75 + (((i - 1) * 137) % 610);
      ctx.strokeStyle = '#e8eef5';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(prevX, prevY);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 54px Arial';
  ctx.fillText('ARCHIVO · MEMORIA · EVIDENCIA', 88, 680);
  return `data:image/jpeg;base64,${canvas.toBuffer('image/jpeg', 92).toString('base64')}`;
}

const abstract = 'Este informe examina cómo la memoria cultural se conserva, se transforma y se disputa cuando los testimonios, los archivos y las instituciones compiten por definir un relato compartido.';
const paragraph = 'La evidencia disponible sugiere que la memoria no funciona como un depósito estable, sino como una práctica social sometida a selección, mediación y reinterpretación. El análisis compara fuentes de distinta naturaleza y distingue con claridad entre los hechos documentados, las inferencias plausibles y las preguntas que siguen abiertas.';
const deepDraft = {
  generatedAt: '2026-07-23T10:00:00.000Z',
  brief: {
    kind: 'deep_research',
    objective: 'Analizar la relación entre archivo, memoria colectiva y transmisión cultural a partir del corpus académico.',
    audience: 'Investigadores y estudiantes de posgrado',
    tone: 'academic',
    language: 'es',
  },
  selection: { ideaIds: ['i1', 'i2'], themeIds: [], gapIds: [], contradictionIds: [], workIds: ['w1', 'w2'], passageIds: ['p1'], tutorRouteIds: [] },
  title: 'Memoria, evidencia y transmisión cultural',
  abstract,
  outline: [
    { id: 's1', title: 'El archivo como tecnología de selección', purpose: 'Delimitar qué conserva el archivo y qué queda fuera.', keyClaims: ['Toda colección responde a criterios institucionales.', 'La ausencia documental también constituye evidencia.'], sources: ['Assmann (2011)', 'Ricoeur (2000)'] },
    { id: 's2', title: 'Memoria colectiva y mediación', purpose: 'Explicar el papel de los marcos sociales.', keyClaims: ['La memoria se actualiza desde el presente.', 'Los soportes condicionan la transmisión.'], sources: ['Halbwachs (1950)'] },
    { id: 's3', title: 'Conflictos de interpretación', purpose: 'Comparar lecturas incompatibles sin borrar la incertidumbre.', keyClaims: ['La discrepancia debe permanecer visible.'], sources: ['Pasaje archivístico A', 'Pasaje archivístico B'] },
    { id: 's4', title: 'Implicaciones metodológicas', purpose: 'Proponer un protocolo de lectura trazable.', keyClaims: ['Separar dato, inferencia y valoración.'], sources: ['Matriz del corpus'] },
  ],
  draftMarkdown: `## Resumen\n\n${abstract}\n\n## 1. El archivo como tecnología de selección\n\n${paragraph} [Consultar la idea original](nodus://idea/i1).\n\n${paragraph}\n\n### 1.1 Presencias y ausencias\n\n${paragraph}\n\n> La ausencia de una voz en el archivo no demuestra su inexistencia; obliga a reconstruir las condiciones de conservación.\n\n${paragraph}\n\n## 2. Memoria colectiva y mediación\n\n${paragraph} [Abrir el pasaje citado](nodus://passage/p1).\n\n${paragraph}\n\n### 2.1 Soportes de transmisión\n\n${paragraph}\n\n- Testimonios orales y memorias personales.\n- Documentos institucionales y registros administrativos.\n- Reinterpretaciones públicas, educativas y familiares.\n\n${paragraph}\n\n## 3. Conflictos de interpretación\n\n${paragraph}\n\n${paragraph}\n\n### 3.1 Criterios de comparación\n\n${paragraph}\n\n${paragraph}\n\n## 4. Implicaciones metodológicas\n\n${paragraph}\n\n${paragraph}\n\n## Limitaciones\n\n- El corpus no representa por igual a todos los actores.\n- Algunas relaciones siguen siendo inferencias pendientes de contraste.\n\n## Referencias\n\n- Assmann, A. (2011). *Cultural Memory and Western Civilization*.\n- Halbwachs, M. (1950). *La mémoire collective*.\n- Ricoeur, P. (2000). *La mémoire, l’histoire, l’oubli*.`,
  matrix: [
    { claim: 'El archivo institucional selecciona y jerarquiza la evidencia.', role: 'context', sourceLabel: 'Idea: política del archivo', citation: 'nodus://idea/i1', evidence: 'Tres obras del corpus convergen en esta formulación.', notes: 'Contexto teórico.' },
    { claim: 'Los marcos sociales orientan el recuerdo individual.', role: 'support', sourceLabel: 'Pasaje de Halbwachs', citation: 'nodus://passage/p1', evidence: 'Cita literal localizada en la página 42.', notes: 'Evidencia primaria del argumento.' },
    { claim: 'La ausencia documental puede ser analíticamente significativa.', role: 'gap', sourceLabel: 'Hueco del corpus', citation: 'nodus://gap/g1', evidence: 'Cobertura desigual entre instituciones y testimonios.', notes: 'Debe tratarse como límite, no como conclusión.' },
  ],
  bibliography: ['Assmann (2011)', 'Halbwachs (1950)', 'Ricoeur (2000)'],
  nextSteps: ['Contrastar los pasajes clave con sus documentos originales.', 'Ampliar la búsqueda a testimonios no institucionales.', 'Registrar por separado hechos, inferencias y desacuerdos.'],
  limitations: ['Cobertura documental desigual.'],
  stats: { selectedIdeas: 2, selectedThemes: 1, selectedGaps: 1, selectedContradictions: 0, selectedWorks: 3, selectedPassages: 1, selectedTutorRoutes: 0, contextChars: 12000, truncated: false },
};

const citation = (id, title, text) => ({
  passageId: id,
  workId: `work-${id}`,
  workTitle: title,
  authors: ['María Ortega', 'Luis Ferrer'],
  year: 2021,
  zoteroKey: `ZOTERO${id.toUpperCase()}`,
  pageLabel: '42',
  text,
  whyItMatters: 'Permite separar la descripción documental de la interpretación posterior.',
  commentary: 'Conviene leer el fragmento atendiendo a quién produce el registro y para qué audiencia.',
});

const stations = [1, 2, 3].map((index) => ({
  id: `station-${index}`,
  title: ['Cómo leer un archivo', 'Memoria y marcos sociales', 'Comparar relatos en conflicto'][index - 1],
  question: ['¿Qué decisiones hacen visible o invisible una evidencia?', '¿Cómo transforma el presente aquello que una comunidad recuerda?', '¿Cómo comparar versiones incompatibles sin forzar una síntesis?'][index - 1],
  minutes: 20,
  context: paragraph,
  synthesis: `### Núcleo de la estación\n\n${paragraph}\n\n${paragraph} [Explorar la evidencia](nodus://passage/p${index}).\n\n### Método de lectura\n\n${paragraph}`,
  citations: [citation(`p${index}`, `Fuente documental ${index}`, 'El documento conserva una huella situada: registra una acción y, al mismo tiempo, el marco institucional desde el que esa acción fue descrita.')],
  positions: [
    { authorId: null, name: 'Perspectiva institucional', position: 'Subraya la continuidad y la autoridad del registro.', ideaIds: [] },
    { authorId: null, name: 'Perspectiva crítica', position: 'Examina los silencios, sesgos y exclusiones del archivo.', ideaIds: [] },
  ],
  takeaways: ['Toda fuente tiene condiciones de producción.', 'La discrepancia es información, no ruido.', 'Una conclusión debe conservar su enlace con la evidencia.'],
  ideaIds: [],
  quiz: [],
}));

const immersionSession = {
  id: 'immersion-professional-fixture',
  topic: 'Archivo, memoria y transmisión cultural',
  language: 'es',
  minutes: 60,
  model: null,
  plan: {
    topic: 'Archivo, memoria y transmisión cultural',
    title: 'Leer la memoria: una inmersión en archivos y relatos',
    language: 'es',
    minutes: 60,
    generatedAt: '2026-07-23T10:00:00.000Z',
    model: null,
    overview: `## Punto de partida\n\n${paragraph}\n\n${paragraph}\n\n## Ruta de aprendizaje\n\nLa inmersión avanza desde la lectura crítica del archivo hasta la comparación explícita de relatos y evidencias.`,
    keyTerms: [
      { term: 'Archivo', definition: 'Sistema de selección, descripción y conservación de documentos.' },
      { term: 'Memoria colectiva', definition: 'Reconstrucción social del pasado desde marcos compartidos.' },
      { term: 'Trazabilidad', definition: 'Capacidad de volver desde una afirmación hasta su evidencia.' },
      { term: 'Silencio documental', definition: 'Ausencia significativa producida por prácticas de registro o conservación.' },
    ],
    stations,
    contrasts: {
      authors: ['Institucional', 'Crítica', 'Pragmática'],
      rows: [
        { stationId: 'station-1', question: '¿Qué representa el archivo?', cells: [{ author: 'Institucional', authorId: null, stance: 'Continuidad documental.', ideaIds: [] }, { author: 'Crítica', authorId: null, stance: 'Selección atravesada por poder.', ideaIds: [] }, { author: 'Pragmática', authorId: null, stance: 'Infraestructura para verificar afirmaciones.', ideaIds: [] }] },
        { stationId: 'station-2', question: '¿Cómo cambia la memoria?', cells: [{ author: 'Institucional', authorId: null, stance: 'Mediante nuevas incorporaciones.', ideaIds: [] }, { author: 'Crítica', authorId: null, stance: 'Por disputas sobre visibilidad.', ideaIds: [] }, { author: 'Pragmática', authorId: null, stance: 'Al revisar hipótesis con nueva evidencia.', ideaIds: [] }] },
      ],
    },
    frontiers: [
      { kind: 'thin_coverage', statement: 'Cobertura desigual de voces no institucionales', detail: 'El corpus conserva más documentación administrativa que testimonios personales.', workTitle: 'Colección principal' },
      { kind: 'gap', statement: 'Falta una comparación longitudinal', detail: 'Sería necesario observar cómo cambia el mismo relato en varias generaciones.', workTitle: null },
    ],
    exam: { questions: [], feynman: 'Explica con tus propias palabras por qué un archivo no es un espejo neutral del pasado y describe un procedimiento concreto para enlazar cada interpretación con su evidencia.' },
    graph: { nodes: [], edges: [] },
    ideaIndex: [],
    stats: { stations: 3, ideas: 12, works: 3, authors: 6, citations: 3, quizQuestions: 0 },
    stoppedReason: null,
  },
  progress: { currentStep: 0, furthestStep: 0, completedSteps: [], answers: [], startedAt: null, finishedAt: null },
  image: null,
  createdAt: '2026-07-23T10:00:00.000Z',
  updatedAt: '2026-07-23T10:00:00.000Z',
};

const keepAlive = setInterval(() => undefined, 1_000);
app.whenReady().then(async () => {
  const keeper = new BrowserWindow({ show: false });
  try {
    const output = path.join(root, 'tmp/pdfs');
    fs.mkdirSync(output, { recursive: true });
    const image = { dataUrl: coverDataUrl(), credit: 'Imagen de portada generada por IA en Nodus.' };
    const deepInput = buildDeepResearchPdfInput(deepDraft, undefined, image);
    const immersionInput = buildImmersionPdfInput(immersionSession, image);
    const deepBytes = await professionalReportPdf(deepInput);
    const immersionBytes = await professionalReportPdf(immersionInput);
    const deepPath = path.join(output, 'deep-research-professional-sample.pdf');
    const immersionPath = path.join(output, 'immersion-professional-sample.pdf');
    fs.writeFileSync(deepPath, deepBytes);
    fs.writeFileSync(immersionPath, immersionBytes);
    for (const [label, file, bytes] of [['Deep Research', deepPath, deepBytes], ['Immersion', immersionPath, immersionBytes]]) {
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`${label} did not produce a PDF`);
      console.log(`${label}: ${file} (${Math.round(bytes.length / 1024)} KB)`);
    }
    keeper.destroy();
    clearInterval(keepAlive);
    app.exit(0);
  } catch (error) {
    console.error(error);
    keeper.destroy();
    clearInterval(keepAlive);
    app.exit(1);
  }
});
