// La exportación archivística del vault de Testimonios.
//
// TRES PAQUETES, TRES DESTINATARIOS DISTINTOS, y la diferencia entre ellos es la razón de
// que existan tres y no uno con casillas:
//
//   PRESERVACIÓN → el archivo o el repositorio. Lleva los maestros, los derivados, todas
//     las transcripciones, los metadatos y las sumas de comprobación. Es la copia que
//     tiene que sobrevivir a Nodus.
//   CONSULTA → alguien ajeno al proyecto. Lleva copias de acceso y transcripciones
//     autorizadas, con los nombres que el acuerdo permite. NUNCA lleva material privado,
//     restringido, embargado ni documentos de acuerdo.
//   REVISIÓN → el propio narrador. Lleva su transcripción con marcas de tiempo e
//     instrucciones, y NINGUNA nota analítica del investigador.
//
// LA PUERTA DE ACCESO DECIDE, NO ESTE MÓDULO. Cada entrevista pasa por `evaluateAccess`
// con el canal correspondiente, y lo que queda fuera se DEVUELVE EN LA LISTA `excluded`
// con su motivo. Un exportador que descartara en silencio produciría paquetes que parecen
// completos y no lo son, que es peor que un error.
//
// Y las sumas de comprobación no son adorno: `checksums.sha256` es lo que permite, dentro
// de veinte años y en otro sistema, saber si un archivo sigue siendo el que se depositó.

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import { getDb } from '../db/database';
import { accessContextFor, currentAgreement, listInterviews, listParticipants, listSessions } from '../db/testimonyRepo';
import { getMediaBlob, listSegments } from '../db/testimonyMediaRepo';
import { listAnnotations } from '../db/testimonyAnalysisRepo';
import { linksForTarget } from '../db/noteLinksRepo';
import { getSettings } from '../db/settingsRepo';
import { evaluateAccess, type AccessChannel } from '@shared/testimonyAccess';
import {
  ACCESS_LEVEL_LABEL,
  ACCESS_DENIAL_LABEL,
  AGREEMENT_STATUS_LABEL,
  ATTRIBUTION_MODE_LABEL,
  DOCUMENTED_USE_LABEL,
  PARTICIPANT_ROLE_LABEL,
  TRANSCRIPT_KIND_LABEL,
  WORKFLOW_STATUS_LABEL,
} from '@shared/testimonyLabels';
import { formatTimecode, isEditableTranscriptKind } from '@shared/testimonies';
import type { TestimonyExportKind, TestimonyExportRequest, TestimonyExportResult } from '@shared/types';

type DatabaseHandle = Database.Database;

const CHANNEL_FOR: Record<TestimonyExportKind, AccessChannel> = {
  preservation: 'preservationExport',
  access: 'accessExport',
  review: 'reviewExport',
};

function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** CSV con comillas dobles siempre: un título con una coma no puede romper una columna. */
function csv(rows: (string | number | null)[][]): string {
  return rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

function safeName(value: string): string {
  return value.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 80) || 'sin-titulo';
}

/**
 * Construir el paquete. Devuelve los bytes del ZIP y el informe de qué quedó fuera.
 *
 * El ZIP se arma en memoria y lo escribe quien llama (el IPC, tras un diálogo de
 * guardado): así este módulo se puede probar sin tocar el disco ni abrir ventanas.
 */
