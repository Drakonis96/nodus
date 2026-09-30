/** Live verification of the complete study guide ("Guía de estudio completa").
 *
 * The real engine (electron/ai/completeGuide/core.ts), the real premise audit and the
 * real exports run headlessly in Node over a seeded synthetic corpus: chemistry (two
 * units, formulas, conditions, \ce{}, a table, a figure caption, slides and a note
 * that contradicts them), history (no scientific categories, a lecture transcript)
 * and a fourth, highly relevant material that is deliberately excluded. Every paid
 * call goes through the shared cost-reserving proxy and ledger of the campaign root
 * (scripts/research-provider-proxy.mjs): chat with DeepSeek `deepseek-flash`,
 * embeddings with OpenRouter `baai/bge-m3`.
 *
 * Real providers:  DEEPSEEK_API_KEY=… OPENROUTER_API_KEY=… node scripts/verify-complete-guide-live.mjs
 *                  (or: electron scripts/with-nodus-keys.cjs --providers deepseek,openrouter -- node scripts/verify-complete-guide-live.mjs)
 * Simulated:       node scripts/verify-complete-guide-live.mjs --simulated
 *                  (proxy, ledger, JSON parsing, validators, audit and exports are real;
 *                  the upstream answers come from a scripted model, so only the mechanics
 *                  are exercised)
 * Options:         --campaign-root=<dir> (default: a fresh isolated root)
 *                  --limit-usd=4.8 (the run stops before the ledger reaches it; the
 *                  ledger itself is authorized for USD 5)
 *                  --out=<metrics.json> (default: <root>/artifacts/complete-guide-metrics.json)
 *
 * Checks: every readable passage is read; the twelve seeded facts reach the guide with
 * their exact page or slide; the excluded material and its unique fact never appear;
 * no AI block cites a material; the AI notice is printed in full once and every AI block
 * carries the short mark; at most one AI box per section; definitions, rules and formulas
 * are prose, not boxes; most of the words are outside a box; every chapter opens with its
 * chronology (when it has dates) and a summary and ends with its questions; all LaTeX
 * compiles; the review sheet carries formulas;
 * PDF, review-sheet PDF, DOCX (native equations) and Markdown exports are produced (with
 * PNG snapshots for visual review); a second version reuses ≥ 90 % of the reading
 * passes; the pre-run estimate is ≥ the real cost. Exits 1 when a check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import AdmZip from 'adm-zip';
import { createResearchTestRoot } from './research-isolation.mjs';
import { startResearchProviderProxy } from './research-provider-proxy.mjs';

const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const simulated = process.argv.includes('--simulated');
const limitUsd = Number(argument('limit-usd') ?? 4.8);
const LEDGER_LIMIT_USD = 5;
const CHAT_MODEL = 'deepseek-flash';
const EMBEDDING_MODEL = 'baai/bge-m3';
const PRICE = { input: 0.3, output: 1.2 };
/** DeepSeek Flash thinks by default and its thinking tokens count against `max_tokens`, so
 * the application adds an output allowance on top of the visible answer before it sends a
 * call (electron/ai/thinkingEffort.ts#thinkingOutputAllowance: 8,192 at the low effort these
 * structured passes run at, "a larger max_tokens is a ceiling, not a target"). Sending the
 * bare bound instead made the claim audit's batches hit the cap on every call, and the audit
 * answers truncation by bisecting the batch, so the campaign paid several times the calls the
 * application pays for the same work and measured a cost no user would ever incur. */
const DEEPSEEK_THINKING_ALLOWANCE = 8_192;
if (!(limitUsd > 0 && limitUsd < LEDGER_LIMIT_USD)) throw new Error(`--limit-usd must be below the USD ${LEDGER_LIMIT_USD} authorization`);
const keys = simulated ? { deepseek: 'simulated', openrouter: 'simulated' } : { deepseek: process.env.DEEPSEEK_API_KEY, openrouter: process.env.OPENROUTER_API_KEY };
if (!keys.deepseek || !keys.openrouter) throw new Error('A real run needs DEEPSEEK_API_KEY and OPENROUTER_API_KEY (or pass --simulated)');

// ---------------------------------------------------------------- modules

