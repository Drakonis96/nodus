import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-document-pipeline-'));
const outfile = path.join(root, 'pipeline.mjs');

globalThis.__documentPipeline = {
  passages: [], checkpoints: new Map(), published: null, states: [], jobs: [], auditCalls: 0, sectionAuditCalls: 0,
  forceSectionAuditFailure: false, forceDocumentAuditFailure: false, forceEmptyProfile: false,
  forceSectionSchemaFailure: false, onEmbed: null, sourceReads: 0, changedTextAtPublication: null,
};

await build({
  entryPoints: [path.join(repoRoot, 'electron/ai/documentProfile.ts')], outfile,
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  plugins: [{
    name: 'document-pipeline-stubs',
    setup(buildApi) {
      const stub = (pattern, name, contents) => {
        buildApi.onResolve({ filter: pattern }, () => ({ path: name, namespace: 'stub' }));
        buildApi.onLoad({ filter: new RegExp(`^${name}$`), namespace: 'stub' }, () => ({ contents, loader: 'js' }));
      };
      stub(/\.\.\/db\/database$/, 'database', `export function getDb(){return {prepare(sql){return {
        get(){if(sql.includes('COUNT(*) count'))return {count:0,hash:null};if(sql.includes('document_index_jobs'))return {nodus_id:'w1'};return null},
        all(){if(sql.includes('FROM passages'))return globalThis.__documentPipeline.passages;if(sql.includes('FROM ideas'))return [];return []}
      }}}}`);
      stub(/\.\.\/db\/settingsRepo$/, 'settings', `export function getSettings(){return {
        zoteroUserId:'0',zoteroStoragePath:'',unpaywallEmail:'',preferZoteroFulltext:true,
        ocrEnabled:false,ocrLanguages:'spa+eng',ocrMaxPages:300,promptLanguage:'es'
      }}`);
      stub(/\.\.\/db\/documentProfilesRepo$/, 'profile-repo', `
        export function clearDocumentCheckpoints(id){for(const key of globalThis.__documentPipeline.checkpoints.keys())if(key.startsWith(id+':'))globalThis.__documentPipeline.checkpoints.delete(key)}
        export function readDocumentCheckpoint(id,key,hash){return globalThis.__documentPipeline.checkpoints.get(id+':'+key+':'+hash)??null}
        export function saveDocumentCheckpoint(id,key,hash,payload){globalThis.__documentPipeline.checkpoints.set(id+':'+key+':'+hash,payload)}
        export function setDocumentProfileState(id,status,patch){globalThis.__documentPipeline.states.push({id,status,patch})}
        export function updateDocumentIndexJob(id,patch){globalThis.__documentPipeline.jobs.push({id,patch})}
        export function advanceRunningDocumentIndexJob(id,phase,progress,state){globalThis.__documentPipeline.jobs.push({id,patch:{phase,progress,state}});return true}
        export function publishDocumentProfile(input){globalThis.__documentPipeline.published=input;if(input.passages)globalThis.__documentPipeline.passages=input.passages.rows.map((row,index)=>({passage_id:input.nodusId+'#'+index,text:row.text}));return 'published-v1'}
      `);
      stub(/\.\.\/db\/ideasRepo$/, 'ideas', `
        export function cosineSimilarity(){return 0} export function decodeEmbedding(){return []}
        export function currentEmbeddingConfig(){return {provider:'openrouter',model:'baai/bge-m3'}}
      `);
      stub(/\.\.\/db\/libraryAnalysisProvenance$/, 'provenance', `
        export function analysisFingerprint(value){return String(value||'')}
        export function analysisModelFingerprint(){return 'document-model'}
        export function upsertLibraryAnalysisProvenance(input){globalThis.__documentPipeline.provenance=input}
      `);
      stub(/\.\.\/extraction\/textExtractor$/, 'extractor', `
        export async function resolveWorkText(){
          globalThis.__documentPipeline.sourceReads=(globalThis.__documentPipeline.sourceReads||0)+1;
          const changed=globalThis.__documentPipeline.sourceReads>1&&globalThis.__documentPipeline.changedTextAtPublication;
          return {text:changed||globalThis.__documentPipeline.text,sourceType:'markdown',notes:null}
        }
        export function planRetrievalChunks(text){return [{text:text.replace(/\\[\\[p\\. \\d+\\]\\]/g,' '),pageLabel:'p. 1'}]}
      `);
      stub(/\.\.\/zotero\/zoteroClient$/, 'zotero', `export const LOCAL_USER_ID='0';export async function getItem(){return {abstract:'Resumen original'}}`);
      stub(/\.\/aiClient$/, 'ai', `
        export class AiError extends Error{constructor(message,retriable=false,config=false){super(message);this.retriable=retriable;this.config=config}}
        export async function embedMany(texts,signal){globalThis.__documentPipeline.onEmbed?.();signal?.throwIfAborted();return texts.map((_,index)=>[1,index+1,0])}
        export async function completeJson(opts){
          if(globalThis.__documentPipeline.forceSectionSchemaFailure && opts.system.includes('Analiza íntegramente')){
            throw new AiError('El JSON no cumple el esquema esperado');
          }
          if(opts.system.includes('Audita un análisis de sección')){globalThis.__documentPipeline.sectionAuditCalls++;const input=JSON.parse(opts.user);return globalThis.__documentPipeline.forceSectionAuditFailure
            ? {passed:false,issues:['El proveedor insiste en rechazar la sección.'],analysis:input.analysis}
            : {passed:true,issues:[],analysis:input.analysis};
          };
          if(opts.system.includes('Analiza íntegramente'))return {
            title:'Capítulo analizado',summary:'Expone una modernización desigual.',role:'argumento',concepts:['modernización'],
            claims:[{text:'El proceso fue desigual.',support_quote:'El proceso avanzó de manera desigual entre las regiones.',page:'p. 2',confidence:0}]
          };
          if(opts.system.includes('Construye una ficha'))return globalThis.__documentPipeline.forceEmptyProfile
            ? {source_language:'es',overview:'',fields:[]}
            : {source_language:'es',overview:'La obra estudia una modernización desigual.',fields:[
            {kind:'thesis',text:'La modernización avanzó con ritmos regionales distintos.',confidence:0,centrality:1,support_quote:'El proceso avanzó de manera desigual entre las regiones.',page:'p. 2'},
            {kind:'argument',text:'Este campo debe descartarse.',confidence:.2,centrality:.1,support_quote:'Esta cita no existe en el documento.',page:null}
          ]};
          if(opts.system.includes('Audita una ficha')){globalThis.__documentPipeline.auditCalls++;return globalThis.__documentPipeline.forceDocumentAuditFailure ? {
            passed:false,score:.8,issues:['El auditor discrepa de la paráfrasis.'],field_fixes:[],overview:''
          } : {
            passed:true,score:.95,issues:[],
            field_fixes:[{index:0,text:'La formulación auditada conserva su apoyo.',support_quote:'Una paráfrasis inexistente no puede sustituir la cita.'}],overview:''
          }};
          throw new Error('unexpected prompt '+opts.system.slice(0,20));
        }
      `);
    },
  }],
});

