// The social-relations network: a SECOND graph, independent from the kinship tree
// (see TreeView) — friends, patrons, employers, rivals, correspondents... the
// connections a social/prosopographical historian works with. Nodes are tree
// persons (indigo) and standalone contacts (amber); edges are role-labelled and
// directed (recorded from the person's ficha toward whoever they knew). This is a
// browse/read surface — new relations are always authored from a person's ficha
// ("Añadir relación"), so the graph never has an orphaned, relation-less contact.
import { useCallback, useEffect, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import type { NodeLabelDrawingFunction } from 'sigma/rendering';
import type { SocialGraphData } from '@shared/types';
import { seedMissingPositions, settleSync, resolveOverlaps } from './graph/layout';
import { Icon } from '../components/ui';
import { PersonDossier } from '../components/PersonDossier';
import { ContactDossier } from '../components/ContactDossier';
import { t, tx } from '../i18n';

const PERSON_COLOR = '#818cf8';
const CONTACT_COLOR = '#fbbf24';
const EDGE_COLOR_DARK = '#6b6b73';
const EDGE_COLOR_LIGHT = '#b8b8bf';

function roundRectPath(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

/**
 * Draw a node's label with a solid, theme-appropriate background pill so the text is
 * always readable — over any node colour and in both light and dark themes. Sigma's
 * default hover box is near-white regardless of theme, which made light-on-white
 * labels unreadable in dark mode; drawing our own box fixes both themes at once.
 */
function makeDrawLabel(lightTheme: boolean): NodeLabelDrawingFunction {
  const boxFill = lightTheme ? 'rgba(255,255,255,0.94)' : 'rgba(24,24,27,0.94)';
  const boxStroke = lightTheme ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.14)';
  const textColor = lightTheme ? '#18181b' : '#f4f4f5';
  return (context, data, settings) => {
    if (!data.label) return;
    const size = settings.labelSize;
    context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
    const width = context.measureText(data.label).width;
    const padX = 6;
    const padY = 3;
    const x = data.x + data.size + 5;
    const y = data.y - size / 2 - padY;
    const boxW = width + padX * 2;
    const boxH = size + padY * 2;
    context.save();
    context.fillStyle = boxFill;
    roundRectPath(context, x, y, boxW, boxH, 5);
    context.fill();
    context.strokeStyle = boxStroke;
    context.lineWidth = 1;
    roundRectPath(context, x, y, boxW, boxH, 5);
    context.stroke();
    context.fillStyle = textColor;
    context.textBaseline = 'middle';
    context.fillText(data.label, x + padX, data.y);
    context.restore();
  };
}

function isLightTheme(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('light');
}

export function RelationsView({ onOpenPersons }: { onOpenPersons?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const [data, setData] = useState<SocialGraphData | null>(null);
  const [search, setSearch] = useState('');
  const [dossierId, setDossierId] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [layoutNonce, setLayoutNonce] = useState(0);
  const [lightTheme, setLightTheme] = useState(isLightTheme);

  const load = useCallback(async () => {
    const g = await window.nodus.socialGraph();
    setData(g);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Track light/dark so the graph rebuilds with readable label + edge colours when
  // the user toggles the theme (App stamps the class on <html>, no event fires).
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setLightTheme(isLightTheme()));
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  // Build the graphology graph + Sigma instance whenever the data (or a manual
  // re-layout request) changes. Positions are re-seeded from scratch each time —
  // this is a browse surface for a modest network, not something worth the
  // complexity of preserving prior layout across incremental edits.
  useEffect(() => {
    if (!containerRef.current || !data) return;
    const graph = new Graph({ multi: false, type: 'directed' });
    for (const n of data.nodes) {
      graph.addNode(n.id, {
        label: n.displayName,
        kind: n.kind,
        size: n.kind === 'person' ? 7 : 5,
        color: n.kind === 'person' ? PERSON_COLOR : CONTACT_COLOR,
        x: Math.random(),
        y: Math.random(),
      });
    }
    const edgeColor = lightTheme ? EDGE_COLOR_LIGHT : EDGE_COLOR_DARK;
    for (const e of data.edges) {
      if (!graph.hasNode(e.fromId) || !graph.hasNode(e.toId) || graph.hasEdge(e.relationId)) continue;
      graph.addEdgeWithKey(e.relationId, e.fromId, e.toId, {
        label: e.role,
        size: 1.4,
        type: 'arrow',
        color: edgeColor,
      });
    }
    seedMissingPositions(graph);
    if (graph.order > 0) settleSync(graph, 250);
    resolveOverlaps(graph, { padding: 16 });

    if (sigmaRef.current) {
      sigmaRef.current.kill();
      sigmaRef.current = null;
    }
    const drawLabel = makeDrawLabel(lightTheme);
    const sigma = new Sigma(graph, containerRef.current, {
      allowInvalidContainer: true,
      renderLabels: true,
      renderEdgeLabels: true,
      labelSize: 12,
      labelColor: { color: lightTheme ? '#18181b' : '#f4f4f5' },
      edgeLabelSize: 11,
      edgeLabelColor: { color: lightTheme ? '#52525b' : '#c4c4cc' },
      defaultEdgeType: 'arrow',
      minCameraRatio: 0.05,
      maxCameraRatio: 4,
      defaultDrawNodeLabel: drawLabel,
      defaultDrawNodeHover: drawLabel,
    });
    sigma.on('clickNode', ({ node }) => {
      const attrs = graph.getNodeAttributes(node);
      if (attrs.kind === 'contact') setContactId(node);
      else setDossierId(node);
    });
    sigmaRef.current = sigma;
    graphRef.current = graph;
    return () => {
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [data, layoutNonce, lightTheme]);

  // Dim nodes/edges that don't match the search, without rebuilding the graph.
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;
    const q = search.trim().toLowerCase();
    graph.forEachNode((node, attrs) => {
      const match = !q || String(attrs.label ?? '').toLowerCase().includes(q);
      graph.setNodeAttribute(node, 'color', match ? (attrs.kind === 'person' ? PERSON_COLOR : CONTACT_COLOR) : '#3f3f46');
    });
    sigma.refresh();
  }, [search, data]);

  const personMap = new Map((data?.nodes ?? []).filter((n) => n.kind === 'person').map((n) => [n.id, n]));
  const personCount = personMap.size;
  const contactCount = (data?.nodes.length ?? 0) - personCount;
  const relationCount = data?.edges.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <Icon name="network" size={18} className="text-amber-300" />
        <h1 className="text-lg font-semibold">{t('Relaciones sociales')}</h1>
        <span className="text-xs text-neutral-500">
          {tx('{persons} personas · {contacts} contactos · {relations} relaciones', {
            persons: personCount,
            contacts: contactCount,
            relations: relationCount,
          })}
        </span>
        <input
          className="input ml-auto h-8 w-56 text-sm"
          placeholder={t('Buscar en la red…')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="btn btn-ghost h-8 gap-1.5 border border-neutral-700 text-xs"
          title={t('Reorganizar el grafo')}
          onClick={() => setLayoutNonce((n) => n + 1)}
        >
          <Icon name="refresh" size={13} /> {t('Reorganizar')}
        </button>
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PERSON_COLOR }} /> {t('familiar')}
          <span className="ml-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CONTACT_COLOR }} /> {t('contacto')}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {data && data.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="max-w-sm text-center text-sm text-neutral-500">
              <p className="mb-3">
                {t('Aún no hay relaciones registradas. Es un árbol independiente del genealógico: amistades, patronazgo, empleo, rivalidad, correspondencia…')}
              </p>
              <p className="mb-3">{t('Añade la primera desde la ficha de una persona, sección «Relaciones sociales».')}</p>
              {onOpenPersons && (
                <button className="btn btn-primary gap-1.5" onClick={onOpenPersons}>
                  <Icon name="users" size={13} /> {t('Ir a Personas')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {dossierId && personMap.has(dossierId) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setDossierId(null)}>
          <PersonDossierLoader personId={dossierId} onClose={() => setDossierId(null)} onChanged={load} onNavigate={setDossierId} />
        </div>
      )}

      {contactId && (
        <ContactDossier
          contactId={contactId}
          onClose={() => setContactId(null)}
          onChanged={load}
          onOpenPerson={(id) => {
            setContactId(null);
            setDossierId(id);
          }}
        />
      )}
    </div>
  );
}

/** The graph only carries id + name for a person node; the dossier needs the full
 *  record, so this fetches it on open rather than threading the whole Person list
 *  through the graph-building pass. */
function PersonDossierLoader({
  personId,
  onClose,
  onChanged,
  onNavigate,
}: {
  personId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onNavigate: (id: string) => void;
}) {
  const [person, setPerson] = useState<Awaited<ReturnType<typeof window.nodus.getPerson>>>(null);

  useEffect(() => {
    void window.nodus.getPerson(personId).then(setPerson);
  }, [personId]);

  if (!person) return null;
  return (
    <div className="card-modal flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PersonDossier key={personId} person={person} onChanged={onChanged} onClose={onClose} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
