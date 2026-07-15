import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Person, Relationship } from '@shared/types';
import { kinshipRelationshipSpecsForPeople, parentAgeWarning, type KinshipChoice } from '@shared/kinshipRelations';
import { Icon } from './ui';
import { PersonMultiSelect } from './PersonMultiSelect';
import { confirm } from './feedback';
import { t } from '../i18n';

export function KinshipEditor({ person, persons, onChanged, compact = false }: {
  person: Person;
  persons: Person[];
  onChanged: () => Promise<void>;
  compact?: boolean;
}) {
  const [choice, setChoice] = useState<KinshipChoice>('child_of');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [adoptive, setAdoptive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [editingRelId, setEditingRelId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const others = useMemo(() => persons.filter((candidate) => candidate.personId !== person.personId), [person.personId, persons]);
  const personById = useMemo(() => new Map(persons.map((candidate) => [candidate.personId, candidate])), [persons]);
  const parentChoice = choice === 'child_of' || choice === 'parent_of';
  const loadRelationships = useCallback(async () => setRelationships(await window.nodus.listRelationships(person.personId)), [person.personId]);

  useEffect(() => { void loadRelationships(); }, [loadRelationships]);

  const connect = async () => {
    const specs = kinshipRelationshipSpecsForPeople(person.personId, choice, selectedIds, adoptive);
    if (specs.length === 0) return;
    const chronologicalIssues = specs.filter((spec) => {
      if (spec.type !== 'parent') return false;
      return parentAgeWarning(personById.get(spec.fromPerson)?.birthDate, personById.get(spec.toPerson)?.birthDate) != null;
    });
    if (chronologicalIssues.length > 0) {
      const proceed = await confirm({
        title: t('Revisar parentesco'),
        message: t('Las fechas parecen incompatibles con este parentesco. Comprueba quién es progenitor y quién es hijo antes de guardarlo.'),
        confirmLabel: t('Guardar de todos modos'),
      });
      if (!proceed) return;
    }
    setBusy(true);
    try {
      if (editingRelId) {
        const [first, ...additional] = specs;
        await window.nodus.updateRelationship(editingRelId, first.fromPerson, first.toPerson, first.type, first.subtype);
        for (const spec of additional) {
          await window.nodus.addRelationship(spec.fromPerson, spec.toPerson, spec.type, 'user_asserted', spec.subtype);
        }
      } else {
        for (const spec of specs) {
          await window.nodus.addRelationship(spec.fromPerson, spec.toPerson, spec.type, 'user_asserted', spec.subtype);
        }
      }
      setSelectedIds([]);
      setAdoptive(false);
      setEditingRelId(null);
      setModalOpen(false);
      await onChanged();
      await loadRelationships();
    } finally {
      setBusy(false);
    }
  };

  const relationshipLabel = (relationship: Relationship) => {
    const otherId = relationship.fromPerson === person.personId ? relationship.toPerson : relationship.fromPerson;
    const otherName = personById.get(otherId)?.displayName ?? t('Persona desconocida');
    if (relationship.type === 'spouse') return t('Cónyuge/pareja de {name}').replace('{name}', otherName);
    if (relationship.type === 'sibling') return t('Hermano/a de {name}').replace('{name}', otherName);
    if (relationship.fromPerson === person.personId) return t('Padre/madre de {name}').replace('{name}', otherName);
    return t('Hijo/a de {name}').replace('{name}', otherName);
  };

  const remove = async (relationship: Relationship) => {
    const ok = await confirm({
      title: t('Eliminar parentesco'),
      message: t('¿Eliminar «{relationship}»?').replace('{relationship}', relationshipLabel(relationship)),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.removeRelationship(relationship.relId);
    await onChanged();
    await loadRelationships();
  };

  const edit = (relationship: Relationship) => {
    const otherId = relationship.fromPerson === person.personId ? relationship.toPerson : relationship.fromPerson;
    const nextChoice: KinshipChoice = relationship.type === 'spouse'
      ? 'spouse_of'
      : relationship.type === 'sibling'
        ? 'sibling_of'
        : relationship.fromPerson === person.personId
          ? 'parent_of'
          : 'child_of';
    setChoice(nextChoice);
    setSelectedIds([otherId]);
    setAdoptive(relationship.subtype === 'adoptive');
    setEditingRelId(relationship.relId);
    setModalOpen(true);
  };

  const openNew = () => {
    setChoice('child_of');
    setSelectedIds([]);
    setAdoptive(false);
    setEditingRelId(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (busy) return;
    setModalOpen(false);
    setEditingRelId(null);
    setSelectedIds([]);
    setAdoptive(false);
  };

  const invert = async (relationship: Relationship) => {
    if (relationship.type !== 'parent') return;
    await window.nodus.updateRelationship(
      relationship.relId,
      relationship.toPerson,
      relationship.fromPerson,
      'parent',
      relationship.subtype
    );
    await onChanged();
    await loadRelationships();
  };

  const hasAgeWarning = (relationship: Relationship) => relationship.type === 'parent' && parentAgeWarning(
    personById.get(relationship.fromPerson)?.birthDate,
    personById.get(relationship.toPerson)?.birthDate
  ) != null;

  return (
    <div className={`rounded-md border border-neutral-800 bg-neutral-900/40 ${compact ? 'p-2.5' : 'p-3'}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {t('Relaciones familiares')} <span className="text-neutral-600">({relationships.length})</span>
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
            {t('Padres, hijos, hermanos y parejas vinculados a esta persona.')}
          </p>
        </div>
        <button className="btn btn-ghost h-7 shrink-0 gap-1 border border-neutral-700 px-2 text-[11px]" onClick={openNew}>
          <Icon name="plus" size={11} /> {t('Añadir relación')}
        </button>
      </div>

      <div className="mt-3 space-y-1">
        {relationships.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('Sin relaciones familiares registradas.')}</p>
        ) : relationships.map((relationship) => (
          <div key={relationship.relId} className="flex items-center gap-2 rounded-md border border-neutral-800 px-2 py-1.5 text-xs text-neutral-300">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{relationshipLabel(relationship)}</span>
              {hasAgeWarning(relationship) && <span className="block text-[10px] text-amber-400">{t('Fechas incompatibles: revisa la dirección')}</span>}
            </span>
            {relationship.subtype === 'adoptive' && <span className="text-[10px] text-neutral-500">{t('adoptiva')}</span>}
            {hasAgeWarning(relationship) && <button className="btn btn-ghost h-6 shrink-0 px-1.5 text-[10px] text-amber-300" title={t('Intercambiar progenitor e hijo')} onClick={() => void invert(relationship)}>{t('Invertir')}</button>}
            <button className="btn btn-ghost h-6 w-6 shrink-0 p-0 text-neutral-400" title={t('Editar parentesco')} onClick={() => edit(relationship)}><Icon name="edit" size={12} /></button>
            <button className="btn btn-ghost h-6 w-6 shrink-0 p-0 text-red-300" title={t('Eliminar parentesco')} onClick={() => void remove(relationship)}><Icon name="trash" size={12} /></button>
          </div>
        ))}
      </div>

      {modalOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
          <section className="card-modal max-h-[90vh] w-full max-w-lg overflow-y-auto p-5" role="dialog" aria-modal="true" aria-labelledby="kinship-modal-title">
            <div className="mb-4 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 id="kinship-modal-title" className="text-base font-semibold text-neutral-100">
                  {editingRelId ? t('Editar parentesco') : t('Nueva relación familiar')}
                </h3>
                <p className="mt-1 text-xs text-neutral-500">{t('Elige el tipo de parentesco y una o varias personas.')}</p>
              </div>
              <button className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-400" aria-label={t('Cerrar')} onClick={closeModal}><Icon name="x" size={15} /></button>
            </div>
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-neutral-400">{t('Tipo de relación')}</span>
                <select className="input h-9 w-full text-sm" value={choice} onChange={(event) => { setChoice(event.target.value as KinshipChoice); setSelectedIds([]); setAdoptive(false); }}>
                  <option value="child_of">{t('Esta persona es hijo/a de…')}</option>
                  <option value="parent_of">{t('Esta persona es padre/madre de…')}</option>
                  <option value="sibling_of">{t('Esta persona es hermano/a de…')}</option>
                  <option value="spouse_of">{t('Esta persona es cónyuge/pareja de…')}</option>
                </select>
              </label>
              <div className="space-y-1">
                <span className="text-xs font-medium text-neutral-400">{t('Familiares')}</span>
                <PersonMultiSelect
                  persons={others}
                  selectedIds={selectedIds}
                  onChange={setSelectedIds}
                  maxSelected={choice === 'child_of' ? 2 : undefined}
                  testId="kinship-person-selector"
                  placeholder={t(choice === 'child_of' ? 'Elegir progenitores…' : choice === 'parent_of' ? 'Elegir hijos/as…' : choice === 'sibling_of' ? 'Elegir hermanos/as…' : 'Elegir cónyuges/parejas…')}
                />
              </div>
              {parentChoice && (
                <label className="flex items-center gap-2 text-xs text-neutral-400">
                  <input type="checkbox" checked={adoptive} onChange={(event) => setAdoptive(event.target.checked)} />
                  {t('Relación adoptiva')}
                </label>
              )}
              <p className="text-[11px] text-neutral-500">
                {choice === 'child_of'
                  ? t('Indica los dos progenitores cuando se conozcan; puedes guardar solo uno.')
                  : t('Los parentescos que añades quedan marcados como afirmados por ti.')}
              </p>
              <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
                <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" disabled={busy} onClick={closeModal}>{t('Cancelar')}</button>
                <button className="btn btn-primary min-w-32" disabled={busy || selectedIds.length === 0} onClick={() => void connect()}>
                  {busy ? t('Guardando…') : editingRelId ? t('Guardar cambios') : t('Añadir relación')}
                </button>
              </div>
            </div>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}
