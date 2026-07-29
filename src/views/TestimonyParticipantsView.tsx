import { useCallback, useEffect, useState } from 'react';
import type { TestimonyIdentityMode, TestimonyParticipantRow } from '@shared/types';
import { IDENTITY_MODES } from '@shared/testimonies';
import { IDENTITY_MODE_LABEL, PARTICIPANT_ROLE_LABEL, WORKFLOW_STATUS_LABEL } from '@shared/testimonyLabels';
import { Icon, ModalBackdrop } from '../components/ui';
import { confirm } from '../components/feedback';
import { useDataRefresh } from '../hooks';
import { AccessBadge } from '../components/testimonies/AccessBadge';
import { TestimonyField } from '../components/testimonies/TestimonyField';
import type { InterviewWorkflowStatus, TestimonyAccessLevel } from '@shared/types';
import { t, tx } from '../i18n';

/**
 * Participantes.
 *
 * REUTILIZA LA ENTIDAD `persons`, NO LA PANTALLA DE PERSONAS. `PersonasView` habla de
 * parentescos, GEDCOM, coincidencias y árboles: vocabulario genealógico que en una
 * entrevista no significa nada y que, si se muestra, empuja a rellenar campos que
 * convierten un archivo de testimonios en una base de datos de personas.
 *
 * LO QUE NO PIDE: teléfono, correo, dirección. No es un olvido — un vault local que
 * custodia datos de contacto de terceros es un riesgo que este producto no necesita
 * asumir, y el investigador ya tiene su agenda.
 *
 * NOMBRE DE TRABAJO vs NOMBRE PÚBLICO es la distinción que sostiene toda la
 * anonimización: aquí se ven los dos porque es la pantalla del propio investigador; en
 * una cita, una exportación o un prompt sale únicamente el que el acuerdo permite.
 */
