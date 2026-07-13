import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppSettings, Person, Relationship, RelationshipType } from '@shared/types';
import { computeTreeLayout, type TreeLayoutResult } from '@shared/treeLayout';
import { parseHistoricalDate } from '@shared/genealogyDates';
import { mirrorDefaultPortrait } from '@shared/treePortraits';
import { effectiveFrame, TREE_FRAMES } from '@shared/treeFrames';
import { Icon } from '../components/ui';
import { PersonPortrait } from '../components/PersonPortrait';
import { TreeFrame, TreeFrameDefs } from '../components/TreeFrame';
import { PersonDossier } from '../components/PersonDossier';
import { useIsLightTheme } from '../hooks';
import { t } from '../i18n';

const NODE_W = 128;
const NODE_H = 158;
const FRAME_W = 100;
const FRAME_H = 116;
const PAD = 40;

function dates(p: Person): string {
  const b = p.birthDate?.trim();
  const d = p.deathDate?.trim();
  if (b && d) return `${b} – ${d}`;
  if (b) return `n. ${b}`;
  if (d) return `† ${d}`;
  return '';
}

export function TreeView({
  settings,
  onSettingsChange,
}: {
  settings?: AppSettings;
  onSettingsChange?: () => Promise<unknown>;
} = {}) {
  const [persons, setPersons] = useState<Person[]>([]);
  const [rels, setRels] = useState<Relationship[]>([]);
  const [focusId, setFocusId] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [dossierId, setDossierId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const light = useIsLightTheme();
  // SVG <text> fills can't inherit the .light utility remaps (they're not utility
  // classes), so pick readable ink colours for the active theme explicitly.
  const nameFill = light ? '#27272a' : '#e4e4e7';
  const dateFill = light ? '#52525b' : '#a1a1aa';
  const vaultFrame = settings?.treeFrame ?? 'oak';

  const reload = useCallback(async () => {
    const [ps, rs] = await Promise.all([window.nodus.listPersons(), window.nodus.allRelationships()]);
    setPersons(ps);
    setRels(rs);
    setFocusId((cur) => (cur && ps.some((p) => p.personId === cur) ? cur : ps[0]?.personId ?? ''));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const personById = useMemo(() => new Map(persons.map((p) => [p.personId, p])), [persons]);
  const adoptiveSet = useMemo(
    () => new Set(rels.filter((r) => r.type === 'parent' && r.subtype === 'adoptive').map((r) => `${r.fromPerson}->${r.toPerson}`)),
    [rels]
  );

  const layout: TreeLayoutResult = useMemo(
    () =>
      computeTreeLayout({
        focusId,
        persons: persons.map((p) => ({ id: p.personId, sex: p.sex, birthYear: parseHistoricalDate(p.birthDate).year })),
        parentEdges: rels.filter((r) => r.type === 'parent').map((r) => ({ parent: r.fromPerson, child: r.toPerson })),
        spouseEdges: rels.filter((r) => r.type === 'spouse').map((r) => ({ a: r.fromPerson, b: r.toPerson })),
        nodeWidth: NODE_W,
        nodeHeight: NODE_H,
        vGap: 52,
      }),
    [focusId, rels, persons]
  );

  const pos = useMemo(() => new Map(layout.nodes.map((n) => [n.personId, n])), [layout]);
  const center = (id: string) => ({ x: (pos.get(id)?.x ?? 0) + PAD + NODE_W / 2, y: (pos.get(id)?.y ?? 0) + PAD + NODE_H / 2 });
  const frameTop = (id: string) => ({ x: (pos.get(id)?.x ?? 0) + PAD + NODE_W / 2, y: (pos.get(id)?.y ?? 0) + PAD });
  const frameBottom = (id: string) => ({ x: (pos.get(id)?.x ?? 0) + PAD + NODE_W / 2, y: (pos.get(id)?.y ?? 0) + PAD + FRAME_H });

  if (persons.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Icon name="tree" size={32} className="text-neutral-600" />
        <p className="max-w-md text-sm text-neutral-500">
          {t('Aún no hay personas. Importa un GEDCOM o añade personas y sus parentescos desde la vista Personas.')}
        </p>
      </div>
    );
  }

  const svgW = layout.width + PAD * 2;
  const svgH = layout.height + PAD * 2;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-neutral-800 p-4">
        <Icon name="tree" size={20} className="text-indigo-300" />
        <h1 className="text-lg font-semibold">{t('Árbol genealógico')}</h1>
        <select
          className="input h-9 max-w-[16rem] text-sm"
          value={focusId}
          onChange={(e) => setFocusId(e.target.value)}
          title={t('Centrar el árbol en…')}
        >
          {persons.map((p) => (
            <option key={p.personId} value={p.personId}>
              {p.displayName}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-1">
          <button className="btn btn-ghost px-2 py-1" onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}>
            <Icon name="minus" />
          </button>
          <span className="w-10 text-center text-xs text-neutral-500">{Math.round(zoom * 100)}%</span>
          <button className="btn btn-ghost px-2 py-1" onClick={() => setZoom((z) => Math.min(2, z + 0.15))}>
            <Icon name="plus" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-neutral-950/40 p-4">
        <svg
          width={svgW * zoom}
          height={svgH * zoom}
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="select-none"
          style={{ minWidth: '100%' }}
        >
          <TreeFrameDefs />
          {layout.edges.map((e, i) => {
            if (e.kind === 'spouse') {
              const a = center(e.from);
              const b = center(e.to);
              return <line key={`s${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#8a5a2b" strokeWidth={2.5} strokeDasharray="2 4" strokeLinecap="round" />;
            }
            // parent → child: elbow from the parent's frame bottom to the child's top.
            const a = frameBottom(e.from);
            const b = frameTop(e.to);
            const adoptive = adoptiveSet.has(`${e.from}->${e.to}`);
            const midY = (a.y + b.y) / 2;
            return (
              <path
                key={`p${i}`}
                d={`M ${a.x} ${a.y} V ${midY} H ${b.x} V ${b.y}`}
                fill="none"
                stroke={adoptive ? '#6b7280' : '#4b5563'}
                strokeWidth={1.5}
                strokeDasharray={adoptive ? '5 4' : undefined}
              />
            );
          })}

          {layout.nodes.map((n) => {
            const p = personById.get(n.personId);
            if (!p) return null;
            const x = n.x + PAD;
            const y = n.y + PAD;
            const isFocus = n.personId === focusId;
            const isSel = n.personId === selected;
            const frame = effectiveFrame(p.frameStyle, vaultFrame);
            const mirror = mirrorDefaultPortrait(p.sex, n.coupleSide);
            const frameX = x + (NODE_W - FRAME_W) / 2;
            const max = 16;
            return (
              <g
                key={n.personId}
                style={{ cursor: 'pointer', transition: 'transform 300ms ease' }}
                onClick={() => setSelected(n.personId)}
                onDoubleClick={() => setFocusId(n.personId)}
              >
                {(isFocus || isSel) && (
                  <rect
                    x={frameX - 4}
                    y={y - 4}
                    width={FRAME_W + 8}
                    height={FRAME_H + 8}
                    rx={16}
                    fill="none"
                    stroke={isFocus ? '#818cf8' : '#a5b4fc'}
                    strokeWidth={2.5}
                  />
                )}
                <TreeFrame
                  x={frameX}
                  y={y}
                  w={FRAME_W}
                  h={FRAME_H}
                  frame={frame}
                  sex={p.sex}
                  portrait={<PersonPortrait person={p} fill mirror={mirror} rounded="none" />}
                />
                <text x={x + NODE_W / 2} y={y + FRAME_H + 18} textAnchor="middle" fill={nameFill} fontSize={13} fontWeight={600}>
                  {p.displayName.length > max ? `${p.displayName.slice(0, max - 1)}…` : p.displayName}
                </text>
                <text x={x + NODE_W / 2} y={y + FRAME_H + 34} textAnchor="middle" fill={dateFill} fontSize={11}>
                  {dates(p)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {selected && personById.get(selected) && (
        <NodePanel
          person={personById.get(selected)!}
          persons={persons}
          vaultFrame={vaultFrame}
          onClose={() => setSelected(null)}
          onFocus={() => {
            setFocusId(selected);
            setSelected(null);
          }}
          onApplyFrameToAll={async (frame) => {
            await window.nodus.updateSettings({ treeFrame: frame });
            await onSettingsChange?.();
            await reload();
          }}
          onOpenDossier={() => setDossierId(selected)}
          onChanged={reload}
        />
      )}

      {dossierId && personById.get(dossierId) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setDossierId(null)}>
          <div className="card-modal flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PersonDossier
                key={dossierId}
                person={personById.get(dossierId)!}
                onChanged={reload}
                onClose={() => setDossierId(null)}
                onNavigate={(id) => setDossierId(id)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NodePanel({
  person,
  persons,
  vaultFrame,
  onClose,
  onFocus,
  onApplyFrameToAll,
  onOpenDossier,
  onChanged,
}: {
  person: Person;
  persons: Person[];
  vaultFrame: string;
  onClose: () => void;
  onFocus: () => void;
  onApplyFrameToAll: (frame: string) => Promise<void>;
  onOpenDossier: () => void;
  onChanged: () => Promise<void>;
}) {
  const [relType, setRelType] = useState<'father' | 'mother' | 'child' | 'spouse'>('child');
  const [otherId, setOtherId] = useState('');
  const [adoptive, setAdoptive] = useState(false);
  const [busy, setBusy] = useState(false);

  const others = persons.filter((p) => p.personId !== person.personId);
  const currentFrame = effectiveFrame(person.frameStyle, vaultFrame);
  const isParentRel = relType !== 'spouse';

  const setFrameForPerson = async (frame: string) => {
    await window.nodus.setPersonFrame(person.personId, frame);
    await onChanged();
  };

  const connect = async () => {
    if (!otherId) return;
    setBusy(true);
    try {
      // Map the chosen relation to a directed kinship edge from `person`.
      let from = person.personId;
      let to = otherId;
      let type: RelationshipType = 'parent';
      if (relType === 'child') {
        type = 'parent'; // person is the parent of the other
      } else if (relType === 'father' || relType === 'mother') {
        type = 'parent'; // the other is the parent of person
        from = otherId;
        to = person.personId;
      } else {
        type = 'spouse';
      }
      await window.nodus.addRelationship(from, to, type, 'user_asserted', type === 'parent' && adoptive ? 'adoptive' : null);
      await onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-80 border-l border-neutral-800 bg-neutral-950 p-5 shadow-2xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="font-semibold">{person.displayName}</h2>
          <p className="text-xs text-neutral-500">{dates(person)}</p>
        </div>
        <button className="btn btn-ghost px-2 py-1" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>

      <button className="btn btn-primary mb-2 w-full gap-1.5 text-sm" onClick={onOpenDossier}>
        <Icon name="user" size={14} /> {t('Ver ficha completa')}
      </button>
      <button className="btn btn-ghost mb-4 w-full gap-1.5 border border-neutral-700 text-sm" onClick={onFocus}>
        <Icon name="target" size={14} /> {t('Centrar el árbol aquí')}
      </button>

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Marco')}</h3>
      <div className="mb-2 grid grid-cols-2 gap-2">
        {TREE_FRAMES.map((f) => (
          <button
            key={f.id}
            onClick={() => void setFrameForPerson(f.id)}
            className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs ${
              currentFrame === f.id ? 'border-indigo-500 bg-indigo-600/15' : 'border-neutral-800 hover:bg-neutral-800/60'
            }`}
          >
            <FrameSwatch frame={f.id} />
            <span className="truncate">{t(f.label)}</span>
          </button>
        ))}
      </div>
      <div className="mb-4 flex items-center gap-2">
        {person.frameStyle && (
          <button
            className="text-xs text-neutral-400 hover:underline"
            onClick={() => void window.nodus.setPersonFrame(person.personId, null).then(onChanged)}
          >
            {t('Usar el del árbol')}
          </button>
        )}
        <button className="ml-auto text-xs text-indigo-400 hover:underline" onClick={() => void onApplyFrameToAll(currentFrame)}>
          {t('Aplicar «{f}» a todo el árbol').replace('{f}', t(TREE_FRAMES.find((x) => x.id === currentFrame)?.label ?? ''))}
        </button>
      </div>

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Añadir conexión')}</h3>
      <div className="space-y-2">
        <select className="input h-9 w-full text-sm" value={relType} onChange={(e) => setRelType(e.target.value as typeof relType)}>
          <option value="child">{t('…es hijo/a de esta persona')}</option>
          <option value="father">{t('…es el padre de esta persona')}</option>
          <option value="mother">{t('…es la madre de esta persona')}</option>
          <option value="spouse">{t('…es cónyuge de esta persona')}</option>
        </select>
        <select className="input h-9 w-full text-sm" value={otherId} onChange={(e) => setOtherId(e.target.value)}>
          <option value="">{t('Elegir persona…')}</option>
          {others.map((p) => (
            <option key={p.personId} value={p.personId}>
              {p.displayName}
            </option>
          ))}
        </select>
        {isParentRel && (
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input type="checkbox" checked={adoptive} onChange={(e) => setAdoptive(e.target.checked)} />
            {t('Relación adoptiva')}
          </label>
        )}
        <button className="btn btn-primary w-full" disabled={busy || !otherId} onClick={() => void connect()}>
          {t('Conectar')}
        </button>
        <p className="text-xs text-neutral-500">{t('Las conexiones que añades quedan marcadas como afirmadas por ti.')}</p>
      </div>
    </div>
  );
}

/** A tiny swatch of a wooden frame design for the picker. */
function FrameSwatch({ frame }: { frame: string }) {
  return (
    <svg width={20} height={20} className="shrink-0">
      <TreeFrameDefs />
      <rect x={0} y={0} width={20} height={20} rx={4} fill={`url(#frame-${frame})`} stroke="#00000055" />
      <rect x={5} y={5} width={10} height={10} rx={1} fill="#0a0a0a" />
    </svg>
  );
}