export function buildTestimonyPackage(request: TestimonyExportRequest): { zip: Buffer; result: Omit<TestimonyExportResult, 'path'> } {
  const channel = CHANNEL_FOR[request.kind];
  const policy = { allowExternalProviders: getSettings().testimonyAllowExternalProviders };
  const now = new Date();

  const rows = listInterviews({ filters: { includeArchived: true } })
    .filter((row) => request.interviewIds.includes(row.id));

  const excluded: TestimonyExportResult['excluded'] = [];
  const included: typeof rows = [];
  for (const row of rows) {
    const decision = evaluateAccess(accessContextFor(row.id), channel, { now, policy });
    if (decision.allowed) included.push(row);
    else excluded.push({ interviewId: row.id, title: row.title, reason: ACCESS_DENIAL_LABEL[decision.reason ?? 'access_restricted'] });
  }

  const zip = new AdmZip();
  const files = new Map<string, Buffer>();
  const add = (name: string, data: Buffer | string): void => {
    files.set(name, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
  };

  const interviewRows: (string | number | null)[][] = [[
    'short_id', 'titulo', 'tipo', 'estado', 'coleccion', 'fecha', 'lugar', 'idioma',
    'narradores', 'entrevistadores', 'duracion_segundos', 'acceso', 'acuerdo', 'repositorio', 'identificador',
  ]];
  const participantRows: (string | number | null)[][] = [['nombre_publico', 'modo_identificacion', 'papeles', 'entrevistas']];
  const agreementRows: (string | number | null)[][] = [[
    'entrevista', 'version', 'estado', 'acceso', 'embargo_hasta', 'atribucion', 'usos_documentados', 'revision_narrador',
  ]];
  const publicNames = new Map<string, { name: string; mode: string; roles: Set<string>; interviews: number }>();

  let mediaFiles = 0;
  let mediaBytes = 0;

  for (const row of included) {
    const folder = `interviews/${row.shortId}`;
    const agreement = currentAgreement(row.id);
    const people = listParticipants(row.id);
    const sessions = listSessions(row.id);

    interviewRows.push([
      row.shortId, row.title, row.interviewKind, row.workflowStatus, row.collectionLabel,
      row.conductedAt ?? row.scheduledAt, row.locationText, row.language,
      row.narratorNames.join('; '), row.interviewerNames.join('; '),
      Math.round(row.durationSeconds), agreement?.accessLevel ?? 'private', agreement?.status ?? 'pending',
      row.repositoryName, row.accessionId,
    ]);
    agreementRows.push([
      row.shortId, agreement?.versionNo ?? 0, agreement?.status ?? 'pending', agreement?.accessLevel ?? 'private',
      agreement?.embargoUntil ?? '', agreement?.attributionMode ?? 'public_name',
      (agreement?.allowedUses ?? []).join('; '), agreement?.narratorReviewStatus ?? 'not_started',
    ]);
    for (const person of people) {
      // SIEMPRE el nombre mostrable: un CSV de participantes con nombres reales es
      // exactamente el archivo que no puede salir de la bóveda.
      const entry = publicNames.get(person.personId) ?? {
        name: person.displayName,
        mode: person.identityMode,
        roles: new Set<string>(),
        interviews: 0,
      };
      entry.roles.add(person.role);
      entry.interviews += 1;
      publicNames.set(person.personId, entry);
    }

    add(`${folder}/metadata.json`, JSON.stringify({
      shortId: row.shortId,
      title: row.title,
      kind: row.interviewKind,
      workflowStatus: row.workflowStatus,
      collection: row.collectionLabel,
      date: row.conductedAt ?? row.scheduledAt,
      location: row.locationText,
      language: row.language,
      abstract: row.abstract,
      repository: row.repositoryName,
      accessionId: row.accessionId,
      participants: people.map((person) => ({ name: person.displayName, role: person.role, identityMode: person.identityMode })),
      access: {
        level: agreement?.accessLevel ?? 'private',
        agreementStatus: agreement?.status ?? 'pending',
        embargoUntil: agreement?.embargoUntil ?? null,
        attribution: agreement?.attributionMode ?? 'public_name',
        documentedUses: agreement?.allowedUses ?? [],
        restrictions: request.kind === 'preservation' ? agreement?.restrictionsMarkdown ?? null : null,
      },
      sessions: sessions.map((session) => ({
        shortId: session.shortId,
        sequence: session.sequenceNo,
        title: session.title,
        recordedAt: session.recordedAt,
        location: session.locationText,
        // Las notas de campo son observación del investigador: no salen en un paquete de
        // consulta ni en uno de revisión.
        fieldNotes: request.kind === 'preservation' ? session.fieldNotes : null,
        media: session.media.map((media) => ({
          shortId: media.shortId,
          fileName: media.fileName,
          role: media.role,
          mimeType: media.mimeType,
          durationSeconds: media.durationSeconds,
          sizeBytes: media.sizeBytes,
          sha256: media.contentHash,
        })),
      })),
    }, null, 2));

    // Contexto: solo en el paquete de preservación, que es el que va al archivo.
    if (request.kind === 'preservation') {
      const context = [
        `# ${row.title}`, '',
        row.objective ? `## Objetivo\n\n${row.objective}` : '',
        row.contextMarkdown ? `## Contexto\n\n${row.contextMarkdown}` : '',
        row.guideMarkdown ? `## Guía de entrevista\n\n${row.guideMarkdown}` : '',
        row.abstract ? `## Resumen\n\n${row.abstract}` : '',
      ].filter(Boolean).join('\n\n');
      if (context.trim()) add(`${folder}/context/contexto.md`, context);
    }

    for (const session of sessions) {
      for (const media of session.media) {
        // El paquete de consulta NO lleva maestros: lleva copias de acceso. Y si no hay
        // ninguna, no lleva audio — antes que degradar un original a copia de consulta sin
        // que nadie lo decida.
        const wantsMedia = request.kind === 'preservation'
          ? true
          : request.kind === 'access' && media.role === 'access_copy';
        if (wantsMedia) {
          const blob = getMediaBlob(media.id);
          if (blob) {
            const dir = media.role === 'master' ? 'media/master' : 'media/access';
            add(`${folder}/${dir}/${safeName(media.fileName ?? media.shortId)}`, blob.bytes);
            mediaFiles += 1;
            mediaBytes += blob.bytes.byteLength;
          }
        }

        for (const transcript of media.transcripts) {
          // Consulta y revisión llevan UNA transcripción: la que el acuerdo autoriza. El
          // literal no sale de la bóveda en esos dos paquetes — es la hipótesis del modelo
          // sobre lo que se dijo, no lo que el narrador aprobó.
          if (request.kind !== 'preservation' && !isExportableTranscript(request.kind, transcript.kind)) continue;
          const segments = listSegments(transcript.id);
          const nameById = new Map(people.map((person) => [person.personId, person.displayName]));
          const lines = [
            `# ${row.title} · ${TRANSCRIPT_KIND_LABEL[transcript.kind]}`,
            '',
            request.kind === 'review'
              ? '> Esta copia es para tu revisión. Puedes corregir errores, pedir que se quite algo o cambiar cómo aparece tu nombre. Los tiempos entre corchetes indican el minuto de la grabación.'
              : '',
            '',
            ...segments.map((segment) => {
              const speaker = segment.speakerPersonId
                ? nameById.get(segment.speakerPersonId) ?? segment.speakerLabel ?? 'Sin identificar'
                : segment.speakerLabel ?? 'Sin identificar';
              return `**[${formatTimecode(segment.tStart)}] ${speaker}:** ${segment.text}`;
            }),
          ].filter((line) => line !== '');
          add(`${folder}/transcripts/${transcript.shortId}-${transcript.kind}.md`, lines.join('\n\n'));
        }
      }
    }

    // Las anotaciones son análisis del investigador: SOLO preservación, y aun ahí como
    // fichero aparte para que quien reciba el paquete sepa distinguirlas del testimonio.
    if (request.kind === 'preservation') {
      const annotations = listAnnotations(row.id);
      if (annotations.length > 0) {
        add(`${folder}/context/fragmentos-codificados.csv`, csv([
          ['short_id', 'inicio', 'fin', 'cita', 'memo', 'codigos', 'estado_enlace'],
          ...annotations.map((annotation) => [
            annotation.shortId,
            formatTimecode(annotation.tStart),
            formatTimecode(annotation.tEnd),
            annotation.quoteSnapshot,
            annotation.memo,
            annotation.codes.map((code) => code.label).join('; '),
            annotation.linkStatus,
          ]),
        ]));
      }
    }

    // Las notas del investigador solo salen si se piden explícitamente, y nunca en el
    // paquete de revisión: son SU interpretación, no material del narrador.
    if (request.includeNotes && request.kind === 'preservation') {
      const db = getDb();
      for (const link of linksForTarget('testimony_interview', row.id)) {
        const note = db.prepare('SELECT title, content FROM notes WHERE id = ?').get(link.noteId) as { title: string; content: string } | undefined;
        if (note) add(`${folder}/context/notas/${safeName(note.title)}.md`, `# ${note.title}\n\n${note.content}`);
      }
    }
  }

  for (const [, entry] of publicNames) {
    participantRows.push([
      entry.name,
      entry.mode,
      [...entry.roles].map((role) => PARTICIPANT_ROLE_LABEL[role as keyof typeof PARTICIPANT_ROLE_LABEL] ?? role).join('; '),
      entry.interviews,
    ]);
  }

  add('metadata/interviews.csv', csv(interviewRows));
  add('metadata/participants-public.csv', csv(participantRows));
  // El resumen de acuerdos viaja en preservación (es parte del expediente) y en consulta
  // sólo como estado, nunca como documento.
  if (request.kind !== 'review') add('metadata/agreements-summary.csv', csv(agreementRows));

  add('README.md', readme(request.kind, included.length, excluded.length));

  const manifest = {
    generator: 'Nodus',
    kind: request.kind,
    createdAt: now.toISOString(),
    interviews: included.map((row) => ({
      shortId: row.shortId,
      title: row.title,
      access: currentAgreement(row.id)?.accessLevel ?? 'private',
      agreement: currentAgreement(row.id)?.status ?? 'pending',
    })),
    excluded,
    counts: {
      interviews: included.length,
      files: files.size + 2,
      mediaFiles,
      mediaBytes,
    },
  };
  add('manifest.json', JSON.stringify(manifest, null, 2));

  const digests = [...files.entries()]
    .filter(([name]) => name !== 'checksums.sha256')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, data]) => `${sha256(data)}  ${name}`);
  add('checksums.sha256', `${digests.join('\n')}\n`);

  for (const [name, data] of files) zip.addFile(name, data);

  return {
    zip: zip.toBuffer(),
    result: {
      interviews: included.length,
      files: files.size,
      bytes: [...files.values()].reduce((sum, data) => sum + data.byteLength, 0),
      excluded,
    },
  };
}

