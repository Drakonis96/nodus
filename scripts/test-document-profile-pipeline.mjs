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
  sectionTitles: [], overrides: {}, auditPayloadChars: [], auditTruncations: 0,
  localContextWindow: null, promptChars: [],
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
      // The shared documentary service has separate real-SQLite integration
      // coverage. This suite isolates profile generation and provider failures.
      stub(/\.\/documentaryLegacyPreparation$/, 'shared-passages', `
        import { createHash } from 'node:crypto';
        import { planRetrievalChunks } from '../extraction/textExtractor';
        import { embedMany } from './aiClient';
        export async function prepareLegacyDocumentaryPassages(id,text,sourceMap,coverage,signal){
          const chunks=planRetrievalChunks(text,{sourceMap});
          const vectors=await embedMany(chunks.map(chunk=>chunk.text),signal);
          signal?.throwIfAborted();
          return {contentHash:createHash('sha1').update(text).digest('hex'),rows:chunks.map((chunk,index)=>({...chunk,embedding:vectors[index]})),embeddingProvider:'openrouter',embeddingModel:'baai/bge-m3'};
        }
      `);
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
      stub(/\.\.\/db\/worksRepo$/, 'works-repo', `
        export function setResolvedTextState(id,state){globalThis.__documentPipeline.resolvedState={id,state}}
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
        export function resolvedTextStateFromDoc(doc){return {
          sourceType:doc.sourceType,textHash:'fixture-hash',textChars:doc.text.length,
          sourceCount:1,hasPageMarkers:false,blockReason:null,resolvedAt:'2026-08-24T00:00:00.000Z',notes:doc.notes,sources:[]
        }}
        export function planRetrievalChunks(text){return [{text:text.replace(/\\[\\[p\\. \\d+\\]\\]/g,' '),pageLabel:'p. 1'}]}
      `);
      stub(/\.\.\/zotero\/zoteroClient$/, 'zotero', `export const LOCAL_USER_ID='0';export async function getItem(){return {abstract:'Resumen original'}}`);
      stub(/\.\/aiClient$/, 'ai', `
        export class AiError extends Error{constructor(message,retriable=false,config=false,code){super(message);this.retriable=retriable;this.config=config;this.code=code}}
        export function estimateLocalTokens(text){
          let units=0;
          for(const m of String(text).matchAll(/[A-Za-z0-9]+|[^A-Za-z0-9\\s]|\\s+/g)){
            const chunk=m[0];
            if(/\\s/.test(chunk[0]))continue;
            units += /[A-Za-z0-9]/.test(chunk[0]) ? Math.max(1,Math.ceil(chunk.length/4)) : 1;
          }
          return Math.ceil(units*1.5);
        }
        export async function localModelContextWindow(){return globalThis.__documentPipeline.localContextWindow ?? null}
        export function resolveModelRef(){return {provider:'openrouter',model:'stub/synthesis'}}
        export async function embedMany(texts,signal){globalThis.__documentPipeline.onEmbed?.();signal?.throwIfAborted();return texts.map((_,index)=>[1,index+1,0])}
        export async function completeJson(opts){
          const input=(()=>{try{return JSON.parse(opts.user)}catch{return {}}})();
          // Classify by request shape as well as the Spanish canonical wording so the
          // same fixture can drive the pipeline in every prompt language.
          const sectionAnalysis=opts.system.includes('Analiza íntegramente')||(input.section_title!==undefined&&input.fragment!==undefined);
          const sectionAudit=opts.system.includes('Audita un análisis de sección')||(input.analysis!==undefined&&input.fragment!==undefined);
          const profileSynthesis=opts.system.includes('Construye una ficha')||(input.metadata!==undefined&&Array.isArray(input.sections)&&input.profile===undefined);
          const documentAudit=opts.system.includes('Audita una ficha')||(input.profile!==undefined&&input.deterministic!==undefined);
          const sectionReduce=opts.system.includes('Fusiona análisis parciales')||(Array.isArray(input.analyses)&&typeof input.title==='string');
          const profileRepair=opts.system.includes('Repara la ficha')||(input.profile!==undefined&&input.audit!==undefined);
          {
            const kind = sectionAnalysis && !(input.analysis!==undefined&&input.fragment!==undefined) ? 'section'
              : sectionAudit ? 'sectionAudit' : sectionReduce ? 'reduce'
              : profileSynthesis ? 'synthesis' : documentAudit ? 'documentAudit'
              : profileRepair ? 'repair' : 'unknown';
            globalThis.__documentPipeline.promptChars.push({kind, tokens: estimateLocalTokens(opts.system + opts.user), chars: opts.user.length});
          }
          // A local server refuses a prompt its loaded window cannot hold, which is the
          // failure the pipeline has to answer by shrinking or degrading.
          if(globalThis.__documentPipeline.localContextWindow && estimateLocalTokens(opts.system+opts.user) > globalThis.__documentPipeline.localContextWindow){
            throw new AiError('El modelo local no tiene suficiente contexto para esta tarea.',false,true,'context_overflow');
          }
          if(globalThis.__documentPipeline.forceSectionSchemaFailure && sectionAnalysis){
            throw new AiError('El JSON no cumple el esquema esperado');
          }
          if(sectionAudit){globalThis.__documentPipeline.sectionAuditCalls++;return globalThis.__documentPipeline.forceSectionAuditFailure
            ? {passed:false,issues:['El proveedor insiste en rechazar la sección.'],analysis:input.analysis}
            : {passed:true,issues:[],analysis:input.analysis};
          };
          if(sectionReduce)return input.analyses[0];
          if(profileRepair)return {
            source_language:'es',overview:'La obra estudia una modernización desigual.',
            fields:[{kind:'thesis',text:'La modernización avanzó con ritmos regionales distintos.',confidence:0,centrality:1,
                     support_quote:'El proceso avanzó de manera desigual entre las regiones.',page:'p. 2'}]
          };
          if(sectionAnalysis){
            globalThis.__documentPipeline.sectionTitles.push(input.section_title);
            return {
              title:'Capítulo analizado',summary:'Expone una modernización desigual.',role:'argumento',concepts:['modernización'],
              claims:[{text:'El proceso fue desigual.',support_quote:'El proceso avanzó de manera desigual entre las regiones.',page:'p. 2',confidence:0}]
            };
          }
          if(profileSynthesis)return globalThis.__documentPipeline.forceEmptyProfile
            ? {source_language:'es',overview:'',fields:[]}
            : {source_language:'es',overview:'La obra estudia una modernización desigual.',fields:[
            {kind:'thesis',text:'La modernización avanzó con ritmos regionales distintos.',confidence:0,centrality:1,support_quote:'El proceso avanzó de manera desigual entre las regiones.',page:'p. 2'},
            {kind:'argument',text:'Este campo debe descartarse.',confidence:.2,centrality:.1,support_quote:'Esta cita no existe en el documento.',page:null}
          ]};
          if(documentAudit){
            globalThis.__documentPipeline.auditCalls++;
            globalThis.__documentPipeline.auditPayloadChars.push(opts.user.length);
            if((globalThis.__documentPipeline.auditTruncations??0) > 0){
              globalThis.__documentPipeline.auditTruncations--;
              throw new AiError('El proveedor agotó el presupuesto de salida del JSON.',true,false,'output_truncated');
            }
            const overrides=globalThis.__documentPipeline.overrides??{};
            return globalThis.__documentPipeline.forceDocumentAuditFailure ? {
            passed:false,score:.8,issues:['El auditor discrepa de la paráfrasis.'],field_fixes:[],overview:''
          } : {
            passed:overrides.auditPassed ?? true,score:overrides.auditScore ?? .95,issues:overrides.auditIssues ?? [],
            field_fixes:overrides.auditFixes ?? [{index:0,text:'La formulación auditada conserva su apoyo.',support_quote:'Una paráfrasis inexistente no puede sustituir la cita.'}],overview:''
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
  // Every character belongs to exactly one section: the structure coverage the
  // acceptance gate reads is this ratio, so a heading left outside its own range
  // used to shrink it for documents nobody had a problem with.
  const covered = sections.reduce((total, section) => total + Math.max(0, (section.charEnd ?? 0) - (section.charStart ?? 0)), 0);
  assert.equal(covered, text.length, 'sections tile the whole document without gaps or overlaps');
});

test('a document without headings gets untitled chunks instead of a language-specific placeholder', () => {
  // PDFs are extracted as "[[p. N]] + text" with no Markdown headings, so this is
  // the branch nearly every library work takes. A stored "Sección 2" here leaked
  // Spanish into profiles of users whose prompt language was Korean or English.
  const sections = pipeline.deriveDocumentStructure('El proceso avanzó de manera desigual entre las regiones. '.repeat(900), 'Obra sin encabezados');
  assert.ok(sections.length >= 2, 'a long headless document is chunked');
  assert.equal(sections[0].title, 'Obra sin encabezados', 'the first chunk carries the work title');
  assert.ok(
    sections.slice(1).every((section) => section.title === ''),
    'chunks of a headless document carry no invented title',
  );
  assert.ok(
    sections.every((section) => !/Secci[óo]n/i.test(section.title)),
    'no chunk is titled with a hard-coded Spanish placeholder',
  );
});

test('a short preamble is absorbed by the first section instead of leaving a coverage hole', () => {
  // A title block shorter than MIN_SECTION_WORDS used to belong to no section, so
  // structure coverage fell under 0.95 and the work could publish nothing at all:
  // the literal fallback also requires that same coverage, and the gap is a property
  // of the document rather than of any model's output.
  const text = `Título breve del trabajo\n# Capítulo\n${'Contenido verificable del capítulo con detalle suficiente. '.repeat(20)}`;
  const sections = pipeline.deriveDocumentStructure(text, 'Obra');
  const covered = sections.reduce((total, section) => total + Math.max(0, (section.charEnd ?? 0) - (section.charStart ?? 0)), 0);
  assert.equal(sections.length, 1, 'a short preamble does not become a section of its own');
  assert.equal(sections[0].charStart, 0, 'the first section reaches the beginning of the document');
  assert.ok(
    sections[0].body.startsWith('Título breve'),
    'the preamble is analysed with the first section rather than dropped',
  );
  assert.ok(covered / text.length >= 0.95, `the document is fully accounted for (${covered}/${text.length} chars)`);
});

