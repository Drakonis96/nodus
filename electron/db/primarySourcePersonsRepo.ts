import type {
  PrimarySourceEntityResolution,
  PrimarySourceEvidenceRole,
  PrimarySourceIdentityStatus,
  PrimarySourcePersonAssertion,
  PrimarySourcePersonAssertionField,
  PrimarySourcePersonComparisonCandidate,
  PrimarySourcePersonDiscrepancy,
  PrimarySourcePersonDocumentMention,
  PrimarySourcePersonDossier,
  PrimarySourcePersonFilter,
  PrimarySourcePersonIdentityMember,
  PrimarySourcePersonSummary,
  PrimarySourcePersonVariant,
} from '@shared/primarySourcesTypes';
import { normalizeNameKey } from '@shared/recordsExtraction';
import { editDistance } from '@shared/matchCandidates';
import { getDb } from './database';
import { addPersonName } from './entitiesRepo';
import {
  createEntityResolution,
  revertEntityResolution,
} from './archiveProposalsRepo';

type PersonRow = {
  person_id: string;
  display_name: string;
  identity_status: PrimarySourceIdentityStatus;
  birth_date: string | null;
  death_date: string | null;
  updated_at: string;
};

type ResolutionRow = {
  resolution_id: string;
  entity_kind: 'person' | 'place';
  source_entity_id: string;
  target_entity_id: string | null;
  decision: PrimarySourceEntityResolution['decision'];
  rationale: string | null;
  status: PrimarySourceEntityResolution['status'];
  created_by: string | null;
  created_at: string;
  reverted_at: string | null;
};

type MentionRow = {
  mention_id: string;
  item_id: string;
  excerpt_id: string | null;
  person_id: string | null;
  original_label: string;
  role: string | null;
  certainty: number | null;
  identity_status: PrimarySourceIdentityStatus;
  created_at: string;
  updated_at: string;
  source_title: string;
  reference_code: string | null;
  repository_name: string | null;
  excerpt_locator: string | null;
  quoted_text: string | null;
  evidence_id: string | null;
  evidence_role: PrimarySourceEvidenceRole | null;
};

type DecisionAssertionRow = {
  decision_id: string;
  person_id: string;
  item_id: string;
  excerpt_id: string;
  decided_payload_json: string;
  source_title: string;
  reference_code: string | null;
  excerpt_locator: string;
  quoted_text: string | null;
  evidence_id: string | null;
  evidence_role: PrimarySourceEvidenceRole | null;
  certainty: number | null;
};

const SOURCE_JOINS = `
  JOIN archive_items i ON i.item_id=pm.item_id
  LEFT JOIN archive_item_units iu ON iu.item_id=i.item_id AND iu.relation_kind='describes'
  LEFT JOIN archive_description_units u ON u.unit_id=iu.unit_id
  LEFT JOIN archive_repositories repository ON repository.repository_id=u.repository_id
  LEFT JOIN archive_excerpts excerpt ON excerpt.excerpt_id=pm.excerpt_id`;

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(',');
}

function resolutionFromRow(row: ResolutionRow): PrimarySourceEntityResolution {
  return {
    resolutionId: row.resolution_id,
    entityKind: row.entity_kind,
    sourceEntityId: row.source_entity_id,
    targetEntityId: row.target_entity_id,
    decision: row.decision,
    rationale: row.rationale,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    revertedAt: row.reverted_at,
  };
}

function allPeople(): Map<string, PersonRow> {
  const rows = getDb().prepare(
    `SELECT person_id, display_name, COALESCE(identity_status, 'confirmed') AS identity_status,
       birth_date, death_date, updated_at
     FROM persons`
  ).all() as PersonRow[];
  return new Map(rows.map((row) => [row.person_id, row]));
}

function activePersonMerges(): ResolutionRow[] {
  return getDb().prepare(
    `SELECT * FROM entity_resolutions
     WHERE entity_kind='person' AND decision='merge' AND status='active'
       AND target_entity_id IS NOT NULL
     ORDER BY created_at, resolution_id`
  ).all() as ResolutionRow[];
}

