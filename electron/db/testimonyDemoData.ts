// «Memoria del valle»: un proyecto de historia oral completo y ficticio.
//
// NO HAY NINGUNA VOZ REAL, y no es una limitación: es la única forma honesta de enviar
// una demo de historia oral. Los maestros son VOCES SINTÉTICAS generadas a partir del
// guion de la propia demo (`testimonyDemoScript.ts`), marcadas como tales en sus metadatos
// técnicos, y una de las cinco entrevistas llega con el audio YA SOLTADO — conserva su
// ficha, su huella y su transcripción — para enseñar el flujo de «exportar el original y
// liberar espacio» sin fingir que hay una grabación detrás.
//
// Que suene habla de verdad no es un capricho estético: sin ella no se puede probar la
// transcripción ni la detección de hablantes desde la demo, que es lo primero que hace
// cualquiera que abre un proyecto de historia oral.
//
// El corpus está construido para que las cinco pantallas tengan algo que enseñar el
// primer minuto: entrevistas en estados distintos, una grupal, una versión literal junto a
// su revisada, códigos compartidos entre narradores, un acuerdo pendiente, un embargo, dos
// notas con enlaces al minuto exacto y un contraste guardado con sus fragmentos fijados.
//
// Todos los identificadores empiezan por `demo-tst-`, así que la limpieza puede quitarlo
// con precisión sin tocar nada de lo que el usuario cree mientras lo explora.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getDb } from './database';
import {
  demoScriptFor,
  type DemoAudioEntry,
  type DemoAudioManifest,
  type DemoInterviewScript,
} from './testimonyDemoScript';
import { getSettings, updateSettings } from './settingsRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { normalizeCodeLabel } from '@shared/testimonies';
import type { AppLanguage } from '@shared/types';

const PREFIX = 'demo-tst-';
const AT = '2026-07-28T12:00:00.000Z';
const EARLIER = '2026-07-20T12:00:00.000Z';

type SqlValue = string | number | null | Buffer;

function isEnglish(): boolean {
  const language: AppLanguage = getSettings().uiLanguage;
  return language !== 'es';
}

/** La demo se envía en dos idiomas; el resto de la interfaz ya se traduce sola. */
function text(es: string, en: string): string {
  return isEnglish() ? en : es;
}

function insert(table: string, row: Record<string, SqlValue>): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`Unsafe table name: ${table}`);
  const columns = Object.keys(row);
  if (columns.some((column) => !/^[a-z_][a-z0-9_]*$/.test(column))) throw new Error(`Unsafe column in ${table}`);
  getDb()
    .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...columns.map((column) => row[column]));
}

/**
 * Un WAV PCM16 de dos segundos con un tono puro.
 *
 * Es AUDIO SINTÉTICO Y SE DICE en el nombre del archivo y en sus metadatos técnicos.
 * Enviar voces reales en una demo de historia oral —aunque fueran de actores— enseñaría
 * exactamente lo contrario de lo que este vault defiende: que una grabación de alguien
 * contando su vida no se usa sin su permiso.
 */
function syntheticTone(hz: number): Buffer {
  const rate = 8000;
  const samples = rate * 2;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const fade = Math.min(1, Math.min(index, samples - index) / (rate * 0.1));
    buffer.writeInt16LE(Math.round(Math.sin((index / rate) * 2 * Math.PI * hz) * 6000 * fade), 44 + index * 2);
  }
  return buffer;
}

