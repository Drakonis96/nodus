import type { RelationshipSubtype, RelationshipType } from './types';
import { parseHistoricalDate } from './genealogyDates';

export type KinshipChoice = 'child_of' | 'parent_of' | 'sibling_of' | 'spouse_of';

export interface KinshipRelationshipSpec {
  fromPerson: string;
  toPerson: string;
  type: RelationshipType;
  subtype: RelationshipSubtype;
}

export type ParentAgeWarning = 'parent_not_older' | 'parent_too_young' | null;

/** Conservative chronology check: warn, but never reject uncertain historical data. */
export function parentAgeWarning(parentBirthDate?: string | null, childBirthDate?: string | null): ParentAgeWarning {
  const parentYear = parseHistoricalDate(parentBirthDate).year;
  const childYear = parseHistoricalDate(childBirthDate).year;
  if (parentYear == null || childYear == null) return null;
  if (parentYear >= childYear) return 'parent_not_older';
  if (childYear - parentYear < 12) return 'parent_too_young';
  return null;
}

/** Translate a relationship chosen from one person's point of view into stored edges. */
export function kinshipRelationshipSpecs(
  subjectId: string,
  choice: KinshipChoice,
  primaryId: string,
  secondaryId = '',
  adoptive = false
): KinshipRelationshipSpec[] {
  return kinshipRelationshipSpecsForPeople(subjectId, choice, [primaryId, secondaryId], adoptive);
}

/** Translate a bulk selection from one person's point of view into stored edges. */
export function kinshipRelationshipSpecsForPeople(
  subjectId: string,
  choice: KinshipChoice,
  relatedIds: string[],
  adoptive = false
): KinshipRelationshipSpec[] {
  if (!subjectId) return [];
  const selected = [...new Set(relatedIds.map((id) => id.trim()).filter((id) => id && id !== subjectId))];
  if (selected.length === 0) return [];
  const subtype: RelationshipSubtype = adoptive ? 'adoptive' : null;

  if (choice === 'child_of') {
    return selected.map((parentId) => ({ fromPerson: parentId, toPerson: subjectId, type: 'parent', subtype }));
  }
  if (choice === 'parent_of') {
    return selected.map((childId) => ({ fromPerson: subjectId, toPerson: childId, type: 'parent', subtype }));
  }
  return selected.map((relatedId) => ({
    fromPerson: subjectId,
    toPerson: relatedId,
    type: choice === 'sibling_of' ? 'sibling' : 'spouse',
    subtype: null,
  }));
}
