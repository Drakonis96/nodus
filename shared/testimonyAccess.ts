/**
 * La puerta central de acceso del vault de Testimonios.
 *
 * «Restringida» no puede ser una etiqueta decorativa (principio 3.6 del plan). Este
 * módulo es la ÚNICA implementación de esa promesa: quien quiera sacar material de una
 * entrevista — la IA local, un proveedor externo, un exportador, la búsqueda semántica —
 * pasa por `evaluateAccess`. No hay una segunda copia de estas reglas en el exportador
 * ni en el constructor de prompts, porque dos copias de una regla de privacidad son una
 * regla de privacidad y un agujero.
 *
 * Puro a propósito: sin base de datos, sin ficheros, sin reloj propio. `now` se pasa
 * como argumento para que un embargo pueda probarse sin esperar a que venza.
 */

import type {
  AccessLevel,
  AgreementStatus,
  AttributionMode,
  DocumentedUse,
  IdentityMode,
  NarratorReviewStatus,
} from './testimonies';

/**
 * Por dónde puede salir el material. Los canales están separados por DESTINO, no por
 * función: lo que importa para el narrador no es si el botón se llamaba «resumir» o
 * «traducir», sino si su voz salió del equipo.
 */
export type AccessChannel =
  /** Búsqueda y navegación dentro de la propia aplicación. */
  | 'localSearch'
  /** Modelo que corre en este equipo (Whisper local, Ollama, LM Studio). */
  | 'localAi'
  /** Proveedor remoto: el texto sale del equipo. */
  | 'externalAi'
  /** Proveedor remoto de transcripción: el AUDIO sale del equipo. */
  | 'externalTranscription'
  /** Índice de embeddings (local o remoto según el proveedor configurado). */
  | 'embeddingIndex'
  /** Paquete de preservación: todo, para el archivo o el depósito. */
  | 'preservationExport'
  /** Paquete de consulta: material que puede ver alguien ajeno al proyecto. */
  | 'accessExport'
  /** Paquete de revisión: para el propio narrador. */
  | 'reviewExport';

export const ACCESS_CHANNELS: AccessChannel[] = [
  'localSearch',
  'localAi',
  'externalAi',
  'externalTranscription',
  'embeddingIndex',
  'preservationExport',
  'accessExport',
  'reviewExport',
];

/** Por qué se ha denegado. Las claves se traducen en `testimonyLabels`. */
export type AccessDenialReason =
  | 'agreement_withdrawn'
  | 'agreement_pending'
  | 'agreement_update_required'
  | 'embargo_active'
  | 'access_private'
  | 'access_restricted'
  | 'use_not_documented'
  | 'external_not_documented'
  | 'ai_not_documented'
  | 'vault_external_disabled';

export interface AccessDecision {
  allowed: boolean;
  reason?: AccessDenialReason;
  /**
   * Permitido, pero el material debe salir con los nombres sustituidos. Es distinto de
   * denegar: una entrevista con seudónimo SÍ puede publicarse, y confundir ambas cosas
   * es lo que empuja al investigador a exportar por fuera del programa.
   */
  requiresPseudonymization: boolean;
  /** Permitido, pero exige una confirmación explícita del usuario en ese momento. */
  requiresConfirmation: boolean;
}

/** El estado del acuerdo vigente, reducido a lo que la puerta necesita saber. */
export interface AccessContext {
  agreementStatus: AgreementStatus;
  accessLevel: AccessLevel;
  attributionMode: AttributionMode;
  /** ISO; `null` = embargo sin fecha, que NO vence solo. */
  embargoUntil?: string | null;
  documentedUses: readonly DocumentedUse[];
  narratorReviewRequired?: boolean;
  narratorReviewStatus?: NarratorReviewStatus;
}

/** Preferencias del vault que pueden cerrar un canal aunque el acuerdo lo permita. */
export interface VaultAccessPolicy {
  /** Ajustes → Testimonios. Desactivado por omisión (el plan lo pide explícito). */
  allowExternalProviders: boolean;
}

