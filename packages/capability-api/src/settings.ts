import { SLUG, exactKeys } from './json';
import { validateLocalizedText, type LocalizedText } from './localized';
import { validateViewDocument, type ViewDocumentV1 } from './views';

/** A plugin describes its own configuration; the core renders it generically. This is why
 *  Alpha Genome's key, terms and runtime button stop being core UI. */

export type SettingsFieldV1 =
  | { kind: 'secret'; id: string; label: LocalizedText; description?: LocalizedText; required: boolean }
  | { kind: 'consent'; id: string; label: LocalizedText; version: number; termsUrl?: string; description?: LocalizedText }
  | { kind: 'text'; id: string; label: LocalizedText; description?: LocalizedText; maxLength: number }
  | { kind: 'toggle'; id: string; label: LocalizedText; description?: LocalizedText }
  | { kind: 'select'; id: string; label: LocalizedText; description?: LocalizedText; options: Array<{ value: string; label: LocalizedText }> };

export interface SettingsActionV1 {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  tone?: 'neutral' | 'danger';
  confirm?: LocalizedText;
}

export interface SettingsManifestV1 {
  fields: SettingsFieldV1[];
  actions: SettingsActionV1[];
}

/** What the panel shows now. A secret is reported as configured or not; never as a value. */
export interface SettingsStateV1 {
  fields: Record<string, { configured?: boolean; value?: string | boolean }>;
  status?: { state: 'ok' | 'pending' | 'failed'; label: LocalizedText };
  /** Optional plugin-authored explanation rendered below the fields. */
  view?: ViewDocumentV1;
  /** Actions the plugin wants disabled right now, with a reason. */
  disabledActions?: Record<string, LocalizedText>;
}

export interface SettingsSubmissionV1 {
  fields: Record<string, string | boolean>;
}

export interface SettingsActionInput {
  actionId: string;
}

function validateField(input: unknown): SettingsFieldV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid settings field.');
  const field = input as SettingsFieldV1;
  if (!SLUG.test(String(field.id))) throw new Error('Invalid settings field id.');
  const label = validateLocalizedText(field.label, 120);
  const description = field.description === undefined ? undefined : validateLocalizedText(field.description, 500);
  const base = { id: field.id, label, ...(description ? { description } : {}) };
  switch (field.kind) {
    case 'secret':
      if (typeof field.required !== 'boolean') throw new Error('Invalid secret field.');
      return { kind: 'secret', ...base, required: field.required };
    case 'consent': {
      if (!Number.isInteger(field.version) || field.version < 1) throw new Error('Invalid consent field.');
      if (field.termsUrl !== undefined) {
        let url: URL;
        try { url = new URL(field.termsUrl); } catch { throw new Error('Invalid consent terms URL.'); }
        if (url.protocol !== 'https:') throw new Error('Consent terms must be an https URL.');
      }
      return { kind: 'consent', ...base, version: field.version, ...(field.termsUrl ? { termsUrl: field.termsUrl } : {}) };
    }
    case 'text':
      if (!Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > 4_000) throw new Error('Invalid text field.');
      return { kind: 'text', ...base, maxLength: field.maxLength };
    case 'toggle':
      return { kind: 'toggle', ...base };
    case 'select':
      if (!Array.isArray(field.options) || !field.options.length || field.options.length > 40) throw new Error('Invalid select field.');
      return { kind: 'select', ...base, options: field.options.map(option => {
        if (!option || !exactKeys(option, ['value', 'label']) || !SLUG.test(String(option.value))) throw new Error('Invalid select option.');
        return { value: option.value, label: validateLocalizedText(option.label, 120) };
      }) };
    default:
      throw new Error('Unsupported settings field.');
  }
}

export function validateSettingsManifest(input: unknown): SettingsManifestV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !exactKeys(input, ['fields', 'actions'])) throw new Error('Invalid settings manifest.');
  const value = input as SettingsManifestV1;
  if (!Array.isArray(value.fields) || value.fields.length > 24 || !Array.isArray(value.actions) || value.actions.length > 12) throw new Error('Invalid settings manifest.');
  const ids = new Set<string>();
  const fields = value.fields.map(raw => {
    const field = validateField(raw);
    if (ids.has(field.id)) throw new Error('Duplicate settings field.');
    ids.add(field.id);
    return field;
  });
  const actionIds = new Set<string>();
  const actions = value.actions.map(raw => {
    if (!raw || !SLUG.test(String(raw.id)) || actionIds.has(raw.id)) throw new Error('Invalid settings action.');
    if (raw.tone !== undefined && !['neutral', 'danger'].includes(raw.tone)) throw new Error('Invalid settings action tone.');
    actionIds.add(raw.id);
    return {
      id: raw.id,
      label: validateLocalizedText(raw.label, 120),
      ...(raw.description ? { description: validateLocalizedText(raw.description, 500) } : {}),
      ...(raw.tone ? { tone: raw.tone } : {}),
      ...(raw.confirm ? { confirm: validateLocalizedText(raw.confirm, 500) } : {}),
    } satisfies SettingsActionV1;
  });
  return { fields, actions };
}

