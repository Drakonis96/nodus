import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Person, SocialContact, SocialRelation } from '@shared/types';
import { Icon } from './ui';
import { MarkdownNotesEditor } from './MarkdownNotesEditor';
import { ContactDossier } from './ContactDossier';
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
    <section>
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Relaciones sociales')} <span className="text-neutral-600">({outgoing.length})</span>
        </h3>
        <button
          className="btn btn-ghost ml-auto h-6 gap-1 border border-neutral-700 px-2 text-[11px]"
          onClick={() => setAdding((v) => !v)}
        >
          <Icon name="plus" size={11} /> {t('Añadir relación')}
        </button>
      </div>
      <p className="mb-2 text-[11px] text-neutral-500">
        {t('Conexiones más allá del parentesco: amistades, patronazgo, empleo, rivalidad, correspondencia… Un árbol independiente del genealógico.')}
      </p>

      {outgoing.length === 0 && !adding ? (
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
                  {r.role}
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
              {editingId === r.relationId ? (
                <EditRelationForm
                  relation={r}
                  onSaved={async () => {
                    setEditingId(null);
                    await load();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                r.notes?.trim() && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-neutral-500">{r.notes}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="mt-2">
          <AddRelationForm
            personId={personId}
            onCreated={async () => {
              setAdding(false);
              await load();
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

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
                · {r.role}
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
    </section>
  );
}

function EditRelationForm({
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

  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-neutral-800 bg-neutral-950 p-2">
      <input className="input h-7 w-full text-xs" value={role} onChange={(e) => setRole(e.target.value)} placeholder={t('Rol (amigo, patrón, socio…)')} />
      <MarkdownNotesEditor value={notes} onSave={async (next) => setNotes(next)} placeholder={t('Notas sobre esta relación, en Markdown…')} rows={3} />
      <div className="flex gap-2">
        <button className="btn btn-primary h-7 flex-1 text-xs" disabled={saving} onClick={() => void save()}>
          {saving ? t('Guardando…') : t('Guardar')}
        </button>
        <button className="btn btn-ghost h-7 border border-neutral-700 px-2 text-xs" onClick={onCancel} disabled={saving}>
          {t('Cancelar')}
        </button>
      </div>
    </div>
  );
}

interface TargetOption {
  kind: 'person' | 'contact';
  id: string;
  displayName: string;
}

function AddRelationForm({
  personId,
  onCreated,
  onCancel,
}: {
  personId: string;
  onCreated: () => Promise<void>;
  onCancel: () => void;
}) {
  const [role, setRole] = useState('');
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState('');
  const [persons, setPersons] = useState<Person[]>([]);
  const [contacts, setContacts] = useState<SocialContact[]>([]);
  const [target, setTarget] = useState<TargetOption | null>(null);
  const [newContactDescription, setNewContactDescription] = useState('');
  const [creatingNew, setCreatingNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.nodus.listPersons().then(setPersons);
    void window.nodus.listSocialContacts().then(setContacts);
  }, []);

  const options = useMemo<TargetOption[]>(() => {
    const q = query.trim().toLowerCase();
    const fromPersons = persons
      .filter((p) => p.personId !== personId && (!q || p.displayName.toLowerCase().includes(q)))
      .map((p): TargetOption => ({ kind: 'person', id: p.personId, displayName: p.displayName }));
    const fromContacts = contacts
      .filter((c) => !q || c.displayName.toLowerCase().includes(q))
      .map((c): TargetOption => ({ kind: 'contact', id: c.contactId, displayName: c.displayName }));
    return [...fromPersons, ...fromContacts].slice(0, 8);
  }, [persons, contacts, query, personId]);

  const exactMatch = options.some((o) => o.displayName.toLowerCase() === query.trim().toLowerCase());

  const pick = (o: TargetOption) => {
    setTarget(o);
    setQuery(o.displayName);
    setCreatingNew(false);
  };

  const save = async () => {
    setError(null);
    if (!role.trim()) {
      setError(t('Indica el rol de esta relación.'));
      return;
    }
    setSaving(true);
    try {
      let targetKind: TargetOption['kind'];
      let targetId: string;
      if (target) {
        targetKind = target.kind;
        targetId = target.id;
      } else if (query.trim()) {
        const created = await window.nodus.createSocialContact({
          displayName: query.trim(),
          notes: newContactDescription.trim() || null,
        });
        targetKind = 'contact';
        targetId = created.contactId;
      } else {
        setError(t('Escribe o elige a la persona con quien tuvo esta relación.'));
        setSaving(false);
        return;
      }
      await window.nodus.createSocialRelation({ personId, targetKind, targetId, role: role.trim(), notes: notes || null });
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1.5 rounded-md border border-neutral-800 bg-neutral-950 p-2.5">
      <input className="input h-8 w-full text-xs" value={role} onChange={(e) => setRole(e.target.value)} placeholder={t('Rol (amigo, patrón, socio, rival…)')} />
      <div className="relative">
        <input
          className="input h-8 w-full text-xs"
          value={query}
          placeholder={t('Nombre de la persona…')}
          onChange={(e) => {
            setQuery(e.target.value);
            setTarget(null);
            setCreatingNew(false);
          }}
        />
        {query.trim() && !target && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 p-1 shadow-xl">
            {options.map((o) => (
              <button
                key={`${o.kind}:${o.id}`}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs text-neutral-200 hover:bg-neutral-800"
                onClick={() => pick(o)}
              >
                <span className="truncate">{o.displayName}</span>
                <span className="shrink-0 text-[10px] text-neutral-500">{o.kind === 'person' ? t('familiar') : t('contacto')}</span>
              </button>
            ))}
            {!exactMatch && (
              <button
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-indigo-300 hover:bg-neutral-800"
                onClick={() => setCreatingNew(true)}
              >
                <Icon name="plus" size={11} /> {tx('Crear contacto «{name}»', { name: query.trim() })}
              </button>
            )}
          </div>
        )}
      </div>
      {creatingNew && !target && (
        <textarea
          className="input min-h-12 w-full resize-y text-xs"
          placeholder={t('Datos de esta persona, si los conoces (ocupación, fechas, lugar…) — opcional')}
          value={newContactDescription}
          onChange={(e) => setNewContactDescription(e.target.value)}
        />
      )}
      <MarkdownNotesEditor value={notes} onSave={async (next) => setNotes(next)} placeholder={t('Notas sobre esta relación, en Markdown…')} rows={3} />
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary h-8 flex-1 text-xs" disabled={saving} onClick={() => void save()}>
          {saving ? t('Guardando…') : t('Guardar relación')}
        </button>
        <button className="btn btn-ghost h-8 border border-neutral-700 px-2 text-xs" onClick={onCancel} disabled={saving}>
          {t('Cancelar')}
        </button>
      </div>
    </div>
  );
}