/**
 * Qué versión de transcripción puede salir en cada paquete.
 *
 * El literal NUNCA sale en consulta ni en revisión: es lo que el modelo creyó oír, y
 * presentarlo a un tercero (o al propio narrador) como «su transcripción» convierte un
 * error de reconocimiento en algo que la persona tiene que desmentir.
 */
function isExportableTranscript(kind: TestimonyExportKind, transcriptKind: string): boolean {
  if (kind === 'access') return transcriptKind === 'approved' || transcriptKind === 'anonymized';
  if (kind === 'review') return transcriptKind === 'reviewed' || transcriptKind === 'corrected' || transcriptKind === 'approved';
  return true;
}

function readme(kind: TestimonyExportKind, included: number, excluded: number): string {
  const shared = [
    '## Estructura',
    '',
    '```',
    'manifest.json          qué contiene este paquete y qué quedó fuera, con su motivo',
    'checksums.sha256       la huella SHA-256 de cada archivo',
    'metadata/              tablas CSV de entrevistas, participantes y acuerdos',
    'interviews/INT-XXXX/   una carpeta por entrevista',
    '```',
    '',
    `Entrevistas incluidas: ${included}. Excluidas por sus condiciones de acceso: ${excluded}.`,
    '',
    'Las exclusiones no son un fallo: son las condiciones que cada narrador acordó. El',
    'motivo de cada una consta en `manifest.json`.',
    '',
    '## Comprobar la integridad',
    '',
    'En cualquier sistema con `shasum`:',
    '',
    '```',
    'shasum -c checksums.sha256',
    '```',
  ];

  if (kind === 'preservation') {
    return [
      '# Paquete de preservación',
      '',
      'Copia completa para depósito en un archivo o repositorio. Contiene los archivos',
      'originales tal y como se recibieron, sus derivados, TODAS las versiones de cada',
      'transcripción, los metadatos y el contexto de investigación.',
      '',
      'Este paquete NO es, por sí solo, un plan de preservación: hace falta al menos una',
      'copia adicional fuera del equipo de origen y una revisión periódica de las huellas.',
      'Los formatos de audio recibidos se conservan sin transcodificar; para un depósito a',
      'largo plazo se recomienda añadir derivados en formatos abiertos y sin pérdida.',
      '',
      'Los documentos de acuerdo NO se incluyen salvo que se marcaran expresamente.',
      '',
      ...shared,
    ].join('\n');
  }
  if (kind === 'access') {
    return [
      '# Paquete de consulta',
      '',
      'Copia preparada para consulta por personas ajenas al proyecto. Contiene únicamente',
      'copias de acceso y las transcripciones autorizadas, con los nombres que cada acuerdo',
      'permite mostrar.',
      '',
      'NO contiene archivos originales, notas de campo, análisis del investigador,',
      'documentos de acuerdo ni material privado, restringido o embargado.',
      '',
      'Que un nombre aparezca como seudónimo no garantiza el anonimato: un relato puede',
      'identificar a quien lo cuenta por su contenido.',
      '',
      ...shared,
    ].join('\n');
  }
  return [
    '# Copia para revisión',
    '',
    'Esta copia se envía a la persona entrevistada para que revise su transcripción.',
    '',
    'Puede corregir errores, pedir que se retire un pasaje, cambiar cómo aparece su nombre',
    'o indicar que prefiere no seguir adelante. Los números entre corchetes son el minuto',
    'de la grabación, para localizar cualquier punto.',
    '',
    'No contiene notas ni interpretaciones del investigador.',
    '',
    ...shared,
  ].join('\n');
}

