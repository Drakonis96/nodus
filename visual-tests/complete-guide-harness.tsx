import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { CompleteGuideComposer, EMPTY_COMPLETE_GUIDE_STATE, type CompleteGuideComposerState } from '../src/components/CompleteGuideComposer';
import { CompleteGuideCoveragePanel } from '../src/components/CompleteGuideReaderPanels';
import { Markdown } from '../src/components/Markdown';
import { setActiveLang } from '../src/i18n';
import { estimateCompleteGuide } from '../shared/completeGuide/estimate';
import { resolveCompleteGuideSelection } from '../shared/completeGuide/selection';
import type { CompleteGuideCatalog } from '../shared/completeGuide/preview';
import type { CompleteGuideDraftMeta } from '../shared/completeGuide/types';
import type { AppLanguage } from '../shared/types';
import '../src/index.css';

/**
 * The production composer panel and reader pieces of the complete study guide, fed
 * by an in-page `window.nodus` stub (catalog + estimate computed with the real shared
 * code), so a browser can tick sources, see the estimate and look at the callouts.
 * `?theme=light|dark` and `?lang=` select the rendering.
 */
const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.classList.toggle('dark', theme === 'dark');
document.documentElement.classList.toggle('light', theme === 'light');
setActiveLang((params.get('lang') ?? 'es') as AppLanguage);

const scope = (extra: Record<string, string>) => ({ courseId: null, subjectId: null, folderId: null, topicId: null, ...extra });
const named = (id: string, name: string, position: number, extra: Record<string, unknown> = {}) => ({ id, name, position, shortId: id, archivedAt: null, deletedAt: null, createdAt: '', updatedAt: '', description: null, color: null, icon: null, emoji: null, imageData: null, year: null, favorite: false, ...extra });
const catalog = {
  organization: {
    courses: [named('c', '2º Bachillerato', 0, { academicYearId: null })],
    subjects: [named('chem', 'Química', 0, { courseId: 'c', academicYearId: null }), named('hist', 'Historia', 1, { courseId: 'c', academicYearId: null })],
    folders: [named('f', 'Orgánica', 0, { courseId: 'c', subjectId: 'chem', parentId: null })],
    topics: [
      named('t1', 'Tema 1 · Gases', 0, { subjectId: 'chem', folderId: null, parentId: null }),
      named('t2', 'Tema 2 · Ácidos y bases', 1, { subjectId: 'chem', folderId: null, parentId: null }),
      named('t3', 'La Revolución industrial', 0, { subjectId: 'hist', folderId: null, parentId: null }),
    ],
  },
  sources: [
    { sourceKey: 'material:gases', kind: 'material', sourceId: 'gases', title: 'Apuntes de gases.pdf', placements: [scope({ topicId: 't1' })], available: true },
    { sourceKey: 'document:resumen', kind: 'document', sourceId: 'resumen', title: 'Mi resumen de gases', placements: [scope({ topicId: 't1' })], available: true },
    { sourceKey: 'material:acidos', kind: 'material', sourceId: 'acidos', title: 'Ácidos y bases (diapositivas)', placements: [scope({ topicId: 't2' })], available: true },
    { sourceKey: 'transcript:clase3', kind: 'transcript', sourceId: 'clase3', title: 'Clase 3 · pH', placements: [scope({ topicId: 't2' })], available: true, recordingId: 'r3', transcriptKind: 'corrected' },
    { sourceKey: 'material:scan', kind: 'material', sourceId: 'scan', title: 'Examen escaneado.pdf', placements: [scope({ topicId: 't2' })], available: false, unavailableReason: 'no_content' },
    { sourceKey: 'material:alcanos', kind: 'material', sourceId: 'alcanos', title: 'Alcanos', placements: [scope({ folderId: 'f' })], available: true },
    { sourceKey: 'material:fabrica', kind: 'material', sourceId: 'fabrica', title: 'La fábrica textil', placements: [scope({ topicId: 't3' })], available: true },
  ],
} as unknown as CompleteGuideCatalog;

