import { archiveDocTypesByCategory, getArchiveDocType } from '@shared/archiveDocTypes';
import { t } from '../i18n';

export function docTypeLabel(id: string | null | undefined): string {
  const def = getArchiveDocType(id);
  return def ? t(def.label) : '';
}

/** Grouped <select> over the primary-source document types. */
export function DocTypeSelect({
  value,
  onChange,
  emptyLabel,
  className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  emptyLabel?: string;
  className?: string;
}) {
  return (
    <select
      className={className ?? 'input h-9 w-full text-sm'}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{emptyLabel ? t(emptyLabel) : t('Sin clasificar')}</option>
      {archiveDocTypesByCategory().map((group) => (
        <optgroup key={group.category} label={t(group.label)}>
          {group.types.map((def) => (
            <option key={def.id} value={def.id}>
              {t(def.label)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** The optional metadata form for a document type. Empty when no type is chosen. */
export function DocTypeForm({
  docType,
  values,
  onChange,
}: {
  docType: string | null;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const def = getArchiveDocType(docType);
  if (!def) return null;
  return (
    <div className="space-y-2">
      {def.fields.map((field) =>
        field.type === 'textarea' ? (
          <label key={field.key} className="block space-y-1">
            <span className="text-xs text-neutral-500">{t(field.label)}</span>
            <textarea
              className="input min-h-[3.5rem] w-full text-sm"
              value={values[field.key] ?? ''}
              placeholder={field.placeholder}
              onChange={(e) => onChange(field.key, e.target.value)}
            />
          </label>
        ) : (
          <label key={field.key} className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-2">
            <span className="text-xs text-neutral-500">{t(field.label)}</span>
            <input
              className="input h-8 w-full text-sm"
              type={field.type === 'number' ? 'number' : 'text'}
              value={values[field.key] ?? ''}
              placeholder={field.placeholder}
              onChange={(e) => onChange(field.key, e.target.value)}
            />
          </label>
        )
      )}
    </div>
  );
}
