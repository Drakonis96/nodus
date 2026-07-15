import type { TreePersonAttr } from './treeLayout';

export type TreeBranch = 'paternal' | 'maternal' | 'neutral';
export type TreeKinshipRole =
  | 'focus'
  | 'father' | 'mother' | 'parent'
  | 'paternal_grandfather' | 'paternal_grandmother' | 'paternal_grandparent'
  | 'maternal_grandfather' | 'maternal_grandmother' | 'maternal_grandparent'
  | 'great_grandfather' | 'great_grandmother' | 'great_grandparent'
  | 'great_great_grandfather' | 'great_great_grandmother' | 'great_great_grandparent'
  | 'paternal_ancestor' | 'maternal_ancestor' | 'ancestor'
  | 'brother' | 'sister' | 'sibling'
  | 'spouse'
  | 'son' | 'daughter' | 'child'
  | 'grandson' | 'granddaughter' | 'grandchild'
  | 'great_grandson' | 'great_granddaughter' | 'great_grandchild'
  | 'great_great_grandson' | 'great_great_granddaughter' | 'great_great_grandchild'
  | 'paternal_uncle' | 'paternal_aunt' | 'maternal_uncle' | 'maternal_aunt' | 'uncle_aunt'
  | 'paternal_granduncle' | 'paternal_grandaunt' | 'maternal_granduncle' | 'maternal_grandaunt' | 'granduncle_aunt'
  | 'great_granduncle' | 'great_grandaunt' | 'great_granduncle_aunt'
  | 'nephew' | 'niece' | 'nibling'
  | 'grandnephew' | 'grandniece' | 'grandnibling'
  | 'great_grandnephew' | 'great_grandniece' | 'great_grandnibling'
  | 'male_cousin' | 'female_cousin' | 'cousin'
  | 'descendant' | 'relative_by_marriage';

/** Canonical labels shared by the tree UI and every genealogy AI context. */
export const TREE_KINSHIP_ROLE_LABEL_ES: Record<TreeKinshipRole, string> = {
  focus: 'Persona principal', father: 'Padre', mother: 'Madre', parent: 'Progenitor/a',
  paternal_grandfather: 'Abuelo paterno', paternal_grandmother: 'Abuela paterna', paternal_grandparent: 'Abuelo/a paterno/a',
  maternal_grandfather: 'Abuelo materno', maternal_grandmother: 'Abuela materna', maternal_grandparent: 'Abuelo/a materno/a',
  great_grandfather: 'Bisabuelo', great_grandmother: 'Bisabuela', great_grandparent: 'Bisabuelo/a',
  great_great_grandfather: 'Tatarabuelo', great_great_grandmother: 'Tatarabuela', great_great_grandparent: 'Tatarabuelo/a',
  paternal_ancestor: 'Antepasado/a paterno/a', maternal_ancestor: 'Antepasado/a materno/a', ancestor: 'Antepasado/a',
  brother: 'Hermano', sister: 'Hermana', sibling: 'Hermano/a', spouse: 'Cónyuge/pareja',
  son: 'Hijo', daughter: 'Hija', child: 'Hijo/a', grandson: 'Nieto', granddaughter: 'Nieta', grandchild: 'Nieto/a',
  great_grandson: 'Bisnieto', great_granddaughter: 'Bisnieta', great_grandchild: 'Bisnieto/a',
  great_great_grandson: 'Tataranieto', great_great_granddaughter: 'Tataranieta', great_great_grandchild: 'Tataranieto/a',
  paternal_uncle: 'Tío paterno', paternal_aunt: 'Tía paterna', maternal_uncle: 'Tío materno', maternal_aunt: 'Tía materna', uncle_aunt: 'Tío/a',
  paternal_granduncle: 'Tío abuelo paterno', paternal_grandaunt: 'Tía abuela paterna', maternal_granduncle: 'Tío abuelo materno', maternal_grandaunt: 'Tía abuela materna', granduncle_aunt: 'Tío/a abuelo/a',
  great_granduncle: 'Tío bisabuelo', great_grandaunt: 'Tía bisabuela', great_granduncle_aunt: 'Tío/a bisabuelo/a',
  nephew: 'Sobrino', niece: 'Sobrina', nibling: 'Sobrino/a',
  grandnephew: 'Sobrino nieto', grandniece: 'Sobrina nieta', grandnibling: 'Sobrino/a nieto/a',
  great_grandnephew: 'Sobrino bisnieto', great_grandniece: 'Sobrina bisnieta', great_grandnibling: 'Sobrino/a bisnieto/a',
  male_cousin: 'Primo', female_cousin: 'Prima', cousin: 'Primo/a',
  descendant: 'Descendiente', relative_by_marriage: 'Pariente por afinidad',
};