test('a cover page is not a section of its own', () => {
  // A journal PDF prints its masthead first and its footnote definitions last, and neither is
  // a section: at 149 and 36 characters their analyses degraded, their summaries published as
  // literal extracts, and the whole profile fell back to the extractive mode — which is what a
  // Korean conference paper did on a live run.
  const cover = 'KIMYO INTERNATIONAL UNIVERSITY IN TASHKENT «Корееведение Центральной Азии»\n';
  const body = '한국어 논문의 본문 문장입니다. '.repeat(500);
  const footnotes = '\n[^1]: 서론 [^2]: 문헌고찰및이론적틀';
  const text = `${cover}${body}${footnotes}`;
  const sections = pipeline.deriveDocumentStructure(text, '학술 발표문');
  assert.equal(sections.length, 1, 'the cover and the footnotes join the body instead of becoming sections');
  assert.equal(sections[0].charStart, 0, 'the section reaches the beginning of the document');
  assert.equal(sections[0].charEnd, text.length, 'and the end of it');
  assert.ok(sections[0].body.includes('KIMYO INTERNATIONAL UNIVERSITY'), 'the cover text is analysed with the body, not dropped');

  // Long documents keep their real structure: only undersized chunks are folded in.
  const long = `${cover}${'본문 문장입니다. '.repeat(2_500)}\n${'두 번째 부분의 문장입니다. '.repeat(2_500)}`;
  const split = pipeline.deriveDocumentStructure(long, '학술 발표문');
  assert.ok(split.length >= 2, 'substantial chunks stay separate');
  const covered = split.reduce((total, section) => total + Math.max(0, (section.charEnd ?? 0) - (section.charStart ?? 0)), 0);
  // Chunk ends land on the last word, so trailing inter-chunk whitespace is not counted.
  assert.ok(covered / long.length >= 0.999, `and the sections still tile the document (${covered}/${long.length})`);
  assert.equal(split[0].charStart, 0, 'the first section still starts at the cover');
});