function documentaryPersonIds(): Set<string> {
  const rows = getDb().prepare(
    `SELECT person_id FROM archive_person_mentions WHERE person_id IS NOT NULL
     UNION
     SELECT target_id FROM record_evidence
       WHERE target_kind='person' AND source_kind='archive'
     UNION
     SELECT materialized_target_id FROM archive_proposal_decisions
       WHERE decision='accepted' AND materialized_target_kind='person'
         AND materialized_target_id IS NOT NULL`
  ).all() as Array<{ person_id?: string; target_id?: string; materialized_target_id?: string }>;
  return new Set(rows.flatMap((row) => {
    const value = row.person_id ?? row.target_id ?? row.materialized_target_id;
    return value ? [value] : [];
  }));
}

function mergeGraph() {
  const outgoing = new Map<string, string>();
  for (const resolution of activePersonMerges()) {
    if (resolution.target_entity_id) outgoing.set(resolution.source_entity_id, resolution.target_entity_id);
  }
  return outgoing;
}

function rootFor(personId: string, outgoing: ReadonlyMap<string, string>): string {
  let current = personId;
  const seen = new Set<string>();
  while (outgoing.has(current)) {
    if (seen.has(current)) throw new Error('Se ha detectado un ciclo en las resoluciones de identidad.');
    seen.add(current);
    current = outgoing.get(current)!;
  }
  return current;
}

