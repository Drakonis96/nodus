import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const require = createRequire(import.meta.url);

test('public database forms have explicit locale-aware chrome', () => {
  const source = read('electron/automation/formServer.ts');
  for (const language of languages) assert.match(source, new RegExp(`^  ['\\"]?${language.replace('-', '\\-')}['\\"]?:`, 'm'));
  assert.match(source, /<html lang="\$\{language\}/);
  assert.match(source, /Accept-Language/);
  assert.match(source, /split\(';', 1\)/);
  assert.doesNotMatch(source, /<html lang="es"/);
});

test('document exporters carry the selected language and neutral title fallback', () => {
  const docs = read('electron/toolkit/convert/docs.ts');
  const pdf = read('electron/toolkit/convert/renderPdf.ts');
  const ocr = read('electron/toolkit/aiOcr/export.ts');
  const ocrIndex = read('electron/toolkit/aiOcr/index.ts');
  const toolkitIpc = read('electron/ipc/toolkit.ts');
  assert.match(docs, /wrapHtml\(String\(html \?\? ''\), 'Document', ctx\.request\.language \?\? 'en'\)/);
  assert.match(docs, /<dc:language>\$\{escapeHtml\(language\)\}<\/dc:language>/);
  assert.match(pdf, /<html lang="\$\{language\}"/);
  assert.match(ocr, /<html lang="\$\{escapeHtml\(language\)\}"/);
  assert.match(ocr, /\|\| 'Document'/);
  assert.match(ocrIndex, /export async function buildOcrExport\(id: string, format: AiOcrExportFormat, language = 'en'\)/);
  assert.match(toolkitIpc, /buildOcrExport\(id, format, getSettings\(\)\.uiLanguage\)/);
  assert.doesNotMatch(docs, /<dc:language>es<\/dc:language>/);
});

test('server PDF headings and debate payloads are locale-safe', () => {
  const pdf = read('server/lib/core/deepResearchPdf.mjs');
  const debates = read('server/lib/core/debates.mjs');
  const corpus = read('server/lib/routes/corpus.mjs');
  const graph = read('electron/graph/graphService.ts');
  for (const language of languages) assert.match(pdf, new RegExp(`^  ['\\"]?${language.replace('-', '\\-')}['\\"]?:`, 'm'));
  assert.match(pdf, /language \} = \{\}/);
  assert.match(debates, /tensionKey:/);
  assert.match(debates, /tensionParams:/);
  assert.match(graph, /tensionKey:/);
  assert.match(graph, /tensionParams:/);
  assert.match(corpus, /headlineKey: `continuity\.\$\{checkId\}\.headline`/);
  assert.match(corpus, /reasonKey: data\.ideas\.length/);
  assert.match(corpus, /titleKey: `reading\.phase\.\$\{id\}\.title`/);
});

