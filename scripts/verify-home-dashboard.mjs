// Render real Home components against offline fixtures; verify layout, themes and navigation.
// NODUS_HOME_SCREENSHOTS=/absolute/path node scripts/verify-home-dashboard.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'nodus-home-ui-'));
const captures = process.env.NODUS_HOME_SCREENSHOTS;
const vaults = ['academic','genealogy','databases','estudio','docencia','worldbuilding','testimonios','primary-sources','prosopography'];
const vaultTitles = {academic:'Académico',genealogy:'Genealogía',databases:'Bases de datos',estudio:'Estudio',docencia:'Docencia',worldbuilding:'Worldbuilding',testimonios:'Testimonios','primary-sources':'Fuentes primarias',prosopography:'Prosopografía'};
const errors = [];
let browser, server;
try {
  await build({entryPoints:[path.join(root,'scripts/fixtures/home-dashboard/preview.tsx')],bundle:true,loader:{'.webp':'dataurl'},platform:'browser',format:'esm',outfile:path.join(temp,'app.js'),tsconfig:path.join(root,'tsconfig.json')});
  const config = (await import(path.join(root,'tailwind.config.js'))).default;
  config.content = [path.join(root,'src/**/*.{ts,tsx}')];
  const css = await postcss([tailwindcss(config)]).process(await readFile(path.join(root,'src/index.css'),'utf8'),{from:path.join(root,'src/index.css')});
  await writeFile(path.join(temp,'app.css'),css.css);
  await writeFile(path.join(temp,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script type="module" src="app.js"></script></body></html>');
  server=createServer(async(req,res)=>{try {const name=new URL(req.url,'http://localhost').pathname;const file=name==='/'?'index.html':name.slice(1);if(!['index.html','app.js','app.css'].includes(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(temp,file)));}catch{res.writeHead(500).end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:process.platform==='darwin'?{channel:'chrome'}:{})});
  const page=await browser.newPage();
  page.on('pageerror',error=>errors.push(String(error)));
  async function open(vault,theme,width,extra={}) {
    await page.setViewportSize({width,height:1000});
    await page.goto(`http://127.0.0.1:${server.address().port}/?${new URLSearchParams({vault,theme,...extra})}`);
    await page.locator('.home-accent-card').first().waitFor();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  }
  let cases=0;
  for(const vault of vaults) for(const theme of ['dark','light']) for(const width of [1024,1280,1440,1920]) {
    await open(vault,theme,width);
    const issues=await page.evaluate(()=>{
      const issues=[];
      const dashboard=document.querySelector('.home-dashboard');
      if(dashboard.scrollWidth>dashboard.clientWidth+1) issues.push('dashboard horizontal overflow');
      for(const card of document.querySelectorAll('.home-accent-card')) {
        const box=card.getBoundingClientRect();
        for(const element of card.querySelectorAll('h2,.home-status-summary,.home-status-action button,.home-metric-label')) {
          const r=element.getBoundingClientRect();
          if(r.left<box.left||r.right>box.right+1) issues.push(`outside card: ${element.textContent}`);
          if(element.scrollWidth>element.clientWidth+1) issues.push(`clipped text: ${element.textContent}`);
        }
        const title=card.querySelector('.home-status-title'),button=card.querySelector('.home-status-action button');
        if(title&&button&&title.getBoundingClientRect().bottom>button.getBoundingClientRect().top) issues.push('title/action overlap');
        const background=getComputedStyle(card).backgroundColor;
        if(background!==(document.documentElement.classList.contains('light')?'rgb(255, 255, 255)':'rgb(23, 23, 23)')) issues.push(`non-neutral surface ${background}`);
        if(parseFloat(getComputedStyle(card,'::before').height)<2) issues.push('missing accent');
      }
      return issues;
    });
    assert.deepEqual(issues,[],`${vault} ${theme} ${width}`);
    cases++;
  }
  for(const vault of ['academic','genealogy']) for(const theme of ['dark','light']) for(const lang of ['es','en','de','fr','it','pt','pt-BR','tr']) {
    await open(vault,theme,1280,{lang,sidebar:'360',scale:'1.3'});
    const clipped=await page.locator('.home-status-card h2,.home-status-summary,.home-status-action button,.home-metric-label').evaluateAll(elements=>elements.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent));
    assert.deepEqual(clipped,[],`${vault} ${theme} ${lang} wide sidebar / large text`);
    assert.equal(await page.locator('.home-dashboard').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
    cases++;
  }
  await open('academic','dark',1920);
  const button=page.locator('.home-status-action button').first();
  assert.deepEqual(await button.evaluate(e=>({size:getComputedStyle(e).fontSize,padding:getComputedStyle(e).padding})),{size:'12px',padding:'5px 10px'});
  await button.click();
  assert.deepEqual(await page.evaluate(()=>window.__homeActions.at(-1)),{name:'onNavigate',args:['library']});
  for(const theme of ['dark','light']) {
    await open('academic',theme,1280);
    const fills=await page.locator('.home-status-badges > span').evaluateAll(elements=>elements.map(e=>getComputedStyle(e).backgroundColor));
    assert(fills.every(fill=>fill===(theme==='dark'?'rgb(31, 31, 31)':'rgb(250, 250, 250)')),`${theme} neutral badges`);
  }
  for(const vault of vaults) {
    await open(vault,'light',1024,{empty:'1',demo:'1'});
    assert.equal(await page.locator('.home-dashboard').evaluate(e=>e.scrollWidth>e.clientWidth+1),false,`${vault} empty/demo layout`);
    cases++;
  }
  assert.deepEqual(errors,[]);
  if(captures) {
    await mkdir(captures,{recursive:true});
    for(const vault of vaults) for(const theme of ['dark','light']) {
      await open(vault,theme,1600,{sidebar:'0'});
      await page.evaluate(()=>{for(const e of document.querySelectorAll('html,body,#root,main,.home-dashboard')){e.style.height='auto';e.style.overflow='visible';}});
      await page.screenshot({path:path.join(captures,`${vault}-${theme}.png`),fullPage:true});
    }
    await open('academic','dark',1280);
    await page.evaluate(()=>{for(const e of document.querySelectorAll('html,body,#root,main,.home-dashboard')){e.style.height='auto';e.style.overflow='visible';}});
    await page.screenshot({path:path.join(captures,'academic-1280-dark.png'),fullPage:true});
    await writeFile(path.join(captures,'index.html'),`<!doctype html><html lang="es"><meta charset="utf-8"><title>PR 667 · Inicio de los vaults</title><style>body{font:16px system-ui;margin:32px;background:#eee;color:#222}section{margin:32px 0}div{display:grid;grid-template-columns:1fr 1fr;gap:20px}img{width:100%;border-radius:12px}a{color:inherit}h1{margin-bottom:8px}</style><h1>Inicio de los vaults · PR 667</h1><p>Componentes reales con datos de prueba locales. Izquierda: oscuro. Derecha: claro.</p>${vaults.map(v=>`<section><h2>${vaultTitles[v]}</h2><div>${['dark','light'].map(t=>`<a href="${v}-${t}.png"><img loading="lazy" src="${v}-${t}.png" alt="${v} ${t}"></a>`).join('')}</div></section>`).join('')}</html>`);
  }
  console.log(`Home dashboard: ${cases} layout/theme cases passed; navigation, compact actions and neutral badges verified.`);
} finally {
  await browser?.close();
  if(server) await new Promise(resolve=>server.close(resolve));
  await rm(temp,{recursive:true,force:true});
}
