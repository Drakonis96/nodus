// Optional low-cost live smoke for the shared Deep Research prose contract.
// The key is read only from GEMINI_API_KEY, removed from process.env immediately,
// never printed and never written to disk. It makes two Flash Lite calls.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import OpenAI from 'openai';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiKey = process.env.GEMINI_API_KEY?.trim();
assert.ok(apiKey, 'Define GEMINI_API_KEY en el entorno efímero para ejecutar este smoke.');
delete process.env.GEMINI_API_KEY;

const temp = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-research-narrative-'));
try {
  const coreBundle = path.join(temp, 'deepResearchCore.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/deepResearchCore.ts')],
    outfile: coreBundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['@shared/*'],
    logLevel: 'silent',
  });
  const { DEEP_RESEARCH_NARRATIVE_RULES, normalizeNarrativeSection, countWords } = await import(
    `${pathToFileURL(coreBundle).href}?t=${Date.now()}`
  );
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  });
  const model = 'gemini-2.5-flash-lite';
  const rules = DEEP_RESEARCH_NARRATIVE_RULES.join('\n');

  const planResponse = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Planifica un informe académico en español. Usa como máximo cuatro secciones amplias. No crees una sección por idea. Los títulos no deben llevar dos puntos, punto y coma ni guion largo. Devuelve JSON con {"sections":[{"title":"...","purpose":"..."}]}.\n${rules}`,
      },
      {
        role: 'user',
        content: 'Objetivo: explicar cómo cambian la memoria, la lectura y la escritura cuando una herramienta organiza conocimiento mediante grafos. Integra contexto, mecanismos, límites, consecuencias metodológicas y síntesis.',
      },
    ],
  });
  const plan = JSON.parse(planResponse.choices[0]?.message?.content || '{}');
  assert.ok(Array.isArray(plan.sections), 'Gemini devolvió un plan JSON con secciones.');
  assert.ok(plan.sections.length >= 3 && plan.sections.length <= 4, `El plan debe tener 3–4 secciones, no ${plan.sections.length}.`);

  const sectionTitle = String(plan.sections[1]?.title ?? plan.sections[0]?.title ?? 'Desarrollo argumental');
  const sectionResponse = await client.chat.completions.create({
    model,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: `Escribe una sola sección académica de 500–700 palabras titulada «${sectionTitle}». Desarrolla un argumento continuo en cinco o seis párrafos. Incluye y relaciona organización conceptual, memoria externa, lectura crítica, sesgos de selección y límites metodológicos. Empieza únicamente con "## ${sectionTitle}".\n${rules}`,
      },
      { role: 'user', content: 'La sección debe demostrar continuidad lógica y evitar cortes artificiales.' },
    ],
  });
  const raw = sectionResponse.choices[0]?.message?.content?.trim() ?? '';
  const normalized = normalizeNarrativeSection(raw, sectionTitle);
  const headingCount = (normalized.match(/^#{1,6}\s/gmu) ?? []).length;
  const disruptivePunctuation = (raw.match(/[:;—]/gu) ?? []).length;
  const words = countWords(normalized);

  assert.equal(headingCount, 1, 'El postprocesado debe conservar un único epígrafe.');
  assert.ok(words >= 350, `La sección debe ser sustantiva, no breve (${words} palabras).`);
  assert.ok(disruptivePunctuation <= 8, `Uso excesivo de dos puntos, punto y coma o guion largo (${disruptivePunctuation}).`);
  console.log(JSON.stringify({ model, planSections: plan.sections.length, headingCount, words, disruptivePunctuation }));
} finally {
  await rm(temp, { recursive: true, force: true });
}
