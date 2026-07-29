import { randomUUID } from 'node:crypto';
import type { GazetteerPlace } from '@shared/types';
import type {
  PrimarySourceDerivedFilterOption,
  PrimarySourceEvidenceRole,
  PrimarySourceEvidenceTargetKind,
  PrimarySourceEvidenceTrace,
  PrimarySourceMapLayer,
  PrimarySourceMapPoint,
  PrimarySourceMapRole,
  PrimarySourceMapWorkspace,
  PrimarySourcePlaceResolutionDecision,
  PrimarySourceRelationEdge,
  PrimarySourceRelationNode,
  PrimarySourceRelationsWorkspace,
  PrimarySourceTimelineEvent,
  PrimarySourceTimelineWorkspace,
  PrimarySourceToponymResolutionInput,
} from '@shared/primarySourcesTypes';
import { getDb } from './database';
import { recordArchiveAudit } from './archiveAuditRepo';

const now = () => new Date().toISOString();

function parseObject(value: string | null): Record<string, unknown> | null {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseCandidate(value: string): GazetteerPlace {
  const candidate = JSON.parse(value) as GazetteerPlace;
  return candidate;
}

function parseCandidates(value: string): GazetteerPlace[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as GazetteerPlace[] : [];
  } catch {
    return [];
  }
}

type EvidenceRow = {
  evidence_id: string;
  target_kind: PrimarySourceEvidenceTargetKind;
  target_id: string;
  item_id: string;
  source_title: string;
  reference_code: string | null;
  repository_name: string | null;
  excerpt_id: string;
  locator: string;
  quote: string;
  role: PrimarySourceEvidenceRole;
  certainty: number | null;
  review_status: PrimarySourceEvidenceTrace['reviewStatus'];
};

const EVIDENCE_SELECT = `
  SELECT re.id AS evidence_id, re.target_kind, re.target_id,
    ai.item_id, ai.title AS source_title, u.reference_code,
    ar.name AS repository_name, ex.excerpt_id,
    ex.locator_display AS locator,
    COALESCE(ex.quoted_text, re.quote, '') AS quote,
    re.evidence_role AS role, re.certainty,
    re.review_status
  FROM record_evidence re
  JOIN archive_items ai
    ON re.source_kind='archive' AND ai.item_id=re.nodus_id
  JOIN archive_excerpts ex
    ON ex.excerpt_id=re.excerpt_id AND ex.item_id=ai.item_id
  LEFT JOIN archive_item_units aiu
    ON aiu.item_id=ai.item_id AND aiu.relation_kind='describes'
  LEFT JOIN archive_description_units u ON u.unit_id=aiu.unit_id
  LEFT JOIN archive_repositories ar ON ar.repository_id=u.repository_id
  WHERE length(trim(COALESCE(ex.quoted_text, re.quote, ''))) > 0`;

function evidenceTrace(row: EvidenceRow): PrimarySourceEvidenceTrace {
  return {
    evidenceId: row.evidence_id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    itemId: row.item_id,
    sourceTitle: row.source_title,
    referenceCode: row.reference_code,
    repositoryName: row.repository_name,
    excerptId: row.excerpt_id,
    locator: row.locator,
    quote: row.quote,
    role: row.role,
    certainty: row.certainty,
    reviewStatus: row.review_status,
  };
}

function allEvidence(): PrimarySourceEvidenceTrace[] {
  return (getDb().prepare(EVIDENCE_SELECT).all() as EvidenceRow[]).map(evidenceTrace);
}

function targetEvidence(
  evidence: PrimarySourceEvidenceTrace[],
  kind: PrimarySourceEvidenceTargetKind,
  targetId: string
): PrimarySourceEvidenceTrace[] {
  return evidence.filter((entry) => entry.targetKind === kind && entry.targetId === targetId);
}

