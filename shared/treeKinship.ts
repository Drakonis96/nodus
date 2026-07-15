import type { TreePersonAttr } from './treeLayout';

export type TreeBranch = 'paternal' | 'maternal' | 'neutral';
export type TreeKinshipRole =
  | 'focus'
  | 'father' | 'mother' | 'parent'
  | 'paternal_grandfather' | 'paternal_grandmother' | 'paternal_grandparent'
  | 'maternal_grandfather' | 'maternal_grandmother' | 'maternal_grandparent'
  | 'paternal_ancestor' | 'maternal_ancestor' | 'ancestor'
  | 'brother' | 'sister' | 'sibling'
  | 'spouse'
  | 'son' | 'daughter' | 'child'
  | 'grandson' | 'granddaughter' | 'grandchild'
  | 'paternal_uncle' | 'paternal_aunt' | 'maternal_uncle' | 'maternal_aunt' | 'uncle_aunt'
  | 'nephew' | 'niece' | 'nibling'
  | 'cousin'
  | 'descendant';

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
      } else role = branch === 'paternal' ? 'paternal_ancestor' : 'maternal_ancestor';
      result.set(current.id, { role, branch, tone: current.tone, depth: current.depth });
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
  for (const child of childrenOf.get(input.focusId) ?? []) {
    result.set(child, { role: sexRole(sexOf.get(child), 'son', 'daughter', 'child'), branch: 'neutral', tone: 0, depth: 1 });
    for (const grandchild of childrenOf.get(child) ?? []) {
      if (!result.has(grandchild)) result.set(grandchild, { role: sexRole(sexOf.get(grandchild), 'grandson', 'granddaughter', 'grandchild'), branch: 'neutral', tone: 0, depth: 2 });
    }
  }

  for (const [parentId, branch] of [[paternalRoot, 'paternal'], [maternalRoot, 'maternal']] as const) {
    if (!parentId) continue;
    for (const relative of siblingsOf.get(parentId) ?? []) {
      const role = branch === 'paternal'
        ? sexRole(sexOf.get(relative), 'paternal_uncle', 'paternal_aunt', 'uncle_aunt')
        : sexRole(sexOf.get(relative), 'maternal_uncle', 'maternal_aunt', 'uncle_aunt');
      if (!result.has(relative)) result.set(relative, { role, branch, tone: 0.12, depth: 1 });
      for (const cousin of childrenOf.get(relative) ?? []) if (!result.has(cousin)) result.set(cousin, { role: 'cousin', branch, tone: 0.12, depth: 0 });
    }
  }
  for (const sibling of siblingsOf.get(input.focusId) ?? []) {
    for (const child of childrenOf.get(sibling) ?? []) if (!result.has(child)) {
      result.set(child, { role: sexRole(sexOf.get(child), 'nephew', 'niece', 'nibling'), branch: 'neutral', tone: 0, depth: 1 });
    }
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