function identityState() {
  const people = allPeople();
  const documentary = documentaryPersonIds();
  const outgoing = mergeGraph();
  const documentaryAndTargets = new Set(documentary);
  for (const id of documentary) {
    let current = id;
    const seen = new Set<string>();
    while (outgoing.has(current) && !seen.has(current)) {
      seen.add(current);
      current = outgoing.get(current)!;
      documentaryAndTargets.add(current);
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of documentaryAndTargets) {
    if (!people.has(id)) continue;
    const root = rootFor(id, outgoing);
    const members = groups.get(root) ?? [];
    members.push(id);
    groups.set(root, members);
  }
  return { people, documentary, outgoing, groups };
}

function resolveDocumentaryRoot(personId: string): { rootId: string; memberIds: string[]; people: Map<string, PersonRow> } {
  const state = identityState();
  if (!state.people.has(personId)) throw new Error('La persona ya no existe.');
  const rootId = rootFor(personId, state.outgoing);
  const memberIds = state.groups.get(rootId);
  if (!memberIds?.length) throw new Error('La persona no pertenece al corpus documental.');
  return { rootId, memberIds, people: state.people };
}

function listMentions(memberIds: string[]): PrimarySourcePersonDocumentMention[] {
  if (!memberIds.length) return [];
  const rows = getDb().prepare(
    `SELECT pm.*, i.title AS source_title, u.reference_code,
       repository.name AS repository_name, excerpt.locator_display AS excerpt_locator,
       excerpt.quoted_text,
       (SELECT re.id FROM record_evidence re
        WHERE re.target_kind='person' AND re.target_id=pm.person_id
          AND re.source_kind='archive' AND re.excerpt_id=pm.excerpt_id
        ORDER BY re.created_at, re.id LIMIT 1) AS evidence_id,
       (SELECT re.evidence_role FROM record_evidence re
        WHERE re.target_kind='person' AND re.target_id=pm.person_id
          AND re.source_kind='archive' AND re.excerpt_id=pm.excerpt_id
        ORDER BY re.created_at, re.id LIMIT 1) AS evidence_role
     FROM archive_person_mentions pm
     ${SOURCE_JOINS}
     WHERE pm.person_id IN (${placeholders(memberIds)})
     ORDER BY pm.created_at, pm.mention_id`
  ).all(...memberIds) as MentionRow[];
  return rows.map((row) => ({
    mentionId: row.mention_id,
    itemId: row.item_id,
    excerptId: row.excerpt_id,
    personId: row.person_id,
    originalLabel: row.original_label,
    role: row.role,
    certainty: row.certainty,
    identityStatus: row.identity_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceTitle: row.source_title,
    referenceCode: row.reference_code,
    repositoryName: row.repository_name,
    excerptLocator: row.excerpt_locator,
    quotedText: row.quoted_text,
    evidenceRole: row.evidence_role,
    evidenceId: row.evidence_id,
  }));
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function value(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    if (typeof payload[key] === 'string' && payload[key].trim()) return payload[key].trim();
  }
  return null;
}

function listAssertions(
  memberIds: string[],
  mentions: PrimarySourcePersonDocumentMention[]
): PrimarySourcePersonAssertion[] {
  const assertions: PrimarySourcePersonAssertion[] = mentions.flatMap((mention) =>
    mention.excerptId && mention.excerptLocator
      ? [{
          assertionId: `mention:${mention.mentionId}`,
          field: 'name' as const,
          value: mention.originalLabel,
          personId: mention.personId!,
          itemId: mention.itemId,
          excerptId: mention.excerptId,
          sourceTitle: mention.sourceTitle,
          referenceCode: mention.referenceCode,
          excerptLocator: mention.excerptLocator,
          quotedText: mention.quotedText,
          evidenceId: mention.evidenceId,
          evidenceRole: mention.evidenceRole ?? 'mentions',
          certainty: mention.certainty,
        }]
      : []
  );
  if (!memberIds.length) return assertions;
  const rows = getDb().prepare(
    `SELECT d.decision_id, d.materialized_target_id AS person_id, d.item_id,
       p.excerpt_id, d.decided_payload_json, i.title AS source_title,
       u.reference_code, excerpt.locator_display AS excerpt_locator,
       excerpt.quoted_text, d.evidence_id,
       COALESCE(d.evidence_role, re.evidence_role, 'supports') AS evidence_role,
       re.certainty
     FROM archive_proposal_decisions d
     JOIN archive_entity_proposals p ON p.proposal_id=d.proposal_id
     JOIN archive_excerpts excerpt ON excerpt.excerpt_id=p.excerpt_id
     JOIN archive_items i ON i.item_id=d.item_id
     LEFT JOIN archive_item_units iu ON iu.item_id=i.item_id AND iu.relation_kind='describes'
     LEFT JOIN archive_description_units u ON u.unit_id=iu.unit_id
     LEFT JOIN record_evidence re ON re.id=d.evidence_id
     WHERE d.decision='accepted' AND d.materialized_target_kind='person'
       AND d.materialized_target_id IN (${placeholders(memberIds)})
     ORDER BY d.created_at, d.decision_id`
  ).all(...memberIds) as DecisionAssertionRow[];

  const fields: Array<{
    field: PrimarySourcePersonAssertionField;
    keys: string[];
    omit?: (result: string) => boolean;
  }> = [
    { field: 'birth_date', keys: ['birthDate', 'birth'] },
    { field: 'death_date', keys: ['deathDate', 'death'] },
    { field: 'sex', keys: ['sex'], omit: (result) => result === 'unknown' },
    { field: 'occupation', keys: ['occupation'] },
    { field: 'role', keys: ['role'] },
  ];
  for (const row of rows) {
    const payload = parsePayload(row.decided_payload_json);
    for (const definition of fields) {
      const result = value(payload, ...definition.keys);
      if (!result || definition.omit?.(result)) continue;
      assertions.push({
        assertionId: `${row.decision_id}:${definition.field}`,
        field: definition.field,
        value: result,
        personId: row.person_id,
        itemId: row.item_id,
        excerptId: row.excerpt_id,
        sourceTitle: row.source_title,
        referenceCode: row.reference_code,
        excerptLocator: row.excerpt_locator,
        quotedText: row.quoted_text,
        evidenceId: row.evidence_id,
        evidenceRole: row.evidence_role ?? 'supports',
        certainty: row.certainty,
      });
    }
  }
  return assertions;
}

function normalizedValue(valueToNormalize: string): string {
  return valueToNormalize.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase();
}

function discrepanciesFor(assertions: PrimarySourcePersonAssertion[]): PrimarySourcePersonDiscrepancy[] {
  const byField = new Map<PrimarySourcePersonAssertionField, PrimarySourcePersonAssertion[]>();
  for (const assertion of assertions) {
    const current = byField.get(assertion.field) ?? [];
    current.push(assertion);
    byField.set(assertion.field, current);
  }
  const discrepancies: PrimarySourcePersonDiscrepancy[] = [];
  for (const [field, fieldAssertions] of byField) {
    // Orthographic name forms are variants, not contradictions by themselves.
    if (field === 'name') continue;
    const alternatives = new Map<string, PrimarySourcePersonAssertion[]>();
    for (const assertion of fieldAssertions) {
      const key = normalizedValue(assertion.value);
      const current = alternatives.get(key) ?? [];
      current.push(assertion);
      alternatives.set(key, current);
    }
    const contradicted = fieldAssertions.some((assertion) => assertion.evidenceRole === 'contradicts');
    if (alternatives.size < 2 && !contradicted) continue;
    discrepancies.push({
      field,
      alternatives: [...alternatives.values()].map((group) => ({
        value: group[0].value,
        assertions: group,
      })),
    });
  }
  return discrepancies;
}

function variantsFor(
  rootId: string,
  memberIds: string[],
  people: Map<string, PersonRow>,
  mentions: PrimarySourcePersonDocumentMention[]
): PrimarySourcePersonVariant[] {
  const root = people.get(rootId)!;
  const registered = memberIds.flatMap((personId) => {
    const person = people.get(personId);
    const stored = getDb().prepare(
      'SELECT name FROM person_names WHERE person_id=? ORDER BY name COLLATE NOCASE'
    ).all(personId) as Array<{ name: string }>;
    return [...(person ? [person.display_name] : []), ...stored.map((entry) => entry.name)];
  });
  const mentionCounts = new Map<string, { value: string; count: number }>();
  for (const mention of mentions) {
    const key = normalizedValue(mention.originalLabel);
    const current = mentionCounts.get(key);
    mentionCounts.set(key, {
      value: current?.value ?? mention.originalLabel,
      count: (current?.count ?? 0) + 1,
    });
  }
  const variants = new Map<string, PrimarySourcePersonVariant>();
  const put = (entry: PrimarySourcePersonVariant) => {
    const key = normalizedValue(entry.value);
    const current = variants.get(key);
    if (!current || (
      current.kind === 'documentary_mention' && entry.kind !== 'documentary_mention'
    ) || entry.kind === 'preferred') {
      variants.set(key, { ...entry, mentionCount: Math.max(entry.mentionCount, current?.mentionCount ?? 0) });
    } else if (current) {
      current.mentionCount = Math.max(current.mentionCount, entry.mentionCount);
    }
  };
  put({ value: root.display_name, kind: 'preferred', mentionCount: 0 });
  for (const name of registered) {
    put({ value: name, kind: normalizedValue(name) === normalizedValue(root.display_name) ? 'preferred' : 'registered_variant', mentionCount: 0 });
  }
  for (const entry of mentionCounts.values()) {
    put({ value: entry.value, kind: normalizedValue(entry.value) === normalizedValue(root.display_name) ? 'preferred' : 'documentary_mention', mentionCount: entry.count });
  }
  return [...variants.values()].sort((a, b) =>
    a.kind === b.kind ? a.value.localeCompare(b.value) : a.kind === 'preferred' ? -1 : b.kind === 'preferred' ? 1 : 0
  );
}

function sourceIdsFor(memberIds: string[]): Set<string> {
  if (!memberIds.length) return new Set();
  const rows = getDb().prepare(
    `SELECT item_id FROM archive_person_mentions WHERE person_id IN (${placeholders(memberIds)})
     UNION
     SELECT nodus_id AS item_id FROM record_evidence
       WHERE target_kind='person' AND source_kind='archive'
         AND target_id IN (${placeholders(memberIds)}) AND nodus_id IS NOT NULL`
  ).all(...memberIds, ...memberIds) as Array<{ item_id: string }>;
  return new Set(rows.map((row) => row.item_id));
}

function evidenceCountFor(memberIds: string[]): number {
  if (!memberIds.length) return 0;
  const row = getDb().prepare(
    `SELECT COUNT(*) AS count FROM record_evidence
     WHERE target_kind='person' AND source_kind='archive'
       AND target_id IN (${placeholders(memberIds)})`
  ).get(...memberIds) as { count: number };
  return Number(row.count);
}

function summaryFor(
  rootId: string,
  memberIds: string[],
  people: Map<string, PersonRow>
): PrimarySourcePersonSummary {
  const root = people.get(rootId);
  if (!root) throw new Error('La identidad documental ya no existe.');
  const mentions = listMentions(memberIds);
  const assertions = listAssertions(memberIds, mentions);
  const discrepancies = discrepanciesFor(assertions);
  const variants = variantsFor(rootId, memberIds, people, mentions);
  return {
    personId: rootId,
    displayName: root.display_name,
    identityStatus: root.identity_status === 'provisional' ? 'provisional' : 'confirmed',
    variants,
    mentionCount: mentions.length,
    sourceCount: sourceIdsFor(memberIds).size,
    evidenceCount: evidenceCountFor(memberIds),
    discrepancyCount: discrepancies.length,
    identityMemberCount: memberIds.length,
    updatedAt: memberIds
      .map((id) => people.get(id)?.updated_at ?? '')
      .sort()
      .at(-1) ?? root.updated_at,
  };
}

function yearFromAssertions(assertions: PrimarySourcePersonAssertion[]): number | null {
  for (const assertion of assertions) {
    if (assertion.field !== 'birth_date') continue;
    const match = assertion.value.match(/\b(\d{4})\b/);
    if (match) return Number(match[1]);
  }
  return null;
}

function nameSimilarity(
  left: PrimarySourcePersonVariant[],
  right: PrimarySourcePersonVariant[]
): { kind: 'exact' | 'similar'; sharedVariant: boolean } | null {
  for (const a of left) {
    for (const b of right) {
      const normalizedA = normalizeNameKey(a.value);
      const normalizedB = normalizeNameKey(b.value);
      if (!normalizedA || !normalizedB) continue;
      if (normalizedA === normalizedB) {
        return {
          kind: 'exact',
          sharedVariant: a.kind !== 'preferred' || b.kind !== 'preferred',
        };
      }
      const tokensA = normalizedA.split(/\s+/);
      const tokensB = normalizedB.split(/\s+/);
      if (
        editDistance(tokensA[0], tokensB[0]) <= 1
        && editDistance(tokensA.at(-1)!, tokensB.at(-1)!) <= 1
      ) {
        return { kind: 'similar', sharedVariant: false };
      }
    }
  }
  return null;
}

function comparisonCandidates(
  rootId: string,
  memberIds: string[],
  people: Map<string, PersonRow>
): PrimarySourcePersonComparisonCandidate[] {
  const state = identityState();
  const selectedSummary = summaryFor(rootId, memberIds, people);
  const selectedMentions = listMentions(memberIds);
  const selectedAssertions = listAssertions(memberIds, selectedMentions);
  const selectedYear = yearFromAssertions(selectedAssertions);
  const selectedSources = sourceIdsFor(memberIds);
  const candidates: PrimarySourcePersonComparisonCandidate[] = [];
  for (const [otherRootId, otherMemberIds] of state.groups) {
    if (otherRootId === rootId) continue;
    const otherSummary = summaryFor(otherRootId, otherMemberIds, state.people);
    const similarity = nameSimilarity(selectedSummary.variants, otherSummary.variants);
    if (!similarity) continue;
    const otherMentions = listMentions(otherMemberIds);
    const otherYear = yearFromAssertions(listAssertions(otherMemberIds, otherMentions));
    if (selectedYear !== null && otherYear !== null && Math.abs(selectedYear - otherYear) > 3) continue;
    const reasons: PrimarySourcePersonComparisonCandidate['reasons'] = [
      similarity.kind === 'exact' ? 'same_name' : 'similar_name',
    ];
    let score = similarity.kind === 'exact' ? 1 : 0.82;
    if (similarity.sharedVariant) {
      reasons.push('shared_variant');
      score += 0.12;
    }
    if (selectedYear !== null && otherYear !== null) {
      reasons.push('compatible_dates');
      score += 0.2;
    }
    if ([...sourceIdsFor(otherMemberIds)].some((itemId) => selectedSources.has(itemId))) {
      reasons.push('shared_source');
      score += 0.08;
    }
    candidates.push({
      personId: otherRootId,
      displayName: otherSummary.displayName,
      variants: otherSummary.variants.map((variant) => variant.value),
      sourceCount: otherSummary.sourceCount,
      mentionCount: otherSummary.mentionCount,
      score: Math.min(1, score),
      reasons,
    });
  }
  return candidates.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
}

export function listPrimarySourcePersons(options: {
  search?: string;
  filter?: PrimarySourcePersonFilter;
} = {}): PrimarySourcePersonSummary[] {
  const state = identityState();
  const search = normalizedValue(options.search ?? '');
  return [...state.groups.entries()]
    .map(([rootId, memberIds]) => summaryFor(rootId, memberIds, state.people))
    .filter((summary) => {
      if (search && !summary.variants.some((variant) => normalizedValue(variant.value).includes(search))) return false;
      if (options.filter === 'provisional' && summary.identityStatus !== 'provisional') return false;
      if (options.filter === 'confirmed' && summary.identityStatus !== 'confirmed') return false;
      if (options.filter === 'discrepant' && summary.discrepancyCount === 0) return false;
      return true;
    })
    .sort((a, b) => b.sourceCount - a.sourceCount || a.displayName.localeCompare(b.displayName));
}

export function getPrimarySourcePersonDossier(personId: string): PrimarySourcePersonDossier | null {
  let resolved: ReturnType<typeof resolveDocumentaryRoot>;
  try {
    resolved = resolveDocumentaryRoot(personId);
  } catch {
    return null;
  }
  const { rootId, memberIds, people } = resolved;
  const mentions = listMentions(memberIds);
  const assertions = listAssertions(memberIds, mentions);
  const sourceCounts = new Map(memberIds.map((id) => [id, sourceIdsFor([id]).size]));
  const mentionCounts = new Map<string, number>();
  for (const mention of mentions) {
    if (mention.personId) mentionCounts.set(mention.personId, (mentionCounts.get(mention.personId) ?? 0) + 1);
  }
  const identityMembers: PrimarySourcePersonIdentityMember[] = memberIds.map((id) => {
    const person = people.get(id)!;
    return {
      personId: id,
      displayName: person.display_name,
      identityStatus: id === rootId
        ? person.identity_status
        : 'merged',
      isPreferred: id === rootId,
      sourceCount: sourceCounts.get(id) ?? 0,
      mentionCount: mentionCounts.get(id) ?? 0,
    };
  }).sort((a, b) => Number(b.isPreferred) - Number(a.isPreferred) || a.displayName.localeCompare(b.displayName));
  const memberSet = new Set(memberIds);
  const resolutions = (getDb().prepare(
    `SELECT * FROM entity_resolutions
     WHERE entity_kind='person' AND decision='merge'
       AND (source_entity_id IN (${placeholders(memberIds)})
         OR target_entity_id IN (${placeholders(memberIds)}))
     ORDER BY created_at DESC, resolution_id DESC`
  ).all(...memberIds, ...memberIds) as ResolutionRow[])
    .filter((row) => memberSet.has(row.source_entity_id) || (row.target_entity_id ? memberSet.has(row.target_entity_id) : false))
    .map(resolutionFromRow);
  return {
    summary: summaryFor(rootId, memberIds, people),
    identityMembers,
    mentions,
    assertions,
    discrepancies: discrepanciesFor(assertions),
    candidates: comparisonCandidates(rootId, memberIds, people),
    resolutions,
  };
}

export function addPrimarySourcePersonVariant(personId: string, name: string): PrimarySourcePersonDossier {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Escribe una variante de nombre.');
  const { rootId } = resolveDocumentaryRoot(personId);
  addPersonName(rootId, trimmed, 'documentary_variant');
  return getPrimarySourcePersonDossier(rootId)!;
}

export function mergePrimarySourcePersons(input: {
  sourcePersonId: string;
  targetPersonId: string;
  rationale?: string | null;
  createdBy?: string | null;
}): PrimarySourcePersonDossier {
  const source = resolveDocumentaryRoot(input.sourcePersonId);
  const target = resolveDocumentaryRoot(input.targetPersonId);
  if (source.rootId === target.rootId) throw new Error('Estas personas ya forman una única identidad documental.');
  const state = identityState();
  if (rootFor(target.rootId, state.outgoing) === source.rootId) {
    throw new Error('La fusión crearía un ciclo de identidad.');
  }
  const representativeItem = listMentions(source.memberIds)[0]?.itemId
    ?? listMentions(target.memberIds)[0]?.itemId;
  createEntityResolution({
    entityKind: 'person',
    sourceEntityId: source.rootId,
    targetEntityId: target.rootId,
    decision: 'merge',
    rationale: input.rationale?.trim() || 'Identidades reunidas tras comparar sus menciones documentales.',
    createdBy: input.createdBy ?? 'primary_sources_user',
    itemId: representativeItem,
  });
  return getPrimarySourcePersonDossier(target.rootId)!;
}

export function revertPrimarySourcePersonMerge(resolutionId: string): PrimarySourcePersonDossier | null {
  const row = getDb().prepare(
    `SELECT * FROM entity_resolutions
     WHERE resolution_id=? AND entity_kind='person' AND decision='merge'`
  ).get(resolutionId) as ResolutionRow | undefined;
  if (!row) throw new Error('La fusión documental ya no existe.');
  const representative = getDb().prepare(
    `SELECT item_id FROM archive_person_mentions
     WHERE person_id IN (?, ?) ORDER BY created_at LIMIT 1`
  ).get(row.source_entity_id, row.target_entity_id) as { item_id: string } | undefined;
  revertEntityResolution(resolutionId, representative?.item_id);
  const target = row.target_entity_id ? getPrimarySourcePersonDossier(row.target_entity_id) : null;
  return target ?? getPrimarySourcePersonDossier(row.source_entity_id);
}