test('structure resolves combined source/page markers to durable attachment locators', () => {
  const text = `[[src:s1 p.7]]\n# Primera\n${'Texto de la primera fuente. '.repeat(90)}\n[[src:s2 p.3]]\n# Segunda\n${'Texto de la segunda fuente. '.repeat(90)}`;
  const sections = pipeline.deriveDocumentStructure(text, 'Libro', { s1: 'zotero:user:0:A', s2: 'zotero:user:0:B' });
  const first = sections.find((section) => section.title === 'Primera');
  const second = sections.find((section) => section.title === 'Segunda');
  assert.equal(first.sourceRef, 'zotero:user:0:A');
  assert.equal(first.pageStartNumber, 7);
  assert.equal(second.sourceRef, 'zotero:user:0:B');
  assert.equal(second.pageStartNumber, 3);
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

test('a legacy deep hash does not make the current resolved source look unstable', async () => {
  globalThis.__documentPipeline.sourceReads = 0;
  globalThis.__documentPipeline.changedTextAtPublication = null;
  globalThis.__documentPipeline.published = null;
  globalThis.__documentPipeline.text = `# Texto sustituido\n${'Contenido externo nuevo. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:'hash-anterior',summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  const result = await pipeline.runDocumentProfileScan(work, {
    jobId:'job-legacy-deep-hash',generatorModel:null,auditorModel:null,onProgress() {},
  });
  assert.equal(result, 'published-v1');
  assert.match(globalThis.__documentPipeline.published.expectedWorkRevision.resolvedTextHash, /^[a-f0-9]{40}$/);
  assert.equal(
    globalThis.__documentPipeline.provenance.documentFingerprint,
    globalThis.__documentPipeline.published.expectedWorkRevision.resolvedTextHash,
    'profile provenance follows the canonical resolved corpus rather than a legacy deep-analysis hash',
  );
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

test('the document-profile pipeline runs with a native prompt pack in every prompt language', async () => {
  const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko'];
  for (const language of languages) {
    globalThis.__documentPipeline.sourceReads = 0;
    globalThis.__documentPipeline.published = null;
    globalThis.__documentPipeline.text = `# Introducción\n[[p. 1]]\nLa obra plantea su problema con suficiente detalle documental.\n## Desarrollo\n[[p. 2]]\nEl proceso avanzó de manera desigual entre las regiones.\n${'Desarrollo histórico completo. '.repeat(100)}`;
    const work = {
      nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
      item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
      light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
      summary_hash:null,archived:0,notes:null,
    };
    const result = await pipeline.runDocumentProfileScan(work, {
      jobId:`job-prompt-language-${language}`, language, generatorModel:null, auditorModel:null, onProgress() {},
    });
    assert.equal(result, 'published-v1', `${language}: document profile published`);
    assert.ok(globalThis.__documentPipeline.published.audit.passed, `${language}: audit passed`);
  }
});

test('a headless document is published with analysis titles and no language-specific placeholder', async () => {
  globalThis.__documentPipeline.sourceReads = 0;
  globalThis.__documentPipeline.published = null;
  globalThis.__documentPipeline.sectionTitles = [];
  globalThis.__documentPipeline.text = 'El proceso avanzó de manera desigual entre las regiones. '.repeat(900);
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  const result = await pipeline.runDocumentProfileScan(work, {
    jobId:'job-headless-document',generatorModel:null,auditorModel:null,onProgress() {},
  });
  assert.equal(result, 'published-v1');
  const published = globalThis.__documentPipeline.published;
  assert.ok(published.sections.length >= 2, 'the headless document is sectioned by chunks');
  assert.equal(published.sections[0].title, 'Modernización', 'the first chunk keeps the work title');
  assert.ok(
    published.sections.slice(1).every((section) => section.title === 'Capítulo analizado'),
    'an untitled chunk takes the analysed title instead of a hard-coded placeholder',
  );
  assert.ok(
    published.sections.every((section) => !/Secci[óo]n/i.test(section.title)),
    'no published section title carries a language-specific placeholder',
  );
  assert.ok(
    globalThis.__documentPipeline.sectionTitles.every((title) => !/Secci[óo]n/i.test(String(title))),
    'the placeholder is never handed to the model to echo back',
  );
});

test('a markdown work with a short preamble publishes instead of failing the structure gate', async () => {
  globalThis.__documentPipeline.sourceReads = 0;
  globalThis.__documentPipeline.published = null;
  globalThis.__documentPipeline.text = `Título breve del trabajo\n# Capítulo\nEl proceso avanzó de manera desigual entre las regiones.\n${'Contenido verificable del capítulo. '.repeat(40)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  const result = await pipeline.runDocumentProfileScan(work, {
    jobId:'job-short-preamble',generatorModel:null,auditorModel:null,onProgress() {},
  });
  assert.equal(result, 'published-v1', 'a short preamble no longer condemns the work');
  const published = globalThis.__documentPipeline.published;
  assert.equal(published.audit.passed, true);
  assert.ok(published.audit.structureCoverage >= 0.95, `structure coverage is met (${published.audit.structureCoverage})`);
  assert.equal(published.audit.fallback, null, 'the audited synthesis is kept, not replaced by literal extracts');
});

test('provider verdicts are read in the encodings models actually use', () => {
  const normalize = pipeline.normalizeDocumentProfileAuditResponse;
  for (const passed of [true, 1, 'true', 'TRUE', 'sí', 'yes', '예']) {
    assert.equal(normalize({ passed, score: 0.9 }).passed, true, `an affirmative ${JSON.stringify(passed)} is an approval`);
  }
  for (const passed of [false, 0, 'false', 'no', '', undefined]) {
    assert.equal(normalize({ passed, score: 0.9 }).passed, false, `${JSON.stringify(passed)} is not an approval`);
  }
  // A missing verdict stays rejected: an absent field can never be promoted to passed.
  assert.equal(normalize({ score: 0.99 }).passed, false);
});

test('provider scores are read as fractions, percentages and comma decimals', () => {
  const score = (value) => pipeline.normalizeDocumentProfileAuditResponse({ passed: true, score: value }).score;
  assert.equal(score(0.85), 0.85);
  assert.equal(score('0.85'), 0.85);
  assert.equal(score('85%'), 0.85, 'a percentage string is not zero');
  assert.equal(score('0,85'), 0.85, 'a comma decimal is not zero');
  assert.equal(score(85), 0.85, 'a score out of a hundred is not a perfect score');
  assert.equal(score(1), 1);
  assert.equal(score(0), 0, 'a reported zero stays a zero');
  assert.equal(score(undefined), null, 'no reading is distinguishable from a low reading');
  assert.equal(score('sin puntuación'), null);
});

test('a synthesis the auditor did not approve is published as partial, not thrown away', async () => {
  globalThis.__documentPipeline.sourceReads = 0;
  globalThis.__documentPipeline.published = null;
  globalThis.__documentPipeline.text = `# Introducción\n[[p. 1]]\nLa obra plantea su problema.\n## Desarrollo\n[[p. 2]]\nEl proceso avanzó de manera desigual entre las regiones.\n${'Desarrollo histórico completo. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  // One hundredth under the acceptance bar used to replace the whole audited synthesis
  // with raw quotations.
  globalThis.__documentPipeline.overrides = { auditScore: 0.79 };
  let result;
  try {
    result = await pipeline.runDocumentProfileScan(work, {
      jobId:'job-partial-mode',generatorModel:null,auditorModel:null,onProgress() {},
    });
  } finally {
    globalThis.__documentPipeline.overrides = {};
  }
  assert.equal(result, 'published-v1', 'a marginal score no longer prevents publication');
  const published = globalThis.__documentPipeline.published;
  assert.equal(published.audit.fallback, 'partial', 'the profile declares it was not semantically approved');
  assert.equal(published.profile.fallbackMode, 'partial');
  assert.equal(published.audit.passed, false, 'the semantic verdict is reported as it was');
  assert.equal(published.audit.score, 0.79, 'and its score with it');
  assert.equal(published.fields[0].text, 'La modernización avanzó con ritmos regionales distintos.',
    'the audited prose is kept, not replaced by literal extracts');
  assert.equal(published.fields[0].confidenceSource, 'floor');
  assert.equal(published.audit.supportCoverage, 1);
  assert.ok(published.supports.every((support) => support.validationStatus === 'valid'));
});

test('an auditor that rejects the profile still gets its corrections applied', async () => {
  globalThis.__documentPipeline.sourceReads = 0;
  globalThis.__documentPipeline.published = null;
  globalThis.__documentPipeline.text = `# Introducción\n[[p. 1]]\nLa obra plantea su problema.\n## Desarrollo\n[[p. 2]]\nEl proceso avanzó de manera desigual entre las regiones.\n${'Desarrollo histórico completo. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  // The auditor refuses the profile but says exactly which field is wrong and how to fix
  // it. Those corrections used to be dropped unless the verdict was positive.
  globalThis.__documentPipeline.overrides = {
    auditPassed: false,
    auditScore: 0.6,
    auditIssues: ['El apoyo no es literal.'],
    auditFixes: [{ index: 0, text: 'Texto corregido por el auditor.', support_quote: 'Desarrollo histórico completo.' }],
  };
  let result;
  try {
    result = await pipeline.runDocumentProfileScan(work, {
      jobId:'job-rejected-with-fixes',generatorModel:null,auditorModel:null,onProgress() {},
    });
  } finally {
    globalThis.__documentPipeline.overrides = {};
  }
  assert.equal(result, 'published-v1');
  const published = globalThis.__documentPipeline.published;
  assert.equal(
    published.fields[0].text, 'Texto corregido por el auditor.',
    'the correction survives the repair passes that follow a rejected verdict',
  );
  assert.equal(published.supports[0].quote, 'Desarrollo histórico completo.', 'and its literal support is the one the auditor named');
  assert.equal(published.audit.fallback, 'partial', 'the verdict itself is still reported as not approved');
  assert.deepEqual(published.audit.issues, ['El apoyo no es literal.']);
});

test('a truncated audit is retried with a compact payload instead of discarding the synthesis', async () => {
  globalThis.__documentPipeline.sourceReads = 0;
  globalThis.__documentPipeline.published = null;
  globalThis.__documentPipeline.auditCalls = 0;
  globalThis.__documentPipeline.auditPayloadChars = [];
  globalThis.__documentPipeline.text = `# Introducción\n[[p. 1]]\nLa obra plantea su problema.\n## Desarrollo\n[[p. 2]]\nEl proceso avanzó de manera desigual entre las regiones.\n${'Desarrollo histórico completo. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  // One audit answer hits the output ceiling. That used to end the loop with no verdict
  // and no repair, which handed the whole synthesis to the extractive fallback.
  globalThis.__documentPipeline.auditTruncations = 1;
  const result = await pipeline.runDocumentProfileScan(work, {
    jobId:'job-truncated-audit',generatorModel:null,auditorModel:null,onProgress() {},
  });
  assert.equal(result, 'published-v1');
  const published = globalThis.__documentPipeline.published;
  assert.equal(globalThis.__documentPipeline.auditCalls, 2, 'the truncated answer is retried, not abandoned');
  assert.ok(
    globalThis.__documentPipeline.auditPayloadChars[1] < globalThis.__documentPipeline.auditPayloadChars[0],
    `the retry sends a smaller payload (${globalThis.__documentPipeline.auditPayloadChars.join(' then ')})`,
  );
  assert.equal(published.audit.fallback, null, 'the retried verdict approves the profile');
  assert.equal(published.audit.passed, true);
  assert.equal(published.audit.score, 0.95, 'and the verdict the retry produced is the one published');
  assert.equal(published.fields.length, 1, 'the synthesis is kept');
});

test('a profile approved as a whole still reports the sections that lost their synthesis', async () => {
  globalThis.__documentPipeline.sourceReads = 0;
  globalThis.__documentPipeline.published = null;
  globalThis.__documentPipeline.text = `# Introducción\n[[p. 1]]\nLa obra plantea su problema.\n## Desarrollo\n[[p. 2]]\nEl proceso avanzó de manera desigual entre las regiones.\n${'Desarrollo histórico completo. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  // Every section audit refuses the synthesis while the document audit approves the
  // profile: the published record used to say nothing about the degraded sections.
  globalThis.__documentPipeline.forceSectionAuditFailure = true;
  let result;
  try {
    result = await pipeline.runDocumentProfileScan(work, {
      jobId:'job-degraded-sections',generatorModel:null,auditorModel:null,onProgress() {},
    });
  } finally {
    globalThis.__documentPipeline.forceSectionAuditFailure = false;
  }
  assert.equal(result, 'published-v1');
  const published = globalThis.__documentPipeline.published;
  assert.equal(published.audit.fallback, null, 'the document-level audit approved the profile');
  assert.equal(published.audit.passed, true);
  assert.equal(
    published.audit.sectionsDegraded, published.sections.length,
    'and the degraded sections are still declared',
  );
  assert.ok(published.audit.sectionsDegraded > 0);
});

test('a local model with a small window gets prompts sized to fit it', async () => {
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'pdf',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  const text = 'El proceso avanzó de manera desigual entre las regiones. '.repeat(900);
  const runOnce = async (window, jobId) => {
    globalThis.__documentPipeline.sourceReads = 0;
    globalThis.__documentPipeline.published = null;
    globalThis.__documentPipeline.promptChars = [];
    globalThis.__documentPipeline.text = text;
    globalThis.__documentPipeline.localContextWindow = window;
    try {
      const result = await pipeline.runDocumentProfileScan(work, { jobId, generatorModel:null, auditorModel:null, onProgress() {} });
      assert.equal(result, 'published-v1', `${jobId} published`);
    } finally {
      globalThis.__documentPipeline.localContextWindow = null;
    }
    return globalThis.__documentPipeline.promptChars.slice();
  };
  // A cloud model: no window to respect, prompts keep their fixed size.
  const unbudgeted = await runOnce(null, 'job-budget-none');
  // A local model that loaded a 4k window: the budget is 60 % of it.
  const budgeted = await runOnce(4000, 'job-budget-4k');
  const count = (calls, kind) => calls.filter((call) => call.kind === kind).length;
  assert.ok(count(budgeted, 'section') > count(unbudgeted, 'section'),
    `a small window splits the evidence further (${count(unbudgeted, 'section')} → ${count(budgeted, 'section')} section calls)`);
  const budget = Math.floor(4000 * 0.6);
  for (const call of budgeted) {
    assert.ok(call.tokens <= budget * 1.05, `${call.kind} prompt is ${call.tokens} tokens against a ${budget}-token budget`);
  }
  assert.ok(budgeted.length > 0);

  // A window smaller than the instruction packs themselves: nothing can be made to fit, so
  // the promise is that the work degrades and still publishes instead of failing outright.
  const tiny = await runOnce(1200, 'job-budget-tiny');
  assert.ok(tiny.length > 0);
  const published = globalThis.__documentPipeline.published;
  assert.ok(published, 'a model too small for the task leaves a published profile, not a failed work');
  assert.ok(published.audit.fallback === 'extractive' || published.audit.fallback === 'partial');
  assert.ok(published.audit.sectionsDegraded > 0 || published.audit.fallback === 'extractive');
  assert.equal(globalThis.__documentPipeline.states.some((state) => state.status === 'failed'), false,
    'no failure state is recorded');
});

test('the extractive fallback reports its own mode and names a floor-derived confidence', async () => {
  globalThis.__documentPipeline.forceEmptyProfile = true;
  globalThis.__documentPipeline.published = null;
  globalThis.__documentPipeline.text = `# Introducción\n[[p. 1]]\nLa obra plantea su problema con detalle suficiente para construir una ficha literal verificable.\n## Desarrollo\n[[p. 2]]\nEl proceso avanzó de manera desigual entre las regiones.\n${'Desarrollo histórico completo. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  const result = await pipeline.runDocumentProfileScan(work, {
    jobId:'job-extractive-mode',generatorModel:null,auditorModel:null,onProgress() {},
  });
  globalThis.__documentPipeline.forceEmptyProfile = false;
  assert.equal(result, 'published-v1');
  const published = globalThis.__documentPipeline.published;
  assert.equal(published.audit.fallback, 'extractive', 'a published literal fallback declares its mode');
  assert.equal(published.profile.fallbackMode, 'extractive');
  assert.ok(
    published.fields.every((field) => field.confidenceSource === 'floor'),
    'fields no provider ever scored are marked as floor-derived, not as measured',
  );
  assert.equal(
    published.audit.score, null,
    'no synthesis ever cleared the audit, so the profile reports no semantic reading instead of the floor',
  );
  assert.equal(
    published.qualityScore, null,
    'without a semantic reading there is no quality to report, and certainly not 100 %',
  );
  assert.ok(published.audit.issues.includes('fallback_extractivo_determinista'));
});

