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
  const primary = primaryId.trim();
  const secondary = secondaryId.trim();
  if (!subjectId || !primary || primary === subjectId) return [];
  const subtype: RelationshipSubtype = adoptive ? 'adoptive' : null;

  if (choice === 'child_of') {
    const parents = [...new Set([primary, secondary].filter((id) => id && id !== subjectId))];
    return parents.map((parentId) => ({ fromPerson: parentId, toPerson: subjectId, type: 'parent', subtype }));
  }
  if (choice === 'parent_of') {
    return [{ fromPerson: subjectId, toPerson: primary, type: 'parent', subtype }];
  }
  return [{
    fromPerson: subjectId,
    toPerson: primary,
    type: choice === 'sibling_of' ? 'sibling' : 'spouse',
    subtype: null,
  }];
}
