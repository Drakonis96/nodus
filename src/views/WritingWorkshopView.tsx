import { useMemo, useState } from 'react';
import type React from 'react';
import type {
  AppSettings,
  WritingWorkshopBrief,
  WritingWorkshopCandidateBase,
  WritingWorkshopContradictionCandidate,
  WritingWorkshopDraft,
  WritingWorkshopGapCandidate,
  WritingWorkshopIdeaCandidate,
  WritingWorkshopRouteCandidate,
  WritingWorkshopSelection,
  WritingWorkshopSnapshot,
  WritingWorkshopThemeCandidate,
  WritingWorkshopWorkCandidate,
} from '@shared/types';
import type { PendingGraphNavigationTarget } from '../navigation';
import { Badge, EDGE_LABELS, Icon, NODE_LABELS, modelLabel } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { Markdown, type MarkdownCitation } from '../components/Markdown';
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';

const KIND_LABELS: Record<WritingWorkshopBrief['kind'], string> = {
  literature_review: 'Estado de la cuestión',
  theoretical_framework: 'Marco teórico',
  debate: 'Debate entre autores',
  gap_justification: 'Justificación de hueco',
  chapter_section: 'Apartado de capítulo',
  research_question: 'Pregunta / hipótesis',
};

const TONE_LABELS: Record<NonNullable<WritingWorkshopBrief['tone']>, string> = {
  academic: 'Académico',
  synthetic: 'Sintético',
  critical: 'Crítico',
  exploratory: 'Exploratorio',
};

const EMPTY_SELECTION: WritingWorkshopSelection = {
  ideaIds: [],
  themeIds: [],
  gapIds: [],
  contradictionIds: [],
  workIds: [],
  tutorRouteIds: [],
};

type MaterialTab = 'ideas' | 'themes' | 'gaps' | 'contradictions' | 'works' | 'routes';

