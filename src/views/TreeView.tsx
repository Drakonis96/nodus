import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Person, Relationship, RelationshipType } from '@shared/types';
import { computeTreeLayout, type TreeLayoutResult } from '@shared/treeLayout';
import { parseHistoricalDate } from '@shared/genealogyDates';
import { mirrorDefaultPortrait } from '@shared/treePortraits';
import { Icon } from '../components/ui';
import { PersonPortrait } from '../components/PersonPortrait';
import { t } from '../i18n';

const NODE_W = 160;
const NODE_H = 64;
const PAD = 40;

function dates(p: Person): string {
  const b = p.birthDate?.trim();
  const d = p.deathDate?.trim();
  if (b && d) return `${b} – ${d}`;
  if (b) return `n. ${b}`;
  if (d) return `† ${d}`;
  return '';
}

export function TreeView() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [rels, setRels] = useState<Relationship[]>([]);
  const [focusId, setFocusId] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

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

  const layout: TreeLayoutResult = useMemo(
    () =>
      computeTreeLayout({
        focusId,
        persons: persons.map((p) => ({ id: p.personId, sex: p.sex, birthYear: parseHistoricalDate(p.birthDate).year })),
        parentEdges: rels.filter((r) => r.type === 'parent').map((r) => ({ parent: r.fromPerson, child: r.toPerson })),
        spouseEdges: rels.filter((r) => r.type === 'spouse').map((r) => ({ a: r.fromPerson, b: r.toPerson })),
        nodeWidth: NODE_W,
        nodeHeight: NODE_H,
      }),
    [focusId, rels, persons]
  );

  const pos = useMemo(() => new Map(layout.nodes.map((n) => [n.personId, n])), [layout]);
  const center = (id: string) => ({ x: (pos.get(id)?.x ?? 0) + PAD + NODE_W / 2, y: (pos.get(id)?.y ?? 0) + PAD + NODE_H / 2 });

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
          {layout.edges.map((e, i) => {
            const a = center(e.from);
            const b = center(e.to);
            if (e.kind === 'spouse') {
              return <line key={`s${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#6366f1" strokeWidth={2} strokeDasharray="4 3" />;
            }
            // parent → child: elbow from parent bottom to child top.
            const midY = (a.y + NODE_H / 2 + (b.y - NODE_H / 2)) / 2;
            return (
              <path
                key={`p${i}`}
                d={`M ${a.x} ${a.y + NODE_H / 2} V ${midY} H ${b.x} V ${b.y - NODE_H / 2}`}
                fill="none"
                stroke="#3f3f46"
                strokeWidth={1.5}
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
            const stroke = isFocus ? '#6366f1' : isSel ? '#818cf8' : '#3f3f46';
            const sexColor = p.sex === 'male' ? '#60a5fa' : p.sex === 'female' ? '#f472b6' : '#a1a1aa';
            return (
              <g
                key={n.personId}
                transform={`translate(${x}, ${y})`}
                style={{ cursor: 'pointer', transition: 'transform 300ms ease' }}
                onClick={() => setSelected(n.personId)}
                onDoubleClick={() => setFocusId(n.personId)}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill="#18181b"
                  stroke={stroke}
                  strokeWidth={isFocus || isSel ? 2 : 1}
                />
                <rect width={4} height={NODE_H} rx={2} fill={sexColor} />
                {p.portrait && (
                  <foreignObject x={12} y={11} width={42} height={42}>
                    <PersonPortrait person={p} size={42} />
                  </foreignObject>
                )}
                <text x={p.portrait ? 64 : 14} y={26} fill="#e4e4e7" fontSize={13} fontWeight={600}>
                  {(() => {
                    const max = p.portrait ? 12 : 20;
                    return p.displayName.length > max ? `${p.displayName.slice(0, max - 1)}…` : p.displayName;
                  })()}
                </text>
                <text x={p.portrait ? 64 : 14} y={46} fill="#a1a1aa" fontSize={11}>
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
          onClose={() => setSelected(null)}
          onFocus={() => {
            setFocusId(selected);
            setSelected(null);
          }}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function NodePanel({
  person,
  persons,
  onClose,
  onFocus,
  onChanged,
}: {
  person: Person;
  persons: Person[];
  onClose: () => void;
  onFocus: () => void;
  onChanged: () => Promise<void>;
}) {
  const [relType, setRelType] = useState<'father' | 'mother' | 'child' | 'spouse'>('child');
  const [otherId, setOtherId] = useState('');
  const [busy, setBusy] = useState(false);

  const others = persons.filter((p) => p.personId !== person.personId);

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
      await window.nodus.addRelationship(from, to, type, 'user_asserted');
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

      <button className="btn btn-ghost mb-4 w-full gap-1.5 border border-neutral-700 text-sm" onClick={onFocus}>
        <Icon name="target" size={14} /> {t('Centrar el árbol aquí')}
      </button>

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
        <button className="btn btn-primary w-full" disabled={busy || !otherId} onClick={() => void connect()}>
          {t('Conectar')}
        </button>
        <p className="text-xs text-neutral-500">{t('Las conexiones que añades quedan marcadas como afirmadas por ti.')}</p>
      </div>
    </div>
  );
}
