import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { academicSnapshot, publish } from './lib/nodusServerFixtures.mjs';
import { repoRoot, withServer } from './lib/nodusServerHarness.mjs';
const output=path.join(repoRoot,'output','qa','editorial-workspace');await mkdir(output,{recursive:true});
await withServer({label:'editorial-web',ai:true},async server=>{
 const spaceId=await server.createSpace('Escritura editorial');
 await server.setPublicationPolicy(spaceId,['allowUserContent']);
 const owner=await server.deviceToken(server.adminEmail,server.adminPassword,spaceId,'Editorial publisher');
 await publish(server.origin,owner.deviceToken,spaceId,academicSnapshot());
 const spaces={academic:spaceId};
 for(const type of ['estudio','docencia','genealogy','prosopography','databases','testimonios','worldbuilding']){
  const id=await server.createSpace('Editorial · '+type);spaces[type]=id;
  const publisher=await server.deviceToken(server.adminEmail,server.adminPassword,id,type+' editorial publisher');
  await publish(server.origin,publisher.deviceToken,id,academicSnapshot({vault:{id:type+'-fixture',name:'Editorial · '+type,type}}));
 }
 const reader=await server.createUser('editorial-reader@example.test','editorial-reader-password-long',Object.values(spaces).map(spaceId=>({spaceId,role:'reader'})));
 const cookie=await server.signIn(reader.email,reader.password);const csrf=await server.csrf(cookie);
 const call=(method,url,body)=>fetch(server.origin+url,{method,headers:{cookie,origin:server.origin,'x-csrf-token':csrf,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const ids=[];
 for(const title of ['La mirada turística y la memoria del paisaje','Brief · Tesis','España eterna','Archivo y patrimonio','Literatura de viajes','Notas de lectura']){
  const response=await call('POST','/api/v2/me/artifacts',{vaultId:spaceId,kind:'workspace-note',title,content:'## La memoria del paisaje\n\nEl patrimonio conecta la historia con la experiencia del viaje. Cada fuente conserva su procedencia y dialoga con el argumento.\n\n- Lectura de las fuentes\n  - Contraste de testimonios\n\n> El paisaje es también una forma de memoria.',metadata:{surface:'workspace',tags:['Memoria']}});assert.equal(response.status,201);ids.push((await response.json()).artifact.id);
 }
 const referenceResponse=await call('GET',`/api/v1/spaces/${spaceId}/editor-references`);assert.equal(referenceResponse.status,200);
 const references=(await referenceResponse.json()).items;
 assert.ok(references.some(item=>item.kind==='idea'&&item.id==='i-a'));
 assert.ok(references.some(item=>item.kind==='author'));
 assert.ok(!references.some(item=>ids.includes(item.id)),'published catalogue never includes private artifacts');
 const outsider=await server.createUser('reference-outsider@example.test','reference-outsider-password-long',[]);
 const outsiderCookie=await server.signIn(outsider.email,outsider.password);
 assert.equal((await fetch(`${server.origin}/api/v1/spaces/${spaceId}/editor-references`,{headers:{cookie:outsiderCookie}})).status,403,'reference metadata requires vault membership');
 const matrixNotes={};
 for(const [type,id] of Object.entries(spaces)){
  if(type==='academic')continue;
  const response=await call('POST','/api/v2/me/artifacts',{vaultId:id,kind:'workspace-note',title:'Documento editorial · '+type,content:'## Memoria del archivo\n\nContenido de prueba de la bóveda.',metadata:{surface:'workspace'}});assert.equal(response.status,201);matrixNotes[type]=(await response.json()).artifact.id;
 }
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.origin+'/login');await page.locator('#login-email').fill(reader.email);await page.locator('#login-password').fill(reader.password);await page.locator('button[type=submit]').click();await page.waitForURL(server.origin+'/');
  await page.getByTestId('header-vault-badge').click();await page.getByTestId('vault-option-'+spaceId).click();
  await page.evaluate(()=>localStorage.setItem('nodus-web-theme','light'));await page.goto(server.origin+'/view/workspace');await page.getByTestId('private-notes-view').waitFor();await page.getByTestId('workspace-server-item-'+ids[0]).waitFor();
  await page.goto(server.origin+'/view/toolkit');await page.getByTestId('toolkit-card-scriptor').waitFor();
  assert.equal(await page.getByTestId('toolkit-card-scriptor-pin').getAttribute('aria-pressed'),'true');
  await page.getByTestId('toolkit-card-scriptor-pin').click();await page.waitForFunction(()=>!document.querySelector('[data-tour="nav-workspace"]'));
  await page.reload();await page.getByTestId('toolkit-card-scriptor').waitFor();assert.equal(await page.getByTestId('toolkit-card-scriptor-pin').getAttribute('aria-pressed'),'false');
  await page.getByTestId('toolkit-card-scriptor-pin').click();await page.locator('[data-tour="nav-workspace"]').waitFor();
  await page.screenshot({path:path.join(output,'web-scriptor-tools-1440.png')});await page.getByTestId('toolkit-card-scriptor').click();await page.getByTestId('private-notes-view').waitFor();
  assert.equal(await page.locator('.library-header-title h1').innerText(),'Nodus Scriptor');
  assert.equal(await page.locator('.editorial-workspace').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(255, 255, 255)');
  assert.equal(await page.locator('[data-testid="nav-workspace"]').count(),1);
  for(const width of [1280,1440,1920]){await page.setViewportSize({width,height:width===1280?800:width===1440?900:1080});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(output,`web-list-${width}.png`)});}
  await page.getByRole('button',{name:/Tarjetas|Cards/,exact:true}).click();for(const width of [1280,1440,1920]){await page.setViewportSize({width,height:width===1280?800:width===1440?900:1080});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(output,`web-cards-${width}.png`)});}await page.getByRole('button',{name:/Lista|List/,exact:true}).click();
  await page.getByTestId('workspace-server-item-'+ids[0]).getByRole('button').first().click();const editor=page.locator('.nodus-blocknote .bn-editor');await editor.waitFor();
  const focusEnd=async()=>{
   const last=editor.locator('.bn-inline-content').last();
   await last.evaluate(element=>{element.closest('.bn-editor').focus();const range=document.createRange();range.selectNodeContents(element);range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
   await page.waitForTimeout(50);
  };
assert.equal(await page.locator('.editorial-document-scroll').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(255, 255, 255)');
  for(const width of [1280,1440,1920]){await page.setViewportSize({width,height:width===1280?800:width===1440?900:1080});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(output,`web-editor-${width}.png`)});}
  await page.getByRole('button',{name:/Contexto|Context/,exact:true}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(output,'web-context-1920.png')});await page.getByRole('button',{name:/Navegador de documentos|Document navigator/,exact:true}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(output,'web-navigator-1920.png')});
  await page.getByRole('button',{name:/Foco|Focus/,exact:true}).click();await page.waitForFunction(()=>Boolean(document.fullscreenElement)&&document.querySelector('[data-editorial-focus="true"]'));assert.equal(await page.locator('.editorial-inspector,.editorial-navigator').count(),0);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(output,'web-focus-1920.png')});
  await page.getByRole('button',{name:/Salir de foco|Exit focus/,exact:true}).click();await page.waitForFunction(()=>!document.fullscreenElement);
  assert.equal((await(await call('GET','/api/v2/me/artifacts/'+ids[0])).json()).artifact.metadata.nativeDocument,undefined,'legacy web notes are not converted on open');
  await page.getByRole('button',{name:/Opciones del documento|Document options/,exact:true}).click();
  const options=page.locator('.editorial-options[open] .study-editor-toolbar');
  assert.ok(await options.evaluate(element=>element.scrollWidth<=element.clientWidth+1),'web options have no horizontal scrolling');
  await page.screenshot({path:path.join(output,'web-options-1920.png')});
  await page.getByRole('button',{name:/Enlazar con Nodus|Link to Nodus/,exact:true}).click();
  await page.getByTestId('editor-reference-menu').waitFor();await page.keyboard.press('Escape');
  await page.getByTestId('editor-reference-menu').waitFor({state:'hidden'});
  await focusEnd();await page.keyboard.press('Enter');await page.keyboard.type('[[Tesis A');
  assert.equal(await editor.evaluate(element=>getComputedStyle(element).outlineStyle),'none','no large focus frame around the writing canvas');
  await page.locator('[data-reference-href="nodus://idea/i-a"]').waitFor();await page.screenshot({path:path.join(output,'web-reference-menu.png')});await page.locator('[data-reference-href="nodus://idea/i-a"]').click();
  await page.locator('.bn-editor a[href="nodus://idea/i-a"]').waitFor();
  await page.keyboard.type('[[La mirada turística');
  await page.locator(`[data-reference-href="nodus://note/${ids[0]}"]`).waitFor();await page.keyboard.press('Escape');
  for(let i=0;i<'[[La mirada turística'.length;i++)await page.keyboard.press('Backspace');
  await page.getByTestId('editor-reference-menu').waitFor({state:'hidden'});
  await page.screenshot({path:path.join(output,'web-reference-link.png')});

  await focusEnd();await page.keyboard.type(' Una edición privada.');
  let saved;const deadline=Date.now()+10000;do{saved=(await(await call('GET','/api/v2/me/artifacts/'+ids[0])).json()).artifact;if(saved.metadata.nativeDocument && saved.content.includes('Una edición privada'))break;await new Promise(resolve=>setTimeout(resolve,200));}while(Date.now()<deadline);assert.ok(saved.metadata.nativeDocument);assert.match(saved.content,/Una edición privada/);
  await page.getByTestId('workspace-server-tab-home').click();await page.getByTestId('workspace-server-item-'+ids[0]).getByRole('button').first().click();await editor.waitFor();assert.deepEqual((await(await call('GET','/api/v2/me/artifacts/'+ids[0])).json()).artifact.metadata.nativeDocument,saved.metadata.nativeDocument);
  // A second edit made during a slow navigation save must also be durable
  // before the route changes. Only network latency is injected here.
  let release;const held=new Promise(resolve=>{release=resolve;});let firstPatch=true;
  const delaySave=async route=>{if(route.request().method()==='PATCH'&&firstPatch){firstPatch=false;await held;}await route.continue();};
  const artifactUrl=server.origin+'/api/v2/me/artifacts/'+ids[0];await page.route(artifactUrl,delaySave);
  await focusEnd();await page.keyboard.type(' Guardado serializado.');
  const saving=page.waitForRequest(request=>request.url()===artifactUrl&&request.method()==='PATCH');const leaving=page.locator('[data-tour="nav-home"]').first().click();await saving;
  await focusEnd();await page.keyboard.type(' Texto durante guardado.');release();await leaving;await page.waitForURL(server.origin+'/');await page.unroute(artifactUrl,delaySave);
  saved=(await(await call('GET','/api/v2/me/artifacts/'+ids[0])).json()).artifact;assert.match(saved.content,/Guardado serializado/);assert.match(saved.content,/Texto durante guardado/);
  await page.locator('[data-tour="nav-workspace"]').first().click();await page.waitForURL(server.origin+'/view/workspace');await page.getByTestId('workspace-server-item-'+ids[0]).getByRole('button').first().click();await editor.waitFor();
  // A concurrent writer advances the server revision. The live editor retains
  // its draft instead of overwriting that revision, including after a reload.
  assert.equal((await call('PATCH','/api/v2/me/artifacts/'+ids[0],{expectedRevision:saved.revision,title:'Versión de otra sesión'})).status,200);
  await focusEnd();await page.keyboard.type(' Borrador en conflicto.');await page.locator('.editorial-save-error').waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(output,'web-conflict-1920.png')});
  await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/v2/me/artifacts/'+ids[0])&&response.status()===409),page.locator('[data-tour="nav-home"]').first().click()]);assert.equal(page.url(),server.origin+'/view/workspace','a conflict keeps the editor mounted during sidebar navigation');
  await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/v2/me/artifacts/'+ids[0])&&response.status()===409),page.evaluate(()=>history.back())]);await page.waitForURL(server.origin+'/view/workspace');assert.equal(await editor.count(),1,'browser Back also preserves the conflicting editor');
  await page.reload();await page.getByTestId('workspace-server-item-'+ids[0]).getByRole('button').first().click();await editor.waitFor();assert.match(await editor.innerText(),/Borrador en conflicto/);await page.getByRole('button',{name:/Cargar versión actual|Load current version/,exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.editorial-save-error'));assert.doesNotMatch(await editor.innerText(),/Borrador en conflicto/);
  const matrix=[];
  await focusEnd();await page.keyboard.type(' Edición antes de cambiar de bóveda.');
  for(const [type,id] of Object.entries(matrixNotes)){
   await page.getByTestId('header-vault-badge').click();await page.getByTestId('vault-option-'+spaces[type]).click();await page.waitForURL(server.origin+'/');
   if(!matrix.length)assert.match((await(await call('GET','/api/v2/me/artifacts/'+ids[0])).json()).artifact.content,/Edición antes de cambiar de bóveda/,'switching vaults flushes the active editor');
   await page.goto(server.origin+'/view/workspace');await page.getByTestId('workspace-server-item-'+id).getByRole('button').first().click();await editor.waitFor();
   await focusEnd();await page.keyboard.type(' Edición nativa · '+type+'.');
   // Navigation through the real sidebar flushes the pending 800 ms save.
   await page.locator('[data-tour="nav-home"]').first().click();await page.waitForURL(server.origin+'/');
   const artifact=(await(await call('GET','/api/v2/me/artifacts/'+id)).json()).artifact;assert.ok(artifact.metadata.nativeDocument);assert.match(artifact.content,new RegExp('Edición nativa · '+type));
   await page.goto(server.origin+'/view/workspace');await page.getByTestId('workspace-server-item-'+id).getByRole('button').first().click();await editor.waitFor();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(output,'web-vault-'+type+'-1920.png')});matrix.push({type,native:true,navigationFlush:true});
  }
  await page.getByTestId('header-vault-badge').click();await page.getByTestId('vault-option-'+spaceId).click();await page.waitForURL(server.origin+'/');await page.goto(server.origin+'/view/workspace');await page.getByTestId('workspace-server-item-'+ids[0]).getByRole('button').first().click();await editor.waitFor();
  await page.getByTestId('theme-toggle').click();await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(output,'web-dark-1920.png')});
  // New publications strip private notes. The legacy published-note reader still
  // has to stay read-only when an older server supplies that corpus surface.
  assert.equal((await(await fetch(server.origin+'/api/v1/spaces/'+spaceId+'/notes',{headers:{cookie}})).json()).notes.length,0);
  const publishedNote=academicSnapshot().payload.tables.notes[0];
  await page.route(server.origin+'/api/v1/spaces/'+spaceId+'/notes**',route=>route.fulfill({json:route.request().url().endsWith('/n-1')?{note:publishedNote}:{notes:[publishedNote],folders:[]}}));
  await page.reload();await page.getByTestId('workspace-server-item-n-1').getByRole('button').first().click();await page.waitForFunction(()=>document.querySelector('[data-testid="workspace-server-title"]')?.readOnly);assert.equal(await page.locator('.nodus-blocknote').count(),0);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(output,'web-published-readonly-1920.png')});
  for(const alias of ['notes','writing','projects']) {await page.goto(server.origin+'/view/'+alias);await page.getByTestId('private-notes-view').waitFor();}
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'web-results.json'),JSON.stringify({matrix,checks:['list/cards','editor/context/navigator/focus','native autosave/reopen','cross-session conflict','draft recovery after reload','light/dark','three desktop viewport sizes','private notes stripped from publications','legacy published reader remains read-only','workspace route aliases','all eight vaults/native/sidebar navigation flush','editing during navigation save','authorized reference metadata','private reference isolation','native links from [[ autocomplete'],errors},null,2));console.log('Web editorial QA passed');
 }finally{await browser.close();}
});
