import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(new URL('..',import.meta.url).pathname);
const profile = await mkdtemp(path.join(os.tmpdir(),'nodus-editorial-ui-'));
const output = path.join(repoRoot,'output','qa','editorial-workspace');
await mkdir(output,{recursive:true});
const env = { ...process.env, NODUS_USERDATA:profile, NODUS_DISABLE_AUTO_UPDATE:'1', NODUS_E2E_UPDATE_STATUS:'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI:'1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
 app=await electron.launch({executablePath:require('electron'),args:[repoRoot],env});
 const page=await app.firstWindow();page.setDefaultTimeout(30000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error' && /React error|Maximum update depth/.test(message.text())) errors.push(message.text());});
 const capture=async options=>{const warning=page.getByTestId('backup-health-banner').getByRole('button',{name:'Ocultar aviso'});if(await warning.isVisible())await warning.click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return page.screenshot(options);};
 await page.waitForFunction(()=>Boolean(window.nodus && document.getElementById('root')?.children.length));
 await page.evaluate(async version=>{
   for (const [key,value] of Object.entries({ 'nodus.lastSeenVersion':version,'nodus.platformHighlightsSeen.2026-07':'1','nodus.toolkitBetaGuideSeen.2.4.0':'1','nodus.tutorialVideosAnnouncementSeen.2026-07':'1','nodus.pdfPresenterTutorialSeen.e2js_u-05OA':'1','nodus.mobileTeaserSeen.3.2.4':'1' })) localStorage.setItem(key,value);
   sessionStorage.setItem('nodus.startupUpdateChecked','1');
   localStorage.setItem('nodus.sidebarWidth','246');
   await window.nodus.setResearchPreparationPolicy({welcomeVersion:1});
   await window.nodus.updateSettings({onboardingComplete:true,basicsTutorialVersion:999,recoverySetupVersion:999,tourComplete:true,advancedTourComplete:true,uiLanguage:'es',theme:'light',mascotEnabled:false,reduceMotion:true,academicMode:'manual'});
 }, require('../package.json').version);
 await page.reload();
 await page.waitForFunction(()=>Boolean(window.nodus));
 // The release enables Scriptor once; a subsequent manual unpin survives reloads.
 await page.evaluate(async()=>{await window.nodus.updateSettings({scriptorSidebarVersion:0,sidebarCustomized:true,sidebarHidden:['hypothesis','reading','workspace','notes']});const migrated=await window.nodus.getSettings();if(migrated.scriptorSidebarVersion!==1||migrated.sidebarHidden.includes('workspace'))throw new Error('Scriptor release migration failed');});
 await page.locator('[data-tour="nav-toolkit"]').click();await page.getByTestId('toolkit-card-scriptor').waitFor();
 assert.equal(await page.getByTestId('toolkit-card-scriptor-pin').getAttribute('aria-pressed'),'true');
 await page.getByTestId('toolkit-card-scriptor-pin').click();await page.waitForFunction(()=>!document.querySelector('[data-tour="nav-workspace"]'));
 await page.reload();await page.locator('[data-tour="nav-toolkit"]').click();await page.getByTestId('toolkit-card-scriptor').waitFor();
 assert.equal(await page.getByTestId('toolkit-card-scriptor-pin').getAttribute('aria-pressed'),'false');
 await page.getByTestId('toolkit-card-scriptor-pin').click();await page.locator('[data-tour="nav-workspace"]').waitFor();
 await page.setViewportSize({width:1440,height:900});await capture({path:path.join(output,'desktop-scriptor-tools-1440.png')});
 await page.getByTestId('toolkit-card-scriptor').click();await page.getByTestId('workspace-view').waitFor();
 assert.equal(await page.locator('.library-header-title h1').innerText(),'Nodus Scriptor');
 assert.equal(await page.locator('[data-testid="resizable-sidebar"]').getByText('Escribir',{exact:true}).count(),0);
 assert.equal(await page.locator('.editorial-workspace').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(255, 255, 255)');
 await page.locator('[data-tour="nav-home"]').click();
 const fixtures=await page.evaluate(async()=>{
   const folder=await window.nodus.createNoteFolder({name:'Tesis · Memoria y territorio'});
   const nested=await window.nodus.createNoteFolder({name:'Capítulo IV · La mirada turística',parentId:folder.id});
   const body='# España en blanco y negro\n\nLa mirada turística construye una imagen del país a partir de sus paisajes, sus relatos y sus recuerdos. El patrimonio se convierte en un espacio de encuentro entre la historia y la experiencia del viaje.\n\n## La memoria del paisaje\n\nLas fuentes permiten seguir los cambios de esta representación. La lectura comparada muestra cómo los mismos lugares adquieren significados distintos según el contexto y la voz del narrador.\n\n> El paisaje es también una forma de memoria.\n\n- Lectura de las fuentes\n  - Contraste de testimonios\n- Organización de la evidencia\n\n## Una lectura conectada\n\nCada fragmento conserva su procedencia y dialoga con el argumento del capítulo.';
   const note=await window.nodus.createNote({title:'La mirada turística y la memoria del paisaje',content:body,folderId:nested.id,tags:['Patrimonio','Borrador']});
   for (const [title,content] of [['Brief · Tesis','Objetivo, alcance y criterio del proyecto.'],['Nostalgia y experiencia del viaje','Ideas sobre la relación entre territorio, memoria y viaje.'],['Clasificación de la literatura de viajes','Una distinción precisa entre las diversas formas del relato.'],['El discurso en torno al patrimonio','Fuentes sobre la representación cultural de España.'],['España eterna','Notas para la lectura del capítulo segundo.']]) await window.nodus.createNote({title,content,folderId:folder.id,tags:['Investigación']});
   return {noteId:note.id,folderId:folder.id};
 });
 const nav=page.locator('[data-tour="nav-workspace"]');
 if (await nav.count()) await nav.click(); else await page.locator('[data-tour="nav-notes"]').click();
 await page.getByTestId('workspace-view').waitFor();
 const backupClose=page.getByTestId('backup-health-banner').getByRole('button',{name:'Ocultar aviso'}); if(await backupClose.count()) await backupClose.first().click();
 for (const size of [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080}]) {
   await page.setViewportSize(size);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,`desktop-list-${size.width}.png`)});
 }
 await page.getByRole('button',{name:'Tarjetas',exact:true}).click();
 for(const width of [1280,1440,1920]){await page.setViewportSize({width,height:width===1280?800:width===1440?900:1080});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,`desktop-cards-${width}.png`)});}
 await page.getByRole('button',{name:'Lista',exact:true}).click();
 await page.getByTestId(`workspace-item-${fixtures.noteId}`).click();
 await page.locator('.editorial-document-scroll').waitFor();assert.equal(await page.locator('.editorial-document-scroll').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(255, 255, 255)');
 await page.locator('.nodus-blocknote .bn-editor').waitFor();
 assert.equal(await page.locator('.editorial-inspector').count(),0);
 for (const size of [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080}]) {
   await page.setViewportSize(size); await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,`desktop-editor-${size.width}.png`)});
 }
 await page.getByRole('button',{name:'Contexto',exact:true}).click();
 await page.getByRole('tab',{name:'Detalles',exact:true}).click();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-context-1920.png')});
 await page.getByRole('button',{name:'Navegador de documentos',exact:true}).click();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-navigator-1920.png')});
 await page.getByRole('button',{name:'Foco',exact:true}).click();
 await page.waitForFunction(()=>Boolean(document.fullscreenElement)&&document.querySelector('[data-editorial-focus="true"]'));
 assert.equal(await page.locator('.editorial-inspector').count(),0);
 assert.equal(await page.locator('.editorial-navigator').count(),0);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-focus-1920.png')});
 await page.getByRole('button',{name:'Salir de foco',exact:true}).click();
 await page.waitForFunction(()=>!document.fullscreenElement);
 const editor=page.locator('.nodus-blocknote .bn-editor');
 assert.equal((await page.evaluate(async id=>await window.nodus.getWorkspaceNoteEditorData(id),fixtures.noteId)).nativeDocument,null,'opening and browsing a legacy note never writes native JSON');
 await editor.click(); await page.keyboard.press('Meta+End'); await page.keyboard.press('End'); await page.keyboard.type(' Una edición nativa.');
 let savedCheck; const deadline=Date.now()+10000; do { savedCheck=await page.evaluate(async id=>await window.nodus.getWorkspaceNoteEditorData(id),fixtures.noteId); if(savedCheck.nativeDocument) break; await new Promise(resolve=>setTimeout(resolve,200)); } while(Date.now()<deadline);
 assert.ok(savedCheck.nativeDocument,'native autosave must finish');
 const saved=await page.evaluate(async id=>await window.nodus.getWorkspaceNoteEditorData(id),fixtures.noteId);
 assert.ok(saved.nativeDocument.length>0);
 await page.getByTestId('workspace-tab-home').click();
 await page.getByTestId(`workspace-item-${fixtures.noteId}`).click(); await editor.waitFor();
 assert.deepEqual((await page.evaluate(async id=>await window.nodus.getWorkspaceNoteEditorData(id),fixtures.noteId)).nativeDocument,saved.nativeDocument);
 // Responsive local panels, long titles and keyboard-operated menus.
 if(await page.locator('.editorial-navigator').count()) await page.getByRole('button',{name:'Cerrar navegador',exact:true}).click();
 if(await page.getByRole('button',{name:'Contexto',exact:true}).getAttribute('aria-pressed')!=='true') await page.getByRole('button',{name:'Contexto',exact:true}).click();
 for(const width of [1280,1440]) { await page.setViewportSize({width,height:width===1280?800:900});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,`desktop-context-${width}.png`)}); }
 await page.getByRole('button',{name:'Contexto',exact:true}).click();
 await page.setViewportSize({width:1000,height:800});
 await page.getByRole('button',{name:'Navegador de documentos',exact:true}).click();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-navigator-overlay-1000.png')});
 await page.getByRole('button',{name:'Cerrar navegador',exact:true}).click();
 const originalTitle=await page.getByTestId('editor-title').inputValue();
 await page.getByTestId('editor-title').fill('La memoria del territorio: un título largo para comprobar la jerarquía editorial, el ajuste de líneas y la organización del documento');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-long-title-1000.png')});
 await page.getByTestId('editor-title').fill(originalTitle);
 const options=page.getByRole('button',{name:'Opciones del documento',exact:true});
 // HTML summary is exposed as a button by Chromium.
 await options.focus();await page.keyboard.press('Enter');
 const menuBox=await page.locator('.editorial-options .study-editor-toolbar').boundingBox();assert.ok(menuBox.x>=0 && menuBox.x+menuBox.width<=1000);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-options-1000.png')});await page.keyboard.press('Escape');assert.equal(await page.locator('.editorial-editor-header .editorial-options').getAttribute('open'),null);
 await page.getByTestId('workspace-tab-home').click();
 await page.getByRole('button',{name:'Colecciones',exact:true}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-collections-overlay-1000.png')});
 await page.getByTestId('workspace-search').fill('Ningún resultado de prueba');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-empty-1000.png')});await page.getByTestId('workspace-search').fill('');
 await page.setViewportSize({width:1920,height:1080});await page.getByTestId(`workspace-item-${fixtures.noteId}`).click();await editor.waitFor();
 // An external editor advances the revision: closing must keep this draft open.
 await page.evaluate(async id=>{const data=await window.nodus.getWorkspaceNoteEditorData(id);await window.nodus.updateWorkspaceNote(id,{title:'Título de otra sesión',contentMarkdown:data.contentMarkdown,nativeDocument:data.nativeDocument,expectedRevision:data.revision});},fixtures.noteId);
 await page.getByTestId('editor-title').fill('Borrador local en conflicto');await page.getByTestId('workspace-tab-home').click();await page.locator('.editorial-save-error').waitFor();assert.equal(await page.getByTestId('editor-title').inputValue(),'Borrador local en conflicto');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-conflict-1920.png')});
 await page.reload();await page.locator('[data-tour="nav-workspace"]').click();await page.getByTestId(`workspace-item-${fixtures.noteId}`).click();await editor.waitFor();assert.equal(await page.getByTestId('editor-title').inputValue(),'Borrador local en conflicto');
 await page.getByRole('button',{name:'Cargar versión actual',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.editorial-save-error'));assert.equal(await page.getByTestId('editor-title').inputValue(),'Título de otra sesión');
 // Native formats and compatibility blocks survive a real canvas edit.
 const special=await page.evaluate(async()=>{
   const native=[
    {id:'qa-rich',type:'paragraph',props:{textAlignment:'left',vendor:{preserve:true}},content:[{type:'text',text:'Texto con formato',styles:{bold:true,underline:true,textColor:'#7560b7',backgroundColor:'#ede8f6'}},{type:'nodusFormula',props:{formula:'x^2'}}],children:[]},
    {id:'qa-heading-six',type:'heading',props:{level:6},content:[{type:'text',text:'Encabezado de nivel seis',styles:{}}],children:[]},
    {id:'qa-table',type:'table',props:{},content:{type:'tableContent',rows:[{cells:[[{type:'text',text:'Fuente',styles:{}}],[{type:'text',text:'Evidencia',styles:{}}]]},{cells:[[{type:'text',text:'Archivo',styles:{italic:true}}],[{type:'text',text:'Memoria',styles:{}}]]}]},children:[]},
    {id:'qa-future',type:'futureBlock',props:{markdown:'Bloque especial conservado',payload:{version:7,nested:[1,2,3]}},children:[]},
    {id:'qa-future-inline',type:'paragraph',props:{textAlignment:'left'},content:[{type:'text',text:'Formato futuro conservado',styles:{futureColor:'amber'}}],children:[]}
   ];const note=await window.nodus.createNote({title:'Formatos y compatibilidad',content:''});await window.nodus.updateWorkspaceNote(note.id,{title:note.title,contentMarkdown:'',nativeDocument:native});return {id:note.id,native};
 });
 await page.reload();await page.locator('[data-tour="nav-workspace"]').click();await page.getByTestId('workspace-item-'+special.id).click();await editor.waitFor();
 const renderedColors=await page.locator('[data-id="qa-rich"] [data-style-type="textColor"]').evaluate(element=>({color:getComputedStyle(element).color,background:getComputedStyle(element.closest('[data-style-type="backgroundColor"]')??element.querySelector('[data-style-type="backgroundColor"]')).backgroundColor}));assert.equal(renderedColors.color,'rgb(117, 96, 183)');assert.equal(renderedColors.background,'rgb(237, 232, 246)');
 await page.locator('[data-id="qa-rich"] .bn-inline-content').first().click();await page.keyboard.press('End');await page.keyboard.type(' · edición');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-special-formats-1920.png')});await page.getByTestId('workspace-tab-home').click();
 const specialSaved=await page.evaluate(async id=>await window.nodus.getWorkspaceNoteEditorData(id),special.id);assert.deepEqual(specialSaved.nativeDocument.find(block=>block.id==='qa-future'),special.native[3]);assert.deepEqual(specialSaved.nativeDocument.find(block=>block.id==='qa-future-inline'),special.native[4]);assert.deepEqual(specialSaved.nativeDocument.find(block=>block.id==='qa-rich').props.vendor,{preserve:true});assert.match(specialSaved.contentMarkdown,/edición/);
 // Manual ideas use the same native canvas and keep the graph synchronized.
 await page.getByTestId('workspace-tab-home').click();await page.locator('.library-header-bar details summary').click();await page.getByTestId('workspace-create-idea').click();await editor.waitFor();await page.getByTestId('editor-title').fill('Idea editorial verificada');await editor.click();await page.keyboard.type('La memoria conecta fuentes y territorio.');
 const ideaNote=await page.evaluate(async()=>{const tree=await window.nodus.getNotesTree();return tree.notes.find(note=>note.kind==='idea'||note.source?.note==='manual-idea');});
 await page.getByRole('button',{name:'Contexto',exact:true}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-manual-idea-1920.png')});await page.getByTestId('workspace-tab-home').click();
 const ideaData=await page.evaluate(async note=>({editor:await window.nodus.getWorkspaceNoteEditorData(note.id),graph:await window.nodus.getIdeaDetail(note.source.ref)}),ideaNote);assert.ok(ideaData.editor.nativeDocument);assert.match(JSON.stringify(ideaData.graph),/La memoria conecta fuentes y territorio/);
 // The slash menu and selection formatting are real BlockNote controls.
 if(await page.locator('.library-header-bar details').getAttribute('open')===null) await page.locator('.library-header-bar details summary').click();await page.getByTestId('workspace-create-note').click();await editor.waitFor();await editor.click();await page.keyboard.type('/');await page.getByRole('listbox').waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-slash-menu-1920.png')});await page.keyboard.press('Escape');await page.keyboard.press('Backspace');await page.keyboard.type('Texto para un comentario estable');
 for(let index=0;index<7;index++) await page.keyboard.press('Shift+ArrowLeft');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-selection-format-1920.png')});await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-selection-format-1280.png')});const formatBox=await page.locator('.bn-formatting-toolbar').boundingBox();assert.ok(formatBox && formatBox.x>=10 && formatBox.x+formatBox.width<=1270,'selection toolbar leaves space at the viewport edges');await page.setViewportSize({width:1920,height:1080});
 await page.getByRole('button',{name:'Opciones del documento',exact:true}).click();await page.getByRole('button',{name:'Añadir comentario',exact:true}).click();await page.getByTestId('study-comment-dialog').locator('textarea').fill('Comentario anclado al bloque');await page.getByTestId('study-comment-dialog').getByRole('button',{name:'Guardar',exact:true}).click();
 await page.getByTestId('workspace-tab-home').click();await page.getByTestId(`workspace-item-${fixtures.noteId}`).click();await editor.waitFor();
 await page.evaluate(async()=>await window.nodus.updateSettings({theme:'dark'}));
 await page.reload();
 const navAgain=page.locator('[data-tour="nav-workspace"]');if(await navAgain.count()) await navAgain.click();else await page.locator('[data-tour="nav-notes"]').click();
 await page.getByTestId(`workspace-item-${fixtures.noteId}`).click();await editor.waitFor();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-dark-1920.png')});
 const matrix=[];
 for (const type of ['estudio','docencia','genealogy','prosopography','databases','testimonios','worldbuilding']) {
   const created=await page.evaluate(async type=>{const result=await window.nodus.createVault({name:'Editorial QA · '+type,type});await window.nodus.switchVault(result.vault.id);await window.nodus.updateSettings({onboardingComplete:true,tourComplete:true,advancedTourComplete:true,studyTourComplete:true,docenciaTourComplete:true,genealogyTourComplete:true,databasesTourComplete:true,primarySourcesTourComplete:true,testimonyTourComplete:true,worldbuildingTourComplete:true,prosopTourComplete:true,basicsTutorialVersion:999,recoverySetupVersion:999,theme:'light',academicMode:'manual',mascotEnabled:false});const note=await window.nodus.createNote({title:'Nota editorial · '+type,content:'Texto de la bóveda.'});return{vaultId:result.vault.id,noteId:note.id};},type);
   await page.reload();await page.waitForFunction(()=>Boolean(window.nodus));console.log(type,await page.locator('[aria-modal=true]').allTextContents());assert.equal(await page.locator('[data-tour="nav-notes"]').innerText(),'Nodus Scriptor');await page.locator('[data-tour="nav-toolkit"]').click();await page.getByTestId('toolkit-card-scriptor').click();await page.getByTestId('workspace-view').waitFor();await page.getByTestId('workspace-item-'+created.noteId).click();await editor.waitFor();await page.getByTestId('editor-title').fill('Nota revisada · '+type);await page.getByTestId('workspace-tab-home').click();
   const native=await page.evaluate(async id=>(await window.nodus.getWorkspaceNoteEditorData(id)).nativeDocument,created.noteId);assert.ok(native);matrix.push({type,noteNative:true});
   if(type==='estudio'||type==='docencia'){
     const course=await page.evaluate(async type=>{const course=await window.nodus.createStudyCourse({name:'Curso editorial · '+type});const doc=await window.nodus.createStudyDocument({title:'Documento editorial · '+type,contentMarkdown:'## La memoria del archivo\n\nCada fuente conserva su procedencia.',placement:{courseId:course.id}});return {id:course.id,documentId:doc.id};},type);
     await page.locator('[data-tour="nav-studyCourses"]').click();await page.getByTestId('study-browser-course-'+course.id).getByRole('button').first().click();await page.getByRole('button',{name:'Documento editorial · '+type,exact:false}).first().click();await editor.waitFor();
     await editor.locator('.bn-inline-content').last().evaluate(element=>{element.closest('.bn-editor').focus();const range=document.createRange();range.selectNodeContents(element);range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});await page.waitForTimeout(50);await page.keyboard.type(' [[Nota revisada');
     await page.locator('[data-reference-href="nodus://note/'+created.noteId+'"]').click();await page.locator('.bn-editor a[href="nodus://note/'+created.noteId+'"]').waitFor();
     const references=await page.evaluate(()=>window.nodus.listEditorReferences());assert.ok(references.some(reference=>reference.kind==='studyDocument'&&reference.id===course.documentId));
     await page.getByTestId('editor-title').fill('Documento revisado · '+type);await page.keyboard.press('Meta+s');
     const deadline=Date.now()+10000;let data;do{data=await page.evaluate(async id=>await window.nodus.getStudyDocEditorData(id),course.documentId);if(data.nativeDocument)break;await new Promise(resolve=>setTimeout(resolve,200));}while(Date.now()<deadline);assert.ok(data.nativeDocument);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-study-'+type+'.png')});matrix.at(-1).studyNative=true;assert.ok(JSON.stringify(data.nativeDocument).includes('nodus://note/'+created.noteId));await page.locator('.bn-editor a[href="nodus://note/'+created.noteId+'"]').click();await page.getByTestId('workspace-tab-'+created.noteId).waitFor();await editor.waitFor();assert.equal(await page.getByTestId('editor-title').inputValue(),'Nota revisada · '+type);matrix.at(-1).studyReferences=true;
   }
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture({path:path.join(output,'desktop-vault-'+type+'.png')});
 }
 // Closing the native window flushes the last title before the renderer dies.
 const closing=await page.evaluate(async()=>({vault:await window.nodus.getActiveVault(),note:(await window.nodus.getNotesTree()).notes[0]}));
 await page.locator('[data-tour="nav-notes"]').click();await page.getByTestId('workspace-item-'+closing.note.id).click();await editor.waitFor();await page.getByTestId('editor-title').fill('Guardado al cerrar la ventana');
 const closed=page.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>!window.isDestroyed() && !window.webContents.getURL().includes('mascot'))?.close());await closed;
 const closedTitle=await app.evaluate((_electron,args)=>{const request=process.getBuiltinModule('module').createRequire(args.root+'/package.json');const Database=request('better-sqlite3');const database=new Database(args.file,{readonly:true});try{return database.prepare('SELECT title FROM notes WHERE id=?').get(args.id).title;}finally{database.close();}}, {root:repoRoot,file:closing.vault.path,id:closing.note.id});assert.equal(closedTitle,'Guardado al cerrar la ventana');
 await writeFile(path.join(output,'desktop-results.json'),JSON.stringify({fixtures,matrix,errors,checks:['list/cards','context/navigator/focus','native save and reopen','light/dark','1280/1440/1920','responsive panels/long title/empty state','keyboard menus','manual idea native/graph','slash menu/selection/comments','window-close flush','native rich/table/heading6/formula/unknown types','Study/Teaching native references and navigation to Scriptor']},null,2));
 assert.deepEqual(errors,[]);
 console.log(`Desktop editorial QA passed. Screenshots: ${output}`);
} finally {if(app) await app.close();await rm(profile,{recursive:true,force:true});}