const pipeline = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
test.after(async () => { delete globalThis.__documentPipeline; await rm(root, { recursive: true, force: true }); });

test('structure preserves heading hierarchy and full character coverage', () => {
  const text = 'Prefacio con suficientes palabras '.repeat(20) + '\n# Parte I\n[[p. 1]]\nTexto uno.\n## Capítulo 1\n[[p. 2]]\nTexto dos.';
  const sections = pipeline.deriveDocumentStructure(text, 'Libro');
  assert.ok(sections.length >= 3);
  const chapter = sections.find((section) => section.title === 'Capítulo 1');
  const part = sections.find((section) => section.title === 'Parte I');
  assert.equal(chapter.parentSectionId, part.sectionId);
  assert.equal(chapter.pageStart, 'p. 1', 'heading precedes the next physical page marker');
  assert.ok(sections.every((section) => section.contentHash.length === 64));
});

test('provider audit variants normalize conservatively instead of aborting the job', () => {
  const normalized = pipeline.normalizeDocumentProfileAuditResponse({
    passed: 'true',
    score: '0.91',
    issues: 'Ajustar una formulación menor.',
    field_fixes: [{ index: '2', text: 'Texto corregido', support_quote: 'Apoyo literal' }],
  });
  assert.equal(normalized.passed, true);
  assert.equal(normalized.score, 0.91);
  assert.deepEqual(normalized.issues, ['Ajustar una formulación menor.']);
  assert.deepEqual(normalized.field_fixes, [{ index: 2, text: 'Texto corregido', support_quote: 'Apoyo literal' }]);
  assert.equal(
    pipeline.normalizeDocumentProfileAuditResponse({ score: 0.99 }).passed,
    false,
    'an absent verdict can never be promoted to passed',
  );
  const wrapped = pipeline.normalizeDocumentProfileAuditResponse({
    audit: { passed: true, score: 0.93, issues: [], field_fixes: [], overview: '' },
  });
  assert.equal(wrapped.passed, true, 'an explicit verdict in a provider audit wrapper is preserved');
  assert.equal(wrapped.score, 0.93);
  assert.equal(
    pipeline.normalizeDocumentProfileAuditResponse({ audit: { score: 0.99 } }).passed,
    false,
    'a wrapped response without an explicit verdict remains rejected',
  );
});

