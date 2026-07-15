import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Person, SocialContact, SocialRelation } from '@shared/types';
import { Icon } from './ui';
import { MarkdownNotesEditor } from './MarkdownNotesEditor';
import { ContactDossier } from './ContactDossier';
import { SearchableMultiSelect, type SearchableMultiSelectOption } from './PersonMultiSelect';
import { confirm } from './feedback';
import { t, tx } from '../i18n';

/**
 * The social-relations network, from a single person's ficha: connections beyond
 * kinship (friends, patrons, employers, rivals, correspondents...) — the material a
 * social/prosopographical historian works with. A SECOND graph, independent from
 * the family tree (see RelationsView for the whole-corpus view). Relations are
 * recorded here, from this person's side; relations recorded by someone ELSE that
 * name this person are shown read-only, with a link to edit them at the source.
 */
export function RelationsSection({
  personId,
  onNavigate,
}: {
  personId: string;
  onNavigate?: (personId: string) => void;
}) {
  const [outgoing, setOutgoing] = useState<SocialRelation[]>([]);
  const [incoming, setIncoming] = useState<SocialRelation[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingContactId, setViewingContactId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [out, inc] = await Promise.all([
      window.nodus.listSocialRelationsForPerson(personId),
      window.nodus.listSocialRelationsTargetingPerson(personId),
    ]);
    setOutgoing(out);
    setIncoming(inc);
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openTarget = (r: SocialRelation) => {
    if (r.targetKind === 'person') onNavigate?.(r.targetId);
    else setViewingContactId(r.targetId);
  };

  const removeRelation = async (r: SocialRelation) => {
    const ok = await confirm({
      title: t('Eliminar relación'),
      message: tx('¿Eliminar la relación con {name}?', { name: r.targetName }),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteSocialRelation(r.relationId);
    await load();
  };

  return (
    <section className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {t('Relaciones sociales')} <span className="text-neutral-600">({outgoing.length})</span>
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
            {t('Conexiones más allá del parentesco: amistades, patronazgo, empleo, rivalidad, correspondencia… Un árbol independiente del genealógico.')}
          </p>
        </div>
        <button
          className="btn btn-ghost h-7 shrink-0 gap-1 border border-neutral-700 px-2 text-[11px]"
          onClick={() => setAdding(true)}
        >
          <Icon name="plus" size={11} /> {t('Añadir relación')}
        </button>
      </div>

      <div className="mt-3">
      {outgoing.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('Sin relaciones registradas.')}</p>
      ) : (
        <ul className="space-y-1.5">
          {outgoing.map((r) => (
            <li key={r.relationId} className="rounded-md border border-neutral-800 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <button className="truncate font-medium text-neutral-200 hover:underline" onClick={() => openTarget(r)}>
                  {r.targetName}
                </button>
                <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] uppercase text-neutral-400">
                  {t(r.role)}
                </span>
                {r.targetKind === 'contact' && (
                  <span className="shrink-0 text-[10px] text-neutral-600">{t('contacto')}</span>
                )}
                <div className="ml-auto flex shrink-0 gap-0.5">
                  <button
                    className={`btn h-7 w-7 p-0 ${editingId === r.relationId ? 'border border-indigo-600 bg-indigo-900/30 text-indigo-200' : 'btn-ghost text-neutral-400 hover:text-neutral-200'}`}
                    title={t('Editar')}
                    onClick={() => setEditingId((id) => (id === r.relationId ? null : r.relationId))}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                  <button
                    className="btn btn-ghost h-7 w-7 p-0 text-red-300 hover:text-red-200"
                    title={t('Eliminar')}
                    onClick={() => void removeRelation(r)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
              {r.notes?.trim() && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-neutral-500">{r.notes}</p>}
            </li>
          ))}
        </ul>
      )}
      </div>

      {incoming.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
            {t('Conocido/a por')} <span className="text-neutral-700">({incoming.length})</span>
          </h4>
          <ul className="space-y-1">
            {incoming.map((r) => (
              <li key={r.relationId} className="truncate text-xs text-neutral-500">
                <button className="text-neutral-300 hover:underline" onClick={() => onNavigate?.(r.personId)}>
                  {r.personName}
                </button>{' '}
                · {t(r.role)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {viewingContactId && (
        <ContactDossier
          contactId={viewingContactId}
          onClose={() => setViewingContactId(null)}
          onChanged={load}
          onOpenPerson={onNavigate}
        />
      )}

      {adding && (
        <SocialRelationModal
          personId={personId}
          existingRelations={outgoing}
          onCreated={async () => {
            setAdding(false);
            await load();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {editingId && (() => {
        const relation = outgoing.find((candidate) => candidate.relationId === editingId);
        return relation ? (
          <EditRelationModal
            relation={relation}
            onSaved={async () => {
              setEditingId(null);
              await load();
            }}
            onCancel={() => setEditingId(null)}
          />
        ) : null;
      })()}
    </section>
  );
}

function EditRelationModal({
  relation,
  onSaved,
  onCancel,
}: {
  relation: SocialRelation;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [role, setRole] = useState(relation.role);
  const [notes, setNotes] = useState(relation.notes ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await window.nodus.updateSocialRelation(relation.relationId, { role: role.trim() || relation.role, notes: notes || null });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
      <section className="card-modal max-h-[90vh] w-full max-w-lg overflow-y-auto p-5" role="dialog" aria-modal="true" aria-labelledby="edit-social-relation-modal-title">
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="edit-social-relation-modal-title" className="text-base font-semibold text-neutral-100">{t('Editar relación social')}</h3>
            <p className="mt-1 text-xs text-neutral-500">{relation.targetName}</p>
          </div>
          <button className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-400" aria-label={t('Cerrar')} disabled={saving} onClick={onCancel}><Icon name="x" size={15} /></button>
        </div>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-neutral-400">{t('Tipo de relación')}</span>
            <input className="input h-9 w-full text-sm" value={role} onChange={(event) => setRole(event.target.value)} placeholder={t('Rol (amigo, patrón, socio…)')} />
          </label>
          <MarkdownNotesEditor value={notes} onSave={async (next) => setNotes(next)} placeholder={t('Notas sobre esta relación, en Markdown…')} rows={3} />
          <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
            <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onCancel} disabled={saving}>{t('Cancelar')}</button>
            <button className="btn btn-primary min-w-32" disabled={saving || !role.trim()} onClick={() => void save()}>{saving ? t('Guardando…') : t('Guardar cambios')}</button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

const SOCIAL_RELATION_TYPES = [
  'Amistad',
  'Patronazgo',
  'Empleo',
  'Sociedad profesional',
  'Rivalidad',
  'Correspondencia',
  'Vecindad',
  'Colaboración',
  'Clientela',
  'Mentoría',
] as const;

function SocialRelationModal({
  personId,
  existingRelations,
  onCreated,
  onCancel,
}: {
  personId: string;
  existingRelations: SocialRelation[];
  onCreated: () => Promise<void>;
  onCancel: () => void;
}) {
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [persons, setPersons] = useState<Person[]>([]);
  const [contacts, setContacts] = useState<SocialContact[]>([]);
  const [newContactName, setNewContactName] = useState('');
  const [newContactDescription, setNewContactDescription] = useState('');
  const [creatingNew, setCreatingNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.nodus.listPersons().then(setPersons);
    void window.nodus.listSocialContacts().then(setContacts);
  }, []);

  const roleOptions = useMemo<SearchableMultiSelectOption[]>(() => SOCIAL_RELATION_TYPES.map((role) => ({
    id: role,
    label: t(role),
  })), []);
  const targetOptions = useMemo<SearchableMultiSelectOption[]>(() => [
    ...persons
      .filter((candidate) => candidate.personId !== personId)
      .map((candidate) => ({ id: `person:${candidate.personId}`, label: candidate.displayName, description: t('familiar') })),
    ...contacts.map((contact) => ({ id: `contact:${contact.contactId}`, label: contact.displayName, description: t('contacto') })),
  ], [contacts, personId, persons]);

  const save = async () => {
    setError(null);
    if (selectedRoles.length === 0) {
      setError(t('Elige al menos un tipo de relación.'));
      return;
    }
    if (selectedTargets.length === 0 && !newContactName.trim()) {
      setError(t('Elige al menos una persona o contacto.'));
      return;
    }
    setSaving(true);
    try {
      const targets = selectedTargets.map((value) => {
        const separator = value.indexOf(':');
        return { targetKind: value.slice(0, separator) as 'person' | 'contact', targetId: value.slice(separator + 1) };
      });
      if (newContactName.trim()) {
        const created = await window.nodus.createSocialContact({
          displayName: newContactName.trim(),
          notes: newContactDescription.trim() || null,
        });
        targets.push({ targetKind: 'contact', targetId: created.contactId });
      }
      const existing = new Set(existingRelations.map((relation) => `${relation.targetKind}:${relation.targetId}:${relation.role}`));
      for (const target of targets) {
        for (const role of selectedRoles) {
          const key = `${target.targetKind}:${target.targetId}:${role}`;
          if (existing.has(key)) continue;
          await window.nodus.createSocialRelation({ personId, ...target, role, notes: notes || null });
          existing.add(key);
        }
      }
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
      <section className="card-modal max-h-[90vh] w-full max-w-lg overflow-y-auto p-5" role="dialog" aria-modal="true" aria-labelledby="social-relation-modal-title">
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="social-relation-modal-title" className="text-base font-semibold text-neutral-100">{t('Nueva relación social')}</h3>
            <p className="mt-1 text-xs text-neutral-500">{t('Elige uno o varios tipos y las personas o contactos relacionados.')}</p>
          </div>
          <button className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-400" aria-label={t('Cerrar')} disabled={saving} onClick={onCancel}><Icon name="x" size={15} /></button>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs font-medium text-neutral-400">{t('Tipos de relación')}</span>
            <SearchableMultiSelect
              options={roleOptions}
              selectedIds={selectedRoles}
              onChange={setSelectedRoles}
              placeholder={t('Elegir tipos de relación…')}
              searchPlaceholder={t('Buscar tipo de relación…')}
              testId="social-role-selector"
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-neutral-400">{t('Personas o contactos')}</span>
            <SearchableMultiSelect
              options={targetOptions}
              selectedIds={selectedTargets}
              onChange={setSelectedTargets}
              placeholder={t('Elegir personas o contactos…')}
              searchPlaceholder={t('Buscar personas o contactos…')}
              testId="social-target-selector"
            />
          </div>
          <div className="rounded-md border border-neutral-800 p-2.5">
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={creatingNew} onChange={(event) => { setCreatingNew(event.target.checked); if (!event.target.checked) { setNewContactName(''); setNewContactDescription(''); } }} />
              {t('Añadir un contacto externo')}
            </label>
            {creatingNew && (
              <div className="mt-2 space-y-2">
                <input className="input h-8 w-full text-xs" value={newContactName} onChange={(event) => setNewContactName(event.target.value)} placeholder={t('Nombre del contacto…')} />
                <textarea className="input min-h-12 w-full resize-y text-xs" placeholder={t('Datos de esta persona, si los conoces (ocupación, fechas, lugar…) — opcional')} value={newContactDescription} onChange={(event) => setNewContactDescription(event.target.value)} />
              </div>
            )}
          </div>
          <MarkdownNotesEditor value={notes} onSave={async (next) => setNotes(next)} placeholder={t('Notas sobre esta relación, en Markdown…')} rows={3} />
          {error && <p className="text-xs text-red-300">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
            <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onCancel} disabled={saving}>{t('Cancelar')}</button>
            <button className="btn btn-primary min-w-32" disabled={saving || selectedRoles.length === 0 || (selectedTargets.length === 0 && !newContactName.trim())} onClick={() => void save()}>
              {saving ? t('Guardando…') : t('Guardar relaciones')}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