export interface TreeKinshipContext {
  role: TreeKinshipRole;
  branch: TreeBranch;
  /** Signed shade adjustment; ancestors inside one branch alternate intensity. */
  tone: number;
  depth: number;
}

export interface TreeKinshipInput {
  focusId: string;
  parentEdges: { parent: string; child: string }[];
  spouseEdges: { a: string; b: string }[];
  siblingEdges?: { a: string; b: string }[];
  persons?: TreePersonAttr[];
}

function sexRole(sex: string | undefined, male: TreeKinshipRole, female: TreeKinshipRole, unknown: TreeKinshipRole): TreeKinshipRole {
  return sex === 'male' ? male : sex === 'female' ? female : unknown;
}

function descendantRole(sex: string | undefined, depth: number): TreeKinshipRole {
  if (depth === 1) return sexRole(sex, 'son', 'daughter', 'child');
  if (depth === 2) return sexRole(sex, 'grandson', 'granddaughter', 'grandchild');
  if (depth === 3) return sexRole(sex, 'great_grandson', 'great_granddaughter', 'great_grandchild');
  if (depth === 4) return sexRole(sex, 'great_great_grandson', 'great_great_granddaughter', 'great_great_grandchild');
  return 'descendant';
}

function niblingRole(sex: string | undefined, depth: number): TreeKinshipRole {
  if (depth === 1) return sexRole(sex, 'nephew', 'niece', 'nibling');
  if (depth === 2) return sexRole(sex, 'grandnephew', 'grandniece', 'grandnibling');
  return sexRole(sex, 'great_grandnephew', 'great_grandniece', 'great_grandnibling');
}

