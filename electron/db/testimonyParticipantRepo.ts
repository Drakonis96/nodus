// Participantes del vault de Testimonios: la capa de historia oral sobre `persons`.
//
// SE REUTILIZA LA ONTOLOGÍA DE PERSONAS, NO SU INTERFAZ. Un narrador tiene nombre y
// variantes como cualquier persona del sistema, así que la fila vive en `persons` y
// viaja con el resto. Lo que NO se reutiliza es el vocabulario genealógico —
// parentescos, GEDCOM, coincidencias, identificador nacional— porque no significa nada
// en una entrevista y su presencia empujaría al investigador a rellenar campos que
// convierten un archivo de testimonios en una base de datos de personas.
//
// MINIMIZACIÓN DE DATOS, EXPLÍCITA. No hay teléfono, ni correo, ni dirección, y no es un
// olvido: en cuanto existe un campo de contacto, un vault local sin cifrado obligatorio
// pasa a custodiar datos personales de terceros que nadie pidió guardar ahí. Si algún día
// se añaden, tendrán que vivir en una zona privada excluida de IA, búsqueda semántica y
// exportación por omisión.

import { getDb } from './database';
import { addPersonName, createPerson, deletePerson, getPerson, listPersons, updatePerson } from './entitiesRepo';
import { displayNameFor } from '@shared/testimonies';
import type {
  TestimonyIdentityMode,
  TestimonyParticipantInput,
  TestimonyParticipantProfile,
  TestimonyParticipantRole,
  TestimonyParticipantRow,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

interface ProfileRow {
  person_id: string;
  public_name: string | null;
  identity_mode: TestimonyIdentityMode;
  pronunciation: string | null;
  biographical_note: string | null;
  attribution_note: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProfile(row: ProfileRow, workingName: string): TestimonyParticipantProfile {
  return {
    personId: row.person_id,
    workingName,
    publicName: row.public_name,
    identityMode: row.identity_mode,
    pronunciation: row.pronunciation,
    biographicalNote: row.biographical_note,
    attributionNote: row.attribution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * El perfil de una persona, existiendo o no la fila del overlay.
 *
 * Una persona sin overlay es normal — puede venir de una importación o de otro vault — y
 * su modo por omisión es `identified`. Devolver null obligaría a cada pantalla a decidir
 * qué hacer con el hueco, y la decisión sobre un nombre no puede quedar repartida.
 */
export function getParticipantProfile(personId: string): TestimonyParticipantProfile | null {
  const person = getPerson(personId);
  if (!person) return null;
  const row = getDb()
    .prepare('SELECT * FROM testimony_participant_profiles WHERE person_id = ?')
    .get(personId) as ProfileRow | undefined;
  if (row) return rowToProfile(row, person.displayName);
  return {
    personId,
    workingName: person.displayName,
    publicName: null,
    identityMode: 'identified',
    pronunciation: null,
    biographicalNote: null,
    attributionNote: null,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
  };
}

export function createParticipant(input: TestimonyParticipantInput): TestimonyParticipantProfile {
  const workingName = input.workingName.trim();
  if (!workingName) throw new Error('El nombre de trabajo es obligatorio.');
  const db = getDb();
  let personId = '';
  const tx = db.transaction(() => {
    const person = createPerson({ displayName: workingName });
    personId = person.personId;
    for (const variant of input.nameVariants ?? []) addPersonName(personId, variant, 'variant');
    upsertProfileRow(personId, input);
  });
  tx();
  return getParticipantProfile(personId)!;
}

function upsertProfileRow(personId: string, input: Partial<TestimonyParticipantInput>): void {
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO testimony_participant_profiles
        (person_id, public_name, identity_mode, pronunciation, biographical_note, attribution_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id) DO UPDATE SET
         public_name = excluded.public_name,
         identity_mode = excluded.identity_mode,
         pronunciation = excluded.pronunciation,
         biographical_note = excluded.biographical_note,
         attribution_note = excluded.attribution_note,
         updated_at = excluded.updated_at`
    )
    .run(
      personId,
      input.publicName?.trim() || null,
      input.identityMode ?? 'identified',
      input.pronunciation?.trim() || null,
      input.biographicalNote ?? null,
      input.attributionNote ?? null,
      ts,
      ts
    );
}

export function updateParticipant(personId: string, patch: Partial<TestimonyParticipantInput>): TestimonyParticipantProfile | null {
  const existing = getParticipantProfile(personId);
  if (!existing) return null;
  const db = getDb();
  const tx = db.transaction(() => {
    if (patch.workingName !== undefined && patch.workingName.trim()) {
      updatePerson(personId, { displayName: patch.workingName.trim() });
    }
    upsertProfileRow(personId, {
      publicName: patch.publicName !== undefined ? patch.publicName : existing.publicName,
      identityMode: patch.identityMode ?? existing.identityMode,
      pronunciation: patch.pronunciation !== undefined ? patch.pronunciation : existing.pronunciation,
      biographicalNote: patch.biographicalNote !== undefined ? patch.biographicalNote : existing.biographicalNote,
      attributionNote: patch.attributionNote !== undefined ? patch.attributionNote : existing.attributionNote,
    });
    for (const variant of patch.nameVariants ?? []) addPersonName(personId, variant, 'variant');
  });
  tx();
  return getParticipantProfile(personId);
}

/**
 * Borrar un participante. Solo se permite si no participa en ninguna entrevista: quitarlo
 * de en medio dejaría entrevistas sin narrador, y una entrevista sin saber quién habla es
 * material sin procedencia, que en historia oral equivale a material perdido.
 */
export function deleteParticipant(personId: string): void {
  const count = (getDb()
    .prepare('SELECT COUNT(*) AS n FROM testimony_interview_participants WHERE person_id = ?')
    .get(personId) as { n: number }).n;
  if (count > 0) {
    throw new Error('Esta persona participa en entrevistas. Quítala de ellas antes de eliminarla.');
  }
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM testimony_participant_profiles WHERE person_id = ?').run(personId);
    deletePerson(personId);
  });
  tx();
}

/** La tabla de Participantes. Ordenada por nombre de trabajo, que es como se busca. */
export function listParticipantRows(search = ''): TestimonyParticipantRow[] {
  const db = getDb();
  const persons = listPersons({ search });
  if (persons.length === 0) return [];
  const ids = persons.map((person) => person.personId);
  const marks = ids.map(() => '?').join(',');

  const profiles = new Map<string, ProfileRow>();
  for (const row of db
    .prepare(`SELECT * FROM testimony_participant_profiles WHERE person_id IN (${marks})`)
    .all(...ids) as ProfileRow[]) {
    profiles.set(row.person_id, row);
  }

  const roles = new Map<string, Set<TestimonyParticipantRole>>();
  const interviews = new Map<string, { count: number; last: string | null; pending: number }>();
  for (const row of db
    .prepare(
      `SELECT ip.person_id AS person_id, ip.role AS role, i.id AS interview_id,
              COALESCE(i.conducted_at, i.scheduled_at) AS at,
              COALESCE(ag.status, 'pending') AS agreement_status
         FROM testimony_interview_participants ip
         JOIN testimony_interviews i ON i.id = ip.interview_id AND i.deleted_at IS NULL
         LEFT JOIN testimony_agreements ag ON ag.interview_id = i.id AND ag.is_current = 1
        WHERE ip.person_id IN (${marks})`
    )
    .all(...ids) as { person_id: string; role: TestimonyParticipantRole; interview_id: string; at: string | null; agreement_status: string }[]) {
    const set = roles.get(row.person_id) ?? new Set<TestimonyParticipantRole>();
    set.add(row.role);
    roles.set(row.person_id, set);
    const entry = interviews.get(row.person_id) ?? { count: 0, last: null, pending: 0 };
    entry.count += 1;
    if (row.at && (!entry.last || row.at > entry.last)) entry.last = row.at;
    if (row.agreement_status === 'pending' || row.agreement_status === 'update_required') entry.pending += 1;
    interviews.set(row.person_id, entry);
  }

  const notes = new Map<string, number>();
  for (const row of db
    .prepare(
      `SELECT target_id, COUNT(*) AS n FROM note_links
        WHERE target_kind = 'testimony_participant' AND target_id IN (${marks}) GROUP BY target_id`
    )
    .all(...ids) as { target_id: string; n: number }[]) {
    notes.set(row.target_id, row.n);
  }

  return persons
    .map((person) => {
      const profile = profiles.get(person.personId);
      const stats = interviews.get(person.personId) ?? { count: 0, last: null, pending: 0 };
      return {
        personId: person.personId,
        workingName: person.displayName,
        publicName: profile?.public_name ?? null,
        identityMode: profile?.identity_mode ?? 'identified',
        pronunciation: profile?.pronunciation ?? null,
        biographicalNote: profile?.biographical_note ?? null,
        attributionNote: profile?.attribution_note ?? null,
        createdAt: profile?.created_at ?? person.createdAt,
        updatedAt: profile?.updated_at ?? person.updatedAt,
        roles: [...(roles.get(person.personId) ?? [])],
        interviewCount: stats.count,
        lastInterviewAt: stats.last,
        pendingAgreements: stats.pending,
        noteCount: notes.get(person.personId) ?? 0,
      } satisfies TestimonyParticipantRow;
    })
    // La tabla de Participantes lista a quien PARTICIPA. Una persona sin entrevistas
    // aparece igualmente (se dio de alta para una futura), pero las importadas de otro
    // vault sin perfil ni participación no tienen nada que hacer en esta pantalla.
    .filter((row) => row.interviewCount > 0 || profiles.has(row.personId));
}

/** Las entrevistas en las que participa una persona, con su papel en cada una. */
export function participantInterviews(personId: string): { interviewId: string; title: string; shortId: string; role: TestimonyParticipantRole; at: string | null; workflowStatus: string; accessLevel: string }[] {
  return getDb()
    .prepare(
      `SELECT i.id AS interviewId, i.title AS title, i.short_id AS shortId, ip.role AS role,
              COALESCE(i.conducted_at, i.scheduled_at) AS at, i.workflow_status AS workflowStatus,
              COALESCE(ag.access_level, 'private') AS accessLevel
         FROM testimony_interview_participants ip
         JOIN testimony_interviews i ON i.id = ip.interview_id AND i.deleted_at IS NULL
         LEFT JOIN testimony_agreements ag ON ag.interview_id = i.id AND ag.is_current = 1
        WHERE ip.person_id = ?
        ORDER BY at DESC NULLS LAST, i.title`
    )
    .all(personId) as { interviewId: string; title: string; shortId: string; role: TestimonyParticipantRole; at: string | null; workflowStatus: string; accessLevel: string }[];
}

/**
 * El nombre con el que puede aparecer esta persona en una entrevista concreta.
 *
 * Existe como función y no como campo porque la respuesta DEPENDE DE LA ENTREVISTA: la
 * misma persona puede haber autorizado su nombre real en una y pedido seudónimo en otra,
 * y guardar «su nombre público» en la ficha borraría esa diferencia.
 */
export function displayNameInInterview(personId: string, attribution: 'real_name' | 'public_name' | 'anonymous'): string {
  const profile = getParticipantProfile(personId);
  if (!profile) return '';
  return displayNameFor(
    { workingName: profile.workingName, publicName: profile.publicName, identityMode: profile.identityMode },
    attribution
  );
}