test('known runtime boundaries translate cancellation and connector failures', () => {
  const source = read('shared/uiLanguage.ts');
  assert.match(source, /Transcripción cancelada\./);
  assert.match(source, /Detección de hablantes cancelada\./);
  assert.match(source, /No se encontró el conector integrado\./);
  assert.match(source, /Transcription cancelled\./);
  assert.match(source, /Speaker detection cancelled\./);
  assert.match(read('src/components/testimonies/InterviewSessions.tsx'), /localizeRuntimeError\(/);
});

test('residual renderer boundaries localise app, audio, diarization and queue errors', async () => {
  const preview = read('src/toolkitApps/AppPreview.tsx');
  const audio = read('src/components/AudioPanel.tsx');
  const speaker = read('src/components/testimonies/SpeakerDetection.tsx');
  const character = read('src/components/CharacterInterviewModal.tsx');
  const queue = read('src/components/DeepResearchQueueStrip.tsx');
  assert.match(preview, /t\('La app ha alcanzado su límite de almacenamiento \(256 KB\)\.'/);
  assert.match(preview, /t\('El almacenamiento no está activado\.'/);
  assert.match(preview, /t\('La clave o el dato no son válidos\.'/);
  assert.match(audio, /localizeRuntimeError\(job\.error, getActiveLang\(\)\)/);
  assert.match(speaker, /localizeRuntimeError\(/);
  assert.match(character, /new Error\(t\('Conversación no encontrada\.'\)\)/);
  assert.match(character, /setError\(errorText\(err\)\)/);
  assert.match(queue, /item\.title === 'Informe sin título' \? t\(item\.title\)/);

  const outfile = path.join(os.tmpdir(), `nodus-residual-i18n-${process.pid}.cjs`);
  await build({ entryPoints: [path.join(root, 'shared/uiLanguage.ts')], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  try {
    const { localizeRuntimeError } = require(outfile);
    const messages = [
      'Fallo al sintetizar el audio.',
      'El worker de audio falló.',
      'La voz de Hume seleccionada ya no está disponible.',
      'eSpeak NG devolvió una respuesta sin fonemas',
      'eSpeak NG terminó sin devolver fonemas',
      'Error del fonetizador español de eSpeak NG: wasm stderr',
      'Proveedor de audio no soportado en el worker: piper',
    ];
    for (const language of languages.filter((value) => value !== 'es')) {
      for (const message of messages) {
        const translated = localizeRuntimeError(message, language);
        assert.notEqual(translated, message, `${language} leaked a residual runtime error`);
      }
      assert.match(localizeRuntimeError(messages[5], language), /wasm stderr/);
    }
  } finally {
    fs.rmSync(outfile, { force: true });
  }
});

test('study AI policy errors are localised at the runtime boundary', async () => {
  const outfile = path.join(os.tmpdir(), `nodus-ui-language-${process.pid}.cjs`);
  await build({ entryPoints: [path.join(root, 'shared/uiLanguage.ts')], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  try {
    const { localizeRuntimeError } = require(outfile);
    const messages = [
      'Las funciones de IA del vault de estudio están desactivadas en Ajustes.',
      'El modo local («solo modelos locales») impide usar OpenAI.',
      'El modo externo requiere un proveedor remoto; Ollama es local.',
      'Esta asignatura está excluida del procesamiento externo. Usa un modelo local o elimina la exclusión en Ajustes.',
      'La solicitud supera el límite configurado de 12.345 caracteres.',
      'Se ha alcanzado el presupuesto mensual de IA para estudio.',
      'Envío externo cancelado por el usuario.',
      'E2E: proveedor de IA no disponible.',
      'No fue posible completar la tarea de IA.',
    ];
    for (const language of languages.filter((value) => value !== 'es')) {
      for (const message of messages) {
        const translated = localizeRuntimeError(message, language);
        assert.notEqual(translated, message, `${language} leaked a study AI error`);
        assert.doesNotMatch(translated, /\b(ajustes|usuario|tarea|solicitud|presupuesto|asignatura)\b/i, `${language} retained Spanish in ${translated}`);
      }
    }
  } finally {
    fs.rmSync(outfile, { force: true });
  }
});

test('Compass has native copy for every supported locale', async () => {
  const outfile = path.join(os.tmpdir(), `nodus-compass-i18n-${process.pid}.cjs`);
  await build({ entryPoints: [path.join(root, 'src/i18n.compass.ts')], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  try {
    const tables = require(outfile);
    const allowSame = new Set(['Nodus Compass']);
    for (const name of ['FR', 'DE', 'PT', 'PT_BR', 'IT', 'TR']) {
      for (const key of Object.keys(tables.EN)) {
        assert.ok(tables[name][key], `${name} is missing Compass key ${key}`);
        if (!allowSame.has(key)) assert.notEqual(tables[name][key], tables.EN[key], `${name} inherits English copy for ${key}`);
      }
    }
  } finally {
    fs.rmSync(outfile, { force: true });
  }
});
