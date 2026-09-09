import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import AdmZip from 'adm-zip';
const root = path.resolve(import.meta.dirname, '..'), scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-legalize-test-'));
const bundle = path.join(scratch, 'test.cjs');
await build({ stdin: { contents: `export * from './shared/legalize'; export * from './shared/chatSkills'; export * from './electron/legalize'; export * from './electron/chatSkills'; export * from './electron/ai/chatSkillExecution';`, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'isolate', setup(b) {
  for (const [filter, name] of [[/skillToolSandbox$/, 'tools'], [/^electron$/, 'electron'], [/chatSvgQuality$/, 'svg'], [/decorativeImages$/, 'image'], [/settingsRepo$/, 'settings'], [/chemistryIdentity$/, 'chemistry'], [/chemistryValidationHost$/, 'validate']]) b.onResolve({ filter }, () => ({ path: name, namespace: 'mock' }));
  b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({ contents: name === 'electron' ? `export const app = { getPath: () => ${JSON.stringify(scratch)}, getAppPath: () => ${JSON.stringify(root)}, isPackaged: false }; export const safeStorage = {};`
    : name === 'tools' ? 'export const runSkillTool = () => { throw Error("Unexpected custom skill tool"); };'
    : name === 'svg' ? 'export const refineChatSvg = async a => a;'
    : name === 'image' ? 'export const callImageProvider = () => { throw Error("Unexpected image"); }; export const prepareGeneratedImage = () => {};'
    : name === 'settings' ? 'export const getSettings = () => ({});'
    : name === 'chemistry' ? 'export const resolveChemistryIntent = () => { throw Error("Unexpected chemistry"); };'
    : 'export const validateChemistryInUtility = () => {};'}));
} }] });
const lib = createRequire(import.meta.url)(bundle);
test.after(() => fs.rmSync(scratch, { force: true, recursive: true }));
const c = lib.LEGALIZE_COUNTRIES.find(c => c.code === 'es');
const law = (id = 'TEST-1', title = 'Ley de prueba') => `---\ntitle: "${title}"\nidentifier: "${id}"\ncountry: "es"\nsource: "https://www.boe.es/test"\nlast_updated: "2026-01-02"\nstatus: "in_force"\nreuse: "preserve this original metadata"\n---\n# ${title}\n\n##### Artículo 1. Ámbito\nTexto sintético, no es una ley real.\n\n##### Artículo 2. Cierre\nOtro artículo.\n`;
const plan = { version: 1, country: 'es', query: 'TEST-1', article: '1' };
let calls = [], changed = false, pending;
const fetcher = async (url, options) => {
  calls.push(url); options.signal.throwIfAborted();
  if (pending) await pending();
  if (url.endsWith('/git/ref/heads/main')) return new Response(JSON.stringify({ object: { sha: c.revision } }));
  if (url.endsWith('/LICENSE')) return new Response(changed ? 'changed' : fs.readFileSync(path.join(root, 'legal/generated/LEGALIZE_ES_LICENSE.txt')));
  if (url.endsWith('/README.md')) return new Response(fs.readFileSync(path.join(root, 'legal/generated/LEGALIZE_ES_README.md')));
  if (url.endsWith('/es/TEST-1.md')) return new Response(law());
  if (url.includes('codeload.github.com')) { const zip = new AdmZip(); zip.addFile('root/es/TEST-1.md', Buffer.from(law())); zip.addFile('root/es-md/TEST-2.md', Buffer.from(law('TEST-2','Ley segunda'))); return new Response(zip.toBuffer()); }
  if (url.endsWith('/es-md/TEST-2.md')) return new Response(law('TEST-2','Ley segunda'));
  return new Response('', { status: 404 });
};
test('fresh profiles only activate image/SVG; older implicit and explicit chemistry settings survive', () => {
  lib.initializeChatSkillDefaults();
  for (const surface of ['assistant','nodi']) assert.deepEqual(lib.enabledChatSkills(surface).map(s => s.builtin).sort(), ['image','svg']);
  const file = path.join(scratch, 'chat-skills.json'); fs.unlinkSync(file);
  fs.writeFileSync(path.join(scratch, 'app-prefs.json'), '{}'); lib.initializeChatSkillDefaults();
  assert.equal(lib.enabledChatSkills('assistant').some(s => s.builtin === 'chemistry'), true);
  const custom = { ...lib.DEFAULT_CHAT_SKILLS.find(s => s.builtin === 'chemistry'), instructions: 'Keep my edits', enabled: { assistant: false, nodi: true } };
  fs.writeFileSync(file, JSON.stringify({ version: 11, skills: [custom] }));
  const migrated = lib.listChatSkills(); assert.deepEqual(migrated[0], custom); assert.equal(migrated[1].builtin, 'legal'); assert.deepEqual(migrated[1].enabled, { assistant: false, nodi: false });
  lib.deleteChatSkill(migrated[1].id); assert.equal(lib.listChatSkills().length, 1); assert.equal(lib.listChatSkills()[0].enabled.nodi, true);
});
test('plans require explicit country/query/article and reject extra URLs or inferred fields', () => {
  assert.deepEqual(lib.parseLegalPlan(JSON.stringify(plan), 'España: TEST-1 artículo 1'), plan);
  for (const [p,q] of [[plan,'TEST-1 artículo 1'],[plan,'Spain TEST-9 artículo 1'],[plan,'España TEST-1 artículo 11'],[{...plan,url:'https://evil.test'},'España TEST-1 artículo 1'],[{...plan,country:'zz'},'Country: zz TEST-1 article 1']]) assert.throws(() => lib.parseLegalPlan(JSON.stringify(p),q));
  assert.throws(() => lib.legalRepositoryUrl('es',c.revision,'../secret.md'));
});
test('exact retrieval keeps source, version, complete article boundaries and attribution in exports', async () => {
  calls=[]; const r = await lib.retrieveLegalize(plan, undefined, { fetch: fetcher, cacheDir: scratch });
  assert.equal(r.document.id,'TEST-1'); assert.match(r.document.text,/Texto sintético/); assert.doesNotMatch(r.document.text,/Otro artículo/);
  assert.match(r.document.metadata,/preserve this/); assert.match(r.attribution,/meramente informativo/);
  assert.match(lib.exportLegalText(lib.validateLegalResult(JSON.stringify(r))),/Enrique López/); assert.equal(calls.some(u=>u.includes('codeload')),false);
  assert.throws(()=>lib.selectLegalArticle(law(),'9'),/encabezado/);
});
test('title search uses snapshot paths, caches the index and returns honest ambiguity', async () => {
  calls=[]; const r = await lib.retrieveLegalize({...plan,query:'Ley segunda',article:undefined},undefined,{fetch:fetcher,cacheDir:scratch});
  assert.equal(r.document.path,'es-md/TEST-2.md'); assert.equal(calls.some(u=>u.includes('codeload')),true);
  calls=[]; const many = await lib.retrieveLegalize({...plan,query:'Ley',article:undefined},undefined,{fetch:fetcher,cacheDir:scratch});
  assert.equal(many.totalMatches,2); assert.equal(many.document,undefined); assert.equal(calls.some(u=>u.includes('codeload')),false);
});
test('changed licence halts before law retrieval; cancellation is propagated', async () => {
  calls=[]; changed=true; await assert.rejects(lib.retrieveLegalize(plan,undefined,{fetch:fetcher}),/avisos/); changed=false;
  assert.equal(calls.some(u=>u.endsWith('TEST-1.md')),false);
  const controller=new AbortController();controller.abort();await assert.rejects(lib.retrieveLegalize(plan,controller.signal,{fetch:fetcher}),{name:'AbortError'});
});
test('chat execution accepts only enabled current plans, replaces unverified prose and rejects forged results', async () => {
  const original=globalThis.fetch; globalThis.fetch=fetcher;
  const execution={skills:lib.DEFAULT_CHAT_SKILLS.filter(s=>s.builtin==='legal'),question:'España TEST-1 artículo 1',version:0,isCurrent:()=>true};
  const fence='```legal-plan\n'+JSON.stringify(plan)+'\n```';
  try {
    const answer=await lib.executeChatSkills('Unverified legal claim\n'+fence,execution);
    assert.doesNotMatch(answer,/Unverified legal claim/);assert.equal(lib.splitChatVisuals(answer).find(p=>p.kind==='legal-result')?.kind,'legal-result');
    calls=[];await lib.executeChatSkills(fence,{...execution,skills:[]});await lib.executeChatSkills(answer,execution);await lib.executeChatSkills(fence+fence,execution);assert.equal(calls.length,0);
    let current=true;pending=async()=>{current=false};await assert.rejects(lib.executeChatSkills(fence,{...execution,isCurrent:()=>current}),{name:'AbortError'});
  } finally {pending=undefined;globalThis.fetch=original;}
});
test('every supported country ships exact reviewed licences/readmes and visible attribution',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'legal/remote-notices.json')));
  for(const country of lib.LEGALIZE_COUNTRIES) for(const suffix of ['LICENSE.txt','README.md']) {
    const name=`LEGALIZE_${country.code.toUpperCase()}_${suffix}`;
    assert.ok(manifest.files.find(f=>f.destination===name && f.url.includes(country.revision)));
    assert.ok(fs.existsSync(path.join(root,'legal/generated',name)));assert.ok(country.sourceName);assert.ok(country.termsUrl);
  }
});
