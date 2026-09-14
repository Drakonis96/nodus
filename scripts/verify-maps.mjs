import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const root=path.resolve(import.meta.dirname,'..'), out=path.join(root,'artifacts/maps');
fs.mkdirSync(path.join(out,'sources'),{recursive:true});
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-map-demo-'));
const require=createRequire(import.meta.url);
const bundle=async(name,file)=>{const dest=path.join(scratch,name+'.cjs');await build({entryPoints:[file],outfile:dest,bundle:true,format:'cjs',platform:'node',logLevel:'silent'});return require(dest);};
let browser;
try{
 const {createMapService}=await bundle('service',path.join(root,'electron/capabilities/maps/service.ts'));
 const {mapSourceTransport}=await bundle('source',path.join(root,'electron/capabilities/maps/sources.ts'));
 const {sanitizeChatSvg}=await bundle('sanitize',path.join(root,'shared/chatSvg.ts'));
 const transport={async read(url,signal,limit){const file=path.join(out,'sources',createHash('sha256').update(url).digest('hex')+'.json');if(fs.existsSync(file))return fs.readFileSync(file);const bytes=await mapSourceTransport.read(url,signal,limit);fs.writeFileSync(file,bytes);return bytes;}};
 const service=createMapService({providers:['natural-earth','geoboundaries'],transport});
 const signal=new AbortController().signal;
 const countries=await service.retrieve({provider:'natural-earth'},signal);
 const adm1=await service.retrieve({provider:'geoboundaries',country:'ESP',level:1},signal);
 const adm2=await service.retrieve({provider:'geoboundaries',country:'ESP',level:2},signal);
 console.log('Source counts:',countries.geojson.features.length,adm1.geojson.features.length,adm2.geojson.features.length);
 console.log('Province names:',adm2.geojson.features.map(f=>f.properties.name).join(', '));
 const colors=['#7467b5','#559f9b','#c89b53','#ba687a','#628bb3'];
 const provinces=['Albacete','Ciudad Real','Cuenca','Guadalajara','Toledo'];
 const selected=provinces.map(name=>{const feature=adm2.geojson.features.find(f=>f.properties.name===name);assert.ok(feature,'Provider has '+name);return name;});
 const points=[{coordinates:[-3.7038,40.4168],label:'Madrid'},{coordinates:[2.3522,48.8566],label:'Paris'},{coordinates:[-.1276,51.5072],label:'London'}];
 const overlaySource={label:'Illustrative city-centre coordinates',attribution:'Nodus demonstration: supplied city-centre coordinates; illustrative connections',license:'CC0'};
 const examples=[
  ['spain-communities',{title:'Spain · autonomous communities and autonomous cities',alt:'Spain administrative level 1, using the published 2017 boundary snapshot.',height:900,layers:[{datasetId:adm1.datasetId,colors:{property:'name',values:adm1.geojson.features.filter(f=>/Castilla|Andaluc/i.test(f.properties.name)).map((f,i)=>({value:f.properties.name,color:colors[i%5]}))}}]}],
  ['spain-provinces',{title:'Spain · provinces and autonomous cities',alt:'The 52 administrative level 2 features in the published boundary dataset.',height:1000,layers:[{datasetId:adm2.datasetId,colors:{property:'name',values:provinces.map((value,i)=>({value,color:colors[i]}))}}],legend:provinces.map((label,i)=>({label,color:colors[i]}))}],
  ['castilla-la-mancha',{title:'Castilla-La Mancha · five provinces',alt:'Albacete, Ciudad Real, Cuenca, Guadalajara and Toledo in five illustrative categories.',height:1000,layers:[{datasetId:adm2.datasetId,select:{property:'name',values:selected},colors:{property:'name',values:provinces.map((value,i)=>({value,color:colors[i]}))},labelProperty:'name'}],legend:provinces.map((label,i)=>({label:`${label} · ${String.fromCharCode(65+i)}`,color:colors[i]}))}],
  ['world',{title:'World · selected countries',alt:'Spain, France, the United Kingdom, Mexico and Japan highlighted on an Equal Earth map.',height:820,layers:[{datasetId:countries.datasetId,colors:{property:'iso',values:['ESP','FRA','GBR','MEX','JPN'].map((value,i)=>({value,color:colors[i]}))}}],legend:['Spain','France','United Kingdom','Mexico','Japan'].map((label,i)=>({label,color:colors[i]}))}],
  ['europe-routes',{title:'Research locations · Madrid → Paris → London',alt:'Exact supplied coordinate markers over a map of Europe, with curved arrow connections and a straight comparison connection.',projection:'mercator',bounds:[-12,34,17,58],layers:[{datasetId:countries.datasetId,select:{property:'continent',values:['Europe']},colors:{property:'iso',values:['ESP','FRA','GBR'].map((value,i)=>({value,color:colors[i]}))}}],markers:points,routes:[{coordinates:points.map(p=>p.coordinates),kind:'curved',arrow:true,color:'#a35374',width:3},{coordinates:[points[0].coordinates,points[2].coordinates],kind:'straight',color:'#688295',width:1.5}],overlaySource,legend:[{label:'Illustrative itinerary',color:'#a35374'},{label:'Direct connection',color:'#688295'}]}],
 ];
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1100,height:1000},deviceScaleFactor:1});
 const manifest=[];
 for(const [id,input] of examples){
   const result=await service.render(input,signal);
   assert.ok(Buffer.byteLength(JSON.stringify(result))<=10_000_000,'Map data fits the existing chat attachment ceiling');
   const sanitized=await page.evaluate(({fn,svg})=>{const clean=eval('('+fn+')')(svg);if(!clean)throw new Error('SVG rejected');const parsed=new DOMParser().parseFromString(clean.svg,'image/svg+xml');if(!parsed.querySelector('#nodus-map-provenance'))throw new Error('Lost map provenance');return clean.svg;},{fn:sanitizeChatSvg.toString(),svg:result.svg});
   assert.ok(sanitized.includes('nodus-map-provenance'));fs.writeFileSync(path.join(out,id+'.svg'),sanitized);fs.writeFileSync(path.join(out,id+'.json'),JSON.stringify(result,null,2));
   await page.setViewportSize({width:input.width??1100,height:input.height??820});
   await page.setContent('<body style="margin:0"><img alt="Generated map" style="display:block;width:100%" src="data:image/svg+xml;base64,'+Buffer.from(sanitized).toString('base64')+'"></body>');
   await page.locator('img').evaluate(img=>img.decode());await page.screenshot({path:path.join(out,id+'.png')});
   manifest.push({id,features:result.geometry.map(g=>g.features.length),svgBytes:Buffer.byteLength(sanitized),sources:result.provenance.sources});console.log('Rendered',id,Buffer.byteLength(sanitized));
 }
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(manifest,null,2));
 console.log('Map examples generated and passed the production SVG sanitizer.');
}finally{await browser?.close();fs.rmSync(scratch,{recursive:true,force:true});}
