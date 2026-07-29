import type { PrimarySourceDashboardTaskKind } from '@shared/primarySourcesTypes';

export interface PrimarySourceAttentionTarget {
  kind: PrimarySourceDashboardTaskKind;
  label: string;
  targetIds: string[];
}

const KEY = 'nodus.primarySourcesAttention';

export function consumePrimarySourceAttention(
  accepted: PrimarySourceDashboardTaskKind[]
): PrimarySourceAttentionTarget | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PrimarySourceAttentionTarget>;
    if (
      typeof value.kind !== 'string'
      || !accepted.includes(value.kind as PrimarySourceDashboardTaskKind)
      || typeof value.label !== 'string'
      || !Array.isArray(value.targetIds)
    ) return null;
    localStorage.removeItem(KEY);
    return {
      kind: value.kind as PrimarySourceDashboardTaskKind,
      label: value.label,
      targetIds: value.targetIds.filter((id): id is string => typeof id === 'string').slice(0, 1000),
    };
  } catch {
    localStorage.removeItem(KEY);
    return null;
  }
}
