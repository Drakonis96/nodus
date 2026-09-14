import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const temp = await mkdtemp(path.join(os.tmpdir(), 'nodus-document-skills-'));
await build({ entryPoints: ['shared/documentSkills.ts'], bundle: true, platform: 'node', format: 'esm', outfile: path.join(temp, 'policy.mjs') });
const { validateDocumentSkillPolicy: validate, defaultDocumentSkillPolicy: defaults, DocumentSkillBudget: Budget, documentBlocks } = await import(pathToFileURL(path.join(temp, 'policy.mjs')));
const options = ['svg', 'paid', 'unknown'].map((id,index) => ({ skill: { id, name: id, enabled: { assistant: true } }, billing: ['none', 'per-call', 'unknown'][index], available: true }));
const policy = (maxCalls = 4, skillId = 'svg') => ({ enabled: true, skills: [{ skillId, enabled: true, maxCalls }] });

test('defaults allow optional free resources, never implicit spending', () => {
  assert.deepEqual(defaults(options).skills.map(item => [item.enabled,item.maxCalls]), [[true,'auto'],[false,null],[false,null]]);
});
test('numeric ceilings are validated for paid and unknown skills', () => {
  for (const id of ['paid','unknown']) for (const value of ['auto',null,0,-1,1.5,NaN,Infinity,'4']) assert.throws(() => validate(policy(value,id), options));
  assert.equal(validate(policy(4,'paid'), options).skills[0].maxCalls, 4);
  assert.equal(validate(policy('auto'), options).skills[0].maxCalls, 'auto');
});
test('disabled or unavailable skills cannot be executed even when prompted', () => {
  const value = policy(); value.skills[0].enabled = false;
  assert.throws(() => new Budget(value, {}).reserve('svg'));
  assert.throws(() => validate(policy(4,'missing'), options));
  assert.throws(() => validate(policy(), [{ ...options[0], available: false }]));
});
test('four is a ceiling, with no requirement to consume any calls', () => {
  const usage = {}; const budget = new Budget(policy(), usage);
  assert.deepEqual(usage, {});
  budget.reserve('svg'); assert.equal(usage.svg.attempts,1);
  assert.equal(budget.remaining('svg'),3);
  for (let i=0;i<3;i++) budget.reserve('svg');
  assert.throws(() => budget.reserve('svg'));
  assert.equal(usage.svg.attempts,4);
});
test('concurrent dispatch reservations and nested paid calls cannot exceed the ceiling', async () => {
  const usage = {}; let persisted = 0;
  const budget = new Budget(policy(4,'paid'), usage, () => persisted++);
  const results = await Promise.allSettled(Array.from({length:9}, async () => budget.reserve('paid')));
  assert.equal(results.filter(result => result.status === 'fulfilled').length,4);
  for(let i=0;i<4;i++) budget.reserve('paid','paidCalls');
  assert.throws(() => budget.reserve('paid','paidCalls'));
  assert.equal(persisted,8);
  const resumed = new Budget(policy(4,'paid'), JSON.parse(JSON.stringify(usage)));
  assert.throws(() => resumed.reserve('paid'));
});
test('blocks preserve fenced resources and deterministic source positions', () => {
  const blocks = documentBlocks({ body: '# Title\n\nA paragraph.\n\n```svg\n<svg>\n\n</svg>\n```\n\nLast.' });
  assert.equal(blocks.length,4);
  assert.equal(blocks[2].endLine,9);
  assert.match(blocks[2].markdown, /<svg>\n\n<\/svg>/);
  assert.equal(blocks[3].id,'body:3');
});
test.after(async () => rm(temp, { recursive: true, force: true }));

test('planning context is isolated across concurrent documents and chats', async () => {
  await build({ entryPoints:['electron/ai/documentVisualContext.ts'],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'context.mjs') });
  const context=await import(pathToFileURL(path.join(temp,'context.mjs')));
  const read=()=>context.documentVisualPlanningPrompt();
  const results=await Promise.all([
    context.withDocumentVisualPlanning('[{"id":"first"}]',['first opportunity'],async()=>{await new Promise(r=>setTimeout(r,10));return read();}),
    context.withDocumentVisualPlanning('[{"id":"second"}]',[],async()=>{await Promise.resolve();return read();}),
    Promise.resolve(read()),
  ]);
  assert.match(results[0],/first opportunity/);assert.doesNotMatch(results[0],/second/);
  assert.match(results[1],/second/);assert.doesNotMatch(results[1],/first opportunity/);
  assert.equal(results[2],'');
});

test('categorical bars remain inside the plotting area, including multiple sparse series', async () => {
  await build({stdin:{contents:"export {ViewChart} from './src/components/capabilityViewData'; export {renderToStaticMarkup} from 'react-dom/server'; export {createElement} from 'react';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'esm',jsx:'automatic',alias:{'@shared':path.resolve('shared')},loader:{'.css':'empty'},banner:{js:"import {createRequire as nodeRequire} from 'node:module';const require=nodeRequire(import.meta.url);"},outfile:path.join(temp,'chart.mjs')});
  const {ViewChart,renderToStaticMarkup,createElement}=await import(pathToFileURL(path.join(temp,'chart.mjs')));
  for(const series of [
    [{label:'one',points:[['a',12],['b',8],['c',5]]}],
    [{label:'one',points:[['a',12],['c',5]]},{label:'two',points:[['b',4]]}],
  ]){
    const svg=renderToStaticMarkup(createElement(ViewChart,{node:{kind:'chart',chartType:'bar',title:'demo',alt:'demo',series}}));
    const rects=[...svg.matchAll(/<rect[^>]+>/g)];assert.ok(rects.length>=3);
    for(const [rect] of rects){const x=Number(/\bx="([^"]+)"/.exec(rect)[1]);const width=Number(/\bwidth="([^"]+)"/.exec(rect)[1]);assert.ok(x>=52 && x+width<=620,rect);}
  }
});

test('export anchors preserve prose and escape figure captions', async () => {
  await build({entryPoints:['shared/documentFigureExport.ts'],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'export.mjs')});
  const {documentFigureInsertions,documentMarkdownWithFigures}=await import(pathToFileURL(path.join(temp,'export.mjs')));
  const source='# Section\n\nOriginal paragraph.\n\nAnother paragraph.';
  const figure={id:'figure',blockId:'body:1',state:'ready',caption:'<script>bad</script>',sources:[],poster:'data:image/png;base64,YQ=='};
  const manifest={blocks:documentBlocks({body:source}),figures:[figure]};
  const insertions=documentFigureInsertions(source,'body',manifest);
  assert.equal(insertions.size,1);assert.match(insertions.get(1),/&lt;script&gt;/);
  const portable=documentMarkdownWithFigures(source,'body',manifest,'resources');
  assert.match(portable.markdown,/Original paragraph\./);assert.match(portable.markdown,/resources\/figure-figure.png/);assert.equal(portable.files.length,1);
});