export const DEFAULT_VAULT_ACCESS_POLICY: VaultAccessPolicy = { allowExternalProviders: false };

const DENIED = (reason: AccessDenialReason): AccessDecision => ({
  allowed: false,
  reason,
  requiresPseudonymization: false,
  requiresConfirmation: false,
});

/**
 * Si el embargo sigue vigente en `now`.
 *
 * Sin fecha significa vigente para siempre hasta que alguien lo levante a mano: un
 * embargo indefinido que se abriera solo sería la peor clase de fallo silencioso. Y
 * cuando la fecha vence, esta función deja de bloquear pero el nivel de acceso NO
 * cambia solo en la base de datos — el plan lo pide así (13): vencer avisa, no abre.
 */
export function isEmbargoActive(embargoUntil: string | null | undefined, now: Date): boolean {
  if (embargoUntil === undefined) return false;
  if (embargoUntil === null || embargoUntil === '') return true;
  const until = Date.parse(embargoUntil);
  if (Number.isNaN(until)) return true;
  return now.getTime() < until;
}

/** Días que faltan para que venza un embargo con fecha; null si no procede. */
export function daysUntilEmbargoEnds(embargoUntil: string | null | undefined, now: Date): number | null {
  if (!embargoUntil) return null;
  const until = Date.parse(embargoUntil);
  if (Number.isNaN(until)) return null;
  return Math.ceil((until - now.getTime()) / 86_400_000);
}

/**
 * La decisión. Se lee de arriba abajo y el primer NO gana:
 *
 *  1. Retirado bloquea TODO menos mirar en local. Es la petición más fuerte que un
 *     narrador puede hacer y no admite matices por canal.
 *  2. Un embargo vigente bloquea cualquier salida, aunque el acuerdo esté documentado.
 *  3. El nivel de acceso decide qué sale del proyecto.
 *  4. El uso concreto tiene que estar documentado para salir a un tercero o a una IA.
 *  5. La política del vault puede cerrar los proveedores externos aunque todo lo demás
 *     lo permita — nunca al revés: la preferencia del equipo no abre lo que el acuerdo
 *     cierra.
 */