function uniqueOptions(evidence: PrimarySourceEvidenceTrace[]): PrimarySourceDerivedFilterOption[] {
  const options = new Map<string, string>();
  for (const trace of evidence) options.set(trace.itemId, trace.sourceTitle);
  return [...options].map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

type SourceMetadata = {
  sourceType: string;
  repositories: Set<string>;
  collections: Map<string, string>;
};

function sourceMetadata(): Map<string, SourceMetadata> {
  const rows = getDb().prepare(
    `SELECT ai.item_id, COALESCE(NULLIF(ai.doc_type, ''), ai.kind, 'other') AS source_type,
      ar.name AS repository_name, af.folder_id, af.name AS collection_name
     FROM archive_items ai
     LEFT JOIN archive_item_units aiu
       ON aiu.item_id=ai.item_id AND aiu.relation_kind='describes'
     LEFT JOIN archive_description_units u ON u.unit_id=aiu.unit_id
     LEFT JOIN archive_repositories ar ON ar.repository_id=u.repository_id
     LEFT JOIN archive_item_folders aif ON aif.item_id=ai.item_id
     LEFT JOIN archive_folders af ON af.folder_id=aif.folder_id`
  ).all() as Array<{
    item_id: string; source_type: string; repository_name: string | null;
    folder_id: string | null; collection_name: string | null;
  }>;
  const result = new Map<string, SourceMetadata>();
  for (const row of rows) {
    const metadata = result.get(row.item_id) ?? {
      sourceType: row.source_type,
      repositories: new Set<string>(),
      collections: new Map<string, string>(),
    };
    if (row.repository_name) metadata.repositories.add(row.repository_name);
    if (row.folder_id && row.collection_name) {
      metadata.collections.set(row.folder_id, row.collection_name);
    }
    result.set(row.item_id, metadata);
  }
  return result;
}

type EventRow = {
  event_id: string;
  type: string;
  label: string | null;
  date: string | null;
  date_sort: string | null;
  date_end_sort: string | null;
  date_certainty: string;
  review_status: PrimarySourceTimelineEvent['reviewStatus'];
  place_id: string | null;
  place_name: string | null;
  notes: string | null;
};

type ParticipantRow = {
  event_id: string;
  person_id: string;
  display_name: string;
  role: string;
};

type DateDecisionRow = {
  materialized_target_id: string;
  decided_payload_json: string;
  evidence_id: string | null;
  evidence_role: PrimarySourceEvidenceRole | null;
};

export function getPrimarySourceTimelineWorkspace(): PrimarySourceTimelineWorkspace {
  const db = getDb();
  const evidence = allEvidence();
  const events = db.prepare(
    `SELECT e.event_id, e.type, e.label, e.date, e.date_sort, e.date_end_sort,
      e.date_certainty, e.review_status, e.place_id, p.name AS place_name, e.notes
     FROM events e LEFT JOIN places p ON p.place_id=e.place_id
     ORDER BY (e.date_sort IS NULL), e.date_sort, e.created_at`
  ).all() as EventRow[];
  const participants = db.prepare(
    `SELECT ep.event_id, ep.person_id, p.display_name, ep.role
     FROM event_participants ep JOIN persons p ON p.person_id=ep.person_id
     ORDER BY p.display_name`
  ).all() as ParticipantRow[];
  const dateDecisions = db.prepare(
    `SELECT materialized_target_id, decided_payload_json, evidence_id, evidence_role
     FROM archive_proposal_decisions d
     JOIN archive_entity_proposals p ON p.proposal_id=d.proposal_id
     WHERE d.decision='accepted' AND d.materialized_target_kind='event'
       AND p.proposal_kind IN ('date', 'event')`
  ).all() as DateDecisionRow[];

  const timelineEvents: PrimarySourceTimelineEvent[] = events.map((event) => {
    const traces = targetEvidence(evidence, 'event', event.event_id);
    const alternatives = dateDecisions.flatMap((decision) => {
      if (decision.materialized_target_id !== event.event_id || !decision.evidence_id) return [];
      const payload = parseObject(decision.decided_payload_json);
      const dateDisplay = typeof payload?.date === 'string'
        ? payload.date.trim()
        : typeof payload?.dateDisplay === 'string'
          ? payload.dateDisplay.trim()
          : '';
      return dateDisplay
        ? [{
          dateDisplay,
          role: decision.evidence_role ?? 'supports' as PrimarySourceEvidenceRole,
          evidenceId: decision.evidence_id,
        }]
        : [];
    });
    const distinctDates = new Set([
      ...(event.date ? [event.date.trim().toLocaleLowerCase()] : []),
      ...alternatives.map((entry) => entry.dateDisplay.toLocaleLowerCase()),
    ]);
    return {
      eventId: event.event_id,
      type: event.type,
      label: event.label?.trim() || event.type,
      dateDisplay: event.date,
      dateStartSort: event.date_sort,
      dateEndSort: event.date_end_sort,
      dateCertainty: event.date_certainty,
      reviewStatus: event.review_status,
      placeId: event.place_id,
      placeName: event.place_name,
      notes: event.notes,
      participants: participants
        .filter((participant) => participant.event_id === event.event_id)
        .map((participant) => ({
          personId: participant.person_id,
          displayName: participant.display_name,
          role: participant.role,
        })),
      evidence: traces,
      sourceIds: [...new Set(traces.map((trace) => trace.itemId))],
      repositoryNames: [...new Set(traces.flatMap((trace) =>
        trace.repositoryName ? [trace.repositoryName] : []
      ))],
      hypothesis: traces.length === 0,
      hasContradiction: traces.some((trace) => trace.role === 'contradicts') || distinctDates.size > 1,
      dateAlternatives: alternatives,
    };
  });

  const documented = timelineEvents.filter((event) => !event.hypothesis);
  const personOptions = new Map<string, string>();
  const placeOptions = new Map<string, string>();
  for (const event of documented) {
    for (const person of event.participants) personOptions.set(person.personId, person.displayName);
    if (event.placeId && event.placeName) placeOptions.set(event.placeId, event.placeName);
  }
  return {
    events: timelineEvents,
    sources: uniqueOptions(evidence.filter((entry) => entry.targetKind === 'event')),
    repositories: [...new Set(timelineEvents.flatMap((event) => event.repositoryNames))]
      .sort()
      .map((label) => ({ id: label, label })),
    persons: [...personOptions].map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    places: [...placeOptions].map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    eventTypes: [...new Set(documented.map((event) => event.type))].sort(),
  };
}

type ResolutionRow = {
  resolution_id: string;
  place_id: string;
  mention_id: string | null;
  selected_candidate_json: string;
  alternatives_json: string;
  coordinate_precision: string | null;
  historical_context: string | null;
  valid_from_display: string | null;
  valid_to_display: string | null;
  rationale: string | null;
  status: PrimarySourcePlaceResolutionDecision['status'];
  created_by: string | null;
  created_at: string;
  reverted_at: string | null;
};

function resolutionFromRow(row: ResolutionRow): PrimarySourcePlaceResolutionDecision {
  return {
    resolutionId: row.resolution_id,
    placeId: row.place_id,
    mentionId: row.mention_id,
    selectedCandidate: parseCandidate(row.selected_candidate_json),
    alternatives: parseCandidates(row.alternatives_json),
    coordinatePrecision: row.coordinate_precision,
    historicalContext: row.historical_context,
    validFromDisplay: row.valid_from_display,
    validToDisplay: row.valid_to_display,
    rationale: row.rationale,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    revertedAt: row.reverted_at,
  };
}

type PlaceMentionRow = {
  mention_id: string;
  item_id: string;
  excerpt_id: string | null;
  place_id: string;
  original_label: string;
  role: PrimarySourceMapRole;
  certainty: number | null;
  mention_status: PrimarySourceMapPoint['resolutionStatus'];
  name: string;
  latitude: number | null;
  longitude: number | null;
  coordinate_precision: string | null;
  historical_context: string | null;
  valid_from_display: string | null;
  valid_to_display: string | null;
  authority_json: string | null;
  sensitivity: PrimarySourceMapPoint['sensitivity'];
};

function layerForRole(role: PrimarySourceMapRole): PrimarySourceMapLayer {
  if (role === 'event' || role === 'event_location') return 'events';
  if (role === 'route_origin' || role === 'route_destination') return 'movements';
  if (role === 'repository') return 'repositories';
  if (role === 'custody') return 'custody';
  if (role === 'consultation') return 'consultation';
  if (role === 'physical_location') return 'physical';
  return 'mentions';
}

function safeCoordinates(
  latitude: number | null,
  longitude: number | null,
  sensitivity: PrimarySourceMapPoint['sensitivity']
): { latitude: number | null; longitude: number | null } {
  if (sensitivity === 'highly_sensitive') return { latitude: null, longitude: null };
  if (latitude === null || longitude === null) return { latitude, longitude };
  if (sensitivity === 'personal' || sensitivity === 'sensitive') {
    return {
      latitude: Math.round(latitude * 100) / 100,
      longitude: Math.round(longitude * 100) / 100,
    };
  }
  return { latitude, longitude };
}

export function getPrimarySourceMapWorkspace(): PrimarySourceMapWorkspace {
  const db = getDb();
  const evidence = allEvidence();
  const metadataBySource = sourceMetadata();
  const personMentions = db.prepare(
    `SELECT m.item_id, m.excerpt_id, m.person_id, p.display_name
     FROM archive_person_mentions m
     JOIN persons p ON p.person_id=m.person_id
     WHERE m.person_id IS NOT NULL`
  ).all() as Array<{
    item_id: string; excerpt_id: string | null; person_id: string; display_name: string;
  }>;
  const personLabels = new Map(personMentions.map((mention) => [mention.person_id, mention.display_name]));
  const resolutionRows = db.prepare(
    `SELECT * FROM archive_place_resolution_decisions
     WHERE status='active' ORDER BY created_at DESC`
  ).all() as ResolutionRow[];
  const resolutions = new Map(
    resolutionRows.map((row) => [row.place_id, resolutionFromRow(row)])
  );
  const mentions = db.prepare(
    `SELECT m.mention_id, m.item_id, m.excerpt_id, m.place_id, m.original_label,
      m.role, m.certainty, m.status AS mention_status, p.name, p.latitude,
      p.longitude, p.coordinate_precision, p.historical_context,
      p.valid_from_display, p.valid_to_display, p.authority_json, p.sensitivity
     FROM archive_place_mentions m
     JOIN places p ON p.place_id=m.place_id
     ORDER BY m.created_at`
  ).all() as PlaceMentionRow[];

  const points: PrimarySourceMapPoint[] = mentions.map((mention) => {
    const placeEvidence = targetEvidence(evidence, 'place', mention.place_id)
      .filter((trace) =>
        (mention.excerpt_id && trace.excerptId === mention.excerpt_id)
        || (!mention.excerpt_id && trace.itemId === mention.item_id)
      );
    const coordinates = safeCoordinates(
      mention.latitude,
      mention.longitude,
      mention.sensitivity
    );
    // A place explicitly attached by the researcher is already a resolved
    // documentary assertion. It must remain visible even before the researcher
    // creates a quotable excerpt, and it must participate in source filters.
    const sourceIds = [...new Set([
      mention.item_id,
      ...placeEvidence.map((trace) => trace.itemId),
    ])];
    const sourceMetadataRows = sourceIds.flatMap((id) => {
      const metadata = metadataBySource.get(id);
      return metadata ? [metadata] : [];
    });
    const personIds = [...new Set(personMentions
      .filter((person) =>
        (mention.excerpt_id && person.excerpt_id === mention.excerpt_id)
        || (!mention.excerpt_id && person.item_id === mention.item_id)
      )
      .map((person) => person.person_id))];
    return {
      pointId: `mention:${mention.mention_id}`,
      placeId: mention.place_id,
      mentionId: mention.mention_id,
      eventId: null,
      originalLabel: mention.original_label,
      normalizedName: mention.name,
      role: mention.role,
      layer: layerForRole(mention.role),
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      coordinatePrecision: mention.coordinate_precision,
      authority: parseObject(mention.authority_json),
      historicalContext: mention.historical_context,
      validFromDisplay: mention.valid_from_display,
      validToDisplay: mention.valid_to_display,
      dateDisplay: null,
      dateStartSort: null,
      dateEndSort: null,
      certainty: mention.certainty,
      resolutionStatus: mention.mention_status,
      sensitivity: mention.sensitivity,
      hypothesis: mention.mention_status !== 'resolved' && placeEvidence.length === 0,
      evidence: placeEvidence,
      sourceIds,
      personIds,
      eventType: null,
      sourceTypes: [...new Set(sourceMetadataRows.map((metadata) => metadata.sourceType))],
      repositoryNames: [...new Set(sourceMetadataRows.flatMap((metadata) => [...metadata.repositories]))],
      collectionIds: [...new Set(sourceMetadataRows.flatMap((metadata) => [...metadata.collections.keys()]))],
      resolution: resolutions.get(mention.place_id) ?? null,
    };
  });

  for (const event of getPrimarySourceTimelineWorkspace().events) {
    if (!event.placeId || !event.placeName) continue;
    const place = db.prepare(
      `SELECT latitude, longitude, coordinate_precision, historical_context,
        valid_from_display, valid_to_display, authority_json, sensitivity
       FROM places WHERE place_id=?`
    ).get(event.placeId) as {
      latitude: number | null; longitude: number | null;
      coordinate_precision: string | null; historical_context: string | null;
      valid_from_display: string | null; valid_to_display: string | null;
      authority_json: string | null; sensitivity: PrimarySourceMapPoint['sensitivity'];
    } | undefined;
    if (!place) continue;
    const coordinates = safeCoordinates(place.latitude, place.longitude, place.sensitivity);
    const sourceMetadataRows = event.sourceIds.flatMap((id) => {
      const metadata = metadataBySource.get(id);
      return metadata ? [metadata] : [];
    });
    for (const person of event.participants) personLabels.set(person.personId, person.displayName);
    points.push({
      pointId: `event:${event.eventId}`,
      placeId: event.placeId,
      mentionId: null,
      eventId: event.eventId,
      originalLabel: event.placeName,
      normalizedName: event.placeName,
      role: 'event_location',
      layer: 'events',
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      coordinatePrecision: place.coordinate_precision,
      authority: parseObject(place.authority_json),
      historicalContext: place.historical_context,
      validFromDisplay: place.valid_from_display,
      validToDisplay: place.valid_to_display,
      dateDisplay: event.dateDisplay,
      dateStartSort: event.dateStartSort,
      dateEndSort: event.dateEndSort,
      certainty: event.evidence[0]?.certainty ?? null,
      resolutionStatus: place.latitude === null ? 'unresolved' : 'resolved',
      sensitivity: place.sensitivity,
      hypothesis: event.hypothesis,
      evidence: event.evidence,
      sourceIds: event.sourceIds,
      personIds: event.participants.map((person) => person.personId),
      eventType: event.type,
      sourceTypes: [...new Set(sourceMetadataRows.map((metadata) => metadata.sourceType))],
      repositoryNames: [...new Set(sourceMetadataRows.flatMap((metadata) => [...metadata.repositories]))],
      collectionIds: [...new Set(sourceMetadataRows.flatMap((metadata) => [...metadata.collections.keys()]))],
      resolution: resolutions.get(event.placeId) ?? null,
    });
  }

  const confirmedEvidence = points.flatMap((point) => point.evidence);
  const pointSourceIds = new Set(points.flatMap((point) => point.sourceIds));
  const collectionLabels = new Map<string, string>();
  for (const sourceId of pointSourceIds) {
    for (const [id, label] of metadataBySource.get(sourceId)?.collections ?? []) {
      collectionLabels.set(id, label);
    }
  }
  const eventLabels = new Map(
    getPrimarySourceTimelineWorkspace().events
      .filter((event) => points.some((point) => point.eventId === event.eventId))
      .map((event) => [event.eventId, event.label])
  );
  return {
    points,
    sources: uniqueOptions(confirmedEvidence),
    persons: [...new Set(points.flatMap((point) => point.personIds))]
      .flatMap((id) => personLabels.has(id) ? [{ id, label: personLabels.get(id)! }] : [])
      .sort((a, b) => a.label.localeCompare(b.label)),
    events: [...eventLabels].map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    sourceTypes: [...new Set(points.flatMap((point) => point.sourceTypes))].sort(),
    repositories: [...new Set(points.flatMap((point) => point.repositoryNames))]
      .sort().map((label) => ({ id: label, label })),
    collections: [...collectionLabels].map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    roles: [...new Set(points.map((point) => point.role))].sort(),
    layers: [...new Set(points.map((point) => point.layer))].sort(),
  };
}

function validateCandidate(candidate: GazetteerPlace): void {
  if (
    !candidate.gazetteerId?.trim()
    || !candidate.name?.trim()
    || !Number.isFinite(candidate.latitude)
    || !Number.isFinite(candidate.longitude)
    || candidate.latitude < -90
    || candidate.latitude > 90
    || candidate.longitude < -180
    || candidate.longitude > 180
  ) throw new Error('El candidato geográfico no es válido.');
}

export function resolvePrimarySourceToponym(
  input: PrimarySourceToponymResolutionInput
): PrimarySourcePlaceResolutionDecision {
  validateCandidate(input.selectedCandidate);
  for (const candidate of input.alternatives ?? []) validateCandidate(candidate);
  const db = getDb();
  return db.transaction(() => {
    const place = db.prepare(
      `SELECT place_id, name, kind, latitude, longitude, gazetteer_id, admin1,
        country, country_code, coordinate_precision, historical_context,
        valid_from_display, valid_to_display, authority_json, sensitivity
       FROM places WHERE place_id=?`
    ).get(input.placeId) as Record<string, unknown> | undefined;
    if (!place) throw new Error('El lugar ya no existe.');
    let itemId: string | null = null;
    if (input.mentionId) {
      const mention = db.prepare(
        'SELECT item_id, place_id FROM archive_place_mentions WHERE mention_id=?'
      ).get(input.mentionId) as { item_id: string; place_id: string | null } | undefined;
      if (!mention || mention.place_id !== input.placeId) {
        throw new Error('La mención no pertenece al lugar que se intenta resolver.');
      }
      itemId = mention.item_id;
    }
    const ts = now();
    db.prepare(
      `UPDATE archive_place_resolution_decisions
       SET status='reverted', reverted_at=?
       WHERE place_id=? AND status='active'`
    ).run(ts, input.placeId);
    const resolutionId = `aprd_${randomUUID()}`;
    const authority = {
      provider: 'offline_gazetteer',
      gazetteerId: input.selectedCandidate.gazetteerId,
      name: input.selectedCandidate.name,
      admin1: input.selectedCandidate.admin1,
      country: input.selectedCandidate.country,
      countryCode: input.selectedCandidate.countryCode,
    };
    // The general genealogy map may already have materialized this gazetteer
    // candidate as another place row. Keep the documentary place and its evidence
    // stable; the authority ledger carries the selected id while the unique
    // gazetteer column remains owned by the pre-existing canonical row.
    const occupied = db.prepare(
      'SELECT place_id FROM places WHERE gazetteer_id=? AND place_id<>?'
    ).get(input.selectedCandidate.gazetteerId, input.placeId) as { place_id: string } | undefined;
    if (occupied) {
      Object.assign(authority, { canonicalPlaceId: occupied.place_id });
    }
    db.prepare(
      `INSERT INTO archive_place_resolution_decisions (
        resolution_id, place_id, mention_id, selected_candidate_json,
        alternatives_json, previous_place_json, coordinate_precision,
        historical_context, valid_from_display, valid_to_display, rationale,
        status, created_by, created_at, reverted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`
    ).run(
      resolutionId,
      input.placeId,
      input.mentionId ?? null,
      JSON.stringify(input.selectedCandidate),
      JSON.stringify((input.alternatives ?? []).filter(
        (candidate) => candidate.gazetteerId !== input.selectedCandidate.gazetteerId
      )),
      JSON.stringify(place),
      input.coordinatePrecision ?? 'locality',
      input.historicalContext ?? null,
      input.validFromDisplay ?? null,
      input.validToDisplay ?? null,
      input.rationale ?? null,
      input.createdBy ?? 'primary_sources_user',
      ts
    );
    db.prepare(
      `UPDATE places SET name=?, kind=COALESCE(kind, 'municipality'),
        latitude=?, longitude=?, gazetteer_id=?, admin1=?, country=?,
        country_code=?, coordinate_precision=?, historical_context=?,
        valid_from_display=?, valid_to_display=?, authority_json=?, updated_at=?
       WHERE place_id=?`
    ).run(
      input.selectedCandidate.name,
      input.selectedCandidate.latitude,
      input.selectedCandidate.longitude,
      occupied ? null : input.selectedCandidate.gazetteerId,
      input.selectedCandidate.admin1 || null,
      input.selectedCandidate.country || null,
      input.selectedCandidate.countryCode || null,
      input.coordinatePrecision ?? 'locality',
      input.historicalContext ?? null,
      input.validFromDisplay ?? null,
      input.validToDisplay ?? null,
      JSON.stringify(authority),
      ts,
      input.placeId
    );
    if (input.mentionId) {
      db.prepare(
        "UPDATE archive_place_mentions SET status='resolved', updated_at=? WHERE mention_id=?"
      ).run(ts, input.mentionId);
    }
    if (itemId) {
      recordArchiveAudit({
        itemId,
        action: 'toponym_resolved',
        createdBy: input.createdBy ?? 'primary_sources_user',
        details: {
          resolutionId,
          placeId: input.placeId,
          mentionId: input.mentionId ?? null,
          selectedGazetteerId: input.selectedCandidate.gazetteerId,
          discardedAlternatives: Math.max(0, (input.alternatives ?? []).length - 1),
        },
      });
    }
    return resolutionFromRow(
      db.prepare('SELECT * FROM archive_place_resolution_decisions WHERE resolution_id=?')
        .get(resolutionId) as ResolutionRow
    );
  })();
}

export function revertPrimarySourceToponymResolution(
  resolutionId: string
): PrimarySourcePlaceResolutionDecision | null {
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare(
      'SELECT * FROM archive_place_resolution_decisions WHERE resolution_id=?'
    ).get(resolutionId) as (ResolutionRow & { previous_place_json: string }) | undefined;
    if (!row) return null;
    if (row.status === 'reverted') return resolutionFromRow(row);
    const previous = parseObject(row.previous_place_json);
    if (!previous) throw new Error('No se puede recuperar el estado geográfico anterior.');
    const ts = now();
    db.prepare(
      `UPDATE places SET name=?, kind=?, latitude=?, longitude=?, gazetteer_id=?,
        admin1=?, country=?, country_code=?, coordinate_precision=?,
        historical_context=?, valid_from_display=?, valid_to_display=?,
        authority_json=?, sensitivity=?, updated_at=? WHERE place_id=?`
    ).run(
      previous.name ?? '',
      previous.kind ?? null,
      previous.latitude ?? null,
      previous.longitude ?? null,
      previous.gazetteer_id ?? null,
      previous.admin1 ?? null,
      previous.country ?? null,
      previous.country_code ?? null,
      previous.coordinate_precision ?? null,
      previous.historical_context ?? null,
      previous.valid_from_display ?? null,
      previous.valid_to_display ?? null,
      previous.authority_json ?? null,
      previous.sensitivity ?? 'normal',
      ts,
      row.place_id
    );
    db.prepare(
      "UPDATE archive_place_resolution_decisions SET status='reverted', reverted_at=? WHERE resolution_id=?"
    ).run(ts, resolutionId);
    let itemId: string | null = null;
    if (row.mention_id) {
      const previousResolved = Boolean(previous.gazetteer_id && previous.latitude !== null);
      db.prepare(
        'UPDATE archive_place_mentions SET status=?, updated_at=? WHERE mention_id=?'
      ).run(previousResolved ? 'resolved' : 'unresolved', ts, row.mention_id);
      itemId = (db.prepare(
        'SELECT item_id FROM archive_place_mentions WHERE mention_id=?'
      ).get(row.mention_id) as { item_id: string } | undefined)?.item_id ?? null;
    }
    if (itemId) {
      recordArchiveAudit({
        itemId,
        action: 'toponym_resolution_reverted',
        createdBy: 'primary_sources_user',
        details: { resolutionId, placeId: row.place_id, mentionId: row.mention_id },
      });
    }
    return resolutionFromRow(
      db.prepare('SELECT * FROM archive_place_resolution_decisions WHERE resolution_id=?')
        .get(resolutionId) as ResolutionRow
    );
  })();
}