const nodus = {
  listCompleteGuideCatalog: async () => catalog,
  previewCompleteGuide: async ({ completeGuide }: { completeGuide: { selection: CompleteGuideComposerState['selection'] } }) => {
    const resolved = resolveCompleteGuideSelection(completeGuide.selection, catalog.sources, catalog.organization);
    const pages = resolved.sources.length * 42;
    const passages = Array.from({ length: pages }, (_, index) => ({ id: `A.${index}`, sourceKey: resolved.sources[index % Math.max(1, resolved.sources.length)]?.sourceKey ?? 'x', chars: 2_100, contentHash: String(index) }));
    const totals = { sources: resolved.sources.length, passages: pages, readablePassages: pages, chars: pages * 2_100, pages, estimatedTokens: Math.ceil((pages * 2_100) / 3.6) };
    return {
      sources: [], unavailable: resolved.unavailable, superseded: resolved.superseded, issues: [], totals, subjects: resolved.subjectIds.length, units: 2,
      estimate: estimateCompleteGuide({ snapshot: { sources: [], passages, totals, issues: [] } as never, model: { provider: 'deepseek', model: 'deepseek-flash' }, subjectCount: resolved.subjectIds.length, unitCount: 2, unavailableSources: resolved.unavailable.length }),
    };
  },
};
(window as unknown as { nodus: unknown }).nodus = new Proxy(nodus, { get: (target, key) => (key in target ? target[key as keyof typeof target] : async () => null) });

const SAMPLE = `## Tema 1 · Gases

### Resumen del tema

Un gas se describe con cuatro magnitudes: presión, volumen, temperatura y cantidad de sustancia. La ley de Boyle relaciona presión y volumen cuando la temperatura no cambia, y la ecuación de los gases ideales las reúne todas en una sola expresión que solo vale a baja presión y alta temperatura. ([A1 · p. 1](nodus://study/material/gases?page=1&e=K0001); [A1 · p. 2](nodus://study/material/gases?page=2&e=K0002))

### Variables de estado

La **presión** es la fuerza que actúa perpendicularmente sobre una superficie dividida por el área de esa superficie, $P = \\dfrac{F}{S}$, y en el SI se mide en pascales. Por eso la misma fuerza produce más presión cuanto menor es la superficie. ([A1 · p. 1](nodus://study/material/gases?page=1&e=K0001))

Las cuatro magnitudes no son independientes. En un gas ideal, la ecuación

$$
PV = nRT
$$

liga presión, volumen, moles y temperatura absoluta. Aquí $R = 0{,}082\\ \\text{atm·L/(mol·K)}$ para cualquier gas, de modo que la presión debe ir en atmósferas, el volumen en litros y la temperatura en kelvin. Si conoces tres de ellas, la cuarta queda fijada; y la ecuación solo describe bien al gas a baja presión y alta temperatura. ([A1 · p. 2](nodus://study/material/gases?page=2&e=K0002))

> [!example] Ejemplo de los materiales · Presión de 2 mol en 10 L
> 2 mol de gas ideal a 300 K ocupan 10 L: $P = \\dfrac{2 \\cdot 0{,}082 \\cdot 300}{10} = 4{,}92$ atm.
>
> [A1 · p. 3](nodus://study/material/gases?page=3&e=K0003)

> [!ai-analogy] Analogía (IA) · El precio por unidad
> El cociente $PV/(nT)$ vale siempre $R$, como el precio por unidad de un producto no cambia aunque compres más o menos; deja de valer cuando el gas se aparta del modelo ideal.
>
> *Elaborado por IA: no procede de tus materiales.*

> [!mistake] Error frecuente
> Usar grados Celsius en la ecuación de estado: la temperatura debe ir en kelvin, $T(\\text{K}) = T(\\text{°C}) + 273{,}15$.
>
> [A1 · p. 3](nodus://study/material/gases?page=3&e=K0004)

| Magnitud | Unidad SI | Fuente |
| --- | --- | --- |
| Presión | Pa | [A1 · p. 1](nodus://study/material/gases?page=1&e=K0001) |
| Temperatura | K | [A1 · p. 2](nodus://study/material/gases?page=2&e=K0002) |

La combustión del hidrógeno, $\\ce{2H2 + O2 -> 2H2O}$, ilustra que el volumen de gases cambia con la cantidad de sustancia. ([D1 · § Resumen](nodus://study/doc/resumen?from=0&e=K0005))

### Pon a prueba lo que sabes

> [!selfcheck] Autoevaluación
>
> 1. ¿Por qué la temperatura debe expresarse en kelvin al usar $PV = nRT$?
> 2. Si se duplica el volumen a temperatura y cantidad constantes, ¿qué le pasa a la presión?

**Respuestas de autoevaluación**

**1.** Porque $T$ es la temperatura absoluta; los grados Celsius darían resultados sin sentido. ([A1 · p. 3](nodus://study/material/gases?page=3&e=K0004))

**2.** Se reduce a la mitad, porque $P_1 V_1 = P_2 V_2$. ([A1 · p. 1](nodus://study/material/gases?page=1&e=K0001))
`;