test('full pipeline reads sections, audits once, embeds facets and publishes atomically', async () => {
  globalThis.__documentPipeline.sourceReads = 0;
  globalThis.__documentPipeline.text = `# Introducción\n[[p. 1]]\nLa obra plantea su problema.\n## Desarrollo\n[[p. 2]]\nEl proceso avanzó de manera\n   desigual entre las regiones.\n${'Desarrollo histórico completo. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  const result = await pipeline.runDocumentProfileScan(work, {
    jobId:'job-1',generatorModel:null,auditorModel:null,onProgress() {},
  });
  assert.equal(result, 'published-v1');
  assert.ok(globalThis.__documentPipeline.sectionAuditCalls >= 2, 'every section analysis is independently audited');
  assert.equal(globalThis.__documentPipeline.auditCalls, 1, 'the independent semantic audit is mandatory');
  const published = globalThis.__documentPipeline.published;
  assert.equal(published.audit.passed, true);
  assert.equal(published.audit.supportCoverage, 1);
  assert.equal(published.audit.repaired, true, 'unsupported generated fields are deterministically removed');
  assert.equal(published.fields.length, 1, 'an invented support is never published');
  assert.equal(published.supports[0].quote, 'El proceso avanzó de manera desigual entre las regiones.',
    'an auditor suggestion without literal support is ignored');
  assert.equal(published.fields[0].text, 'La modernización avanzó con ritmos regionales distintos.',
    'the text paired with an invalid auditor quote is ignored too');
  assert.equal(published.fields[0].kind, 'thesis');
  assert.equal(published.fields[0].confidence, 0.8, 'confidence is derived from audited direct support, not an arbitrary model zero');
  assert.ok(published.supports.every((support) => support.confidence >= 0.8), 'published literal supports carry the deterministic floor');
  assert.ok(published.sections.length >= 2);
  assert.ok(published.supports.some((support) => support.targetKind === 'field' && support.validationStatus === 'valid'));
  assert.ok(published.vectors.some((vector) => vector.kind === 'overview'));
  assert.ok(published.vectors.some((vector) => vector.kind === 'section'));
  assert.ok(published.vectors.every((vector) => vector.embeddingProvider === 'openrouter' && vector.embeddingModel === 'baai/bge-m3'));
  assert.equal(published.passages.embeddingProvider, 'openrouter');
  assert.equal(published.passages.embeddingModel, 'baai/bge-m3');
  assert.ok(globalThis.__documentPipeline.passages.length > 0, 'full text is also made lexically/citably retrievable');
});

test('a file replaced externally during analysis is rejected at the publication boundary', async () => {
  globalThis.__documentPipeline.sourceReads = 0;
  globalThis.__documentPipeline.published = null;
  globalThis.__documentPipeline.text = `# Versión inicial\n${'Texto estable original. '.repeat(100)}`;
  globalThis.__documentPipeline.changedTextAtPublication = `# Versión sustituida\n${'Texto externo diferente. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  await assert.rejects(
    pipeline.runDocumentProfileScan(work, { jobId:'job-mid-analysis-change',generatorModel:null,auditorModel:null,onProgress() {} }),
    /DOCUMENT_SOURCE_CHANGED/,
  );
  assert.equal(globalThis.__documentPipeline.published, null);
  globalThis.__documentPipeline.changedTextAtPublication = null;
});

test('stop during passage embeddings prevents every later write and publication', async () => {
  const controller = new AbortController();
  globalThis.__documentPipeline.passages = [{ passage_id: 'existing', text: 'Pasaje vigente' }];
  globalThis.__documentPipeline.published = null;
  globalThis.__documentPipeline.onEmbed = () => controller.abort(new Error('DOCUMENT_INDEX_CANCELLED'));
  globalThis.__documentPipeline.text = `# Introducción\n[[p. 1]]\n${'Texto completo verificable. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  await assert.rejects(
    pipeline.runDocumentProfileScan(work, { jobId:'job-stop-embedding',generatorModel:null,auditorModel:null,signal:controller.signal,onProgress() {} }),
    /DOCUMENT_INDEX_CANCELLED/,
  );
  globalThis.__documentPipeline.onEmbed = null;
  assert.deepEqual(globalThis.__documentPipeline.passages, [{ passage_id: 'existing', text: 'Pasaje vigente' }], 'cancelled embeddings cannot replace existing passages');
  assert.equal(globalThis.__documentPipeline.published, null, 'a cancelled candidate is never published');
});

