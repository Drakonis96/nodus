import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export const RESEARCH_CAMPAIGN_QUERIES = [
  { name: 'exact', text: 'Cita literalmente la frase de NORTH23 e indica cuántas unidades se midieron en el campo norte.', expected: /23/, marker: 'NORTH23' },
  { name: 'comparison', text: 'Compara las mediciones de los campos norte y sur. ¿Respaldan una medición uniforme? Cita ambas fuentes.', expected: /23[\s\S]*41|41[\s\S]*23/, marker: 'SOUTH41' },
  { name: 'multilingual', text: 'Quelle quantité a été mesurée dans le champ sud ? Réponds en français et cite la source.', expected: /41/, marker: 'SOUTH41' },
  { name: 'absence', text: '¿Cuántas unidades se midieron en el campo este? Si las fuentes no lo indican, dilo expresamente y cita la evidencia de esa ausencia.', expected: /no (?:se |hay |existe|indica|proporciona)|ausencia|sin (?:datos|medici)|desconoc/i, marker: 'east' },
];

/** Real provider calls only through the separately owned, cost-reserving gate. */
export async function runResearchLiveCampaign(page, app, root, documents, { chatOnly = false, adversarial = false } = {}) {
  const ids = documents.map(document => document.id);
  const metrics = [];
  let sampling = false;
  const sampler = setInterval(async () => {
    if (sampling) return;
    sampling = true;
    try { metrics.push({ at: new Date().toISOString(), processes: await app.evaluate(({ app }) => app.getAppMetrics()) }); }
    catch { /* Closing an owned process ends sampling. */ }
    finally { sampling = false; }
  }, 1000);
  const result = { models: { generation: 'deepseek-flash', embedding: 'baai/bge-m3' }, checks: [], startedAt: new Date().toISOString() };
  try {
    const notebook = await page.evaluate(async ids => {
      const vault = await window.nodus.getActiveVault();
      await window.nodus.linkGlobalLibraryItemsToVault(ids, vault.id);
      const notebook = await window.nodus.saveResearchNotebook({ name: 'Live synthetic evidence campaign', mode: 'fixed',
        sources: ids.map(id => ({ kind: 'library-item', id })), exclusions: [] });
      await window.nodus.prepareResearchDocuments(ids);
      return notebook;
    }, ids);
    const deadline = Date.now() + 180000;
    let inventory;
    do {
      inventory = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
      if (ids.every(id => inventory.documents.find(document => document.id === id)?.preparation.embeddings === 'ready')) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    fs.writeFileSync(path.join(root, 'artifacts/live-preparation.json'), JSON.stringify(inventory, null, 2));
    assert.ok(ids.every(id => inventory.documents.find(document => document.id === id)?.preparation.embeddings === 'ready'), 'real embeddings must be published for every synthetic source');
    assert.ok(inventory.embeddingSpaces.some(space => space.model === 'baai/bge-m3' && space.dimensions === 1024));
    for (const query of RESEARCH_CAMPAIGN_QUERIES) {
      const started = performance.now();
      const search = await page.evaluate(input => window.nodus.searchResearchNotebook(input.id, input.query), { id: notebook.id, query: query.text });
      const response = await page.evaluate(async input => window.nodus.researchChat({ model: { provider: 'deepseek', model: 'deepseek-flash' }, thinkingEffort: 'standard',
        messages: [{ role: 'user', content: input.query }], selection: { notebookId: input.id,
          ideas: true, themes: true, contradictions: true, gaps: true, readingPath: false, authors: true,
          documents: false, passages: true, graph: true, graphParts: { ideaNodes: true, themeNodes: true, ideaEdges: true, authorGraph: true } } }), { id: notebook.id, query: query.text });
      const citations = [...response.answer.matchAll(/nodus:\/\/passage\/([^\s)\]"<>]+)/g)].map(match => decodeURIComponent(match[1]));
      const evidence = await page.evaluate(async citations => Promise.all(citations.map(id => window.nodus.getPassage(id))), citations);
      const check = { name: query.name, question: query.text, answer: response.answer, stats: response.stats, latencyMs: performance.now() - started,
        knownEvidenceRetrieved: search.evidence.some(item => item.text.includes(query.marker)), expectedAnswer: query.expected.test(response.answer),
        citationCount: citations.length, citationsExist: citations.length > 0 && evidence.every(Boolean), evidence, search };
      result.checks.push(check);
      fs.writeFileSync(path.join(root, 'artifacts/live-campaign.json'), JSON.stringify(result, null, 2));
      assert.ok(check.expectedAnswer, `${query.name}: answer must agree with known synthetic evidence`);
      assert.ok(check.citationsExist, `${query.name}: citations must resolve within the authorized scope`);
      assert.ok(check.knownEvidenceRetrieved, `${query.name}: search must retrieve the known source marker`);
    }
    result.deepResearchCases = [];
    for (const [deepResearchVersion, approach] of (chatOnly ? [] : [['v1', 'general'], ['v2', 'general'], ['v1', 'comparative'], ['v2', 'comparative']])) {
      const started = performance.now();
      const report = await page.evaluate(async input => window.nodus.generateDeepResearchReport({ notebookId: input.id,
        objective: 'Compara las mediciones de los campos norte y sur, señala los límites de comparabilidad y la ausencia de datos del campo este. Usa exclusivamente las tres fuentes sintéticas y citas verificables.',
        deepResearchVersion: input.deepResearchVersion, approach: input.approach, language: 'es', sectionLimit: 3,
        sectionLength: 300, model: { provider: 'deepseek', model: 'deepseek-flash' } }), { id: notebook.id, deepResearchVersion, approach });
      const measured = { deepResearchVersion, approach, latencyMs: performance.now() - started, report };
      result.deepResearchCases.push(measured);
      if (deepResearchVersion === 'v1' && approach === 'general') result.deepResearch = measured;
      fs.writeFileSync(path.join(root, 'artifacts/live-campaign.json'), JSON.stringify(result, null, 2));
      assert.equal(report.draft.researchTraversal.sourceCount, 3, 'each engine records its authorized corpus');
      assert.ok(report.draft.researchTraversal.queries.length > 0, 'each engine records its documentary traversal');
    }
    if (adversarial) result.adversarial = await (await import('./research-adversarial-campaign.mjs')).runResearchAdversarialCampaign(page, app, root, documents);
    result.completedAt = new Date().toISOString();
    return result;
  } finally {
    clearInterval(sampler);
    fs.writeFileSync(path.join(root, 'artifacts/live-campaign.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(root, 'artifacts/live-process-metrics.json'), JSON.stringify(metrics, null, 2));
  }
}