test('an audited synthesis is not flagged as a fallback and names the confidence it substituted', async () => {
  globalThis.__documentPipeline.sourceReads = 0;
  globalThis.__documentPipeline.published = null;
  globalThis.__documentPipeline.text = `# Introducción\n[[p. 1]]\nLa obra plantea su problema.\n## Desarrollo\n[[p. 2]]\nEl proceso avanzó de manera desigual entre las regiones.\n${'Desarrollo histórico completo. '.repeat(100)}`;
  const work = {
    nodus_id:'w1',zotero_key:'Z1',zotero_version:1,title:'Modernización',authors_json:'["Autora"]',year:2024,
    item_type:'book',doi:null,read_tag:0,manual_deep:0,deep_trigger:null,source_type:'markdown',light_status:'done',
    light_at:null,light_hash:null,deep_status:'done',deep_at:null,deep_hash:null,summary_status:'none',summary_at:null,
    summary_hash:null,archived:0,notes:null,
  };
  const result = await pipeline.runDocumentProfileScan(work, {
    jobId:'job-confidence-source',generatorModel:null,auditorModel:null,onProgress() {},
  });
  assert.equal(result, 'published-v1');
  const published = globalThis.__documentPipeline.published;
  assert.equal(published.audit.fallback, null, 'an audited synthesis is not flagged as a fallback');
  const field = published.fields[0];
  assert.equal(field.confidence, 0.8);
  assert.equal(
    field.confidenceSource, 'floor',
    'the provider reported zero confidence, so the published number is the deterministic floor',
  );
});