export function evaluateAccess(
  context: AccessContext,
  channel: AccessChannel,
  options: { now?: Date; policy?: VaultAccessPolicy } = {},
): AccessDecision {
  const now = options.now ?? new Date();
  const policy = options.policy ?? DEFAULT_VAULT_ACCESS_POLICY;
  const uses = new Set(context.documentedUses);
  const pseudonymize = context.attributionMode !== 'real_name';

  // 1. La navegación local siempre se permite: el investigador tiene que poder ver lo
  //    que custodia, incluso — sobre todo — cuando está retirado y hay que decidir qué
  //    hacer con ello. Lo que se bloquea es que salga.
  if (channel === 'localSearch') {
    return { allowed: true, requiresPseudonymization: false, requiresConfirmation: false };
  }

  // 2. Retirada: nada sale, por ningún canal, hasta una decisión manual (8.3).
  if (context.agreementStatus === 'withdrawn') return DENIED('agreement_withdrawn');

  // 3. La revisión del narrador es el único paquete que puede prepararse SIN acuerdo
  //    documentado, porque muchas veces es justo lo que se envía para obtenerlo.
  if (channel === 'reviewExport') {
    if (isEmbargoActive(context.embargoUntil, now) && context.accessLevel === 'embargoed') {
      // Un embargo protege del público, no del propio narrador.
      return { allowed: true, requiresPseudonymization: false, requiresConfirmation: false };
    }
    return { allowed: true, requiresPseudonymization: false, requiresConfirmation: false };
  }

  if (context.agreementStatus === 'pending') {
    // Sin acuerdo documentado no sale nada a terceros ni a un modelo. El paquete de
    // preservación es la excepción razonada: guardar en el archivo institucional lo que
    // aún no tiene acuerdo es exactamente lo que hay que hacer con ello.
    if (channel !== 'preservationExport') return DENIED('agreement_pending');
  }
  if (context.agreementStatus === 'update_required' && channel !== 'preservationExport') {
    return DENIED('agreement_update_required');
  }

  const embargoActive = context.accessLevel === 'embargoed' && isEmbargoActive(context.embargoUntil, now);

  switch (channel) {
    case 'localAi': {
      if (embargoActive) return DENIED('embargo_active');
      if (!uses.has('ai_processing')) return DENIED('ai_not_documented');
      return { allowed: true, requiresPseudonymization: pseudonymize, requiresConfirmation: false };
    }
    case 'embeddingIndex': {
      if (embargoActive) return DENIED('embargo_active');
      // Un índice de embeddings es material derivado que sobrevive a la entrevista y
      // puede acabar en un proveedor remoto según la configuración; por eso exige el
      // mismo uso documentado que la IA y no el de la búsqueda textual.
      if (!uses.has('ai_processing')) return DENIED('ai_not_documented');
      return { allowed: true, requiresPseudonymization: pseudonymize, requiresConfirmation: false };
    }
    case 'externalAi':
    case 'externalTranscription': {
      if (embargoActive) return DENIED('embargo_active');
      if (!policy.allowExternalProviders) return DENIED('vault_external_disabled');
      if (!uses.has('external_processing')) return DENIED('external_not_documented');
      if (context.accessLevel === 'private') return DENIED('access_private');
      return { allowed: true, requiresPseudonymization: pseudonymize, requiresConfirmation: true };
    }
    case 'accessExport': {
      if (embargoActive) return DENIED('embargo_active');
      if (context.accessLevel === 'private') return DENIED('access_private');
      if (context.accessLevel === 'restricted') return DENIED('access_restricted');
      if (!uses.has('publication') && !uses.has('web_publication') && !uses.has('exhibition') && !uses.has('teaching')) {
        return DENIED('use_not_documented');
      }
      return { allowed: true, requiresPseudonymization: pseudonymize, requiresConfirmation: false };
    }
    case 'preservationExport': {
      // El paquete de preservación es el destino archivístico del material: no lo
      // limita el nivel de acceso, lo limita la retirada (ya comprobada arriba). Lo que
      // sí exige es que el usuario confirme, porque contiene los maestros.
      return { allowed: true, requiresPseudonymization: false, requiresConfirmation: true };
    }
    default:
      return DENIED('access_restricted');
  }
}

/** Atajo legible para las pantallas: solo el booleano. */
export function isAllowed(
  context: AccessContext,
  channel: AccessChannel,
  options: { now?: Date; policy?: VaultAccessPolicy } = {},
): boolean {
  return evaluateAccess(context, channel, options).allowed;
}

/**
 * El acuerdo por omisión cuando una entrevista todavía no tiene ninguno. No es un
 * acuerdo real: es el estado más restrictivo posible, para que el hueco entre crear una
 * entrevista y documentar su acuerdo nunca sea un hueco PERMISIVO.
 */
export function pendingAccessContext(): AccessContext {
  return {
    agreementStatus: 'pending',
    accessLevel: 'private',
    attributionMode: 'public_name',
    embargoUntil: undefined,
    documentedUses: [],
    narratorReviewRequired: false,
    narratorReviewStatus: 'not_started',
  };
}

/**
 * Qué nombre puede llevar el material que sale por este canal. Reúne el modo de
 * identificación de la persona con el modo de atribución del acuerdo: gana el más
 * restrictivo de los dos, siempre.
 */
export function effectiveAttribution(identityMode: IdentityMode, attribution: AttributionMode): AttributionMode {
  if (identityMode === 'anonymous' || attribution === 'anonymous') return 'anonymous';
  if (identityMode === 'pseudonym' || attribution === 'public_name') return 'public_name';
  return 'real_name';
}
