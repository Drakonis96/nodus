import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { unzipSync } from 'fflate';
import { academicSnapshot, publish } from './lib/nodusServerFixtures.mjs';
import { repoRoot, withServer } from './lib/nodusServerHarness.mjs';
const output=path.join(repoRoot,'output/qa/academic-scriptor');await mkdir(output,{recursive:true});
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
await withServer({label:'academic-web',ai:true,env:{NODUS_CHROMIUM_PATH:chrome}},async server=>{
 const vaultId=await server.createSpace('Publicación académica');await server.setPublicationPolicy(vaultId,['allowUserContent']);
 const publisher=await server.deviceToken(server.adminEmail,server.adminPassword,vaultId,'Academic fixture');const corpus=academicSnapshot();
 corpus.payload.tables.works[0].creators_json=JSON.stringify([{role:'author',firstName:'Rosa',lastName:'Alba',name:null}]);
 await publish(server.origin,publisher.deviceToken,vaultId,corpus);
 const user=await server.createUser('academic-ui@example.test','academic-ui-password-long',[{spaceId:vaultId,role:'reader'}]);
 const cookie=await server.signIn(user.email,user.password),csrf=await server.csrf(cookie);
 const call=(method,url,body)=>fetch(server.origin+url,{method,headers:{cookie,origin:server.origin,'x-csrf-token':csrf,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const create=async(title,content)=>{const response=await call('POST','/api/v2/me/artifacts',{vaultId,kind:'workspace-note',title,content,metadata:{surface:'workspace'}});assert.equal(response.status,201);return (await response.json()).artifact;};
 const root=await create('Tesis · Memoria del archivo','## Introducción\n\nLa interpretación se apoya en la lectura de las fuentes.');
 const chapter=await create('Capítulo · Método','## Método\n\nEl contraste documental conserva la procedencia de cada afirmación.');
 let auditPage;const browser=await chromium.launch({executablePath:chrome,headless:true});
 try {
  const context=await browser.newContext({viewport:{width:1440,height:900},locale:'es-ES'}),page=await context.newPage(),errors=[];auditPage=page;page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.origin+'/login');await page.locator('#login-email').fill(user.email);await page.locator('#login-password').fill(user.password);await page.locator('button[type=submit]').click();await page.waitForURL(server.origin+'/');
  await page.getByTestId('header-vault-badge').click();await page.getByTestId('vault-option-'+vaultId).click();await page.goto(server.origin+'/view/workspace');
  await page.getByTestId('workspace-server-item-'+root.id).getByRole('button').first().click();const editor=page.locator('.nodus-blocknote .bn-editor');await editor.waitFor();
  await editor.locator('.bn-inline-content').last().evaluate(element=>{element.closest('.bn-editor').focus();const range=document.createRange();range.selectNodeContents(element);range.collapse(false);window.getSelection().removeAllRanges();window.getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  const menu=async()=>{if(!await page.locator('.editorial-options[open]').count())await page.getByRole('button',{name:/Opciones del documento|Document options/,exact:true}).click();};
  const actionBar=page.getByRole('toolbar',{name:/Acciones del documento|Document actions/});
  for(const label of [/Deshacer|Undo/,/Rehacer|Redo/,/Enlazar con Nodus|Link to Nodus/,/Citar fuente|Cite source/]) assert.ok(await actionBar.getByRole('button',{name:label,exact:true}).isVisible());
  await menu();await page.getByRole('button',{name:/Fijar en la barra: Nota al pie|Pin to toolbar: Footnote/,exact:true}).click();
  assert.ok(await actionBar.getByTestId('academic-note').isVisible());assert.ok(await page.locator('.editorial-editor-header .editorial-options[open]').count());
  await page.keyboard.press('Escape');await page.reload();await page.getByTestId('workspace-server-item-'+root.id).getByRole('button').first().click();await editor.waitFor();assert.ok(await actionBar.getByTestId('academic-note').isVisible());
  await editor.locator('.bn-inline-content').last().evaluate(element=>{element.closest('.bn-editor').focus();const range=document.createRange();range.selectNodeContents(element);range.collapse(false);window.getSelection().removeAllRanges();window.getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await menu();await page.getByTestId('academic-cite').click();await page.getByLabel(/Buscar fuentes|Search sources/, {exact:true}).fill('Memoria y archivo');await page.locator('.academic-source-results button').filter({hasText:'Memoria y archivo'}).click();await page.getByLabel(/Página o localizador|Page or locator/, {exact:true}).fill('12');await page.getByRole('button',{name:/Insertar cita bibliográfica|Insert citation/,exact:true}).click();await page.locator('.academic-citation').waitFor();
  await menu();await page.getByTestId('academic-note').click();await page.locator('.academic-dialog .bn-editor').fill('La evidencia se conserva en su contexto documental.');await page.getByRole('button',{name:/Guardar nota|Save note/,exact:true}).click();
  await menu();await page.getByTestId('academic-settings').click();await page.getByLabel(/Tipo de manuscrito|Manuscript type/, {exact:true}).selectOption('thesis');await page.getByLabel(/Autoría|Authorship/, {exact:true}).fill('R. Investigadora');await page.locator('.academic-source-results button').filter({hasText:chapter.title}).click();
  const customXml='<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text"><info><title>Revista de prueba</title><id>https://example.test/revista</id></info><citation><layout prefix="(" suffix=")"><text variable="title"/></layout></citation><bibliography><layout><text variable="title" font-style="italic"/></layout></bibliography></style>';
  await page.getByLabel(/Importar estilo CSL|Import CSL style/, {exact:true}).setInputFiles({name:'revista.csl',mimeType:'application/xml',buffer:Buffer.from(customXml)});await page.getByTestId('academic-style').getByRole('option',{name:'Revista de prueba'}).waitFor({state:'attached'});assert.equal(await page.getByTestId('academic-style').inputValue(),'custom');
  await page.screenshot({path:path.join(output,'web-manuscript-1440.png')});await page.getByRole('dialog').getByRole('button',{name:/Cerrar|Close/,exact:true}).click();
  await menu();await page.getByTestId('academic-delivery').click();await page.getByRole('dialog').getByRole('button',{name:/Preparar vista previa|Prepare preview/,exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.academic-dialog select:disabled'));const warnings=page.getByRole('dialog').getByRole('checkbox');if(await warnings.count())await warnings.check();
  await page.getByLabel(/Formato|Format/, {exact:true}).selectOption('pdf');await page.getByRole('button',{name:/Preparar vista previa|Prepare preview/,exact:true}).click();await page.locator('.academic-export-preview').waitFor({timeout:90000});
  assert.match(await page.frameLocator('.academic-export-preview').locator('body').innerText(),/Capítulo · Método/);await page.screenshot({path:path.join(output,'web-delivery-1440.png')});
  // Changing the output format clears the old download and preview.
  await page.getByLabel(/Formato|Format/, {exact:true}).selectOption('docx');assert.equal(await page.locator('.academic-export-preview').count(),0);assert.equal(await page.getByRole('button',{name:/Descargar entrega|Download submission/,exact:true}).count(),0);
  await page.getByRole('dialog').getByRole('button',{name:/Cerrar|Close/,exact:true}).click();
  const saved=(await(await call('GET','/api/v2/me/artifacts/'+root.id)).json()).artifact;assert.equal(saved.metadata.academicMetadata.style,'custom');assert.equal(saved.metadata.academicMetadata.manuscript.chapters[0].documentId,chapter.id);assert.ok(JSON.stringify(saved.metadata.nativeDocument).includes('nodusCitation'));
  for(const format of ['docx','latex','pdf']){const response=await call('POST',`/api/v2/me/artifacts/${root.id}/academic-export`,{expectedRevision:saved.revision,format,acceptWarnings:true});assert.equal(response.status,200);const file=await response.json();assert.match(file.html,/Capítulo · Método/);const bytes=Buffer.from(file.base64,'base64');await writeFile(path.join(output,'web-thesis.'+(format==='latex'?'zip':format)),bytes);if(format==='latex')assert.match(new TextDecoder().decode(unzipSync(bytes)['references.bib']),/Memoria y archivo/);}
  const after=(await(await call('GET','/api/v2/me/artifacts/'+root.id)).json()).artifact;assert.deepEqual(after.metadata.nativeDocument,saved.metadata.nativeDocument);assert.deepEqual(after.metadata.academicMetadata,saved.metadata.academicMetadata);
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'web-academic-results.json'),JSON.stringify({checks:['essential web action bar','pinned action survives browser reload','published source → native citation','footnote','manuscript from original private chapters','custom CSL import','full preflight','actual PDF pagination','format switching clears old delivery','Word/PDF/LaTeX with BibTeX','export does not mutate native state'],errors},null,2));console.log('Academic web UI and real Word/PDF/LaTeX delivery passed.');
 } catch(error){await auditPage?.screenshot({path:path.join(output,'web-failure.png')});console.error(await auditPage?.locator('.academic-dialog').innerText().catch(()=>'No active dialog'));throw error;} finally {await browser.close();}
});