export function WritingWorkshopView({
  settings,
  onOpenGraph,
}: {
  settings: AppSettings;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
}) {
  const [brief, setBrief] = useState<WritingWorkshopBrief>({
    kind: 'literature_review',
    objective: '',
    tone: 'academic',
    language: 'es',
  });
  const [selectedModel, setSelectedModel] = useState(settings.synthesisModel ?? settings.defaultModel);
  const [snapshot, setSnapshot] = useState<WritingWorkshopSnapshot | null>(null);
  const [selection, setSelection] = useState<WritingWorkshopSelection>(EMPTY_SELECTION);
  const [activeTab, setActiveTab] = useState<MaterialTab>('ideas');
  const [draft, setDraft] = useState<WritingWorkshopDraft | null>(null);
  const [citation, setCitation] = useState<CitationTarget>(null);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedCount = useMemo(() => countSelection(selection), [selection]);
  const hasModel = !!selectedModel;

  const prepare = async () => {
    setError(null);
    setMessage(null);
    setDraft(null);
    setLoadingMaterials(true);
    try {
      const next = await window.nodus.getWritingWorkshopSnapshot(brief);
      setSnapshot(next);
      setSelection(next.recommendedSelection);
      setMessage('Mesa preparada con materiales recomendados.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMaterials(false);
    }
  };

  const generate = async () => {
    setError(null);
    setMessage(null);
    setGenerating(true);
    try {
      const result = await window.nodus.generateWritingWorkshopDraft({
        brief,
        selection,
        model: selectedModel,
      });
      setDraft(result);
      setMessage('Borrador generado con matriz y citas.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const exportDraft = async () => {
    if (!draft) return;
    setExporting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.nodus.exportWritingWorkshopDraft({ draft });
      if (result) setMessage(`Exportado: ${result.path}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const copyDraft = async () => {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.draftMarkdown);
    setMessage('Borrador copiado.');
  };

  const toggle = (key: keyof WritingWorkshopSelection, id: string) => {
    setSelection((current) => {
      const next = new Set(current[key]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, [key]: Array.from(next) };
    });
  };

  const applyRecommended = () => {
    if (!snapshot) return;
    setSelection(snapshot.recommendedSelection);
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <header className="border-b border-neutral-800 p-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem]">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Icon name="edit" className="text-indigo-300" /> Taller de escritura
          </h1>
          <p className="text-xs text-neutral-500 mt-1">Del grafo a un borrador con fuentes verificables.</p>
        </div>
        <select
          className="input"
          value={brief.kind}
          onChange={(e) => setBrief((current) => ({ ...current, kind: e.target.value as WritingWorkshopBrief['kind'] }))}
        >
          {Object.entries(KIND_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={brief.tone ?? 'academic'}
          onChange={(e) => setBrief((current) => ({ ...current, tone: e.target.value as WritingWorkshopBrief['tone'] }))}
        >
          {Object.entries(TONE_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={brief.language ?? 'es'}
          onChange={(e) => setBrief((current) => ({ ...current, language: e.target.value as WritingWorkshopBrief['language'] }))}
        >
          <option value="es">Español</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
        </select>
        <ModelPicker settings={settings} value={selectedModel} onChange={setSelectedModel} compact />
        <div className="flex-1" />
        <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={prepare} disabled={loadingMaterials}>
          <Icon name={loadingMaterials ? 'sync' : 'search'} className={loadingMaterials ? 'animate-spin' : ''} />
          Preparar mesa
        </button>
        <button
          className="btn btn-primary gap-1.5"
          onClick={generate}
          disabled={!hasModel || generating || selectedCount === 0}
          title={!hasModel ? 'Configura un modelo de síntesis' : undefined}
        >
          <Icon name={generating ? 'sync' : 'wand'} className={generating ? 'animate-spin' : ''} />
          Generar borrador
        </button>
      </header>

      <div className="border-b border-neutral-800 p-3">
        <textarea
          className="input w-full min-h-20 resize-y"
          value={brief.objective}
          onChange={(e) => setBrief((current) => ({ ...current, objective: e.target.value }))}
          placeholder="Describe el apartado que quieres construir..."
        />
        <div className="flex flex-wrap gap-2 mt-2 text-xs text-neutral-500">
          {snapshot && (
            <>
              <Badge>{selectedCount} materiales seleccionados</Badge>
              <Badge>{snapshot.stats.ideas} ideas</Badge>
              <Badge>{snapshot.stats.gaps} huecos</Badge>
              <Badge>{snapshot.stats.contradictions} contradicciones</Badge>
              <button className="btn btn-ghost border border-neutral-700 py-1 text-xs" onClick={applyRecommended}>
                Recomendados
              </button>
              <button className="btn btn-ghost border border-neutral-700 py-1 text-xs" onClick={() => setSelection(EMPTY_SELECTION)}>
                Vaciar
              </button>
            </>
          )}
          {selectedModel && <span>Modelo: {modelLabel(selectedModel)}</span>}
        </div>
      </div>

      {(message || error) && (
        <div className={`px-4 py-2 text-sm border-b ${error ? 'border-red-900 bg-red-950/30 text-red-200' : 'border-neutral-800 text-neutral-400'}`}>
          {error ?? message}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-[22rem_minmax(0,1fr)_24rem] max-xl:grid-cols-1">
        <aside className="border-r border-neutral-800 min-h-0 flex flex-col max-xl:border-r-0 max-xl:border-b">
          <div className="p-3 border-b border-neutral-800 grid grid-cols-3 gap-1 text-xs">
            <TabButton id="ideas" active={activeTab} setActive={setActiveTab} label={`Ideas ${selection.ideaIds.length}`} />
            <TabButton id="themes" active={activeTab} setActive={setActiveTab} label={`Temas ${selection.themeIds.length}`} />
            <TabButton id="gaps" active={activeTab} setActive={setActiveTab} label={`Huecos ${selection.gapIds.length}`} />
            <TabButton id="contradictions" active={activeTab} setActive={setActiveTab} label={`Contrad. ${selection.contradictionIds.length}`} />
            <TabButton id="works" active={activeTab} setActive={setActiveTab} label={`Obras ${selection.workIds.length}`} />
            <TabButton id="routes" active={activeTab} setActive={setActiveTab} label={`Rutas ${selection.tutorRouteIds.length}`} />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {!snapshot && (
              <div className="text-sm text-neutral-500 p-3">
                Escribe un objetivo y prepara la mesa para seleccionar materiales.
              </div>
            )}
            {snapshot && activeTab === 'ideas' && snapshot.ideas.map((item) => (
              <IdeaCard key={item.id} item={item} selected={selection.ideaIds.includes(item.id)} onToggle={() => toggle('ideaIds', item.id)} />
            ))}
            {snapshot && activeTab === 'themes' && snapshot.themes.map((item) => (
              <ThemeCard key={item.id} item={item} selected={selection.themeIds.includes(item.id)} onToggle={() => toggle('themeIds', item.id)} />
            ))}
            {snapshot && activeTab === 'gaps' && snapshot.gaps.map((item) => (
              <GapCard key={item.id} item={item} selected={selection.gapIds.includes(item.id)} onToggle={() => toggle('gapIds', item.id)} />
            ))}
            {snapshot && activeTab === 'contradictions' && snapshot.contradictions.map((item) => (
              <ContradictionCard
                key={item.id}
                item={item}
                selected={selection.contradictionIds.includes(item.id)}
                onToggle={() => toggle('contradictionIds', item.id)}
              />
            ))}
            {snapshot && activeTab === 'works' && snapshot.works.map((item) => (
              <WorkCard key={item.id} item={item} selected={selection.workIds.includes(item.id)} onToggle={() => toggle('workIds', item.id)} />
            ))}
            {snapshot && activeTab === 'routes' && snapshot.tutorRoutes.map((item) => (
              <RouteCard
                key={item.id}
                item={item}
                selected={selection.tutorRouteIds.includes(item.id)}
                onToggle={() => toggle('tutorRouteIds', item.id)}
              />
            ))}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto p-5">
          {!draft && (
            <div className="h-full flex items-center justify-center">
              <div className="max-w-md text-center text-neutral-500 text-sm">
                {generating ? 'Generando borrador...' : 'El borrador aparecerá aquí cuando selecciones materiales y lo generes.'}
              </div>
            </div>
          )}
          {draft && (
            <div className="max-w-4xl mx-auto space-y-5">
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-semibold">{draft.title}</h2>
                  <p className="text-sm text-neutral-400 mt-1">{draft.abstract}</p>
                </div>
                <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={copyDraft}>
                  <Icon name="check" /> Copiar
                </button>
                <button className="btn btn-primary gap-1.5" onClick={exportDraft} disabled={exporting}>
                  <Icon name={exporting ? 'sync' : 'download'} className={exporting ? 'animate-spin' : ''} /> Exportar
                </button>
              </div>
              <section className="card p-4">
                <h3 className="font-semibold mb-3">Esquema</h3>
                <div className="space-y-3">
                  {draft.outline.map((section, index) => (
                    <div key={section.id} className="border-l-2 border-indigo-700 pl-3">
                      <div className="font-medium text-sm">
                        {index + 1}. {section.title}
                      </div>
                      <p className="text-xs text-neutral-400 mt-1">{section.purpose}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {section.sources.slice(0, 6).map((source, i) => (
                          <Badge key={`${section.id}-${i}`}>{source.replace(/\[|\]|\(.+\)/g, '')}</Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="card p-4">
                <Markdown content={draft.draftMarkdown} onCitation={(c: MarkdownCitation) => setCitation(c)} />
              </section>
            </div>
          )}
        </main>

        <aside className="border-l border-neutral-800 min-h-0 overflow-y-auto p-4 max-xl:border-l-0 max-xl:border-t">
          <h2 className="font-semibold text-sm mb-3">Matriz de apoyo</h2>
          {!draft && <div className="text-sm text-neutral-500">Sin matriz todavía.</div>}
          {draft && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 mb-3">
                <Metric label="Ideas" value={draft.stats.selectedIdeas} />
                <Metric label="Huecos" value={draft.stats.selectedGaps} />
                <Metric label="Obras" value={draft.stats.selectedWorks} />
                <Metric label="Contexto" value={formatChars(draft.stats.contextChars)} />
              </div>
              {draft.matrix.map((row, index) => (
                <div key={index} className="card p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge color={matrixColor(row.role)}>{row.role}</Badge>
                    <span className="text-xs text-neutral-500 truncate">{row.sourceLabel}</span>
                  </div>
                  <p className="text-sm text-neutral-200">{row.claim}</p>
                  {row.evidence && <p className="text-xs text-neutral-500 mt-1">{row.evidence}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    {row.citation && (
                      <button className="text-xs text-indigo-300 hover:underline" onClick={() => openMatrixCitation(row.citation, setCitation)}>
                        abrir fuente
                      </button>
                    )}
                    {row.notes && <span className="text-xs text-neutral-600">{row.notes}</span>}
                  </div>
                </div>
              ))}
              <PanelList title="Siguientes pasos" items={draft.nextSteps} />
              <PanelList title="Limitaciones" items={draft.limitations} />
              <PanelList title="Bibliografía" items={draft.bibliography} />
            </div>
          )}
        </aside>
      </div>

      {citation && (
        <SourceCitationModal
          target={citation}
          onClose={() => setCitation(null)}
          onOpenGraph={(target) => {
            setCitation(null);
            onOpenGraph(target);
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  id,
  active,
  setActive,
  label,
}: {
  id: MaterialTab;
  active: MaterialTab;
  setActive: (tab: MaterialTab) => void;
  label: string;
}) {
  return (
    <button
      className={`rounded-md px-2 py-1 text-left ${active === id ? 'bg-indigo-600 text-white' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800'}`}
      onClick={() => setActive(id)}
    >
      {label}
    </button>
  );
}

function CandidateShell({
  item,
  selected,
  onToggle,
  children,
}: {
  item: WritingWorkshopCandidateBase;
  selected: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`card p-3 w-full text-left transition-colors ${selected ? 'ring-1 ring-indigo-500 bg-neutral-800/80' : 'hover:bg-neutral-800/60'}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="flex items-start gap-2">
        <input className="mt-1 accent-indigo-500" type="checkbox" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm line-clamp-2">{item.label}</div>
          <p className="text-xs text-neutral-400 mt-1 line-clamp-3">{item.summary}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            <Badge>{Math.round(item.score * 100)}%</Badge>
            <Badge color="cyan">{item.reason}</Badge>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function IdeaCard({ item, selected, onToggle }: { item: WritingWorkshopIdeaCandidate; selected: boolean; onToggle: () => void }) {
  return (
    <CandidateShell item={item} selected={selected} onToggle={onToggle}>
      <div className="flex flex-wrap gap-1 mt-2">
        <Badge color="indigo">{NODE_LABELS[item.type]}</Badge>
        <Badge>{item.workCount} obras</Badge>
        <Badge>{item.evidenceCount} evidencias</Badge>
      </div>
    </CandidateShell>
  );
}

function ThemeCard({ item, selected, onToggle }: { item: WritingWorkshopThemeCandidate; selected: boolean; onToggle: () => void }) {
  return (
    <CandidateShell item={item} selected={selected} onToggle={onToggle}>
      <div className="flex flex-wrap gap-1 mt-2">
        {item.pinned && <Badge color="amber">curado</Badge>}
        <Badge>{item.ideaCount} ideas</Badge>
        <Badge>{item.workCount} obras</Badge>
      </div>
    </CandidateShell>
  );
}

function GapCard({ item, selected, onToggle }: { item: WritingWorkshopGapCandidate; selected: boolean; onToggle: () => void }) {
  return (
    <CandidateShell item={item} selected={selected} onToggle={onToggle}>
      <div className="text-xs text-neutral-500 mt-2">
        {item.work.authors[0] ?? 'Autoría no disponible'} {item.work.year ?? ''}
      </div>
    </CandidateShell>
  );
}

function ContradictionCard({
  item,
  selected,
  onToggle,
}: {
  item: WritingWorkshopContradictionCandidate;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <CandidateShell item={item} selected={selected} onToggle={onToggle}>
      <div className="flex flex-wrap gap-1 mt-2">
        <Badge color="red">{EDGE_LABELS[item.type as keyof typeof EDGE_LABELS] ?? item.type}</Badge>
        <Badge>{item.basis}</Badge>
        <Badge>conf {item.confidence.toFixed(2)}</Badge>
      </div>
    </CandidateShell>
  );
}

function WorkCard({ item, selected, onToggle }: { item: WritingWorkshopWorkCandidate; selected: boolean; onToggle: () => void }) {
  return (
    <CandidateShell item={item} selected={selected} onToggle={onToggle}>
      <div className="flex flex-wrap gap-1 mt-2">
        <Badge color={item.deepStatus === 'done' ? 'green' : 'neutral'}>{item.deepStatus === 'done' ? 'analizada' : item.deepStatus}</Badge>
        <Badge>{item.ideaCount} ideas</Badge>
        <Badge>{item.gapCount} huecos</Badge>
      </div>
    </CandidateShell>
  );
}

function RouteCard({ item, selected, onToggle }: { item: WritingWorkshopRouteCandidate; selected: boolean; onToggle: () => void }) {
  return (
    <CandidateShell item={item} selected={selected} onToggle={onToggle}>
      <div className="flex flex-wrap gap-1 mt-2">
        <Badge color="indigo">{item.stops} paradas</Badge>
        {item.rating && <Badge color="amber">★ {item.rating}</Badge>}
      </div>
    </CandidateShell>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-neutral-800 px-2 py-1.5">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function PanelList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="pt-3 border-t border-neutral-800">
      <h3 className="font-semibold text-sm mb-2">{title}</h3>
      <ul className="space-y-1 text-xs text-neutral-400">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function countSelection(selection: WritingWorkshopSelection): number {
  return (
    selection.ideaIds.length +
    selection.themeIds.length +
    selection.gapIds.length +
    selection.contradictionIds.length +
    selection.workIds.length +
    selection.tutorRouteIds.length
  );
}

function matrixColor(role: WritingWorkshopDraft['matrix'][number]['role']): 'neutral' | 'indigo' | 'green' | 'amber' | 'red' | 'cyan' {
  switch (role) {
    case 'contrast':
      return 'red';
    case 'gap':
      return 'amber';
    case 'method':
      return 'cyan';
    case 'definition':
      return 'indigo';
    case 'context':
      return 'neutral';
    case 'support':
      return 'green';
  }
}

function openMatrixCitation(value: string, setCitation: (target: CitationTarget) => void) {
  const citation = parseNodusCitation(value);
  if (citation) setCitation(citation);
}

function parseNodusCitation(value: string): Exclude<CitationTarget, null> | null {
  const idea = value.match(/^nodus:\/\/idea\/(.+)$/);
  if (idea) return { kind: 'idea', id: decodeURIComponent(idea[1]) };
  const work = value.match(/^nodus:\/\/work\/(.+)$/);
  if (work) return { kind: 'work', id: decodeURIComponent(work[1]) };
  const gap = value.match(/^nodus:\/\/gap\/(.+)$/);
  if (gap) return { kind: 'gap', id: decodeURIComponent(gap[1]) };
  const contradiction = value.match(/^nodus:\/\/contradiction\/(.+)$/);
  if (contradiction) return { kind: 'contradiction', id: decodeURIComponent(contradiction[1]) };
  return null;
}

function formatChars(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}
