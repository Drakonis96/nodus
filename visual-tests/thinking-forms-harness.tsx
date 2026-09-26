import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ComposerModal, DEEP_RESEARCH_COPY } from '../src/views/DeepResearchView';
import { ImmersionComposerModal } from '../src/views/ImmersionView';
import { SkillCard } from '../src/components/skillLibrary';
import { useDocumentSkills } from '../src/components/DocumentSkillsControl';
import { useResearchEffort } from '../src/hooks/useResearchEffort';
import { setActiveLang } from '../src/i18n';
import type { AppSettings, ModelRef } from '../shared/types';
import type { ChatSkill } from '../shared/chatSkills';
import '../src/index.css';
import '../src/components/chatSkills.css';

/**
 * The production Deep Research and Immersion forms and the production skill card, with a
 * renderer-only `window.nodus`: the thinking level each form offers, remembers and sends,
 * and how a skill with tools looks beside one without. `?view=deep|immersion|skills`,
 * `?model=provider:model`, `?theme=dark`. The remembered levels live in `window.prefs`
 * (kept in sessionStorage so a reload reads what the previous page saved).
 */
const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'deep';
const [provider, ...rest] = (params.get('model') ?? 'openai:gpt-5.4').split(':');
const model = { provider, model: rest.join(':') } as ModelRef;
const win = window as any;
win.prefs = JSON.parse(sessionStorage.getItem('prefs') ?? '{}');
win.updates = [];
win.sent = [];
const settings = { deepResearchModel: model, immersionModel: model, synthesisModel: model, chatModel: model, researchEffortByModel: win.prefs.researchEffortByModel ?? {},
  openaiApiKeySet: true, providers: {} } as unknown as AppSettings;
win.nodus = new Proxy({
  getSettings: async () => ({ ...settings, researchEffortByModel: win.prefs.researchEffortByModel ?? {} }),
  updateSettings: async (patch: Partial<AppSettings>) => {
    win.updates.push(patch);
    Object.assign(win.prefs, patch);
    sessionStorage.setItem('prefs', JSON.stringify(win.prefs));
    return { ...settings, ...win.prefs };
  },
  listModels: async () => [{ id: model.model, reasoning: true, supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map(reasoningEffort => ({ reasoningEffort })) }],
  listDocumentSkills: async () => [],
  getActiveVault: async () => ({ id: 'vault', type: 'academic' }),
}, { get(target: any, key: string) { return target[key] ?? (key.startsWith('on') ? () => () => {} : async () => []); } });
setActiveLang('es');
document.documentElement.className = params.get('theme') === 'dark' ? 'dark' : 'light';

function DeepResearchForm() {
  const documentSkills = useDocumentSkills();
  const [selected, setSelected] = useState<ModelRef | null>(model);
  const [thinkingEffort, setThinkingEffort] = useResearchEffort(settings, selected);
  const noop = () => {};
  return <ComposerModal documentSkills={documentSkills} settings={settings} copy={DEEP_RESEARCH_COPY.academic} structureMode="ai" unitOutline={[]} onStructureMode={noop} onUnitOutline={noop}
    objective="El papel de la administración turística" approach="general" version="v2" audience={'general' as never} language="es" model={selected}
    thinkingEffort={thinkingEffort} onThinkingEffort={setThinkingEffort} sectionLimit="auto" sectionLength="auto" onSectionLength={noop} onSectionLengthValid={noop}
    includeImage={false} imageStyle={'editorial' as never} hasModel queuedCount={0} onObjective={noop} onApproach={noop} onVersion={noop} onAudience={noop} onLanguage={noop}
    onModel={setSelected} onSectionLimit={noop} onIncludeImage={noop} onImageStyle={noop}
    onSubmit={() => win.sent.push({ model: selected, thinkingEffort })} onClose={noop} />;
}

function ImmersionForm() {
  const documentSkills = useDocumentSkills();
  const [thinkingEffort, setThinkingEffort] = useResearchEffort(settings, model);
  const noop = () => {};
  return <ImmersionComposerModal documentSkills={documentSkills} settings={settings} topic="La Revolución industrial" minutes={30} includeQuiz includeImage={false} imageStyle={'editorial' as never}
    language="es" model={model} thinkingEffort={thinkingEffort} onThinkingEffort={setThinkingEffort} hasModel scoping={false} error={null}
    onTopic={noop} onMinutes={noop} onIncludeQuiz={noop} onIncludeImage={noop} onImageStyle={noop} onLanguage={noop} onModel={noop}
    onExplore={() => win.sent.push({ model, thinkingEffort })} onClose={noop} />;
}

function Skills() {
  const skill = (id: string, name: string, extra: Partial<ChatSkill>, enabled: boolean): ChatSkill => ({ id, name, description: 'Una skill de prueba para comparar su aspecto.', instructions: '', enabled: { assistant: enabled, nodi: enabled }, ...extra });
  const cards = [skill('prompt-on', 'Síntesis crítica', {}, true), skill('tool-on', 'Diagramas SVG', { builtin: 'svg' }, true), skill('prompt-off', 'Guía socrática', {}, false), skill('tool-off', 'Imágenes', { builtin: 'image' }, false)];
  return <div style={{ width: 560, margin: 24, ['--vault-accent' as never]: '#8b5cf6' }}>
    <div className="chat-skills-list" style={{ display: 'grid', gap: 8 }}>{cards.map(card => <div key={card.id} data-testid={`skill-${card.id}`}>
      <SkillCard skill={card} surfaces={['assistant']} busy={false} expanded={false} meta="" onToggleDetails={() => {}} onEnable={() => {}} />
    </div>)}</div>
  </div>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<div style={{ minHeight: '100vh', ['--vault-accent' as never]: '#8b5cf6' }} className="bg-neutral-100 dark:bg-neutral-900">
  {view === 'immersion' ? <ImmersionForm /> : view === 'skills' ? <Skills /> : <DeepResearchForm />}
</div>);