const require_ = createRequire(import.meta.url);
const harness = { completeJson: null };
globalThis.__completeGuideLiveHarness = harness;
/** The audit's real prompts and logic, with the Electron model client replaced by this harness. */
const shims = {
  name: 'complete-guide-live-shims',
  setup(builder) {
    builder.onResolve({ filter: /^\.\/(aiClient|thinkingEffort)$/ }, (args) => (args.importer.endsWith(path.join('electron', 'ai', 'researchClaimAudit.ts')) ? { path: args.path.slice(2), namespace: 'live-shim' } : undefined));
    builder.onLoad({ filter: /.*/, namespace: 'live-shim' }, (args) => ({
      loader: 'js',
      contents: args.path === 'aiClient'
        ? 'export class AiError extends Error { constructor(code, message) { super(message ?? code); this.code = code; } }\nexport const completeJson = (...args) => globalThis.__completeGuideLiveHarness.completeJson(...args);'
        : 'export const currentJobThinkingEffort = () => undefined;',
    }));
  },
};
async function load(entry, external = []) {
  const built = await build({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', tsconfig: 'electron/tsconfig.json', logLevel: 'error', external, plugins: [shims] });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, require_);
  return module.exports;
}
const core = await load('electron/ai/completeGuide/core.ts');
const prompts = await load('electron/ai/completeGuide/prompts.ts');
const audit = await load('electron/ai/researchClaimAudit.ts');
const { buildCompleteGuideSnapshot } = await load('shared/completeGuide/snapshot.ts');
const { resolveCompleteGuideSelection } = await load('shared/completeGuide/selection.ts');
const { normalizeCompleteGuideConfig } = await load('shared/completeGuide/types.ts');
const { estimateCompleteGuide } = await load('shared/completeGuide/estimate.ts');
const { invalidMath, strayDollar } = await load('shared/completeGuide/math.ts');
const { completeGuideReportInput, completeGuideReviewSheetHtml, completeGuideMarkdown } = await load('shared/completeGuide/reportInput.ts');
const { completeGuideLabels } = await load('shared/completeGuide/labels.ts');
const { guideShape } = await load('shared/completeGuide/shape.ts');
const { renderProfessionalReportHtml } = await load('shared/professionalReport.ts');
const { completeGuideDocx } = await load('electron/export/completeGuideDocx.ts', ['docx']);

// ---------------------------------------------------------------- corpus

const scope = (extra) => ({ courseId: null, subjectId: null, folderId: null, topicId: null, ...extra });
const organization = {
  courses: [{ id: 'bach', name: '2.º Bachillerato', position: 0 }],
  subjects: [{ id: 'chem', name: 'Química', courseId: 'bach', position: 0 }, { id: 'hist', name: 'Historia de España', courseId: 'bach', position: 1 }],
  folders: [],
  topics: [
    { id: 't1', name: 'Tema 1 · Los gases', subjectId: 'chem', folderId: null, parentId: null, position: 0 },
    { id: 't2', name: 'Tema 2 · Ácidos y bases', subjectId: 'chem', folderId: null, parentId: null, position: 1 },
    { id: 'h1', name: 'Tema 7 · La Restauración', subjectId: 'hist', folderId: null, parentId: null, position: 0 },
  ],
};
const pages = (list, marker = 'p') => list.map((text, index) => `[[${marker}. ${index + 1}]]\n${text}`).join('\n\n');
const CORPUS = [
  { sourceKey: 'material:gases', kind: 'material', title: 'Tema 1 · Gases ideales (apuntes)', topicId: 't1', text: pages([
    'Tema 1. Los gases. Variables de estado. La presión se define como la fuerza por unidad de superficie y en el SI se mide en pascales (Pa). La ley de Boyle establece que, a temperatura constante, el producto de la presión por el volumen permanece constante: $P_1 V_1 = P_2 V_2$.',
    'La ecuación de los gases ideales es $PV = nRT$, donde R es la constante universal de los gases, que vale 0,082 atm·L/(mol·K). Esta ecuación solo es válida a baja presión y alta temperatura.\n\nTabla 1. Unidades de presión\n\n| Unidad | Equivalencia |\n| --- | --- |\n| 1 atm | 101325 Pa |\n| 1 atm | 760 mmHg |',
    'Ejemplo resuelto: 2 mol de un gas ideal a 300 K ocupan 10 L. Aplicando PV = nRT, la presión es P = (2 · 0,082 · 300) / 10 = 4,92 atm. Error frecuente: usar grados Celsius en lugar de kelvin; recuerda que T(K) = T(°C) + 273,15.',
    'Figura 1.2. Isotermas de un gas ideal en un diagrama P-V: cada curva corresponde a una temperatura constante y es una hipérbola.',
  ]) },
  { sourceKey: 'material:acids', kind: 'material', title: 'Tema 2 · Ácidos y bases (diapositivas)', topicId: 't2', text: pages([
    'Ácidos y bases de Brønsted-Lowry. Un ácido es una especie que cede protones (H+) y una base es una especie que los acepta.',
    'El pH se define como $pH = -\\log[H_3O^+]$. A 25 °C el producto iónico del agua vale $K_w = 1{,}0 \\cdot 10^{-14}$, y el agua pura tiene pH 7 solo a 25 °C.',
    'Reacción de neutralización: $\\ce{HCl + NaOH -> NaCl + H2O}$. Un ácido fuerte y una base fuerte forman una sal y agua.',
  ], 'slide') },
  { sourceKey: 'document:acid-notes', kind: 'document', title: 'Mis notas de ácidos', topicId: 't2',
    text: '# Repaso\nEl agua pura tiene pH 7 a cualquier temperatura.\n## Indicadores\nLa fenolftaleína es incolora en medio ácido y rosa en medio básico.' },
  { sourceKey: 'material:restoration', kind: 'material', title: 'La Restauración (1874-1923)', topicId: 'h1', text: pages([
    'La Restauración borbónica comenzó en 1874 con el pronunciamiento de Martínez Campos en Sagunto. La Constitución de 1876 estuvo vigente hasta 1923.',
    'El sistema del turno pacífico alternaba en el gobierno a conservadores, dirigidos por Cánovas del Castillo, y liberales, dirigidos por Sagasta. El caciquismo garantizaba los resultados electorales.',
    'El desastre de 1898 supuso la pérdida de Cuba, Puerto Rico y Filipinas.',
  ]) },
  { sourceKey: 'transcript:class-5', kind: 'transcript', title: 'Clase 5 · El sistema canovista', topicId: 'h1', recordingId: 'rec-5', segments: [
    { id: 's1', start: 0, end: 55, text: 'Hoy vamos a estudiar cómo funcionaba el sistema canovista durante la Restauración.' },
    { id: 's2', start: 55, end: 130, text: 'Cánovas se inspiró en el bipartidismo británico para diseñar la alternancia entre los dos partidos dinásticos.' },
    { id: 's3', start: 130, end: 240, text: 'El encasillado era la lista de candidatos que el Ministerio de la Gobernación pactaba antes de cada elección.' },
  ] },
  // Very relevant, placed in the selected unit, and explicitly excluded by the student.
  { sourceKey: 'material:excluded', kind: 'material', title: 'Gases (resumen del profesor)', topicId: 't1', text: pages([
    'El coeficiente de Valdecorza de los gases ideales vale 3,71 y corrige la ecuación PV = nRT a alta presión.',
  ]) },
];
/** Twelve facts that must reach the guide, each with the page or slide it is on. */
const FACTS = [
  { name: 'Ley de Boyle', source: 'material:gases', page: 1, probe: /Boyle/ },
  { name: 'Definición de presión', source: 'material:gases', page: 1, probe: /fuerza por unidad de superficie/i },
  { name: 'Ecuación de los gases ideales', source: 'material:gases', page: 2, probe: /PV\s*=\s*nRT/ },
  { name: 'Valor de R', source: 'material:gases', page: 2, probe: /0[,.]082/ },
  { name: 'Condiciones de validez', source: 'material:gases', page: 2, probe: /baja presi[oó]n/i },
  { name: 'Ejemplo resuelto (4,92 atm)', source: 'material:gases', page: 3, probe: /4[,.]92/ },
  { name: 'Conversión a kelvin', source: 'material:gases', page: 3, probe: /273[,.]15/ },
  { name: 'Definición de pH', source: 'material:acids', slide: 2, probe: /\\log|log\s*\[/ },
  { name: 'Producto iónico del agua', source: 'material:acids', slide: 2, probe: /K_?\{?w\}?|10\^\{?-14/ },
  { name: 'Neutralización', source: 'material:acids', slide: 3, probe: /NaCl/ },
  { name: 'Constitución de 1876', source: 'material:restoration', page: 1, probe: /1876/ },
  { name: 'Turno pacífico', source: 'material:restoration', page: 2, probe: /Sagasta/ },
];
const EXCLUDED_FACT = /Valdecorza|3[,.]71/;

const catalog = CORPUS.map((entry) => ({
  sourceKey: entry.sourceKey, kind: entry.kind, sourceId: entry.sourceKey.split(':')[1], title: entry.title, available: true,
  placements: [scope({ courseId: 'bach', subjectId: organization.topics.find((topic) => topic.id === entry.topicId).subjectId, topicId: entry.topicId })],
  ...(entry.recordingId ? { recordingId: entry.recordingId, transcriptKind: 'corrected' } : {}),
}));
const configFor = (runId) => normalizeCompleteGuideConfig({ runId, aiExamples: true, verification: 'standard',
  instructions: 'Explica paso a paso y con ejemplos; prioriza las fórmulas y sus condiciones.',
  selection: { nodes: [{ kind: 'subject', id: 'chem' }, { kind: 'topic', id: 'h1' }], excludedSourceKeys: ['material:excluded'] } });
const resolved = resolveCompleteGuideSelection(configFor('cg-live-a').selection, catalog, organization);
const snapshot = buildCompleteGuideSnapshot(resolved.sources.map((source) => {
  const entry = CORPUS.find((candidate) => candidate.sourceKey === source.sourceKey);
  return { source, updatedAt: '2026-09-28T00:00:00.000Z', ...(entry.segments ? { segments: entry.segments } : { text: entry.text }) };
}), organization);

// ---------------------------------------------------------------- campaign root, proxy, ledger

const root = argument('campaign-root') ? fs.realpathSync(argument('campaign-root')) : createResearchTestRoot();
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const ledgerFile = path.join(artifacts, 'cost-ledger.json');
if (!fs.existsSync(ledgerFile)) fs.writeFileSync(ledgerFile, JSON.stringify({ limitUsd: LEDGER_LIMIT_USD, calls: [] }), { mode: 0o600 });
const ledgerUsd = () => JSON.parse(fs.readFileSync(ledgerFile, 'utf8')).calls.reduce((sum, call) => sum + (call.actualUsd ?? call.maximumUsd ?? 0), 0);
const startingLedgerUsd = ledgerUsd();
if (startingLedgerUsd >= limitUsd) throw new Error(`The ledger already holds $${startingLedgerUsd.toFixed(4)} of the $${limitUsd} limit`);
const proxy = await startResearchProviderProxy(root, simulated ? { dispatch: scriptedUpstream().dispatch } : {});

// ---------------------------------------------------------------- model client

const metrics = { calls: [], stages: {}, refusals: {} };
let currentStage = 'verify';
let currentRun = 'first';
class BudgetExhausted extends Error { constructor() { super('budget_exhausted'); this.code = 'budget_exhausted'; } }
function guardBudget(maxTokens, chars) {
  const bound = ((chars / 3 * PRICE.input + maxTokens * PRICE.output) / 1e6) * 1.25 + 0.002;
  if (ledgerUsd() + bound >= limitUsd) throw new BudgetExhausted();
}
function parseJson(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const start = trimmed.search(/[[{]/);
  return JSON.parse(start > 0 ? trimmed.slice(start) : trimmed);
}
/** The application's client asks for `response_format: json_object` on every structured
 * call and answers a refusal of the optional body by replaying the request once without
 * it (aiClient's `optionalBody` + `replayRefusedOptionalFields`, with the same
 * `rejectsOptionalTransportField` rule). DeepSeek answers that refusal — a 400 naming
 * `response_format` — whenever the prompt does not contain the word "json", and the claim
 * audit's prompt does not: without the replay every audit call dies, the guide's
 * verification pass silently does nothing and the sentences it counts as removed are the
 * whole block. A refusal was rejected before running, so it is never charged and the
 * replay costs one round trip, not money. */
const OPTIONAL_FIELD_REJECTION = /(?:unknown|unrecognized|unsupported|not supported|extra|invalid)\s+(?:field|parameter|argument)|response_format|reasoning_effort|include_reasoning|provider\.only|allow_fallbacks/i;
async function chat({ system, user, maxTokens, temperature }, validate, stage = currentStage) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    let body;
    const request = (jsonMode) => JSON.stringify({
      model: CHAT_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: Math.min(32_768, Math.max(256, maxTokens) + DEEPSEEK_THINKING_ALLOWANCE), temperature: temperature ?? 0, ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });
    // One refused round trip, not a model retry: the second request carries no JSON mode.
    for (let replays = 0; ; replays += 1) {
      guardBudget(maxTokens, system.length + user.length);
      const started = performance.now();
      response = await fetch(`${proxy.url}/deepseek/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keys.deepseek}` },
        body: request(replays === 0),
      });
      body = await response.json().catch(() => ({}));
      const usage = body.usage ?? {};
      const record = { run: currentRun, stage, status: response.status, inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0, cachedTokens: usage.prompt_cache_hit_tokens ?? 0, ms: Math.round(performance.now() - started) };
      record.usd = (record.inputTokens * PRICE.input + record.outputTokens * PRICE.output) / 1e6;
      metrics.calls.push(record);
      if (replays === 0 && (response.status === 400 || response.status === 422) && OPTIONAL_FIELD_REJECTION.test(JSON.stringify(body))) {
        metrics.refusals[currentRun] = (metrics.refusals[currentRun] ?? 0) + 1;
        continue;
      }
      break;
    }
    if (!response.ok) {
      if (/research_cost|budget/i.test(JSON.stringify(body))) throw new BudgetExhausted();
      if (attempt === 0 && response.status >= 500) continue;
      throw new Error(`chat_failed_${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
    }
    const content = body.choices?.[0]?.message?.content ?? '';
    if (body.choices?.[0]?.finish_reason === 'length') {
      const error = new Error('output_truncated'); error.code = 'output_truncated';
      if (attempt === 0) continue;
      throw error;
    }
    try {
      const value = parseJson(content);
      if (!validate || validate(value)) return value;
    } catch { /* retried once below */ }
  }
  throw new Error(`invalid_model_json (${stage})`);
}
harness.completeJson = (request, validate) => chat(request, validate);
async function embed(texts) {
  guardBudget(0, texts.join(' ').length);
  const response = await fetch(`${proxy.url}/openrouter/embeddings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keys.openrouter}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, encoding_format: 'float' }),
  });
  const body = await response.json().catch(() => ({}));
  metrics.calls.push({ run: currentRun, stage: 'embed', status: response.status, inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: 0, usd: (body.usage?.prompt_tokens ?? 0) * 0.01 / 1e6 });
  if (!response.ok) return texts.map(() => null);
  const vectors = texts.map(() => null);
  for (const entry of body.data ?? []) if (Array.isArray(entry.embedding)) vectors[entry.index] = entry.embedding;
  return vectors;
}

