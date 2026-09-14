import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DeepResearchView } from '../src/views/DeepResearchView';
import { ImmersionView } from '../src/views/ImmersionView';
import { AudioPlayerProvider } from '../src/components/AudioPlayer';
import { setActiveLang, t } from '../src/i18n';
import { applyThemeClasses } from '../src/theme';
import '../src/index.css';

// Deterministic local fixtures: the production views render unchanged; only IPC is replaced.
const samples = await fetch('/artifacts/document-skills/samples.json').then(r => r.json());
const query = new URLSearchParams(location.search);
const lang = query.get('lang') || 'es';
const settings = { uiLanguage: lang, imageStyle: 'antique_book', synthesisModel: {provider:'openai',model:'gpt-5'}, openaiKeySet:true } as any;
let drafts = [samples.deep];
let sessions = [samples.immersion];
const annotations: any[] = [];
(window as any).testAnnotations = annotations;
const listeners = new Set<() => void>();
const api = {
  listWritingDraftAnnotations: async () => annotations,
  createWritingDraftAnnotation: async (input:any) => { const value={...input,id:crypto.randomUUID()};annotations.push(value);return value; },
  getSettings: async () => settings,
  listDocumentSkills: async () => samples.options,
  getDocumentVisuals: async (target: any) => target.kind === 'deep-research' ? samples.deepManifest : samples.immersionManifest,
  listModels: async () => [{provider:'openai',id:'gpt-5',name:'GPT-5'}],
  readCapabilityModel: async () => ({bytes:Uint8Array.from(atob(samples.modelBase64), c=>c.charCodeAt(0)),mimeType:'model/gltf+json'}),
  getAudioSegments: async () => [],
  listWritingWorkshopDrafts: async () => drafts,
  listDeepResearchJobs: async () => [],
  onWritingDraftsChanged: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
  listImmersionSessions: async () => sessions.map((s) => ({ ...s, title: s.plan.title, stats: s.plan.stats, finished: !!s.progress.finishedAt, progressPct: Math.round(s.progress.completedSteps.length / 7 * 100) })),
  getImmersionSession: async (id: string) => structuredClone(sessions.find((s) => s.id === id) ?? null),
  setImmersionProgress: async (id: string, progress: any) => { sessions = sessions.map((s) => s.id === id ? { ...s, progress } : s); },
};
window.nodus = new Proxy(api, { get(target, key: string) {
  if (key in target) return target[key as keyof typeof target];
  if (key.startsWith('on')) return () => () => {};
  if (key.startsWith('list')) return async () => [];
  return async () => null;
} }) as any;
(window as any).removeReport = (id: string) => { drafts = drafts.filter((d) => d.id !== id); listeners.forEach((fn) => fn()); };
(window as any).snapshots = {};
function Harness() {
  const immersion = new URLSearchParams(location.search).get('section') === 'immersion';
  const [revision, setRevision] = useState(0);
  (window as any).remount = () => new Promise<void>((resolve) => {
    setRevision((n) => n + 1);
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  const section = immersion ? 'immersion' : 'research';
  return <AudioPlayerProvider><main className="h-full min-h-0 flex flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" key={revision}>
    {immersion
      ? <ImmersionView settings={settings} snapshot={(window as any).snapshots[section]} onSnapshotChange={(patch) => { (window as any).snapshots[section] = { ...(window as any).snapshots[section], ...patch }; }} />
      : <DeepResearchView settings={settings} snapshot={(window as any).snapshots[section]} onSnapshotChange={(patch) => { (window as any).snapshots[section] = { ...(window as any).snapshots[section], ...patch }; }} />}
  </main></AudioPlayerProvider>;
}
setActiveLang(lang as any);
(window as any).testLabels = {create:t('Nueva inmersión'),warning:t('Esta skill tiene coste por llamada. El importe depende del proveedor y del modelo.')};
(window as any).testApplyTheme = applyThemeClasses;
applyThemeClasses(query.get('theme') === 'light' ? 'light' : 'dark');
createRoot(document.getElementById('root')!).render(<Harness />);