/** Guards the worker's answer: a plugin cannot leak a stored secret back through state. */
export function validateSettingsState(input: unknown, manifest: SettingsManifestV1): SettingsStateV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['fields', 'status', 'view', 'disabledActions'].includes(key))) throw new Error('Invalid settings state.');
  const value = input as SettingsStateV1;
  if (!value.fields || typeof value.fields !== 'object' || Array.isArray(value.fields)) throw new Error('Invalid settings state fields.');
  const fields: SettingsStateV1['fields'] = {};
  for (const [id, raw] of Object.entries(value.fields)) {
    const declared = manifest.fields.find(field => field.id === id);
    if (!declared || !raw || typeof raw !== 'object' || Array.isArray(raw) || !exactKeys(raw, ['configured', 'value']) && !exactKeys(raw, ['configured']) && !exactKeys(raw, ['value'])) throw new Error(`Undeclared settings field: ${id}.`);
    if (declared.kind === 'secret') {
      if ('value' in raw) throw new Error('A secret field must not report its value.');
      fields[id] = { configured: Boolean(raw.configured) };
      continue;
    }
    if (raw.value !== undefined && typeof raw.value !== 'string' && typeof raw.value !== 'boolean') throw new Error(`Invalid settings value for ${id}.`);
    if (declared.kind === 'text' && typeof raw.value === 'string' && raw.value.length > declared.maxLength) throw new Error(`Settings value too long for ${id}.`);
    if (declared.kind === 'select' && raw.value !== undefined && !declared.options.some(option => option.value === raw.value)) throw new Error(`Settings value outside the declared options for ${id}.`);
    fields[id] = { ...(raw.configured !== undefined ? { configured: Boolean(raw.configured) } : {}), ...(raw.value !== undefined ? { value: raw.value } : {}) };
  }
  const disabledActions: Record<string, LocalizedText> = {};
  for (const [id, reason] of Object.entries(value.disabledActions ?? {})) {
    if (!manifest.actions.some(action => action.id === id)) throw new Error(`Undeclared settings action: ${id}.`);
    disabledActions[id] = validateLocalizedText(reason, 300);
  }
  return {
    fields,
    ...(value.status ? { status: { state: ((): 'ok' | 'pending' | 'failed' => {
      if (!['ok', 'pending', 'failed'].includes(value.status!.state)) throw new Error('Invalid settings status.');
      return value.status!.state;
    })(), label: validateLocalizedText(value.status.label, 300) } } : {}),
    ...(value.view ? { view: validateViewDocument(value.view) } : {}),
    ...(Object.keys(disabledActions).length ? { disabledActions } : {}),
  };
}

/** Guards what the renderer sends down. Secret values never round-trip through state,
 *  but they do arrive here once, on their way to the secret store. */
export function validateSettingsSubmission(input: unknown, manifest: SettingsManifestV1): SettingsSubmissionV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !exactKeys(input, ['fields'])) throw new Error('Invalid settings submission.');
  const value = input as SettingsSubmissionV1;
  if (!value.fields || typeof value.fields !== 'object' || Array.isArray(value.fields)) throw new Error('Invalid settings submission.');
  const fields: SettingsSubmissionV1['fields'] = {};
  for (const [id, raw] of Object.entries(value.fields)) {
    const declared = manifest.fields.find(field => field.id === id);
    if (!declared) throw new Error(`Undeclared settings field: ${id}.`);
    if (declared.kind === 'toggle' || declared.kind === 'consent') {
      if (typeof raw !== 'boolean') throw new Error(`Settings field ${id} expects a boolean.`);
    } else if (typeof raw !== 'string' || raw.length > (declared.kind === 'text' ? declared.maxLength : 8_000)) {
      throw new Error(`Settings field ${id} expects text.`);
    } else if (declared.kind === 'select' && !declared.options.some(option => option.value === raw)) {
      throw new Error(`Settings value outside the declared options for ${id}.`);
    }
    fields[id] = raw;
  }
  return { fields };
}