// ---------------------------------------------------------------- runs

const cache = new Map();
function deps(checkpoints) {
  const auditor = audit.createResearchProseAuditor(null);
  return {
    json: (call) => { currentStage = call.stage; return chat(call, call.validate, call.stage); },
    embed,
    audit: async (markdown, sources) => {
      currentStage = 'verify';
      const result = await auditor.audit(markdown, sources);
      const removed = result.claims.filter((claim) => claim.status !== 'supported' && !(claim.kind === 'nonfactual' && claim.failure !== 'nonfactual_with_content')).length;
      return { markdown: result.markdown, removed };
    },
    conflicts: async (statements) => {
      currentStage = 'finalize';
      return (await audit.findResearchConflicts(statements, null)).filter((conflict) => conflict.incompatible).map(({ a, b, reason }) => ({ a, b, reason }));
    },
    cacheGet: (key) => cache.get(key) ?? null,
    cachePut: (key, _stage, value) => cache.set(key, JSON.parse(JSON.stringify(value))),
    checkpointGet: (stage, unit) => checkpoints.get(`${stage}|${unit}`) ?? null,
    checkpointPut: (stage, unit, value) => checkpoints.set(`${stage}|${unit}`, JSON.parse(JSON.stringify(value))),
    hash: (value) => createHash('sha256').update(value).digest('hex'),
    progress: (event) => process.stdout.isTTY && process.stdout.write(`\r  ${event.stage.padEnd(8)} ${event.done}/${event.total}${event.detail ? ` · ${event.detail.slice(0, 50)}` : ''}`.padEnd(90)),
  };
}
const guideInput = (runId) => ({ config: configFor(runId), snapshot, organization, language: 'es', modelKey: `deepseek/${CHAT_MODEL}`, promptVersion: prompts.COMPLETE_GUIDE_PROMPT_VERSION, instructions: configFor(runId).instructions });
const estimate = estimateCompleteGuide({ snapshot, model: { provider: 'deepseek', model: CHAT_MODEL }, verification: 'standard', unitCount: 3, subjectCount: 2 });

