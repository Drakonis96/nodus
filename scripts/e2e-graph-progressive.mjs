import {_electron as electron} from 'playwright-core';
import {createRequire} from 'node:module';import fs from 'node:fs';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),root=process.cwd(),profile=fs.mkdtempSync('/tmp/nodus-stellar-e2e-');fs.mkdirSync(root+'/work/stellar-preview',{recursive:true});
const app=await electron.launch({executablePath:require('electron'),args:[root],env:{...process.env,NODUS_USERDATA:profile,NODUS_STELLAR_PREVIEW:'1',NODUS_DISABLE_AUTO_UPDATE:'1',NODUS_DISABLE_ANNOUNCEMENTS:'1',NODUS_QA_ROOT:profile,NODUS_QA_DATABASE_AUDIT_LOG:profile+'/database-audit.jsonl'}});
try{
const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.waitForFunction(()=>typeof window.nodus?.stellarPage==='function');
await page.evaluate(async()=>{sessionStorage.setItem('nodus.startupUpdateChecked','1');localStorage.setItem('nodus.lastSeenVersion','5.1.7');localStorage.setItem('nodus.mobileTeaserSeen.5.1.7','1');for(const key of ['nodus.platformHighlightsSeen.2026-07','nodus.tutorialVideosAnnouncementSeen.2026-07','nodus.toolkitBetaGuideSeen.2.4.0'])localStorage.setItem(key,'1');await window.nodus.updateSettings({onboardingComplete:true,basicsTutorialVersion:5,recoverySetupVersion:1,tourComplete:true,advancedTourComplete:true,mascotEnabled:false,mascotStyle:'orb',mascotStyleChosen:true,uiLanguage:'es',theme:'dark'});});
await page.evaluate(()=>window.nodus.seedDemoData());await page.reload();await page.waitForTimeout(1800);
await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1500,1000);});
await page.locator('[data-tour="nav-graph"]').click();await page.getByTestId('stellar-canvas').waitFor();
await page.waitForTimeout(1000);await page.screenshot({path:root+'/work/stellar-preview/start.png'});
const report=await page.evaluate(async()=>{const first=await window.nodus.stellarPage({kind:'search',limit:20});for(const n of first.nodes){const p=await window.nodus.stellarPage({kind:'neighbors',id:n.id,limit:200});if(p.edges.length>2)return {node:n,neighbors:p};}return {node:first.nodes[0]};});
assert.ok(report.node,'real ideas loaded');
await page.locator('.stellar-search input').fill(report.node.label);await page.waitForTimeout(600);await page.locator('.stellar-search-results button').first().click();
const click = name => page.getByRole('button', { name, exact: true }).evaluate(button => button.click());
const frame = async () => {
  await page.waitForTimeout(900);
  const visible = await page.evaluate(() => {
    const canvas = document.querySelector('.stellar-canvas').getBoundingClientRect();
    const player = document.querySelector('.stellar-player').getBoundingClientRect();
    return [...document.querySelectorAll('.stellar-node-label.featured')].map(node => {
      const box = node.getBoundingClientRect();
      return box.left >= canvas.left && box.right <= canvas.right && box.top >= canvas.top && box.bottom < player.top;
    });
  });
  assert.equal(visible.length, 2, 'both relationship endpoint captions are rendered');
  assert.ok(visible.every(Boolean), 'both endpoints fit above controls in the available canvas');
};
await click('Siguiente →'); await frame();
const first = await page.locator('.stellar-step-node').evaluateAll(nodes => nodes.map(node => node.dataset.stepNode));
await click('Encuadrar'); await click('Siguiente →'); await frame();
await page.getByTitle('Alejar', {exact:true}).evaluate(button => button.click());
await click('← Anterior'); await frame();
assert.deepEqual(await page.locator('.stellar-step-node').evaluateAll(nodes => nodes.map(node => node.dataset.stepNode)), first, 'Previous restores the original relationship direction');
await page.locator('.stellar-step-node').last().click();
await page.locator('.graph-detail-panel h3').waitFor();
const detailTitle = await page.locator('.graph-detail-panel h3').innerText();
await page.getByRole('spinbutton', {name:'Límite de relaciones'}).fill('2');
await page.getByRole('combobox', {name:'Velocidad'}).selectOption('2');
await click('▶ Play'); await frame();
await page.waitForTimeout(2400); await frame();
assert.equal(await page.getByRole('button', {name:'▶ Play', exact:true}).count(), 1, 'Play stops at the exact limit');
assert.equal(await page.locator('.graph-detail-panel h3').innerText(), detailTitle, 'playback keeps the chosen detail open');
await page.waitForTimeout(650);
const saved = await page.evaluate(() => window.nodus.getStellarSession('academic:corpus'));
assert.equal(saved.session.cursor, 3, 'Play adds exactly two relationships after the first');
for (const control of ['← Anterior', 'Siguiente →']) {
  await click('Encuadrar'); await click(control); await frame();
  assert.equal(await page.locator('.graph-detail-panel h3').innerText(), detailTitle, 'transport preserves sidebar content');
}
for (const light of [false, true]) {
  await page.evaluate(light => document.documentElement.classList.toggle('light', light), light);
  await page.locator('.graph-detail-scroll').evaluate(element => element.scrollTop = 100);
  const header = await page.evaluate(() => {
    const panel = document.querySelector('.graph-detail-panel').getBoundingClientRect();
    const element = document.querySelector('.graph-detail-header'), h = element.getBoundingClientRect();
    const body = document.querySelector('.graph-detail-scroll').getBoundingClientRect();
    return {top:h.top-panel.top, gap:body.top-h.bottom, color:getComputedStyle(element).backgroundColor};
  });
  assert.ok(Math.abs(header.top) < 1 && header.gap >= 24, 'header stays at the top with space below');
  assert.match(header.color, /^rgb\(/, 'header is opaque');
  await page.screenshot({path:root+'/work/stellar-preview/demo-stellar-'+(light?'light':'dark')+'.png'});
}
await page.reload();await page.waitForTimeout(1000);await page.locator('[data-tour="nav-graph"]').click();await page.waitForTimeout(1800);
const restored = await page.evaluate(() => window.nodus.getStellarSession('academic:corpus'));
assert.deepEqual(restored.session.history, saved.session.history, 'session history survives a reload');
assert.equal(await page.getByRole('button',{name:'▶ Play',exact:true}).count(),1,'restored playback is paused');
await click('▶ Play');await frame();
assert.deepEqual(errors,[]);
console.log('Stellar E2E: search, framing after manual navigation, native direction, exact playback budget, pinned detail, opaque header, and paused restoration passed');
}finally{await app.close();fs.rmSync(profile,{recursive:true,force:true});}
