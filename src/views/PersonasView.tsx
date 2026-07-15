import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KinSuggestion, MatchCandidatePair, Person, PersonSex } from '@shared/types';
import { kinshipRelationshipSpecs, parentAgeWarning, type KinshipChoice } from '@shared/kinshipRelations';
import { Icon } from '../components/ui';
import { PersonPortrait } from '../components/PersonPortrait';
import { PersonDossier } from '../components/PersonDossier';
import { confirm } from '../components/feedback';
import { t, tx } from '../i18n';

const STRENGTH_STYLE: Record<string, string> = {
  alta: 'bg-emerald-900/40 text-emerald-300',
  media: 'bg-amber-900/40 text-amber-300',
  baja: 'bg-neutral-800 text-neutral-400',
};

function lifeSpan(p: Person): string {
  const b = p.birthDate?.trim();
  const d = p.deathDate?.trim();
  if (b && d) return `${b} – ${d}`;
  if (b) return `n. ${b}`;
  if (d) return `†︎ ${d}`;
  return '';
}

export function PersonasView({ initialPersonId }: { initialPersonId?: { id: string; nonce: number } | null }) {
  const [persons, setPersons] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewingKin, setReviewingKin] = useState(false);
  const [kinCount, setKinCount] = useState(0);

  const reload = useCallback(async () => {
    const list = await window.nodus.listPersons(search.trim() || undefined);
    setPersons(list);
    void window.nodus.kinSuggestionCount().then(setKinCount);
  }, [search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Preselect a person opened from global search (clears the search filter so it shows).
  useEffect(() => {
    if (initialPersonId?.id) {
      setSearch('');
      setSelectedId(initialPersonId.id);
    }
  }, [initialPersonId?.id, initialPersonId?.nonce]);

  const selected = useMemo(() => persons.find((p) => p.personId === selectedId) ?? null, [persons, selectedId]);

  return (
    <div className="h-full flex min-h-0">
      <div className="flex w-[22rem] shrink-0 flex-col border-r border-neutral-800 min-h-0">
        <div className="shrink-0 space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Icon name="users" size={20} className="text-indigo-300" />
            <h1 className="text-lg font-semibold">{t('Personas')}</h1>
            <span className="ml-auto text-xs text-neutral-500">{persons.length}</span>
          </div>
          <input
            className="input h-9 w-full text-sm"
            placeholder={t('Buscar por nombre o variante…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary h-9 w-full gap-1.5" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t('Añadir persona')}
          </button>
          <div className="space-y-1">
            <div className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">GEDCOM</div>
            <div className="flex gap-2">
              <button
                className="btn btn-ghost h-8 flex-1 justify-center gap-1.5 border border-neutral-700 text-xs"
                title={t('Importar un árbol GEDCOM (Gramps, Ancestry…)')}
                onClick={() =>
                  void window.nodus.importGedcom().then((r) => {
                    if (r) void reload();
                  })
                }
              >
                <Icon name="upload" size={13} /> {t('Importar')}
              </button>
              <button
                className="btn btn-ghost h-8 flex-1 justify-center gap-1.5 border border-neutral-700 text-xs"
                title={t('Exportar a GEDCOM para Gramps / Ancestry')}
                onClick={() => void window.nodus.exportGedcom()}
              >
                <Icon name="download" size={13} /> {t('Exportar')}
              </button>
            </div>
          </div>
          <button
            className="btn btn-ghost h-8 w-full gap-1.5 border border-neutral-700 text-xs"
            title={t('Buscar registros que podrían ser la misma persona')}
            onClick={() => setReviewing(true)}
          >
            <Icon name="users" size={13} /> {t('Revisar coincidencias')}
          </button>
          <button
            data-tour="kin-suggestions"
            className="btn btn-ghost h-8 w-full gap-1.5 border border-neutral-700 text-xs disabled:opacity-40"
            title={t('Revisar parentescos propuestos a partir de la evidencia')}
            disabled={kinCount === 0}
            onClick={() => setReviewingKin(true)}
          >
            <Icon name="tree" size={13} /> {t('Parentescos sugeridos')}
            {kinCount > 0 && (
              <span className="ml-auto rounded-full bg-indigo-600/30 px-1.5 text-[11px] text-indigo-200">{kinCount}</span>
            )}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {persons.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-neutral-500">
              {t('Aún no hay personas. Se crean al analizar fuentes primarias o añadiéndolas a mano.')}
            </p>
          )}
          {persons.map((p) => (
            <button
              key={p.personId}
              onClick={() => setSelectedId(p.personId)}
              className={`mb-1 flex w-full flex-col items-start rounded-md px-3 py-2 text-left transition ${
                p.personId === selectedId ? 'bg-indigo-600/20 ring-1 ring-indigo-500/40' : 'hover:bg-neutral-800/60'
              }`}
            >
              <span className="truncate text-sm text-neutral-100">{p.displayName}</span>
              <span className="truncate text-xs text-neutral-500">{lifeSpan(p) || t('sin fechas')}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <PersonDossier
            key={selected.personId}
            person={selected}
            onChanged={reload}
            onClose={() => setSelectedId(null)}
            onNavigate={(id) => setSelectedId(id)}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">
            {t('Selecciona una persona para ver su ficha, sus eventos y la evidencia que la respalda.')}
          </div>
        )}
      </div>

      {adding && <AddPersonModal onClose={() => setAdding(false)} onSaved={reload} />}
      {reviewing && (
        <MatchReviewModal
          onClose={() => setReviewing(false)}
          onChanged={async () => {
            setSelectedId(null);
            await reload();
          }}
        />
      )}
      {reviewingKin && (
        <KinReviewModal onClose={() => setReviewingKin(false)} onChanged={reload} onNavigate={(id) => setSelectedId(id)} />
      )}
    </div>
  );
}

/** Review evidence-driven kinship proposals in bulk: confirm (writes an ai_confirmed
 *  edge) or dismiss (persistent). Nothing is ever added to the tree automatically. */
function KinReviewModal({
  onClose,
  onChanged,
  onNavigate,
}: {
  onClose: () => void;
  onChanged: () => Promise<void>;
  onNavigate: (id: string) => void;
}) {
  const [items, setItems] = useState<KinSuggestion[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setItems(await window.nodus.listKinSuggestions());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card-modal flex max-h-[85vh] w-full max-w-2xl flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">{t('Parentescos sugeridos')}</h2>
            <p className="text-xs text-neutral-500">
              {t('Propuestos a partir de la evidencia de las fuentes. Tú confirmas; nada se añade al árbol solo.')}
            </p>
          </div>
          <button className="btn btn-ghost px-2 py-1" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items === null ? (
            <p className="py-8 text-center text-sm text-neutral-500">{t('Cargando…')}</p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">{t('No hay parentescos por revisar.')}</p>
          ) : (
            <ul className="space-y-3">
              {items.map((s) => (
                <li key={s.suggestionId} className="rounded-lg border border-neutral-800 p-3">
                  <div className="mb-1 flex items-start gap-2">
                    <p className="flex-1 text-sm text-neutral-200">
                      {s.type === 'spouse'
                        ? tx('¿{a} y {b} eran cónyuges?', { a: s.fromName, b: s.toName })
                        : tx('¿{parent} era progenitor(a) de {child}?', { parent: s.fromName, child: s.toName })}
                    </p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase ${STRENGTH_STYLE[s.strength] ?? STRENGTH_STYLE.baja}`}>
                      {t(s.strength)}
                    </span>
                  </div>
                  {s.evidence.some((ev) => ev.quote) && (
                    <ul className="mb-2 space-y-1 border-l-2 border-neutral-800 pl-2">
                      {s.evidence
                        .filter((ev) => ev.quote)
                        .slice(0, 4)
                        .map((ev) => (
                          <li key={ev.id} className="text-xs italic text-neutral-400">
                            “{ev.quote}”
                            <span className="not-italic text-neutral-600">
                              {' '}
                              · {ev.signal === 'explicit_claim' ? t('mención explícita') : t('registro')}
                              {ev.location ? ` · ${ev.location}` : ''}
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-primary h-8 text-xs" disabled={busy} onClick={() => void act(() => window.nodus.confirmKinSuggestion(s.suggestionId))}>
                      {t('Confirmar parentesco')}
                    </button>
                    <button
                      className="btn btn-ghost h-8 border border-neutral-700 text-xs text-neutral-400"
                      disabled={busy}
                      onClick={() => void act(() => window.nodus.dismissKinSuggestion(s.suggestionId))}
                    >
                      {t('Descartar')}
                    </button>
                    <button
                      className="btn btn-ghost ml-auto h-8 border border-neutral-700 text-xs"
                      onClick={() => {
                        onNavigate(s.fromPerson);
                        onClose();
                      }}
                    >
                      {t('Ver ficha')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Review proposed identity matches: merge (keep one record) or dismiss (not the same). */
function MatchReviewModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const [pairs, setPairs] = useState<MatchCandidatePair[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setPairs(await window.nodus.findMatches());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card-modal flex max-h-[85vh] w-full max-w-2xl flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">{t('Posibles coincidencias')}</h2>
            <p className="text-xs text-neutral-500">
              {t('Registros que podrían ser la misma persona. Tú decides; nada se fusiona automáticamente.')}
            </p>
          </div>
          <button className="btn btn-ghost px-2 py-1" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {pairs === null ? (
            <p className="py-8 text-center text-sm text-neutral-500">{t('Buscando coincidencias…')}</p>
          ) : pairs.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">{t('No hay coincidencias por revisar.')}</p>
          ) : (
            <ul className="space-y-3">
              {pairs.map((pair) => (
                <li key={`${pair.aId}-${pair.bId}`} className="rounded-lg border border-neutral-800 p-3">
                  <div className="mb-2 grid grid-cols-2 gap-3">
                    <PairPerson person={pair.a} />
                    <PairPerson person={pair.b} />
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {pair.reasons.map((r) => (
                      <span key={r} className="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">
                        {t(r)}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn btn-primary h-8 gap-1.5 text-xs"
                      disabled={busy}
                      onClick={() => void act(() => window.nodus.mergePersons(pair.aId, pair.bId))}
                    >
                      {tx('Fusionar en {name}', { name: pair.a.displayName })}
                    </button>
                    <button
                      className="btn btn-ghost h-8 gap-1.5 border border-neutral-700 text-xs"
                      disabled={busy}
                      onClick={() => void act(() => window.nodus.mergePersons(pair.bId, pair.aId))}
                    >
                      {tx('Fusionar en {name}', { name: pair.b.displayName })}
                    </button>
                    <button
                      className="btn btn-ghost h-8 gap-1.5 border border-neutral-700 text-xs text-neutral-400"
                      disabled={busy}
                      onClick={() => void act(() => window.nodus.dismissMatch(pair.aId, pair.bId))}
                    >
                      {t('No son la misma')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function PairPerson({ person }: { person: Person }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-neutral-900/50 p-2">
      <PersonPortrait person={person} size={40} />
      <div className="min-w-0">
        <div className="truncate text-sm text-neutral-100">{person.displayName}</div>
        <div className="truncate text-xs text-neutral-500">{lifeSpan(person) || t('sin fechas')}</div>
      </div>
    </div>
  );
}


function AddPersonModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [sex, setSex] = useState<PersonSex>('unknown');
  const [birth, setBirth] = useState('');
  const [death, setDeath] = useState('');
  const [busy, setBusy] = useState(false);
  const [persons, setPersons] = useState<Person[]>([]);
  const [relation, setRelation] = useState<KinshipChoice | 'none'>('none');
  const [primaryId, setPrimaryId] = useState('');
  const [secondaryId, setSecondaryId] = useState('');
  const [adoptive, setAdoptive] = useState(false);

  useEffect(() => { void window.nodus.listPersons().then(setPersons); }, []);

  const save = async () => {
    if (!name.trim()) return;
    if (relation !== 'none') {
      const previewSpecs = kinshipRelationshipSpecs('__new__', relation, primaryId, secondaryId, adoptive);
      const dateOf = (id: string) => id === '__new__' ? birth : persons.find((candidate) => candidate.personId === id)?.birthDate;
      if (previewSpecs.some((spec) => spec.type === 'parent' && parentAgeWarning(dateOf(spec.fromPerson), dateOf(spec.toPerson)) != null)) {
        const proceed = await confirm({
          title: t('Revisar parentesco'),
          message: t('Las fechas parecen incompatibles con este parentesco. Comprueba quién es progenitor y quién es hijo antes de guardarlo.'),
          confirmLabel: t('Guardar de todos modos'),
        });
        if (!proceed) return;
      }
    }
    setBusy(true);
    try {
      const created = await window.nodus.createPerson({
        displayName: name.trim(),
        sex,
        birthDate: birth.trim() || null,
        deathDate: death.trim() || null,
        names: [{ name: name.trim(), kind: null }],
      });
      if (relation !== 'none') {
        const specs = kinshipRelationshipSpecs(created.personId, relation, primaryId, secondaryId, adoptive);
        for (const spec of specs) {
          await window.nodus.addRelationship(spec.fromPerson, spec.toPerson, spec.type, 'user_asserted', spec.subtype);
        }
      }
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card-modal max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">{t('Añadir persona')}</h2>
        <input
          className="input h-9 w-full text-sm"
          placeholder={t('Nombre completo')}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <div className="grid grid-cols-3 gap-2">
          <select className="input h-9 text-sm" value={sex} onChange={(e) => setSex(e.target.value as PersonSex)}>
            <option value="unknown">{t('Sin determinar')}</option>
            <option value="male">{t('Hombre')}</option>
            <option value="female">{t('Mujer')}</option>
          </select>
          <input
            className="input h-9 text-sm"
            placeholder={t('Nacimiento')}
            value={birth}
            onChange={(e) => setBirth(e.target.value)}
          />
          <input
            className="input h-9 text-sm"
            placeholder={t('Defunción')}
            value={death}
            onChange={(e) => setDeath(e.target.value)}
          />
        </div>
        <p className="text-xs text-neutral-500">{t('Las fechas pueden ser inciertas: "c. 1850", "antes de 1880".')}</p>
        {persons.length > 0 && (
          <div className="space-y-2 rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Parentesco inicial (opcional)')}</label>
            <select className="input h-9 w-full text-sm" value={relation} onChange={(event) => { setRelation(event.target.value as KinshipChoice | 'none'); setPrimaryId(''); setSecondaryId(''); setAdoptive(false); }}>
              <option value="none">{t('Sin parentesco por ahora')}</option>
              <option value="child_of">{t('Es hijo/a de…')}</option>
              <option value="parent_of">{t('Es padre/madre de…')}</option>
              <option value="sibling_of">{t('Es hermano/a de…')}</option>
              <option value="spouse_of">{t('Es cónyuge/pareja de…')}</option>
            </select>
            {relation !== 'none' && (
              <select className="input h-9 w-full text-sm" value={primaryId} onChange={(event) => setPrimaryId(event.target.value)}>
                <option value="">{t(relation === 'child_of' ? 'Elegir progenitor 1…' : relation === 'parent_of' ? 'Elegir hijo/a…' : relation === 'sibling_of' ? 'Elegir hermano/a…' : 'Elegir cónyuge/pareja…')}</option>
                {persons.map((candidate) => <option key={candidate.personId} value={candidate.personId}>{candidate.displayName}</option>)}
              </select>
            )}
            {relation === 'child_of' && (
              <select className="input h-9 w-full text-sm" value={secondaryId} onChange={(event) => setSecondaryId(event.target.value)}>
                <option value="">{t('Progenitor 2 (si se conoce)…')}</option>
                {persons.filter((candidate) => candidate.personId !== primaryId).map((candidate) => <option key={candidate.personId} value={candidate.personId}>{candidate.displayName}</option>)}
              </select>
            )}
            {(relation === 'child_of' || relation === 'parent_of') && (
              <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={adoptive} onChange={(event) => setAdoptive(event.target.checked)} />{t('Relación adoptiva')}</label>
            )}
            {relation === 'child_of' && <p className="text-[11px] text-neutral-500">{t('Indica los dos progenitores cuando se conozcan; puedes guardar solo uno.')}</p>}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim() || (relation !== 'none' && !primaryId)} onClick={() => void save()}>
            {t('Guardar')}
          </button>
        </div>
      </div>
    </div>
  );
}
