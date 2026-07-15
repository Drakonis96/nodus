import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppSettings, Person, Relationship } from '@shared/types';
import { computeTreeLayout, type TreeLayoutResult } from '@shared/treeLayout';
import { buildTreeFamilies } from '@shared/treeFamilies';
import { branchColorForTheme, deriveTreeKinship, type TreeKinshipRole } from '@shared/treeKinship';
import { parseHistoricalDate } from '@shared/genealogyDates';
import { parentAgeWarning } from '@shared/kinshipRelations';
import { mirrorDefaultPortrait } from '@shared/treePortraits';
import { effectiveFrame, TREE_FRAMES } from '@shared/treeFrames';
import { Icon } from '../components/ui';
import { PersonPortrait } from '../components/PersonPortrait';
import { TreeFrame, TreeFrameDefs } from '../components/TreeFrame';
import { PersonDossier } from '../components/PersonDossier';
import { KinshipEditor } from '../components/KinshipEditor';
import { useIsLightTheme } from '../hooks';
import { t } from '../i18n';

const NODE_W = 128;
const NODE_H = 176;
const FRAME_W = 100;
const FRAME_H = 116;
const PAD = 40;

const KINSHIP_ROLE_LABEL: Record<TreeKinshipRole, string> = {
  focus: 'Persona principal', father: 'Padre', mother: 'Madre', parent: 'Progenitor/a',
  paternal_grandfather: 'Abuelo paterno', paternal_grandmother: 'Abuela paterna', paternal_grandparent: 'Abuelo/a paterno/a',
  maternal_grandfather: 'Abuelo materno', maternal_grandmother: 'Abuela materna', maternal_grandparent: 'Abuelo/a materno/a',
  paternal_ancestor: 'Antepasado/a paterno/a', maternal_ancestor: 'Antepasado/a materno/a', ancestor: 'Antepasado/a',
  brother: 'Hermano', sister: 'Hermana', sibling: 'Hermano/a', spouse: 'Cónyuge/pareja',
  son: 'Hijo', daughter: 'Hija', child: 'Hijo/a', grandson: 'Nieto', granddaughter: 'Nieta', grandchild: 'Nieto/a',
  paternal_uncle: 'Tío paterno', paternal_aunt: 'Tía paterna', maternal_uncle: 'Tío materno', maternal_aunt: 'Tía materna', uncle_aunt: 'Tío/a',
  nephew: 'Sobrino', niece: 'Sobrina', nibling: 'Sobrino/a', cousin: 'Primo/a', descendant: 'Descendiente',
};

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

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
  const orientation = settings?.treeOrientation ?? 'ancestors_top';
  const paternalColor = settings?.treePaternalColor ?? '#2563eb';
  const maternalColor = settings?.treeMaternalColor ?? '#dc2626';

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
  const inconsistentParentSet = useMemo(() => new Set(
    rels.filter((relationship) => relationship.type === 'parent' && parentAgeWarning(
      personById.get(relationship.fromPerson)?.birthDate,
      personById.get(relationship.toPerson)?.birthDate
    ) != null).map((relationship) => `${relationship.fromPerson}->${relationship.toPerson}`)
  ), [personById, rels]);

  const parentEdges = useMemo(() => rels.filter((r) => r.type === 'parent').map((r) => ({ parent: r.fromPerson, child: r.toPerson })), [rels]);
  const spouseEdges = useMemo(() => rels.filter((r) => r.type === 'spouse').map((r) => ({ a: r.fromPerson, b: r.toPerson })), [rels]);
  const siblingEdges = useMemo(() => rels.filter((r) => r.type === 'sibling').map((r) => ({ a: r.fromPerson, b: r.toPerson })), [rels]);
  const treePersons = useMemo(() => persons.map((p) => ({ id: p.personId, sex: p.sex, birthYear: parseHistoricalDate(p.birthDate).year })), [persons]);

  const layout: TreeLayoutResult = useMemo(
    () =>
      computeTreeLayout({
        focusId,
        persons: treePersons,
        parentEdges,
        spouseEdges,
        siblingEdges,
        nodeWidth: NODE_W,
        nodeHeight: NODE_H,
        vGap: 52,
        orientation,
      }),
    [focusId, orientation, parentEdges, siblingEdges, spouseEdges, treePersons]
  );

  const pos = useMemo(() => new Map(layout.nodes.map((n) => [n.personId, n])), [layout]);
  const families = useMemo(() => buildTreeFamilies(parentEdges, layout.nodes), [layout.nodes, parentEdges]);
  const kinship = useMemo(() => deriveTreeKinship({ focusId, parentEdges, spouseEdges, siblingEdges, persons: treePersons }), [focusId, parentEdges, siblingEdges, spouseEdges, treePersons]);
  const familyPairSet = useMemo(() => {
    const pairs = new Set<string>();
    for (const family of families) for (let i = 0; i < family.parentIds.length; i++) {
      for (let j = i + 1; j < family.parentIds.length; j++) pairs.add(pairKey(family.parentIds[i], family.parentIds[j]));
    }
    return pairs;
  }, [families]);
  const spousePairSet = useMemo(() => new Set(spouseEdges.map((edge) => pairKey(edge.a, edge.b))), [spouseEdges]);
  const branchColorFor = (personId: string): string => {
    const context = kinship.get(personId);
    if (!context || context.branch === 'neutral') return light ? '#64748b' : '#94a3b8';
    return branchColorForTheme(context.branch === 'paternal' ? paternalColor : maternalColor, context.tone, light);
  };
  const frameTop = (id: string) => ({ x: (pos.get(id)?.x ?? 0) + PAD + NODE_W / 2, y: (pos.get(id)?.y ?? 0) + PAD });
  const frameBottom = (id: string) => ({ x: (pos.get(id)?.x ?? 0) + PAD + NODE_W / 2, y: (pos.get(id)?.y ?? 0) + PAD + FRAME_H });
  const frameSide = (id: string, side: 'left' | 'right') => ({
    x: (pos.get(id)?.x ?? 0) + PAD + (NODE_W - FRAME_W) / 2 + (side === 'right' ? FRAME_W : 0),
    y: (pos.get(id)?.y ?? 0) + PAD + FRAME_H / 2,
  });

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
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-800 p-4">
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
        <button
          className="btn btn-ghost h-9 gap-1.5 border border-neutral-700 px-2 text-xs"
          title={t('Invertir la orientación vertical del árbol')}
          onClick={() => void window.nodus.updateSettings({ treeOrientation: orientation === 'ancestors_top' ? 'ancestors_bottom' : 'ancestors_top' }).then(() => onSettingsChange?.())}
        >
          <Icon name={orientation === 'ancestors_top' ? 'arrowUp' : 'arrowDown'} size={13} />
          {orientation === 'ancestors_top' ? t('Ascendientes arriba') : t('Ascendientes abajo')}
        </button>
        <div className="tree-branch-colors flex items-center gap-2" data-testid="tree-branch-color-controls">
          <label className="tree-branch-color-control" title={t('Color de la rama paterna')}>
            <input
              type="color"
              value={paternalColor}
              aria-label={t('Color de la rama paterna')}
              data-testid="tree-paternal-color"
              onChange={(event) => void window.nodus.updateSettings({ treePaternalColor: event.target.value }).then(() => onSettingsChange?.())}
            />
            <span>{t('Paterna')}</span>
          </label>
          <label className="tree-branch-color-control" title={t('Color de la rama materna')}>
            <input
              type="color"
              value={maternalColor}
              aria-label={t('Color de la rama materna')}
              data-testid="tree-maternal-color"
              onChange={(event) => void window.nodus.updateSettings({ treeMaternalColor: event.target.value }).then(() => onSettingsChange?.())}
            />
            <span>{t('Materna')}</span>
          </label>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button className="btn btn-ghost px-2 py-1" onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}>
            <Icon name="minus" />
          </button>
          <span className="w-10 text-center text-xs text-neutral-500">{Math.round(zoom * 100)}%</span>
          <button className="btn btn-ghost px-2 py-1" onClick={() => setZoom((z) => Math.min(2, z + 0.15))}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="tree-line-legend basis-full" data-testid="tree-line-legend">
          <span><i className="tree-line-sample tree-line-sample-parent" />{t('Progenitores e hijos')}</span>
          <span><i className="tree-line-sample tree-line-sample-spouse" />{t('Cónyuges/pareja')}</span>
          <span><i className="tree-line-sample tree-line-sample-sibling" />{t('Hermanos sin progenitores conocidos')}</span>
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
          {families.map((family, familyIndex) => {
            const orderedParents = family.parentIds.slice().sort((a, b) => (pos.get(a)?.x ?? 0) - (pos.get(b)?.x ?? 0));
            const parentCenters = orderedParents.map((id) => ({ id, ...(orientation === 'ancestors_top' ? frameBottom(id) : frameTop(id)) }));
            const childPoints = family.childIds.map((id) => ({ id, ...(orientation === 'ancestors_top' ? frameTop(id) : frameBottom(id)) }));
            if (parentCenters.length === 0 || childPoints.length === 0) return null;
            const parentMidY = orderedParents.length > 1 ? frameSide(orderedParents[0], 'right').y : parentCenters[0].y;
            const anchorX = orderedParents.length > 1
              ? (frameSide(orderedParents[0], 'right').x + frameSide(orderedParents[orderedParents.length - 1], 'left').x) / 2
              : parentCenters[0].x;
            const childY = childPoints[0].y;
            // Every family crossing the same generation pair gets a distinct lane.
            const laneFraction = 0.3 + 0.4 * ((family.laneIndex + 1) / (family.laneCount + 1));
            const laneY = parentMidY + (childY - parentMidY) * laneFraction;
            const childXs = childPoints.map((point) => point.x);
            const minChildX = Math.min(...childXs);
            const maxChildX = Math.max(...childXs);
            const connectorPath = [
              `M ${anchorX} ${parentMidY} V ${laneY}`,
              `M ${Math.min(anchorX, minChildX)} ${laneY} H ${Math.max(anchorX, maxChildX)}`,
              ...childPoints.map((point) => `M ${point.x} ${laneY} V ${point.y}`),
            ].join(' ');
            const gradientId = `tree-family-${familyIndex}`;
            const parentColors = orderedParents.map(branchColorFor);
            const fallbackColor = branchColorFor(family.childIds[0]);
            const hasAdoptive = family.parentIds.some((parentId) => family.childIds.some((childId) => adoptiveSet.has(`${parentId}->${childId}`)));
            const hasInconsistent = family.parentIds.some((parentId) => family.childIds.some((childId) => inconsistentParentSet.has(`${parentId}->${childId}`)));
            const unionIsSpouse = orderedParents.length > 1 && orderedParents.some((parentId, index) => orderedParents.slice(index + 1).some((otherId) => spousePairSet.has(pairKey(parentId, otherId))));
            const parentNames = orderedParents.map((id) => personById.get(id)?.displayName ?? id).join(' + ');
            const childNames = family.childIds.map((id) => personById.get(id)?.displayName ?? id).join(', ');
            return (
              <g key={family.id} data-tree-family={family.id}>
                <title>{t('Familia: {parents} → {children}').replace('{parents}', parentNames).replace('{children}', childNames)}</title>
                <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={Math.min(...parentCenters.map((point) => point.x), minChildX)} x2={Math.max(...parentCenters.map((point) => point.x), maxChildX)}>
                  {(parentColors.length > 0 ? parentColors : [fallbackColor]).map((color, index, colors) => (
                    <stop key={`${color}-${index}`} offset={`${colors.length === 1 ? 50 : (index / (colors.length - 1)) * 100}%`} stopColor={color} />
                  ))}
                </linearGradient>
                {orderedParents.length > 1 && orderedParents.map((parentId) => {
                  const centerX = (pos.get(parentId)?.x ?? 0) + PAD + NODE_W / 2;
                  const side = centerX < anchorX ? 'right' : 'left';
                  const point = frameSide(parentId, side);
                  const d = `M ${point.x} ${point.y} H ${anchorX}`;
                  return (
                    <g key={parentId}>
                      <path d={d} fill="none" stroke={light ? '#ffffffcc' : '#09090bdd'} strokeWidth={5} strokeLinecap="round" />
                      <path d={d} fill="none" stroke={branchColorFor(parentId)} strokeWidth={2.2} strokeDasharray={unionIsSpouse ? '3 4' : undefined} strokeLinecap="round" />
                    </g>
                  );
                })}
                <path d={connectorPath} fill="none" stroke={light ? '#ffffffcc' : '#09090bdd'} strokeWidth={5} strokeLinejoin="round" />
                <path
                  d={connectorPath}
                  fill="none"
                  stroke={parentColors.length > 1 ? `url(#${gradientId})` : parentColors[0] ?? fallbackColor}
                  strokeWidth={2.2}
                  strokeDasharray={hasInconsistent ? '3 3' : hasAdoptive ? '6 4' : undefined}
                  strokeLinejoin="round"
                />
                <circle cx={anchorX} cy={parentMidY} r={hasInconsistent ? 4 : 3} fill={hasInconsistent ? '#f59e0b' : parentColors[0] ?? fallbackColor} stroke={light ? '#fff' : '#09090b'} strokeWidth={1.5} />
              </g>
            );
          })}

          {layout.edges.filter((edge) => edge.kind !== 'parent').map((edge, index) => {
            if (edge.kind === 'spouse' && familyPairSet.has(pairKey(edge.from, edge.to))) return null;
            const fromLeft = (pos.get(edge.from)?.x ?? 0) < (pos.get(edge.to)?.x ?? 0);
            const a = frameSide(edge.from, fromLeft ? 'right' : 'left');
            const b = frameSide(edge.to, fromLeft ? 'left' : 'right');
            const color = edge.kind === 'spouse' ? '#8a5a2b' : light ? '#64748b' : '#94a3b8';
            const label = edge.kind === 'spouse' ? t('Cónyuges/pareja') : t('Hermanos sin progenitores conocidos');
            return (
              <g key={`${edge.kind}${index}`}>
                <title>{label}: {personById.get(edge.from)?.displayName} — {personById.get(edge.to)?.displayName}</title>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={light ? '#ffffffcc' : '#09090bdd'} strokeWidth={5} strokeLinecap="round" />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={2} strokeDasharray={edge.kind === 'spouse' ? '3 4' : '7 4'} strokeLinecap="round" />
              </g>
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
            const relation = kinship.get(n.personId);
            const relationLabel = relation ? t(KINSHIP_ROLE_LABEL[relation.role]) : t('Pariente');
            const relationColor = relation && relation.branch !== 'neutral' ? branchColorFor(n.personId) : dateFill;
            return (
              <g
                key={n.personId}
                style={{ cursor: 'pointer', transition: 'transform 300ms ease' }}
                onClick={() => setSelected(n.personId)}
                onDoubleClick={() => setFocusId(n.personId)}
              >
                <title>{p.displayName} · {relationLabel}</title>
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
                <text x={x + NODE_W / 2} y={y + FRAME_H + 34} textAnchor="middle" fill={relationColor} fontSize={10} fontWeight={700}>
                  {relationLabel}
                </text>
                <text x={x + NODE_W / 2} y={y + FRAME_H + 50} textAnchor="middle" fill={dateFill} fontSize={11}>
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
  const currentFrame = effectiveFrame(person.frameStyle, vaultFrame);

  const setFrameForPerson = async (frame: string) => {
    await window.nodus.setPersonFrame(person.personId, frame);
    await onChanged();
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-80 overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-5 shadow-2xl">
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

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Añadir parentesco')}</h3>
      <KinshipEditor person={person} persons={persons} onChanged={onChanged} compact />
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
