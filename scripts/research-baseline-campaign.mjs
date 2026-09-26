import fs from 'node:fs';
import path from 'node:path';
import { RESEARCH_CAMPAIGN_QUERIES } from './research-live-campaign.mjs';

/** The baseline uses its shipped passage preparation and chat. Failures are
 * measurements, never repaired by importing the extension's retrieval code. */
export async function runResearchBaselineCampaign(page, app, root, documents) {
  const result = { base: 'f54995e7', models: { generation: 'deepseek-flash', embedding: 'baai/bge-m3' }, checks: [], startedAt: new Date().toISOString() };
  const metrics = [];
  let sampling = false;
  const sampler = setInterval(async () => {
    if (sampling) return;
    sampling = true;
    try { metrics.push({ at: new Date().toISOString(), processes: await app.evaluate(({ app }) => app.getAppMetrics()) }); }
    catch { /* Owned process has closed. */ } finally { sampling = false; }
  }, 1000);
  try {
    const preparation = await page.evaluate(async ids => {
      const vault = await window.nodus.getActiveVault();
      const links = await window.nodus.linkGlobalLibraryItemsToVault(ids, vault.id);
      const started = performance.now();
      try {
        await window.nodus.startPassageEmbedding(links.links.map(link => link.workId));
        return { latencyMs: performance.now() - started, links, status: await window.nodus.getPassageStatus() };
      } catch (error) { return { latencyMs: performance.now() - started, links, error: String(error) }; }
    }, documents.map(document => document.id));
    result.preparation = preparation;
    for (const query of RESEARCH_CAMPAIGN_QUERIES) {
      const started = performance.now();
      try {
        const response = await page.evaluate(async query => window.nodus.researchChat({ model: { provider: 'deepseek', model: 'deepseek-flash' }, thinkingEffort: 'standard',
          messages: [{ role: 'user', content: query }], selection: { ideas: true, themes: true, contradictions: true, gaps: true,
            readingPath: false, authors: true, documents: false, passages: true, graph: true,
            graphParts: { ideaNodes: true, themeNodes: true, ideaEdges: true, authorGraph: true } } }), query.text);
        const citations = [...response.answer.matchAll(/nodus:\/\/passage\/([^\s)\]"<>]+)/g)].map(match => decodeURIComponent(match[1]));
        const evidence = await page.evaluate(ids => Promise.all(ids.map(id => window.nodus.getPassage(id))), citations);
        result.checks.push({ name: query.name, question: query.text, answer: response.answer, stats: response.stats,
          latencyMs: performance.now() - started, expectedAnswer: query.expected.test(response.answer), citationCount: citations.length,
          citationsExist: citations.length > 0 && evidence.every(Boolean), knownEvidenceRetrieved: evidence.some(item => item?.text.includes(query.marker)), evidence });
      } catch (error) { result.checks.push({ name: query.name, error: String(error), latencyMs: performance.now() - started }); }
      fs.writeFileSync(path.join(root, 'artifacts/live-campaign.json'), JSON.stringify(result, null, 2));
    }
    result.deepResearchCases = [];
    for (const [deepResearchVersion, approach] of [['v1', 'general'], ['v2', 'general'], ['v1', 'comparative'], ['v2', 'comparative']]) {
      const started = performance.now();
      try {
        const report = await page.evaluate(input => window.nodus.generateDeepResearchReport({
          objective: 'Compara las mediciones de los campos norte y sur, señala los límites de comparabilidad y la ausencia de datos del campo este. Usa exclusivamente las tres fuentes sintéticas y citas verificables.',
          deepResearchVersion: input.deepResearchVersion, approach: input.approach, language: 'es', sectionLimit: 3,
          sectionLength: 300, model: { provider: 'deepseek', model: 'deepseek-flash' } }), { deepResearchVersion, approach });
        result.deepResearchCases.push({ deepResearchVersion, approach, latencyMs: performance.now() - started, report });
      } catch (error) { result.deepResearchCases.push({ deepResearchVersion, approach, latencyMs: performance.now() - started, error: String(error) }); }
      fs.writeFileSync(path.join(root, 'artifacts/live-campaign.json'), JSON.stringify(result, null, 2));
    }
    result.completedAt = new Date().toISOString();
    return result;
  } finally {
    clearInterval(sampler);
    fs.writeFileSync(path.join(root, 'artifacts/live-campaign.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(root, 'artifacts/live-process-metrics.json'), JSON.stringify(metrics, null, 2));
  }
}