test('a full-text file changed outside Nodus is rejected until its deep hash catches up', async () => {
  globalThis.__documentPipeline.published = null;
  globalThis.__documentPipeline.text = `# Texto sustituido\n${'Contenido externo nuevo. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:'hash-anterior',summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  await assert.rejects(
    pipeline.runDocumentProfileScan(work, { jobId:'job-external-source-change',generatorModel:null,auditorModel:null,onProgress() {} }),
    /DOCUMENT_SOURCE_CHANGED/,
  );
  assert.equal(globalThis.__documentPipeline.published, null);
});

test('stop after passages are prepared preserves the previously published passage set', async () => {
  const controller = new AbortController();
  let embeddingCall = 0;
  const previous = [{ passage_id: 'existing-late', text: 'Pasaje anterior que debe sobrevivir.' }];
  globalThis.__documentPipeline.passages = structuredClone(previous);
  globalThis.__documentPipeline.published = null;
  globalThis.__documentPipeline.onEmbed = () => {
    embeddingCall += 1;
    if (embeddingCall === 2) controller.abort(new Error('DOCUMENT_INDEX_CANCELLED'));
  };
  globalThis.__documentPipeline.text = `# Introducción\n[[p. 1]]\nLa obra plantea su problema.\n## Desarrollo\n[[p. 2]]\nEl proceso avanzó de manera desigual entre las regiones.\n${'Desarrollo histórico completo. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  await assert.rejects(
    pipeline.runDocumentProfileScan(work, { jobId:'job-stop-late',generatorModel:null,auditorModel:null,signal:controller.signal,onProgress() {} }),
    /DOCUMENT_INDEX_CANCELLED/,
  );
  globalThis.__documentPipeline.onEmbed = null;
  assert.equal(embeddingCall, 2, 'the stop happens after the replacement passages were fully prepared');
  assert.deepEqual(globalThis.__documentPipeline.passages, previous);
  assert.equal(globalThis.__documentPipeline.published, null);
});

