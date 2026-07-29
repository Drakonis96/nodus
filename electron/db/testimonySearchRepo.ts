// Buscar dentro de un vault de Testimonios, y el tablero de Inicio.
//
// LA BÚSQUEDA ES LOCAL Y TEXTUAL, sobre SQLite, coherente con `globalSearch`. No hay
// índice FTS5 todavía y es una decisión medida, no una carencia: un índice es una segunda
// copia del texto que puede quedarse desincronizada, y hasta que el corpus de referencia
// (250 entrevistas, 2,5 millones de palabras) demuestre que hace falta, la fuente
// canónica es la única copia. Si se añade, será reconstruible y nunca canónico.
//
// LA BÚSQUEDA SEMÁNTICA NO ESTÁ, y tampoco por descuido: crear embeddings de una
// entrevista es sacar su contenido del texto plano y meterlo en un derivado que puede
// viajar a un proveedor remoto según la configuración. Eso pasa por la puerta de acceso
// (`embeddingIndex`), y hasta que ese camino esté cerrado de punta a punta, buscar es
// buscar palabras.
//
// EL TABLERO NO INVENTA AVISOS. Cada alerta corresponde a una fila que existe y se puede
// abrir; un panel que enseña avisos que no llevan a ninguna parte enseña al usuario a no
// mirarlo, y esa costumbre no se deshace luego.

import { getDb } from './database';
import { displayNameFor, isClosedStatus } from '@shared/testimonies';
import { daysUntilEmbargoEnds, effectiveAttribution, isEmbargoActive } from '@shared/testimonyAccess';
import type {
  TestimonyAlert,
  TestimonyAlertKind,
  TestimonyDashboard,
  TestimonySearchHit,
  TestimonySearchKind,
} from '@shared/types';

const ALL_KINDS: TestimonySearchKind[] = ['interview', 'participant', 'segment', 'code', 'note', 'contrast'];

