import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AclEntry, AclRole, EffectiveAcl, WorkspaceActor, WorkspaceShareLink } from '@shared/pages';
import { toast } from '../feedback';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';

const roles: AclRole[] = ['owner', 'full_access', 'edit', 'edit_content', 'comment', 'view'];
const roleLabel = (role: AclRole | null) => role === 'owner' ? t('Propietario') : role === 'full_access' ? t('Acceso completo')
  : role === 'edit' ? t('Editar estructura') : role === 'edit_content' ? t('Editar contenido')
    : role === 'comment' ? t('Comentar') : role === 'view' ? t('Ver') : t('Sin acceso');

export function PageAccessPanel({ pageId }: { pageId: string }) {
  const [access, setAccess] = useState<EffectiveAcl | null>(null);
  const [entries, setEntries] = useState<AclEntry[]>([]);
  const [actors, setActors] = useState<WorkspaceActor[]>([]);
  const [links, setLinks] = useState<WorkspaceShareLink[]>([]);
  const [actorId, setActorId] = useState('');
  const [role, setRole] = useState<AclRole>('view');
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [allowIndexing, setAllowIndexing] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const [nextAccess, nextActors] = await Promise.all([
      window.nodus.getEffectiveAcl('page', pageId), window.nodus.listWorkspaceActors(),
    ]);
    setAccess(nextAccess); setActors(nextActors);
    if (nextAccess.canManageAccess) {
      const [nextEntries, nextLinks] = await Promise.all([
        window.nodus.listAclEntries('page', pageId), window.nodus.listWorkspaceShareLinks('page', pageId),
      ]);
      setEntries(nextEntries); setLinks(nextLinks);
    } else { setEntries([]); setLinks([]); }
  }, [pageId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const availableActors = useMemo(() => actors.filter((actor) => actor.kind !== 'system'
    && !entries.some((entry) => entry.principalType === 'actor' && entry.principalId === actor.id)), [actors, entries]);

  const grant = async () => {
    if (!actorId || saving) return; setSaving(true);
    try {
      await window.nodus.setAclEntry({ resourceType: 'page', resourceId: pageId, principalType: 'actor', principalId: actorId, role });
      setActorId(''); await refresh();
    } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause), { tone: 'error' }); }
    finally { setSaving(false); }
  };
  const changeRole = async (entry: AclEntry, nextRole: AclRole) => {
    try {
      await window.nodus.setAclEntry({ resourceType: 'page', resourceId: pageId, principalType: entry.principalType, principalId: entry.principalId, role: nextRole });
      await refresh();
    } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause), { tone: 'error' }); }
  };
  const remove = async (entry: AclEntry) => {
    try { await window.nodus.deleteAclEntry(entry.id, entry.revision); await refresh(); }
    catch (cause) { toast(cause instanceof Error ? cause.message : String(cause), { tone: 'error' }); }
  };
  const createLink = async () => {
    if (saving) return; setSaving(true);
    try {
      const created = await window.nodus.createWorkspaceShareLink({ resourceType: 'page', resourceId: pageId, role: 'view',
        password: password || null, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, allowIndexing });
      setCreatedToken(created.token); setPassword(''); setExpiresAt(''); setAllowIndexing(false); await refresh();
    } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause), { tone: 'error' }); }
    finally { setSaving(false); }
  };
  const copyToken = async () => {
    if (!createdToken) return;
    await navigator.clipboard.writeText(`nodus://share/${createdToken}`);
    toast(t('Enlace copiado.'), { tone: 'success' });
  };
  const revoke = async (link: WorkspaceShareLink) => {
    try { await window.nodus.revokeWorkspaceShareLink(link.id, link.revision); await refresh(); }
    catch (cause) { toast(cause instanceof Error ? cause.message : String(cause), { tone: 'error' }); }
  };

  return <section data-testid="page-access-panel">
    <div className="mb-2 flex items-center gap-2"><Icon name="lock" size={13} className="text-indigo-500" /><h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{t('Acceso')}</h2></div>
    <div className="rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900/60">
      <p className="text-xs font-medium">{tx('Tu acceso: {role}', { role: roleLabel(access?.role ?? null) })}</p>
      {access?.inherited && <p className="mt-0.5 text-[10px] text-neutral-600 dark:text-neutral-400">{t('Heredado de un nivel superior')}</p>}
    </div>
    {access?.canManageAccess && <>
      <div className="mt-2 space-y-1">
        {entries.map((entry) => <div key={entry.id} className="flex min-w-0 items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1.5 dark:border-neutral-800 dark:bg-neutral-900/60">
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{entry.principalType === 'group' ? '👥 ' : ''}{entry.principalName}</span>
          <select className="input h-7 w-[104px] px-1 text-[10px]" value={entry.role} onChange={(event) => void changeRole(entry, event.target.value as AclRole)} aria-label={tx('Rol de {name}', { name: entry.principalName })}>{roles.map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}</select>
          <button className="grid h-7 w-7 shrink-0 place-items-center rounded text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950" onClick={() => void remove(entry)} aria-label={tx('Quitar acceso a {name}', { name: entry.principalName })}><Icon name="trash" size={11} /></button>
        </div>)}
      </div>
      {availableActors.length > 0 && <div className="mt-2 grid grid-cols-[minmax(0,1fr)_104px] gap-1">
        <select className="input h-8 min-w-0 px-1 text-[11px]" value={actorId} onChange={(event) => setActorId(event.target.value)} aria-label={t('Compartir con')}><option value="">{t('Compartir con…')}</option>{availableActors.map((actor) => <option key={actor.id} value={actor.id}>{actor.displayName}{actor.kind === 'guest' ? ` · ${t('Invitado')}` : ''}</option>)}</select>
        <select className="input h-8 px-1 text-[10px]" value={role} onChange={(event) => setRole(event.target.value as AclRole)} aria-label={t('Rol')}>{roles.map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}</select>
        <button className="btn btn-primary col-span-2 h-8 text-xs" disabled={!actorId || saving} onClick={() => void grant()}>{t('Añadir permiso')}</button>
      </div>}
      <div className="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{t('Enlaces compartidos')}</h3>
        {links.map((link) => <div key={link.id} className="mt-1 flex items-center gap-1 rounded-lg bg-neutral-100 p-1.5 text-[10px] dark:bg-neutral-900"><span className="min-w-0 flex-1">{link.revokedAt ? t('Revocado') : link.passwordProtected ? t('Protegido con contraseña') : t('Solo lectura')}{link.expiresAt ? ` · ${new Date(link.expiresAt).toLocaleDateString()}` : ''}</span>{!link.revokedAt && <button className="min-h-7 rounded px-1.5 font-semibold text-rose-700 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-950" onClick={() => void revoke(link)}>{t('Revocar')}</button>}</div>)}
        {createdToken && <div role="status" className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-[10px] text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"><p>{t('Copia este enlace ahora: el token no volverá a mostrarse.')}</p><button className="mt-1 min-h-7 rounded border border-emerald-500 px-2 font-semibold" onClick={() => void copyToken()}>{t('Copiar enlace')}</button></div>}
        <input className="input mt-2 h-8 w-full text-[11px]" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('Contraseña opcional (mínimo 6)')} aria-label={t('Contraseña del enlace')} />
        <input className="input mt-1 h-8 w-full text-[11px]" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} aria-label={t('Caducidad del enlace')} />
        <label className="mt-1.5 flex items-center gap-2 text-[10px]"><input type="checkbox" checked={allowIndexing} onChange={(event) => setAllowIndexing(event.target.checked)} />{t('Permitir indexación pública')}</label>
        <button className="btn mt-2 h-8 w-full text-xs" disabled={saving} onClick={() => void createLink()}>{t('Crear enlace')}</button>
      </div>
    </>}
  </section>;
}