const META = {
  version: 1, runId: 'cg', config: { selection: { nodes: [], excludedSourceKeys: [] }, instructions: '', aiExamples: true, webText: false, webImages: false, verification: 'standard', maxCostUsd: null },
  snapshotAt: '', promptVersion: 'cg-3',
  sources: [
    { sourceKey: 'material:gases', kind: 'material', alias: 'A1', title: 'Apuntes de gases.pdf', path: '2º Bachillerato / Química / Tema 1 · Gases', passagesTotal: 42, passagesRead: 42, pages: { total: 44, withText: 42, empty: [13, 14] }, itemsExtracted: 96, itemsUsed: 94, duplicates: 0, unreadRanges: [] },
    { sourceKey: 'transcript:clase3', kind: 'transcript', alias: 'G1', title: 'Clase 3 · pH', path: '2º Bachillerato / Química / Tema 2', passagesTotal: 18, passagesRead: 16, itemsExtracted: 22, itemsUsed: 20, duplicates: 0, unreadRanges: ['12:00–18:00'] },
  ],
  units: [], counts: { items: 118, itemsUsed: 114, blocks: 160, aiBlocks: 12, windows: 20, failedWindows: 1, auditedBlocks: 9, removedSentences: 3, repairedBlocks: 2, invalidLatex: 2, conflicts: 1, cacheHits: 0 },
  usage: { calls: 142, inputTokens: 910_000, outputTokens: 180_000, usd: 0.49 }, warnings: [], cheatSheetMarkdown: '',
} as unknown as CompleteGuideDraftMeta;

function Harness() {
  const [state, setState] = useState<CompleteGuideComposerState>(EMPTY_COMPLETE_GUIDE_STATE);
  const [ready, setReady] = useState(false);
  return (
    <div className="min-h-screen bg-neutral-100 p-6 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-6 max-lg:grid-cols-1">
        <section className="rounded-xl border border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-950" data-testid="composer" data-ready={ready ? 'yes' : 'no'}>
          <CompleteGuideComposer value={state} onChange={setState} model={{ provider: 'deepseek', model: 'deepseek-flash' }} thinkingEffort="standard" onReadyChange={setReady} />
        </section>
        <section className="deep-research-reader-document space-y-4 rounded-xl border border-neutral-300 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-950" data-testid="reader">
          <Markdown content={SAMPLE} verify={false} onStudyMaterial={() => undefined} onStudyDocument={() => undefined} onGuideEvidence={() => undefined} />
          <div className="rounded-lg bg-neutral-950 p-3"><CompleteGuideCoveragePanel meta={META} /></div>
        </section>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