function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function hasTestimonyDemoData(): boolean {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM testimony_interviews WHERE id LIKE '${PREFIX}%'`)
    .get() as { n: number };
  return row.n > 0;
}

function hasAnyTestimonyData(): boolean {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM testimony_interviews').get() as { n: number };
  return row.n > 0;
}

interface SegmentSeed {
  t: number;
  tEnd: number;
  speaker: 'narrator' | 'narrator2' | 'interviewer';
  text: string;
}

/**
 * El audio de la demo, generado a partir de su propio guion y empaquetado con la app.
 *
 * SON VOCES SINTÉTICAS y se dice en los metadatos técnicos de cada archivo, en su nombre y
 * en el reproductor. Enviar voces reales en una demo de historia oral —aunque fueran de
 * actores— enseñaría lo contrario de lo que este vault defiende. Pero un tono puro tampoco
 * servía: sin habla no se puede probar ni la transcripción ni la detección de hablantes,
 * que es justo lo que un proyecto de historia oral hace el primer día.
 */
const DEMO_AUDIO_DIR = path.join(app.getAppPath(), 'electron', 'assets', 'testimonios-demo');

function demoAudio(key: string, english: boolean): { entry: DemoAudioEntry; bytes: Buffer } | null {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(DEMO_AUDIO_DIR, 'manifest.json'), 'utf8')) as DemoAudioManifest;
    const entry = manifest.entries.find((item) => item.key === key && item.language === (english ? 'en' : 'es'));
    if (!entry) return null;
    const bytes = fs.readFileSync(path.join(DEMO_AUDIO_DIR, entry.file));
    // La huella del manifiesto no es decorativa: si el archivo se corrompe al empaquetar,
    // la demo cae al tono sintético en vez de sembrar una grabación que no suena.
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) return null;
    return { entry, bytes };
  } catch {
    return null;
  }
}

export function seedTestimonyDemoData(): boolean {
  if (getActiveVault().type !== 'testimonios' || hasAnyTestimonyData()) return false;

  const db = getDb();
  const en = isEnglish();

  // ── Los cuatro narradores y el entrevistador ──────────────────────────────
  const people: { id: string; working: string; publicName: string | null; mode: string; note: string }[] = [
    {
      id: `${PREFIX}p-carmen`,
      working: text('Carmen Ruiz Salas', 'Carmen Ruiz Salas'),
      publicName: 'Carmen R.',
      mode: 'pseudonym',
      note: text(
        'Nacida en Valdenoceda en 1931. Hija de un tratante de ganado. Vivió la posguerra en el valle y emigró a Barcelona en 1958.',
        'Born in Valdenoceda in 1931. Daughter of a cattle dealer. Lived through the postwar years in the valley and emigrated to Barcelona in 1958.'
      ),
    },
    {
      id: `${PREFIX}p-tomas`,
      working: text('Tomás Aguilar Peña', 'Tomás Aguilar Peña'),
      publicName: text('Tomás A.', 'Tomás A.'),
      mode: 'identified',
      note: text(
        'Nacido en 1928. Maestro rural en el valle entre 1952 y 1974. Conserva los cuadernos de clase de aquellos años.',
        'Born in 1928. Village schoolteacher in the valley between 1952 and 1974. Still keeps his class notebooks from those years.'
      ),
    },
    {
      id: `${PREFIX}p-rosario`,
      working: text('Rosario Vela', 'Rosario Vela'),
      publicName: text('R. V.', 'R. V.'),
      mode: 'anonymous',
      note: text(
        'Pidió que no constara su nombre. Trabajó en la fábrica de harinas desde los catorce años.',
        'Asked for her name not to appear. Worked at the flour mill from the age of fourteen.'
      ),
    },
    {
      id: `${PREFIX}p-miguel`,
      working: text('Miguel Ángel Sanz', 'Miguel Ángel Sanz'),
      publicName: null,
      mode: 'identified',
      note: text(
        'Nacido en 1940. Se marchó del valle a los diecisiete años y volvió jubilado.',
        'Born in 1940. Left the valley at seventeen and came back after retiring.'
      ),
    },
    {
      id: `${PREFIX}p-jorge`,
      working: text('Jorge Peral', 'Jorge Peral'),
      publicName: null,
      mode: 'identified',
      note: text('Investigador responsable del proyecto.', 'Researcher leading the project.'),
    },
  ];

  // ── Los códigos, COMPARTIDOS entre entrevistas ────────────────────────────
  const codes: { id: string; label: string; kind: 'code' | 'theme'; color: string; description: string }[] = [
    { id: `${PREFIX}c-partida`, label: text('La partida', 'Leaving'), kind: 'theme', color: '#0891b2', description: text('Marcharse del valle: la decisión, el viaje y lo que se deja.', 'Leaving the valley: the decision, the journey and what is left behind.') },
    { id: `${PREFIX}c-hambre`, label: text('Hambre', 'Hunger'), kind: 'code', color: '#b45309', description: text('Escasez, racionamiento y estrategias de supervivencia.', 'Scarcity, rationing and survival strategies.') },
    { id: `${PREFIX}c-escuela`, label: text('Escuela', 'School'), kind: 'code', color: '#7c3aed', description: text('La escuela rural: quién iba, hasta cuándo y para qué.', 'The village school: who attended, until when and what for.') },
    { id: `${PREFIX}c-silencio`, label: text('Silencio', 'Silence'), kind: 'code', color: '#475569', description: text('Lo que no se contaba, y por qué no se contaba.', 'What was not told, and why it was not told.') },
    { id: `${PREFIX}c-regreso`, label: text('Regreso', 'Return'), kind: 'code', color: '#0f766e', description: text('Volver al valle, o no volver.', 'Coming back to the valley, or not coming back.') },
  ];

  const tx = db.transaction(() => {
    for (const person of people) {
      insert('persons', { person_id: person.id, display_name: person.working, sex: 'unknown', created_at: EARLIER, updated_at: AT });
      insert('testimony_participant_profiles', {
        person_id: person.id,
        public_name: person.publicName,
        identity_mode: person.mode,
        pronunciation: null,
        biographical_note: person.note,
        attribution_note: person.mode === 'anonymous'
          ? text('Pidió expresamente no aparecer con su nombre en ninguna difusión.', 'Explicitly asked not to appear by name in any dissemination.')
          : null,
        created_at: EARLIER,
        updated_at: AT,
      });
    }

    for (const code of codes) {
      insert('testimony_codes', {
        id: code.id,
        label: code.label,
        normalized_label: normalizeCodeLabel(code.label),
        kind: code.kind,
        parent_id: null,
        description: code.description,
        color: code.color,
        created_at: EARLIER,
        updated_at: AT,
      });
    }

    /** Crea una entrevista completa. Devuelve los ids que después necesitan las notas. */
    const makeInterview = (spec: {
      key: string;
      shortId: string;
      title: string;
      kind: string;
      status: string;
      date: string | null;
      scheduled?: string | null;
      place: string;
      narrators: string[];
      objective: string;
      abstract: string;
      agreement: {
        status: string;
        access: string;
        embargo?: string | null;
        attribution: string;
        uses: string[];
        reviewRequired?: boolean;
        reviewStatus?: string;
        restrictions?: string | null;
      };
      /** Sin audio: la entrevista cuyo maestro se exportó y se soltó. */
      audio: 'tone' | 'dropped' | 'none';
      tone?: number;
      /** Si además del literal lleva una versión revisada. */
      reviewed?: boolean;
      fieldNotes?: string;
    }) => {
      const interviewId = `${PREFIX}i-${spec.key}`;
      insert('testimony_interviews', {
        id: interviewId,
        short_id: spec.shortId,
        title: spec.title,
        interview_kind: spec.kind,
        workflow_status: spec.status,
        collection_label: text('Memoria del valle', 'Valley Memory'),
        scheduled_at: spec.scheduled ?? null,
        conducted_at: spec.date,
        location_text: spec.place,
        interview_mode: 'in_person',
        language: en ? 'en' : 'es',
        objective: spec.objective,
        context_markdown: text(
          'El valle perdió más de la mitad de su población entre 1950 y 1975. Este proyecto recoge testimonios de quienes se quedaron y de quienes se fueron.',
          'The valley lost more than half its population between 1950 and 1975. This project gathers testimony from those who stayed and those who left.'
        ),
        guide_markdown: text(
          '1. Infancia y familia.\n2. La escuela.\n3. El trabajo.\n4. La marcha, o la decisión de quedarse.\n5. Lo que se recuerda del valle hoy.',
          '1. Childhood and family.\n2. School.\n3. Work.\n4. Leaving, or deciding to stay.\n5. What is remembered of the valley today.'
        ),
        abstract: spec.abstract,
        repository_name: text('Archivo Municipal del Valle', 'Valley Municipal Archive'),
        accession_id: null,
        created_at: EARLIER,
        updated_at: AT,
        archived_at: null,
        deleted_at: null,
      });

      spec.narrators.forEach((personId, index) => {
        insert('testimony_interview_participants', {
          interview_id: interviewId,
          person_id: personId,
          role: 'narrator',
          speaker_label: `Hablante ${index + 1}`,
          is_primary: index === 0 ? 1 : 0,
          position: index,
          created_at: EARLIER,
        });
      });
      insert('testimony_interview_participants', {
        interview_id: interviewId,
        person_id: `${PREFIX}p-jorge`,
        role: 'interviewer',
        speaker_label: text('Entrevistador', 'Interviewer'),
        is_primary: 1,
        position: 0,
        created_at: EARLIER,
      });

      insert('testimony_agreements', {
        id: `${PREFIX}a-${spec.key}`,
        interview_id: interviewId,
        version_no: 1,
        is_current: 1,
        status: spec.agreement.status,
        documented_at: spec.agreement.status === 'documented' ? EARLIER : null,
        access_level: spec.agreement.access,
        embargo_until: spec.agreement.embargo ?? null,
        attribution_mode: spec.agreement.attribution,
        allowed_uses_json: JSON.stringify(spec.agreement.uses),
        narrator_review_required: spec.agreement.reviewRequired ? 1 : 0,
        narrator_review_status: spec.agreement.reviewStatus ?? 'not_started',
        narrator_review_sent_at: spec.agreement.reviewStatus === 'sent' ? AT : null,
        narrator_review_notes: null,
        restrictions_markdown: spec.agreement.restrictions ?? null,
        document_media_id: null,
        created_at: EARLIER,
        updated_at: EARLIER,
      });

      if (spec.audio === 'none') return { interviewId, transcriptId: null as string | null, segmentIds: [] as string[] };

      const sessionId = `${PREFIX}s-${spec.key}`;
      insert('testimony_sessions', {
        id: sessionId,
        short_id: `SES-${spec.shortId.slice(4)}`,
        interview_id: interviewId,
        sequence_no: 1,
        title: text('Primera sesión', 'First session'),
        status: 'recorded',
        scheduled_at: null,
        recorded_at: spec.date,
        location_text: spec.place,
        mode: 'in_person',
        language: en ? 'en' : 'es',
        field_notes: spec.fieldNotes ?? null,
        created_at: EARLIER,
        updated_at: AT,
      });

      const dropped = spec.audio === 'dropped';
      const generated = dropped ? null : demoAudio(spec.key, en);
      // Sin los archivos empaquetados la demo NO se cae: vuelve al tono, que es lo que
      // había antes, y lo dice en sus metadatos. Una demo que no siembra es peor que una
      // demo con un tono.
      const bytes = generated ? generated.bytes : syntheticTone(spec.tone ?? 440);
      const mediaId = `${PREFIX}m-${spec.key}`;
      insert('testimony_media', {
        id: mediaId,
        short_id: `MED-${spec.shortId.slice(4)}`,
        session_id: sessionId,
        media_kind: 'audio',
        role: 'master',
        file_name: dropped
          ? text('valle-04-original.wav', 'valley-04-master.wav')
          : generated
            ? text(`voces-sinteticas-${spec.key}.mp3`, `synthetic-voices-${spec.key}.mp3`)
            : text(`audio-sintetico-${spec.key}.wav`, `synthetic-audio-${spec.key}.wav`),
        mime_type: generated ? generated.entry.mimeType : 'audio/wav',
        // La entrevista con el audio soltado conserva ficha y huella, y no un byte más.
        content_blob: dropped ? null : bytes,
        content_hash: sha256(bytes),
        duration_seconds: dropped ? 4980 : generated ? Math.round(generated.entry.durationSeconds) : 2,
        size_bytes: dropped ? 0 : bytes.byteLength,
        technical_json: JSON.stringify(
          dropped
            ? { nota: text('Original exportado al archivo y soltado de la bóveda.', 'Master exported to the archive and released from the vault.') }
            : generated
              ? {
                sintetico: true,
                voces: generated.entry.voices,
                nota: text(
                  'Voces sintéticas generadas para la demo. Ninguna persona real ha sido grabada.',
                  'Synthetic voices generated for the demo. No real person was recorded.'
                ),
              }
              : { sintetico: true, nota: text('Tono sintético de demostración. No es una voz real.', 'Synthetic demo tone. Not a real voice.') }
        ),
        source_media_id: null,
        immutable: 1,
        created_at: EARLIER,
        deleted_at: null,
      });

      // Los segmentos SALEN DEL GUION, no de esta llamada: el texto que se oye y el que se
      // lee son el mismo, y los tiempos son los medidos al generar el audio, no una rejilla
      // de doce en doce segundos que no coincidiría con nada.
      const script: DemoInterviewScript | null = demoScriptFor(spec.key);
      const segments: SegmentSeed[] = (script?.turns ?? []).map((turn, index) => {
        const timing = generated?.entry.turns[index] ?? null;
        return {
          t: timing ? timing.start : index * 12,
          tEnd: timing ? timing.end : index * 12 + 11,
          speaker: turn.speaker,
          text: text(turn.es, turn.en),
        };
      });
      const literalId = `${PREFIX}t-${spec.key}-literal`;
      insert('testimony_transcripts', {
        id: literalId,
        short_id: `TRN-${spec.shortId.slice(4)}L`,
        media_id: mediaId,
        kind: 'machine_literal',
        language: en ? 'en' : 'es',
        content_markdown: segments.map((segment) => segment.text.toLocaleLowerCase()).join(' '),
        status: 'ready',
        version_no: 1,
        source_transcript_id: null,
        model_provider: 'transformers',
        model_name: 'whisper-small',
        approved_at: null,
        created_at: EARLIER,
        updated_at: EARLIER,
      });
      const literalSegmentIds: string[] = [];
      segments.forEach((segment, index) => {
        const id = `${PREFIX}g-${spec.key}-l${index}`;
        literalSegmentIds.push(id);
        insert('testimony_transcript_segments', {
          id,
          short_id: `SEG-${spec.shortId.slice(4)}L${index}`,
          transcript_id: literalId,
          source_segment_id: null,
          t_start: segment.t,
          t_end: segment.tEnd,
          // El literal llega en minúsculas y sin puntuar: es lo que devuelve el modelo, y
          // enseñarlo así es lo que hace evidente por qué existe la versión corregida.
          text: segment.text.toLocaleLowerCase(),
          speaker_person_id: null,
          speaker_label: segment.speaker === 'interviewer' ? 'Hablante 2' : 'Hablante 1',
          confidence: 0.86,
          position: index,
          created_at: EARLIER,
          updated_at: EARLIER,
        });
      });

      if (!spec.reviewed) return { interviewId, transcriptId: literalId, segmentIds: literalSegmentIds };

      const reviewedId = `${PREFIX}t-${spec.key}-reviewed`;
      insert('testimony_transcripts', {
        id: reviewedId,
        short_id: `TRN-${spec.shortId.slice(4)}R`,
        media_id: mediaId,
        kind: 'reviewed',
        language: en ? 'en' : 'es',
        content_markdown: segments.map((segment) => segment.text).join('\n\n'),
        status: 'ready',
        version_no: 1,
        source_transcript_id: literalId,
        model_provider: 'transformers',
        model_name: 'whisper-small',
        approved_at: null,
        created_at: AT,
        updated_at: AT,
      });
      const reviewedSegmentIds: string[] = [];
      segments.forEach((segment, index) => {
        const id = `${PREFIX}g-${spec.key}-r${index}`;
        reviewedSegmentIds.push(id);
        insert('testimony_transcript_segments', {
          id,
          short_id: `SEG-${spec.shortId.slice(4)}R${index}`,
          transcript_id: reviewedId,
          source_segment_id: literalSegmentIds[index],
          t_start: segment.t,
          t_end: segment.tEnd,
          text: segment.text,
          speaker_person_id: segment.speaker === 'interviewer'
            ? `${PREFIX}p-jorge`
            : segment.speaker === 'narrator2' ? spec.narrators[1] ?? spec.narrators[0] : spec.narrators[0],
          speaker_label: null,
          confidence: null,
          position: index,
          created_at: AT,
          updated_at: AT,
        });
      });
      return { interviewId, transcriptId: reviewedId, segmentIds: reviewedSegmentIds };
    };

    // ── Las cinco entrevistas ───────────────────────────────────────────────
    const carmen = makeInterview({
      key: 'carmen',
      shortId: 'INT-0001',
      title: text('Entrevista a Carmen R. — la partida del 47', 'Interview with Carmen R. — the departure of ’47'),
      kind: 'life_history',
      status: 'completed',
      date: '2026-03-12T10:00:00.000Z',
      place: text('Casa de la narradora, Valdenoceda', 'The narrator’s home, Valdenoceda'),
      narrators: [`${PREFIX}p-carmen`],
      objective: text('Reconstruir la marcha de su padre en 1947 y lo que supuso para la familia.', 'Reconstruct her father’s departure in 1947 and what it meant for the family.'),
      abstract: text(
        'Historia de vida centrada en la infancia en el valle, la marcha del padre en 1947 y la emigración a Barcelona en 1958.',
        'Life history centred on childhood in the valley, her father’s departure in 1947 and emigration to Barcelona in 1958.'
      ),
      agreement: {
        status: 'documented',
        access: 'restricted',
        attribution: 'public_name',
        uses: ['research', 'teaching', 'deposit'],
        reviewRequired: true,
        reviewStatus: 'approved',
        restrictions: text(
          'No puede publicarse en internet ni difundirse en medios. Uso académico y depósito en el archivo municipal.',
          'May not be published online or broadcast. Academic use and deposit at the municipal archive only.'
        ),
      },
      audio: 'tone',
      tone: 392,
      reviewed: true,
      fieldNotes: text(
        'Se emocionó al hablar del padre y pedimos parar dos minutos. Al apagar la grabadora contó que guarda su carta de despedida; no quiso que constara.',
        'She became emotional talking about her father and we paused for two minutes. With the recorder off she said she keeps his farewell letter; she did not want that recorded.'
      ),
    });

    const tomas = makeInterview({
      key: 'tomas',
      shortId: 'INT-0002',
      title: text('Entrevista a Tomás Aguilar — la escuela del valle', 'Interview with Tomás Aguilar — the valley school'),
      kind: 'thematic',
      status: 'reviewing',
      date: '2026-04-02T16:00:00.000Z',
      place: text('Biblioteca municipal', 'Municipal library'),
      narrators: [`${PREFIX}p-tomas`],
      objective: text('Documentar la escuela rural entre 1952 y 1974 desde quien la sostuvo.', 'Document the village school between 1952 and 1974 from the person who kept it running.'),
      abstract: text(
        'El maestro del valle describe la escuela unitaria, el descenso de alumnado por la emigración y el cierre de 1974.',
        'The valley schoolteacher describes the one-room school, the fall in pupils caused by emigration and its closure in 1974.'
      ),
      agreement: {
        status: 'documented',
        access: 'open',
        attribution: 'real_name',
        // La ÚNICA entrevista de la demo que documenta las dos llaves del tratamiento por
        // IA —«ai_processing» y «external_processing»—, para que se pueda ver funcionar el
        // análisis sin que eso abra las otras cuatro. Que haga falta documentar las dos por
        // separado es la parte que hay que enseñar.
        uses: ['research', 'teaching', 'publication', 'web_publication', 'deposit', 'ai_processing', 'external_processing'],
      },
      audio: 'tone',
      tone: 440,
      reviewed: true,
    });

    const grupal = makeInterview({
      key: 'grupal',
      shortId: 'INT-0003',
      title: text('Entrevista grupal — las mujeres de la fábrica', 'Group interview — the women of the mill'),
      kind: 'group',
      status: 'reviewing',
      date: '2026-05-18T11:00:00.000Z',
      place: text('Centro social, Valdenoceda', 'Community centre, Valdenoceda'),
      narrators: [`${PREFIX}p-rosario`, `${PREFIX}p-carmen`],
      objective: text('Recoger la memoria del trabajo femenino en la fábrica de harinas.', 'Gather memories of women’s work at the flour mill.'),
      abstract: text(
        'Dos trabajadoras de la fábrica de harinas recuerdan los turnos, los sueldos y lo que no se contaba en casa.',
        'Two flour-mill workers recall shifts, wages and what was never told at home.'
      ),
      agreement: {
        status: 'documented',
        access: 'embargoed',
        embargo: '2031-01-01T00:00:00.000Z',
        attribution: 'anonymous',
        uses: ['research', 'deposit'],
        reviewRequired: true,
        reviewStatus: 'sent',
        restrictions: text(
          'Embargo hasta 2031 a petición de una de las participantes. Sin nombres en ninguna difusión.',
          'Embargoed until 2031 at the request of one participant. No names in any dissemination.'
        ),
      },
      audio: 'tone',
      tone: 349,
      reviewed: true,
      fieldNotes: text('Cinco personas en la sala; dos prefirieron no ser grabadas y sus intervenciones no constan.', 'Five people in the room; two preferred not to be recorded and their contributions are not included.'),
    });

    const miguel = makeInterview({
      key: 'miguel',
      shortId: 'INT-0004',
      title: text('Entrevista a Miguel Ángel Sanz — el regreso', 'Interview with Miguel Ángel Sanz — the return'),
      kind: 'life_history',
      status: 'completed',
      date: '2026-02-08T09:30:00.000Z',
      place: text('Casa del narrador', 'The narrator’s home'),
      narrators: [`${PREFIX}p-miguel`],
      objective: text('Documentar la emigración de los años cincuenta y el retorno tras la jubilación.', 'Document the emigration of the fifties and the return after retirement.'),
      abstract: text(
        'Se marchó a los diecisiete años a Bilbao y volvió al valle jubilado, cincuenta años después.',
        'He left for Bilbao at seventeen and came back to the valley after retiring, fifty years later.'
      ),
      agreement: {
        status: 'documented',
        access: 'open',
        attribution: 'real_name',
        uses: ['research', 'teaching', 'publication', 'exhibition', 'deposit'],
      },
      // El maestro se exportó al archivo y se soltó de la bóveda: la ficha, la huella y la
      // transcripción siguen aquí, y el reproductor lo dice en vez de fallar.
      audio: 'dropped',
      reviewed: true,
    });

    // La quinta: PROGRAMADA y sin acuerdo. Es el estado más incómodo y el que más se
    // parece a la realidad de un proyecto en marcha.
    makeInterview({
      key: 'proxima',
      shortId: 'INT-0005',
      title: text('Entrevista pendiente — la familia del molinero', 'Upcoming interview — the miller’s family'),
      kind: 'follow_up',
      status: 'scheduled',
      date: null,
      scheduled: '2026-09-14T17:00:00.000Z',
      place: text('Por confirmar', 'To be confirmed'),
      narrators: [],
      objective: text('Contrastar lo que cuentan Carmen y Rosario sobre el molino con la familia que lo llevaba.', 'Contrast what Carmen and Rosario say about the mill with the family that ran it.'),
      abstract: text('Todavía sin realizar. El acuerdo está pendiente de documentar.', 'Not yet conducted. The agreement is still to be documented.'),
      agreement: { status: 'pending', access: 'private', attribution: 'public_name', uses: [] },
      audio: 'none',
    });

    // ── Los fragmentos codificados, con códigos COMPARTIDOS ─────────────────
    const annotate = (
      key: string,
      index: number,
      source: { interviewId: string; transcriptId: string | null; segmentIds: string[] },
      segmentIndex: number,
      quote: string,
      codeIds: string[],
      memo: string | null,
      t: number,
    ) => {
      if (!source.transcriptId) return;
      const id = `${PREFIX}n-${key}-${index}`;
      insert('testimony_annotations', {
        id,
        short_id: `ANN-${String(index).padStart(4, '0')}`,
        interview_id: source.interviewId,
        transcript_id: source.transcriptId,
        segment_id: source.segmentIds[segmentIndex] ?? null,
        kind: 'highlight',
        t_start: t,
        t_end: t + 11,
        start_offset: null,
        end_offset: null,
        quote_snapshot: quote,
        memo,
        link_status: 'valid',
        created_at: AT,
        updated_at: AT,
      });
      for (const codeId of codeIds) {
        insert('testimony_annotation_codes', { annotation_id: id, code_id: codeId, created_at: AT });
      }
    };

    const partida = `${PREFIX}c-partida`;
    const hambre = `${PREFIX}c-hambre`;
    const escuela = `${PREFIX}c-escuela`;
    const silencio = `${PREFIX}c-silencio`;
    const regreso = `${PREFIX}c-regreso`;

    annotate('carmen', 1, carmen, 1, text('Mi padre se marchó en el cuarenta y siete. Yo tenía dieciséis años y me acuerdo del ruido del camión.', 'My father left in ’47. I was sixteen and I remember the sound of the lorry.'), [partida], text('Primera mención de la partida. Fecha precisa y detalle sensorial.', 'First mention of the departure. Precise date and sensory detail.'), 12);
    annotate('carmen', 2, carmen, 2, text('Nunca volvimos a saber de él hasta muchos años después. En casa no se hablaba de eso.', 'We never heard from him again until many years later. At home nobody talked about it.'), [partida, silencio], text('El silencio familiar aparece aquí por primera vez.', 'Family silence appears here for the first time.'), 24);
    annotate('carmen', 3, carmen, 3, text('Aquel invierno comimos lo que había. Mi madre hacía pan con lo que le daban en el molino.', 'That winter we ate whatever there was. My mother made bread with what they gave her at the mill.'), [hambre], null, 36);
    annotate('carmen', 4, carmen, 5, text('Hasta los catorce. Después ya no, porque hacía falta en casa.', 'Until I was fourteen. Not after that, because I was needed at home.'), [escuela], text('Coincide con lo que cuenta Tomás desde el otro lado del aula.', 'Matches what Tomás says from the other side of the classroom.'), 60);

    annotate('tomas', 5, tomas, 1, text('Los que se marchaban no volvían. Primero el padre, y al año siguiente la familia entera.', 'Those who left did not come back. First the father, and the following year the whole family.'), [partida, escuela], null, 12);
    annotate('tomas', 6, tomas, 3, text('No. Eso no se hablaba. Se sabía, pero no se decía.', 'No. That was not talked about. Everyone knew, but nobody said it.'), [silencio], text('El mismo silencio que describe Carmen, visto desde la escuela.', 'The same silence Carmen describes, seen from the school.'), 36);

    annotate('grupal', 7, grupal, 2, text('En casa no se decía lo que se ganaba. Eso tampoco se hablaba.', 'At home nobody said what they earned. That was another thing you did not talk about.'), [silencio], text('Tercera aparición del silencio, ahora sobre el dinero.', 'Third appearance of silence, this time about money.'), 24);

    annotate('miguel', 8, miguel, 0, text('Me fui en el cincuenta y siete con una maleta de cartón. Volví en el dos mil siete.', 'I left in ’57 with a cardboard suitcase. I came back in 2007.'), [partida, regreso], null, 0);
    annotate('miguel', 9, miguel, 3, text('No. Aquí no había nada. Pero tampoco puedo decir que ganara.', 'No. There was nothing here. But I cannot say I came out ahead either.'), [regreso], text('Contradice el relato de la emigración como éxito.', 'Contradicts the account of emigration as success.'), 36);

    // ── Un contraste guardado, con fragmentos fijados ───────────────────────
    const contrastId = `${PREFIX}k-silencio`;
    insert('testimony_contrasts', {
      id: contrastId,
      short_id: 'CTR-0001',
      title: text('Lo que no se contaba', 'What was never told'),
      filters_json: JSON.stringify({
        interviewIds: [carmen.interviewId, tomas.interviewId, grupal.interviewId, miguel.interviewId],
        codeIds: [silencio],
        mode: 'byTheme',
      }),
      memo_markdown: text(
        'Tres narradores describen el mismo silencio en tres ámbitos distintos: la familia, la escuela y el sueldo. Miguel Ángel no lo menciona en ningún momento, y esa ausencia no significa que no existiera: no se le preguntó por ello.',
        'Three narrators describe the same silence in three different settings: family, school and wages. Miguel Ángel never mentions it, and that absence does not mean it did not exist: he was never asked about it.'
      ),
      created_at: AT,
      updated_at: AT,
    });
    [`${PREFIX}n-carmen-2`, `${PREFIX}n-tomas-6`, `${PREFIX}n-grupal-7`].forEach((annotationId, position) => {
      insert('testimony_contrast_items', {
        contrast_id: contrastId,
        annotation_id: annotationId,
        position,
        note: null,
        created_at: AT,
      });
    });

    // ── Dos notas con enlaces al minuto exacto ──────────────────────────────
    const noteOne = `${PREFIX}note-silencio`;
    insert('notes', {
      id: noteOne,
      folder_id: null,
      title: text('El silencio como estrategia', 'Silence as a strategy'),
      content: text(
        `No callaban porque no lo supieran. Callaban porque decirlo tenía consecuencias, y las tres formas del silencio que aparecen en el corpus —la familia, la escuela y el sueldo— apuntan a lo mismo.\n\n> «Nunca volvimos a saber de él hasta muchos años después. En casa no se hablaba de eso.»\n\n— Carmen R., 00:00:24. [Abrir el fragmento en su minuto](nodus://testimonios/interview/${carmen.interviewId}?annotation=${PREFIX}n-carmen-2&t=24)\n\n> «Se sabía, pero no se decía.»\n\n— Tomás Aguilar Peña, 00:00:36. [Abrir el fragmento en su minuto](nodus://testimonios/interview/${tomas.interviewId}?annotation=${PREFIX}n-tomas-6&t=36)\n\nPendiente: preguntar por esto en la entrevista del molinero.`,
        `They were not silent because they did not know. They were silent because saying it had consequences, and the three forms of silence in the corpus — family, school and wages — all point the same way.\n\n> “We never heard from him again until many years later. At home nobody talked about it.”\n\n— Carmen R., 00:00:24. [Open the fragment at its timecode](nodus://testimonios/interview/${carmen.interviewId}?annotation=${PREFIX}n-carmen-2&t=24)\n\n> “Everyone knew, but nobody said it.”\n\n— Tomás Aguilar Peña, 00:00:36. [Open the fragment at its timecode](nodus://testimonios/interview/${tomas.interviewId}?annotation=${PREFIX}n-tomas-6&t=36)\n\nTo do: ask about this in the miller’s interview.`
      ),
      kind: 'markdown',
      source_json: null,
      order_idx: 0,
      created_at: AT,
      updated_at: AT,
    });
    const noteTwo = `${PREFIX}note-metodo`;
    insert('notes', {
      id: noteTwo,
      folder_id: null,
      title: text('Nota metodológica — la entrevista grupal', 'Methodological note — the group interview'),
      content: text(
        `Dos de las cinco personas presentes prefirieron no ser grabadas. Lo que dijeron no consta en la transcripción y no debe reconstruirse de memoria: sería atribuir palabras a quien decidió no darlas.\n\nEl embargo hasta 2031 lo pidió una de las participantes. Vence, pero **no se abre solo**: cuando llegue la fecha habrá que volver a preguntar.\n\n[Abrir la entrevista](nodus://testimonios/interview/${grupal.interviewId})`,
        `Two of the five people present preferred not to be recorded. What they said is not in the transcript and must not be reconstructed from memory: that would put words in the mouth of someone who chose not to give them.\n\nThe embargo until 2031 was requested by one participant. It expires, but **it does not open by itself**: when the date comes we will have to ask again.\n\n[Open the interview](nodus://testimonios/interview/${grupal.interviewId})`
      ),
      kind: 'markdown',
      source_json: null,
      order_idx: 1,
      created_at: AT,
      updated_at: AT,
    });
    const link = (noteId: string, kind: string, targetId: string, label: string) =>
      insert('testimony_note_links', { note_id: noteId, target_kind: kind, target_id: targetId, label, created_at: AT });
    link(noteOne, 'testimony_interview', carmen.interviewId, text('Entrevista a Carmen R.', 'Interview with Carmen R.'));
    link(noteOne, 'testimony_interview', tomas.interviewId, text('Entrevista a Tomás Aguilar', 'Interview with Tomás Aguilar'));
    link(noteOne, 'testimony_annotation', `${PREFIX}n-carmen-2`, text('En casa no se hablaba de eso', 'At home nobody talked about it'));
    link(noteOne, 'testimony_annotation', `${PREFIX}n-tomas-6`, text('Se sabía, pero no se decía', 'Everyone knew, but nobody said it'));
    link(noteOne, 'testimony_code', silencio, text('Silencio', 'Silence'));
    link(noteTwo, 'testimony_interview', grupal.interviewId, text('Entrevista grupal', 'Group interview'));
    link(noteTwo, 'testimony_contrast', contrastId, text('Lo que no se contaba', 'What was never told'));

    updateSettings({
      demoMode: true,
      testimonyProjectPurpose: text(
        'Recoger y conservar la memoria oral del valle antes de que se pierda con quienes la vivieron.',
        'Gather and preserve the valley’s oral memory before it is lost with those who lived it.'
      ),
      testimonyRepositoryName: text('Archivo Municipal del Valle', 'Valley Municipal Archive'),
      testimonyDefaultAccess: 'restricted',
      testimonyDefaultAttribution: 'public_name',
      testimonyNarratorReviewDefault: true,
      testimonyRetentionPolicy: text(
        'Depósito en el archivo municipal al cerrar el proyecto. Copia de seguridad mensual fuera del equipo.',
        'Deposit at the municipal archive when the project closes. Monthly backup kept off this machine.'
      ),
      testimonyDefaultLanguage: en ? 'en' : 'es',
    });
  });

  tx();
  return true;
}

