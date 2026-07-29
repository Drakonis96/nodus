/**
 * El vocabulario visible del vault de Testimonios, en español (la lengua fuente).
 *
 * Está en `shared/` y no en el renderer porque los mismos términos los usan los prompts
 * de IA y los paquetes de exportación: un README archivístico que llame «restringido» a
 * lo que la pantalla llama «Restringida» son dos sistemas hablando.
 *
 * Cada cadena llega a la interfaz INDIRECTAMENTE, como `t(LABEL[x])`, así que este
 * archivo está registrado en INDIRECT_KEY_SOURCES de scripts/test-i18n-coverage.mjs.
 * Añadir una entrada sin traducirla es exactamente cómo la genealogía se publicó a
 * medio traducir.
 *
 * Sobre las palabras: el plan (16) exige que la traducción distinga Participante,
 * Narrador/a, Entrevistador/a, Testimonio, Entrevista, Transcripción, Acuerdo y
 * Restricción de acceso. No son sinónimos y colapsarlos en «fuente» o «informante»
 * borra justamente la agencia que este vault reconoce al narrador.
 */

import type {
  AccessLevel,
  AgreementStatus,
  AnnotationKind,
  AttributionMode,
  CodeKind,
  DocumentedUse,
  IdentityMode,
  InterviewKind,
  InterviewMode,
  InterviewWorkflowStatus,
  MediaKind,
  MediaRole,
  NarratorReviewStatus,
  ParticipantRole,
  SessionStatus,
  TranscriptKind,
  TranscriptStatus,
} from './testimonies';
import type { AccessChannel, AccessDenialReason } from './testimonyAccess';

export const WORKFLOW_STATUS_LABEL: Record<InterviewWorkflowStatus, string> = {
  preparation: 'Preparación',
  scheduled: 'Programada',
  recorded: 'Grabada',
  transcribing: 'Transcribiendo',
  reviewing: 'En revisión',
  narrator_review: 'Revisión del narrador',
  completed: 'Completada',
  archived: 'Archivada',
  cancelled: 'Cancelada',
};

export const AGREEMENT_STATUS_LABEL: Record<AgreementStatus, string> = {
  pending: 'Pendiente',
  documented: 'Documentado',
  update_required: 'Requiere actualización',
  withdrawn: 'Retirado',
};

export const ACCESS_LEVEL_LABEL: Record<AccessLevel, string> = {
  private: 'Privado',
  restricted: 'Restringido',
  embargoed: 'Embargado',
  open: 'Abierto',
};

/** Lo que significa cada nivel, en una frase. Va en el selector, no en la ayuda. */
export const ACCESS_LEVEL_HINT: Record<AccessLevel, string> = {
  private: 'Solo dentro de esta bóveda. No sale en ninguna exportación pública.',
  restricted: 'Uso limitado a lo documentado en el acuerdo; no entra en paquetes de consulta.',
  embargoed: 'Bloqueado hasta la fecha indicada. Al vencer avisa, pero no se abre solo.',
  open: 'Puede difundirse según los usos documentados en el acuerdo.',
};

export const ATTRIBUTION_MODE_LABEL: Record<AttributionMode, string> = {
  real_name: 'Nombre real',
  public_name: 'Nombre público o seudónimo',
  anonymous: 'Anónimo',
};

export const NARRATOR_REVIEW_STATUS_LABEL: Record<NarratorReviewStatus, string> = {
  not_started: 'Sin iniciar',
  sent: 'Enviada',
  changes_requested: 'Cambios solicitados',
  approved: 'Aprobada',
  unavailable: 'No fue posible revisar',
};

export const DOCUMENTED_USE_LABEL: Record<DocumentedUse, string> = {
  research: 'Investigación',
  teaching: 'Docencia',
  publication: 'Publicación impresa',
  broadcast: 'Radio, televisión o pódcast',
  web_publication: 'Publicación en internet',
  exhibition: 'Exposición o acto público',
  deposit: 'Depósito en un archivo o repositorio',
  ai_processing: 'Procesamiento con IA en este equipo',
  external_processing: 'Envío a un proveedor externo',
};

export const INTERVIEW_KIND_LABEL: Record<InterviewKind, string> = {
  life_history: 'Historia de vida',
  thematic: 'Temática',
  follow_up: 'Seguimiento',
  group: 'Grupal',
  other: 'Otra',
};

export const INTERVIEW_MODE_LABEL: Record<InterviewMode, string> = {
  in_person: 'Presencial',
  remote: 'A distancia',
  phone: 'Teléfono',
  other: 'Otra',
};

export const PARTICIPANT_ROLE_LABEL: Record<ParticipantRole, string> = {
  narrator: 'Narrador/a',
  interviewer: 'Entrevistador/a',
  facilitator: 'Facilitador/a',
  translator: 'Intérprete o traductor/a',
  technician: 'Técnico/a',
  other: 'Otro papel',
};

export const IDENTITY_MODE_LABEL: Record<IdentityMode, string> = {
  identified: 'Nombre real',
  pseudonym: 'Seudónimo',
  anonymous: 'Anonimizado',
};

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  planned: 'Prevista',
  recorded: 'Grabada',
  processed: 'Procesada',
  cancelled: 'Cancelada',
};

export const MEDIA_KIND_LABEL: Record<MediaKind, string> = {
  audio: 'Audio',
  video: 'Vídeo',
  document: 'Documento',
  image: 'Imagen',
};