/** Un extracto centrado en la coincidencia, no los primeros 200 caracteres del tramo. */
function snippetAround(text: string, query: string, radius = 90): string {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + query.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export function searchTestimonies(query: string, kinds: TestimonySearchKind[] = ALL_KINDS): TestimonySearchHit[] {
  const term = query.trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;
  const db = getDb();
  const wanted = new Set(kinds);
  const hits: TestimonySearchHit[] = [];

  if (wanted.has('interview')) {
    for (const row of db
      .prepare(
        `SELECT id, short_id, title, abstract, objective FROM testimony_interviews
          WHERE deleted_at IS NULL AND (title LIKE ? OR short_id LIKE ? OR COALESCE(abstract, '') LIKE ? OR COALESCE(objective, '') LIKE ?)
          ORDER BY updated_at DESC LIMIT 40`
      )
      .all(like, like, like, like) as { id: string; short_id: string; title: string; abstract: string | null; objective: string | null }[]) {
      hits.push({
        kind: 'interview',
        id: row.id,
        title: `${row.short_id} · ${row.title}`,
        snippet: row.abstract ? snippetAround(row.abstract, term) : row.objective ? snippetAround(row.objective, term) : null,
        interviewId: row.id,
      });
    }
  }

  if (wanted.has('participant')) {
    for (const row of db
      .prepare(
        `SELECT p.person_id AS id, p.display_name AS working_name, pr.public_name AS public_name,
                COALESCE(pr.identity_mode, 'identified') AS identity_mode, pr.biographical_note AS note
           FROM persons p
           LEFT JOIN testimony_participant_profiles pr ON pr.person_id = p.person_id
          WHERE p.display_name LIKE ? OR COALESCE(pr.public_name, '') LIKE ?
          LIMIT 40`
      )
      .all(like, like) as { id: string; working_name: string; public_name: string | null; identity_mode: 'identified' | 'pseudonym' | 'anonymous'; note: string | null }[]) {
      hits.push({
        kind: 'participant',
        id: row.id,
        // En la lista del propio investigador se muestra el nombre de trabajo: es SU
        // pantalla y necesita encontrar a la persona. Lo que nunca sale con el nombre real
        // es un fragmento o una exportación.
        title: row.working_name,
        snippet: row.note ? snippetAround(row.note, term) : null,
      });
    }
  }

  if (wanted.has('segment')) {
    for (const row of db
      .prepare(
        `WITH best AS (
           -- La versión MÁS AUTORIZADA de cada archivo, calculada UNA vez.
           --
           -- Como subconsulta correlacionada por fila esto costaba 2,2 s sobre el corpus
           -- de referencia (100 000 tramos): se ejecutaba una vez por tramo. Aquí se
           -- resuelve de golpe con una función de ventana y el filtro pasa a ser un JOIN.
           SELECT id, media_id FROM (
             SELECT t.id AS id, t.media_id AS media_id,
                    ROW_NUMBER() OVER (
                      PARTITION BY t.media_id
                      ORDER BY CASE t.kind
                                 WHEN 'approved' THEN 0
                                 WHEN 'reviewed' THEN 1
                                 WHEN 'corrected' THEN 2
                                 WHEN 'anonymized' THEN 3
                                 WHEN 'translation' THEN 4
                                 ELSE 5
                               END, t.version_no DESC
                    ) AS rn
               FROM testimony_transcripts t
              WHERE t.status = 'ready'
           ) WHERE rn = 1
         )
         SELECT seg.id AS id, seg.text AS text, seg.t_start AS t_start, seg.speaker_label AS speaker_label,
                seg.speaker_person_id AS person_id, t.id AS transcript_id, t.kind AS transcript_kind,
                i.id AS interview_id, i.title AS interview_title,
                p.display_name AS working_name, pr.public_name AS public_name,
                COALESCE(pr.identity_mode, 'identified') AS identity_mode,
                COALESCE(ag.access_level, 'private') AS access_level,
                COALESCE(ag.status, 'pending') AS agreement_status,
                COALESCE(ag.attribution_mode, 'public_name') AS attribution_mode
           FROM testimony_transcript_segments seg
           JOIN best b ON b.id = seg.transcript_id
           JOIN testimony_transcripts t ON t.id = seg.transcript_id
           JOIN testimony_media m ON m.id = t.media_id
           JOIN testimony_sessions s ON s.id = m.session_id
           JOIN testimony_interviews i ON i.id = s.interview_id AND i.deleted_at IS NULL
           LEFT JOIN persons p ON p.person_id = seg.speaker_person_id
           LEFT JOIN testimony_participant_profiles pr ON pr.person_id = seg.speaker_person_id
           LEFT JOIN testimony_agreements ag ON ag.interview_id = i.id AND ag.is_current = 1
          WHERE seg.text LIKE ?
          ORDER BY i.updated_at DESC, seg.t_start
          LIMIT 120`
      )
      .all(like) as {
        id: string; text: string; t_start: number; speaker_label: string | null; person_id: string | null;
        transcript_id: string; transcript_kind: string; interview_id: string; interview_title: string;
        working_name: string | null; public_name: string | null; identity_mode: 'identified' | 'pseudonym' | 'anonymous';
        access_level: TestimonySearchHit['accessLevel']; agreement_status: TestimonySearchHit['agreementStatus'];
        attribution_mode: 'real_name' | 'public_name' | 'anonymous';
      }[]) {
      const speakerName = row.working_name
        ? displayNameFor(
            { workingName: row.working_name, publicName: row.public_name, identityMode: row.identity_mode },
            effectiveAttribution(row.identity_mode, row.attribution_mode)
          )
        : row.speaker_label ?? 'Sin identificar';
      hits.push({
        kind: 'segment',
        id: row.id,
        title: row.interview_title,
        snippet: snippetAround(row.text, term),
        interviewId: row.interview_id,
        transcriptId: row.transcript_id,
        segmentId: row.id,
        speakerName,
        tStart: row.t_start,
        accessLevel: row.access_level,
        agreementStatus: row.agreement_status,
      });
    }
  }

  if (wanted.has('code')) {
    for (const row of db
      .prepare("SELECT id, label, description FROM testimony_codes WHERE label LIKE ? OR COALESCE(description, '') LIKE ? ORDER BY label LIMIT 30")
      .all(like, like) as { id: string; label: string; description: string | null }[]) {
      hits.push({ kind: 'code', id: row.id, title: row.label, snippet: row.description });
    }
  }

  if (wanted.has('note')) {
    for (const row of db
      .prepare('SELECT id, title, content FROM notes WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC LIMIT 40')
      .all(like, like) as { id: string; title: string; content: string }[]) {
      hits.push({ kind: 'note', id: row.id, title: row.title, snippet: snippetAround(row.content, term) });
    }
  }

  if (wanted.has('contrast')) {
    for (const row of db
      .prepare("SELECT id, title, memo_markdown FROM testimony_contrasts WHERE title LIKE ? OR COALESCE(memo_markdown, '') LIKE ? ORDER BY updated_at DESC LIMIT 20")
      .all(like, like) as { id: string; title: string; memo_markdown: string | null }[]) {
      hits.push({ kind: 'contrast', id: row.id, title: row.title, snippet: row.memo_markdown ? snippetAround(row.memo_markdown, term) : null });
    }
  }

  return hits;
}

// ── El tablero de Inicio ─────────────────────────────────────────────────────

/** Días que se consideran «pronto» para avisar de un embargo que vence. */
const EMBARGO_WARNING_DAYS = 90;
/** Horas tras las que una copia de seguridad deja de contar como reciente. */
const BACKUP_STALE_HOURS = 24 * 30;

export function testimonyDashboard(options: { now?: Date; lastBackupAt?: string | null } = {}): TestimonyDashboard {
  const db = getDb();
  const clock = options.now ?? new Date();
  const count = (sql: string, ...params: unknown[]): number =>
    ((db.prepare(sql).get(...params) as { n: number } | undefined)?.n ?? 0);

  const byStatus = new Map<string, number>();
  for (const row of db
    .prepare('SELECT workflow_status AS status, COUNT(*) AS n FROM testimony_interviews WHERE deleted_at IS NULL GROUP BY workflow_status')
    .all() as { status: string; n: number }[]) {
    byStatus.set(row.status, row.n);
  }

  const metrics = {
    interviews: count('SELECT COUNT(*) AS n FROM testimony_interviews WHERE deleted_at IS NULL'),
    scheduled: (byStatus.get('scheduled') ?? 0) + (byStatus.get('preparation') ?? 0),
    pendingTranscription: count(
      `SELECT COUNT(DISTINCT i.id) AS n FROM testimony_interviews i
         JOIN testimony_sessions s ON s.interview_id = i.id
         JOIN testimony_media m ON m.session_id = s.id AND m.role = 'master' AND m.deleted_at IS NULL
        WHERE i.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM testimony_transcripts t WHERE t.media_id = m.id AND t.status = 'ready')`
    ),
    reviewing: (byStatus.get('reviewing') ?? 0) + (byStatus.get('narrator_review') ?? 0),
    completed: byStatus.get('completed') ?? 0,
    recordedSeconds: Math.round(
      ((db
        .prepare("SELECT COALESCE(SUM(duration_seconds), 0) AS n FROM testimony_media WHERE role = 'master' AND deleted_at IS NULL")
        .get() as { n: number }).n)
    ),
    storageBytes: count('SELECT COALESCE(SUM(size_bytes), 0) AS n FROM testimony_media WHERE deleted_at IS NULL'),
    participants: count('SELECT COUNT(DISTINCT person_id) AS n FROM testimony_interview_participants'),
    codes: count('SELECT COUNT(*) AS n FROM testimony_codes'),
    annotations: count('SELECT COUNT(*) AS n FROM testimony_annotations'),
  };

  const alerts: TestimonyAlert[] = [];
  const pushAlert = (kind: TestimonyAlertKind, rows: { id: string }[]): void => {
    if (rows.length > 0) alerts.push({ kind, count: rows.length, interviewIds: rows.slice(0, 8).map((row) => row.id) });
  };

  // 1. Entrevistas próximas. Solo las que aún no se han grabado: una fecha pasada en una
  //    entrevista ya grabada no es un aviso, es historia.
  pushAlert('upcoming', db
    .prepare(
      `SELECT id FROM testimony_interviews
        WHERE deleted_at IS NULL AND archived_at IS NULL
          AND workflow_status IN ('preparation', 'scheduled')
          AND scheduled_at IS NOT NULL
        ORDER BY scheduled_at LIMIT 50`
    ).all() as { id: string }[]);

  // 2. Grabado sin acuerdo documentado. La alerta que más importa del tablero: material
  //    real en el disco cuyo permiso de uso todavía no consta en ninguna parte.
  pushAlert('agreement_missing', db
    .prepare(
      `SELECT DISTINCT i.id AS id FROM testimony_interviews i
         JOIN testimony_sessions s ON s.interview_id = i.id
         JOIN testimony_media m ON m.session_id = s.id AND m.deleted_at IS NULL
         LEFT JOIN testimony_agreements ag ON ag.interview_id = i.id AND ag.is_current = 1
        WHERE i.deleted_at IS NULL AND COALESCE(ag.status, 'pending') IN ('pending', 'update_required')`
    ).all() as { id: string }[]);

  // 3. Copia de seguridad. No se mide contra los archivos sino contra el reloj: si hay
  //    medios y la última copia es vieja (o no existe), el material está en un solo sitio.
  if (metrics.storageBytes > 0) {
    const last = options.lastBackupAt ? Date.parse(options.lastBackupAt) : NaN;
    const stale = Number.isNaN(last) || clock.getTime() - last > BACKUP_STALE_HOURS * 3600_000;
    if (stale) alerts.push({ kind: 'backup_stale', count: 1, interviewIds: [] });
  }

  pushAlert('transcription_error', db
    .prepare(
      `SELECT DISTINCT i.id AS id FROM testimony_interviews i
         JOIN testimony_sessions s ON s.interview_id = i.id
         JOIN testimony_media m ON m.session_id = s.id
         JOIN testimony_transcripts t ON t.media_id = m.id
        WHERE i.deleted_at IS NULL AND t.status = 'error'`
    ).all() as { id: string }[]);

  // 5. Literal sin revisar. Una transcripción automática que nadie ha leído no es una
  //    transcripción: es una hipótesis del modelo sobre lo que se dijo.
  pushAlert('transcription_pending_review', db
    .prepare(
      `SELECT DISTINCT i.id AS id FROM testimony_interviews i
         JOIN testimony_sessions s ON s.interview_id = i.id
         JOIN testimony_media m ON m.session_id = s.id
         JOIN testimony_transcripts t ON t.media_id = m.id AND t.kind = 'machine_literal' AND t.status = 'ready'
        WHERE i.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM testimony_transcripts d WHERE d.media_id = m.id AND d.kind <> 'machine_literal')`
    ).all() as { id: string }[]);

  pushAlert('narrator_review_pending', db
    .prepare(
      `SELECT i.id AS id FROM testimony_interviews i
         JOIN testimony_agreements ag ON ag.interview_id = i.id AND ag.is_current = 1
        WHERE i.deleted_at IS NULL AND ag.narrator_review_required = 1
          AND ag.narrator_review_status IN ('sent', 'changes_requested')`
    ).all() as { id: string }[]);

  // 7. Embargos que vencen pronto. Vencer AVISA, no abre: el nivel de acceso solo cambia
  //    cuando alguien lo decide, porque un embargo que expira solo es una publicación que
  //    nadie firmó.
  const embargoed = db
    .prepare(
      `SELECT i.id AS id, ag.embargo_until AS until FROM testimony_interviews i
         JOIN testimony_agreements ag ON ag.interview_id = i.id AND ag.is_current = 1
        WHERE i.deleted_at IS NULL AND ag.access_level = 'embargoed'`
    ).all() as { id: string; until: string | null }[];
  pushAlert('embargo_expiring', embargoed.filter((row) => {
    if (!row.until) return false;
    if (!isEmbargoActive(row.until, clock)) return true;
    const days = daysUntilEmbargoEnds(row.until, clock);
    return days != null && days <= EMBARGO_WARNING_DAYS;
  }));

  pushAlert('annotation_needs_review', db
    .prepare(
      `SELECT DISTINCT interview_id AS id FROM testimony_annotations WHERE link_status = 'needs_review'`
    ).all() as { id: string }[]);

  // 9. Grabada sin original. Un estado que promete un archivo que no está.
  pushAlert('master_missing', db
    .prepare(
      `SELECT i.id AS id FROM testimony_interviews i
        WHERE i.deleted_at IS NULL
          AND i.workflow_status NOT IN ('preparation', 'scheduled', 'cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM testimony_sessions s
              JOIN testimony_media m ON m.session_id = s.id AND m.role = 'master' AND m.deleted_at IS NULL
             WHERE s.interview_id = i.id)`
    ).all() as { id: string }[]);

  const recent = {
    interviews: db
      .prepare('SELECT id, title, updated_at AS updatedAt FROM testimony_interviews WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 6')
      .all() as { id: string; title: string; updatedAt: string }[],
    transcripts: db
      .prepare(
        `SELECT t.id AS id, i.id AS interviewId, i.title AS interviewTitle, t.kind AS kind, t.created_at AS createdAt
           FROM testimony_transcripts t
           JOIN testimony_media m ON m.id = t.media_id
           JOIN testimony_sessions s ON s.id = m.session_id
           JOIN testimony_interviews i ON i.id = s.interview_id AND i.deleted_at IS NULL
          ORDER BY t.created_at DESC LIMIT 6`
      ).all() as TestimonyDashboard['recent']['transcripts'],
    notes: db
      .prepare(
        `SELECT n.id AS id, n.title AS title, n.updated_at AS updatedAt FROM notes n
          WHERE EXISTS (SELECT 1 FROM testimony_note_links l WHERE l.note_id = n.id AND l.target_kind LIKE 'testimony_%')
          ORDER BY n.updated_at DESC LIMIT 6`
      ).all() as { id: string; title: string; updatedAt: string }[],
    contrasts: db
      .prepare('SELECT id, title, updated_at AS updatedAt FROM testimony_contrasts ORDER BY updated_at DESC LIMIT 6')
      .all() as { id: string; title: string; updatedAt: string }[],
  };

  return {
    metrics,
    alerts,
    recent,
    preservation: {
      lastBackupAt: options.lastBackupAt ?? null,
      interviewsWithoutMaster: alerts.find((alert) => alert.kind === 'master_missing')?.count ?? 0,
      mediaWithoutHash: count("SELECT COUNT(*) AS n FROM testimony_media WHERE deleted_at IS NULL AND (content_hash IS NULL OR content_hash = '')"),
      storageBytes: metrics.storageBytes,
    },
  };
}

/** Si una entrevista pide trabajo activo. Lo usa la ordenación de «Requieren atención». */
export function isOpenInterview(status: string): boolean {
  return !isClosedStatus(status as Parameters<typeof isClosedStatus>[0]);
}