/** Quitar la demo sin tocar lo que el usuario haya creado mientras la exploraba. */
export function clearTestimonyDemoData(): void {
  const db = getDb();
  // La bandera y el tipo de bóveda son la prueba de propiedad: quien borre a mano las
  // cinco entrevistas de la demo sigue teniendo sus notas y sus códigos, y una tabla
  // representativa dejaría el resto imposible de limpiar.
  if (!getSettings().demoMode || getActiveVault().type !== 'testimonios') return;

  const tx = db.transaction(() => {
    for (const table of [
      'testimony_contrast_items', 'testimony_contrasts', 'testimony_annotation_codes', 'testimony_annotations',
      'testimony_transcript_segments', 'testimony_transcripts', 'testimony_media', 'testimony_sessions',
      'testimony_agreements', 'testimony_interview_participants', 'testimony_interviews',
      'testimony_participant_profiles', 'testimony_codes', 'notes',
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE ${table === 'testimony_contrast_items' ? 'contrast_id' : table === 'testimony_annotation_codes' ? 'annotation_id' : table === 'testimony_interview_participants' ? 'interview_id' : table === 'testimony_participant_profiles' ? 'person_id' : 'id'} LIKE '${PREFIX}%'`).run();
    }
    db.prepare(`DELETE FROM testimony_note_links WHERE note_id LIKE '${PREFIX}%' OR target_id LIKE '${PREFIX}%'`).run();
    db.prepare(`DELETE FROM persons WHERE person_id LIKE '${PREFIX}%'`).run();
    // Los ajustes del proyecto también los escribió la demo: el propósito ficticio y el
    // archivo municipal inventado se quedarían presidiendo Inicio en un proyecto real.
    updateSettings({
      testimonyProjectPurpose: '',
      testimonyRepositoryName: '',
      testimonyRetentionPolicy: '',
      testimonyDefaultLanguage: '',
      testimonyDefaultAccess: 'private',
      testimonyDefaultAttribution: 'public_name',
      testimonyNarratorReviewDefault: false,
    });
  });
  tx();
}