export function TestimonyParticipantsView() {
  const [rows, setRows] = useState<TestimonyParticipantRow[]>([]);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setRows(await window.nodus.listTestimonyParticipants(search.trim()));
    setLoading(false);
  }, [search]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useDataRefresh(reload);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="testimony-participants">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-200 px-6 pb-3 pt-4 dark:border-neutral-800">
        <h1 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">{t('Participantes')}</h1>
        <span className="text-xs text-neutral-500">{tx('{n} personas', { n: rows.length })}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Icon name="search" size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              className="input input-with-leading-icon w-52"
              placeholder={t('Buscar por nombre…')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button className="btn btn-primary" data-testid="testimony-new-participant" onClick={() => setCreating(true)}>
            <Icon name="plus" /> {t('Nuevo participante')}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {loading ? (
          <div className="grid h-full place-items-center text-sm text-neutral-500">
            <span className="flex items-center gap-2"><Icon name="sync" className="animate-spin" /> {t('Cargando...')}</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-800">
            {t('Todavía no hay participantes. Puedes crearlos aquí o desde el modal de una entrevista.')}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full min-w-[820px] border-collapse text-sm" data-testid="testimony-participant-table">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900/60">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">{t('Nombre de trabajo')}</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">{t('Nombre público')}</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">{t('Identificación')}</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">{t('Papeles')}</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">{t('Entrevistas')}</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">{t('Última entrevista')}</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">{t('Acuerdos pendientes')}</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">{t('Notas')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.personId}
                    data-testid={`testimony-participant-${row.personId}`}
                    tabIndex={0}
                    role="button"
                    onClick={() => setOpenId(row.personId)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpenId(row.personId); }
                    }}
                    className="cursor-pointer border-t border-neutral-200 hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none dark:border-neutral-800 dark:hover:bg-neutral-900/60 dark:focus:bg-neutral-900/60"
                  >
                    <td className="px-3 py-2 font-medium text-neutral-800 dark:text-neutral-100">{row.workingName}</td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{row.publicName ?? '—'}</td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{t(IDENTITY_MODE_LABEL[row.identityMode])}</td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
                      {row.roles.length ? row.roles.map((role) => t(PARTICIPANT_ROLE_LABEL[role])).join(', ') : '—'}
                    </td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{row.interviewCount}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-600 dark:text-neutral-300">{row.lastInterviewAt?.slice(0, 10) ?? '—'}</td>
                    <td className="px-3 py-2">
                      {row.pendingAgreements > 0
                        ? <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300">{row.pendingAgreements}</span>
                        : <span className="text-neutral-500">—</span>}
                    </td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{row.noteCount || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <NewParticipantModal
          onClose={() => setCreating(false)}
          onCreated={(personId) => { setCreating(false); setOpenId(personId); void reload(); }}
        />
      )}
      {openId && (
        <ParticipantModal
          personId={openId}
          onClose={() => { setOpenId(null); void reload(); }}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function NewParticipantModal({ onClose, onCreated }: { onClose: () => void; onCreated: (personId: string) => void }) {
  const [workingName, setWorkingName] = useState('');
  const [publicName, setPublicName] = useState('');
  const [identityMode, setIdentityMode] = useState<TestimonyIdentityMode>('identified');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (): Promise<void> => {
    if (!workingName.trim() || saving) return;
    setSaving(true);
    try {
      const created = await window.nodus.createTestimonyParticipant({
        workingName,
        publicName: publicName.trim() || null,
        identityMode,
        biographicalNote: note.trim() || null,
      });
      onCreated(created.personId);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-800 dark:bg-neutral-950" data-testid="testimony-new-participant-modal">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          <Icon name="users" size={16} className="text-indigo-400" /> {t('Nuevo participante')}
        </h2>
        <div className="mt-4 space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Nombre de trabajo')}</span>
            <input
              autoFocus
              className="input w-full"
              data-testid="testimony-participant-working-name"
              value={workingName}
              onChange={(event) => setWorkingName(event.target.value)}
            />
            <span className="text-[11px] leading-4 text-neutral-500">{t('Como lo llamas tú. No sale nunca en una cita ni en una exportación si el acuerdo no lo permite.')}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Nombre público o seudónimo')}</span>
            <input className="input w-full" value={publicName} onChange={(event) => setPublicName(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Modo de identificación')}</span>
            <select className="input w-full" value={identityMode} onChange={(event) => setIdentityMode(event.target.value as TestimonyIdentityMode)}>
              {IDENTITY_MODES.map((mode) => (
                <option key={mode} value={mode}>{t(IDENTITY_MODE_LABEL[mode])}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Nota biográfica')}</span>
            <textarea rows={3} className="input w-full" value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-[11px] leading-5 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/50">
            {t('Nodus no guarda datos de contacto: no es una agenda, y una bóveda local no debería custodiar el teléfono de nadie.')}
          </p>
        </div>
        <footer className="mt-4 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button>
          <button className="btn btn-primary" disabled={!workingName.trim() || saving} onClick={() => void submit()}>
            <Icon name={saving ? 'sync' : 'plus'} className={saving ? 'animate-spin' : ''} /> {t('Crear participante')}
          </button>
        </footer>
      </div>
    </ModalBackdrop>
  );
}

function ParticipantModal({ personId, onClose, onChanged }: { personId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [profile, setProfile] = useState<TestimonyParticipantRow | null>(null);
  const [interviews, setInterviews] = useState<{ interviewId: string; title: string; shortId: string; role: string; at: string | null; workflowStatus: string; accessLevel: string }[]>([]);

  const reload = useCallback(async () => {
    const [rows, list] = await Promise.all([
      window.nodus.listTestimonyParticipants(''),
      window.nodus.testimonyParticipantInterviews(personId),
    ]);
    setProfile(rows.find((row) => row.personId === personId) ?? null);
    setInterviews(list);
  }, [personId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const patch = async (fields: Parameters<typeof window.nodus.updateTestimonyParticipant>[1]): Promise<void> => {
    await window.nodus.updateTestimonyParticipant(personId, fields);
    await reload();
    await onChanged();
  };

  const remove = async (): Promise<void> => {
    const ok = await confirm({
      title: t('Eliminar participante'),
      message: t('Se eliminará esta persona del proyecto. Solo es posible si no participa en ninguna entrevista.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteTestimonyParticipant(personId);
    await onChanged();
    onClose();
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <section
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
        data-testid="testimony-participant-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="testimony-participant-modal-title"
      >
        {!profile ? (
          <div className="grid min-h-72 place-items-center text-sm text-neutral-500">
            <span className="flex items-center gap-2"><Icon name="sync" className="animate-spin" /> {t('Cargando...')}</span>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col" data-testid="testimony-participant-sheet">
            <header className="flex items-start gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                <Icon name="user" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="testimony-participant-modal-title" className="truncate font-semibold text-neutral-900 dark:text-neutral-100">
                    {profile.workingName}
                  </h2>
                  {profile.pendingAgreements > 0 && (
                    <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300">
                      {tx('{n} acuerdos pendientes', { n: profile.pendingAgreements })}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {t('Edita la identidad, el contexto y las preferencias de atribución de esta persona.')}
                </p>
              </div>
              <button className="btn btn-ghost h-9 w-9 shrink-0 p-0" aria-label={t('Cerrar')} onClick={onClose}>
                <Icon name="x" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/25">
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{t('Identidad en el proyecto')}</h3>
                    <p className="mt-1 text-[11px] leading-4 text-neutral-500">
                      {t('Distingue el nombre interno del que puede aparecer en citas y exportaciones.')}
                    </p>
                  </div>
                  <TestimonyField
                    label="Nombre de trabajo"
                    hint="Como lo llamas tú, dentro del proyecto."
                    multiline={false}
                    value={profile.workingName}
                    onSave={(next) => patch({ workingName: next })}
                  />
                  <TestimonyField
                    label="Nombre público o seudónimo"
                    hint="El que aparece en citas, derivados y exportaciones cuando el acuerdo lo exige."
                    multiline={false}
                    value={profile.publicName}
                    testid="testimony-participant-public-name"
                    onSave={(next) => patch({ publicName: next || null })}
                  />
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Modo de identificación')}</span>
                    <select
                      className="input w-full"
                      value={profile.identityMode}
                      onChange={(event) => void patch({ identityMode: event.target.value as TestimonyIdentityMode })}
                    >
                      {IDENTITY_MODES.map((mode) => (
                        <option key={mode} value={mode}>{t(IDENTITY_MODE_LABEL[mode])}</option>
                      ))}
                    </select>
                    <span className="text-[11px] leading-4 text-neutral-500">
                      {t('Gana siempre el más restrictivo entre esto y el acuerdo de cada entrevista. Nodus no promete anonimato absoluto.')}
                    </span>
                  </label>
                  <TestimonyField
                    label="Pronunciación"
                    hint="Cómo se pronuncia su nombre, si no es evidente."
                    multiline={false}
                    value={profile.pronunciation}
                    onSave={(next) => patch({ pronunciation: next || null })}
                  />
                </section>

                <section className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/25">
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{t('Contexto y atribución')}</h3>
                    <p className="mt-1 text-[11px] leading-4 text-neutral-500">
                      {t('Conserva únicamente el contexto necesario para interpretar y atribuir el testimonio.')}
                    </p>
                  </div>
                  <TestimonyField
                    label="Nota biográfica y contexto"
                    value={profile.biographicalNote}
                    rows={6}
                    onSave={(next) => patch({ biographicalNote: next || null })}
                  />
                  <TestimonyField
                    label="Preferencias de atribución"
                    hint="Lo que esta persona ha pedido sobre cómo se la nombra."
                    value={profile.attributionNote}
                    rows={4}
                    onSave={(next) => patch({ attributionNote: next || null })}
                  />
                </section>
              </div>

              <section className="mt-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{t('Entrevistas en las que participa')}</h3>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
                    {interviews.length}
                  </span>
                </div>
                {interviews.length === 0 ? (
                  <p className="mt-2 text-sm text-neutral-500">{t('Todavía no participa en ninguna entrevista.')}</p>
                ) : (
                  <ul className="mt-3 grid gap-2 lg:grid-cols-2">
                    {interviews.map((entry) => (
                      <li key={`${entry.interviewId}-${entry.role}`} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/70 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900/30">
                        <span className="min-w-0 flex-1 truncate font-medium text-neutral-700 dark:text-neutral-200">{entry.title}</span>
                        <span className="text-neutral-500">{entry.shortId}</span>
                        <span className="text-neutral-500">{t(PARTICIPANT_ROLE_LABEL[entry.role as keyof typeof PARTICIPANT_ROLE_LABEL] ?? entry.role)}</span>
                        <span className="text-neutral-500">{t(WORKFLOW_STATUS_LABEL[entry.workflowStatus as InterviewWorkflowStatus] ?? entry.workflowStatus)}</span>
                        <span className="ml-auto flex items-center gap-2">
                          {entry.at && <span className="text-neutral-500">{entry.at.slice(0, 10)}</span>}
                          <AccessBadge level={entry.accessLevel as TestimonyAccessLevel} compact />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <footer className="flex flex-wrap items-center gap-3 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
              {interviews.length === 0 && (
                <button className="btn btn-ghost text-rose-600 dark:text-rose-400" onClick={() => void remove()}>
                  <Icon name="trash" /> {t('Eliminar participante')}
                </button>
              )}
              <span className="text-[11px] text-neutral-500 sm:ml-auto">{t('Los cambios se guardan automáticamente.')}</span>
              <button className="btn btn-primary" onClick={onClose}>{t('Cerrar')}</button>
            </footer>
          </div>
        )}
      </section>
    </ModalBackdrop>
  );
}
