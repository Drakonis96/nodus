import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { normalizeVaultType, type VaultType } from '@shared/vaultTypes';
import { VaultTypePicker, vaultTypeIcon, vaultTypeLabel, VAULT_TYPE_COLOR } from '../../components/vaultTypeUi';
import { Icon } from '../../components/ui';
import { api, ApiError } from '../api';
import type { Space } from '../types';

type ManagedSpace = Space & { vaultType?: string; createdAt?: string | null };
type SortKey = 'recent' | 'created' | 'name';
type Action = 'reset' | 'delete';
type DestructiveStep = 'intro' | 'code' | 'final';

function dateValue(value: unknown): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function spaceType(space: ManagedSpace): VaultType {
  return normalizeVaultType(space.vaultType || space.vault?.type);
}

function isNative(space: ManagedSpace): boolean {
  return space.storageKind === 'server_native' || space.authorityMode === 'server';
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error || 'No se ha podido completar la operación.');
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="server-vault-modal fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" data-testid="server-vault-modal">
    <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 p-5 text-neutral-100 shadow-2xl">
      <header className="mb-4 flex items-center gap-3"><h2 className="min-w-0 flex-1 text-base font-semibold">{title}</h2><button type="button" className="btn btn-ghost px-2" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button></header>
      {children}
    </section>
  </div>;
}

/**
 * Server-side counterpart of Desktop's VaultSwitcher. Server-native vaults own
 * their SQLite database on this host and support the complete lifecycle below.
 * Vaults published by Desktop remain selectable but deliberately read-only.
 */