test('repeated section-auditor rejection degrades to literal extracts instead of publishing disputed prose', async () => {
  globalThis.__documentPipeline.forceSectionAuditFailure = true;
  globalThis.__documentPipeline.text = `# Introducción\n[[p. 1]]\nLa obra plantea su problema.\n## Desarrollo\n[[p. 2]]\nEl proceso avanzó de manera desigual entre las regiones.\n${'Desarrollo histórico completo. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  const result = await pipeline.runDocumentProfileScan(work, {
    jobId:'job-section-fallback',generatorModel:null,auditorModel:null,onProgress() {},
  });
  globalThis.__documentPipeline.forceSectionAuditFailure = false;
  assert.equal(result, 'published-v1');
  const normalizedSource = globalThis.__documentPipeline.text.replace(/\s+/g, ' ');
  assert.ok(globalThis.__documentPipeline.published.sections.every((section) =>
    !section.summary || normalizedSource.includes(section.summary.replace(/\s+/g, ' '))),
  'fallback summaries contain only literal source text');
});

test('a repeatedly rejected or empty synthesis publishes an explicit literal fallback instead of leaving a campaign hole', async () => {
  globalThis.__documentPipeline.forceDocumentAuditFailure = true;
  globalThis.__documentPipeline.forceEmptyProfile = true;
  globalThis.__documentPipeline.text = `# Introducción\n[[p. 1]]\nLa obra plantea su problema con detalle suficiente para construir una ficha literal verificable.\n## Desarrollo\n[[p. 2]]\nEl proceso avanzó de manera desigual entre las regiones.\n${'Desarrollo histórico completo. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  const result = await pipeline.runDocumentProfileScan(work, {
    jobId:'job-profile-fallback',generatorModel:null,auditorModel:null,onProgress() {},
  });
  globalThis.__documentPipeline.forceDocumentAuditFailure = false;
  globalThis.__documentPipeline.forceEmptyProfile = false;
  assert.equal(result, 'published-v1');
  const published = globalThis.__documentPipeline.published;
  assert.equal(published.profile.fallbackMode, 'extractive');
  assert.equal(published.audit.passed, true);
  assert.equal(published.audit.supportCoverage, 1);
  assert.ok(published.fields.length > 0);
  assert.ok(published.supports.every((support) => support.validationStatus === 'valid'));
  assert.ok(published.fields.every((field) => globalThis.__documentPipeline.text.replace(/\s+/g, ' ').includes(field.text.replace(/\s+/g, ' '))));
});

test('invalid provider JSON in a section degrades locally instead of failing the whole document', async () => {
  globalThis.__documentPipeline.forceSectionSchemaFailure = true;
  globalThis.__documentPipeline.text = `# Introducción\n[[p. 1]]\nLa obra plantea su problema con suficiente detalle documental.\n## Desarrollo\n[[p. 2]]\nEl proceso avanzó de manera desigual entre las regiones.\n${'Desarrollo histórico completo. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  const result = await pipeline.runDocumentProfileScan(work, {
    jobId:'job-section-schema-fallback',generatorModel:null,auditorModel:null,onProgress() {},
  });
  globalThis.__documentPipeline.forceSectionSchemaFailure = false;
  assert.equal(result, 'published-v1');
  assert.ok(globalThis.__documentPipeline.published.sections.every((section) => section.summary.length > 0));
  assert.ok(globalThis.__documentPipeline.published.audit.passed);
});