export function deriveTreeKinship(input: TreeKinshipInput): Map<string, TreeKinshipContext> {
  const sexOf = new Map((input.persons ?? []).map((person) => [person.id, person.sex]));
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const { parent, child } of input.parentEdges) {
    (parentsOf.get(child) ?? parentsOf.set(child, []).get(child)!).push(parent);
    (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(child);
  }
  const spousesOf = new Map<string, string[]>();
  for (const { a, b } of input.spouseEdges) {
    (spousesOf.get(a) ?? spousesOf.set(a, []).get(a)!).push(b);
    (spousesOf.get(b) ?? spousesOf.set(b, []).get(b)!).push(a);
  }
  const siblingsOf = new Map<string, Set<string>>();
  const addSibling = (a: string, b: string) => {
    if (a === b) return;
    (siblingsOf.get(a) ?? siblingsOf.set(a, new Set()).get(a)!).add(b);
    (siblingsOf.get(b) ?? siblingsOf.set(b, new Set()).get(b)!).add(a);
  };
  for (const { a, b } of input.siblingEdges ?? []) addSibling(a, b);
  for (const children of childrenOf.values()) {
    for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) addSibling(children[i], children[j]);
  }

  const result = new Map<string, TreeKinshipContext>();
  result.set(input.focusId, { role: 'focus', branch: 'neutral', tone: 0, depth: 0 });

  const unambiguousParentSex = (parentId: string, childId: string): string | undefined => {
    const sex = sexOf.get(parentId);
    if (sex !== 'male' && sex !== 'female') return undefined;
    const hasDuplicate = (parentsOf.get(childId) ?? []).some((otherId) => otherId !== parentId && sexOf.get(otherId) === sex);
    return hasDuplicate ? undefined : sex;
  };

  const focusParents = [...new Set(parentsOf.get(input.focusId) ?? [])];
  const father = focusParents.find((id) => sexOf.get(id) === 'male');
  const mother = focusParents.find((id) => sexOf.get(id) === 'female');
  const remaining = focusParents.filter((id) => id !== father && id !== mother).sort();
  const paternalRoot = father ?? (mother ? remaining[0] : remaining[0]);
  const maternalRoot = mother ?? remaining.find((id) => id !== paternalRoot);

  const ancestorContext = new Map<string, TreeKinshipContext>();
  const walkAncestors = (root: string | undefined, branch: Exclude<TreeBranch, 'neutral'>) => {
    if (!root) return;
    const queue = [{ id: root, childId: input.focusId, depth: 1, tone: 0 }];
    const seen = new Set<string>();
    while (queue.length) {
      const current = queue.shift()!;
      if (seen.has(current.id)) continue;
      seen.add(current.id);
      // Only infer a gendered kinship when the recorded parent set supports it.
      // This prevents corrupt/legacy data (for example, two parents both marked
      // female) from labelling both people as the child's mother or grandmother.
      const sex = unambiguousParentSex(current.id, current.childId);
      let role: TreeKinshipRole;
      if (current.depth === 1) role = sexRole(sex, 'father', 'mother', 'parent');
      else if (current.depth === 2) {
        role = branch === 'paternal'
          ? sexRole(sex, 'paternal_grandfather', 'paternal_grandmother', 'paternal_grandparent')
          : sexRole(sex, 'maternal_grandfather', 'maternal_grandmother', 'maternal_grandparent');
      } else if (current.depth === 3) role = sexRole(sex, 'great_grandfather', 'great_grandmother', 'great_grandparent');
      else if (current.depth === 4) role = sexRole(sex, 'great_great_grandfather', 'great_great_grandmother', 'great_great_grandparent');
      else role = branch === 'paternal' ? 'paternal_ancestor' : 'maternal_ancestor';
      const context = { role, branch, tone: current.tone, depth: current.depth } satisfies TreeKinshipContext;
      result.set(current.id, context);
      ancestorContext.set(current.id, context);
      const parents = [...new Set(parentsOf.get(current.id) ?? [])].sort((a, b) => {
        const rank = (id: string) => sexOf.get(id) === 'male' ? 0 : sexOf.get(id) === 'female' ? 1 : 2;
        return rank(a) - rank(b) || a.localeCompare(b);
      });
      parents.forEach((id, index) => {
        const parentSex = unambiguousParentSex(id, current.id);
        const direction = parentSex === 'male' ? -1 : parentSex === 'female' ? 1 : index % 2 === 0 ? -1 : 1;
        const step = Math.max(0.07, 0.2 / current.depth);
        queue.push({ id, childId: current.id, depth: current.depth + 1, tone: Math.max(-0.34, Math.min(0.34, current.tone + direction * step)) });
      });
    }
  };
  walkAncestors(paternalRoot, 'paternal');
  walkAncestors(maternalRoot, 'maternal');

  for (const sibling of siblingsOf.get(input.focusId) ?? []) {
    result.set(sibling, { role: sexRole(sexOf.get(sibling), 'brother', 'sister', 'sibling'), branch: 'neutral', tone: 0, depth: 0 });
  }
  for (const spouse of spousesOf.get(input.focusId) ?? []) result.set(spouse, { role: 'spouse', branch: 'neutral', tone: 0, depth: 0 });
  const descendantQueue = [...new Set(childrenOf.get(input.focusId) ?? [])].map((id) => ({ id, depth: 1 }));
  const seenDescendants = new Set<string>();
  while (descendantQueue.length) {
    const current = descendantQueue.shift()!;
    if (seenDescendants.has(current.id)) continue;
    seenDescendants.add(current.id);
    if (!result.has(current.id)) result.set(current.id, { role: descendantRole(sexOf.get(current.id), current.depth), branch: 'neutral', tone: 0, depth: current.depth });
    for (const child of childrenOf.get(current.id) ?? []) descendantQueue.push({ id: child, depth: current.depth + 1 });
  }

  for (const [ancestorId, context] of ancestorContext) {
    for (const relative of siblingsOf.get(ancestorId) ?? []) {
      let role: TreeKinshipRole;
      if (context.depth === 1) {
        role = context.branch === 'paternal'
          ? sexRole(sexOf.get(relative), 'paternal_uncle', 'paternal_aunt', 'uncle_aunt')
          : sexRole(sexOf.get(relative), 'maternal_uncle', 'maternal_aunt', 'uncle_aunt');
      } else if (context.depth === 2) {
        role = context.branch === 'paternal'
          ? sexRole(sexOf.get(relative), 'paternal_granduncle', 'paternal_grandaunt', 'granduncle_aunt')
          : sexRole(sexOf.get(relative), 'maternal_granduncle', 'maternal_grandaunt', 'granduncle_aunt');
      } else role = sexRole(sexOf.get(relative), 'great_granduncle', 'great_grandaunt', 'great_granduncle_aunt');
      if (!result.has(relative)) result.set(relative, { role, branch: context.branch, tone: context.tone, depth: context.depth });

      const cousinQueue = [...new Set(childrenOf.get(relative) ?? [])];
      const seenCousins = new Set<string>();
      while (cousinQueue.length) {
        const cousin = cousinQueue.shift()!;
        if (seenCousins.has(cousin)) continue;
        seenCousins.add(cousin);
        if (!result.has(cousin)) result.set(cousin, { role: sexRole(sexOf.get(cousin), 'male_cousin', 'female_cousin', 'cousin'), branch: context.branch, tone: context.tone, depth: 0 });
        cousinQueue.push(...(childrenOf.get(cousin) ?? []));
      }
    }
  }
  for (const sibling of siblingsOf.get(input.focusId) ?? []) {
    const niblingQueue = [...new Set(childrenOf.get(sibling) ?? [])].map((id) => ({ id, depth: 1 }));
    const seenNiblings = new Set<string>();
    while (niblingQueue.length) {
      const current = niblingQueue.shift()!;
      if (seenNiblings.has(current.id)) continue;
      seenNiblings.add(current.id);
      if (!result.has(current.id)) result.set(current.id, { role: niblingRole(sexOf.get(current.id), current.depth), branch: 'neutral', tone: 0, depth: current.depth });
      for (const child of childrenOf.get(current.id) ?? []) niblingQueue.push({ id: child, depth: current.depth + 1 });
    }
  }

  // Keep spouses of blood relatives intelligible without pretending they share
  // the same biological relationship with the focus person.
  for (const { a, b } of input.spouseEdges) {
    const known = result.get(a) ?? result.get(b);
    const other = result.has(a) ? b : result.has(b) ? a : null;
    if (known && other && !result.has(other)) result.set(other, { ...known, role: 'relative_by_marriage' });
  }

  return result;
}

export function adjustBranchColor(hex: string, tone: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match || tone === 0) return hex;
  const value = match[1];
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  const adjusted = channels.map((channel) => {
    const next = tone > 0 ? channel + (255 - channel) * tone : channel * (1 + tone);
    return Math.round(Math.max(0, Math.min(255, next))).toString(16).padStart(2, '0');
  });
  return `#${adjusted.join('')}`;
}

/** Keep user-selected branch colours legible over the dark tree canvas. */
export function branchColorForTheme(hex: string, tone: number, light: boolean): string {
  const tonalColor = adjustBranchColor(hex, tone);
  return light ? tonalColor : adjustBranchColor(tonalColor, 0.28);
}