export const MEDIA_ROLE_LABEL: Record<MediaRole, string> = {
  master: 'Original maestro',
  access_copy: 'Copia de consulta',
  related: 'Material relacionado',
};

export const TRANSCRIPT_KIND_LABEL: Record<TranscriptKind, string> = {
  machine_literal: 'Automática literal',
  corrected: 'Corregida',
  reviewed: 'Revisada',
  approved: 'Aprobada',
  anonymized: 'Anonimizada',
  translation: 'Traducción',
};

/** Qué es cada versión. La diferencia entre corregir y revisar no es obvia y se explica. */
export const TRANSCRIPT_KIND_HINT: Record<TranscriptKind, string> = {
  machine_literal: 'Lo que el modelo transcribió, sin tocar. No se puede editar: es la base de todo lo demás.',
  corrected: 'Corrige errores de reconocimiento sin reescribir la forma de hablar.',
  reviewed: 'Versión trabajada por el investigador.',
  approved: 'Versión acordada con el narrador. Queda bloqueada; para cambiarla se deriva una revisión nueva.',
  anonymized: 'Derivado con las identidades ocultas, preparado para usos que lo exigen.',
  translation: 'Derivado en otra lengua, siempre unido a la versión de la que procede.',
};

export const TRANSCRIPT_STATUS_LABEL: Record<TranscriptStatus, string> = {
  pending: 'En cola',
  processing: 'Transcribiendo',
  ready: 'Lista para revisar',
  error: 'Error',
  cancelled: 'Cancelada',
};

export const ANNOTATION_KIND_LABEL: Record<AnnotationKind, string> = {
  highlight: 'Fragmento',
  memo: 'Memo',
  redaction: 'Marca de anonimización',
};

export const CODE_KIND_LABEL: Record<CodeKind, string> = {
  code: 'Código',
  theme: 'Tema',
};

export const ACCESS_CHANNEL_LABEL: Record<AccessChannel, string> = {
  localSearch: 'Búsqueda local',
  localAi: 'IA en este equipo',
  externalAi: 'IA de un proveedor externo',
  externalTranscription: 'Transcripción en un proveedor externo',
  embeddingIndex: 'Índice semántico',
  preservationExport: 'Paquete de preservación',
  accessExport: 'Paquete de consulta',
  reviewExport: 'Paquete de revisión',
};

/**
 * Por qué se ha denegado, dicho de forma que el usuario sepa QUÉ HACER. «Acceso
 * denegado» es información inútil; «el acuerdo no documenta el envío a proveedores
 * externos» le dice dónde ir a arreglarlo.
 */
export const ACCESS_DENIAL_LABEL: Record<AccessDenialReason, string> = {
  agreement_withdrawn: 'El acuerdo está retirado: nada puede salir de la bóveda hasta que lo decidas a mano.',
  agreement_pending: 'El acuerdo todavía no está documentado.',
  agreement_update_required: 'El acuerdo necesita actualizarse antes de volver a usar este material.',
  embargo_active: 'La entrevista está embargada.',
  access_private: 'La entrevista es privada.',
  access_restricted: 'La entrevista tiene el acceso restringido.',
  use_not_documented: 'El acuerdo no documenta ningún uso de difusión para esta entrevista.',
  external_not_documented: 'El acuerdo no documenta el envío a proveedores externos.',
  ai_not_documented: 'El acuerdo no documenta el procesamiento con IA.',
  vault_external_disabled: 'Los proveedores externos están desactivados en los ajustes de esta bóveda.',
};

/** Las alertas de Inicio, en su orden de prioridad (7.1). */
export type TestimonyAlertKind =
  | 'upcoming'
  | 'agreement_missing'
  | 'backup_stale'
  | 'transcription_error'
  | 'transcription_pending_review'
  | 'narrator_review_pending'
  | 'embargo_expiring'
  | 'annotation_needs_review'
  | 'master_missing';

export const ALERT_LABEL: Record<TestimonyAlertKind, string> = {
  upcoming: 'Entrevistas próximas',
  agreement_missing: 'Grabaciones sin acuerdo documentado',
  backup_stale: 'Archivos sin copia de seguridad reciente',
  transcription_error: 'Transcripciones con error',
  transcription_pending_review: 'Transcripciones pendientes de revisión',
  narrator_review_pending: 'Revisión del narrador pendiente',
  embargo_expiring: 'Embargos próximos a vencer',
  annotation_needs_review: 'Fragmentos cuyo enlace necesita revisión',
  master_missing: 'Entrevistas grabadas sin archivo original',
};

export const ALERT_HINT: Record<TestimonyAlertKind, string> = {
  upcoming: 'Tienes entrevistas previstas que aún no se han grabado.',
  agreement_missing: 'Hay material grabado cuyo acuerdo sigue pendiente de documentar.',
  backup_stale: 'Los originales de esta bóveda no están en ninguna copia reciente.',
  transcription_error: 'Alguna transcripción falló y puede reintentarse.',
  transcription_pending_review: 'Hay transcripciones automáticas que nadie ha revisado todavía.',
  narrator_review_pending: 'Enviaste una revisión al narrador y sigue sin respuesta registrada.',
  embargo_expiring: 'Un embargo vence pronto. Nodus avisa, pero no abre el acceso por su cuenta.',
  annotation_needs_review: 'Una versión nueva de la transcripción dejó fragmentos sin reanclar con seguridad.',
  master_missing: 'Una entrevista consta como grabada pero no tiene ningún archivo maestro.',
};
