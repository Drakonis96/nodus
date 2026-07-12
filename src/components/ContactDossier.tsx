import { useCallback, useEffect, useState } from 'react';
import type { SocialContact, SocialRelation } from '@shared/types';
import { Icon } from './ui';
import { MarkdownNotesEditor } from './MarkdownNotesEditor';
import { confirm } from './feedback';
import { t, tx } from '../i18n';

/**
 * A lightweight card for a social contact — someone known only through a relation,
 * not themselves a tree member. Shows/edits their name and what's known about them,
 * plus a rollup of every relation that mentions them ("who knew this person"), which
 * is the prosopographical payoff of the social-relations graph.
 */
export function ContactDossier({
  contactId,
  onClose,
  onChanged,
  onOpenPerson,
}: {
  contactId: string;
  onClose: () => void;
  onChanged?: () => Promise<void> | void;
  onOpenPerson?: (personId: string) => void;
}) {
  const [contact, setContact] = useState<SocialContact | null>(null);
  const [mentions, setMentions] = useState<SocialRelation[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  const load = useCallback(async () => {
    const [c, m] = await Promise.all([
      window.nodus.getSocialContact(contactId),
      window.nodus.listSocialRelationsTargetingContact(contactId),
    ]);
    setContact(c);
    setNameDraft(c?.displayName ?? '');
    setMentions(m);
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!contact || !name || name === contact.displayName) return;
    setSavingName(true);
    try {
      await window.nodus.updateSocialContact(contact.contactId, { displayName: name });
      await load();
      await onChanged?.();
    } finally {
      setSavingName(false);
    }
  };

  const remove = async () => {
    if (!contact) return;
    const ok = await confirm({
      title: t('Eliminar contacto'),
      message: tx('¿Eliminar a «{name}»? Se eliminarán también las relaciones que lo mencionan.', { name: contact.displayName }),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteSocialContact(contact.contactId);
    await onChanged?.();
    onClose();
  };

  if (!contact) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card-modal flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-neutral-400">
            <Icon name="user" size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <input
                className="input h-8 min-w-0 flex-1 text-sm font-semibold"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => void saveName()}
                onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
              />
              {savingName && <Icon name="refresh" size={13} className="shrink-0 animate-spin text-neutral-500" />}
            </div>
            <p className="mt-0.5 text-xs text-neutral-500">{t('Contacto — no forma parte del árbol genealógico')}</p>
          </div>
          <button className="btn btn-ghost gap-1.5 text-red-300" onClick={() => void remove()}>
            <Icon name="trash" size={14} /> {t('Eliminar')}
          </button>
          <button className="btn btn-ghost px-2 py-1" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Qué sabemos de esta persona')}</h3>
          <MarkdownNotesEditor
            value={contact.notes}
            placeholder={t('Ocupación, fechas, lugar… lo que se sepa, en Markdown.')}
            onSave={async (next) => {
              await window.nodus.updateSocialContact(contact.contactId, { notes: next || null });
              await load();
              await onChanged?.();
            }}
          />
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {t('Mencionado por')} <span className="text-neutral-600">({mentions.length})</span>
          </h3>
          {mentions.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('Ninguna persona del árbol lo relaciona todavía.')}</p>
          ) : (
            <ul className="space-y-1.5">
              {mentions.map((m) => (
                <li key={m.relationId} className="rounded-md border border-neutral-800 px-3 py-2 text-sm">
                  <button
                    className={`font-medium text-neutral-200 ${onOpenPerson ? 'hover:underline' : 'cursor-default'}`}
                    onClick={() => onOpenPerson?.(m.personId)}
                  >
                    {m.personName}
                  </button>{' '}
                  <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] uppercase text-neutral-400">{m.role}</span>
                  {m.notes?.trim() && <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-500">{m.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
        </div>
      </div>
    </div>
  );
}
