import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createCanvas} from '@napi-rs/canvas';
import {_electron as electron} from 'playwright-core';
const require=createRequire(import.meta.url), root=path.resolve(new URL('..',import.meta.url).pathname);
const profile=await mkdtemp(path.join(os.tmpdir(),'nodus-scriptor-design-'));
const output=path.join(root,'output/qa/scriptor-final-visual');await mkdir(output,{recursive:true});
const env={...process.env,NODUS_USERDATA:profile,NODUS_DISABLE_AUTO_UPDATE:'1',NODUS_E2E_UPDATE_STATUS:'not-available',NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
const diagram=createCanvas(560,220),ctx=diagram.getContext('2d');ctx.fillStyle='#fafafa';ctx.fillRect(0,0,560,220);ctx.strokeStyle='#7560b7';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(50,170);ctx.lineTo(165,135);ctx.lineTo(290,105);ctx.lineTo(410,80);ctx.lineTo(510,45);ctx.stroke();ctx.fillStyle='#302e3a';ctx.font='16px sans-serif';ctx.fillText('Lectura y contraste de fuentes',50,30);ctx.font='12px sans-serif';ctx.fillText('Archivo',50,200);ctx.fillText('Analisis',250,200);ctx.fillText('Escritura',450,200);const figure='data:image/png;base64,'+diagram.toBuffer('image/png').toString('base64');
const shots=[],errors=[];let app,page;
try {
 app=await electron.launch({executablePath:require('electron'),args:[root],env});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>Boolean(window.nodus&&document.getElementById('root')?.children.length));
 await page.evaluate(async version=>{
  for(const [key,value] of Object.entries({'nodus.lastSeenVersion':version,'nodus.platformHighlightsSeen.2026-07':'1','nodus.toolkitBetaGuideSeen.2.4.0':'1','nodus.tutorialVideosAnnouncementSeen.2026-07':'1','nodus.pdfPresenterTutorialSeen.e2js_u-05OA':'1','nodus.mobileTeaserSeen.3.2.4':'1','nodus.sidebarWidth':'246'}))localStorage.setItem(key,value);
  sessionStorage.setItem('nodus.startupUpdateChecked','1');await window.nodus.setResearchPreparationPolicy({welcomeVersion:1});await window.nodus.updateSettings({onboardingComplete:true,basicsTutorialVersion:999,recoverySetupVersion:999,tourComplete:true,advancedTourComplete:true,uiLanguage:'es',theme:'light',mascotEnabled:false,reduceMotion:true,academicMode:'manual'});
 },require('../package.json').version);await page.reload();await page.getByTestId('app-shell').waitFor();
 const fixture=await page.evaluate(async()=>{
  const folder=await window.nodus.createNoteFolder({name:'Tesis · Memoria y territorio'}),nested=await window.nodus.createNoteFolder({name:'Capítulos y fuentes',parentId:folder.id});
  const note=await window.nodus.createNote({title:'La memoria del paisaje: lectura, investigación y escritura académica',content:'## La memoria del paisaje\n\nLa lectura crítica permite conectar cada interpretación con sus fuentes. El documento conserva la procedencia de la evidencia y organiza el argumento con claridad.\n\n## Discusión\n\nUna investigación rigurosa vuelve al pasaje original y contrasta los testimonios.\n\n### Límites de la interpretación\n\nLas preguntas abiertas forman parte del conocimiento que se comparte.',folderId:nested.id,tags:['Patrimonio','Borrador']});
  const ids=[];for(let i=0;i<8;i++)ids.push((await window.nodus.createNote({title:['Brief · Tesis','Fuentes y método','Nostalgia y experiencia del viaje','Patrimonio e historia','España eterna','La literatura de viajes','Conclusiones','Documento con un título extraordinariamente largo para comprobar los truncamientos del catálogo y las pestañas sin desplazar los controles'][i],content:'Las fuentes se conservan vinculadas a su contexto.\n\nEl investigador organiza sus ideas antes de publicar.',folderId:folder.id,tags:['Investigación']})).id);
  const empty=await window.nodus.createNote({title:'Documento nuevo',content:''});await window.nodus.createManualIdea({folderId:folder.id,title:'Paisaje como forma de memoria'});
  return {noteId:note.id,folderId:folder.id,ids,empty:empty.id,vault:await window.nodus.getActiveVault()};
 });
 await app.evaluate((_electron,args)=>{
  const req=process.getBuiltinModule('module').createRequire(args.root+'/package.json'),Database=req('better-sqlite3'),db=new Database(args.file);
  db.prepare('INSERT INTO works(nodus_id,title,year,authors_json,item_type,creators_json) VALUES(?,?,?,?,?,?)').run('visual-source','Memoria cultural y representación del paisaje: fuentes, métodos y límites de una lectura histórica comparada',2021,JSON.stringify(['Alba Pérez']),'book',JSON.stringify([{lastName:'Pérez',firstName:'Alba',role:'author'}]));db.prepare('INSERT INTO authors(author_id,name) VALUES(?,?)').run('visual-author','Alba Pérez');db.close();
 },{root,file:fixture.vault.path});
 const size=async(width,height)=>{await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(size.width,size.height),{width,height});await page.setViewportSize({width,height});assert.deepEqual(await page.evaluate(()=>({width:innerWidth,height:innerHeight})),{width,height});};
 const dismissWarning=async()=>{const warning=page.getByTestId('backup-health-banner').getByRole('button',{name:'Ocultar aviso'});if(await warning.isVisible().catch(()=>false))await warning.click();};
 const capture=async(name)=>{
  await dismissWarning();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const geometry=await page.evaluate(()=>{
   const selectors=['[data-testid=workspace-context-menu]','.editorial-editor-header','.editorial-inspector','.editorial-navigator','.editorial-options-panel','.academic-dialog','.academic-dialog-body','.academic-dialog-footer','.editorial-recent-cards'];
   return Object.fromEntries(selectors.map(selector=>{const el=document.querySelector(selector);if(!el||!el.getClientRects().length)return [selector,null];const box=el.getBoundingClientRect();return [selector,{x:box.x,y:box.y,width:box.width,height:box.height,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}];}));
  });
  for(const [selector,box] of Object.entries(geometry))if(box){assert.ok(box.scrollWidth<=box.clientWidth+2,`${name}: ${selector} horizontal overflow`);assert.ok(box.x>=-1&&box.x+box.width<=(await page.evaluate(()=>innerWidth))+1,`${name}: ${selector} outside viewport`);}
  const footer=page.locator('.academic-dialog-footer');if(await footer.count()){
   const enabled=footer.locator('button:not(:disabled)');for(let i=0;i<await enabled.count();i++)assert.ok(await enabled.nth(i).evaluate(el=>{const b=el.getBoundingClientRect();return b.bottom<=innerHeight&&b.top>=0&&el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));}),`${name}: footer action obscured`);
  }
  await page.screenshot({path:path.join(output,name+'.png')});shots.push({name,geometry,viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight}))});console.log('CAPTURE',name);
 };
 const menu=async()=>{if(!await page.locator('.editorial-editor-header .editorial-options[open]').count())await page.getByRole('button',{name:'Opciones del documento',exact:true}).click();};
 const action=async(label)=>{await menu();await page.locator('.editorial-options-panel').getByRole('button',{name:label,exact:true}).click();};
 const closeDialog=async()=>{await page.locator('.academic-dialog header').getByRole('button',{name:'Cerrar',exact:true}).click();};
 const home=async()=>{await page.getByTestId('workspace-tab-home').click();await page.getByTestId('workspace-search').waitFor();};
 const open=async()=>{await page.getByTestId('workspace-item-'+fixture.noteId).click();await page.locator('.bn-editor').waitFor();};
 await page.locator('[data-tour="nav-workspace"]').click();await page.getByTestId('workspace-view').waitFor();
 for(const [theme,width,height] of [['light',1280,800],['light',1440,900],['light',1920,1080],['dark',1280,800]]){
  await page.evaluate(theme=>window.nodus.updateSettings({theme}),theme);await size(width,height);
  await capture(`catalog-list-${theme}-${width}`);await page.getByRole('button',{name:'Tarjetas',exact:true}).click();await capture(`catalog-cards-${theme}-${width}`);assert.ok((await page.locator('.editorial-recent-card').first().boundingBox()).height<260,'long titles do not inflate the recent-card row');await page.getByRole('button',{name:'Lista',exact:true}).click();
 }
 await page.evaluate(()=>window.nodus.updateSettings({theme:'light'}));await size(1280,800);
 await page.locator('.library-header-actions summary').click();await capture('catalog-create');await page.keyboard.press('Escape');await page.locator('.library-header-title').click();await page.locator('.library-header-actions details').evaluate(el=>el.removeAttribute('open'));
 await page.getByTestId('workspace-search').fill('No hay documentos coincidentes');await capture('catalog-empty');await page.getByTestId('workspace-search').fill('');
 await page.getByTestId('workspace-item-'+fixture.ids[0]).getByRole('checkbox').check();await page.getByTestId('workspace-item-'+fixture.ids[1]).getByRole('checkbox').check();await capture('catalog-selection');await page.getByTestId('workspace-item-'+fixture.ids[0]).getByRole('checkbox').uncheck();await page.getByTestId('workspace-item-'+fixture.ids[1]).getByRole('checkbox').uncheck();
 await page.getByRole('button',{name:'Etiquetas',exact:true}).click();await capture('catalog-tags');await page.keyboard.press('Escape');
 await page.locator('.editorial-collections').getByRole('button',{name:'Desplegar',exact:true}).first().click();await capture('collections-nested');
 await page.getByTestId('workspace-collection-rename-'+fixture.folderId).click();await capture('collection-rename');await page.getByRole('dialog').getByRole('button',{name:'Cancelar',exact:true}).click();
 const edgeRow=page.getByTestId('workspace-item-'+fixture.noteId);await edgeRow.scrollIntoViewIfNeeded();await edgeRow.click({button:'right',position:{x:250,y:60}});await capture('catalog-context-bottom');const edgeMenu=await page.getByTestId('workspace-context-menu').boundingBox();assert.ok(edgeMenu.y+edgeMenu.height<=800,'row menu remains within the lower edge');await page.keyboard.press('Escape');
 await open();await capture('editor-clean-1280');
 const header=await page.locator('.editorial-editor-header').boundingBox();
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>window.nodus.updateSettings({theme}),theme);
  for(const [width,height] of [[1280,800],[1440,900],[1920,1080]]){await size(width,height);await capture(`editor-${theme}-${width}`);}
  await size(1280,800);await page.getByRole('button',{name:'Contexto',exact:true}).click();
  for(const [name,role] of [['Fuentes','tab'],['Comentarios','tab'],['Detalles','tab'],['Estructura','button'],['Comprobaciones','button'],['Esquema','button'],['Historial','button'],['Asistente','button']]){
   await page.locator('.editorial-inspector').getByRole(role,{name,exact:true}).click();await capture(`context-${name.toLowerCase()}-${theme}`);
   if(role==='button')assert.equal(await page.locator('.editorial-context-views').getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');
  }
  await page.getByRole('button',{name:'Navegador de documentos',exact:true}).click();await capture(`navigator-context-${theme}`);await menu();await capture(`options-with-panels-${theme}`);await page.keyboard.press('Escape');await page.getByRole('button',{name:'Cerrar navegador',exact:true}).click();await page.getByRole('button',{name:'Cerrar contexto',exact:true}).click();
 }
 await page.evaluate(()=>window.nodus.updateSettings({theme:'light'}));await size(1280,800);
 await action('Citar fuente');await page.getByLabel('Buscar fuentes').fill('Memoria cultural');await page.locator('.academic-source-results button').first().click();await page.getByText('Datos bibliográficos de la cita',{exact:true}).click();await capture('citation-expanded-1280');
 assert.equal(await page.locator('.academic-dialog-body').evaluate(el=>el.scrollTop),0,'long citation keeps its form at the start');
 await page.locator('.academic-dialog-body').evaluate(el=>el.scrollTop=el.scrollHeight);await capture('citation-expanded-bottom-1280');
 await page.locator('.academic-dialog-footer').getByRole('button',{name:'Insertar cita bibliográfica',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.locator('.academic-dialog header button').evaluate(el=>el===document.activeElement),true,'focus remains inside dialog');await closeDialog();
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>window.nodus.updateSettings({theme}),theme);
  for(const name of ['Nota al pie','Referencia cruzada','Vincular evidencia','Manuscrito y citas','Preparar entrega']){
   await action(name);await page.locator('.academic-dialog').waitFor();if(name==='Manuscrito y citas'){await page.getByLabel('Tipo de manuscrito').selectOption('thesis');await page.getByLabel('Autoría',{exact:true}).fill('Alba Pérez');await page.getByLabel('Resumen',{exact:true}).fill('Lectura, investigación, análisis y escritura de un argumento trazable.');}
   if(name==='Preparar entrega')await page.waitForFunction(()=>document.querySelector('.academic-dialog select:not(:disabled)'));
   await capture(`dialog-${name.toLowerCase().replaceAll(' ','-')}-${theme}`);await closeDialog();
  }
 }
 await page.evaluate(()=>window.nodus.updateSettings({theme:'light'}));await action('Prompts de mejora');await page.getByTestId('study-improve-dialog').waitFor();await capture('prompts-library');await page.getByTestId('study-style-new').click();await capture('prompts-create');await page.getByTestId('study-improve-dialog').getByRole('button',{name:'Cerrar',exact:true}).click();
 await action('Buscar y reemplazar');await capture('search-replace');assert.equal(await page.locator('.editorial-options[open]').count(),0,'actions close their menu before interacting with the new panel');await page.getByRole('button',{name:'Cerrar búsqueda',exact:true}).click();
 await action('Markdown crudo');await capture('raw-markdown');await action('Markdown crudo');
 await action('Dividir vista');await capture('split-1280');await action('Dividir vista');
 await action('Dictado por voz');await capture('dictation-idle');await action('Dictado por voz');await action('Lectura por voz');await capture('reading-idle');await action('Lectura por voz');
 await page.getByRole('button',{name:'Foco',exact:true}).click();await page.waitForFunction(()=>Boolean(document.fullscreenElement));await capture('focus');await page.getByTestId('editorial-focus-navigation').click();await capture('focus-navigation');await page.getByRole('button',{name:'Salir de foco',exact:true}).click();await page.waitForFunction(()=>!document.fullscreenElement);
 await size(1000,800);await page.getByRole('button',{name:'Navegador de documentos',exact:true}).click();await capture('navigator-overlay-1000');await page.getByRole('button',{name:'Cerrar navegador',exact:true}).click();
 // Opening many original documents must leave the header at the same height and position.
 await home();for(const id of fixture.ids.slice(0,5)){await page.getByTestId('workspace-item-'+id).click();await home();}await open();await size(1280,800);const tabsHeader=await page.locator('.editorial-editor-header').boundingBox();assert.equal(tabsHeader.y,header.y);assert.equal(tabsHeader.height,header.height);await capture('many-tabs-1280');
 // Empty native editor and cross-reference picker must explain the next action.
 await home();await page.getByTestId('workspace-item-'+fixture.empty).click();await capture('empty-document');await action('Referencia cruzada');await capture('empty-cross-reference');await closeDialog();

 // Rich academic content, real comments, bibliography, captions and original chapter references.
 await home();
 const rich=await page.evaluate(async({figure,chapterId})=>{
  const text=value=>({type:'text',text:value,styles:{}}),block=(id,type,content,props={})=>({id,type,content,props,children:[]});
  const source={id:'vault:visual-source',refId:'visual-source',scope:'vault',citationKey:'Perez2021',metadata:{title:'Memoria cultural y representación del paisaje',itemType:'book',creators:[{creatorType:'author',lastName:'Pérez',firstName:'Alba'}],year:2021,publisher:'Editorial Universitaria'},href:'nodus://work/visual-source'};
  const citation={citationId:'visual-citation',citationItems:[{id:source.id,locator:'18',label:'page'}],sources:[source],noteIndex:0,placement:'in-text'};
  const document=[block('rich-heading','heading',[text('Lectura y evidencia')],{level:1}),block('rich-argument','paragraph',[text('La interpretación conserva una relación verificable con las fuentes '),{type:'nodusCitation',props:{payload:JSON.stringify(citation),label:''}},text('. '),{type:'nodusFootnote',props:{noteId:'rich-note',label:'1'}}]),block('rich-list','bulletListItem',[text('Volver al pasaje original')]),block('rich-list-two','bulletListItem',[text('Contrastar las interpretaciones')]),block('rich-figure','image',undefined,{url:figure,previewWidth:560,caption:'Lectura, análisis y escritura en el proceso de investigación',textAlignment:'left'}),block('rich-table','table',{type:'tableContent',rows:[{cells:[[text('Fuente')],[text('Evidencia')]]},{cells:[[text('Archivo histórico')],[text('Memoria del paisaje')]]},{cells:[[text('Testimonio')],[text('Experiencia del viaje')]]}]},{caption:'Fuentes utilizadas en el capítulo'}),block('rich-section','heading',[text('Discusión')],{level:2}),block('rich-final','paragraph',[text('Véase '),{type:'nodusCrossReference',props:{targetId:'rich-figure',label:'Figura',documentId:'',documentKind:'note'}},text('. La formulación se apoya en '),{type:'nodusFormula',props:{formula:'\\frac{x^2}{2}'}},text('.')])];
  const note=await window.nodus.createNote({title:'Manuscrito académico con fuentes y evidencia',content:''});
  const metadata={formatVersion:1,style:'apa',locale:'es-ES',placement:'in-text',notes:{'rich-note':{placement:'footnote',document:[block('rich-note-text','paragraph',[text('El pasaje conserva su contexto y permite revisar la interpretación.')])]}},evidence:[{id:'rich-evidence',blockId:'rich-argument',text:'La interpretación conserva una relación verificable',sourceHref:'nodus://work/visual-source',pageLabel:'18',physicalPage:21,status:'pending'}],manuscript:{kind:'thesis',chapters:[{documentId:chapterId,kind:'note',title:'Fuentes y método',included:true}],authors:'Alba Pérez',abstract:'Una lectura crítica del paisaje y sus fuentes.',keywords:'memoria, territorio, escritura',includeContents:true,paper:'A4',marginMm:25}};
  await window.nodus.updateWorkspaceNote(note.id,{title:note.title,contentMarkdown:'',nativeDocument:document,academicMetadata:metadata});
  await window.nodus.createWorkspaceAnnotation(note.id,{from:0,to:17,selectedText:'La interpretación',comment:'Contrastar este argumento con los testimonios y verificar la página citada.',anchor:{blockId:'rich-argument',from:0,to:17},pinned:true});
  return note.id;
 },{figure,chapterId:fixture.ids[1]});
 // Seeded through IPC outside the mounted catalog: reload its data before opening it.
 await page.reload();await page.getByTestId('app-shell').waitFor();await page.locator('[data-tour="nav-workspace"]').click();await home();await page.getByTestId('workspace-item-'+rich).click();await page.locator('.bn-editor').waitFor();
 for(const [theme,width,height] of [['light',1920,1080],['dark',1280,800]]){
  await page.evaluate(theme=>window.nodus.updateSettings({theme}),theme);await size(width,height);await capture('rich-editor-'+theme);
  await page.getByRole('button',{name:'Contexto',exact:true}).click();
  for(const [name,role] of [['Fuentes','tab'],['Comentarios','tab'],['Estructura','button'],['Comprobaciones','button'],['Historial','button']]){
   await page.locator('.editorial-inspector').getByRole(role,{name,exact:true}).click();if(name==='Estructura'){assert.match(await page.locator('.academic-caption-row').nth(0).innerText(),/Pie de figura 1/);assert.match(await page.locator('.academic-caption-row').nth(1).innerText(),/Título de tabla 1/);}await capture('rich-'+name.toLowerCase()+'-'+theme);
  }
  await page.getByRole('button',{name:'Cerrar contexto',exact:true}).click();
 }
 await page.evaluate(()=>window.nodus.updateSettings({theme:'light'}));await size(1280,800);await action('Manuscrito y citas');await page.getByLabel('Importar estilo CSL',{exact:true}).setInputFiles({name:'invalido.csl',mimeType:'application/xml',buffer:Buffer.from('<style>invalido</style>')});await page.locator('.academic-error').waitFor();await capture('invalid-csl-error');await closeDialog();await action('Nota al pie');
 const noteEditor=page.locator('.academic-dialog .bn-editor');await noteEditor.fill('Nota explicativa con formato y comandos contextuales.');await noteEditor.press('ControlOrMeta+A');await page.locator('.academic-dialog .bn-toolbar').first().waitFor();await capture('note-selection-toolbar');
 await noteEditor.press('ArrowRight');await noteEditor.press('Enter');await noteEditor.press('/');await page.locator('.academic-dialog [role=listbox]').first().waitFor();await capture('note-slash-menu');await page.keyboard.press('Escape');assert.equal(await page.locator('.academic-dialog').count(),1,'Escape dismisses the slash menu before closing the draft note');await closeDialog();
 await action('Preparar entrega');await page.waitForFunction(()=>document.querySelector('.academic-dialog select:not(:disabled)'));
 const ack=page.locator('.academic-dialog').getByRole('checkbox');if(await ack.count())await ack.check();await page.getByRole('button',{name:'Preparar vista previa',exact:true}).click();await page.locator('.academic-export-preview').waitFor({timeout:90000});await page.frameLocator('.academic-export-preview').getByRole('heading',{name:'Manuscrito académico con fuentes y evidencia',exact:true}).first().waitFor();await capture('delivery-preview-1280');await closeDialog();
 assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'results.json'),JSON.stringify({generatedAt:new Date().toISOString(),shots,errors,checks:['viewport dimensions','horizontal overflow','panels within content bounds','fixed header position with many tabs','modal footer visible and receives pointer','dialog keyboard containment','secondary context selected state']},null,2));
 console.log('PASS: full Scriptor visual matrix; '+shots.length+' real screenshots.');
} catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')});throw error;} finally{await app?.close();await rm(profile,{recursive:true,force:true});}