/**
 * El inventario de Testimonios para el manifiesto de copia de seguridad.
 *
 * Los recuentos de filas ya los cuenta el inventario general tabla a tabla; lo que un
 * recuento de filas NO puede decir es cuántas horas de grabación y cuántos bytes de audio
 * tiene que haber al otro lado. Esas dos cifras son las que convierten «restauró» en
 * «restauró completo».
 */
export function testimonyBackupInventory(connection?: DatabaseHandle): {
  interviews: number;
  participants: number;
  sessions: number;
  mediaFiles: number;
  mediaHours: number;
  mediaBytes: number;
  transcripts: number;
  segments: number;
  annotations: number;
  agreements: number;
  contrasts: number;
} | null {
  const db = connection ?? getDb();
  const exists = db
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'testimony_interviews'")
    .get() as { n: number };
  if (exists.n === 0) return null;
  const one = (sql: string): number => ((db.prepare(sql).get() as { n: number } | undefined)?.n ?? 0);
  return {
    interviews: one('SELECT COUNT(*) AS n FROM testimony_interviews WHERE deleted_at IS NULL'),
    participants: one('SELECT COUNT(*) AS n FROM testimony_participant_profiles'),
    sessions: one('SELECT COUNT(*) AS n FROM testimony_sessions'),
    mediaFiles: one('SELECT COUNT(*) AS n FROM testimony_media WHERE deleted_at IS NULL'),
    mediaHours: Math.round((one('SELECT COALESCE(SUM(duration_seconds), 0) AS n FROM testimony_media WHERE deleted_at IS NULL') / 3600) * 10) / 10,
    mediaBytes: one('SELECT COALESCE(SUM(size_bytes), 0) AS n FROM testimony_media WHERE deleted_at IS NULL'),
    transcripts: one('SELECT COUNT(*) AS n FROM testimony_transcripts'),
    segments: one('SELECT COUNT(*) AS n FROM testimony_transcript_segments'),
    annotations: one('SELECT COUNT(*) AS n FROM testimony_annotations'),
    agreements: one('SELECT COUNT(*) AS n FROM testimony_agreements'),
    contrasts: one('SELECT COUNT(*) AS n FROM testimony_contrasts'),
  };
}

/** Etiquetas legibles usadas por el README y los CSV; se exportan para los tests. */
export const EXPORT_LABELS = {
  ACCESS_LEVEL_LABEL,
  AGREEMENT_STATUS_LABEL,
  ATTRIBUTION_MODE_LABEL,
  DOCUMENTED_USE_LABEL,
  WORKFLOW_STATUS_LABEL,
  isEditableTranscriptKind,
};