export function ServerVaultManager({ spaces, active, isAdmin, csrfToken, onSelect, onChanged, onClose }: {
  spaces: Space[];
  active: Space;
  isAdmin: boolean;
  csrfToken?: string;
  onSelect: (id: string) => void;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<VaultType | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [vaultType, setVaultType] = useState<VaultType>('academic');
  const [renameTarget, setRenameTarget] = useState<ManagedSpace | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [duplicateTarget, setDuplicateTarget] = useState<ManagedSpace | null>(null);
  const [duplicateValue, setDuplicateValue] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ action: Action; space: ManagedSpace } | null>(null);
  const [destructiveStep, setDestructiveStep] = useState<DestructiveStep>('intro');
  const [destructiveCode, setDestructiveCode] = useState('');
  const [destructiveEntry, setDestructiveEntry] = useState('');
  const [destructiveError, setDestructiveError] = useState('');
  const [importTarget, setImportTarget] = useState<ManagedSpace | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-vault-trigger],[role="dialog"]')) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown, true); window.removeEventListener('keydown', onKeyDown); };
  }, [onClose]);

  const shown = useMemo(() => {
    const folded = query.trim().toLocaleLowerCase();
    const filtered = spaces.filter((space) => {
      const managed = space as ManagedSpace;
      return (typeFilter === 'all' || spaceType(managed) === typeFilter)
        && (!folded || `${space.name} ${space.description || ''}`.toLocaleLowerCase().includes(folded));
    });
    return [...filtered].sort((left, right) => {
      const a = left as ManagedSpace; const b = right as ManagedSpace;
      if (sortKey === 'name') return left.name.localeCompare(right.name, 'es', { sensitivity: 'base' });
      const aDate = sortKey === 'created' ? dateValue(a.createdAt) : dateValue(a.updatedAt);
      const bDate = sortKey === 'created' ? dateValue(b.createdAt) : dateValue(b.updatedAt);
      return bDate - aDate || left.name.localeCompare(right.name, 'es', { sensitivity: 'base' });
    });
  }, [query, sortKey, spaces, typeFilter]);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); setNotice(success); await onChanged(); }
    catch (next) { setError(errorMessage(next)); }
    finally { setBusy(false); }
  };

  const add = async () => {
    if (!name.trim()) { setError('Escribe un nombre para el vault.'); return; }
    await run(() => api.createVault({ name: name.trim(), description: description.trim(), vaultType }, csrfToken), 'Vault creado.');
    setAddOpen(false); setName(''); setDescription(''); setVaultType('academic');
  };

  const rename = async () => {
    if (!renameTarget || !renameValue.trim()) { setError('Escribe un nombre para el vault.'); return; }
    await run(() => api.updateVault(renameTarget.id, { name: renameValue.trim(), expectedRevision: Number(renameTarget.revision) }, csrfToken), 'Vault renombrado.');
    setRenameTarget(null);
  };

  const duplicate = async () => {
    if (!duplicateTarget || !duplicateValue.trim()) { setError('Escribe un nombre para la copia.'); return; }
    await run(() => api.vaultAction(duplicateTarget.id, 'duplicate', { name: duplicateValue.trim() }, csrfToken), 'Vault duplicado.');
    setDuplicateTarget(null);
  };

  const beginDestructive = (action: Action, space: ManagedSpace) => {
    setDestructiveError(''); setDestructiveEntry('');
    setDestructiveCode(Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join(''));
    setDestructiveStep('intro'); setConfirmAction({ action, space });
  };

  const destructive = async () => {
    if (!confirmAction) return;
    const { action, space } = confirmAction;
    setConfirmAction(null);
    const expectedRevision = Number(space.revision);
    await run(() => action === 'delete' ? api.deleteVault(space.id, expectedRevision, csrfToken) : api.vaultAction(space.id, 'reset', { expectedRevision }, csrfToken), action === 'delete' ? 'Vault eliminado.' : 'Vault reinicializado.');
  };

  const exportSpace = async (space: ManagedSpace) => {
    setBusy(true); setError('');
    try {
      const blob = await api.exportVault(space.id);
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${space.name.replace(/[^\w.-]+/g, '-').slice(0, 64) || 'vault'}.sqlite`; anchor.click(); URL.revokeObjectURL(url);
      setNotice('Exportación preparada.');
    } catch (next) { setError(errorMessage(next)); }
    finally { setBusy(false); }
  };

  const importSpace = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !importTarget) return;
    setBusy(true); setError('');
    try { await api.importVault(importTarget.id, file, Number(importTarget.revision), csrfToken); setNotice('Importación recibida.'); await onChanged(); }
    catch (next) { setError(errorMessage(next)); }
    finally { setBusy(false); setImportTarget(null); }
  };

  return <>
    <div ref={panelRef} className="server-vault-popover" role="dialog" aria-label="Gestionar vaults" data-testid="vault-manager" tabIndex={-1}>
      <header className="flex items-center gap-2 border-b border-neutral-800 p-3"><div className="min-w-0 flex-1"><strong className="block text-sm text-neutral-200">Vaults ({spaces.length})</strong><small className="text-[10px] text-neutral-600">Selector y gestor de vaults del servidor</small></div>{isAdmin && <button type="button" className="btn btn-primary gap-1 px-2 py-1 text-xs" onClick={() => { setError(''); setAddOpen(true); }} data-testid="vault-add"><Icon name="plus" size={14} />Añadir</button>}<button type="button" className="btn btn-ghost px-2" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button></header>
      <div className="server-vault-filters flex flex-wrap gap-2 border-b border-neutral-800 p-3"><label className="relative min-w-0 flex-1"><Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" /><input className="input input-with-leading-icon h-8 w-full text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar vaults…" aria-label="Buscar vaults" data-testid="vault-search" /></label><select className="input h-8 text-xs" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as VaultType | 'all')} aria-label="Filtrar por tipo" data-testid="vault-filter"><option value="all">Todos los tipos</option>{(['academic', 'primary_sources', 'testimonios', 'databases', 'docencia', 'estudio', 'genealogy', 'prosopography', 'worldbuilding'] as VaultType[]).map((type) => <option value={type} key={type}>{vaultTypeLabel(type)}</option>)}</select><select className="input h-8 text-xs" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} aria-label="Ordenar vaults" data-testid="vault-sort"><option value="recent">Último uso</option><option value="created">Fecha de creación</option><option value="name">Nombre</option></select></div>
      <div className="max-h-[58vh] space-y-1.5 overflow-y-auto p-3">{shown.map((space) => { const managed = space as ManagedSpace; const type = spaceType(managed); const selected = active.id === space.id; const editable = isNative(managed) && (isAdmin || managed.role === 'owner'); const canSeeActions = isAdmin || managed.role === 'owner'; return <article className="flex min-w-0 items-center gap-2 rounded-lg border border-neutral-800 px-2 py-2" key={space.id} data-testid={`vault-row-${space.id}`}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-white" style={{ backgroundColor: VAULT_TYPE_COLOR[type] }}><Icon name={vaultTypeIcon(type)} size={15} /></span><button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(space.id)} data-testid={`vault-option-${space.id}`}><strong className="block truncate text-xs text-neutral-200">{space.name}</strong><small className="block truncate text-[10px] text-neutral-600">{vaultTypeLabel(type)} · {managed.storageKind === 'desktop_published' ? 'Publicado desde Desktop' : selected ? 'Activo' : space.role || 'Lectura'}</small></button><div className="flex shrink-0 items-center gap-0.5"><button type="button" className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 disabled:opacity-40" disabled={selected || busy} onClick={() => onSelect(space.id)} title={selected ? 'Vault activo' : 'Activar'} aria-label={selected ? 'Vault activo' : `Activar ${space.name}`}><Icon name={selected ? 'check' : 'play'} size={14} /></button>{canSeeActions && <><button type="button" className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 disabled:opacity-40" disabled={!editable || busy} onClick={() => { setRenameTarget(managed); setRenameValue(space.name); }} title={editable ? 'Renombrar' : 'Solo lectura'} aria-label={`Renombrar ${space.name}`} data-testid={`vault-action-rename-${space.id}`}><Icon name="edit" size={14} /></button><button type="button" className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 disabled:opacity-40" disabled={!editable || busy} onClick={() => { setDuplicateTarget(managed); setDuplicateValue(`${space.name} copia`); }} title={editable ? 'Duplicar' : 'Solo lectura'} aria-label={`Duplicar ${space.name}`} data-testid={`vault-action-duplicate-${space.id}`}><Icon name="copy" size={14} /></button><button type="button" className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 disabled:opacity-40" disabled={!editable || busy} onClick={() => void exportSpace(managed)} title={editable ? 'Exportar' : 'Solo lectura'} aria-label={`Exportar ${space.name}`} data-testid={`vault-action-export-${space.id}`}><Icon name="download" size={14} /></button><button type="button" className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 disabled:opacity-40" disabled={!editable || busy} onClick={() => setImportTarget(managed)} title={editable ? 'Importar' : 'Solo lectura'} aria-label={`Importar en ${space.name}`} data-testid={`vault-action-import-${space.id}`}><Icon name="upload" size={14} /></button><button type="button" className="rounded p-1.5 text-red-400 hover:bg-red-950/40 disabled:opacity-40" disabled={!editable || selected || busy} onClick={() => beginDestructive('delete', managed)} title={selected ? 'Carga otro vault antes de eliminarlo' : editable ? 'Eliminar' : 'Solo lectura'} aria-label={`Eliminar ${space.name}`} data-testid={`vault-action-delete-${space.id}`}><Icon name="trash" size={14} /></button></>}</div></article>; })}{shown.length === 0 && <p className="p-5 text-center text-xs text-neutral-600">No hay coincidencias.</p>}{(isAdmin || active?.role === 'owner') && <div className="flex justify-end border-t border-neutral-800 pt-2"><button type="button" className="btn btn-ghost gap-1 px-2 py-1 text-xs" disabled={busy || !active || !isNative(active as ManagedSpace)} onClick={() => beginDestructive('reset', active as ManagedSpace)} data-testid="vault-reset"><Icon name="refresh" size={13} />Reinicializar activo</button></div>}{notice && <p className="rounded-md border border-teal-800/60 px-2 py-1 text-xs text-teal-300" role="status">{notice}</p>}{error && <p className="rounded-md border border-red-900/60 px-2 py-1 text-xs text-red-300" role="alert">{error}</p>}</div>
    </div>
    {addOpen && <Modal title="Añadir vault" onClose={() => setAddOpen(false)}><label className="block text-sm">Nombre<input className="input mt-1 w-full" autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label className="mt-3 block text-sm">Descripción<input className="input mt-1 w-full" value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="mt-4"><p className="mb-2 text-xs text-neutral-500">Tipo de vault</p><VaultTypePicker value={vaultType} onChange={setVaultType} disabled={busy} /></div><div className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={() => setAddOpen(false)}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void add()} disabled={busy}>Crear vault</button></div></Modal>}
    {renameTarget && <Modal title="Renombrar vault" onClose={() => setRenameTarget(null)}><input className="input w-full" autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void rename(); }} /><div className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={() => setRenameTarget(null)}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void rename()} disabled={busy}>Renombrar</button></div></Modal>}
    {duplicateTarget && <Modal title="Duplicar vault" onClose={() => setDuplicateTarget(null)}><p className="text-sm text-neutral-400">Se creará una copia independiente de «{duplicateTarget.name}».</p><input className="input mt-3 w-full" autoFocus value={duplicateValue} onChange={(event) => setDuplicateValue(event.target.value)} /><div className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={() => setDuplicateTarget(null)}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void duplicate()} disabled={busy}>Duplicar</button></div></Modal>}
    {confirmAction && <Modal title={confirmAction.action === 'delete' ? 'Eliminar vault' : 'Reinicializar vault'} onClose={() => { setConfirmAction(null); setDestructiveEntry(''); setDestructiveError(''); }}>
      {destructiveStep === 'intro' && <><p className="text-sm leading-6 text-neutral-300">{confirmAction.action === 'delete' ? `Se eliminará definitivamente el vault nativo «${confirmAction.space.name}» y su base de datos del servidor.` : `Se vaciará el contenido de «${confirmAction.space.name}» conservando su identidad y configuración.`}</p><div className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={() => setConfirmAction(null)}>Cancelar</button><button type="button" className="btn border border-red-700 text-red-300" onClick={() => setDestructiveStep('code')}>Continuar</button></div></>}
      {destructiveStep === 'code' && <><p className="text-sm leading-6 text-neutral-300">Escribe estas cuatro cifras para confirmar: <strong className="font-mono tracking-[.25em] text-amber-300">{destructiveCode}</strong></p><input className="input mt-4 w-full text-center font-mono tracking-[.35em]" inputMode="numeric" maxLength={4} autoFocus value={destructiveEntry} onChange={(event) => setDestructiveEntry(event.target.value.replace(/\D/g, '').slice(0, 4))} onKeyDown={(event) => { if (event.key === 'Enter') { if (destructiveEntry === destructiveCode) setDestructiveStep('final'); else setDestructiveError('Código incorrecto.'); } }} aria-label="Código de confirmación" data-testid="vault-destructive-code" />{destructiveError && <p className="mt-2 text-xs text-red-300" role="alert">{destructiveError}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={() => setConfirmAction(null)}>Cancelar</button><button type="button" className="btn border border-red-700 text-red-300" onClick={() => { if (destructiveEntry === destructiveCode) setDestructiveStep('final'); else setDestructiveError('Código incorrecto.'); }}>Verificar</button></div></>}
      {destructiveStep === 'final' && <><p className="text-sm leading-6 text-red-300">{confirmAction.action === 'delete' ? 'Esta acción no se puede deshacer. Se eliminarán el vault y sus datos nativos.' : 'Esta acción vaciará todos los datos del vault nativo.'}</p><div className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={() => setConfirmAction(null)}>Cancelar</button><button type="button" className="btn border border-red-700 text-red-300" onClick={() => void destructive()} disabled={busy}>{confirmAction.action === 'delete' ? 'Eliminar definitivamente' : 'Reinicializar definitivamente'}</button></div></>}
    </Modal>}
    {importTarget && <Modal title="Importar vault" onClose={() => setImportTarget(null)}><p className="text-sm leading-6 text-neutral-300">Selecciona una copia SQLite compatible para «{importTarget.name}». La importación sustituye solo el vault nativo del servidor.</p><input className="mt-4 block w-full text-xs" type="file" accept=".sqlite,.db,application/vnd.sqlite3,application/x-sqlite3" onChange={(event) => void importSpace(event)} disabled={busy} data-testid="vault-import-file" /></Modal>}
  </>;
}