type PersonNodeRow = {
  person_id: string;
  display_name: string;
  identity_status: string;
};

export function getPrimarySourceRelationsWorkspace(): PrimarySourceRelationsWorkspace {
  const db = getDb();
  const evidence = allEvidence();
  const people = db.prepare(
    'SELECT person_id, display_name, identity_status FROM persons'
  ).all() as PersonNodeRow[];
  const personById = new Map(people.map((person) => [person.person_id, person]));
  const edges: PrimarySourceRelationEdge[] = [];

  const kinship = db.prepare(
    `SELECT rel_id, from_person, to_person, type, notes
     FROM relationships ORDER BY created_at`
  ).all() as Array<{
    rel_id: string; from_person: string; to_person: string; type: string; notes: string | null;
  }>;
  for (const relation of kinship) {
    const traces = targetEvidence(evidence, 'relationship', relation.rel_id);
    const from = personById.get(relation.from_person);
    const to = personById.get(relation.to_person);
    if (!from || !to) continue;
    edges.push({
      edgeId: relation.rel_id,
      edgeKind: 'kinship',
      fromId: relation.from_person,
      toId: relation.to_person,
      fromName: from.display_name,
      toName: to.display_name,
      relationType: relation.type,
      historicalLabel: relation.type,
      direction: relation.type === 'parent' ? 'directed' : 'undirected',
      dateDisplay: null,
      dateStartSort: null,
      dateEndSort: null,
      certainty: traces[0]?.certainty ?? null,
      status: traces.length ? 'confirmed' : 'proposal',
      notes: relation.notes,
      hypothesis: traces.length === 0,
      hasContradiction: traces.some((trace) => trace.role === 'contradicts'),
      evidence: traces,
      sourceIds: [...new Set(traces.map((trace) => trace.itemId))],
    });
  }

  const social = db.prepare(
    `SELECT sr.relation_id, sr.person_id, sr.target_kind, sr.target_id,
      sr.role, sr.notes, sr.status, sr.certainty, sr.date_display,
      sr.date_start_sort, sr.date_end_sort, sr.direction,
      COALESCE(tp.display_name, sc.display_name, '?') AS target_name
     FROM social_relations sr
     LEFT JOIN persons tp
       ON sr.target_kind='person' AND tp.person_id=sr.target_id
     LEFT JOIN social_contacts sc
       ON sr.target_kind='contact' AND sc.contact_id=sr.target_id
     ORDER BY sr.created_at`
  ).all() as Array<{
    relation_id: string; person_id: string; target_kind: 'person' | 'contact';
    target_id: string; role: string; notes: string | null;
    status: 'proposal' | 'confirmed' | 'rejected'; certainty: number | null;
    date_display: string | null; date_start_sort: string | null;
    date_end_sort: string | null; direction: 'directed' | 'undirected' | 'mutual';
    target_name: string;
  }>;
  for (const relation of social) {
    const traces = targetEvidence(evidence, 'social_relation', relation.relation_id);
    const from = personById.get(relation.person_id);
    if (!from) continue;
    edges.push({
      edgeId: relation.relation_id,
      edgeKind: 'social',
      fromId: relation.person_id,
      toId: relation.target_id,
      fromName: from.display_name,
      toName: relation.target_name,
      relationType: relation.role,
      historicalLabel: relation.role,
      direction: relation.direction,
      dateDisplay: relation.date_display,
      dateStartSort: relation.date_start_sort,
      dateEndSort: relation.date_end_sort,
      certainty: relation.certainty,
      status: relation.status === 'confirmed' && traces.length ? 'confirmed' : 'proposal',
      notes: relation.notes,
      hypothesis: relation.status !== 'confirmed' || traces.length === 0,
      hasContradiction: traces.some((trace) => trace.role === 'contradicts'),
      evidence: traces,
      sourceIds: [...new Set(traces.map((trace) => trace.itemId))],
    });
  }

  const nodeIds = new Set(edges.flatMap((edge) => [edge.fromId, edge.toId]));
  const nodes: PrimarySourceRelationNode[] = people
    .filter((person) => nodeIds.has(person.person_id))
    .map((person) => ({
      nodeId: person.person_id,
      displayName: person.display_name,
      status: person.identity_status === 'provisional' ? 'provisional' : 'confirmed',
    }));
  for (const relation of social) {
    if (
      relation.target_kind === 'contact'
      && nodeIds.has(relation.target_id)
      && !nodes.some((node) => node.nodeId === relation.target_id)
    ) {
      nodes.push({
        nodeId: relation.target_id,
        displayName: relation.target_name,
        status: 'contact',
      });
    }
  }
  return {
    nodes,
    edges,
    sources: uniqueOptions(edges.flatMap((edge) => edge.evidence)),
    relationTypes: [...new Set(edges.filter((edge) => !edge.hypothesis).map((edge) => edge.relationType))]
      .sort(),
  };
}
