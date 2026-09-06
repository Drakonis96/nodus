// Isolated renderer fixture: real Home components, deterministic local data, no vault I/O.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HomeView, GenealogyHome, DatabasesHome } from '../../../src/views/HomeView';
import { ProsopographyHome } from '../../../src/views/ProsopographyHome';
import { StudyHome } from '../../../src/views/StudyHome';
import { TeachingHome } from '../../../src/views/TeachingHome';
import { WorldbuildingHome } from '../../../src/views/WorldbuildingHome';
import { TestimonyHome } from '../../../src/views/TestimonyHome';
import { PrimarySourcesHomeView } from '../../../src/views/PrimarySourcesHomeView';
import { setActiveLang } from '../../../src/i18n';
import { dockColorForVaultType } from '../../../src/dockIcon';

const params = new URLSearchParams(location.search);
const vault = params.get('vault') ?? 'academic';
const theme = params.get('theme') ?? 'dark';
const lang = params.get('lang') ?? 'es';
const empty = params.has('empty');
const number = (n: number) => empty ? 0 : n;
setActiveLang(lang as any);
document.documentElement.className = `${theme} ${vault} reduce-motion`;
document.documentElement.style.setProperty('--interface-scale', params.get('scale') ?? '1');
const bucket = (count = 0) => ({ count: number(count), sample: [] });
const snapshot = {
  stats: Object.fromEntries(Object.entries({ totalWorks: 248, readTaggedWorks: 186, manualDeepWorks: 14, unreadWorks: 62, deepTarget: 186,
    lightDone: 248, lightPending: 0, lightMissing: 0, deepDone: 186, deepPending: 0, deepMissing: 0, skippedNoText: 0, failedWorks: 0,
    ideaNodes: 1248, themeNodes: 86, semanticEdges: 2410, totalEmbeddableIdeas: 1248, embeddedIdeas: 1248, embeddingIncompleteWorks: 0, gaps: 12, contradictions: 7,
  }).map(([k,v]) => [k, number(v)])),
  health: { totalWorks: number(248), withoutText: bucket(), lightOnly: bucket(), deepPriority: bucket(), pdfsToRecover: bucket(),
    embeddings: { totalIdeas: number(1248), embeddedIdeas: number(1248), pendingIdeas: 0, incompleteWorks: 0, passagesPendingWorks: 0 } },
  queue: { total: 0, done: 0, failed: 0, pending: 0, running: 0 }, latestSync: null,
};
const documents = empty ? [] : [{id:'doc-1',title:'Aprendizaje y memoria: notas de clase',kind:'note',shortId:'DOC-014',updatedAt:'2026-09-01T12:00:00Z'}];
const fixture: Record<string, unknown> = {
  getAcademicHomeSnapshot: snapshot,
  getStudyWorkspace: {courses:Array.from({length:number(4)}),subjects:Array.from({length:number(12)}),documents},
  listStudyMaterials: Array.from({length:number(38)}),
  recordCounts: {persons:number(146),places:number(24),events:number(83)}, archiveCounts:{items:number(217),folders:number(8)},
  allRelationships: Array.from({length:number(184)}), kinSuggestionCount:number(6), archiveIndexStatus:{indexed:number(194),total:number(217)},
  characterCounts:{total:number(42),byRole:{protagonist:number(5)},byStatus:{alive:number(34)}}, listCharacters:Array.from({length:number(42)},(_,i)=>({personId:`character-${i}`,displayName:['Elena del Norte','Darío Valcárcel','Mara del Río','Tomás de la Torre','Iria Valdés','Nicolás del Alba'][i%6],updatedAt:'2026-09-01T12:00:00Z',names:[],profile:{accent:'violet',narrativeRole:i<5?'protagonist':'supporting',lifeStatus:'alive'}})),
  listWorldEntries: Array.from({length:number(78)},(_,i)=>({stub:i<12})),
  testimonyDashboard: { metrics:{interviews:number(24),scheduled:number(3),pendingTranscription:number(4),reviewing:number(6),completed:number(11),recordedSeconds:number(84600),storageBytes:number(3800000000),participants:number(31),codes:number(18),annotations:number(127)},
    alerts:empty?[]:[{kind:'transcription_pending_review',count:4,interviewIds:['interview-1']}],
    recent:{interviews:empty?[]:[{id:'interview-1',title:'Memoria del barrio: primera entrevista',updatedAt:'2026-09-01T12:00:00Z'}],transcripts:[],notes:[],contrasts:[]},
    preservation:{lastBackupAt:empty?null:'2026-09-01T12:00:00Z',interviewsWithoutMaster:0,mediaWithoutHash:0,storageBytes:number(3800000000)} },
  getPrimarySourceOperationalDashboard:{ metrics:{descriptionUnits:number(128),preservedMasters:number(112),citationReadySources:number(86),identifiedPersons:number(74),documentedEvents:number(35),resolvedPlaces:number(21)},tasks:[],recentActivity:[],latestSource:null,
    preservation:{lastBackupAt:null,lastInventoryAt:null,verifiedFiles:number(112),pendingFiles:number(16),missingFiles:0,failedChecks:0,orphanDerivatives:0,unhashedLegacyFiles:0,originalsWithoutCopy:0,vaultSizeBytes:number(1200000000)} },
};
(window as any).__homeActions=[];
(window as any).nodus = new Proxy({}, {get:(_,name:string)=>{
  if(name.startsWith('on')) return ()=>()=>{};
  if(name in fixture) return async()=>fixture[name];
  throw new Error(`Unmocked Home API: ${name}`);
}});
const action = (name: string) => (...args: unknown[]) => { (window as any).__homeActions.push({name,args}); return Promise.resolve(); };
const shared:any = {settings:{monitoredCollections:['c1','c2','c3'],synthesisModel:{provider:'openai',model:'fixture'},extractionModel:{provider:'openai',model:'fixture'},syncMode:'manual',zoteroStoragePath:'/fixture'},
  vaultId:'fixture',vault:{name:'Archivo de investigación'},lastSync:null,syncing:false,showDemoOffer:params.has('demo'),demoBusy:false,
  databases:empty?[]:[{id:'db1',name:'Fuentes y bibliografía',shortId:'DB-001',icon:'book',rowCount:248},{id:'db2',name:'Personas y correspondencia',shortId:'DB-002',icon:'users',rowCount:146},{id:'db3',name:'Cronología del proyecto',shortId:'DB-003',icon:'calendar',rowCount:83}],
  ...Object.fromEntries(['onNavigate','onOpenDocument','onOpenSource','onOpenNote','onOpenInterview','onSync','onOpenLibraryBucket','onOpenAssistant','onLoadDemo','onLoadGenealogyDemo','onLoadDatabasesDemo','onOpenDatabase','onNewDatabase','onImportCsv','onImportNotion','onOpenAnalysis','onOpenChat','onOpenDeepResearch'].map(name=>[name,action(name)]))};
const Component:any = {academic:HomeView,prosopography:ProsopographyHome,genealogy:GenealogyHome,databases:DatabasesHome,estudio:StudyHome,docencia:TeachingHome,worldbuilding:WorldbuildingHome,testimonios:TestimonyHome,'primary-sources':PrimarySourcesHomeView}[vault];
createRoot(document.getElementById('root')!).render(<main style={{height:'100vh',marginLeft:`${params.get('sidebar')??176}px`,'--vault-accent':dockColorForVaultType(vault === 'primary-sources' ? 'primary_sources' : vault)} as React.CSSProperties}><Component {...shared}/></main>);