test('a retained field names a floor substitution but keeps a measured confidence as measured', () => {
  const text = 'El proceso avanzó de manera desigual entre las regiones.';
  const retained = pipeline.retainLiterallySupportedFields(text, {
    source_language: 'es',
    overview: '',
    fields: [
      { kind: 'thesis', text: 'Síntesis apoyada.', confidence: 0.34, centrality: 1, support_quote: text, page: null },
      { kind: 'argument', text: 'Formulación medida.', confidence: 0.91, centrality: 0.6, support_quote: text, page: null },
      { kind: 'finding', text: 'Apoyo inexistente.', confidence: 0.99, centrality: 0.5, support_quote: 'Esta cita no está en el texto.', page: null },
    ],
  });
  assert.equal(retained.fields.length, 2, 'a field without literal support is dropped, never published');
  assert.deepEqual(
    retained.fields.map((field) => [field.confidence, field.confidenceSource]),
    [[0.8, 'floor'], [0.91, 'model']],
    'the floor is reported as a minimum and a real reading stays a reading',
  );
  const repeated = pipeline.retainLiterallySupportedFields(text, retained);
  assert.deepEqual(
    repeated.fields.map((field) => [field.confidence, field.confidenceSource]),
    [[0.8, 'floor'], [0.91, 'model']],
    're-running retention after an audit pass cannot relabel a substituted floor as measured',
  );
});