const checks = [];
const check = (name, ok, detail = '', soft = false) => { checks.push({ name, ok: Boolean(ok), detail, soft }); console.log(`${ok ? '✓' : soft ? '~' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const stageTotals = (run) => {
  const totals = {};
  for (const call of metrics.calls.filter((entry) => entry.run === run)) {
    const stage = (totals[call.stage] ??= { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 });
    stage.calls += 1; stage.inputTokens += call.inputTokens; stage.outputTokens += call.outputTokens; stage.usd += call.usd;
  }
  return totals;
};

let first;
let second;
let browser;
try {
  console.log(`Complete study guide live verification (${simulated ? 'simulated upstream' : 'real providers'}) — root ${root}`);
  console.log(`Snapshot: ${snapshot.sources.length} sources, ${snapshot.totals.readablePassages} passages; estimate $${estimate.usd?.min.toFixed(4)}–$${estimate.usd?.max.toFixed(4)}, ${estimate.calls} calls`);
  currentRun = 'first';
  first = await core.runCompleteGuide(guideInput('cg-live-a'), deps(new Map()));
  if (process.stdout.isTTY) process.stdout.write('\n');
  currentRun = 'second';
  second = await core.runCompleteGuide(guideInput('cg-live-b'), deps(new Map()));
  if (process.stdout.isTTY) process.stdout.write('\n');

  // Reading and selection
  check('the excluded material never enters the snapshot', !snapshot.sources.some((source) => source.sourceKey === 'material:excluded'));
  check('every readable passage is read', first.coverage.every((row) => row.passagesRead === row.passagesTotal) && first.counts.failedWindows === 0,
    first.coverage.map((row) => `${row.source.alias} ${row.passagesRead}/${row.passagesTotal}`).join(', '));
  const text = (item) => [item.title, item.statement, item.latex ?? '', item.solution ?? ''].join(' ');
  const located = (item, fact) => item.evidence.some((evidence) => {
    const passage = snapshot.passages.find((candidate) => candidate.id === evidence.passageId);
    if (!passage || passage.sourceKey !== fact.source) return false;
    return fact.page ? passage.locator.kind === 'page' && passage.locator.page === fact.page : passage.locator.kind === 'slide' && passage.locator.slide === fact.slide;
  });
  const factRows = FACTS.map((fact) => {
    const items = first.items.filter((item) => fact.probe.test(text(item)) && located(item, fact));
    const cited = items.find((item) => first.markdown.includes(`e=${item.id})`) || first.markdown.includes(`e=${item.id}&`));
    return { ...fact, probe: String(fact.probe), extracted: items.length > 0, cited: Boolean(cited), itemId: cited?.id ?? items[0]?.id ?? null };
  });
  for (const row of factRows) check(`fact "${row.name}" extracted at ${row.page ? `p. ${row.page}` : `diap. ${row.slide}`} and cited in the guide`, row.extracted && row.cited, row.itemId ?? 'missing');
  check('the excluded material and its unique fact never appear', !EXCLUDED_FACT.test(first.markdown) && !EXCLUDED_FACT.test(first.cheatSheetMarkdown) && !first.markdown.includes('material/excluded'));
  const aiCallouts = first.markdown.match(/^> \[!ai-[a-z-]+\][^\n]*(?:\n>[^\n]*)*/gm) ?? [];
  check('AI examples and analogies are labelled and never cite materials', aiCallouts.length > 0 && aiCallouts.every((block) => !block.includes('nodus://study')), `${aiCallouts.length} AI blocks`);
  const badMath = [...invalidMath(first.markdown), ...invalidMath(first.cheatSheetMarkdown)];
  const stray = [first.markdown, first.cheatSheetMarkdown].flatMap((value) => value.split(/\n\s*\n/)).filter((paragraph) => strayDollar(paragraph));
  check('all LaTeX compiles in KaTeX (mhchem included) and no formula is cut', badMath.length === 0 && stray.length === 0, [...badMath.map((span) => span.tex), ...stray].slice(0, 3).join(' | '));
  check('the review sheet carries the formulas', /\$[^$]*(PV|pH|K_w|\\ce)/.test(first.cheatSheetMarkdown));

  // The shape of the guide: prose first, boxes for what changes the mode of reading, the AI said once.
  const labels = completeGuideLabels('es');
  const shape = guideShape(first.markdown, labels.aiNote);
  const mark = labels.aiExampleShort.match(/\([^)]*\)/)[0];
  check('the AI notice is printed in full once, and every AI block carries the short mark', shape.aiNotices === 1 && shape.aiCallouts > 1 && aiCallouts.every((block) => block.split('\n')[0].includes(mark)),
    `${shape.aiNotices} notice(s), ${shape.aiCallouts} AI blocks`);
  const chunks = first.markdown.split(/\n(?=### )/);
  check('at most one AI box per section', chunks.every((chunk) => (chunk.match(/^> \[!ai-/gm) ?? []).length <= 1), `${first.counts.droppedAi} extra AI additions dropped`);
  check('definitions, rules, formulas and procedures are prose, not boxes', !/^> \[!(definition|formula|rule|procedure|memorize)\]/m.test(first.markdown), Object.entries(shape.byKind).map(([kind, count]) => `${kind} ${count}`).join(', '));
  check('most of the words are outside a box', shape.proseShare >= 0.5, `${Math.round(shape.proseShare * 100)} % prose, ${Math.round(shape.boxedShare * 100)} % boxed, ${Math.round(shape.aiShare * 100)} % AI`);
  const chapterText = (title) => first.markdown.split(/\n(?=## )/).find((part) => part.startsWith(`## ${title}\n`)) ?? '';
  const chapterTitles = first.chapters.map((chapter) => chapter.title);
  check('every chapter has its summary and ends with its questions', chapterTitles.every((title) => {
    const text = chapterText(title);
    return text.includes(`### ${labels.chapterSummary}`) && text.includes(`### ${labels.practice}`) && (text.match(/^> \[!selfcheck\]/gm) ?? []).length === 1;
  }), chapterTitles.map((title) => `${title}: ${/### Resumen del tema/.test(chapterText(title)) ? 'summary' : 'no summary'}`).join('; '));
  const history = chapterText('Tema 7 · La Restauración');
  const chronology = /### Cronología\n\n((?:- \*\*[^\n]+\n?)+)/.exec(history)?.[1] ?? '';
  const years = [...chronology.matchAll(/^- \*\*(\d{3,4})/gm)].map((match) => Number(match[1]));
  check('the history chapter opens with its chronology, oldest first', years.length >= 3 && years.every((year, index) => index === 0 || year >= years[index - 1]) && history.indexOf('### Cronología') < history.indexOf(`### ${labels.chapterSummary}`), `${years.join(', ')}`);
  check('the history chapter is told in prose: no analogy from the AI and no scientific notation', !/\[!ai-analogy\]/.test(history) && !/\$/.test(history) && !history.includes('[!formula]'), '', true);
  check('the contradiction between the note and the slides is reported', first.counts.conflicts >= 1, `${first.counts.conflicts} conflicts`, true);
  check('the history unit uses no scientific callouts it has no content for', !/## Tema 7 · La Restauración[\s\S]*?(?=\n## )/.exec(first.markdown)?.[0].includes('[!formula]') && !/\$/.test(chapterText('Tema 7 · La Restauración')), '', true);

  // Second version and cost
  const reading = (run) => metrics.calls.filter((call) => call.run === run && (call.stage === 'recon' || call.stage === 'extract')).length;
  const reuse = reading('first') ? 1 - reading('second') / reading('first') : 0;
  check('a second version reuses ≥ 90 % of the reading passes', reuse >= 0.9, `${Math.round(reuse * 100)} % (${reading('second')}/${reading('first')} reading calls, ${second.counts.cacheHits} cache hits)`);
  const firstUsd = metrics.calls.filter((call) => call.run === 'first').reduce((sum, call) => sum + call.usd, 0);
  check('the pre-run estimate covers the real cost', estimate.usd && estimate.usd.max >= firstUsd, `estimate ≤ $${estimate.usd?.max.toFixed(4)}, spent $${firstUsd.toFixed(4)}`);
  check(`the ledger stays below $${limitUsd}`, ledgerUsd() < limitUsd, `$${(ledgerUsd() - startingLedgerUsd).toFixed(4)} this run, $${ledgerUsd().toFixed(4)} in the ledger`);

  // Exports
  const draft = {
    generatedAt: new Date().toISOString(), title: first.title, abstract: first.abstract, draftMarkdown: first.markdown, bibliography: first.bibliography, limitations: first.limitations,
    brief: { kind: 'deep_research', objective: first.title, language: 'es', studyReportMode: 'complete_guide' }, outline: first.chapters.map((chapter) => ({ id: chapter.unitKey, title: chapter.title })),
    stats: { selectedWorks: snapshot.sources.length }, completeGuide: { sources: first.coverage, config: configFor('x'), cheatSheetMarkdown: first.cheatSheetMarkdown },
  };
  const markdown = completeGuideMarkdown(draft);
  fs.writeFileSync(path.join(artifacts, 'complete-guide.md'), markdown);
  check('Markdown export keeps callouts, LaTeX and citations', /> \[!/.test(markdown) && /\$/.test(markdown) && /A1 · p\. \d/.test(markdown));
  const docx = await completeGuideDocx(`# ${first.title}\n\n${first.markdown}`, { title: first.title, contentsLabel: 'Contenido' });
  fs.writeFileSync(path.join(artifacts, 'complete-guide.docx'), docx);
  const documentXml = new AdmZip(docx).readAsText('word/document.xml');
  check('Word export has native equations and tables', documentXml.includes('<m:oMath>') && documentXml.includes('<w:tbl>'));
  browser = await chromium.launch({ executablePath: process.env.NODUS_CHROMIUM ?? '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1400 }, javaScriptEnabled: false });
  await page.setContent(renderProfessionalReportHtml(completeGuideReportInput(draft)), { waitUntil: 'load' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(path.join(artifacts, 'complete-guide.pdf'), pdf);
  const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  check('PDF export renders (cover, contents, chapters)', pdf.subarray(0, 4).toString() === '%PDF' && pdfPages >= 4, `${pdfPages} pages`);
  const chapter = await page.$('h2, h3');
  if (chapter) await chapter.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, 'complete-guide-page.png'), fullPage: false });
  const sheetHtml = completeGuideReviewSheetHtml(draft);
  if (sheetHtml) {
    await page.setContent(sheetHtml, { waitUntil: 'load' });
    const sheet = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(path.join(artifacts, 'complete-guide-review-sheet.pdf'), sheet);
    await page.screenshot({ path: path.join(artifacts, 'complete-guide-review-sheet.png'), fullPage: false });
  }
  check('the review sheet exports on its own', Boolean(sheetHtml));
} catch (error) {
  process.stdout.write('\n');
  check('the run completes within budget', false, error instanceof Error ? `${error.message}` : String(error));
} finally {
  await browser?.close();
  await proxy.close();
  const out = argument('out') ?? path.join(artifacts, 'complete-guide-metrics.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    mode: simulated ? 'simulated' : 'real', models: { chat: CHAT_MODEL, embeddings: EMBEDDING_MODEL }, limitUsd, root,
    ledgerUsd: { before: startingLedgerUsd, after: ledgerUsd() },
    estimate: estimate && { usd: estimate.usd, calls: estimate.calls, stages: estimate.stages },
    runs: { first: { stages: stageTotals('first'), counts: first?.counts, shape: first && guideShape(first.markdown, completeGuideLabels('es').aiNote), warnings: first?.warnings, refusals: metrics.refusals.first ?? 0 }, second: { stages: stageTotals('second'), counts: second?.counts, refusals: metrics.refusals.second ?? 0 } },
    coverage: first?.coverage.map((row) => ({ alias: row.source.alias, title: row.source.title, read: row.passagesRead, total: row.passagesTotal, itemsExtracted: row.itemsExtracted, itemsUsed: row.itemsUsed, unread: row.unreadRanges })),
    checks,
  }, null, 2));
  console.log(`\nMetrics: ${out}\nArtifacts (PDF, DOCX, MD, PNG snapshots): ${artifacts}`);
  const failed = checks.filter((entry) => !entry.ok && !entry.soft);
  console.log(failed.length ? `${failed.length} check(s) failed.` : 'All checks passed.');
  process.exitCode = failed.length ? 1 : 0;
}

// ---------------------------------------------------------------- scripted upstream (--simulated)

/** Answers every guide prompt the way a careful model would, from the request alone,
 * on the provider wire format; the proxy, ledger and application code stay real. */
function scriptedUpstream() {
  const sentences = (value) => value.replace(/\n+/g, ' ').split(/(?<=[.:])\s+(?=[A-ZÁÉÍÓÚÑ¿])/).map((part) => part.trim()).filter((part) => part.length > 12);
  const math = (value) => value.match(/\$([^$]+)\$/)?.[1] ?? null;
  const answer = (system, user) => {
    if (system === prompts.RECON_SYSTEM) return { outline: [{ title: user.source.title, firstPassage: user.passages[0].id, lastPassage: user.passages.at(-1).id, summary: user.passages[0].text.slice(0, 120) }], keyTerms: [] };
    if (system === prompts.EXTRACT_SYSTEM || system === prompts.RECOVER_SYSTEM) {
      return { items: user.passages.flatMap((passage) => sentences(passage.text).filter((sentence) => !sentence.startsWith('|')).map((sentence) => {
        const tex = math(sentence);
        const type = /Figura/.test(sentence) ? 'figure' : /se define|es una especie/.test(sentence) ? 'definition' : tex ? 'formula' : /Ejemplo/.test(sentence) ? 'example' : /Error/.test(sentence) ? 'mistake' : /\b1[89]\d\d\b/.test(sentence) ? 'event' : 'fact';
        return { type, title: sentence.replace(/\$[^$]+\$/g, '').slice(0, 60), statement: sentence, importance: type === 'fact' ? 'support' : 'core', passageId: passage.id, quote: sentence,
          ...(tex ? { latex: tex } : {}), ...(type === 'event' ? { date: sentence.match(/\b1[89]\d\d\b/)[0] } : {}) };
      })) };
    }
    if (system === prompts.PLAN_SYSTEM) {
      const ids = user.items.map((item) => item.id);
      const half = Math.ceil(ids.length / 2);
      return { overview: `Qué trata ${user.unit}.`, sections: [{ title: 'Conceptos básicos', purpose: 'Entender', itemIds: ids.slice(0, half) }, { title: 'Aplicaciones', purpose: 'Aplicar', itemIds: ids.slice(half) }].filter((section) => section.itemIds.length) };
    }
    if (system === prompts.WRITE_SYSTEM || system === prompts.CONTINUE_SYSTEM) {
      // The writer the prompt asks for: prose paragraphs, a worked example only where an item is one.
      const blocks = user.items.map((item) => ({ kind: item.type === 'example' ? 'example' : 'explanation', ...(item.type === 'example' ? { title: 'Ejemplo resuelto' } : {}), itemIds: [item.id],
        markdown: `${item.statement}${item.latex && !item.statement.includes('$') ? ` $$${item.latex}$$` : ''}` }));
      if (system === prompts.WRITE_SYSTEM && user.items.length) {
        // Several AI additions and a "to memorize" list on purpose: the engine keeps one AI block
        // per section and drops the list, so the free run covers both rules. A narrative chapter
        // is told without analogies, as the prompt asks.
        if (user.profile?.kind !== 'narrative') {
          blocks.push({ kind: 'ai_example', itemIds: [user.items[0].id], markdown: 'Piensa en una situación cotidiana que ilustre esta idea.' });
          blocks.push({ kind: 'ai_analogy', itemIds: [user.items[0].id], markdown: 'Es como seguir un mapa: cada paso conduce al siguiente.' });
        }
        blocks.push({ kind: 'memorize', itemIds: [user.items[0].id], markdown: `- ${user.items[0].statement}` });
        blocks.push({ kind: 'selfcheck', itemIds: [user.items[0].id], question: `¿Qué dice «${user.items[0].title}»?`, answer: user.items[0].statement });
      }
      return { blocks };
    }
    if (system === prompts.SUMMARY_SYSTEM) {
      const half = Math.ceil(user.items.length / 2);
      return { paragraphs: [user.items.slice(0, half), user.items.slice(half)].filter((group) => group.length)
        .map((group) => ({ itemIds: group.map((item) => item.id), markdown: group.map((item) => item.statement).join(' ') })) };
    }
    if (system === prompts.REPAIR_LATEX_SYSTEM) return { fixes: [] };
    if (system === prompts.REVISE_SYSTEM) return { markdown: user.block };
    if (system === prompts.MAP_SYSTEM) return { overview: 'Las unidades avanzan de los gases a los ácidos; la historia se estudia aparte.', connections: [] };
    if (system === prompts.CHEAT_SYSTEM) return { points: user.items.slice(0, 8).map((item) => ({ itemId: item.id, phrase: item.statement.split(/\s+/).slice(0, 12).join(' ') })) };
    if (system.startsWith('You audit research prose')) {
      return { claims: user.sentences.map((sentence) => {
        const source = user.sources[0];
        return { index: sentence.index, kind: 'fact', premises: [{ text: sentence.text, type: 'fact', entailed: true, evidence: [{ id: source.id, quote: source.text.slice(0, 60) }], from: [] }], unsupportedParts: [], explicitInference: false, supported: true, reason: 'ok' };
      }) };
    }
    if (system.startsWith('You check one research report')) {
      const index = user.statements.findIndex((statement) => /cualquier temperatura/.test(statement.text));
      const other = user.statements.findIndex((statement) => /solo a 25/.test(statement.text));
      return { conflicts: index >= 0 && other >= 0 ? [{ a: other, b: index, incompatible: true, quoteA: 'solo a 25 °C', quoteB: 'a cualquier temperatura', reason: 'Condición de temperatura incompatible.' }] : [] };
    }
    throw new Error(`scripted upstream: unknown prompt ${system.slice(0, 60)}`);
  };
  const dispatch = async (url, init) => {
    const body = JSON.parse(Buffer.from(init.body).toString('utf8'));
    if (url.includes('openrouter')) {
      const vector = (text) => Array.from({ length: 32 }, (_, index) => { const hash = createHash('sha256').update(`${index}:${text}`).digest(); return hash[0] / 255 - 0.5; });
      return Response.json({ object: 'list', data: body.input.map((text, index) => ({ object: 'embedding', index, embedding: vector(text) })), usage: { prompt_tokens: body.input.join(' ').length / 4 | 0 } });
    }
    const [system, user] = body.messages.map((message) => message.content);
    // The provider's own JSON-mode contract, in DeepSeek's words: a prompt without the word
    // "json" is refused when `response_format` asks for it. The free run therefore exercises
    // the same refusal the paid one is replayed around.
    if (body.response_format && !/\bjson\b/i.test(system)) {
      return Response.json({ error: { message: "Prompt must contain the word 'json' in some form to use 'response_format' of type 'json_object'.", type: 'invalid_request_error', param: null, code: 'invalid_request_error' } }, { status: 400 });
    }
    const content = JSON.stringify(answer(system, JSON.parse(user)));
    return Response.json({ id: 'scripted', object: 'chat.completion', model: body.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: { prompt_tokens: Math.ceil((system.length + user.length) / 3.6), completion_tokens: Math.ceil(content.length / 3.6) } });
  };
  return { dispatch };
}
