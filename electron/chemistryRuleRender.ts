import type { RDKitModule } from '@rdkit/rdkit';
import type { ChemistryMechanismArtifact, ChemistryRule } from '@shared/chemistryDocument';
import { canonicalScene, exportSceneChemfig, sceneMolfile, verifySceneChemfig } from './chemistryScene';
import type { CheckedMechanism } from './chemistryMechanisms';
import { deriveE2 } from './chemistryE2';
import { deriveAldol } from './chemistryAldol';
import { deriveDielsAlder } from './chemistryDielsAlder';
import { compileChemfig } from './chemistry';

export async function renderCheckedMechanism(checked: CheckedMechanism, kit: RDKitModule): Promise<ChemistryMechanismArtifact> {
  const parts = checked.scenes.map((s, i) => { const source = exportSceneChemfig(s); verifySceneChemfig(source, s, canonicalScene(s, kit), kit); return source.replace(/@\{([ab]\d+)\}/g, `@{m${i}$1}`); });
  const group = (ids: number[]) => ids.map(i => parts[i]).join(' \\arrow{0}[,0.4] \\+ \\arrow{0}[,0.4] ');
  const anchor = (e: { molecule: number; atom?: number; bond?: number }) => `m${e.molecule}${e.atom == null ? `b${e.bond}` : `a${e.atom}`}`;
  const flows = checked.electronFlow.map(flow => {
    let start = 65, end = 115, radius = 8;
    if (flow.from.molecule > flow.to.molecule) { start = -115; end = -65; }
    if (flow.from.molecule === flow.to.molecule) {
      const s = checked.scenes[flow.from.molecule];
      const point = (e: typeof flow.from) => e.atom != null ? s.atoms[e.atom] : { x: (s.atoms[s.bonds[e.bond!].a].x + s.atoms[s.bonds[e.bond!].b].x) / 2, y: (s.atoms[s.bonds[e.bond!].a].y + s.atoms[s.bonds[e.bond!].b].y) / 2 };
      const a = point(flow.from), b = point(flow.to);
      start = end = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90;
      radius = 5;
    } else if (checked.rule === 'e2') { start = end = -90; radius = 40; }
    return `\\draw[->](${anchor(flow.from)}).. controls +(${start.toFixed(3)}:${radius}mm) and +(${end.toFixed(3)}:${radius}mm).. (${anchor(flow.to)});`;
  }).join('');
  const labels: Record<ChemistryRule, string> = { sn2: 'SN2', e2: 'E2', aldol: 'aldol', 'diels-alder': 'Diels-Alder', 'amide-resonance': '' };
  const suffix = checked.rule === 'diels-alder' ? (checked.title?.endsWith(': endo') ? ' endo' : checked.title?.endsWith(': exo') ? ' exo' : '') : checked.rule === 'aldol' ? ` ${checked.title?.match(/^[123]/)?.[0] ?? ''}` : checked.rule === 'e2' ? ` (${checked.title?.match(/\d+$/)?.[0] ?? '1'})` : '';
  const source = `\\schemestart ${group(checked.reactants)} \\arrow{${checked.rule === 'amide-resonance' ? '<->' : `->[${labels[checked.rule]}${suffix}]`}} ${group(checked.products)} \\schemestop\\chemmove{${flows}}`;
  const svg = await compileChemfig(source);
  const { scenes: _scenes, reactants: _reactants, products: _products, ...metadata } = checked;
  const molecules = checked.scenes.map((s, i) => ({ id: `m${i}`, role: checked.reactants.includes(i) ? 'reactant' as const : 'product' as const, canonicalSmiles: canonicalScene(s, kit), molfile: sceneMolfile(s) }));
  return { ...metadata, molecules, svg, chemfig: { status: 'validated', source, checks: ['Rule applicability', 'Complete atom mapping and atom/isotope/charge conservation', 'Deterministic bond edits; stated stereo outcome', 'Every molecular ChemFig fragment round-tripped; whole scheme compiled'] } };
}

export async function renderExtendedMechanism(rule: ChemistryRule, inputs: string[], kit: RDKitModule, approach?: 'endo' | 'exo'): Promise<ChemistryMechanismArtifact> {
  const derived = rule === 'e2' ? deriveE2(inputs, kit) : rule === 'aldol' ? deriveAldol(inputs, kit) : deriveDielsAlder(inputs, kit, approach);
  const panels: ChemistryMechanismArtifact[] = [];
  for (const panel of derived.panels) panels.push(await renderCheckedMechanism(panel, kit));
  if (panels.length === 1) return panels[0];
  // Anchor names must be unique across all rows of the exported TeX document.
  let arrows = '';
  const rows = panels.map((p, i) => {
    const tex = p.chemfig.source!.replace(/m(\d+)([ab]\d+)/g, `p${i}m$1$2`);
    const match = /\\chemmove\{([\s\S]*)\}$/.exec(tex);
    if (!match) throw new Error('Missing compiled panel arrow record.');
    arrows += match[1];
    return `\\hbox{${tex.slice(0, match.index)}}`;
  // SVG electron overlays cannot enlarge TeX's row boxes. Reserve space for
  // the E2 base-to-H arc so it cannot cross the next alternative's reactant.
  }).join(rule === 'e2' ? '\\vskip100pt ' : '\\vskip24pt ');
  const source = `\\vbox{${rows}}\\chemmove{${arrows}}`;
  // The aggregate has no flat atom-map namespace: evidence belongs to each
  // panel, avoiding an apparent mapping between alternative products.
  const aggregate: ChemistryMechanismArtifact = { rule, scope: 'conditional-elementary-rule-not-product-prediction', source: panels[0].source, title: rule === 'aldol' ? 'Aldol addition: three elementary steps' : `${rule}: alternative pathways`, svg: '', chemfig: { status: 'unsupported' }, canonicalProducts: derived.finalProducts, limitations: derived.limitations, molecules: [], atomMap: [], electronFlow: [], bondEdits: [], panels };
  try {
    aggregate.svg = await compileChemfig(source);
    aggregate.chemfig = { status: 'validated', source, checks: ['Each panel has independent graph, atom map and charge checks', 'Unique arrow anchors across panels', 'Actual combined ChemFig compilation'] };
  } catch (error) {
    // A large collection may exceed the 8 KB TeX cap. Individual diagrams and
    // their validated downloads remain available; never claim a bundle passed.
    aggregate.svg = panels[0].svg;
    aggregate.chemfig = { status: 'unsupported', reason: `Combined export unavailable; use the individually validated panels. ${error instanceof Error ? error.message : ''}` };
  }
  return aggregate;
}
